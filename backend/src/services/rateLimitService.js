'use strict';

const crypto = require('crypto');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');

const DEFAULT_RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS, 10) || 100;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS, 10) || 60;
const DEFAULT_RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const RATE_LIMIT_FAIL_CLOSED = process.env.RATE_LIMIT_FAIL_CLOSED === 'true';

// Lua script for atomic check-and-increment with TTL
const ATOMIC_RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])

  local current = tonumber(redis.call('get', key) or "0")
  if current >= limit then
    local ttlRemaining = redis.call('ttl', key)
    if ttlRemaining < 0 then
      ttlRemaining = ttl
      redis.call('expire', key, ttl)
    end
    return { 0, current, ttlRemaining }
  end

  current = redis.call('incr', key)
  if current == 1 then
    redis.call('expire', key, ttl)
  end
  local ttlRemaining = redis.call('ttl', key)
  if ttlRemaining < 0 then
    ttlRemaining = ttl
    redis.call('expire', key, ttl)
  end
  return { 1, current, ttlRemaining }
`;

/**
 * Creates a sanitized, non-reversible client identifier hash.
 * Never stores or exposes raw API keys, secrets, or authorization tokens.
 *
 * @param {string} rawId
 * @returns {string}
 */
function sanitizeClientIdentifier(rawId) {
  if (!rawId) return 'anonymous';
  const str = String(rawId).trim();
  // If it's already an ObjectId or UUID-like safe string, return safe prefix
  if (/^[a-fA-F0-9]{24}$/.test(str)) {
    return str;
  }
  // Hash sensitive tokens/keys
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Atomic Redis-backed rate limiter for clients / API keys.
 *
 * @param {string} clientId - Client identifier, user ID, or hashed API key
 * @param {object} [options={}] - Rate limit configuration
 * @returns {Promise<{ allowed: boolean, limit: number, remaining: number, reset: number, resetSeconds: number, retryAfter: number, degraded?: boolean }>}
 */
async function checkClientRateLimit(clientId, options = {}) {
  const opts = options || {};
  const enabled = opts.enabled !== undefined ? Boolean(opts.enabled) : DEFAULT_RATE_LIMIT_ENABLED;

  const requests = Number.isInteger(opts.requests) && opts.requests > 0
    ? opts.requests
    : DEFAULT_RATE_LIMIT_REQUESTS;

  const windowSeconds = Number.isInteger(opts.windowSeconds) && opts.windowSeconds > 0
    ? opts.windowSeconds
    : DEFAULT_RATE_LIMIT_WINDOW_SECONDS;

  const now = Date.now();

  // If rate limiting is disabled
  if (!enabled) {
    return {
      allowed: true,
      limit: requests,
      remaining: requests,
      current: 0,
      reset: now + windowSeconds * 1000,
      resetSeconds: windowSeconds,
      retryAfter: 0
    };
  }

  const safeId = sanitizeClientIdentifier(clientId);
  const windowId = Math.floor(now / (windowSeconds * 1000));
  const cacheKey = `rl:client:${safeId}:${windowSeconds}:${windowId}`;
  const ttl = windowSeconds;

  const windowEndMs = (windowId + 1) * windowSeconds * 1000;
  const windowRemainingSec = Math.max(1, Math.ceil((windowEndMs - now) / 1000));

  try {
    const redis = getRedisClient();
    const result = await redis.eval(ATOMIC_RATE_LIMIT_SCRIPT, {
      keys: [cacheKey],
      arguments: [String(requests), String(ttl)]
    });

    const isAllowed = Array.isArray(result) ? result[0] === 1 : Boolean(result);
    const current = Array.isArray(result) ? Number(result[1]) : 1;
    const ttlRemaining = Array.isArray(result) && Number(result[2]) > 0
      ? Math.min(Number(result[2]), windowRemainingSec)
      : windowRemainingSec;

    const remaining = isAllowed ? Math.max(0, requests - current) : 0;
    const resetTime = windowEndMs;

    if (!isAllowed) {
      logger.warn(`Rate limit exceeded for client [${safeId}]: ${current}/${requests} in ${windowSeconds}s window.`);
      metricsService.recordRateLimitRejection();
      return {
        allowed: false,
        limit: requests,
        remaining: 0,
        current,
        reset: resetTime,
        resetSeconds: ttlRemaining,
        retryAfter: ttlRemaining
      };
    }

    metricsService.recordRateLimitHit();
    return {
      allowed: true,
      limit: requests,
      remaining,
      current,
      reset: resetTime,
      resetSeconds: ttlRemaining,
      retryAfter: 0
    };
  } catch (err) {
    logger.warn(`Rate limiter degraded: Redis error [${err.message}]. Failing ${RATE_LIMIT_FAIL_CLOSED ? 'closed' : 'open'}.`);

    if (RATE_LIMIT_FAIL_CLOSED) {
      metricsService.recordRateLimitRejection();
      return {
        allowed: false,
        limit: requests,
        remaining: 0,
        current: requests,
        reset: now + windowSeconds * 1000,
        resetSeconds: windowSeconds,
        retryAfter: windowSeconds,
        degraded: true
      };
    }

    // Default fail-open behavior: allow legitimate requests to proceed during temporary cache blips
    metricsService.recordRateLimitHit();
    return {
      allowed: true,
      limit: requests,
      remaining: Math.max(0, requests - 1),
      current: 1,
      reset: now + windowSeconds * 1000,
      resetSeconds: windowSeconds,
      retryAfter: 0,
      degraded: true
    };
  }
}

/**
 * Atomic Redis-backed quota protection for external AI providers.
 *
 * @param {string} userId - User ID or 'global'
 * @param {string} provider - Provider name (openai, gemini, anthropic)
 * @param {object} [options=null] - Quota configuration { requests, windowSeconds }
 * @returns {Promise<{ allowed: boolean, limit: number, remaining: number, resetSeconds: number, degraded?: boolean }>}
 */
async function checkProviderQuota(userId, provider, options = null) {
  metricsService.recordProviderQuotaCheck(provider);

  // If no quota limits configured for this provider, quota is unlimited
  if (!options || typeof options !== 'object') {
    return {
      allowed: true,
      limit: Infinity,
      remaining: Infinity,
      current: 0,
      resetSeconds: 0
    };
  }

  const requests = Number.isInteger(options.requests) && options.requests > 0
    ? options.requests
    : 1000;

  const windowSeconds = Number.isInteger(options.windowSeconds) && options.windowSeconds > 0
    ? options.windowSeconds
    : 60;

  const now = Date.now();
  const safeScope = userId ? sanitizeClientIdentifier(userId) : 'global';
  const prov = (provider || 'openai').toLowerCase().trim();
  const windowId = Math.floor(now / (windowSeconds * 1000));
  const cacheKey = `rl:quota:${safeScope}:${prov}:${windowSeconds}:${windowId}`;
  const ttl = windowSeconds;

  const windowEndMs = (windowId + 1) * windowSeconds * 1000;
  const windowRemainingSec = Math.max(1, Math.ceil((windowEndMs - now) / 1000));

  try {
    const redis = getRedisClient();
    const result = await redis.eval(ATOMIC_RATE_LIMIT_SCRIPT, {
      keys: [cacheKey],
      arguments: [String(requests), String(ttl)]
    });

    const isAllowed = Array.isArray(result) ? result[0] === 1 : Boolean(result);
    const current = Array.isArray(result) ? Number(result[1]) : 1;
    const ttlRemaining = Array.isArray(result) && Number(result[2]) > 0
      ? Math.min(Number(result[2]), windowRemainingSec)
      : windowRemainingSec;

    const remaining = isAllowed ? Math.max(0, requests - current) : 0;

    if (!isAllowed) {
      logger.warn(`Provider quota exhausted for [${prov.toUpperCase()}] user [${safeScope}]: ${current}/${requests} in ${windowSeconds}s.`);
      metricsService.recordProviderQuotaRejection(prov);
      return {
        allowed: false,
        provider: prov,
        limit: requests,
        remaining: 0,
        current,
        resetSeconds: ttlRemaining
      };
    }

    return {
      allowed: true,
      provider: prov,
      limit: requests,
      remaining,
      current,
      resetSeconds: ttlRemaining
    };
  } catch (err) {
    logger.warn(`Provider quota checker degraded: Redis error [${err.message}]. Failing ${RATE_LIMIT_FAIL_CLOSED ? 'closed' : 'open'}.`);

    if (RATE_LIMIT_FAIL_CLOSED) {
      metricsService.recordProviderQuotaRejection(prov);
      return {
        allowed: false,
        provider: prov,
        limit: requests,
        remaining: 0,
        current: requests,
        resetSeconds: windowSeconds,
        degraded: true
      };
    }

    return {
      allowed: true,
      provider: prov,
      limit: requests,
      remaining: Math.max(0, requests - 1),
      current: 1,
      resetSeconds: windowSeconds,
      degraded: true
    };
  }
}

/**
 * Resets all rate limit and quota keys matching a prefix or pattern.
 * Uses cursor-based SCAN to delete safely without blocking Redis.
 *
 * @param {string} [pattern='rl:*']
 * @returns {Promise<number>} Number of keys deleted
 */
async function resetRateLimits(pattern = 'rl:*') {
  try {
    const redis = getRedisClient();
    const { deleteKeysByPattern } = require('../utils/redisUtils');
    return await deleteKeysByPattern(redis, pattern);
  } catch (err) {
    logger.warn(`Failed to reset rate limits: ${err.message}`);
    return 0;
  }
}

module.exports = {
  checkClientRateLimit,
  checkProviderQuota,
  resetRateLimits,
  sanitizeClientIdentifier,
  DEFAULT_RATE_LIMIT_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_RATE_LIMIT_ENABLED
};
