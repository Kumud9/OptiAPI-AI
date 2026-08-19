const externalApiService = require('../services/externalApiService');
const { calculateCost } = require('../services/costCalculator');
const { publishToQueue } = require('../services/queueService');
const { getRedisClient } = require('../config/redis');
const RequestLog = require('../models/RequestLog');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');

/**
 * Main API Gateway request router.
 * Handles the logic pipeline: Heavy Traffic Queueing -> Auto-Retries -> Cost Calculation -> Cache Saving -> Log Persistence.
 */
const handleGatewayRequest = async (req, res) => {
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

  if (optimizationEnabled && (provider === 'openai' || provider === 'gemini' || provider === 'anthropic')) {
    try {
      const { getOptimizationDecision } = require('../services/optimizationDecisionService');
      const decisionResult = await getOptimizationDecision(userId, mode, { provider, endpoint, body });
      if (decisionResult && decisionResult.success && decisionResult.decision) {
        const { provider: recProvider, model: recModel, endpoint: recEndpoint } = decisionResult.decision;
        const successfulRequests = decisionResult.metrics?.successfulRequests;

        // Safety rules validation:
        const isSupportedProvider = recProvider === 'openai' || recProvider === 'gemini' || recProvider === 'anthropic';
        const hasModelAndEndpoint = !!recModel && !!recEndpoint;
        const hasMinSuccessfulRequests = typeof successfulRequests === 'number' && successfulRequests >= 5;

        if (isSupportedProvider && hasModelAndEndpoint && hasMinSuccessfulRequests) {
          recommendedProvider = recProvider;
          recommendedModel = recModel;
          recommendationScore = decisionResult.decision.score || null;
          costScore = decisionResult.decision.costScore || null;
          latencyScore = decisionResult.decision.latencyScore || null;
          reliabilityScore = decisionResult.decision.reliabilityScore || null;

          if (optimizationExecutionMode === 'automatic') {
            selectedProvider = recProvider;
            selectedModel = recModel;
            optimizationUsed = true;
            
            req.body = req.body || {};
            req.body.model = selectedModel;

            if (selectedProvider === 'openai' || selectedProvider === 'anthropic') {
              routingEndpoint = recEndpoint;
            } else if (selectedProvider === 'gemini') {
              routingEndpoint = recEndpoint.replace(/\/models\/([^/:]+)/, `/models/${selectedModel}`);
            }
            logger.info(`Optimization active (automatic mode): routed request to provider [${selectedProvider.toUpperCase()}] model [${selectedModel}]`);

            // Re-evaluate cache for the new routed endpoint/provider in automatic mode
            const normalizedRoutingEndpoint = normalizeEndpoint(routingEndpoint).toLowerCase();
            if (selectedProvider.toLowerCase() !== provider.toLowerCase() || normalizedRoutingEndpoint !== endpoint.toLowerCase()) {
              try {
                const CacheRule = require('../models/CacheRule');
                const rule = await CacheRule.findOne({
                  userId,
                  provider: selectedProvider.toLowerCase(),
                  endpoint: normalizedRoutingEndpoint,
                  isActive: true
                });

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
                    logger.info(`Cache HIT on gateway after optimization routing: [${selectedProvider.toUpperCase()}] ${normalizedRoutingEndpoint}`);
                    req.cacheStatus = 'HIT';
                    
                    const parsedData = JSON.parse(cachedResponse);
                    
                    res.setHeader('X-OptiAPI-Cache', 'HIT');
                    res.setHeader('X-OptiAPI-TTL', rule.ttlSeconds);
                    res.setHeader('X-OptiAPI-Cost', '0.00000000');
                    res.setHeader('X-OptiAPI-Time', '2ms');

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

                    RequestLog.create({
                      userId,
                      apiKeyId,
                      provider: selectedProvider,
                      model: selectedModel,
                      endpoint: routingEndpoint,
                      method,
                      status: 200,
                      responseTimeMs: 2,
                      costUsd: 0.0,
                      tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                      cacheStatus: 'HIT',
                      requestBody: JSON.stringify(req.body || {}),
                      responseBody: cachedResponse,
                      optimizationEnabled,
                      optimizationUsed,
                      optimizationMode: mode,
                      optimizationSelectedProvider: selectedProvider,
                      optimizationSelectedModel: selectedModel,
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
                    }).catch(err => logger.error(`Failed to log cache HIT: ${err.message}`));

                    return res.status(200).json(parsedData);
                  } else {
                    req.cacheStatus = 'MISS';
                  }
                } else {
                  req.cacheRule = null;
                  req.cacheKey = null;
                  req.cacheStatus = 'BYPASS';
                }
              } catch (cacheErr) {
                logger.error(`Cache lookup failed during optimization routing: ${cacheErr.message}`);
              }
            }
          } else {
            logger.info(`Optimization recommendation computed (recommendation mode): recommended [${recProvider.toUpperCase()}] model [${recModel}], executing requested [${provider.toUpperCase()}]`);
          }
        }
      }
    } catch (err) {
      logger.error(`Optimization decision engine failed, falling back to default routing: ${err.message}`);
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

  // 2. Direct request routing with Auto-Retries
  let attempts = 0;
  const maxAttempts = 3;
  let apiResponse = null;
  let errorDetail = null;
  let requestSucceeded = false;

  while (attempts < maxAttempts && !requestSucceeded) {
    try {
      attempts++;
      apiResponse = await externalApiService.simulateApiCall(selectedProvider, routingEndpoint, method, req.body, headers, userId, provider);
      requestSucceeded = true;
    } catch (err) {
      errorDetail = err.message;
      logger.warn(`Gateway router attempt ${attempts}/${maxAttempts} failed for provider [${selectedProvider.toUpperCase()}] ${routingEndpoint}: ${errorDetail}`);
      
      // Do not retry deterministic schema or configuration errors, or explicit non-retryable errors
      if (err.shouldRetry === false || err.message.includes('CapabilityError') || err.message.includes('ConfigurationError') || err.message.includes('ValidationError')) {
        break;
      }

      if (attempts < maxAttempts) {
        const delay = Math.pow(2, attempts) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  const responseTimeMs = Date.now() - startTime;

  // 3. Request Success Handling
  if (requestSucceeded && apiResponse) {
    const { data, tokensUsed, model } = apiResponse;
    const resolvedModel = model || routingEndpoint.match(/\/models\/([^/:]+)/)?.[1] || null;
    const costUsd = calculateCost(selectedProvider, routingEndpoint, resolvedModel, tokensUsed);

    RequestLog.create({
      userId,
      apiKeyId,
      provider: selectedProvider,
      model: resolvedModel,
      endpoint: routingEndpoint,
      method,
      status: 200,
      responseTimeMs,
      costUsd,
      tokensUsed,
      cacheStatus: 'MISS',
      requestBody: JSON.stringify(req.body || {}),
      responseBody: JSON.stringify(data || {}),
      optimizationEnabled: req.optimization?.optimizationEnabled || false,
      optimizationUsed: req.optimization?.optimizationUsed || false,
      optimizationMode: req.optimization?.optimizationMode || null,
      optimizationSelectedProvider: req.optimization?.optimizationSelectedProvider || null,
      optimizationSelectedModel: req.optimization?.optimizationSelectedModel || null,
      requestedProvider: originalRequestedProvider,
      requestedModel: originalRequestedModel,
      recommendedProvider,
      recommendedModel,
      recommendationScore,
      costScore,
      latencyScore,
      reliabilityScore,
      actualProvider: selectedProvider,
      actualModel: resolvedModel,
      routedProvider: selectedProvider,
      inputProvider: originalRequestedProvider,
      inputModel: originalRequestedModel
    }).catch(err => logger.error(`Failed to create RequestLog in MongoDB: ${err.message}`));

    if (req.cacheKey && req.cacheRule) {
      try {
        const redis = getRedisClient();
        await redis.setEx(req.cacheKey, req.cacheRule.ttlSeconds, JSON.stringify(data));
        logger.debug(`Cached new entry in Redis: ${req.cacheKey} for ${req.cacheRule.ttlSeconds}s`);
        
        // Also save to L2 Semantic Cache
        const { saveSemanticCache } = require('../services/semanticCacheService');
        await saveSemanticCache(redis, userId, selectedProvider.toLowerCase(), routingEndpoint.toLowerCase(), req.body, data, req.cacheRule.ttlSeconds);
      } catch (err) {
        logger.error(`Failed to write cache entry to Redis: ${err.message}`);
      }
    }

    res.setHeader('X-OptiAPI-Cache', 'MISS');
    res.setHeader('X-OptiAPI-Cost', costUsd);
    res.setHeader('X-OptiAPI-Time', `${responseTimeMs}ms`);
    return res.status(200).json(data);
  }

  // 4. Request Failure Handling
  const failedCost = 0.0;
  
  RequestLog.create({
    userId,
    apiKeyId,
    provider: selectedProvider,
    endpoint: routingEndpoint,
    method,
    status: 502,
    responseTimeMs,
    costUsd: failedCost,
    cacheStatus: 'BYPASS',
    requestBody: JSON.stringify(req.body || {}),
    errorMessage: errorDetail || 'Gateway Routing Failed',
    optimizationEnabled: req.optimization?.optimizationEnabled || false,
    optimizationUsed: req.optimization?.optimizationUsed || false,
    optimizationMode: req.optimization?.optimizationMode || null,
    optimizationSelectedProvider: req.optimization?.optimizationSelectedProvider || null,
    optimizationSelectedModel: req.optimization?.optimizationSelectedModel || null,
    requestedProvider: originalRequestedProvider,
    requestedModel: originalRequestedModel,
    recommendedProvider,
    recommendedModel,
    recommendationScore,
    costScore,
    latencyScore,
    reliabilityScore,
    actualProvider: selectedProvider,
    actualModel: originalRequestedModel,
    routedProvider: selectedProvider,
    inputProvider: originalRequestedProvider,
    inputModel: originalRequestedModel
  }).catch(err => logger.error(`Failed to log error log in MongoDB: ${err.message}`));

  return res.status(502).json({
    success: false,
    error: 'Bad Gateway',
    message: `Gateway failed to route requests to external provider after ${maxAttempts} attempts. Detail: ${errorDetail}`
  });
};

module.exports = {
  handleGatewayRequest
};
