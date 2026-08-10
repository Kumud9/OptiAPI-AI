const redis = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

// Clean in-memory fallback for local environments without Redis
class MockRedisClient {
  constructor() {
    this.store = new Map();
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
    setTimeout(() => {
      this.store.delete(key);
    }, ttl * 1000);
    return Promise.resolve('OK');
  }

  async del(key) {
    const deleted = this.store.delete(key);
    return Promise.resolve(deleted ? 1 : 0);
  }

  async quit() {
    return Promise.resolve();
  }
  
  on(event, handler) {
    return this;
  }

  async eval(script, options = {}) {
    const key = options.keys[0];
    const ttl = parseInt(options.args[1], 10);

    const currentValStr = this.store.get(key);
    const currentVal = currentValStr ? parseInt(currentValStr, 10) : 0;
    const newVal = currentVal + 1;
    this.store.set(key, String(newVal));

    if (newVal === 1) {
      setTimeout(() => {
        this.store.delete(key);
      }, ttl * 1000);
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

module.exports = { connectRedis, getRedisClient };
