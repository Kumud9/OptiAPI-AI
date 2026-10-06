'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');

const { getRoutingPolicy, setRoutingPolicy, deleteRoutingPolicy } = require('../services/policyService');
const { getCachedRule, setCachedRule, invalidateCachedRule, getRuleCacheKey } = require('../services/cacheRuleService');
const { getRedisClient } = require('../config/redis');
const { verifyGatewayKey } = require('../middleware/auth');
const ApiKey = require('../models/ApiKey');
const CacheRule = require('../models/CacheRule');
const User = require('../models/User');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const { getSettings, updateSettings } = require('../controllers/optimizationController');
const historicalDataService = require('../services/historicalDataService');
const externalApiService = require('../services/externalApiService');

const RequestLog = require('../models/RequestLog');

test('Phase 1 Gateway Architecture Test Suite', async (t) => {
  const redis = getRedisClient();
  const testUserId = '507f1f77bcf86cd799439011';
  const testUserId2 = '507f1f77bcf86cd799439022';
  const testApiKeyString = 'opti_phase1_test_api_key_xyz123';
  const testApiKeyId = '607f1f77bcf86cd799439099';

  // Prevent Mongoose buffering hanging when MongoDB is offline
  const originalRequestLogCreate = RequestLog.create;
  RequestLog.create = async () => ({ _id: 'mock_log_id' });

  // Default fast simulateApiCall mock
  const defaultSimulate = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
    return {
      data: { id: 'mock_resp', choices: [{ message: { content: 'hello' } }] },
      tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      model: body?.model || 'gpt-4o'
    };
  };
  const originalSimulateApiCall = externalApiService.simulateApiCall;
  externalApiService.simulateApiCall = defaultSimulate;

  // Cleanup helper
  const cleanup = async () => {
    await deleteRoutingPolicy(testUserId);
    await deleteRoutingPolicy(testUserId2);
    const keyHash = crypto.createHash('sha256').update(testApiKeyString).digest('hex');
    await redis.del(`apikey:${keyHash}`);
    await redis.del(`apikey:usage:${testApiKeyId}`);
    await invalidateCachedRule(testUserId, 'openai', '/v1/chat/completions');
    await invalidateCachedRule(testUserId, 'stripe', '/v1/charges');
  };

  await cleanup();

  // Test 1 & 4: Gateway does NOT call getHistoricalMetricsForUser during normal requests
  await t.test('1 & 4. Gateway does not call getHistoricalMetricsForUser or load historical RequestLog', async () => {
    let historicalCalled = false;
    const originalGetHistorical = historicalDataService.getHistoricalMetricsForUser;
    historicalDataService.getHistoricalMetricsForUser = async () => {
      historicalCalled = true;
      return [];
    };

    try {
      const req = {
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'test' }] },
        headers: {},
        query: {},
        userId: testUserId,
        gatewayKey: { _id: testApiKeyId, key: testApiKeyString, rateLimitRps: 10 }
      };

      let responseStatus = null;
      let responseJson = null;
      const res = {
        setHeader: () => {},
        status: (code) => {
          responseStatus = code;
          return {
            json: (data) => {
              responseJson = data;
              return data;
            }
          };
        }
      };

      await handleGatewayRequest(req, res);

      assert.strictEqual(historicalCalled, false, 'getHistoricalMetricsForUser MUST NOT be called during gateway request');
      assert.strictEqual(responseStatus, 200);
      assert.ok(responseJson, 'Expected valid response');
    } finally {
      historicalDataService.getHistoricalMetricsForUser = originalGetHistorical;
    }
  });

  // Test 2: Gateway successfully reads routing policy from Redis
  await t.test('2. Gateway successfully reads routing policy from Redis', async () => {
    const policy = {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      strategy: 'cost',
      timeoutMs: 8000,
      maxRetries: 1
    };

    const saved = await setRoutingPolicy(testUserId, policy);
    assert.strictEqual(saved, true);

    const fetched = await getRoutingPolicy(testUserId);
    assert.ok(fetched);
    assert.strictEqual(fetched.provider, 'gemini');
    assert.strictEqual(fetched.model, 'gemini-1.5-flash');
    assert.strictEqual(fetched.strategy, 'cost');
    assert.strictEqual(fetched.timeoutMs, 8000);
    assert.strictEqual(fetched.maxRetries, 1);

    const originalFindOne = CacheRule.findOne;
    CacheRule.findOne = () => ({ lean: async () => null });

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'policy test' }] },
      headers: {},
      query: {},
      userId: testUserId,
      gatewayKey: { _id: testApiKeyId, key: testApiKeyString, rateLimitRps: 10 }
    };

    let responseStatus = null;
    let responseJson = null;
    const res = {
      setHeader: () => {},
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => {
            responseJson = data;
            return data;
          }
        };
      }
    };

    try {
      await handleGatewayRequest(req, res);
    } finally {
      CacheRule.findOne = originalFindOne;
    }

    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(req.optimization.optimizationUsed, true);
    assert.strictEqual(req.optimization.optimizationSelectedProvider, 'gemini');
    assert.strictEqual(req.optimization.optimizationSelectedModel, 'gemini-1.5-flash');

    await deleteRoutingPolicy(testUserId);
  });

  // Test 3: Gateway works when routing policy does not exist
  await t.test('3. Gateway works cleanly when routing policy does not exist', async () => {
    await deleteRoutingPolicy(testUserId);

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'no policy test' }] },
      headers: {},
      query: {},
      userId: testUserId,
      gatewayKey: { _id: testApiKeyId, key: testApiKeyString, rateLimitRps: 10 }
    };

    let responseStatus = null;
    let responseJson = null;
    const res = {
      setHeader: () => {},
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => {
            responseJson = data;
            return data;
          }
        };
      }
    };

    await handleGatewayRequest(req, res);

    assert.strictEqual(responseStatus, 200);
    assert.strictEqual(req.optimization.optimizationUsed, false);
    assert.strictEqual(req.optimization.actualProvider, 'openai');
  });

  // Test 5: API-key authentication can use Redis cache
  await t.test('5. API-key authentication can use Redis cache', async () => {
    const keyHash = crypto.createHash('sha256').update(testApiKeyString).digest('hex');
    const cachedData = {
      _id: testApiKeyId,
      userId: testUserId,
      name: 'Cached Test Key',
      rateLimitRps: 20,
      isActive: true
    };
    await redis.setEx(`apikey:${keyHash}`, 300, JSON.stringify(cachedData));

    let mongoQueried = false;
    const originalFindOne = ApiKey.findOne;
    ApiKey.findOne = async () => {
      mongoQueried = true;
      return null;
    };

    try {
      const req = {
        header: (h) => (h === 'x-api-key' ? testApiKeyString : null),
        headers: { 'x-api-key': testApiKeyString }
      };
      let nextCalled = false;
      const res = { status: () => ({ json: () => {} }) };

      await verifyGatewayKey(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(mongoQueried, false, 'MongoDB must NOT be queried when API key is cached in Redis');
      assert.strictEqual(req.userId, testUserId);
      assert.strictEqual(req.gatewayKey._id, testApiKeyId);
      assert.strictEqual(req.gatewayKey.rateLimitRps, 20);
    } finally {
      ApiKey.findOne = originalFindOne;
      await redis.del(`apikey:${keyHash}`);
    }
  });

  // Test 6: API-key Redis cache miss correctly falls back to MongoDB
  await t.test('6. API-key Redis cache miss correctly falls back to MongoDB and caches in Redis', async () => {
    const keyHash = crypto.createHash('sha256').update(testApiKeyString).digest('hex');
    await redis.del(`apikey:${keyHash}`);

    let mongoCalled = false;
    const originalFindOne = ApiKey.findOne;
    ApiKey.findOne = async (query) => {
      if (query.key === testApiKeyString) {
        mongoCalled = true;
        return {
          _id: testApiKeyId,
          userId: testUserId,
          name: 'Fallback Key',
          rateLimitRps: 15,
          isActive: true
        };
      }
      return null;
    };

    try {
      const req = {
        header: (h) => (h === 'x-api-key' ? testApiKeyString : null),
        headers: { 'x-api-key': testApiKeyString }
      };
      let nextCalled = false;
      const res = { status: () => ({ json: () => {} }) };

      await verifyGatewayKey(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(mongoCalled, true, 'MongoDB must be called on Redis cache miss');
      assert.strictEqual(req.userId, testUserId);

      // Verify that Redis was populated
      const inRedis = await redis.get(`apikey:${keyHash}`);
      assert.ok(inRedis, 'API key data should now be cached in Redis');
      const parsed = JSON.parse(inRedis);
      assert.strictEqual(parsed._id, testApiKeyId);
    } finally {
      ApiKey.findOne = originalFindOne;
      await redis.del(`apikey:${keyHash}`);
    }
  });

  // Test 7: Redis API-key usage counter increments atomically
  await t.test('7. Redis API-key usage counter increments atomically', async () => {
    const usageKey = `apikey:usage:${testApiKeyId}`;
    await redis.del(usageKey);

    const originalFindOne = ApiKey.findOne;
    ApiKey.findOne = async () => ({
      _id: testApiKeyId,
      userId: testUserId,
      name: 'Counter Key',
      rateLimitRps: 10,
      isActive: true
    });

    try {
      const req = {
        header: (h) => (h === 'x-api-key' ? testApiKeyString : null),
        headers: { 'x-api-key': testApiKeyString }
      };
      const res = { status: () => ({ json: () => {} }) };

      await verifyGatewayKey(req, res, () => {});
      await verifyGatewayKey(req, res, () => {});
      await verifyGatewayKey(req, res, () => {});

      const currentCount = parseInt(await redis.get(usageKey), 10);
      assert.strictEqual(currentCount, 3, 'Usage counter should be incremented atomically to 3');
    } finally {
      ApiKey.findOne = originalFindOne;
      await redis.del(usageKey);
    }
  });

  // Test 8: API-key authentication does not synchronously call keyDoc.save()
  await t.test('8. API-key authentication does not synchronously call keyDoc.save()', async () => {
    let saveCalled = false;
    const originalFindOne = ApiKey.findOne;
    ApiKey.findOne = async () => ({
      _id: testApiKeyId,
      userId: testUserId,
      name: 'No Save Key',
      rateLimitRps: 10,
      isActive: true,
      usageCount: 0,
      save: async () => {
        saveCalled = true;
      }
    });

    try {
      const keyHash = crypto.createHash('sha256').update(testApiKeyString).digest('hex');
      await redis.del(`apikey:${keyHash}`);

      const req = {
        header: (h) => (h === 'x-api-key' ? testApiKeyString : null),
        headers: { 'x-api-key': testApiKeyString }
      };
      let nextCalled = false;
      const res = { status: () => ({ json: () => {} }) };

      await verifyGatewayKey(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(saveCalled, false, 'keyDoc.save() MUST NOT be called in verifyGatewayKey');
    } finally {
      ApiKey.findOne = originalFindOne;
    }
  });

  // Test 9: CacheRule can be loaded from Redis
  await t.test('9. CacheRule can be loaded from Redis', async () => {
    const fakeRule = {
      _id: '607f1f77bcf86cd799439088',
      userId: testUserId,
      provider: 'stripe',
      endpoint: '/v1/charges',
      ttlSeconds: 1200,
      isActive: true
    };

    await setCachedRule(testUserId, 'stripe', '/v1/charges', fakeRule);

    let mongoCalled = false;
    const originalFindOne = CacheRule.findOne;
    CacheRule.findOne = () => {
      mongoCalled = true;
      return { lean: async () => null };
    };

    try {
      const rule = await getCachedRule(testUserId, 'stripe', '/v1/charges');
      assert.ok(rule);
      assert.strictEqual(rule.ttlSeconds, 1200);
      assert.strictEqual(rule.provider, 'stripe');
      assert.strictEqual(mongoCalled, false, 'CacheRule should be loaded from Redis without hitting MongoDB');
    } finally {
      CacheRule.findOne = originalFindOne;
      await invalidateCachedRule(testUserId, 'stripe', '/v1/charges');
    }
  });

  // Test 10: CacheRule changes invalidate/update Redis configuration
  await t.test('10. CacheRule changes invalidate/update Redis configuration', async () => {
    const rule = {
      _id: '607f1f77bcf86cd799439077',
      userId: testUserId,
      provider: 'openai',
      endpoint: '/v1/chat/completions',
      ttlSeconds: 600,
      isActive: true
    };

    await setCachedRule(testUserId, 'openai', '/v1/chat/completions', rule);
    const cachedBefore = await getCachedRule(testUserId, 'openai', '/v1/chat/completions');
    assert.strictEqual(cachedBefore.ttlSeconds, 600);

    // Invalidate
    await invalidateCachedRule(testUserId, 'openai', '/v1/chat/completions');

    const key = getRuleCacheKey(testUserId, 'openai', '/v1/chat/completions');
    const inRedis = await redis.get(key);
    assert.strictEqual(inRedis, null, 'CacheRule entry in Redis must be deleted upon invalidation');
  });

  // Test 11: Redis failure does not crash authentication
  await t.test('11. Redis failure does not crash authentication', async () => {
    const originalGet = redis.get;
    redis.get = async () => {
      throw new Error('Redis connection timed out');
    };

    const originalFindOne = ApiKey.findOne;
    ApiKey.findOne = async () => ({
      _id: testApiKeyId,
      userId: testUserId,
      name: 'Resilient Key',
      rateLimitRps: 10,
      isActive: true
    });

    try {
      const req = {
        header: (h) => (h === 'x-api-key' ? testApiKeyString : null),
        headers: { 'x-api-key': testApiKeyString }
      };
      let nextCalled = false;
      let errorResponse = null;
      const res = {
        status: (code) => ({
          json: (data) => { errorResponse = { code, data }; }
        })
      };

      await verifyGatewayKey(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true, 'Authentication must proceed via MongoDB fallback on Redis failure');
      assert.strictEqual(errorResponse, null);
    } finally {
      redis.get = originalGet;
      ApiKey.findOne = originalFindOne;
    }
  });

  // Test 12: Redis failure does not crash cache-rule lookup
  await t.test('12. Redis failure does not crash cache-rule lookup', async () => {
    const originalGet = redis.get;
    redis.get = async () => {
      throw new Error('Redis cluster unreachable');
    };

    const originalFindOne = CacheRule.findOne;
    CacheRule.findOne = () => ({
      lean: async () => ({
        _id: '607f1f77bcf86cd799439066',
        userId: testUserId,
        provider: 'openai',
        endpoint: '/v1/chat/completions',
        ttlSeconds: 300,
        isActive: true
      })
    });

    try {
      const rule = await getCachedRule(testUserId, 'openai', '/v1/chat/completions');
      assert.ok(rule, 'Cache rule must be retrieved from MongoDB on Redis failure');
      assert.strictEqual(rule.ttlSeconds, 300);
    } finally {
      redis.get = originalGet;
      CacheRule.findOne = originalFindOne;
    }
  });

  // Test 13: User-specific optimization settings do not mutate global process configuration
  await t.test('13. User-specific optimization settings do not mutate global process configuration', async () => {
    const initialEnvMode = process.env.OPTIMIZATION_MODE || 'recommendation';

    // Mock User database store
    const userStore = {
      [testUserId]: { _id: testUserId, optimizationSettings: {} },
      [testUserId2]: { _id: testUserId2, optimizationSettings: {} }
    };

    const originalFindById = User.findById;
    User.findById = async (id) => {
      const u = userStore[id.toString()];
      if (!u) return null;
      return {
        _id: u._id,
        optimizationSettings: u.optimizationSettings ? { ...u.optimizationSettings } : {},
        save: async function() {
          userStore[id.toString()].optimizationSettings = { ...this.optimizationSettings };
        }
      };
    };

    try {
      // User 1 updates settings to automatic
      const req1 = {
        user: { _id: testUserId },
        body: { optimizationMode: 'automatic', automaticRoutingAllowed: true, defaultStrategy: 'latency' }
      };
      let res1Data = null;
      const res1 = { status: () => ({ json: (d) => { res1Data = d; } }) };

      await updateSettings(req1, res1);

      assert.strictEqual(res1Data.success, true);
      assert.strictEqual(res1Data.data.optimizationMode, 'automatic');
      assert.strictEqual(res1Data.data.defaultStrategy, 'latency');

      // Verify process.env was NOT mutated
      assert.strictEqual(process.env.OPTIMIZATION_MODE || 'recommendation', initialEnvMode, 'process.env.OPTIMIZATION_MODE must not be mutated');

      // Verify User 2 gets their own default settings, not User 1's
      const req2 = { user: { _id: testUserId2 } };
      let res2Data = null;
      const res2 = { status: () => ({ json: (d) => { res2Data = d; } }) };

      await getSettings(req2, res2);

      assert.strictEqual(res2Data.success, true);
      assert.strictEqual(res2Data.data.optimizationMode, 'recommendation', 'User 2 must have independent default settings');
      assert.strictEqual(res2Data.data.defaultStrategy, 'balanced');
    } finally {
      User.findById = originalFindById;
    }
  });

  // Test 14, 15, 16: Upstream timeouts for OpenAI, Gemini, Anthropic
  // Restore real simulateApiCall for timeout tests
  externalApiService.simulateApiCall = originalSimulateApiCall;

  await t.test('14. OpenAI timeout is classified with 504 and shouldRetry=true', async () => {
    const originalFetch = global.fetch;
    const ProviderKey = require('../models/ProviderKey');
    const originalKeyFindOne = ProviderKey.findOne;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'sk-real-test-key-for-timeout-check'
    });

    global.fetch = async (url, opts) => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    try {
      await externalApiService.simulateApiCall(
        'openai',
        '/v1/chat/completions',
        'POST',
        { messages: [{ role: 'user', content: 'test timeout' }] },
        {},
        testUserId,
        'openai',
        { timeoutMs: 100 }
      );
      assert.fail('Expected simulateApiCall to throw a ProviderError on timeout');
    } catch (err) {
      assert.strictEqual(err.name, 'ProviderError');
      assert.strictEqual(err.statusCode, 504);
      assert.strictEqual(err.errorClass, 'timeout');
      assert.strictEqual(err.shouldRetry, true);
      assert.ok(!err.message.includes('sk-real'), 'Must not expose secret API key');
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalKeyFindOne;
    }
  });

  await t.test('15. Gemini timeout is classified with 504 and shouldRetry=true', async () => {
    const originalFetch = global.fetch;
    const ProviderKey = require('../models/ProviderKey');
    const originalKeyFindOne = ProviderKey.findOne;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'real-gemini-test-key-timeout'
    });

    global.fetch = async (url, opts) => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    try {
      await externalApiService.simulateApiCall(
        'gemini',
        '/v1/models/gemini-1.5-flash:generateContent',
        'POST',
        { contents: [{ parts: [{ text: 'test timeout' }] }] },
        {},
        testUserId,
        'gemini',
        { timeoutMs: 100 }
      );
      assert.fail('Expected simulateApiCall to throw a ProviderError on timeout');
    } catch (err) {
      assert.strictEqual(err.name, 'ProviderError');
      assert.strictEqual(err.statusCode, 504);
      assert.strictEqual(err.errorClass, 'timeout');
      assert.strictEqual(err.shouldRetry, true);
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalKeyFindOne;
    }
  });

  await t.test('16. Anthropic timeout is classified with 504 and shouldRetry=true', async () => {
    const originalFetch = global.fetch;
    const ProviderKey = require('../models/ProviderKey');
    const originalKeyFindOne = ProviderKey.findOne;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'sk-ant-real-test-key-timeout'
    });

    global.fetch = async (url, opts) => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    try {
      await externalApiService.simulateApiCall(
        'anthropic',
        '/v1/messages',
        'POST',
        { model: 'claude-3-5-sonnet-20241022', messages: [{ role: 'user', content: 'test timeout' }] },
        {},
        testUserId,
        'anthropic',
        { timeoutMs: 100 }
      );
      assert.fail('Expected simulateApiCall to throw a ProviderError on timeout');
    } catch (err) {
      assert.strictEqual(err.name, 'ProviderError');
      assert.strictEqual(err.statusCode, 504);
      assert.strictEqual(err.errorClass, 'timeout');
      assert.strictEqual(err.shouldRetry, true);
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalKeyFindOne;
    }
  });

  // Test 17: Existing retry behavior still works after timeout support
  await t.test('17. Existing retry behavior retries on timeout and succeeds on subsequent attempt', async () => {
    let callCount = 0;
    const originalSimulate = externalApiService.simulateApiCall;

    externalApiService.simulateApiCall = async () => {
      callCount++;
      if (callCount === 1) {
        const timeoutErr = new Error('Upstream provider timed out');
        timeoutErr.status = 504;
        timeoutErr.shouldRetry = true;
        throw timeoutErr;
      }
      return {
        data: { id: 'retry_success_resp', choices: [{ message: { content: 'Succeeded on retry' } }] },
        tokensUsed: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        model: 'gpt-4o'
      };
    };

    try {
      const req = {
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'retry test' }] },
        headers: {},
        query: {},
        userId: testUserId,
        gatewayKey: { _id: testApiKeyId, key: testApiKeyString, rateLimitRps: 10 }
      };

      let responseStatus = null;
      let responseJson = null;
      const res = {
        setHeader: () => {},
        status: (code) => {
          responseStatus = code;
          return {
            json: (data) => {
              responseJson = data;
              return data;
            }
          };
        }
      };

      await handleGatewayRequest(req, res);

      assert.strictEqual(callCount, 2, 'Should have retried after initial timeout and succeeded on attempt 2');
      assert.strictEqual(responseStatus, 200);
      assert.strictEqual(responseJson.id, 'retry_success_resp');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
      RequestLog.create = originalRequestLogCreate;
      externalApiService.simulateApiCall = originalSimulateApiCall;
    }
  });

  await cleanup();
});
