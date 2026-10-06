'use strict';

const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');

const POLICY_KEY_PREFIX = 'opti:policy:';
const SUPPORTED_PROVIDERS = ['openai', 'gemini', 'anthropic'];
const SUPPORTED_STRATEGIES = ['balanced', 'cost', 'latency', 'reliability'];

const SUPPORTED_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro', 'gemini-pro'],
  anthropic: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku', 'claude-3-sonnet']
};

/**
 * Returns the Redis key for a user's routing policy.
 * @param {string} userId
 * @returns {string}
 */
function getPolicyKey(userId) {
  return `${POLICY_KEY_PREFIX}${userId}`;
}

/**
 * Validates and sanitizes a policy object.
 * @param {object} policy
 * @returns {object|null} Sanitized policy or null if invalid
 */
function validatePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return null;
  }

  const sanitized = {};

  // Provider validation
  if (policy.provider) {
    const prov = String(policy.provider).toLowerCase().trim();
    if (!SUPPORTED_PROVIDERS.includes(prov)) {
      logger.warn(`Policy validation: unsupported provider '${policy.provider}'`);
      return null;
    }
    sanitized.provider = prov;
  }

  // Model validation
  if (policy.model !== undefined && policy.model !== null) {
    sanitized.model = String(policy.model).trim();
  }

  // Strategy validation
  if (policy.strategy) {
    const strat = String(policy.strategy).toLowerCase().trim();
    sanitized.strategy = SUPPORTED_STRATEGIES.includes(strat) ? strat : 'balanced';
  } else {
    sanitized.strategy = 'balanced';
  }

  // Cache configuration
  sanitized.cacheEnabled = policy.cacheEnabled !== undefined ? Boolean(policy.cacheEnabled) : true;
  sanitized.semanticCacheEnabled = policy.semanticCacheEnabled !== undefined ? Boolean(policy.semanticCacheEnabled) : true;
  sanitized.semanticCacheThreshold = (typeof policy.semanticCacheThreshold === 'number' && !isNaN(policy.semanticCacheThreshold) && policy.semanticCacheThreshold >= 0.50 && policy.semanticCacheThreshold <= 0.99)
    ? Number(policy.semanticCacheThreshold.toFixed(2))
    : 0.90;
  sanitized.cacheTTL = Number.isInteger(policy.cacheTTL) && policy.cacheTTL > 0 ? policy.cacheTTL : 300;

  // Timeout and retry configuration
  sanitized.timeoutMs = Number.isInteger(policy.timeoutMs) && policy.timeoutMs > 0 ? policy.timeoutMs : 15000;
  sanitized.maxRetries = Number.isInteger(policy.maxRetries) && policy.maxRetries >= 0 ? policy.maxRetries : 2;

  // Failover configuration
  sanitized.failover = policy.failover !== undefined ? Boolean(policy.failover) : true;
  if (Array.isArray(policy.fallbackProviders)) {
    sanitized.fallbackProviders = policy.fallbackProviders
      .map(p => String(p).toLowerCase().trim())
      .filter(p => SUPPORTED_PROVIDERS.includes(p));
  }

  // Rate limiting configuration (Phase 3C)
  if (policy.rateLimit !== undefined) {
    if (policy.rateLimit && typeof policy.rateLimit === 'object' && !Array.isArray(policy.rateLimit)) {
      const rl = policy.rateLimit;
      sanitized.rateLimit = {
        enabled: rl.enabled !== undefined ? Boolean(rl.enabled) : true,
        requests: Number.isInteger(rl.requests) && rl.requests > 0 ? rl.requests : 100,
        windowSeconds: Number.isInteger(rl.windowSeconds) && rl.windowSeconds > 0 ? rl.windowSeconds : 60
      };
    } else {
      sanitized.rateLimit = {
        enabled: false,
        requests: 100,
        windowSeconds: 60
      };
    }
  }

  // Provider-level limits / quota configuration (Phase 3C)
  if (policy.providerLimits && typeof policy.providerLimits === 'object' && !Array.isArray(policy.providerLimits)) {
    sanitized.providerLimits = {};
    for (const [p, lim] of Object.entries(policy.providerLimits)) {
      const pLower = String(p).toLowerCase().trim();
      if (SUPPORTED_PROVIDERS.includes(pLower) && lim && typeof lim === 'object' && !Array.isArray(lim)) {
        sanitized.providerLimits[pLower] = {
          requests: Number.isInteger(lim.requests) && lim.requests > 0 ? lim.requests : 1000,
          windowSeconds: Number.isInteger(lim.windowSeconds) && lim.windowSeconds > 0 ? lim.windowSeconds : 60
        };
      }
    }
  }

  // AI policy metadata
  if (policy.policyVersion !== undefined) {
    sanitized.policyVersion = Number.isInteger(policy.policyVersion) ? policy.policyVersion : 1;
  }
  if (policy.generatedAt) {
    sanitized.generatedAt = policy.generatedAt;
  }
  if (policy.aiGenerated !== undefined) {
    sanitized.aiGenerated = Boolean(policy.aiGenerated);
  }
  if (policy.reasoning) {
    sanitized.reasoning = String(policy.reasoning).substring(0, 500);
  }

  // Timestamp
  sanitized.updatedAt = policy.updatedAt || new Date().toISOString();

  return sanitized;
}

/**
 * Strict validator for AI-generated policies.
 * Ensures the AI recommendation does not introduce hallucinated models,
 * unsafe timeouts, or unsupported providers.
 *
 * @param {object} policy - Candidate policy generated by AI
 * @param {object} [currentPolicy=null] - Existing policy for version incrementing
 * @returns {object|null} Validated policy or null if invalid
 */
function validateAiPolicy(policy, currentPolicy = null) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    logger.warn('AI Policy validation failed: policy is not a valid object');
    return null;
  }

  // 1. Strict Provider Validation
  const rawProvider = String(policy.provider || '').toLowerCase().trim();
  if (!SUPPORTED_PROVIDERS.includes(rawProvider)) {
    logger.warn(`AI Policy validation failed: unsupported provider '${policy.provider}'`);
    return null;
  }

  // 2. Strict Model Validation
  const rawModel = String(policy.model || '').trim();
  const validModelsForProv = SUPPORTED_MODELS[rawProvider] || [];
  if (!rawModel || !validModelsForProv.includes(rawModel)) {
    logger.warn(`AI Policy validation failed: invalid model '${rawModel}' for provider '${rawProvider}'`);
    return null;
  }

  // 3. Strict Strategy Validation & Normalization
  let strategy = String(policy.strategy || 'balanced').toLowerCase().trim();
  if (strategy.includes('cost')) strategy = 'cost';
  else if (strategy.includes('latency')) strategy = 'latency';
  else if (strategy.includes('reliab')) strategy = 'reliability';
  else if (strategy.includes('balanc')) strategy = 'balanced';

  if (!SUPPORTED_STRATEGIES.includes(strategy)) {
    logger.warn(`AI Policy validation failed: unsupported strategy '${policy.strategy}'`);
    return null;
  }

  // 4. Bounded Timeout (1000ms - 30000ms)
  const timeoutMs = Number(policy.timeoutMs !== undefined ? policy.timeoutMs : 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    logger.warn(`AI Policy validation failed: timeoutMs ${policy.timeoutMs} out of safe bounds [1000, 30000]`);
    return null;
  }

  // 5. Bounded Retries (0 - 5)
  const maxRetries = Number(policy.maxRetries !== undefined ? policy.maxRetries : 2);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    logger.warn(`AI Policy validation failed: maxRetries ${policy.maxRetries} out of safe bounds [0, 5]`);
    return null;
  }

  // 6. Valid Cache Settings
  const cacheEnabled = policy.cacheEnabled !== undefined ? Boolean(policy.cacheEnabled) : true;
  const semanticCacheEnabled = policy.semanticCacheEnabled !== undefined ? Boolean(policy.semanticCacheEnabled) : true;
  let semanticCacheThreshold = 0.90;
  if (policy.semanticCacheThreshold !== undefined) {
    const thresh = Number(policy.semanticCacheThreshold);
    if (isNaN(thresh) || thresh < 0.50 || thresh > 0.99) {
      logger.warn(`AI Policy validation failed: semanticCacheThreshold ${policy.semanticCacheThreshold} out of bounds [0.50, 0.99]`);
      return null;
    }
    semanticCacheThreshold = Number(thresh.toFixed(2));
  }
  let cacheTTL = 300;
  if (policy.cacheTTL !== undefined) {
    const ttl = Number(policy.cacheTTL);
    if (!Number.isInteger(ttl) || ttl < 10 || ttl > 86400) {
      logger.warn(`AI Policy validation failed: cacheTTL ${policy.cacheTTL} out of bounds [10, 86400]`);
      return null;
    }
    cacheTTL = ttl;
  }

  // 7. Fallback Providers (only supported providers)
  let fallbackProviders = ['gemini', 'anthropic'].filter(p => p !== rawProvider);
  if (Array.isArray(policy.fallbackProviders)) {
    const customFallbacks = policy.fallbackProviders
      .map(p => String(p).toLowerCase().trim())
      .filter(p => SUPPORTED_PROVIDERS.includes(p) && p !== rawProvider);
    if (customFallbacks.length > 0) {
      fallbackProviders = customFallbacks;
    }
  }

  const currentVersion = Number.isInteger(currentPolicy?.policyVersion) ? currentPolicy.policyVersion : 0;

  return {
    provider: rawProvider,
    model: rawModel,
    strategy,
    cacheEnabled,
    semanticCacheEnabled,
    semanticCacheThreshold,
    cacheTTL,
    timeoutMs,
    maxRetries,
    fallbackProviders,
    policyVersion: currentVersion + 1,
    generatedAt: new Date().toISOString(),
    aiGenerated: true,
    reasoning: typeof policy.reasoning === 'string' ? policy.reasoning.substring(0, 500) : null
  };
}

/**
 * Retrieves the active routing policy for a given user from Redis.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<object|null>} The routing policy or null if not found/invalid
 */
async function getRoutingPolicy(userId) {
  if (!userId) return null;

  try {
    const redis = getRedisClient();
    if (!redis) return null;

    const key = getPolicyKey(userId.toString());
    const rawData = await redis.get(key);

    if (!rawData) {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawData);
    } catch (parseErr) {
      logger.warn(`Invalid JSON in routing policy for user [${userId}]: ${parseErr.message}`);
      return null;
    }

    const validated = validatePolicy(parsed);
    if (!validated) {
      logger.warn(`Invalid policy schema stored for user [${userId}]`);
      return null;
    }

    return validated;
  } catch (error) {
    logger.error(`Error reading routing policy from Redis for user [${userId}]: ${error.message}`);
    return null;
  }
}

/**
 * Stores a routing policy for a given user in Redis.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {object} policy
 * @param {number} [ttlSeconds] Optional TTL in seconds
 * @returns {Promise<boolean>} True if saved successfully, false otherwise
 */
async function setRoutingPolicy(userId, policy, ttlSeconds = null) {
  if (!userId) return false;

  const sanitized = validatePolicy(policy);
  if (!sanitized) {
    logger.warn(`Cannot set invalid routing policy for user [${userId}]`);
    return false;
  }

  try {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = getPolicyKey(userId.toString());
    const serialized = JSON.stringify(sanitized);

    if (ttlSeconds && Number.isInteger(ttlSeconds) && ttlSeconds > 0) {
      await redis.setEx(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }

    logger.info(`Routing policy set in Redis for user [${userId}]: provider [${sanitized.provider || 'default'}]`);
    return true;
  } catch (error) {
    logger.error(`Error setting routing policy in Redis for user [${userId}]: ${error.message}`);
    return false;
  }
}

/**
 * Deletes the routing policy for a given user from Redis.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<boolean>} True if deleted successfully, false otherwise
 */
async function deleteRoutingPolicy(userId) {
  if (!userId) return false;

  try {
    const redis = getRedisClient();
    if (!redis) return false;

    const key = getPolicyKey(userId.toString());
    await redis.del(key);
    logger.info(`Routing policy deleted from Redis for user [${userId}]`);
    return true;
  } catch (error) {
    logger.error(`Error deleting routing policy from Redis for user [${userId}]: ${error.message}`);
    return false;
  }
}

module.exports = {
  getRoutingPolicy,
  setRoutingPolicy,
  deleteRoutingPolicy,
  getPolicyKey,
  validatePolicy,
  validateAiPolicy,
  SUPPORTED_PROVIDERS,
  SUPPORTED_STRATEGIES,
  SUPPORTED_MODELS
};
