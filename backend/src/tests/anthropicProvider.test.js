'use strict';

const test = require('node:test');
const assert = require('node:assert');


const externalApiService = require('../services/externalApiService');
const gatewayController = require('../controllers/gatewayController');
const optimizationDecisionService = require('../services/optimizationDecisionService');
const ProviderKey = require('../models/ProviderKey');
const ProviderModel = require('../models/ProviderModel');
const RequestLog = require('../models/RequestLog');
const CacheRule = require('../models/CacheRule');

const User = require('../models/User');

// Backup globals
const originalGlobalFetch = globalThis.fetch;
const originalProviderKeyFindOne = ProviderKey.findOne;
const originalProviderKeyFind = ProviderKey.find;
const originalProviderModelFind = ProviderModel.find;
const originalRequestLogCreate = RequestLog.create;
const originalRequestLogFind = RequestLog.find;
const originalCacheRuleFindOne = CacheRule.findOne;
const originalUserFindById = User.findById;

// Mock Response Helper
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

test('Anthropic Provider and Gateway Integration Tests', async (t) => {
  let fetchCalled = false;
  let fetchUrl = '';
  let fetchOptions = null;
  let fetchMockResponse = {
    status: 200,
    ok: true,
    json: async () => ({
      id: 'msg_test123',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 15,
        output_tokens: 25
      },
      content: [{ type: 'text', text: 'Hello from mocked Claude!' }]
    }),
    text: async () => 'Error response content'
  };

  let originalEnvMode;

  t.before(() => {
    originalEnvMode = process.env.OPTIMIZATION_MODE;
    // Disable DB log writes and lookups
    RequestLog.create = async () => ({});
    RequestLog.find = () => ({ lean: async () => [] });
    CacheRule.findOne = async () => null;
    User.findById = async () => ({ role: 'user' });
    ProviderKey.find = async () => [];
    ProviderModel.find = async () => [];

    // Global fetch mock
    globalThis.fetch = async (url, options) => {
      fetchCalled = true;
      fetchUrl = url;
      fetchOptions = options;
      return fetchMockResponse;
    };
  });

  t.beforeEach(() => {
    fetchCalled = false;
    fetchUrl = '';
    fetchOptions = null;
    fetchMockResponse = {
      status: 200,
      ok: true,
      json: async () => ({
        id: 'msg_test123',
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 15,
          output_tokens: 25
        },
        content: [{ type: 'text', text: 'Hello from mocked Claude!' }]
      }),
      text: async () => 'Error response content'
    };
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'automatic';
  });

  t.after(() => {
    process.env.OPTIMIZATION_MODE = originalEnvMode;
    globalThis.fetch = originalGlobalFetch;
    ProviderKey.findOne = originalProviderKeyFindOne;
    ProviderKey.find = originalProviderKeyFind;
    ProviderModel.find = originalProviderModelFind;
    RequestLog.create = originalRequestLogCreate;
    RequestLog.find = originalRequestLogFind;
    CacheRule.findOne = originalCacheRuleFindOne;
    User.findById = originalUserFindById;
  });

  await t.test('1. Anthropic ProviderKey lookup & decryption', async () => {
    let lookupCalled = false;
    ProviderKey.findOne = async (query) => {
      if (query.provider === 'anthropic' && query.userId === 'user_123') {
        lookupCalled = true;
        return {
          getDecryptedValue: () => 'sk-ant-test-key-xyz'
        };
      }
      return null;
    };

    const result = await externalApiService.simulateApiCall(
      'anthropic',
      '/v1/messages',
      'POST',
      { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }] },
      {},
      'user_123'
    );

    assert.strictEqual(lookupCalled, true);
    assert.strictEqual(fetchCalled, true);
    assert.strictEqual(fetchOptions.headers['x-api-key'], 'sk-ant-test-key-xyz');
    assert.strictEqual(fetchOptions.headers['anthropic-version'], '2023-06-01');
  });

  await t.test('2. Successful Anthropic response normalization & token parsing', async () => {
    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'test-key'
    });

    const result = await externalApiService.simulateApiCall(
      'anthropic',
      '/v1/messages',
      'POST',
      { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'Hi' }] },
      {},
      'user_123'
    );

    assert.deepStrictEqual(result.tokensUsed, {
      promptTokens: 15,
      completionTokens: 25,
      totalTokens: 40
    });
    assert.strictEqual(result.model, 'claude-sonnet-4-6');
    assert.strictEqual(result.data.content[0].text, 'Hello from mocked Claude!');
    assert.ok(result.latency >= 0);
  });

  await t.test('3. Anthropic API error handling (non-2xx response)', async () => {
    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'test-key'
    });

    fetchMockResponse = {
      status: 400,
      ok: false,
      text: async () => 'Overloaded or invalid parameters'
    };

    await assert.rejects(
      async () => {
        await externalApiService.simulateApiCall(
          'anthropic',
          '/v1/messages',
          'POST',
          { model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'Hi' }] },
          {},
          'user_123'
        );
      },
      (err) => {
        assert.ok(err.message.includes('Anthropic Provider HTTP Error 400'));
        assert.ok(err.message.includes('Overloaded or invalid parameters'));
        assert.ok(!err.message.includes('test-key'));
        return true;
      }
    );
  });

  await t.test('4. Missing Anthropic key throws clean error without simulated fallback', async () => {
    ProviderKey.findOne = async () => null;

    await assert.rejects(
      async () => {
        await externalApiService.simulateApiCall(
          'anthropic',
          '/v1/messages',
          'POST',
          { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }] },
          {},
          'user_123'
        );
      },
      (err) => {
        assert.strictEqual(err.message, "ConfigurationError: Active API key for provider 'anthropic' not found in vault");
        return true;
      }
    );
    assert.strictEqual(fetchCalled, false);
  });

  await t.test('5. Gateway routes Anthropic correctly', async () => {
    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'test-key'
    });

    const req = {
      params: { provider: 'anthropic', 0: '/v1/messages' },
      method: 'POST',
      body: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(res.body.id, 'msg_test123');
    assert.strictEqual(fetchCalled, true);
    assert.strictEqual(fetchUrl, 'https://api.anthropic.com/v1/messages');
  });

  await t.test('6. Optimization engine accepts Anthropic candidate', async () => {
    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'test-key'
    });

    const originalGetDecision = optimizationDecisionService.getOptimizationDecision;
    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          endpoint: '/v1/messages'
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

    optimizationDecisionService.getOptimizationDecision = originalGetDecision;

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(req.optimization.optimizationSelectedProvider, 'anthropic');
    assert.strictEqual(req.optimization.optimizationSelectedModel, 'claude-haiku-4-5-20251001');
    assert.strictEqual(req.optimization.optimizationUsed, true);
    assert.strictEqual(fetchCalled, true);
    assert.strictEqual(fetchUrl, 'https://api.anthropic.com/v1/messages');
  });

  await t.test('7. Existing Gemini/OpenAI behavior remains unchanged when optimization is OFF', async () => {
    process.env.OPTIMIZATION_ENABLED = 'false';

    const originalSimulate = externalApiService.simulateApiCall;
    let simulateArgs = null;
    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId) => {
      simulateArgs = { provider, endpoint, body };
      return { data: { simulated: true }, tokensUsed: { totalTokens: 10 }, model: 'test', latency: 50 };
    };

    const req = {
      params: { provider: 'gemini', 0: '/v1/models/gemini-1.5-flash:generateContent' },
      method: 'POST',
      body: { contents: [{ parts: [{ text: 'test' }] }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    externalApiService.simulateApiCall = originalSimulate;

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateArgs.provider, 'gemini');
    assert.strictEqual(req.optimization.optimizationEnabled, false);
  });
});
