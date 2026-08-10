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

  // 1. Heavy Traffic Queueing simulation trigger
  // Triggered when client appends ?queue=true query parameter, simulates async deferral
  if (req.query.queue === 'true' || headers['x-optiapi-queue'] === 'true') {
    const queuePayload = {
      userId,
      apiKeyId,
      provider,
      endpoint,
      method,
      body,
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
      apiResponse = await simulateApiCall(provider, endpoint, method, body, headers, userId);
      requestSucceeded = true;
    } catch (err) {
      errorDetail = err.message;
      logger.warn(`Gateway router attempt ${attempts}/${maxAttempts} failed for provider [${provider.toUpperCase()}] ${endpoint}: ${errorDetail}`);
      
      if (attempts < maxAttempts) {
        // Backoff delay: 200ms, 400ms
        const delay = Math.pow(2, attempts) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  const responseTimeMs = Date.now() - startTime;

  // 3. Request Success Handling
  if (requestSucceeded && apiResponse) {
    const { data, tokensUsed, model } = apiResponse;
    const costUsd = calculateCost(provider, endpoint, model, tokensUsed);

    // Save success logs to MongoDB asynchronously to minimize response lag
    RequestLog.create({
      userId,
      apiKeyId,
      provider,
      endpoint,
      method,
      status: 200,
      responseTimeMs,
      costUsd,
      tokensUsed,
      cacheStatus: 'MISS', // Checked by cache middleware before reaching here
      requestBody: JSON.stringify(body || {}),
      responseBody: JSON.stringify(data || {})
    }).catch(err => logger.error(`Failed to create RequestLog in MongoDB: ${err.message}`));

    // Write to Redis cache if cache configuration matched
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
    provider,
    endpoint,
    method,
    status: 502,
    responseTimeMs,
    costUsd: failedCost,
    cacheStatus: 'BYPASS',
    requestBody: JSON.stringify(body || {}),
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
