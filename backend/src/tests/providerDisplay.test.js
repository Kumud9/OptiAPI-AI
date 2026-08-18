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

test('OptiAPI Execution Modes - Recommendation vs Automatic', async (t) => {
  let simulateCallCount = 0;
  let lastSimulateArgs = null;
  let logCallCount = 0;
  let lastLoggedRecord = null;

  t.before(() => {
    // Disable DB lookups
    CacheRule.findOne = async () => null;

    // Spy on RequestLog.create
    RequestLog.create = async (record) => {
      logCallCount++;
      lastLoggedRecord = record;
      return record;
    };

    // Spy on simulateApiCall
    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId) => {
      simulateCallCount++;
      lastSimulateArgs = { provider, endpoint, method, body, headers, userId };
      return {
        data: { text: 'Mock response' },
        tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: body?.model || 'mock-model',
        latency: 100
      };
    };
  });

  t.after(() => {
    // Restore originals
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

  await t.test('1. Recommendation mode: OpenAI requested → Gemini recommended → OpenAI actually used', async () => {
    resetSpies();
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'recommendation';

    // Mock decision: recommend Gemini
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
    assert.strictEqual(lastSimulateArgs.provider, 'openai'); // OpenAI actually used
    
    assert.ok(lastLoggedRecord);
    assert.strictEqual(lastLoggedRecord.provider, 'openai'); // provider = actual provider
    assert.strictEqual(lastLoggedRecord.requestedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.recommendedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.actualProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.routedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.recommendationScore, 95.0);
  });

  await t.test('2. Recommendation mode: Gemini requested → OpenAI recommended → Gemini actually used', async () => {
    resetSpies();
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'recommendation';

    // Mock decision: recommend OpenAI
    optimizationDecisionService.getOptimizationDecision = async () => ({
      success: true,
      decision: {
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat/completions',
        score: 92.5,
        confidence: 0.85,
        costScore: 90,
        latencyScore: 95,
        reliabilityScore: 93
      },
      metrics: { successfulRequests: 15 }
    });

    const req = {
      params: { provider: 'gemini', 0: '/v1/models/gemini-1.5-flash:generateContent' },
      method: 'POST',
      body: { contents: [{ parts: [{ text: 'test' }] }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'gemini'); // Gemini actually used
    
    assert.ok(lastLoggedRecord);
    assert.strictEqual(lastLoggedRecord.provider, 'gemini');
    assert.strictEqual(lastLoggedRecord.requestedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.recommendedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.actualProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.routedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.recommendationScore, 92.5);
  });

  await t.test('3. Automatic mode: OpenAI requested → Gemini recommended → Gemini selected as actual provider', async () => {
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
      body: { messages: [{ role: 'user', content: 'test' }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'gemini'); // Gemini actually used!
    
    assert.ok(lastLoggedRecord);
    assert.strictEqual(lastLoggedRecord.provider, 'gemini');
    assert.strictEqual(lastLoggedRecord.requestedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.recommendedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.actualProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.routedProvider, 'gemini');
  });

  await t.test('4. Automatic mode: Gemini requested → OpenAI recommended → OpenAI selected as actual provider', async () => {
    resetSpies();
    process.env.OPTIMIZATION_ENABLED = 'true';
    process.env.OPTIMIZATION_MODE = 'automatic';

    optimizationDecisionService.getOptimizationDecision = async () => ({
      success: true,
      decision: {
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat/completions',
        score: 92.5,
        confidence: 0.85,
        costScore: 90,
        latencyScore: 95,
        reliabilityScore: 93
      },
      metrics: { successfulRequests: 15 }
    });

    const req = {
      params: { provider: 'gemini', 0: '/v1/models/gemini-1.5-flash:generateContent' },
      method: 'POST',
      body: { contents: [{ parts: [{ text: 'test' }] }] },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(simulateCallCount, 1);
    assert.strictEqual(lastSimulateArgs.provider, 'openai'); // OpenAI actually used!
    
    assert.ok(lastLoggedRecord);
    assert.strictEqual(lastLoggedRecord.provider, 'openai');
    assert.strictEqual(lastLoggedRecord.requestedProvider, 'gemini');
    assert.strictEqual(lastLoggedRecord.recommendedProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.actualProvider, 'openai');
    assert.strictEqual(lastLoggedRecord.routedProvider, 'openai');
  });
});
