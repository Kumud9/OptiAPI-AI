'use strict';

const test = require('node:test');
const assert = require('node:assert');

const gatewayController = require('../controllers/gatewayController');
const optimizationDecisionService = require('../services/optimizationDecisionService');
const RequestLog = require('../models/RequestLog');
const CacheRule = require('../models/CacheRule');
const externalApiService = require('../services/externalApiService');

// Store original methods
const originalGetOptimizationDecision = optimizationDecisionService.getOptimizationDecision;
const originalRequestLogCreate = RequestLog.create;
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

test('OptiAPI E2E Adapter Execution Flows', async (t) => {
  let simulateCallCount = 0;
  let lastSimulateArgs = null;
  let logCallCount = 0;
  let lastLoggedRecord = null;

  t.before(() => {
    CacheRule.findOne = async () => null;

    RequestLog.create = async (record) => {
      logCallCount++;
      lastLoggedRecord = record;
      return record;
    };

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider) => {
      simulateCallCount++;
      lastSimulateArgs = { provider, endpoint, method, body, headers, userId, inputProvider };
      
      const targetAdapter = require('../adapters').getAdapter(provider);
      const inputAdapter = require('../adapters').getAdapter(inputProvider || provider);
      
      // Stub simulated response through real adapter pipeline
      const canonical = inputAdapter.normalizeRequest(body, endpoint);
      const providerRequest = targetAdapter.toProviderRequest(canonical, canonical.model);
      
      let mockData = {};
      if (provider === 'gemini') {
        mockData = {
          candidates: [{ content: { parts: [{ text: 'Adapted Gemini response text' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
        };
      } else {
        mockData = {
          id: 'chatcmpl-mock',
          choices: [{ message: { role: 'assistant', content: 'Mock response text' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        };
      }

      const canonicalResponse = targetAdapter.normalizeResponse(mockData, canonical.model);
      const clientResponse = inputAdapter.toClientResponse(canonicalResponse);

      return {
        data: clientResponse,
        tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: canonical.model || 'mock-model',
        latency: 50
      };
    };
  });

  t.after(() => {
    optimizationDecisionService.getOptimizationDecision = originalGetOptimizationDecision;
    RequestLog.create = originalRequestLogCreate;
    CacheRule.findOne = originalCacheRuleFindOne;
    externalApiService.simulateApiCall = originalSimulateApiCall;
  });

  const resetSpies = () => {
    simulateCallCount = 0;
    lastSimulateArgs = null;
    logCallCount = 0;
    lastLoggedRecord = null;
  };

  await t.test('Case 1: Recommendation mode - OpenAI requested → Gemini recommended → OpenAI executed', async () => {
    resetSpies();
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'recommendation';

    optimizationDecisionService.getOptimizationDecision = async () => ({
      success: true,
      decision: {
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        endpoint: '/v1/models/gemini-1.5-flash:generateContent',
        score: 95.0,
        confidence: 0.9,
        costScore: 98,
        latencyScore: 92,
        reliabilityScore: 95
      },
      metrics: { successfulRequests: 10 }
    });

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
    assert.strictEqual(lastSimulateArgs.provider, 'openai');
    
    assert.ok(lastLoggedRecord);
    assert.strictEqual(lastLoggedRecord.provider, 'openai');
    assert.strictEqual(lastLoggedRecord.inputProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.requestedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.recommendedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.actualProvider, 'openai');
  });

  await t.test('Case 2: Automatic mode - OpenAI requested → Gemini recommended → Gemini executed with adapter', async () => {
    resetSpies();
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'automatic';

    optimizationDecisionService.getOptimizationDecision = async () => ({
      success: true,
      decision: {
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        endpoint: '/v1/models/gemini-1.5-flash:generateContent',
        score: 95.0,
        confidence: 0.9,
        costScore: 98,
        latencyScore: 92,
        reliabilityScore: 95
      },
      metrics: { successfulRequests: 10 }
    });

    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test message' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'gemini');
    
    assert.ok(lastLoggedRecord);
    assert.strictEqual(lastLoggedRecord.provider, 'gemini');
    assert.strictEqual(lastLoggedRecord.inputProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.requestedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.recommendedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.actualProvider, 'gemini');
  });

  await t.test('Case 3: Capability validation rejection in Automatic mode', async () => {
    resetSpies();
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'automatic';

    // Reroute to Gemini
    optimizationDecisionService.getOptimizationDecision = async () => ({
      success: true,
      decision: {
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        endpoint: '/v1/models/gemini-1.5-flash:generateContent',
        score: 95.0,
        confidence: 0.9
      },
      metrics: { successfulRequests: 10 }
    });

    // OpenAI request demanding streaming (unsupported)
    const req = {
      params: { provider: 'openai', 0: '/v1/chat/completions' },
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }], stream: true },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    // Re-enable real simulateApiCall execution for testing capability validation error throwing
    externalApiService.simulateApiCall = originalSimulateApiCall;

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 502);
    assert.ok(res.body.message.includes('CapabilityError'));
  });
});
