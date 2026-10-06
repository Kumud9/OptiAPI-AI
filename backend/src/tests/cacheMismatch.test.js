'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');
const redis = require('redis');

const backendDir = 'd:/OptiAPI/backend';
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const User = require('../models/User');
const ProviderKey = require('../models/ProviderKey');
const ProviderModel = require('../models/ProviderModel');
const RequestLog = require('../models/RequestLog');
const ApiKey = require('../models/ApiKey');
const CacheRule = require('../models/CacheRule');
const { handleGatewayRequest } = require('../controllers/gatewayController');

const { deleteKeysByPattern } = require('../utils/redisUtils');
async function flushRedisCache(userIdString) {
  const redisClient = redis.createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();
  await deleteKeysByPattern(redisClient, `apicache:${userIdString}:*`);
  await redisClient.quit();
}

test('Cache Endpoint Normalization Mismatch Tests', async (t) => {
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  // Retrieve or create test user
  const tempEmail = `cache_mismatch_${Date.now()}@test.com`;
  const user = await User.create({
    email: tempEmail,
    password: 'password123',
    role: 'user'
  });

  const apiTokenDoc = await ApiKey.create({
    userId: user._id,
    name: 'Cache Mismatch API Key',
    key: `opti_live_cache_key_${Date.now()}`,
    isActive: true
  });

  const geminiKey = await ProviderKey.create({
    userId: user._id,
    provider: 'gemini',
    name: 'Gemini Cache Key',
    value: 'sk-gemini-key-value-12345',
    validationStatus: 'connected'
  });

  const openaiKey = await ProviderKey.create({
    userId: user._id,
    provider: 'openai',
    name: 'OpenAI Cache Key',
    value: 'sk-openai-key-value-12345',
    validationStatus: 'connected'
  });

  await ProviderModel.create({
    userId: user._id,
    provider: 'gemini',
    providerKeyId: geminiKey._id,
    externalModelId: 'gemini-3.6-flash',
    isAvailable: true,
    capabilities: { text: true }
  });

  // Insufficient OpenAI models to trigger fallback to Gemini optimization
  // But let's build telemetry so optimizer recommends Gemini
  const logs = [];
  for (let i = 0; i < 6; i++) {
    logs.push({
      userId: user._id,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      endpoint: '/v1beta/models/gemini-3.6-flash:generateContent',
      method: 'POST',
      status: 200,
      responseTimeMs: 300,
      costUsd: 0.00001,
      tokensUsed: { totalTokens: 100 },
      cacheStatus: 'MISS'
    });
  }
  await RequestLog.create(logs);

  // Setup CacheRule:
  // endpoint is /v1/models/gemini-3.6-flash:generatecontent (lowercase model/method)
  const rule = await CacheRule.create({
    userId: user._id,
    provider: 'gemini',
    endpoint: '/v1/models/gemini-3.6-flash:generatecontent',
    ttlSeconds: 3600,
    isActive: true
  });

  const originalFetch = globalThis.fetch;
  const originalEnvOptEnabled = process.env.OPTIMIZATION_ENABLED;
  const originalEnvOptMode = process.env.OPTIMIZATION_MODE;

  process.env.OPTIMIZATION_ENABLED = 'true';
  process.env.OPTIMIZATION_MODE = 'automatic';

  let fetchCallCount = 0;
  globalThis.fetch = async (url, options) => {
    fetchCallCount++;
    if (url.includes('googleapis.com')) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Mocked Gemini Content' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const cleanup = async () => {
    globalThis.fetch = originalFetch;
    process.env.OPTIMIZATION_ENABLED = originalEnvOptEnabled;
    process.env.OPTIMIZATION_MODE = originalEnvOptMode;
    try {
      await CacheRule.deleteMany({ userId: user._id });
      await RequestLog.deleteMany({ userId: user._id });
      await ProviderKey.deleteMany({ userId: user._id });
      await ProviderModel.deleteMany({ userId: user._id });
      await ApiKey.deleteMany({ userId: user._id });
      await User.deleteOne({ _id: user._id });
    } catch (e) {}
    await mongoose.disconnect();
    // Force close redis connection if any
    try {
      const { getRedisClient } = require('../config/redis');
      const redisClient = getRedisClient();
      if (redisClient && typeof redisClient.quit === 'function') {
        await redisClient.quit();
      }
    } catch (e) {}
  };

  try {
    const userIdString = user._id.toString();
    await flushRedisCache(userIdString);

    // Call 1: Expect Cache MISS (should populate Redis)
    // Request asks for openai completions but gets routed to gemini-3.6-flash v1beta generateContent
    const req1 = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'Say hello.' }] },
      headers: { 'x-api-key': apiTokenDoc.key },
      gatewayKey: apiTokenDoc,
      userId: user._id
    };

    let status1 = null;
    let responseData1 = null;
    let headers1 = {};
    const res1 = {
      setHeader: (name, val) => { headers1[name] = val; },
      status: (code) => {
        status1 = code;
        return {
          json: (data) => { responseData1 = data; }
        };
      }
    };

    await handleGatewayRequest(req1, res1);
    console.log('Call 1 completed. Cache header:', headers1['X-OptiAPI-Cache']);
    assert.strictEqual(status1, 200, 'First request status must be 200');
    assert.strictEqual(headers1['X-OptiAPI-Cache'], 'MISS', 'First request must be Cache MISS');
    assert.strictEqual(fetchCallCount, 1, 'First request should call external provider (fetchCallCount === 1)');

    // Wait a brief moment to ensure Redis and DB async operations execute
    await new Promise(resolve => setTimeout(resolve, 200));

    // Call 2: Identical Request. Expect Cache HIT.
    const req2 = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'Say hello.' }] },
      headers: { 'x-api-key': apiTokenDoc.key },
      gatewayKey: apiTokenDoc,
      userId: user._id
    };

    let status2 = null;
    let responseData2 = null;
    let headers2 = {};
    const res2 = {
      setHeader: (name, val) => { headers2[name] = val; },
      status: (code) => {
        status2 = code;
        return {
          json: (data) => { responseData2 = data; }
        };
      }
    };

    await handleGatewayRequest(req2, res2);
    console.log('Call 2 completed. Cache header:', headers2['X-OptiAPI-Cache']);
    assert.strictEqual(status2, 200, 'Second request status must be 200');
    assert.strictEqual(headers2['X-OptiAPI-Cache'], 'HIT', 'Second request must be Cache HIT');
    assert.strictEqual(fetchCallCount, 1, 'Cache HIT should NOT call external provider (fetchCallCount stays 1)');
    assert.strictEqual(responseData2.choices[0].message.content, 'Mocked Gemini Content', 'Cached content matches');

    await cleanup();
    process.exit(0);
  } catch (err) {
    console.error('ASSERTION/TEST ERROR:', err.message, err.stack);
    await cleanup();
    process.exit(1);
  }
});
