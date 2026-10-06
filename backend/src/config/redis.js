const redis = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

// Clean in-memory fallback for local environments without Redis
class MockRedisClient {
  constructor() {
    this.store = new Map();
    this.expiry = new Map();
    logger.warn('--- REDIS CONFIGURATION: Running with In-Memory Mock Cache ---');
  }

  async connect() {
    return Promise.resolve();
  }

  async get(key) {
    return Promise.resolve(this.store.get(key) || null);
  }

  async set(key, value) {
    this.store.set(key, String(value));
    return Promise.resolve('OK');
  }

  async setEx(key, ttl, value) {
    this.store.set(key, String(value));
    this.expiry.set(key, Date.now() + ttl * 1000);
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.expiry.delete(key);
    }, ttl * 1000);
    if (timer && timer.unref) timer.unref();
    return Promise.resolve('OK');
  }

  async del(keyOrKeys) {
    if (Array.isArray(keyOrKeys)) {
      let count = 0;
      for (const k of keyOrKeys) {
        this.expiry.delete(k);
        if (this.store.delete(k)) count++;
      }
      return Promise.resolve(count);
    }
    this.expiry.delete(keyOrKeys);
    const deleted = this.store.delete(keyOrKeys);
    return Promise.resolve(deleted ? 1 : 0);
  }

  async ttl(key) {
    if (!this.store.has(key)) return Promise.resolve(-2);
    const exp = this.expiry.get(key);
    if (!exp) return Promise.resolve(-1);
    const remaining = Math.max(0, Math.ceil((exp - Date.now()) / 1000));
    return Promise.resolve(remaining);
  }

  async expire(key, seconds) {
    if (!this.store.has(key)) return Promise.resolve(0);
    this.expiry.set(key, Date.now() + seconds * 1000);
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.expiry.delete(key);
    }, seconds * 1000);
    if (timer && timer.unref) timer.unref();
    return Promise.resolve(1);
  }

  async scan(cursor = '0', options = {}) {
    const match = options.MATCH || options.match || '*';
    const count = parseInt(options.COUNT || options.count || 10, 10);
    const cursorNum = parseInt(cursor, 10) || 0;

    const regex = new RegExp('^' + match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const allMatching = Array.from(this.store.keys()).filter(k => regex.test(k));

    const slice = allMatching.slice(cursorNum, cursorNum + count);
    const nextCursor = (cursorNum + count < allMatching.length) ? String(cursorNum + count) : '0';

    return Promise.resolve({
      cursor: nextCursor,
      keys: slice
    });
  }

  async *scanIterator(options = {}) {
    let cursor = '0';
    do {
      const result = await this.scan(cursor, options);
      cursor = result.cursor;
      for (const key of result.keys) {
        yield key;
      }
    } while (cursor !== '0');
  }

  async incr(key) {
    const current = parseInt(this.store.get(key) || '0', 10);
    const next = current + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  async quit() {
    return Promise.resolve();
  }
  
  on(event, handler) {
    return this;
  }

  async eval(script, options = {}) {
    const key = options.keys ? options.keys[0] : null;
    const rawArgs = options.arguments || options.args || [];

    // Phase 3C: Atomic check-and-increment rate limiting script
    if (script && (script.includes('current >= limit') || script.includes('ARGV[1]'))) {
      const limit = parseInt(rawArgs[0], 10) || 100;
      const ttl = parseInt(rawArgs[1], 10) || 60;

      const currentValStr = this.store.get(key);
      const current = currentValStr ? parseInt(currentValStr, 10) : 0;

      let remainingTtl = ttl;
      if (this.expiry.has(key)) {
        remainingTtl = Math.max(0, Math.ceil((this.expiry.get(key) - Date.now()) / 1000));
      }

      if (current >= limit) {
        return Promise.resolve([0, current, remainingTtl]);
      }

      const newVal = current + 1;
      this.store.set(key, String(newVal));

      if (newVal === 1 || !this.expiry.has(key)) {
        this.expiry.set(key, Date.now() + ttl * 1000);
        const timer = setTimeout(() => {
          this.store.delete(key);
          this.expiry.delete(key);
        }, ttl * 1000);
        if (timer && timer.unref) timer.unref();
        remainingTtl = ttl;
      }

      return Promise.resolve([1, newVal, remainingTtl]);
    }

    // Default legacy behavior for middleware/rateLimiter.js
    const ttl = parseInt(rawArgs[1], 10) || 2;
    const currentValStr = this.store.get(key);
    const currentVal = currentValStr ? parseInt(currentValStr, 10) : 0;
    const newVal = currentVal + 1;
    this.store.set(key, String(newVal));

    if (newVal === 1) {
      this.expiry.set(key, Date.now() + ttl * 1000);
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.expiry.delete(key);
      }, ttl * 1000);
      if (timer && timer.unref) timer.unref();
    }
    return Promise.resolve(newVal);
  }
}

const connectRedis = async () => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    logger.info(`Attempting connection to Redis at: ${url}`);
    const client = redis.createClient({
      url,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => {
          if (retries > 2) {
            logger.warn('Redis reconnection retries exceeded. Swapping to in-memory fallback cache.');
            redisClient = new MockRedisClient();
            return false; // Stop reconnecting
          }
          return 500;
        }
      }
    });

    client.on('error', (err) => {
      // Don't crash process, just log
      logger.error(`Redis client runtime error: ${err.message}`);
    });

    await client.connect();
    logger.info('Redis Cache connected successfully.');
    redisClient = client;
  } catch (error) {
    logger.warn(`Failed to connect to Redis (${error.message}). Swapping to in-memory fallback cache.`);
    redisClient = new MockRedisClient();
  }
  return redisClient;
};

const getRedisClient = () => {
  if (!redisClient) {
    redisClient = new MockRedisClient();
  }
  return redisClient;
};

const disconnectRedis = async () => {
  if (redisClient && typeof redisClient.quit === 'function') {
    try {
      await redisClient.quit();
      logger.info('Redis connection closed gracefully.');
    } catch (err) {
      logger.warn(`Error disconnecting Redis: ${err.message}`);
    }
  }
};

module.exports = { connectRedis, getRedisClient, disconnectRedis };
