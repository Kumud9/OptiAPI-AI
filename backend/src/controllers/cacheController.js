const CacheRule = require('../models/CacheRule');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');

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
    logger.info(`Cache Rule deleted: ${req.params.id}`);
    return res.status(200).json({ success: true, data: {} });
  } catch (error) {
    logger.error(`Delete Cache Rule error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to delete cache rule' });
  }
};

/**
 * Manually flushes all API cache records for the logged-in user from Redis.
 */
const clearUserCache = async (req, res) => {
  try {
    const redis = getRedisClient();
    const userIdString = req.user._id.toString();
    
    // Pattern to look for user's keys
    const matchPattern = `apicache:${userIdString}:*`;
    
    // In our MockRedisClient, we can iterate key-value store, or if actual Redis, scan keys
    let keysDeletedCount = 0;
    
    if (typeof redis.keys === 'function') {
      // Mock client supports direct parsing or scans
      const keys = await redis.keys(matchPattern);
      if (keys && keys.length > 0) {
        for (const k of keys) {
          await redis.del(k);
        }
        keysDeletedCount = keys.length;
      }
    } else {
      // Standard redis client v4 doesn't support 'keys' directly without multi-scan, but let's delete using keys or store iterator
      if (redis.store) {
        // Fallback for MockRedisClient
        for (const k of redis.store.keys()) {
          if (k.startsWith(`apicache:${userIdString}:`)) {
            redis.store.delete(k);
            keysDeletedCount++;
          }
        }
      } else {
        // For production redis client, scan keys
        const keys = await redis.keys(matchPattern);
        if (keys && keys.length > 0) {
          await redis.del(keys);
          keysDeletedCount = keys.length;
        }
      }
    }

    logger.info(`Manual Cache Flush triggered for User ${userIdString}. Cleaned ${keysDeletedCount} items.`);
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
