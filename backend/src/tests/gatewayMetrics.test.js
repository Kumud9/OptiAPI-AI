const test = require('node:test');
const assert = require('node:assert');
const metricsService = require('../services/metricsService');
const { MetricsCollector } = require('../services/metricsService');
const { getGatewayMetrics } = require('../controllers/metricsController');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const externalApiService = require('../services/externalApiService');
const RequestLog = require('../models/RequestLog');
const { clearInFlight } = require('../services/requestDeduplicationService');

test('Phase 2D: Gateway Performance Metrics Suite', async (t) => {

  t.beforeEach(() => {
    metricsService.resetMetrics();
    clearInFlight();
  });

  await t.test('1. Metric Recording - Counters and Basic Stats', async () => {
    metricsService.recordRequest();
    metricsService.recordRequest();
    metricsService.recordRequest();

    metricsService.recordUpstreamRequest();
    metricsService.recordUpstreamRequest();

    metricsService.recordCacheHit();
    metricsService.recordCacheMiss();
    metricsService.recordCacheMiss();

    metricsService.recordDeduplicationHit();
    metricsService.recordError();

    metricsService.recordLatency(50);
    metricsService.recordLatency(150);

    const m = metricsService.getMetrics();

    assert.strictEqual(m.totalRequests, 3);
    assert.strictEqual(m.upstreamRequests, 2);
    assert.strictEqual(m.cacheHits, 1);
    assert.strictEqual(m.cacheMisses, 2);
    assert.strictEqual(m.deduplicationHits, 1);
    assert.strictEqual(m.errorCount, 1);

    assert.strictEqual(m.latency.min, 50);
    assert.strictEqual(m.latency.max, 150);
    assert.strictEqual(m.latency.avg, 100);
    assert.strictEqual(m.latency.sampleCount, 2);
  });

  await t.test('2. Percentile Calculation - P50, P95, P99 Accuracy', async () => {
    const collector = new MetricsCollector();

    // 0 samples edge case
    assert.strictEqual(collector.calculatePercentile(50), 0);
    assert.strictEqual(collector.calculatePercentile(95), 0);
    assert.strictEqual(collector.calculatePercentile(99), 0);

    // 1 sample edge case
    collector.recordLatency(42);
    assert.strictEqual(collector.calculatePercentile(50), 42);
    assert.strictEqual(collector.calculatePercentile(95), 42);
    assert.strictEqual(collector.calculatePercentile(99), 42);

    // 100 samples from 1 to 100
    collector.reset();
    for (let i = 1; i <= 100; i++) {
      collector.recordLatency(i);
    }

    const p50 = collector.calculatePercentile(50);
    const p95 = collector.calculatePercentile(95);
    const p99 = collector.calculatePercentile(99);

    // With 100 items 1..100, median index is 49.5 -> values 50 & 51 -> 50.5
    assert.strictEqual(p50, 50.5, 'P50 should be median (50.5)');
    // 95th percentile index is 0.95 * 99 = 94.05 -> ~95.05
    assert.strictEqual(p95, 95.05, 'P95 should be 95.05');
    // 99th percentile index is 0.99 * 99 = 98.01 -> ~99.01
    assert.strictEqual(p99, 99.01, 'P99 should be 99.01');

    const fullMetrics = collector.getMetrics();
    assert.strictEqual(fullMetrics.p50Latency, 50.5);
    assert.strictEqual(fullMetrics.p95Latency, 95.05);
    assert.strictEqual(fullMetrics.p99Latency, 99.01);
  });

  await t.test('3. Rolling buffer capping prevents unbounded memory leak', async () => {
    const collector = new MetricsCollector();
    // Add 12,000 samples (max cap is 10,000)
    for (let i = 0; i < 12000; i++) {
      collector.recordLatency(10);
    }
    assert.strictEqual(collector.latencies.length, 10000, 'Samples array should be capped at MAX_SAMPLES');
  });

  await t.test('4. GET /api/metrics Controller returns full metrics schema', async () => {
    metricsService.recordRequest();
    metricsService.recordCacheHit();
    metricsService.recordLatency(25);

    let status = null;
    let jsonBody = null;
    const req = {};
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      }
    };

    getGatewayMetrics(req, res);

    assert.strictEqual(status, 200);
    assert.strictEqual(jsonBody.success, true);
    assert.strictEqual(typeof jsonBody.totalRequests, 'number');
    assert.strictEqual(typeof jsonBody.p50Latency, 'number');
    assert.strictEqual(typeof jsonBody.p95Latency, 'number');
    assert.strictEqual(typeof jsonBody.p99Latency, 'number');
    assert.strictEqual(typeof jsonBody.cacheHits, 'number');
    assert.strictEqual(typeof jsonBody.cacheMisses, 'number');
    assert.strictEqual(typeof jsonBody.deduplicationHits, 'number');
    assert.strictEqual(typeof jsonBody.upstreamRequests, 'number');
    assert.strictEqual(typeof jsonBody.errors, 'number');
    assert.ok(jsonBody.latency, 'Latency object should be present');
  });

  await t.test('5. Gateway Integration - Request flow increments in-memory metrics without DB writes for metrics', async () => {
    const originalRequestLogCreate = RequestLog.create;
    const originalSimulateApiCall = externalApiService.simulateApiCall;

    RequestLog.create = async () => ({ _id: 'mock_log_id' });
    externalApiService.simulateApiCall = async () => ({
      data: { choices: [{ message: { content: 'ok' } }] },
      tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      model: 'gpt-4o'
    });

    try {
      const initialMetrics = metricsService.getMetrics();
      assert.strictEqual(initialMetrics.totalRequests, 0);

      // Execute request 1
      await new Promise((resolve) => {
        const req = {
          params: { provider: 'openai', '0': '/v1/chat/completions' },
          method: 'POST',
          body: { model: 'gpt-4o' },
          headers: {},
          userId: 'user_metrics_1',
          query: {}
        };
        const res = {
          statusCode: 200,
          headers: {},
          setHeader() {},
          status(code) { this.statusCode = code; return this; },
          json(payload) { resolve(payload); }
        };
        handleGatewayRequest(req, res);
      });

      const afterReq1 = metricsService.getMetrics();
      assert.strictEqual(afterReq1.totalRequests, 1, 'Total requests should increment to 1');
      assert.strictEqual(afterReq1.upstreamRequests, 1, 'Upstream requests should increment to 1');
      assert.strictEqual(afterReq1.cacheMisses, 1, 'Cache misses should increment to 1');
      assert.strictEqual(afterReq1.errorCount, 0, 'Errors should be 0');
      assert.strictEqual(afterReq1.latency.sampleCount, 1, 'Latency sample should be recorded');
    } finally {
      RequestLog.create = originalRequestLogCreate;
      externalApiService.simulateApiCall = originalSimulateApiCall;
    }
  });

  await t.test('6. Gateway Integration - Error increment on upstream failure', async () => {
    const originalRequestLogCreate = RequestLog.create;
    const originalSimulateApiCall = externalApiService.simulateApiCall;

    RequestLog.create = async () => ({ _id: 'mock_log_id' });
    externalApiService.simulateApiCall = async () => {
      const err = new Error('Fatal non-retryable provider failure');
      err.shouldRetry = false;
      err.status = 500;
      throw err;
    };

    try {
      await new Promise((resolve) => {
        const req = {
          params: { provider: 'openai', '0': '/v1/chat/completions' },
          method: 'POST',
          body: { model: 'gpt-4o' },
          headers: {},
          userId: 'user_metrics_fail',
          query: {}
        };
        const res = {
          statusCode: 200,
          headers: {},
          setHeader() {},
          status(code) { this.statusCode = code; return this; },
          json(payload) { resolve(payload); }
        };
        handleGatewayRequest(req, res);
      });

      const afterFail = metricsService.getMetrics();
      assert.strictEqual(afterFail.totalRequests, 1);
      assert.strictEqual(afterFail.errorCount, 1, 'Error count should increment to 1 on gateway failure');
    } finally {
      RequestLog.create = originalRequestLogCreate;
      externalApiService.simulateApiCall = originalSimulateApiCall;
    }
  });

});
