const crypto = require('crypto');
const CacheRule = require('../models/CacheRule');
const RequestLog = require('../models/RequestLog');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');

/**
 * Cache middleware checks if a request matches active cache rules.
 * If yes, searches Redis for the hashed request signature and intercepts on HIT.
 */
const gatewayCache = async (req, res, next) => {
  const { provider } = req.params;
  const endpoint = normalizeEndpoint(req.params[0]);
  const userId = req.userId;

  if (!userId || !provider) {
    req.cacheStatus = 'BYPASS';
    return next();
  }

  try {
    // 1. Fetch matching cache configuration
    const rule = await CacheRule.findOne({
      userId,
      provider: provider.toLowerCase(),
      endpoint: endpoint.toLowerCase(),
      isActive: true
    });

    if (!rule) {
      req.cacheStatus = 'BYPASS';
      return next();
    }

    req.cacheRule = rule;

    // 2. Hash request payloads to create a unique identifier
    const bodyStr = JSON.stringify(req.body || {});
    const queryStr = JSON.stringify(req.query || {});
    const requestHash = crypto.createHash('sha256')
      .update(bodyStr + queryStr)
      .digest('hex');

    const cacheKey = `apicache:${userId}:${provider}:${endpoint}:${requestHash}`;
    req.cacheKey = cacheKey;

    // 3. Query Redis Cache
    const redis = getRedisClient();
    const cachedResponse = await redis.get(cacheKey);

    if (cachedResponse) {
      logger.info(`Cache HIT on gateway: [${provider.toUpperCase()}] ${endpoint}`);
      req.cacheStatus = 'HIT';
      
      const parsedData = JSON.parse(cachedResponse);
      
      // Inject cache intelligence headers for visibility
      res.setHeader('X-OptiAPI-Cache', 'HIT');
      res.setHeader('X-OptiAPI-TTL', rule.ttlSeconds);

      // Async write Cache HIT request log to DB
      RequestLog.create({
        userId,
        apiKeyId: req.gatewayKey ? req.gatewayKey._id : null,
        provider,
        endpoint,
        method: req.method,
        status: 200,
        responseTimeMs: 2, // Fast cache response time
        costUsd: 0.0, // Cache hits cost 0
        tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        cacheStatus: 'HIT',
        requestBody: JSON.stringify(req.body || {}),
        responseBody: cachedResponse
      }).catch(err => logger.error(`Failed to log cache HIT: ${err.message}`));

      // Return immediately
      return res.status(200).json(parsedData);
    }

    logger.debug(`Cache MISS on gateway: [${provider.toUpperCase()}] ${endpoint}`);
    req.cacheStatus = 'MISS';
    next();
  } catch (error) {
    logger.error(`Cache middleware handling error: ${error.message}`);
    req.cacheStatus = 'BYPASS';
    next();
  }
};

module.exports = {
  gatewayCache
};
