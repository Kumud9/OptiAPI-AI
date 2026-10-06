'use strict';

const { getRedisClient } = require('../config/redis');
const CacheRule = require('../models/CacheRule');
const logger = require('../utils/logger');
const { normalizeEndpoint } = require('../utils/pathNormalizer');

const RULE_CACHE_PREFIX = 'cacherule:';
const RULE_CACHE_TTL = 3600; // 1 hour for active rules
const NEGATIVE_CACHE_TTL = 300; // 5 minutes for non-existent rules

/**
 * Generates the Redis key for a user's cache rule.
 * @param {string} userId
 * @param {string} provider
 * @param {string} endpoint
 * @returns {string}
 */
function getRuleCacheKey(userId, provider, endpoint) {
  const normEndpoint = normalizeEndpoint(endpoint).toLowerCase();
  return `${RULE_CACHE_PREFIX}${userId}:${provider.toLowerCase()}:${normEndpoint}`;
}

/**
 * Retrieves a CacheRule for a given user, provider, and endpoint.
 * Checks Redis first. On miss, falls back to MongoDB and populates Redis.
 * If Redis is unavailable, transparently queries MongoDB.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} provider
 * @param {string} endpoint
 * @returns {Promise<object|null>}
 */
async function getCachedRule(userId, provider, endpoint) {
  if (!userId || !provider || !endpoint) return null;

  const key = getRuleCacheKey(userId, provider, endpoint);
  const normEndpoint = normalizeEndpoint(endpoint).toLowerCase();
  const normProvider = provider.toLowerCase();

  let redis = null;
  try {
    redis = getRedisClient();
  } catch (err) {
    logger.warn(`Redis unavailable for CacheRule lookup: ${err.message}`);
  }

  // 1. Try reading from Redis
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached !== null && cached !== undefined) {
        if (cached === 'NONE') {
          return null;
        }
        return JSON.parse(cached);
      }
    } catch (redisErr) {
      logger.warn(`Redis CacheRule get error (${key}): ${redisErr.message}. Falling back to MongoDB.`);
    }
  }

  // 2. Cache miss: Query MongoDB
  try {
    const query = CacheRule.findOne({
      userId,
      provider: normProvider,
      endpoint: normEndpoint,
      isActive: true
    });
    const rule = (query && typeof query.lean === 'function') ? await query.lean() : await query;

    // 3. Populate Redis
    if (redis) {
      try {
        if (rule) {
          await redis.setEx(key, RULE_CACHE_TTL, JSON.stringify(rule));
        } else {
          await redis.setEx(key, NEGATIVE_CACHE_TTL, 'NONE');
        }
      } catch (cacheSetErr) {
        logger.warn(`Failed to cache CacheRule in Redis (${key}): ${cacheSetErr.message}`);
      }
    }

    return rule || null;
  } catch (dbErr) {
    logger.error(`MongoDB CacheRule lookup error: ${dbErr.message}`);
    return null;
  }
}

/**
 * Updates or sets a cached CacheRule in Redis.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} provider
 * @param {string} endpoint
 * @param {object} rule
 * @returns {Promise<boolean>}
 */
async function setCachedRule(userId, provider, endpoint, rule) {
  if (!userId || !provider || !endpoint) return false;

  try {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = getRuleCacheKey(userId, provider, endpoint);
    await redis.setEx(key, RULE_CACHE_TTL, JSON.stringify(rule));
    return true;
  } catch (err) {
    logger.warn(`Failed to set CacheRule in Redis: ${err.message}`);
    return false;
  }
}

/**
 * Invalidates a cached CacheRule in Redis.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} provider
 * @param {string} endpoint
 * @returns {Promise<boolean>}
 */
async function invalidateCachedRule(userId, provider, endpoint) {
  if (!userId || !provider || !endpoint) return false;

  try {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = getRuleCacheKey(userId, provider, endpoint);
    await redis.del(key);
    return true;
  } catch (err) {
    logger.warn(`Failed to invalidate CacheRule in Redis: ${err.message}`);
    return false;
  }
}

module.exports = {
  getCachedRule,
  setCachedRule,
  invalidateCachedRule,
  getRuleCacheKey
};
