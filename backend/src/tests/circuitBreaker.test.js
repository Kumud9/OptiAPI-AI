const test = require('node:test');
const assert = require('node:assert');
const {
  CircuitState,
  CircuitBreakerError,
  isCircuitBreakerFailure,
  checkCircuit,
  recordSuccess,
  recordFailure,
  getCircuitState,
  getAllCircuitStates,
  resetCircuit,
  resetAllCircuits,
  configureCircuit,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RESET_TIMEOUT_MS
} = require('../services/circuitBreakerService');
const externalApiService = require('../services/externalApiService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const RequestLog = require('../models/RequestLog');
const { clearInFlight } = require('../services/requestDeduplicationService');

test('Phase 3A: Provider Circuit Breaker Suite', async (t) => {
  // Prevent Mongoose buffering timeout in tests when MongoDB is not connected
  const originalRequestLogCreate = RequestLog.create;
  RequestLog.create = async () => ({ _id: 'mock_log_id' });

  t.beforeEach(() => {
    resetAllCircuits();
    clearInFlight();
  });

  t.afterEach(() => {
    resetAllCircuits();
    clearInFlight();
  });

  t.after(() => {
    RequestLog.create = originalRequestLogCreate;
  });

  await t.test('1. New provider starts CLOSED', async () => {
    const state = getCircuitState('openai');
    assert.strictEqual(state.state, CircuitState.CLOSED);
    assert.strictEqual(state.failureCount, 0);
    assert.strictEqual(state.openedAt, null);
    assert.strictEqual(state.lastFailureAt, null);
    assert.strictEqual(state.provider, 'openai');

    // Calling checkCircuit allows the request
    const check = checkCircuit('openai');
    assert.strictEqual(check.allowed, true);
    assert.strictEqual(check.isTestRequest, false);
  });

  await t.test('2. Successful request remains CLOSED', async () => {
    checkCircuit('openai');
    recordSuccess('openai');

    const state = getCircuitState('openai');
    assert.strictEqual(state.state, CircuitState.CLOSED);
    assert.strictEqual(state.failureCount, 0);
    assert.strictEqual(state.successCount, 1);
  });

  await t.test('3. Failures increment failureCount', async () => {
    const error500 = new Error('HTTP Error 500: Internal Server Error');
    error500.statusCode = 500;

    recordFailure('openai', error500);
    let state = getCircuitState('openai');
    assert.strictEqual(state.failureCount, 1);
    assert.strictEqual(state.state, CircuitState.CLOSED);
    assert.ok(state.lastFailureAt > 0);

    recordFailure('openai', error500);
    state = getCircuitState('openai');
    assert.strictEqual(state.failureCount, 2);
    assert.strictEqual(state.state, CircuitState.CLOSED);
  });

  await t.test('4. Circuit opens exactly at configured threshold', async () => {
    configureCircuit('openai', { failureThreshold: 3, resetTimeoutMs: 1000 });
    const error503 = new Error('HTTP Error 503: Service Unavailable');
    error503.statusCode = 503;

    recordFailure('openai', error503);
    recordFailure('openai', error503);
    let state = getCircuitState('openai');
    assert.strictEqual(state.failureCount, 2);
    assert.strictEqual(state.state, CircuitState.CLOSED);

    // 3rd failure reaches the threshold of 3
    recordFailure('openai', error503);
    state = getCircuitState('openai');
    assert.strictEqual(state.failureCount, 3);
    assert.strictEqual(state.state, CircuitState.OPEN);
    assert.ok(state.openedAt > 0);
  });

  await t.test('5. OPEN circuit rejects requests without calling upstream', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 10000 });
    const error500 = new Error('Upstream failed');
    error500.statusCode = 500;
    recordFailure('openai', error500);

    const state = getCircuitState('openai');
    assert.strictEqual(state.state, CircuitState.OPEN);

    // checkCircuit must throw CircuitBreakerError immediately
    assert.throws(
      () => checkCircuit('openai'),
      (err) => {
        assert.strictEqual(err.name, 'CircuitBreakerError');
        assert.strictEqual(err.statusCode, 503);
        assert.strictEqual(err.code, 'CIRCUIT_OPEN');
        assert.strictEqual(err.provider, 'openai');
        assert.strictEqual(err.shouldRetry, false);
        return true;
      }
    );
  });

  await t.test('6. OPEN circuit does not execute provider retries', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 10000 });
    const err = new Error('Down');
    err.statusCode = 500;
    recordFailure('openai', err);

    let upstreamCallCount = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      upstreamCallCount++;
      return { data: { ok: true } };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'test' }] },
        headers: { 'x-optiapi-retries': '3' },
        userId: '507f1f77bcf86cd799439099',
        query: {}
      };

      const response = await new Promise((resolve) => {
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(payload) { resolve({ statusCode: this.statusCode, payload }); }
        };
        handleGatewayRequest(req, res);
      });

      assert.strictEqual(response.statusCode, 503);
      assert.strictEqual(response.payload.code, 'CIRCUIT_OPEN');
      assert.strictEqual(response.payload.provider, 'openai');
      assert.strictEqual(upstreamCallCount, 0, 'Must NOT have called upstream or retried at all');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('7. Circuit transitions to HALF_OPEN after cooldown', async () => {
    // Configure cooldown for testing: 100ms to avoid timing race under CPU load
    configureCircuit('gemini', { failureThreshold: 1, resetTimeoutMs: 100 });
    const err = new Error('Gemini down');
    err.statusCode = 500;
    recordFailure('gemini', err);

    assert.strictEqual(getCircuitState('gemini').state, CircuitState.OPEN);

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 120));

    // getCircuitState reflects HALF_OPEN
    assert.strictEqual(getCircuitState('gemini').state, CircuitState.HALF_OPEN);

    // checkCircuit transitions and permits the test request
    const check = checkCircuit('gemini');
    assert.strictEqual(check.allowed, true);
    assert.strictEqual(check.isTestRequest, true);
  });

  await t.test('8. HALF_OPEN allows exactly one test request', async () => {
    configureCircuit('gemini', { failureThreshold: 1, resetTimeoutMs: 20 });
    const err = new Error('Fail');
    err.statusCode = 502;
    recordFailure('gemini', err);

    await new Promise((r) => setTimeout(r, 30));

    // Request 1: Allowed as the test request
    const check1 = checkCircuit('gemini');
    assert.strictEqual(check1.allowed, true);
    assert.strictEqual(check1.isTestRequest, true);

    // Request 2 (before Request 1 finishes): Must be rejected
    assert.throws(
      () => checkCircuit('gemini'),
      (err) => {
        assert.strictEqual(err.code, 'CIRCUIT_OPEN');
        return true;
      }
    );
  });

  await t.test('9. Concurrent HALF_OPEN requests cannot create multiple test calls', async () => {
    configureCircuit('anthropic', { failureThreshold: 1, resetTimeoutMs: 20 });
    const err = new Error('Anthropic 503');
    err.statusCode = 503;
    recordFailure('anthropic', err);

    await new Promise((r) => setTimeout(r, 30));

    let allowedCount = 0;
    let rejectedCount = 0;

    // Simulate 5 concurrent checks
    for (let i = 0; i < 5; i++) {
      try {
        const check = checkCircuit('anthropic');
        if (check.allowed && check.isTestRequest) allowedCount++;
      } catch (e) {
        if (e.code === 'CIRCUIT_OPEN') rejectedCount++;
      }
    }

    assert.strictEqual(allowedCount, 1, 'Only exactly 1 request may be accepted in HALF_OPEN');
    assert.strictEqual(rejectedCount, 4, 'Remaining 4 concurrent requests must be rejected immediately');
  });

  await t.test('10. Successful HALF_OPEN request closes the circuit', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 20 });
    const err = new Error('Unavailable');
    err.statusCode = 503;
    recordFailure('openai', err);

    await new Promise((r) => setTimeout(r, 30));

    // Claim the test request
    checkCircuit('openai');

    // Test request succeeds
    recordSuccess('openai');

    const state = getCircuitState('openai');
    assert.strictEqual(state.state, CircuitState.CLOSED);
    assert.strictEqual(state.failureCount, 0);
    assert.strictEqual(state.openedAt, null);

    // Subsequent regular requests are now allowed
    const nextCheck = checkCircuit('openai');
    assert.strictEqual(nextCheck.allowed, true);
    assert.strictEqual(nextCheck.isTestRequest, false);
  });

  await t.test('11. Failed HALF_OPEN request returns circuit to OPEN', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 20 });
    const err = new Error('Down');
    err.statusCode = 500;
    recordFailure('openai', err);

    await new Promise((r) => setTimeout(r, 30));

    // Claim the test request
    checkCircuit('openai');

    // Test request fails again
    const failureErr = new Error('Still down');
    failureErr.statusCode = 500;
    recordFailure('openai', failureErr);

    const state = getCircuitState('openai');
    assert.strictEqual(state.state, CircuitState.OPEN);

    // Requests are immediately rejected again
    assert.throws(() => checkCircuit('openai'), { name: 'CircuitBreakerError' });
  });

  await t.test('12. Failure count resets after successful recovery', async () => {
    configureCircuit('gemini', { failureThreshold: 3, resetTimeoutMs: 20 });
    const err = new Error('Err');
    err.statusCode = 500;

    recordFailure('gemini', err);
    recordFailure('gemini', err);
    recordFailure('gemini', err); // Tripped to OPEN (failureCount = 3)

    assert.strictEqual(getCircuitState('gemini').state, CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 30));
    checkCircuit('gemini'); // enters HALF_OPEN
    recordSuccess('gemini'); // successfully recovers

    const state = getCircuitState('gemini');
    assert.strictEqual(state.state, CircuitState.CLOSED);
    assert.strictEqual(state.failureCount, 0, 'Failure count must be reset to 0 after recovery');
  });

  await t.test('13. Different providers have independent circuits', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 10000 });
    configureCircuit('gemini', { failureThreshold: 5, resetTimeoutMs: 10000 });
    configureCircuit('anthropic', { failureThreshold: 5, resetTimeoutMs: 10000 });

    const err = new Error('OpenAI crashed');
    err.statusCode = 500;
    recordFailure('openai', err);

    const allStates = getAllCircuitStates();
    assert.strictEqual(allStates.openai.state, CircuitState.OPEN);
    assert.strictEqual(allStates.gemini.state, CircuitState.CLOSED);
    assert.strictEqual(allStates.anthropic.state, CircuitState.CLOSED);

    // OpenAI is blocked, but Gemini and Anthropic are allowed
    assert.throws(() => checkCircuit('openai'), { name: 'CircuitBreakerError' });
    assert.strictEqual(checkCircuit('gemini').allowed, true);
    assert.strictEqual(checkCircuit('anthropic').allowed, true);
  });

  await t.test('14. HTTP 5xx counts as provider failure', async () => {
    const err500 = new Error('Internal Server Error');
    err500.statusCode = 500;
    assert.strictEqual(isCircuitBreakerFailure(err500), true);

    const err502 = new Error('Bad Gateway');
    err502.statusCode = 502;
    assert.strictEqual(isCircuitBreakerFailure(err502), true);

    const err503 = new Error('Service Unavailable');
    err503.statusCode = 503;
    assert.strictEqual(isCircuitBreakerFailure(err503), true);

    const err504 = new Error('Gateway Timeout');
    err504.statusCode = 504;
    assert.strictEqual(isCircuitBreakerFailure(err504), true);
  });

  await t.test('15. Timeout counts as provider failure', async () => {
    const timeoutErr = new Error('Upstream provider openai request timed out');
    timeoutErr.statusCode = 504;
    timeoutErr.errorClass = 'timeout';
    assert.strictEqual(isCircuitBreakerFailure(timeoutErr), true);

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    assert.strictEqual(isCircuitBreakerFailure(abortErr), true);

    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 10000 });
    recordFailure('openai', timeoutErr);
    assert.strictEqual(getCircuitState('openai').state, CircuitState.OPEN);
  });

  await t.test('16. HTTP 400 does not open the circuit', async () => {
    configureCircuit('openai', { failureThreshold: 2, resetTimeoutMs: 10000 });
    const err400 = new Error('Bad Request: Invalid model parameters');
    err400.statusCode = 400;
    err400.errorClass = 'permanent_request_error';

    assert.strictEqual(isCircuitBreakerFailure(err400), false);

    recordFailure('openai', err400);
    recordFailure('openai', err400);
    recordFailure('openai', err400);

    const state = getCircuitState('openai');
    assert.strictEqual(state.failureCount, 0, 'Client 400 must NOT increment failureCount');
    assert.strictEqual(state.state, CircuitState.CLOSED);
  });

  await t.test('17. HTTP 401/403 does not open the circuit', async () => {
    configureCircuit('anthropic', { failureThreshold: 2, resetTimeoutMs: 10000 });
    const err401 = new Error('Unauthorized: Invalid API key');
    err401.statusCode = 401;
    err401.errorClass = 'authentication_failed';

    const err403 = new Error('Forbidden: Access denied');
    err403.statusCode = 403;
    err403.errorClass = 'authentication_failed';

    assert.strictEqual(isCircuitBreakerFailure(err401), false);
    assert.strictEqual(isCircuitBreakerFailure(err403), false);

    recordFailure('anthropic', err401);
    recordFailure('anthropic', err403);

    const state = getCircuitState('anthropic');
    assert.strictEqual(state.failureCount, 0, 'Auth 401/403 must NOT increment failureCount');
    assert.strictEqual(state.state, CircuitState.CLOSED);
  });

  await t.test('18. Existing 15-second timeout remains functional', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    let receivedTimeout = null;

    externalApiService.simulateApiCall = async (p, ep, m, b, h, u, ip, options) => {
      receivedTimeout = options?.timeoutMs;
      return {
        data: { id: 'resp-1' },
        model: 'gpt-4o',
        tokensUsed: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: {},
        userId: '507f1f77bcf86cd799439099',
        query: {}
      };

      await new Promise((resolve) => {
        const res = {
          statusCode: 200,
          headers: {},
          setHeader(k, v) { this.headers[k] = v; },
          status(code) { this.statusCode = code; return this; },
          json(payload) { resolve({ statusCode: this.statusCode, payload }); }
        };
        handleGatewayRequest(req, res);
      });

      assert.strictEqual(receivedTimeout, 15000, 'Default timeout must be 15000ms');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('19. Existing retry behavior remains functional while circuit is CLOSED', async () => {
    // Failure threshold is 5, but request retries up to default max attempts (3) and fails
    configureCircuit('openai', { failureThreshold: 5, resetTimeoutMs: 10000 });

    let attemptsCount = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      attemptsCount++;
      const err = new Error('HTTP Error 500: Temporary glitch');
      err.statusCode = 500;
      throw err;
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: {},
        userId: '507f1f77bcf86cd799439099',
        query: {}
      };

      const response = await new Promise((resolve) => {
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(payload) { resolve({ statusCode: this.statusCode, payload }); }
        };
        handleGatewayRequest(req, res);
      });

      // Retries executed normally up to 3 attempts
      assert.strictEqual(attemptsCount, 3, 'Must have attempted retries up to configured default max attempts (3)');
      assert.strictEqual(response.statusCode, 502);

      // Circuit recorded the 3 failures but remains CLOSED (since threshold is 5)
      const state = getCircuitState('openai');
      assert.strictEqual(state.failureCount, 3);
      assert.strictEqual(state.state, CircuitState.CLOSED);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('20. Clean 503 error response structure when circuit is OPEN', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 10000 });
    const err = new Error('Service Unavailable');
    err.statusCode = 503;
    recordFailure('openai', err);

    const req = {
      params: { provider: 'openai', '0': '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-4o' },
      headers: {},
      userId: '507f1f77bcf86cd799439099',
      query: {}
    };

    const response = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ statusCode: this.statusCode, payload }); }
      };
      handleGatewayRequest(req, res);
    });

    assert.strictEqual(response.statusCode, 503);
    assert.deepStrictEqual(response.payload, {
      error: 'Provider temporarily unavailable',
      provider: 'openai',
      code: 'CIRCUIT_OPEN'
    });
  });
});
