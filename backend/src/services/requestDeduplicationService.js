const crypto = require('crypto');
const { normalizeEndpoint } = require('../utils/pathNormalizer');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');

// In-memory Map storing in-flight promises keyed by SHA-256 hash (Singleflight pattern)
const inFlightRequests = new Map();

/**
 * Deterministically canonicalize arbitrary values (objects, arrays, strings, primitives)
 * to ensure identical data structures produce identical string representations regardless
 * of object key ordering or formatting.
 * 
 * @param {*} value 
 * @returns {string}
 */
function canonicalize(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return canonicalize(parsed);
      }
    } catch {
      // not a JSON string, treat as trimmed string
    }
    return JSON.stringify(value.trim());
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const sortedKeys = Object.keys(value).sort();
  const entries = sortedKeys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
  return '{' + entries.join(',') + '}';
}

/**
 * Generate a SHA-256 deduplication key from request parameters.
 * Strictly uses: userId, provider, model, HTTP method, normalized endpoint,
 * query parameters, and request body.
 * 
 * NEVER includes: API keys, authorization headers, request IDs, or timestamps.
 * 
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.provider
 * @param {string} [params.model]
 * @param {string} [params.method]
 * @param {string} [params.endpoint]
 * @param {Object|string} [params.query]
 * @param {Object|string} [params.body]
 * @returns {string} SHA-256 hexadecimal hash
 */
function generateDeduplicationKey({ userId, provider, model, method, endpoint, query, body } = {}) {
  const normUserId = userId ? String(userId).trim() : '';
  const normProvider = provider ? String(provider).trim().toLowerCase() : '';
  const normModel = model ? String(model).trim().toLowerCase() : '';
  const normMethod = method ? String(method).trim().toUpperCase() : 'GET';
  const normEndpoint = normalizeEndpoint(endpoint || '').toLowerCase();
  const canonQuery = canonicalize(query || {});
  const canonBody = canonicalize(body || {});

  const hashInput = [
    `user:${normUserId}`,
    `provider:${normProvider}`,
    `model:${normModel}`,
    `method:${normMethod}`,
    `endpoint:${normEndpoint}`,
    `query:${canonQuery}`,
    `body:${canonBody}`
  ].join('|');

  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Deduplicate concurrent identical async operations (Singleflight pattern).
 * 
 * If a request with the given key is currently in-flight, returns the existing Promise.
 * Otherwise, invokes `fn()`, caches the Promise, and removes it from the Map
 * once the Promise resolves OR rejects.
 * 
 * @param {string} key - Deduplication key
 * @param {Function} fn - Async factory function performing the upstream call
 * @returns {Promise<any>}
 */
async function deduplicate(key, fn) {
  if (!key) {
    return fn();
  }

  if (inFlightRequests.has(key)) {
    logger.info(`Request deduplication HIT: coalescing concurrent request on key [${key.substring(0, 12)}...]`);
    metricsService.recordDeduplicationHit();
    return inFlightRequests.get(key);
  }

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * Helper to check if a key is currently in-flight
 * @param {string} key 
 * @returns {boolean}
 */
function isInFlight(key) {
  return inFlightRequests.has(key);
}

/**
 * Helper to get the current number of in-flight requests
 * @returns {number}
 */
function getInFlightCount() {
  return inFlightRequests.size;
}

/**
 * Helper to clear all in-flight entries (useful for test teardown)
 */
function clearInFlight() {
  inFlightRequests.clear();
}

module.exports = {
  generateDeduplicationKey,
  deduplicate,
  executeDeduplicated: deduplicate,
  isInFlight,
  getInFlightCount,
  clearInFlight
};
