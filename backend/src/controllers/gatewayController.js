const externalApiService = require('../services/externalApiService');
const { calculateCost } = require('../services/costCalculator');
const { publishToQueue } = require('../services/queueService');
const { getRedisClient } = require('../config/redis');
const { publishTelemetryEvent } = require('../services/telemetryService');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');
const { generateDeduplicationKey, deduplicate } = require('../services/requestDeduplicationService');
const metricsService = require('../services/metricsService');
const {
  checkCircuit,
  recordSuccess: recordCircuitSuccess,
  recordFailure: recordCircuitFailure,
  getCircuitState,
  CircuitBreakerError
} = require('../services/circuitBreakerService');
const {
  getFailoverCandidates,
  isClientError,
  getEndpointForProvider,
  getDefaultModelForProvider
} = require('../services/failoverService');
const {
  checkClientRateLimit,
  checkProviderQuota
} = require('../services/rateLimitService');

/**
 * Main API Gateway request router.
 * Handles the logic pipeline: Heavy Traffic Queueing -> Auto-Retries -> Cost Calculation -> Cache Saving -> Log Persistence.
 */
const handleGatewayRequest = async (req, res) => {
  metricsService.recordRequest();
  const { provider } = req.params;
  const endpoint = normalizeEndpoint(req.params[0]);
  const { method, body, headers, userId } = req;
  const apiKeyId = req.gatewayKey ? req.gatewayKey._id : null;
  const startTime = Date.now();

  const originalRequestedProvider = provider;
  const originalRequestedModel = body ? body.model : null;

  // Optimization logic integration
  const optimizationEnabled = process.env.OPTIMIZATION_ENABLED === 'true';
  const optimizationExecutionMode = process.env.OPTIMIZATION_MODE || 'recommendation'; // 'recommendation' or 'automatic'
  let selectedProvider = provider;
  let selectedModel = body ? body.model : null;
  let routingEndpoint = endpoint;
  let optimizationUsed = false;

  let recommendedProvider = null;
  let recommendedModel = null;
  let recommendationScore = null;
  let costScore = null;
  let latencyScore = null;
  let reliabilityScore = null;
  
  req.query = req.query || {};
  req.headers = req.headers || {};
  const mode = req.query.mode || req.headers['x-optiapi-mode'] || 'balanced';

  // Read routing policy from Redis (Policy Service)
  const { getRoutingPolicy } = require('../services/policyService');
  const { getCachedRule } = require('../services/cacheRuleService');

  let routingPolicy = null;
  try {
    routingPolicy = await getRoutingPolicy(userId);
  } catch (policyErr) {
    logger.warn(`Failed to read routing policy from Redis for user [${userId}]: ${policyErr.message}`);
  }

  // 1. Distributed Client Rate Limit Check (Phase 3C)
  const clientIdentifier = apiKeyId || userId || req.gatewayKey?.key || req.ip || 'anonymous';
  const rateLimitConfig = routingPolicy?.rateLimit !== undefined
    ? routingPolicy.rateLimit
    : (req.headers['x-optiapi-rate-limit-requests']
        ? {
            enabled: req.headers['x-optiapi-rate-limit-enabled'] !== 'false',
            requests: parseInt(req.headers['x-optiapi-rate-limit-requests'], 10),
            windowSeconds: parseInt(req.headers['x-optiapi-rate-limit-window'] || '60', 10)
          }
        : (req.gatewayKey?.rateLimitRps ? { requests: req.gatewayKey.rateLimitRps, windowSeconds: 1 } : null)
      );

  const rateLimitResult = await checkClientRateLimit(clientIdentifier, rateLimitConfig);

  // Expose standard rate limit headers on response
  if (typeof res.setHeader === 'function') {
    res.setHeader('X-RateLimit-Limit', String(rateLimitResult.limit));
    res.setHeader('X-RateLimit-Remaining', String(rateLimitResult.remaining));
    res.setHeader('X-RateLimit-Reset', String(rateLimitResult.reset));
    if (rateLimitResult.degraded) {
      res.setHeader('X-RateLimit-Degraded', 'true');
    }
  }

  if (!rateLimitResult.allowed) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', String(rateLimitResult.retryAfter));
    }

    metricsService.recordError();

    publishTelemetryEvent({
      userId,
      apiKeyId,
      provider: selectedProvider,
      endpoint: routingEndpoint,
      method,
      statusCode: 429,
      latencyMs: Date.now() - startTime,
      costUsd: 0.0,
      cacheStatus: 'BYPASS',
      errorClassification: 'Rate limit violation - too many requests',
      actualProvider: selectedProvider
    }).catch(err => logger.warn(`Async telemetry failed for 429: ${err.message}`));

    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please retry later.',
      retryAfterSeconds: rateLimitResult.retryAfter
    });
  }

  let effectiveTimeoutMs = 15000;
  let effectiveMaxAttempts = 3;

  if (routingPolicy) {
    if (routingPolicy.timeoutMs) effectiveTimeoutMs = routingPolicy.timeoutMs;
    if (routingPolicy.maxRetries !== undefined) effectiveMaxAttempts = routingPolicy.maxRetries + 1;

    const recProvider = routingPolicy.provider;
    const recModel = routingPolicy.model;

    if (recProvider && ['openai', 'gemini', 'anthropic'].includes(recProvider)) {
      recommendedProvider = recProvider;
      recommendedModel = recModel || null;

      selectedProvider = recProvider;
      if (recModel) {
        selectedModel = recModel;
        req.body = req.body || {};
        req.body.model = selectedModel;
      }

      // Adapt endpoint if provider changed
      if (selectedProvider.toLowerCase() !== originalRequestedProvider.toLowerCase()) {
        if (selectedProvider === 'openai') {
          routingEndpoint = '/v1/chat/completions';
        } else if (selectedProvider === 'anthropic') {
          routingEndpoint = '/v1/messages';
        } else if (selectedProvider === 'gemini') {
          routingEndpoint = `/v1/models/${selectedModel || 'gemini-1.5-flash'}:generateContent`;
        }
        optimizationUsed = true;
      } else if (selectedModel && selectedModel !== originalRequestedModel) {
        if (selectedProvider === 'gemini') {
          routingEndpoint = routingEndpoint.replace(/\/models\/([^/:]+)/, `/models/${selectedModel}`);
        }
        optimizationUsed = true;
      }

      logger.info(`Routing policy active from Redis: routed to provider [${selectedProvider.toUpperCase()}] model [${selectedModel || 'default'}]`);

      // Re-evaluate cache for the new routed endpoint/provider using Redis cacheRuleService
      const normalizedRoutingEndpoint = normalizeEndpoint(routingEndpoint).toLowerCase();
      if (selectedProvider.toLowerCase() !== provider.toLowerCase() || normalizedRoutingEndpoint !== endpoint.toLowerCase()) {
        try {
          const rule = await getCachedRule(userId, selectedProvider, normalizedRoutingEndpoint);

          if (rule) {
            req.cacheRule = rule;
            const crypto = require('crypto');
            const bodyStr = JSON.stringify(req.body || {});
            const queryStr = JSON.stringify(req.query || {});
            const requestHash = crypto.createHash('sha256')
              .update(bodyStr + queryStr)
              .digest('hex');

            const cacheKey = `apicache:${userId}:${selectedProvider.toLowerCase()}:${normalizedRoutingEndpoint}:${requestHash}`;
            req.cacheKey = cacheKey;

            const redis = getRedisClient();
            const cachedResponse = await redis.get(cacheKey);

            if (cachedResponse) {
              logger.info(`Cache HIT on gateway after policy routing: [${selectedProvider.toUpperCase()}] ${normalizedRoutingEndpoint}`);
              req.cacheStatus = 'HIT';
              metricsService.recordCacheHit();
              metricsService.recordLatency(Date.now() - startTime);
              
              const parsedData = JSON.parse(cachedResponse);
              
              res.setHeader('X-OptiAPI-Cache', 'HIT');
              res.setHeader('X-OptiAPI-TTL', rule.ttlSeconds);
              res.setHeader('X-OptiAPI-Cost', '0.00000000');
              res.setHeader('X-OptiAPI-Time', '2ms');

              req.optimization = {
                optimizationEnabled: true,
                optimizationSelectedProvider: selectedProvider,
                optimizationSelectedModel: selectedModel,
                optimizationMode: routingPolicy.strategy || mode,
                optimizationUsed,
                requestedProvider: originalRequestedProvider,
                requestedModel: originalRequestedModel,
                recommendedProvider,
                recommendedModel,
                recommendationScore,
                costScore,
                latencyScore,
                reliabilityScore,
                actualProvider: selectedProvider,
                actualModel: selectedModel,
                routedProvider: selectedProvider
              };

              publishTelemetryEvent({
                userId,
                apiKeyId,
                provider: selectedProvider,
                model: selectedModel,
                endpoint: routingEndpoint,
                method,
                statusCode: 200,
                latencyMs: 2,
                costUsd: 0.0,
                tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                cacheStatus: 'HIT',
                optimization: {
                  optimizationEnabled: true,
                  optimizationUsed,
                  optimizationMode: routingPolicy.strategy || mode,
                  actualProvider: selectedProvider,
                  actualModel: selectedModel,
                  didFailover: false
                }
              }).catch(err => logger.warn(`Async telemetry failed for cache HIT: ${err.message}`));

            } else {
              // L1 MISS: Evaluate L2 Semantic Cache if enabled
              const semanticEnabled = (routingPolicy?.semanticCacheEnabled !== false) && (process.env.SEMANTIC_CACHE_ENABLED !== 'false');
              if (semanticEnabled) {
                const { searchSemanticCache, ensureIndex } = require('../services/semanticCacheService');
                await ensureIndex(redis);
                const threshold = (typeof routingPolicy?.semanticCacheThreshold === 'number')
                  ? routingPolicy.semanticCacheThreshold
                  : (parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD) || 0.90);
                const semanticStart = Date.now();
                const semanticResponse = await searchSemanticCache(redis, userId, selectedProvider.toLowerCase(), normalizedRoutingEndpoint, req.body, threshold, { req, model: selectedModel });
                const lookupMs = Date.now() - semanticStart;
                metricsService.recordSemanticCacheLookupLatency(lookupMs);

                if (semanticResponse) {
                  logger.info(`Semantic Cache HIT on gateway after policy routing: [${selectedProvider.toUpperCase()}] ${normalizedRoutingEndpoint}`);
                  req.cacheStatus = 'SEMANTIC_HIT';
                  metricsService.recordCacheHit();
                  metricsService.recordSemanticCacheHit();
                  metricsService.recordLatency(lookupMs > 0 ? lookupMs : 3);

                  res.setHeader('X-OptiAPI-Cache', 'SEMANTIC_HIT');
                  res.setHeader('X-OptiAPI-TTL', rule.ttlSeconds);
                  res.setHeader('X-OptiAPI-Cost', '0.00000000');
                  res.setHeader('X-OptiAPI-Time', `${lookupMs > 0 ? lookupMs : 3}ms`);

                  req.optimization = {
                    optimizationEnabled: true,
                    optimizationSelectedProvider: selectedProvider,
                    optimizationSelectedModel: selectedModel,
                    optimizationMode: routingPolicy.strategy || mode,
                    optimizationUsed,
                    requestedProvider: originalRequestedProvider,
                    requestedModel: originalRequestedModel,
                    recommendedProvider,
                    recommendedModel,
                    recommendationScore,
                    costScore,
                    latencyScore,
                    reliabilityScore,
                    actualProvider: selectedProvider,
                    actualModel: selectedModel,
                    routedProvider: selectedProvider
                  };

                  publishTelemetryEvent({
                    userId,
                    apiKeyId,
                    provider: selectedProvider,
                    model: selectedModel,
                    endpoint: routingEndpoint,
                    method,
                    statusCode: 200,
                    latencyMs: lookupMs > 0 ? lookupMs : 3,
                    costUsd: 0.0,
                    tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    cacheStatus: 'SEMANTIC_HIT',
                    optimization: {
                      optimizationEnabled: true,
                      optimizationUsed,
                      optimizationMode: routingPolicy.strategy || mode,
                      actualProvider: selectedProvider,
                      actualModel: selectedModel,
                      didFailover: false
                    }
                  }).catch(err => logger.warn(`Async telemetry failed for semantic cache HIT: ${err.message}`));

                  return res.status(200).json(semanticResponse);
                } else {
                  metricsService.recordSemanticCacheMiss();
                  req.cacheStatus = 'MISS';
                }
              } else {
                req.cacheStatus = 'MISS';
              }
            }
          } else {
            req.cacheRule = null;
            req.cacheKey = null;
            req.cacheStatus = 'BYPASS';
          }
        } catch (cacheErr) {
          logger.error(`Cache lookup failed during policy routing: ${cacheErr.message}`);
        }
      }
    }
  }

  // Attach internally readable request lifecycle optimization metadata
  req.optimization = {
    optimizationEnabled,
    optimizationSelectedProvider: selectedProvider,
    optimizationSelectedModel: selectedModel,
    optimizationMode: mode,
    optimizationUsed,
    requestedProvider: originalRequestedProvider,
    requestedModel: originalRequestedModel,
    recommendedProvider,
    recommendedModel,
    recommendationScore,
    costScore,
    latencyScore,
    reliabilityScore,
    actualProvider: selectedProvider,
    actualModel: selectedModel,
    routedProvider: selectedProvider
  };

  // 1. Heavy Traffic Queueing simulation trigger
  if (req.query.queue === 'true' || headers['x-optiapi-queue'] === 'true') {
    const queuePayload = {
      userId,
      apiKeyId,
      provider: selectedProvider,
      endpoint: routingEndpoint,
      method,
      body: req.body,
      timestamp: Date.now(),
      requestedProvider: originalRequestedProvider,
      requestedModel: originalRequestedModel,
      recommendedProvider,
      recommendedModel,
      recommendationScore,
      costScore,
      latencyScore,
      reliabilityScore,
      actualProvider: selectedProvider,
      actualModel: selectedModel,
      routedProvider: selectedProvider,
      inputProvider: originalRequestedProvider,
      inputModel: originalRequestedModel
    };

    await publishToQueue('gateway_requests', queuePayload);

    return res.status(202).json({
      success: true,
      status: 'queued',
      message: 'Request queued successfully. Background processing initiated.',
      requestId: `job_${Math.random().toString(36).substr(2, 9).toUpperCase()}`
    });
  }

  // 2. Direct request routing with Auto-Retries, Request Deduplication (Singleflight) & Failover
  const candidateProviders = getFailoverCandidates(selectedProvider, routingPolicy, req);

  const dedupKey = generateDeduplicationKey({
    userId,
    provider: selectedProvider,
    model: selectedModel,
    method,
    endpoint: routingEndpoint,
    query: req.query,
    body: req.body
  });

  const executeProviderWithRetries = async (prov, ep, mod) => {
    // Check circuit breaker before attempting upstream calls (fast fail if OPEN or test lock held)
    checkCircuit(prov);

    let attempts = 0;
    const maxAttempts = effectiveMaxAttempts;
    let lastError = null;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        metricsService.recordUpstreamRequest(prov);
        const resp = await externalApiService.simulateApiCall(
          prov,
          ep,
          method,
          req.body,
          headers,
          userId,
          originalRequestedProvider,
          { timeoutMs: effectiveTimeoutMs }
        );
        recordCircuitSuccess(prov);
        return resp;
      } catch (err) {
        lastError = err;
        logger.warn(`Gateway router attempt ${attempts}/${maxAttempts} failed for provider [${prov.toUpperCase()}] ${ep}: ${err.message}`);
        
        // Record failure in circuit breaker
        recordCircuitFailure(prov, err);

        // If circuit breaker error or circuit became OPEN, do not retry this provider
        if (err.code === 'CIRCUIT_OPEN' || err.name === 'CircuitBreakerError') {
          throw err;
        }
        const circuitState = getCircuitState(prov);
        if (circuitState && circuitState.state === 'OPEN') {
          throw err;
        }

        // Do not retry deterministic schema or configuration errors, client errors, or explicit non-retryable errors
        if (err.shouldRetry === false || isClientError(err) || err.message.includes('CapabilityError') || err.message.includes('ConfigurationError') || err.message.includes('ValidationError')) {
          throw err;
        }

        if (attempts < maxAttempts) {
          const delay = Math.pow(2, attempts) * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError || new Error(`Upstream request to [${prov}] failed after ${maxAttempts} attempts`);
  };

  const executeUpstream = async () => {
    let lastError = null;
    let allCircuitsOpen = true;
    let anyQuotaExhausted = false;

    for (let cIdx = 0; cIdx < candidateProviders.length; cIdx++) {
      const currentProvider = candidateProviders[cIdx];
      const isPrimary = (cIdx === 0);

      // 1. Check circuit state: NEVER call a provider whose circuit is OPEN
      const circuitState = getCircuitState(currentProvider);
      if (circuitState && circuitState.state === 'OPEN') {
        logger.warn(`Provider [${currentProvider.toUpperCase()}] circuit is OPEN. Skipping in failover cycle.`);
        metricsService.recordCircuitRejected(currentProvider);
        if (!lastError) {
          lastError = new CircuitBreakerError(currentProvider, 'Provider temporarily unavailable');
        }
        continue;
      }

      // 2. Check Provider Quota: Is quota available for this provider?
      const providerLimits = routingPolicy?.providerLimits || req.providerLimits || null;
      const providerLimitConfig = providerLimits?.[currentProvider] || null;

      if (providerLimitConfig) {
        const quotaResult = await checkProviderQuota(userId, currentProvider, providerLimitConfig);
        if (!quotaResult.allowed) {
          allCircuitsOpen = false;
          anyQuotaExhausted = true;
          logger.warn(`Provider [${currentProvider.toUpperCase()}] quota exhausted (${quotaResult.current}/${quotaResult.limit}). Skipping candidate.`);
          if (!lastError) {
            const quotaErr = new Error(`Provider quota exceeded for ${currentProvider}`);
            quotaErr.statusCode = 429;
            quotaErr.code = 'PROVIDER_QUOTA_EXHAUSTED';
            quotaErr.provider = currentProvider;
            lastError = quotaErr;
          }
          continue;
        }
      }

      allCircuitsOpen = false;

      // If not primary, record failover attempt
      if (!isPrimary) {
        metricsService.recordFailoverAttempt(candidateProviders[0], currentProvider);
      }

      // Determine endpoint and model for currentProvider
      let targetEndpoint = routingEndpoint;
      let targetModel = selectedModel;

      if (currentProvider.toLowerCase() !== selectedProvider.toLowerCase()) {
        targetEndpoint = getEndpointForProvider(currentProvider);
        targetModel = getDefaultModelForProvider(currentProvider);
      }

      try {
        const result = await executeProviderWithRetries(currentProvider, targetEndpoint, targetModel);

        if (!isPrimary) {
          metricsService.recordFailoverSuccess(candidateProviders[0], currentProvider);
        }

        return {
          ...result,
          servingProvider: currentProvider,
          servingEndpoint: targetEndpoint,
          servingModel: result.model || targetModel,
          didFailover: !isPrimary
        };
      } catch (err) {
        lastError = err;

        // Do not fall back for client errors such as 400/401/403
        if (isClientError(err)) {
          logger.warn(`Client error on provider [${currentProvider.toUpperCase()}]. Aborting failover cycle.`);
          throw err;
        }

        logger.warn(`Provider [${currentProvider.toUpperCase()}] failed after retries: ${err.message}.`);
      }
    }

    if (allCircuitsOpen && !lastError) {
      lastError = new CircuitBreakerError(selectedProvider, 'Provider temporarily unavailable');
    }

    if (anyQuotaExhausted && !lastError) {
      const qErr = new Error('All eligible providers have exhausted their quotas');
      qErr.statusCode = 429;
      qErr.code = 'ALL_PROVIDER_QUOTAS_EXHAUSTED';
      lastError = qErr;
    }

    throw lastError || new Error(`All candidate providers failed to serve the request`);
  };

  let apiResponse = null;
  let errorDetail = null;
  let requestSucceeded = false;
  let lastCapturedError = null;

  try {
    apiResponse = await deduplicate(dedupKey, executeUpstream);
    requestSucceeded = true;
  } catch (err) {
    lastCapturedError = err;
    errorDetail = err.message;
    requestSucceeded = false;
  }

  const responseTimeMs = Date.now() - startTime;
  const targetProviderForMetrics = apiResponse?.servingProvider || selectedProvider;
  metricsService.recordLatency(responseTimeMs, targetProviderForMetrics);

  // 3. Request Success Handling
  if (requestSucceeded && apiResponse) {
    metricsService.recordCacheMiss();
    const { data, tokensUsed, model, servingProvider, servingEndpoint, servingModel, didFailover } = apiResponse;
    const actualServingProvider = servingProvider || selectedProvider;
    const actualServingEndpoint = servingEndpoint || routingEndpoint;
    const resolvedModel = model || servingModel || actualServingEndpoint.match(/\/models\/([^/:]+)/)?.[1] || null;
    const costUsd = calculateCost(actualServingProvider, actualServingEndpoint, resolvedModel, tokensUsed);

    publishTelemetryEvent({
      userId,
      apiKeyId,
      provider: actualServingProvider,
      model: resolvedModel,
      endpoint: actualServingEndpoint,
      method,
      statusCode: 200,
      latencyMs: responseTimeMs,
      costUsd,
      tokensUsed,
      cacheStatus: 'MISS',
      optimization: {
        optimizationEnabled: req.optimization?.optimizationEnabled || false,
        optimizationUsed: (req.optimization?.optimizationUsed || false) || didFailover,
        optimizationMode: req.optimization?.optimizationMode || null,
        actualProvider: actualServingProvider,
        actualModel: resolvedModel,
        didFailover
      }
    }).catch(err => logger.warn(`Async telemetry failed for 200: ${err.message}`));

    if (req.cacheKey && req.cacheRule && routingPolicy?.cacheEnabled !== false) {
      try {
        const redis = getRedisClient();
        await redis.setEx(req.cacheKey, req.cacheRule.ttlSeconds, JSON.stringify(data));
        logger.debug(`Cached new entry in Redis: ${req.cacheKey} for ${req.cacheRule.ttlSeconds}s`);
        
        // Also save to L2 Semantic Cache if enabled
        const semanticEnabled = (routingPolicy?.semanticCacheEnabled !== false) && (process.env.SEMANTIC_CACHE_ENABLED !== 'false');
        if (semanticEnabled) {
          const { saveSemanticCache } = require('../services/semanticCacheService');
          await saveSemanticCache(
            redis,
            userId,
            actualServingProvider.toLowerCase(),
            actualServingEndpoint.toLowerCase(),
            req.body,
            data,
            req.cacheRule.ttlSeconds,
            { req, model: resolvedModel }
          );
        }
      } catch (err) {
        logger.error(`Failed to write cache entry to Redis: ${err.message}`);
      }
    }

    res.setHeader('X-OptiAPI-Cache', 'MISS');
    res.setHeader('X-OptiAPI-Cost', costUsd);
    res.setHeader('X-OptiAPI-Time', `${responseTimeMs}ms`);
    res.setHeader('X-OptiAPI-Provider', actualServingProvider);
    if (didFailover) {
      res.setHeader('X-OptiAPI-Failover', 'true');
    }
    return res.status(200).json(data);
  }

  // 4. Request Failure Handling
  metricsService.recordError(selectedProvider);
  const failedCost = 0.0;
  const isCircuitOpen = lastCapturedError?.code === 'CIRCUIT_OPEN' || lastCapturedError?.name === 'CircuitBreakerError';
  const failureStatus = isCircuitOpen ? 503 : (lastCapturedError?.statusCode || 502);
  
  publishTelemetryEvent({
    userId,
    apiKeyId,
    provider: selectedProvider,
    endpoint: routingEndpoint,
    method,
    statusCode: failureStatus,
    latencyMs: responseTimeMs,
    costUsd: failedCost,
    cacheStatus: 'BYPASS',
    errorClassification: errorDetail || (isCircuitOpen ? 'Provider Circuit Open' : 'Gateway Routing Failed'),
    optimization: {
      optimizationEnabled: req.optimization?.optimizationEnabled || false,
      optimizationUsed: req.optimization?.optimizationUsed || false,
      optimizationMode: req.optimization?.optimizationMode || null,
      actualProvider: selectedProvider,
      actualModel: originalRequestedModel,
      didFailover: false
    }
  }).catch(err => logger.warn(`Async telemetry failed for error: ${err.message}`));

  if (isCircuitOpen) {
    return res.status(503).json({
      error: 'Provider temporarily unavailable',
      provider: lastCapturedError?.provider || selectedProvider,
      code: 'CIRCUIT_OPEN'
    });
  }

  if (lastCapturedError?.code === 'PROVIDER_QUOTA_EXHAUSTED' || lastCapturedError?.code === 'ALL_PROVIDER_QUOTAS_EXHAUSTED') {
    return res.status(429).json({
      error: 'Provider Quota Exceeded',
      message: lastCapturedError.message,
      provider: lastCapturedError.provider || selectedProvider,
      code: lastCapturedError.code
    });
  }

  if (isClientError(lastCapturedError)) {
    const clientStatus = lastCapturedError.statusCode || lastCapturedError.status || 400;
    return res.status(clientStatus).json({
      success: false,
      error: lastCapturedError.name || 'Client Error',
      message: errorDetail
    });
  }

  return res.status(502).json({
    success: false,
    error: 'Bad Gateway',
    message: `Gateway failed to route requests to external provider after ${effectiveMaxAttempts} attempts. Detail: ${errorDetail}`
  });
};

module.exports = {
  handleGatewayRequest
};
