'use strict';

const test = require('node:test');
const assert = require('node:assert');

const gatewayController = require('../controllers/gatewayController');
const optimizationDecisionService = require('../services/optimizationDecisionService');
const RequestLog = require('../models/RequestLog');
const ProviderKey = require('../models/ProviderKey');
const CacheRule = require('../models/CacheRule');
const externalApiService = require('../services/externalApiService');
const { getRedisClient } = require('../config/redis');

// Store original methods
const originalGetOptimizationDecision = optimizationDecisionService.getOptimizationDecision;
const originalRequestLogCreate = RequestLog.create;
const originalProviderKeyFindOne = ProviderKey.findOne;
const originalCacheRuleFindOne = CacheRule.findOne;
const originalSimulateApiCall = externalApiService.simulateApiCall;

// Mock Response Builder
function createMockResponse() {
  const res = {
    statusVal: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusVal = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    }
  };
  return res;
}

test('Gateway Optimization Integration Tests - Phase 6B', async (t) => {
  let simulateCallCount = 0;
  let lastSimulateArgs = null;

  let originalEnvMode;

  t.before(() => {
    originalEnvMode = process.env.OPTIMIZATION_MODE;
    process.env.OPTIMIZATION_MODE = 'automatic';

    // Disable DB writes and lookups to prevent buffering timeouts
    RequestLog.create = async () => ({});
    ProviderKey.findOne = async () => null;
    CacheRule.findOne = async () => null;

    // Spy on simulateApiCall (stub out retry failure triggers by always succeeding)
    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId) => {
      simulateCallCount++;
      lastSimulateArgs = { provider, endpoint, method, body, headers, userId };
      return {
        data: { text: 'Mocked API response' },
        tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: body?.model || 'mock-model',
        latency: 150
      };
    };
  });

  t.after(() => {
    process.env.OPTIMIZATION_MODE = originalEnvMode;
    // Restore originals
    optimizationDecisionService.getOptimizationDecision = originalGetOptimizationDecision;
    RequestLog.create = originalRequestLogCreate;
    ProviderKey.findOne = originalProviderKeyFindOne;
    CacheRule.findOne = originalCacheRuleFindOne;
    externalApiService.simulateApiCall = originalSimulateApiCall;
  });

  // Helper to reset counters before each test run manually
  const resetSpy = () => {
    simulateCallCount = 0;
    lastSimulateArgs = null;
  };

  await t.test('1. Optimization OFF → existing routing unchanged', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'false';

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(req.body.model, undefined); // Unchanged
    assert.strictEqual(req.optimization.optimizationEnabled, false);
    assert.strictEqual(req.optimization.optimizationUsed, false);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
  });

  await t.test('2. Optimization ON + Gemini recommendation → Gemini adapter called', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async (userId, mode) => {
      return {
        success: true,
        decision: {
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          endpoint: '/v1/models/gemini-1.5-flash:generateContent'
        },
        metrics: { successfulRequests: 10 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'gemini');
    assert.strictEqual(lastSimulateArgs.endpoint, '/v1/models/gemini-1.5-flash:generateContent');
  });

  await t.test('3. Optimization ON + OpenAI recommendation → OpenAI adapter called', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async (userId, mode) => {
      return {
        success: true,
        decision: {
          provider: 'openai',
          model: 'gpt-4o',
          endpoint: '/v1/chat/completions'
        },
        metrics: { successfulRequests: 15 }
      };
    };

    const req = {
      params: { provider: 'gemini', 0: '/v1/models/gemini-1.5-flash:generateContent' },
      method: 'POST',
      body: { contents: [{ parts: [{ text: 'hello' }] }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    assert.strictEqual(lastSimulateArgs.body.model, 'gpt-4o');
  });

  await t.test('4. Cross-provider recommendation changes provider correctly', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async (userId, mode) => {
      return {
        success: true,
        decision: {
          provider: 'gemini',
          model: 'gemini-1.5-pro',
          endpoint: '/v1/models/gemini-1.5-pro:generateContent'
        },
        metrics: { successfulRequests: 8 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(lastSimulateArgs.provider, 'gemini');
    assert.strictEqual(lastSimulateArgs.endpoint, '/v1/models/gemini-1.5-pro:generateContent');
  });

  await t.test('5. Same-provider recommendation still works', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async (userId, mode) => {
      return {
        success: true,
        decision: {
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          endpoint: '/v1/chat/completions'
        },
        metrics: { successfulRequests: 20 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    assert.strictEqual(lastSimulateArgs.body.model, 'gpt-3.5-turbo');
  });

  await t.test('6. INSUFFICIENT_DATA → original provider used', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: false,
        code: 'INSUFFICIENT_DATA',
        message: 'Not enough data'
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('7. Decision engine error → original provider used', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      throw new Error('Database connection failed');
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('8. Invalid recommendation → original provider used', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'openai',
          model: '', // Invalid model
          endpoint: ''
        },
        metrics: { successfulRequests: 10 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('9. Unsupported provider recommendation → original provider used', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'stripe', // Unsupported LLM provider
          model: 'custom',
          endpoint: '/v1/charges'
        },
        metrics: { successfulRequests: 10 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('10. Non-optimizable provider such as Stripe → completely unaffected', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    let decisionCalled = false;
    optimizationDecisionService.getOptimizationDecision = async () => {
      decisionCalled = true;
      return null;
    };

    const req = {
      params: { provider: 'stripe', 0: '/v1/charges' },
      method: 'POST',
      body: { amount: 2000 },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(decisionCalled, false);
    assert.strictEqual(lastSimulateArgs.provider, 'stripe');
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('11. Optimization metadata is correct', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          endpoint: '/v1/models/gemini-1.5-flash:generateContent'
        },
        metrics: { successfulRequests: 12 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(req.optimization.optimizationEnabled, true);
    assert.strictEqual(req.optimization.optimizationSelectedProvider, 'gemini');
    assert.strictEqual(req.optimization.optimizationSelectedModel, 'gemini-1.5-flash');
    assert.strictEqual(req.optimization.optimizationMode, 'balanced');
    assert.strictEqual(req.optimization.optimizationUsed, true);
  });

  await t.test('12. Authenticated user ID is passed to decision engine', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    let passedUserId = null;
    optimizationDecisionService.getOptimizationDecision = async (userId) => {
      passedUserId = userId;
      return null;
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: 'user_9999'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(passedUserId, 'user_9999');
  });

  await t.test('13. Provider adapter is called only once', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          endpoint: '/v1/models/gemini-1.5-flash:generateContent'
        },
        metrics: { successfulRequests: 10 }
      };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(simulateCallCount, 1);
  });

  await t.test('14. Existing cache/routing behavior remains intact', async () => {
    resetSpy();
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          endpoint: '/v1/models/gemini-1.5-flash:generateContent'
        },
        metrics: { successfulRequests: 10 }
      };
    };

    const redis = getRedisClient();
    
    // We mock the cache search behavior in Redis for the new routed destination.
    const originalGet = redis.get;
    redis.get = async (key) => {
      if (key.includes('gemini') && key.includes('gemini-1.5-flash')) {
        return JSON.stringify({ cachedData: 'Cached response from Gemini!' });
      }
      return null;
    };

    // Mock cache rule matching
    CacheRule.findOne = async () => {
      return { ttlSeconds: 300 };
    };

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    // Restore redis and cache rule mocks
    redis.get = originalGet;
    CacheRule.findOne = async () => null; // Restore default stub

    assert.strictEqual(res.statusVal, 200);
    assert.deepStrictEqual(res.body, { cachedData: 'Cached response from Gemini!' });
    assert.strictEqual(res.headers['X-OptiAPI-Cache'], 'HIT');
    assert.strictEqual(simulateCallCount, 0); // No API adapter call because of cache hit!
  });
});
