const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const logger = require('../utils/logger');

/**
 * Middleware to protect routes via JWT validation (Dashboard / App traffic)
 */
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'optiapi_secret_key_for_jwt_tokens_2026_secure');
      
      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'User not found in system' });
      }
      next();
    } catch (error) {
      logger.error(`Authentication validation failed: ${error.message}`);
      return res.status(401).json({ success: false, error: 'Not authorized, token validation failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized, token missing' });
  }
};

/**
 * Middleware to restrict action to Administrator role only
 */
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ success: false, error: 'Forbidden, admin authorization required' });
  }
};
const { getRedisClient } = require('../config/redis');
const crypto = require('crypto');

const API_KEY_CACHE_TTL = 300; // 5 minutes TTL for validated keys

/**
 * Middleware to authenticate API Gateway client requests using client API key header
 */
const verifyGatewayKey = async (req, res, next) => {
  // Retrieve apiKey case-insensitively from req.headers or via req.header() helper
  let apiKey = req.header('x-api-key');

  if (!apiKey && req.headers) {
    const target = 'x-api-key';
    const match = Object.keys(req.headers).find(k => k.toLowerCase() === target);
    if (match) {
      apiKey = req.headers[match];
    }
  }

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Gateway access denied, x-api-key header missing' });
  }

  // Safe SHA-256 hash of API key for Redis cache key (never store plaintext key in Redis)
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const redisCacheKey = `apikey:${keyHash}`;

  let redis = null;
  try {
    redis = getRedisClient();
  } catch (err) {
    logger.warn(`Redis client unavailable in verifyGatewayKey: ${err.message}`);
  }

  let keyData = null;

  // 1. Check Redis cache first
  if (redis) {
    try {
      const cached = await redis.get(redisCacheKey);
      if (cached) {
        keyData = JSON.parse(cached);
      }
    } catch (redisErr) {
      logger.warn(`Redis API key cache lookup failed: ${redisErr.message}. Falling back to MongoDB.`);
    }
  }

  // 2. Cache miss: Query MongoDB
  if (!keyData) {
    try {
      const keyDoc = await ApiKey.findOne({ key: apiKey, isActive: true });
      if (!keyDoc) {
        return res.status(401).json({ success: false, error: 'Gateway access denied, invalid or inactive API key' });
      }

      keyData = {
        _id: keyDoc._id.toString(),
        userId: keyDoc.userId.toString(),
        name: keyDoc.name,
        rateLimitRps: keyDoc.rateLimitRps || 10,
        isActive: keyDoc.isActive
      };

      // Populate Redis cache with safe representation
      if (redis) {
        try {
          await redis.setEx(redisCacheKey, API_KEY_CACHE_TTL, JSON.stringify(keyData));
        } catch (cacheSetErr) {
          logger.warn(`Failed to cache API key in Redis: ${cacheSetErr.message}`);
        }
      }
    } catch (error) {
      logger.error(`Gateway authentication MongoDB error: ${error.message}`);
      return res.status(500).json({ success: false, error: 'Internal gateway authentication error' });
    }
  }

  // 3. Attach details to request for downstream middleware (rate limiter, cache, gateway controller)
  req.gatewayKey = {
    _id: keyData._id,
    userId: keyData.userId,
    name: keyData.name,
    key: apiKey,
    rateLimitRps: keyData.rateLimitRps || 10
  };
  req.userId = keyData.userId;

  // 4. Atomically increment usage counter in Redis (fire-and-forget, no synchronous MongoDB write)
  if (redis) {
    try {
      redis.incr(`apikey:usage:${keyData._id}`).catch(incrErr => {
        logger.warn(`Failed to increment API key usage counter in Redis: ${incrErr.message}`);
      });
    } catch (incrSyncErr) {
      // Non-blocking
    }
  }

  next();
};

module.exports = {
  protect,
  admin,
  verifyGatewayKey
};
