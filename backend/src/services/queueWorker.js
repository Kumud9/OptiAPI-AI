const crypto = require('crypto');
const { startWorker } = require('./queueService');
const { simulateApiCall } = require('./externalApiService');
const { calculateCost } = require('./costCalculator');
const { getRedisClient } = require('../config/redis');
const RequestLog = require('../models/RequestLog');
const CacheRule = require('../models/CacheRule');
const logger = require('../utils/logger');

/**
 * Initializes the background subscriber worker for delayed / queued gateway traffic.
 */
const initQueueWorker = async () => {
  logger.info('Initializing background gateway queue worker...');

  await startWorker('gateway_requests', async (payload) => {
    const { userId, apiKeyId, provider, endpoint, method, body, timestamp } = payload;
    logger.info(`Queue Worker: Processing async request for User [${userId}] -> [${provider.toUpperCase()}] ${endpoint}`);

    let attempts = 0;
    const maxAttempts = 3;
    let apiResponse = null;
    let errorDetail = null;
    let requestSucceeded = false;

    // Retry loop in the background thread
    while (attempts < maxAttempts && !requestSucceeded) {
      try {
        attempts++;
        apiResponse = await simulateApiCall(provider, endpoint, method, body, {});
        requestSucceeded = true;
      } catch (err) {
        errorDetail = err.message;
        if (attempts < maxAttempts) {
          const delay = Math.pow(2, attempts) * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const responseTimeMs = Date.now() - timestamp;

    if (requestSucceeded && apiResponse) {
      const { data, tokensUsed, model } = apiResponse;
      const costUsd = calculateCost(provider, endpoint, model, tokensUsed);

      // 1. Log request to MongoDB
      await RequestLog.create({
        userId,
        apiKeyId,
        provider,
        endpoint,
        method,
        status: 200,
        responseTimeMs,
        costUsd,
        tokensUsed,
        cacheStatus: 'MISS',
        requestBody: JSON.stringify(body || {}),
        responseBody: JSON.stringify(data || {})
      });

      // 2. Fetch and write Cache rules if defined
      const rule = await CacheRule.findOne({
        userId,
        provider: provider.toLowerCase(),
        endpoint: endpoint.toLowerCase(),
        isActive: true
      });

      if (rule) {
        const requestHash = crypto.createHash('sha256')
          .update(JSON.stringify(body || {}))
          .digest('hex');

        const cacheKey = `apicache:${userId}:${provider}:${endpoint}:${requestHash}`;
        const redis = getRedisClient();
        await redis.setEx(cacheKey, rule.ttlSeconds, JSON.stringify(data));
      }

      logger.info(`Queue Worker: Async request executed successfully for User [${userId}] in ${responseTimeMs}ms. Cost: $${costUsd}`);
    } else {
      // Log failure in background
      await RequestLog.create({
        userId,
        apiKeyId,
        provider,
        endpoint,
        method,
        status: 502,
        responseTimeMs,
        costUsd: 0.0,
        cacheStatus: 'BYPASS',
        requestBody: JSON.stringify(body || {}),
        errorMessage: errorDetail || 'Background Gateway Queue Routing Failed'
      });
      logger.warn(`Queue Worker: Background task execution failed for User [${userId}] after ${maxAttempts} attempts.`);
    }
  });
};

module.exports = {
  initQueueWorker
};
