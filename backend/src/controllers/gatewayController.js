const { simulateApiCall } = require('../services/externalApiService');
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

  // Optimization logic integration
  const optimizationEnabled = process.env.OPTIMIZATION_ENABLED === 'true';
  let selectedProvider = provider;
  let selectedModel = null;
  let routingEndpoint = endpoint;
  let optimizationUsed = false;
  
  req.query = req.query || {};
  req.headers = req.headers || {};
  const mode = req.query.mode || req.headers['x-optiapi-mode'] || 'balanced';

  if (optimizationEnabled && (provider === 'openai' || provider === 'gemini')) {
    try {
      const { getOptimizationDecision } = require('../services/optimizationDecisionService');
      const decisionResult = await getOptimizationDecision(userId, mode, [provider]);
      if (decisionResult && decisionResult.success && decisionResult.decision) {
        const { provider: recProvider, model: recModel } = decisionResult.decision;
        if (recProvider === provider && recModel) {
          selectedModel = recModel;
          optimizationUsed = true;
          
          if (provider === 'openai') {
            req.body = req.body || {};
            req.body.model = selectedModel;
          } else if (provider === 'gemini') {
            routingEndpoint = endpoint.replace(/\/models\/([^/:]+)/, `/models/${selectedModel}`);
          }
          logger.info(`Optimization active: routed request to model [${selectedModel}] for provider [${provider.toUpperCase()}]`);
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
    optimizationUsed
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
      timestamp: Date.now()
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
      apiResponse = await simulateApiCall(selectedProvider, routingEndpoint, method, req.body, headers, userId);
      requestSucceeded = true;
    } catch (err) {
      errorDetail = err.message;
      logger.warn(`Gateway router attempt ${attempts}/${maxAttempts} failed for provider [${selectedProvider.toUpperCase()}] ${routingEndpoint}: ${errorDetail}`);
      
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
      responseBody: JSON.stringify(data || {})
    }).catch(err => logger.error(`Failed to create RequestLog in MongoDB: ${err.message}`));

    if (req.cacheKey && req.cacheRule) {
      try {
        const redis = getRedisClient();
        await redis.setEx(req.cacheKey, req.cacheRule.ttlSeconds, JSON.stringify(data));
        logger.debug(`Cached new entry in Redis: ${req.cacheKey} for ${req.cacheRule.ttlSeconds}s`);
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
    errorMessage: errorDetail || 'Gateway Routing Failed'
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
