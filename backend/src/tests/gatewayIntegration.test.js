'use strict';

const test = require('node:test');
const assert = require('node:assert');

const gatewayController = require('../controllers/gatewayController');
const optimizationDecisionService = require('../services/optimizationDecisionService');
const RequestLog = require('../models/RequestLog');
const ProviderKey = require('../models/ProviderKey');

// Store original methods
const originalGetOptimizationDecision = optimizationDecisionService.getOptimizationDecision;
const originalRequestLogCreate = RequestLog.create;
const originalProviderKeyFindOne = ProviderKey.findOne;

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

test('Gateway Optimization Integration Tests', async (t) => {
  t.before(() => {
    // Disable DB log writes
    RequestLog.create = async () => ({});
    // Disable vault findOne to prevent buffering timeouts
    ProviderKey.findOne = async () => null;
  });

  t.after(() => {
    // Restore originals
    optimizationDecisionService.getOptimizationDecision = originalGetOptimizationDecision;
    RequestLog.create = originalRequestLogCreate;
    ProviderKey.findOne = originalProviderKeyFindOne;
  });

  await t.test('1. Optimization OFF → unchanged routing', async () => {
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
  });

  await t.test('2. Optimization ON + valid same-provider recommendation → selected model used', async () => {
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async (userId, mode, providers) => {
      return {
        success: true,
        decision: {
          provider: 'openai',
          model: 'gpt-3.5-turbo'
        }
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
    assert.strictEqual(req.body.model, 'gpt-3.5-turbo'); // Override applied!
    assert.strictEqual(req.optimization.optimizationEnabled, true);
    assert.strictEqual(req.optimization.optimizationUsed, true);
    assert.strictEqual(req.optimization.optimizationSelectedModel, 'gpt-3.5-turbo');
  });

  await t.test('3. Insufficient data → original routing fallback', async () => {
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return null;
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
    assert.strictEqual(req.body.model, undefined); // No override (original fallback)
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('4. Decision engine error → original routing fallback', async () => {
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
    assert.strictEqual(req.body.model, undefined); // Falls back safely
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('5. Different-provider recommendation → original routing fallback', async () => {
    process.env.OPTIMIZATION_ENABLED = 'true';

    optimizationDecisionService.getOptimizationDecision = async () => {
      return {
        success: true,
        decision: {
          provider: 'gemini',
          model: 'gemini-1.5-flash'
        }
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
    assert.strictEqual(req.body.model, undefined); // Falls back to default model
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });

  await t.test('6. Stripe/non-optimizable provider → completely unaffected', async () => {
    process.env.OPTIMIZATION_ENABLED = 'true';

    let decisionCalled = false;
    optimizationDecisionService.getOptimizationDecision = async () => {
      decisionCalled = true;
      return {
        success: true,
        decision: {
          provider: 'stripe',
          model: 'custom'
        }
      };
    };

    const req = {
      params: { provider: 'stripe', 0: '/v1/customers' },
      method: 'POST',
      body: { email: 'stripe@test.com' },
      headers: {},
      userId: '507f1f77bcf86cd799439011'
    };
    const res = createMockResponse();

    await gatewayController.handleGatewayRequest(req, res);

    assert.strictEqual(res.statusVal, 200);
    assert.strictEqual(decisionCalled, false); // Never called decision engine for stripe!
    assert.strictEqual(req.optimization.optimizationEnabled, true);
    assert.strictEqual(req.optimization.optimizationUsed, false);
  });
});
