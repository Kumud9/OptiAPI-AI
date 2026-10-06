const crypto = require('crypto');
const CacheRule = require('../models/CacheRule');
const RequestLog = require('../models/RequestLog');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');
const metricsService = require('../services/metricsService');

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
    // 1. Fetch routing policy to check cacheEnabled and semanticCacheEnabled settings
    const { getRoutingPolicy } = require('../services/policyService');
    let routingPolicy = null;
    try {
      routingPolicy = await getRoutingPolicy(userId);
    } catch (policyErr) {
      logger.debug(`Cache middleware: failed to read policy: ${policyErr.message}`);
    }

    if (routingPolicy && routingPolicy.cacheEnabled === false) {
      req.cacheStatus = 'BYPASS';
      return next();
    }

    // 2. Fetch matching cache configuration (checks Redis first, falls back to MongoDB)
    const { getCachedRule } = require('../services/cacheRuleService');
    const rule = await getCachedRule(userId, provider, endpoint);

    if (!rule) {
      req.cacheStatus = 'BYPASS';
      return next();
    }

    req.cacheRule = rule;

    // 3. Hash request payloads to create a unique identifier
    const bodyStr = JSON.stringify(req.body || {});
    const queryStr = JSON.stringify(req.query || {});
    const requestHash = crypto.createHash('sha256')
      .update(bodyStr + queryStr)
      .digest('hex');

    const cacheKey = `apicache:${userId}:${provider.toLowerCase()}:${endpoint.toLowerCase()}:${requestHash}`;
    req.cacheKey = cacheKey;

    // 4. Query L1 Redis Exact Cache
    const redis = getRedisClient();
    const cachedResponse = await redis.get(cacheKey);

    if (cachedResponse) {
      logger.info(`Cache HIT on gateway: [${provider.toUpperCase()}] ${endpoint.toLowerCase()}`);
      req.cacheStatus = 'HIT';
      metricsService.recordRequest();
      metricsService.recordCacheHit();
      metricsService.recordLatency(2);
      
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
        responseBody: cachedResponse,
        requestedProvider: provider,
        requestedModel: req.body ? req.body.model : null,
        recommendedProvider: provider,
        recommendedModel: req.body ? req.body.model : null,
        actualProvider: provider,
        actualModel: req.body ? req.body.model : null,
        routedProvider: provider
      }).catch(err => logger.error(`Failed to log cache HIT: ${err.message}`));

      // Return immediately
      return res.status(200).json(parsedData);
    }

    // 5. Query L2 Semantic Cache (if enabled by policy and environment)
    const semanticEnabled = (routingPolicy?.semanticCacheEnabled !== false) && (process.env.SEMANTIC_CACHE_ENABLED !== 'false');

    if (semanticEnabled) {
      const { searchSemanticCache, ensureIndex } = require('../services/semanticCacheService');
      await ensureIndex(redis);

      const threshold = (typeof routingPolicy?.semanticCacheThreshold === 'number')
        ? routingPolicy.semanticCacheThreshold
        : (parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD) || 0.90);

      const semanticStartTime = Date.now();
      const semanticResponse = await searchSemanticCache(redis, userId, provider.toLowerCase(), endpoint.toLowerCase(), req.body, threshold, { req });
      const lookupMs = Date.now() - semanticStartTime;
      metricsService.recordSemanticCacheLookupLatency(lookupMs);

      if (semanticResponse) {
        logger.info(`Semantic Cache HIT on gateway: [${provider.toUpperCase()}] ${endpoint.toLowerCase()}`);
        req.cacheStatus = 'SEMANTIC_HIT';
        metricsService.recordRequest();
        metricsService.recordCacheHit();
        metricsService.recordSemanticCacheHit();
        metricsService.recordLatency(lookupMs > 0 ? lookupMs : 3);

        res.setHeader('X-OptiAPI-Cache', 'SEMANTIC_HIT');
        res.setHeader('X-OptiAPI-TTL', rule.ttlSeconds);

        // Async write Cache HIT request log to DB
        RequestLog.create({
          userId,
          apiKeyId: req.gatewayKey ? req.gatewayKey._id : null,
          provider,
          endpoint,
          method: req.method,
          status: 200,
          responseTimeMs: lookupMs > 0 ? lookupMs : 3,
          costUsd: 0.0,
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          cacheStatus: 'SEMANTIC_HIT',
          requestBody: JSON.stringify(req.body || {}),
          responseBody: JSON.stringify(semanticResponse),
          requestedProvider: provider,
          requestedModel: req.body ? req.body.model : null,
          recommendedProvider: provider,
          recommendedModel: req.body ? req.body.model : null,
          actualProvider: provider,
          actualModel: req.body ? req.body.model : null,
          routedProvider: provider
        }).catch(err => logger.error(`Failed to log semantic cache HIT: ${err.message}`));

        // Return immediately
        return res.status(200).json(semanticResponse);
      } else {
        metricsService.recordSemanticCacheMiss();
      }
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
