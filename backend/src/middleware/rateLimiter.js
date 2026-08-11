const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * API Gateway sliding window rate limiter backed by Redis/Mock cache.
 * Enforces key-specific requests-per-second limits.
 */
const gatewayRateLimiter = async (req, res, next) => {
  if (!req.gatewayKey) {
    return next();
  }

  const apiKeyString = req.gatewayKey.key;
  const rpsLimit = req.gatewayKey.rateLimitRps || 10;
  const redis = getRedisClient();

  // Bucket requests per second
  const currentTimestampSec = Math.floor(Date.now() / 1000);
  const cacheKey = `ratelimit:${apiKeyString}:${currentTimestampSec}`;

  // Atomic Lua script running inside Redis: increments key and sets TTL on first call
  const rateLimitScript = `
    local key = KEYS[1]
    local ttl = tonumber(ARGV[2])
    
    local current = redis.call('incr', key)
    if tonumber(current) == 1 then
      redis.call('expire', key, ttl)
    end
    return tonumber(current)
  `;

  try {
    const currentCount = await redis.eval(rateLimitScript, {
      keys: [cacheKey],
      arguments: [String(rpsLimit), '2']
    });

    if (currentCount > rpsLimit) {
      logger.warn(`Rate Limit Exceeded for Key: ${apiKeyString.substring(0, 10)}... [Active RPS: ${currentCount - 1}/${rpsLimit}]`);

      // Increment per-user violation counter in Redis so analytics can surface it.
      // Fire-and-forget: errors must never block or alter the 429 response.
      const userId = req.gatewayKey.userId;
      redis.incr(`rl_violations:${userId}`).catch((err) =>
        logger.error(`Failed to increment rate-limit violation counter: ${err.message}`)
      );

      return res.status(429).json({
        success: false,
        error: 'Rate limit violation - too many requests',
        limit: rpsLimit,
        retryAfterSeconds: 1
      });
    }

    next();
  } catch (error) {
    logger.error(`Rate Limiter execution failure: ${error.message}. Gateway passing through request.`);
    next();
  }
};

module.exports = {
  gatewayRateLimiter
};
