const CacheRule = require('../models/CacheRule');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');
const { deleteKeysByPattern } = require('../utils/redisUtils');

/**
 * Cache Rules management and cache purging.
 */

const getCacheRules = async (req, res) => {
  try {
    const rules = await CacheRule.find({ userId: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: rules.length, data: rules });
  } catch (error) {
    logger.error(`Get Cache Rules error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve cache rules' });
  }
};

const createCacheRule = async (req, res) => {
  const { provider, endpoint, ttlSeconds } = req.body;

  if (!provider || !endpoint || !ttlSeconds) {
    return res.status(400).json({ success: false, error: 'Please provide provider, endpoint, and TTL in seconds' });
  }

  // Normalize endpoint cleanly
  const formattedEndpoint = normalizeEndpoint(endpoint);

  try {
    // Check if rule already exists
    const ruleExists = await CacheRule.findOne({
      userId: req.user._id,
      provider: provider.toLowerCase(),
      endpoint: formattedEndpoint.toLowerCase()
    });

    if (ruleExists) {
      return res.status(400).json({ success: false, error: 'Cache rule already exists for this endpoint' });
    }

    const rule = await CacheRule.create({
      userId: req.user._id,
      provider: provider.toLowerCase(),
      endpoint: formattedEndpoint.toLowerCase(),
      ttlSeconds: parseInt(ttlSeconds, 10)
    });

    // Populate Redis cache for this rule
    const { setCachedRule, invalidateCachedRule } = require('../services/cacheRuleService');
    await setCachedRule(req.user._id, provider, formattedEndpoint, rule);

    logger.info(`Cache Rule created: [${provider}] ${formattedEndpoint} with TTL ${ttlSeconds}s`);
    return res.status(201).json({ success: true, data: rule });
  } catch (error) {
    logger.error(`Create Cache Rule error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to create cache rule' });
  }
};

const deleteCacheRule = async (req, res) => {
  try {
    const rule = await CacheRule.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!rule) {
      return res.status(404).json({ success: false, error: 'Cache rule not found' });
    }

    // Invalidate Redis cache rule entry
    const { invalidateCachedRule } = require('../services/cacheRuleService');
    await invalidateCachedRule(req.user._id, rule.provider, rule.endpoint);

    // Invalidate exact and semantic cached responses for this rule
    const redis = getRedisClient();
    const userIdString = req.user._id.toString();
    const normEndpoint = rule.endpoint.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    await deleteKeysByPattern(redis, `apicache:${userIdString}:${rule.provider.toLowerCase()}:${rule.endpoint.toLowerCase()}:*`, { batchSize: 100 });
    await deleteKeysByPattern(redis, `apicache_semantic:${userIdString}:${rule.provider.toLowerCase()}:${normEndpoint}:*`, { batchSize: 100 });

    logger.info(`Cache Rule deleted: ${req.params.id}`);
    return res.status(200).json({ success: true, data: {} });
  } catch (error) {
    logger.error(`Delete Cache Rule error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to delete cache rule' });
  }
};

/**
 * Manually flushes all API cache records (L1 exact and L2 semantic) for the logged-in user from Redis.
 * Uses non-blocking cursor-based SCAN to delete matching keys in batches.
 */
const clearUserCache = async (req, res) => {
  try {
    const redis = getRedisClient();
    const userIdString = req.user._id.toString();
    
    // Pattern to look for user's exact and semantic keys
    const matchPattern = `apicache:${userIdString}:*`;
    const semanticPattern = `apicache_semantic:${userIdString}:*`;
    
    // Non-blocking batch deletion using cursor-based SCAN
    const exactDeleted = await deleteKeysByPattern(redis, matchPattern, { batchSize: 100 });
    const semanticDeleted = await deleteKeysByPattern(redis, semanticPattern, { batchSize: 100 });
    const keysDeletedCount = exactDeleted + semanticDeleted;

    logger.info(`Manual Cache Flush triggered for User ${userIdString}. Cleaned ${keysDeletedCount} items (${exactDeleted} exact, ${semanticDeleted} semantic).`);
    return res.status(200).json({ success: true, message: `Successfully cleared ${keysDeletedCount} cache records.` });
  } catch (error) {
    logger.error(`Clear cache error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to purge cache records' });
  }
};

module.exports = {
  getCacheRules,
  createCacheRule,
  deleteCacheRule,
  clearUserCache
};
