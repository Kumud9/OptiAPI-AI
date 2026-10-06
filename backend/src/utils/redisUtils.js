const logger = require('./logger');

/**
 * Safely delete matching Redis keys using non-blocking cursor-based SCAN instead of blocking KEYS.
 * Scans keys using cursor iteration, then deletes matching keys in safe batches to avoid
 * blocking the Redis event loop or overwhelming memory.
 * 
 * @param {Object} redis - Redis client instance
 * @param {string} pattern - Glob pattern to match (e.g. "apicache:userId:*")
 * @param {Object} [options]
 * @param {number} [options.batchSize=100] - Batch size for SCAN and DEL operations
 * @returns {Promise<number>} Total number of deleted keys
 */
async function deleteKeysByPattern(redis, pattern, options = {}) {
  if (!redis || !pattern) {
    return 0;
  }

  const batchSize = Math.max(1, parseInt(options.batchSize, 10) || 100);
  let totalDeleted = 0;

  try {
    // 1. Prefer scanIterator if available (Node Redis v4 and MockRedisClient)
    if (typeof redis.scanIterator === 'function') {
      const allKeys = [];
      for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: batchSize })) {
        allKeys.push(key);
      }

      if (allKeys.length === 0) {
        return 0;
      }

      // Delete in safe batches
      for (let i = 0; i < allKeys.length; i += batchSize) {
        const batch = allKeys.slice(i, i + batchSize);
        if (batch.length > 0) {
          const count = await redis.del(batch);
          totalDeleted += typeof count === 'number' ? count : batch.length;
        }
      }
      return totalDeleted;
    }

    // 2. Cursor-based scan loop fallback (if client provides scan but not scanIterator)
    if (typeof redis.scan === 'function') {
      const allKeys = [];
      let cursor = '0';
      do {
        const reply = await redis.scan(cursor, { MATCH: pattern, COUNT: batchSize });
        cursor = typeof reply === 'object' && reply.cursor !== undefined ? String(reply.cursor) : String(reply[0]);
        const keys = typeof reply === 'object' && Array.isArray(reply.keys) ? reply.keys : reply[1];

        if (keys && keys.length > 0) {
          allKeys.push(...keys);
        }
      } while (cursor !== '0');

      if (allKeys.length === 0) {
        return 0;
      }

      // Delete in safe batches
      for (let i = 0; i < allKeys.length; i += batchSize) {
        const batch = allKeys.slice(i, i + batchSize);
        if (batch.length > 0) {
          const count = await redis.del(batch);
          totalDeleted += typeof count === 'number' ? count : batch.length;
        }
      }
      return totalDeleted;
    }

    // 3. Fallback for in-memory Map stores without scan functions
    if (redis.store && typeof redis.store.keys === 'function') {
      const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const matchingKeys = Array.from(redis.store.keys()).filter(k => regex.test(k));
      for (const k of matchingKeys) {
        if (redis.store.delete(k)) {
          totalDeleted++;
        }
      }
      return totalDeleted;
    }

    logger.warn(`No SCAN method available on Redis client for pattern [${pattern}]`);
    return 0;
  } catch (error) {
    logger.error(`Redis SCAN deletion error for pattern [${pattern}]: ${error.message}`);
    throw error;
  }
}

module.exports = {
  deleteKeysByPattern
};
