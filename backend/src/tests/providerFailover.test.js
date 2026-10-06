const test = require('node:test');
const assert = require('node:assert');
const {
  CircuitState,
  getCircuitState,
  resetAllCircuits,
  configureCircuit,
  recordFailure
} = require('../services/circuitBreakerService');
const {
  getFailoverCandidates,
  isClientError,
  getEndpointForProvider,
  getDefaultModelForProvider
} = require('../services/failoverService');
const metricsService = require('../services/metricsService');
const externalApiService = require('../services/externalApiService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const RequestLog = require('../models/RequestLog');
const { clearInFlight } = require('../services/requestDeduplicationService');
const { setRoutingPolicy, deleteRoutingPolicy } = require('../services/policyService');

test('Phase 3B: Provider Failover and Graceful Degradation Suite', async (t) => {
  const testUserId = '507f1f77bcf86cd799439055';

  // Mock RequestLog.create to avoid MongoDB requirement
  const originalRequestLogCreate = RequestLog.create;
  RequestLog.create = async () => ({ _id: 'mock_log_id' });

  t.beforeEach(async () => {
    resetAllCircuits();
    clearInFlight();
    metricsService.resetMetrics();
    try {
      await deleteRoutingPolicy(testUserId);
    } catch (_) {}
  });

  t.afterEach(async () => {
    resetAllCircuits();
    clearInFlight();
    metricsService.resetMetrics();
    try {
      await deleteRoutingPolicy(testUserId);
    } catch (_) {}
  });

  t.after(() => {
    RequestLog.create = originalRequestLogCreate;
  });

  // Helper to execute gateway requests in test
  const executeGateway = (req) => {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ statusCode: this.statusCode, headers: this.headers, payload }); }
      };
      handleGatewayRequest(req, res);
    });
  };

  await t.test('1. Primary provider succeeds → no failover', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push({ provider, endpoint });
      return {
        data: { id: 'resp-primary', choices: [{ message: { content: 'Primary response' } }] },
        model: 'gpt-4o',
        tokensUsed: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['X-OptiAPI-Provider'], 'openai');
      assert.strictEqual(res.headers['X-OptiAPI-Failover'], undefined, 'No failover header when primary succeeds');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].provider, 'openai');

      const metrics = metricsService.getMetrics();
      assert.strictEqual(metrics.failover.attempts, 0);
      assert.strictEqual(metrics.failover.successes, 0);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('2. Primary circuit OPEN → secondary provider used', async () => {
    // Open OpenAI's circuit
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 60000 });
    const err = new Error('OpenAI Down');
    err.statusCode = 500;
    recordFailure('openai', err);
    assert.strictEqual(getCircuitState('openai').state, CircuitState.OPEN);

    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push({ provider, endpoint });
      return {
        data: { id: 'resp-gemini', candidates: [{ content: { parts: [{ text: 'Gemini fallback' }] } }] },
        model: 'gemini-1.5-flash',
        tokensUsed: { promptTokens: 8, completionTokens: 4, totalTokens: 12 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'test failover' }] },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['X-OptiAPI-Provider'], 'gemini');
      assert.strictEqual(res.headers['X-OptiAPI-Failover'], 'true');

      // Primary was NEVER called because circuit was OPEN
      assert.strictEqual(calls.some(c => c.provider === 'openai'), false, 'OPEN provider must NEVER be called');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].provider, 'gemini');

      const metrics = metricsService.getMetrics();
      assert.strictEqual(metrics.failover.attempts, 1);
      assert.strictEqual(metrics.failover.successes, 1);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('3. Primary times out/fails → secondary provider used', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push({ provider, endpoint });
      if (provider === 'openai') {
        const timeoutErr = new Error('Upstream provider openai request timed out');
        timeoutErr.statusCode = 504;
        timeoutErr.errorClass = 'timeout';
        throw timeoutErr;
      }
      return {
        data: { id: 'resp-gemini-recovered', text: 'Gemini rescued request' },
        model: 'gemini-1.5-flash',
        tokensUsed: { promptTokens: 6, completionTokens: 6, totalTokens: 12 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'timeout test' }] },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['X-OptiAPI-Provider'], 'gemini');
      assert.strictEqual(res.headers['X-OptiAPI-Failover'], 'true');

      // Primary was attempted with retries, then secondary was attempted and succeeded
      const primaryAttempts = calls.filter(c => c.provider === 'openai').length;
      assert.ok(primaryAttempts >= 1, 'Primary should have been attempted before failover');
      const secondaryAttempts = calls.filter(c => c.provider === 'gemini').length;
      assert.strictEqual(secondaryAttempts, 1, 'Secondary should have been called and succeeded');

      const metrics = metricsService.getMetrics();
      assert.strictEqual(metrics.failover.attempts, 1);
      assert.strictEqual(metrics.failover.successes, 1);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('4. All providers unavailable → clean failure', async () => {
    // Open circuits for all providers
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 60000 });
    configureCircuit('gemini', { failureThreshold: 1, resetTimeoutMs: 60000 });
    configureCircuit('anthropic', { failureThreshold: 1, resetTimeoutMs: 60000 });

    const err = new Error('Outage');
    err.statusCode = 500;
    recordFailure('openai', err);
    recordFailure('gemini', err);
    recordFailure('anthropic', err);

    const originalSimulate = externalApiService.simulateApiCall;
    let callCount = 0;
    externalApiService.simulateApiCall = async () => {
      callCount++;
      return { data: {} };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.payload.code, 'CIRCUIT_OPEN');
      assert.strictEqual(callCount, 0, 'No provider should have been called when all circuits are OPEN');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('5. OPEN provider is never called during multi-step failover', async () => {
    // OpenAI is OPEN, Gemini is OPEN, Anthropic is CLOSED
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 60000 });
    configureCircuit('gemini', { failureThreshold: 1, resetTimeoutMs: 60000 });
    const err = new Error('Down');
    err.statusCode = 500;
    recordFailure('openai', err);
    recordFailure('gemini', err);

    assert.strictEqual(getCircuitState('openai').state, CircuitState.OPEN);
    assert.strictEqual(getCircuitState('gemini').state, CircuitState.OPEN);
    assert.strictEqual(getCircuitState('anthropic').state, CircuitState.CLOSED);

    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push(provider);
      return {
        data: { id: 'resp-claude', content: [{ text: 'Claude response' }] },
        model: 'claude-3-5-sonnet-20241022',
        tokensUsed: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['X-OptiAPI-Provider'], 'anthropic');
      assert.strictEqual(res.headers['X-OptiAPI-Failover'], 'true');

      // Neither OpenAI nor Gemini was called
      assert.strictEqual(calls.includes('openai'), false, 'OpenAI must not be called');
      assert.strictEqual(calls.includes('gemini'), false, 'Gemini must not be called');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0], 'anthropic');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('6. Client errors do not trigger failover', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push(provider);
      const clientErr = new Error('HTTP Error 400: Invalid prompt format');
      clientErr.statusCode = 400;
      clientErr.errorClass = 'permanent_request_error';
      clientErr.shouldRetry = false;
      throw clientErr;
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [] },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 400);
      // Secondary providers were NOT called
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0], 'openai');

      const metrics = metricsService.getMetrics();
      assert.strictEqual(metrics.failover.attempts, 0, 'No failover attempts should be recorded for client errors');
      assert.strictEqual(metrics.failover.successes, 0);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('7. Provider-specific circuits remain independent', async () => {
    configureCircuit('openai', { failureThreshold: 2, resetTimeoutMs: 60000 });
    const err = new Error('500 Error');
    err.statusCode = 500;
    recordFailure('openai', err);
    recordFailure('openai', err);

    assert.strictEqual(getCircuitState('openai').state, CircuitState.OPEN);
    assert.strictEqual(getCircuitState('gemini').state, CircuitState.CLOSED);
    assert.strictEqual(getCircuitState('anthropic').state, CircuitState.CLOSED);

    // Ensure Gemini failure count is 0
    assert.strictEqual(getCircuitState('gemini').failureCount, 0);
  });

  await t.test('8. Failover works seamlessly with Redis Routing Policy', async () => {
    // Set a policy selecting OpenAI with fallbacks
    await setRoutingPolicy(testUserId, {
      provider: 'openai',
      model: 'gpt-4o',
      fallbackProviders: ['gemini', 'anthropic'],
      failover: true
    });

    // Make OpenAI circuit OPEN
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 60000 });
    const err = new Error('OpenAI Circuit Open');
    err.statusCode = 503;
    recordFailure('openai', err);

    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push(provider);
      return {
        data: { text: 'Gemini policy routed response' },
        model: 'gemini-1.5-flash',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
      };
    };

    try {
      // Send request without explicit failover header - policy triggers failover
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: {},
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['X-OptiAPI-Provider'], 'gemini');
      assert.strictEqual(res.headers['X-OptiAPI-Failover'], 'true');
      assert.strictEqual(calls[0], 'gemini');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('9. Candidates order correctly with policy selected provider first', async () => {
    const candidates1 = getFailoverCandidates('openai', null, { headers: { 'x-optiapi-failover': 'true' } });
    assert.deepStrictEqual(candidates1, ['openai', 'gemini', 'anthropic']);

    const candidates2 = getFailoverCandidates('anthropic', null, { headers: { 'x-optiapi-failover': 'true' } });
    assert.deepStrictEqual(candidates2, ['anthropic', 'openai', 'gemini']);

    const candidatesCustom = getFailoverCandidates('openai', null, {
      headers: {
        'x-optiapi-fallback-providers': 'anthropic,gemini'
      }
    });
    assert.deepStrictEqual(candidatesCustom, ['openai', 'anthropic', 'gemini']);

    // When failover is not enabled and no policy, returns only primary
    const directNoFailover = getFailoverCandidates('openai', null, { headers: {} });
    assert.deepStrictEqual(directNoFailover, ['openai']);
  });

  await t.test('10. Client 401/403 errors do not trigger failover', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];

    externalApiService.simulateApiCall = async (provider) => {
      calls.push(provider);
      const authErr = new Error('HTTP Error 401: Unauthorized');
      authErr.statusCode = 401;
      authErr.errorClass = 'authentication_failed';
      throw authErr;
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: { 'x-optiapi-failover': 'true' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(calls.length, 1, 'Only primary was called');
      assert.strictEqual(calls[0], 'openai');
      assert.strictEqual(metricsService.getMetrics().failover.attempts, 0);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });
});
