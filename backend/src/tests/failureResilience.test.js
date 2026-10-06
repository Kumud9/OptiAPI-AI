'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getRedisClient } = require('../config/redis');
const { getQueueChannel } = require('../config/queue');
const metricsService = require('../services/metricsService');
const externalApiService = require('../services/externalApiService');
const circuitBreakerService = require('../services/circuitBreakerService');
const failoverService = require('../services/failoverService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const { gatewayCache } = require('../middleware/cache');
const { clearInFlight } = require('../services/requestDeduplicationService');
const { searchSemanticCache } = require('../services/semanticCacheService');
const embeddingService = require('../services/embeddingService');
const telemetryService = require('../services/telemetryService');
const RequestLog = require('../models/RequestLog');
const CacheRule = require('../models/CacheRule');
const { setRoutingPolicy, deleteRoutingPolicy } = require('../services/policyService');

test('Phase 8: Failure Modes & Fault Tolerance Integration Suite', async (t) => {
  const testUserId = '507f1f77bcf86cd799439099';
  const testEndpoint = '/v1/chat/completions';
  const redis = getRedisClient();

  // Mock RequestLog.create and CacheRule.findOne to prevent MongoDB dependency/timeout
  const originalRequestLogCreate = RequestLog.create;
  RequestLog.create = async (doc) => ({ _id: 'mock_log_id', ...doc });

  const originalCacheRuleFindOne = CacheRule.findOne;
  CacheRule.findOne = () => ({
    lean: async () => null,
    then: (resolve) => resolve(null)
  });

  // Helper to execute gateway request
  const executeGateway = (req) => {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ statusCode: this.statusCode, headers: this.headers, payload }); }
      };
      handleGatewayRequest(req, res);
    });
  };

  t.beforeEach(async () => {
    circuitBreakerService.resetAllCircuits();
    clearInFlight();
    metricsService.resetMetrics();
    try {
      await deleteRoutingPolicy(testUserId);
    } catch (_) {}
  });

  t.afterEach(async () => {
    circuitBreakerService.resetAllCircuits();
    clearInFlight();
    metricsService.resetMetrics();
    try {
      await deleteRoutingPolicy(testUserId);
    } catch (_) {}
  });

  t.after(() => {
    RequestLog.create = originalRequestLogCreate;
    CacheRule.findOne = originalCacheRuleFindOne;
  });

  // 1. Upstream Timeout
  await t.test('1. Upstream timeout handling: fails with timeout and triggers retry/circuit', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    try {
      externalApiService.simulateApiCall = async () => {
        const err = new Error('Upstream provider timed out after 30000ms');
        err.name = 'TimeoutError';
        err.status = 504;
        throw err;
      };

      const req = {
        params: { provider: 'openai', '0': testEndpoint },
        userId: testUserId,
        user: { _id: testUserId, role: 'user' },
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          provider: 'openai',
          endpoint: testEndpoint,
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'test timeout' }]
        },
        path: `/api/v1/gateway${testEndpoint}`
      };

      const res = await executeGateway(req);
      assert.ok(res.statusCode >= 500, `Expected 5xx status code, got ${res.statusCode}`);
      assert.ok(res.payload.error, 'Response should contain error payload');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  // 2. Provider 5xx Error
  await t.test('2. Provider 5xx error handling: catches 502/503 and records metrics', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    try {
      externalApiService.simulateApiCall = async () => {
        const err = new Error('Service Unavailable: Overloaded upstream');
        err.status = 503;
        throw err;
      };

      const req = {
        params: { provider: 'openai', '0': testEndpoint },
        userId: testUserId,
        user: { _id: testUserId, role: 'user' },
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          provider: 'openai',
          endpoint: testEndpoint,
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'test 503' }]
        },
        path: `/api/v1/gateway${testEndpoint}`
      };

      const res = await executeGateway(req);
      assert.ok(res.statusCode === 502 || res.statusCode === 503, `Status should be 502 or 503, got ${res.statusCode}`);
      const m = metricsService.getMetrics();
      assert.ok(m.errorCount >= 1, 'Metrics errorCount should be incremented');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  // 3. Circuit Opening and Recovery
  await t.test('3. Circuit breaker opening and recovery life cycle', async () => {
    const circuitProvider = 'openai';
    const err500 = new Error('500 Internal Server Error');
    err500.statusCode = 500;

    circuitBreakerService.configureCircuit(circuitProvider, {
      failureThreshold: 3,
      resetTimeoutMs: 100
    });

    assert.strictEqual(circuitBreakerService.getCircuitState(circuitProvider).state, circuitBreakerService.CircuitState.CLOSED);

    // Record 3 failures to trip circuit
    circuitBreakerService.recordFailure(circuitProvider, err500);
    circuitBreakerService.recordFailure(circuitProvider, err500);
    circuitBreakerService.recordFailure(circuitProvider, err500);

    assert.strictEqual(circuitBreakerService.getCircuitState(circuitProvider).state, circuitBreakerService.CircuitState.OPEN);

    // When OPEN, checkCircuit should fast-fail and throw CircuitBreakerError
    assert.throws(
      () => {
        circuitBreakerService.checkCircuit(circuitProvider);
      },
      /Provider temporarily unavailable/
    );

    // Wait for reset timeout to expire
    await new Promise((r) => setTimeout(r, 150));

    // checkCircuit triggers transition to HALF_OPEN and issues a test probe
    const probe = circuitBreakerService.checkCircuit(circuitProvider);
    assert.strictEqual(probe.allowed, true);
    assert.strictEqual(probe.isTestRequest, true);
    assert.strictEqual(circuitBreakerService.getCircuitState(circuitProvider).state, circuitBreakerService.CircuitState.HALF_OPEN);

    // Probe success closes circuit
    circuitBreakerService.recordSuccess(circuitProvider);
    assert.strictEqual(circuitBreakerService.getCircuitState(circuitProvider).state, circuitBreakerService.CircuitState.CLOSED);
  });

  // 4. Multi-Provider Failover
  await t.test('4. Failover routing when primary provider fails', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    const attemptedProviders = [];

    try {
      externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
        attemptedProviders.push(provider);
        if (provider === 'openai') {
          const err = new Error('OpenAI 500 Internal Server Error');
          err.status = 500;
          err.statusCode = 500;
          throw err;
        }
        return {
          data: { choices: [{ message: { content: 'Fallback from Anthropic' } }] },
          model: 'claude-3-haiku',
          tokensUsed: { totalTokens: 15 }
        };
      };

      const req = {
        params: { provider: 'openai', '0': testEndpoint },
        userId: testUserId,
        user: { _id: testUserId, role: 'user' },
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-optiapi-failover': 'true'
        },
        body: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'trigger failover' }]
        },
        query: {}
      };

      const res = await executeGateway(req);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['x-optiapi-failover'], 'true');
      assert.ok(res.headers['x-optiapi-provider'] !== 'openai', 'Should serve from fallback provider');
      assert.ok(attemptedProviders.includes('openai'), 'Should have attempted openai first');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  // 5. Redis Degradation (Graceful Cache Fail-Open)
  await t.test('5. Redis degradation: cache middleware fails open when Redis throws', async () => {
    const originalGet = redis.get;
    redis.get = async () => {
      throw new Error('ECONNREFUSED: Redis connection lost');
    };

    let nextCalled = false;
    const req = {
      params: { provider: 'openai', '0': testEndpoint },
      user: { _id: testUserId },
      userId: testUserId,
      method: 'POST',
      body: { prompt: 'testing redis degradation' },
      path: '/api/v1/gateway/chat',
      headers: {}
    };
    const res = {
      setHeader: () => {},
      json: () => {}
    };

    try {
      await gatewayCache(req, res, () => {
        nextCalled = true;
      });
      assert.strictEqual(nextCalled, true, 'Cache middleware must call next() and fail open');
    } finally {
      redis.get = originalGet;
    }
  });

  // 6. RabbitMQ / Telemetry Degradation
  await t.test('6. RabbitMQ degradation: publishTelemetryEvent fails gracefully without crashing', async () => {
    const channel = getQueueChannel();
    const originalPublish = channel.publish;
    channel.publish = () => {
      throw new Error('AMQP_CHANNEL_CLOSED: connection disrupted');
    };

    try {
      const res = await telemetryService.publishTelemetryEvent({
        requestId: 'req_deg_123',
        userId: testUserId,
        provider: 'openai',
        statusCode: 200
      });
      assert.strictEqual(res, false, 'Should return false when queue publish fails');
    } finally {
      channel.publish = originalPublish;
    }
  });

  // 7. Semantic Embedding Failure (Graceful Fail-Open)
  await t.test('7. Semantic embedding failure: fails open and increments failure metric', async () => {
    embeddingService.setEmbeddingProvider({
      embed: async () => {
        throw new Error('Xenova model weight download failed');
      }
    });

    try {
      const match = await searchSemanticCache(
        redis,
        testUserId,
        'openai',
        testEndpoint,
        { prompt: 'test embedding failure with sufficiently long prompt string' },
        0.85
      );

      assert.strictEqual(match, null, 'Must return null match on embedding error');
      const m = metricsService.getMetrics();
      assert.ok(m.cache.embeddingFailures >= 1, 'embeddingFailures count should be incremented');
    } finally {
      embeddingService.resetEmbeddingProvider();
    }
  });

  // 8. Concurrent Duplicate Requests (Singleflight Deduplication)
  await t.test('8. Concurrent duplicate requests: singleflight deduplication collapses N into 1', async () => {
    const originalSimulate = externalApiService.simulateApiCall;
    let upstreamCallCount = 0;

    try {
      externalApiService.simulateApiCall = async () => {
        upstreamCallCount++;
        await new Promise((r) => setTimeout(r, 60));
        return {
          data: { choices: [{ message: { content: 'dedup response' } }] },
          model: 'gpt-4o',
          tokensUsed: { totalTokens: 10 }
        };
      };

      const reqBody = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'concurrent identical question 12345' }]
      };

      const makeReq = () => {
        return executeGateway({
          params: { provider: 'openai', '0': testEndpoint },
          userId: testUserId,
          user: { _id: testUserId, role: 'user' },
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: { ...reqBody },
          query: {}
        });
      };

      // Fire 6 identical concurrent requests
      const results = await Promise.all([
        makeReq(),
        makeReq(),
        makeReq(),
        makeReq(),
        makeReq(),
        makeReq()
      ]);

      // All 6 should succeed
      for (const res of results) {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.payload.choices[0].message.content, 'dedup response');
      }

      // Exactly 1 upstream call made!
      assert.strictEqual(upstreamCallCount, 1, `Expected 1 upstream call, got ${upstreamCallCount}`);

      const m = metricsService.getMetrics();
      assert.strictEqual(m.deduplicationHits, 5, `Expected 5 deduplication hits, got ${m.deduplicationHits}`);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });
});
