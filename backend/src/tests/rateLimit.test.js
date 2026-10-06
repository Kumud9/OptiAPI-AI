const test = require('node:test');
const assert = require('node:assert');
const {
  checkClientRateLimit,
  checkProviderQuota,
  resetRateLimits
} = require('../services/rateLimitService');
const {
  CircuitState,
  getCircuitState,
  resetAllCircuits,
  configureCircuit,
  recordFailure
} = require('../services/circuitBreakerService');
const metricsService = require('../services/metricsService');
const externalApiService = require('../services/externalApiService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const RequestLog = require('../models/RequestLog');
const { clearInFlight } = require('../services/requestDeduplicationService');
const { setRoutingPolicy, deleteRoutingPolicy } = require('../services/policyService');
const { getRedisClient } = require('../config/redis');
const { initTelemetryWorker } = require('../services/telemetryWorker');

test('Phase 3C: Distributed Rate Limiting & Provider Quota Protection Suite', async (t) => {
  const testUserId = '507f1f77bcf86cd799439066';
  const testApiKey = 'opti_key_test_1234567890';

  await initTelemetryWorker();

  const originalRequestLogCreate = RequestLog.create;
  let loggedEntries = [];
  RequestLog.create = async (doc) => {
    loggedEntries.push(doc);
    return { _id: 'mock_log_id', ...doc };
  };

  t.beforeEach(async () => {
    resetAllCircuits();
    clearInFlight();
    metricsService.resetMetrics();
    loggedEntries = [];
    await resetRateLimits('rl:*');
    try {
      await deleteRoutingPolicy(testUserId);
    } catch (_) {}
  });

  t.afterEach(async () => {
    resetAllCircuits();
    clearInFlight();
    metricsService.resetMetrics();
    loggedEntries = [];
    await resetRateLimits('rl:*');
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

  // ==========================================
  // SECTION 1: Client Rate Limiting (Tests 1-10)
  // ==========================================

  await t.test('1. Request within limit succeeds', async () => {
    const res = await checkClientRateLimit('client_1', { requests: 5, windowSeconds: 60 });
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.limit, 5);
    assert.strictEqual(res.remaining, 4);
    assert.strictEqual(res.current, 1);
    assert.ok(res.reset > Date.now());
  });

  await t.test('2. Request exceeding limit returns 429', async () => {
    const opts = { requests: 2, windowSeconds: 60 };
    const r1 = await checkClientRateLimit('client_exceed', opts);
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r1.remaining, 1);

    const r2 = await checkClientRateLimit('client_exceed', opts);
    assert.strictEqual(r2.allowed, true);
    assert.strictEqual(r2.remaining, 0);

    const r3 = await checkClientRateLimit('client_exceed', opts);
    assert.strictEqual(r3.allowed, false);
    assert.strictEqual(r3.remaining, 0);
    assert.ok(r3.retryAfter > 0);
  });

  await t.test('3. Remaining count decreases correctly', async () => {
    const clientId = 'client_decrement';
    const limit = 4;
    for (let i = 1; i <= limit; i++) {
      const res = await checkClientRateLimit(clientId, { requests: limit, windowSeconds: 60 });
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.current, i);
      assert.strictEqual(res.remaining, limit - i);
    }
  });

  await t.test('4. Window resets correctly', async () => {
    const clientId = 'client_window_reset';
    // Very short 1-second window
    const opts = { requests: 1, windowSeconds: 1 };
    const r1 = await checkClientRateLimit(clientId, opts);
    assert.strictEqual(r1.allowed, true);

    const r2 = await checkClientRateLimit(clientId, opts);
    assert.strictEqual(r2.allowed, false);

    // Wait 1.1s for window to reset
    await new Promise(r => setTimeout(r, 1100));

    const r3 = await checkClientRateLimit(clientId, opts);
    assert.strictEqual(r3.allowed, true);
    assert.strictEqual(r3.current, 1);
  });

  await t.test('5. Redis key expires correctly', async () => {
    const redis = getRedisClient();
    const clientId = 'client_expire_check';
    const { sanitizeClientIdentifier } = require('../services/rateLimitService');
    await checkClientRateLimit(clientId, { requests: 10, windowSeconds: 2 });

    const safeId = sanitizeClientIdentifier(clientId);
    const keys = [];
    for await (const k of redis.scanIterator({ match: `*${safeId}*` })) {
      keys.push(k);
    }
    assert.ok(keys.length > 0, 'Key should exist in Redis');
    const ttl = await redis.ttl(keys[0]);
    assert.ok(ttl > 0 && ttl <= 4, 'TTL must be automatically set');
  });

  await t.test('6. Different clients have independent limits', async () => {
    const opts = { requests: 1, windowSeconds: 60 };
    const rA1 = await checkClientRateLimit('client_A', opts);
    assert.strictEqual(rA1.allowed, true);

    const rA2 = await checkClientRateLimit('client_A', opts);
    assert.strictEqual(rA2.allowed, false);

    // Client B must not be affected by Client A's exhaustion
    const rB1 = await checkClientRateLimit('client_B', opts);
    assert.strictEqual(rB1.allowed, true);
  });

  await t.test('7. Concurrent requests cannot bypass the limit', async () => {
    const clientId = 'client_concurrent';
    const limit = 5;
    const promises = Array.from({ length: 15 }, () =>
      checkClientRateLimit(clientId, { requests: limit, windowSeconds: 60 })
    );

    const results = await Promise.all(promises);
    const allowedCount = results.filter(r => r.allowed).length;
    const rejectedCount = results.filter(r => !r.allowed).length;

    assert.strictEqual(allowedCount, limit, `Exactly ${limit} requests should be allowed`);
    assert.strictEqual(rejectedCount, 10, 'Remaining 10 requests must be rejected');
  });

  await t.test('8. Invalid configuration is rejected safely with defaults', async () => {
    // Negative or non-integer requests & windows fallback safely
    const res = await checkClientRateLimit('client_invalid_cfg', { requests: -10, windowSeconds: 'invalid' });
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.limit, 100, 'Must fallback to default limit 100');
  });

  await t.test('9. Disabled rate limiting works', async () => {
    const clientId = 'client_disabled';
    for (let i = 0; i < 10; i++) {
      const res = await checkClientRateLimit(clientId, { enabled: false, requests: 1, windowSeconds: 60 });
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.remaining, 1);
    }
  });

  await t.test('10. Redis failure is handled safely (fail-open by default)', async () => {
    const redis = getRedisClient();
    const originalEval = redis.eval;
    redis.eval = async () => {
      throw new Error('Redis connection lost');
    };

    try {
      const res = await checkClientRateLimit('client_degraded', { requests: 5, windowSeconds: 60 });
      assert.strictEqual(res.allowed, true, 'Must fail open safely when Redis fails');
      assert.strictEqual(res.degraded, true);
    } finally {
      redis.eval = originalEval;
    }
  });

  // ==========================================
  // SECTION 2: Provider Quotas (Tests 11-18)
  // ==========================================

  await t.test('11. Provider within quota succeeds', async () => {
    const res = await checkProviderQuota(testUserId, 'openai', { requests: 10, windowSeconds: 60 });
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.provider, 'openai');
    assert.strictEqual(res.remaining, 9);
    assert.strictEqual(res.current, 1);
  });

  await t.test('12. Provider quota exhaustion prevents request', async () => {
    const opts = { requests: 2, windowSeconds: 60 };
    await checkProviderQuota(testUserId, 'openai', opts);
    await checkProviderQuota(testUserId, 'openai', opts);

    const r3 = await checkProviderQuota(testUserId, 'openai', opts);
    assert.strictEqual(r3.allowed, false);
    assert.strictEqual(r3.remaining, 0);
  });

  await t.test('13. Quota exhaustion triggers failover to healthy candidate', async () => {
    // Set policy for testUserId where OpenAI limit is 1, and fallbacks are ['gemini', 'anthropic']
    await setRoutingPolicy(testUserId, {
      provider: 'openai',
      fallbackProviders: ['gemini', 'anthropic'],
      failover: true,
      providerLimits: {
        openai: { requests: 1, windowSeconds: 60 },
        gemini: { requests: 10, windowSeconds: 60 }
      }
    });

    // Exhaust OpenAI's quota
    await checkProviderQuota(testUserId, 'openai', { requests: 1, windowSeconds: 60 });

    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];
    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      calls.push(provider);
      return {
        data: { reply: 'Gemini saved quota' },
        model: 'gemini-1.5-flash',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
      };
    };

    try {
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

      // OpenAI was NOT called because quota was exhausted
      assert.strictEqual(calls.includes('openai'), false, 'OpenAI must not be called when quota is exhausted');
      assert.strictEqual(calls.includes('gemini'), true);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('14. All providers quota-exhausted returns clean failure', async () => {
    await setRoutingPolicy(testUserId, {
      provider: 'openai',
      fallbackProviders: ['gemini', 'anthropic'],
      failover: true,
      providerLimits: {
        openai: { requests: 1, windowSeconds: 60 },
        gemini: { requests: 1, windowSeconds: 60 },
        anthropic: { requests: 1, windowSeconds: 60 }
      }
    });

    // Exhaust all 3 providers' quotas
    await checkProviderQuota(testUserId, 'openai', { requests: 1, windowSeconds: 60 });
    await checkProviderQuota(testUserId, 'gemini', { requests: 1, windowSeconds: 60 });
    await checkProviderQuota(testUserId, 'anthropic', { requests: 1, windowSeconds: 60 });

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
        headers: {},
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 429);
      assert.ok(res.payload.error.includes('Quota') || res.payload.code.includes('QUOTA'));
      assert.strictEqual(callCount, 0, 'No provider should have been contacted');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('15. Provider quotas remain independent', async () => {
    const opts = { requests: 1, windowSeconds: 60 };
    await checkProviderQuota(testUserId, 'openai', opts);
    const rOpenAI = await checkProviderQuota(testUserId, 'openai', opts);
    assert.strictEqual(rOpenAI.allowed, false, 'OpenAI quota should be exhausted');

    const rGemini = await checkProviderQuota(testUserId, 'gemini', opts);
    assert.strictEqual(rGemini.allowed, true, 'Gemini quota should be independent and available');
  });

  await t.test('16. OPEN provider is still never called when checking quotas', async () => {
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 60000 });
    const err = new Error('Outage');
    err.statusCode = 500;
    recordFailure('openai', err);
    assert.strictEqual(getCircuitState('openai').state, CircuitState.OPEN);

    await setRoutingPolicy(testUserId, {
      provider: 'openai',
      fallbackProviders: ['gemini'],
      failover: true,
      providerLimits: {
        gemini: { requests: 10, windowSeconds: 60 }
      }
    });

    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];
    externalApiService.simulateApiCall = async (provider) => {
      calls.push(provider);
      return {
        data: { text: 'ok' },
        model: 'gemini-1.5-flash',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
      };
    };

    try {
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
      assert.strictEqual(calls.includes('openai'), false);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('17. Quota rejection does not cause pointless retries', async () => {
    await setRoutingPolicy(testUserId, {
      provider: 'openai',
      fallbackProviders: [],
      failover: false,
      maxRetries: 3,
      providerLimits: {
        openai: { requests: 1, windowSeconds: 60 }
      }
    });

    // Exhaust quota
    await checkProviderQuota(testUserId, 'openai', { requests: 1, windowSeconds: 60 });

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
        headers: {},
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(callCount, 0, 'No retries should be attempted when quota is exhausted');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('18. Existing retry behavior remains intact when within quota', async () => {
    let callCount = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      callCount++;
      if (callCount < 2) {
        const err = new Error('500 Error');
        err.statusCode = 500;
        throw err;
      }
      return {
        data: { text: 'Retry success' },
        model: 'gpt-4o',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: { 'x-optiapi-failover': 'false' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(callCount, 2, 'Should retry on 500 error up to success');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  // ==========================================
  // SECTION 3: Integration (Tests 19-25)
  // ==========================================

  await t.test('19. Rate limiting + routing policy integration', async () => {
    await setRoutingPolicy(testUserId, {
      provider: 'openai',
      rateLimit: {
        enabled: true,
        requests: 2,
        windowSeconds: 60
      }
    });

    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => ({
      data: { text: 'ok' },
      model: 'gpt-4o',
      tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
    });

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: {},
        userId: testUserId,
        query: {}
      };

      const r1 = await executeGateway(req);
      assert.strictEqual(r1.statusCode, 200);
      assert.strictEqual(r1.headers['X-RateLimit-Limit'], '2');
      assert.strictEqual(r1.headers['X-RateLimit-Remaining'], '1');

      const r2 = await executeGateway(req);
      assert.strictEqual(r2.statusCode, 200);
      assert.strictEqual(r2.headers['X-RateLimit-Remaining'], '0');

      const r3 = await executeGateway(req);
      assert.strictEqual(r3.statusCode, 429);
      assert.ok(Number(r3.headers['Retry-After']) <= 60 && Number(r3.headers['Retry-After']) > 0, 'Retry-After should match window remaining seconds');
      assert.strictEqual(r3.headers['X-RateLimit-Remaining'], '0');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('20. Rate limiting + circuit breaker integration', async () => {
    // If circuit is OPEN, rate limit check still runs first and decrements/records
    configureCircuit('openai', { failureThreshold: 1, resetTimeoutMs: 60000 });
    const err = new Error('Open');
    err.statusCode = 503;
    recordFailure('openai', err);

    const req = {
      params: { provider: 'openai', '0': '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-4o' },
      headers: { 'x-optiapi-rate-limit-requests': '5', 'x-optiapi-failover': 'false' },
      userId: testUserId,
      query: {}
    };

    const res = await executeGateway(req);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.payload.code, 'CIRCUIT_OPEN');
    assert.strictEqual(res.headers['X-RateLimit-Limit'], '5');
  });

  await t.test('21. Rate limiting + failover integration', async () => {
    // Primary times out, fails over to Gemini, but rate limit headers still accurately reflect client quota
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async (provider) => {
      if (provider === 'openai') {
        const err = new Error('500 Error');
        err.statusCode = 500;
        throw err;
      }
      return {
        data: { text: 'Gemini ok' },
        model: 'gemini-1.5-flash',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
      };
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: { 'x-optiapi-failover': 'true', 'x-optiapi-rate-limit-requests': '10' },
        userId: testUserId,
        query: {}
      };

      const res = await executeGateway(req);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['X-OptiAPI-Provider'], 'gemini');
      assert.strictEqual(res.headers['X-OptiAPI-Failover'], 'true');
      assert.strictEqual(res.headers['X-RateLimit-Limit'], '10');
      assert.strictEqual(res.headers['X-RateLimit-Remaining'], '9');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('22. Rate limiting + request deduplication integration', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    let upstreamCalls = 0;
    externalApiService.simulateApiCall = async () => {
      upstreamCalls++;
      await new Promise(r => setTimeout(r, 40));
      return {
        data: { text: 'coalesced' },
        model: 'gpt-4o',
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
      };
    };

    try {
      // 5 concurrent identical requests
      const promises = Array.from({ length: 5 }, () => {
        const req = {
          params: { provider: 'openai', '0': '/v1/chat/completions' },
          method: 'POST',
          body: { model: 'gpt-4o', prompt: 'dedup rate limit test' },
          headers: { 'x-optiapi-rate-limit-requests': '20' },
          userId: testUserId,
          query: {}
        };
        return executeGateway(req);
      });

      const responses = await Promise.all(promises);
      for (const res of responses) {
        assert.strictEqual(res.statusCode, 200);
      }
      assert.strictEqual(upstreamCalls, 1, 'Only 1 upstream call should be made due to singleflight deduplication');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('23. Rate limiting + metrics tracking', async () => {
    const opts = { requests: 2, windowSeconds: 60 };
    await checkClientRateLimit('metrics_client', opts);
    await checkClientRateLimit('metrics_client', opts);
    await checkClientRateLimit('metrics_client', opts); // rejected

    const m = metricsService.getMetrics();
    assert.strictEqual(m.rateLimit.hits, 2);
    assert.strictEqual(m.rateLimit.rejections, 1);
  });

  await t.test('24. Rate limiting + RequestLog persistence on 429', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => ({
      data: { text: 'ok' },
      model: 'gpt-4o',
      tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
    });

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: { 'x-optiapi-rate-limit-requests': '1' },
        userId: testUserId,
        query: {}
      };

      // First request passes
      const r1 = await executeGateway(req);
      assert.strictEqual(r1.statusCode, 200);

      // Second request is rate limited to 429
      const res = await executeGateway(req);
      assert.strictEqual(res.statusCode, 429);

      // Await async queue processing by telemetry worker
      await new Promise(r => setTimeout(r, 40));

      assert.ok(loggedEntries.length >= 2);
      const entry429 = loggedEntries.find(e => e.status === 429);
      assert.ok(entry429, 'RequestLog must record 429 rate limit violation');
      assert.strictEqual(entry429.errorMessage, 'Rate limit violation - too many requests');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('25. Client errors do not trigger unnecessary failover', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    const calls = [];
    externalApiService.simulateApiCall = async (provider) => {
      calls.push(provider);
      const err = new Error('HTTP Error 400: Bad Request');
      err.statusCode = 400;
      throw err;
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
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(calls.length, 1, 'Only primary should be called');
      assert.strictEqual(calls[0], 'openai');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });
});
