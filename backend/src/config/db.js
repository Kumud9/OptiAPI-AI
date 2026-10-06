const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

// Local RAM database store for the offline sandbox mode
const mockStore = {
  users: [],
  apikeys: [],
  providerkeys: [],
  cacherules: [],
  requestlogs: [],
  recommendations: []
};

// Seed RAM database with default demo account
const seedMemorySandbox = async () => {
  try {
    const salt = await bcrypt.genSalt(10);
    const demoPasswordHash = await bcrypt.hash('password123', salt);
    
    const demoUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'demo@optiapi.com',
      password: demoPasswordHash,
      organization: 'Acme Corp',
      role: 'admin',
      createdAt: new Date()
    };
    mockStore.users.push(demoUser);

    const demoApiKey = {
      _id: new mongoose.Types.ObjectId(),
      userId: demoUser._id,
      name: 'Acme Production Key',
      key: 'opti_live_demo_api_key_2026_xYz',
      rateLimitRps: 15,
      usageCount: 24,
      createdAt: new Date()
    };
    mockStore.apikeys.push(demoApiKey);

    mockStore.providerkeys.push(
      { _id: new mongoose.Types.ObjectId(), userId: demoUser._id, provider: 'openai', name: 'OpenAI Prod Key', value: 'demo-openai-key-replace-with-real-key', createdAt: new Date() },
      { _id: new mongoose.Types.ObjectId(), userId: demoUser._id, provider: 'stripe', name: 'Stripe Live Key', value: 'demo-stripe-key-replace-with-real-key', createdAt: new Date() }
    );

    mockStore.cacherules.push(
      { _id: new mongoose.Types.ObjectId(), userId: demoUser._id, provider: 'stripe', endpoint: '/v1/customers', ttlSeconds: 1800, isActive: true, createdAt: new Date() }
    );

    // Seed some mock logs in memory so charts show data
    const providers = ['openai', 'gemini', 'stripe', 'google_maps'];
    for (let i = 0; i < 30; i++) {
      const p = providers[i % providers.length];
      const isHit = i % 3 === 0;
      mockStore.requestlogs.push({
        _id: new mongoose.Types.ObjectId(),
        userId: demoUser._id,
        apiKeyId: demoApiKey._id,
        provider: p,
        endpoint: p === 'openai' ? '/v1/chat/completions' : '/v1/customers',
        method: 'POST',
        status: 200,
        responseTimeMs: isHit ? 3 : 320,
        costUsd: isHit ? 0 : 0.004,
        tokensUsed: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        cacheStatus: isHit ? 'HIT' : 'MISS',
        timestamp: new Date(Date.now() - (i * 3600 * 1000))
      });
    }

    mockStore.recommendations.push({
      _id: new mongoose.Types.ObjectId(),
      userId: demoUser._id,
      type: 'cache_endpoint',
      message: 'High latency detected on openai /v1/chat/completions. Cache this endpoint to save costs.',
      priority: 'high',
      savingsInr: 12400,
      impactLevel: 'high',
      targetEndpoint: '/v1/chat/completions',
      details: { avgLatency: 1450, count: 180, currentHitRatio: 0 },
      isApplied: false,
      createdAt: new Date()
    });

    logger.info('--- memory database successfully seeded ---');
  } catch (err) {
    logger.error('Failed to seed memory database:', err.message);
  }
};

// Mongoose Model Overrider for Offline Sandbox Mode
const activateMemorySandbox = () => {
  logger.warn('================================================================');
  logger.warn('!!! OFFLINE SANDBOX ACTIVE: RUNNING WITH IN-MEMORY DATABASE !!!');
  logger.warn('All changes are saved to RAM and will reset on server restart.');
  logger.warn('================================================================');

  const User = require('../models/User');
  const ApiKey = require('../models/ApiKey');
  const ProviderKey = require('../models/ProviderKey');
  const CacheRule = require('../models/CacheRule');
  const RequestLog = require('../models/RequestLog');
  const Recommendation = require('../models/Recommendation');

  const models = [
    { Model: User, key: 'users' },
    { Model: ApiKey, key: 'apikeys' },
    { Model: ProviderKey, key: 'providerkeys' },
    { Model: CacheRule, key: 'cacherules' },
    { Model: RequestLog, key: 'requestlogs' },
    { Model: Recommendation, key: 'recommendations' }
  ];

  models.forEach(({ Model, key }) => {
    // 1. Mock Find
    Model.find = function (filter = {}) {
      let list = [...mockStore[key]];
      
      // Simple filter logic
      if (filter.userId) {
        list = list.filter(item => String(item.userId) === String(filter.userId));
      }
      if (filter.email) {
        list = list.filter(item => item.email === filter.email);
      }
      if (filter.key) {
        list = list.filter(item => item.key === filter.key);
      }
      if (filter.isApplied === false) {
        list = list.filter(item => item.isApplied === false);
      }

      const queryChain = {
        sort: () => queryChain,
        skip: () => queryChain,
        limit: () => queryChain,
        select: () => queryChain,
        then: (resolve) => resolve(list),
        catch: (reject) => reject(new Error('Query error')),
        // support standard await Promise execution
        then: function(onFulfilled, onRejected) {
          return Promise.resolve(list).then(onFulfilled, onRejected);
        }
      };
      return queryChain;
    };

    // 2. Mock FindOne
    Model.findOne = function (filter = {}) {
      let list = mockStore[key];
      let match = list.find(item => {
        for (const [k, v] of Object.entries(filter)) {
          if (k === '$in') continue; // skip complex Mongo filters
          if (String(item[k]) !== String(v)) return false;
        }
        return true;
      });

      if (match) {
        // Hydrate model helper methods
        match.save = async function() { return this; };
        match.comparePassword = async function(candidate) {
          return await bcrypt.compare(candidate, this.password);
        };
      }

      const queryChain = {
        select: () => queryChain,
        then: function(onFulfilled, onRejected) {
          return Promise.resolve(match || null).then(onFulfilled, onRejected);
        }
      };
      return queryChain;
    };

    // 3. Mock Create
    Model.create = async function (data) {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        ...data,
        createdAt: new Date()
      };

      if (key === 'users' && doc.password) {
        const salt = await bcrypt.genSalt(10);
        doc.password = await bcrypt.hash(doc.password, salt);
      }

      doc.save = async function() {
        return this;
      };

      doc.comparePassword = async function(candidate) {
        return await bcrypt.compare(candidate, this.password);
      };

      mockStore[key].push(doc);
      return doc;
    };

    // 4. Mock countDocuments
    Model.countDocuments = async function (filter = {}) {
      let list = mockStore[key];
      if (filter.userId) {
        list = list.filter(item => String(item.userId) === String(filter.userId));
      }
      return Promise.resolve(list.length);
    };

    // 5. Mock Distinct
    Model.distinct = async function (field, filter = {}) {
      let list = mockStore[key];
      if (filter.userId) {
        list = list.filter(item => String(item.userId) === String(filter.userId));
      }
      const values = list.map(item => item[field]).filter(Boolean);
      return Promise.resolve([...new Set(values)]);
    };

    // 6. Mock findOneAndDelete
    Model.findOneAndDelete = async function (filter = {}) {
      let list = mockStore[key];
      const idx = list.findIndex(item => {
        for (const [k, v] of Object.entries(filter)) {
          if (String(item[k]) !== String(v)) return false;
        }
        return true;
      });

      if (idx !== -1) {
        const deleted = list.splice(idx, 1);
        return Promise.resolve(deleted[0]);
      }
      return Promise.resolve(null);
    };

    // 7. Mock deleteMany
    Model.deleteMany = async function () {
      mockStore[key] = [];
      return Promise.resolve({ deletedCount: 0 });
    };

    // 8. Mock Aggregate (for charts and dashboards)
    Model.aggregate = async function (pipeline = []) {
      const list = mockStore[key];
      
      // Simple aggregation logic for chart metrics
      if (key === 'requestlogs') {
        const hasGroup = pipeline.some(p => p.$group);
        if (hasGroup) {
          const groupStage = pipeline.find(p => p.$group).$group;
          
          // Case A: Group by Provider
          if (groupStage._id === '$provider') {
            const counts = {};
            list.forEach(log => {
              counts[log.provider] = (counts[log.provider] || 0) + 1;
            });
            return Object.entries(counts).map(([prov, cnt]) => ({
              _id: prov,
              requests: cnt,
              cost: cnt * 0.002
            }));
          }

          // Case B: Group by Date string
          if (groupStage._id && String(groupStage._id.$dateToString?.format) === '%Y-%m-%d') {
            const daily = {};
            list.forEach(log => {
              const dateStr = new Date(log.timestamp).toISOString().split('T')[0];
              if (!daily[dateStr]) daily[dateStr] = { requests: 0, cost: 0, hits: 0 };
              daily[dateStr].requests++;
              daily[dateStr].cost += log.costUsd;
              if (log.cacheStatus === 'HIT') daily[dateStr].hits++;
            });
            return Object.entries(daily).map(([d, val]) => ({
              _id: d,
              requests: val.requests,
              cost: val.cost,
              hits: val.hits
            }));
          }
          
          // Case C: Cache hit stats group
          if (groupStage._id === '$cacheStatus') {
            const stats = { HIT: 0, MISS: 0 };
            list.forEach(log => {
              if (log.cacheStatus === 'HIT') stats.HIT++;
              if (log.cacheStatus === 'MISS') stats.MISS++;
            });
            return Object.entries(stats).map(([k, cnt]) => ({
              _id: k,
              count: cnt
            }));
          }

          // Case D: Average Latency
          if (groupStage.avgLatency) {
            const totalLatency = list.reduce((acc, curr) => acc + curr.responseTimeMs, 0);
            return [{
              _id: null,
              avgLatency: list.length > 0 ? totalLatency / list.length : 0
            }];
          }

          // Case E: Total spent sums
          if (groupStage.total) {
            const totalSpent = list.reduce((acc, curr) => acc + curr.costUsd, 0);
            return [{
              _id: null,
              total: totalSpent
            }];
          }
        }
      }
      return Promise.resolve([]);
    };
  });

  // Pre-seed memory records
  seedMemorySandbox();
};

const migratePlaintextCredentials = async () => {
  try {
    const ProviderKey = require('../models/ProviderKey');
    const { encrypt } = require('../utils/crypto');
    
    const keys = await ProviderKey.find({});
    let migratedCount = 0;
    
    for (const key of keys) {
      if (key.value && !key.value.startsWith('v1:')) {
        logger.info(`Migrating plaintext credential for provider [${key.provider}] (ID: ${key._id})...`);
        key.value = encrypt(key.value);
        await key.save();
        migratedCount++;
      }
    }
    
    if (migratedCount > 0) {
      logger.info(`Database Migration: Successfully encrypted ${migratedCount} plaintext credentials in MongoDB.`);
    }
  } catch (err) {
    logger.error(`Database Migration Error: ${err.message}`);
  }
};

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/optiapi';
    logger.info(`Attempting database connection to MongoDB at: ${mongoUri}`);
    
    // Connect with short timeout so we fallback quickly instead of hanging
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 2500,
      connectTimeoutMS: 2500
    });
    
    logger.info(`MongoDB Connected successfully to host: ${conn.connection.host}`);
    
    // Explicitly migrate any plaintext credentials to secure AES-256-GCM storage
    await migratePlaintextCredentials();
    
    return conn;
  } catch (error) {
    logger.error(`Database connection failed: ${error.message}`);
    activateMemorySandbox();
  }
};

const disconnectDB = async () => {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected gracefully.');
    } catch (err) {
      logger.warn(`Error disconnecting MongoDB: ${err.message}`);
    }
  }
};

connectDB.disconnectDB = disconnectDB;
module.exports = connectDB;
