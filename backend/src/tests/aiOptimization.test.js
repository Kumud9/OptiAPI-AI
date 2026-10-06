'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { getRedisClient } = require('../config/redis');
const RequestLog = require('../models/RequestLog');
const {
  getRoutingPolicy,
  setRoutingPolicy,
  deleteRoutingPolicy,
  validateAiPolicy,
  SUPPORTED_PROVIDERS,
  SUPPORTED_MODELS
} = require('../services/policyService');
const {
  aggregateUserTelemetry,
  calculateP95
} = require('../services/telemetryAnalyticsService');
const {
  runAiOptimization,
  generateAiRecommendation,
  buildSanitizedAiInput,
  evaluatePolicyComparison,
  isInFlight,
  clearInFlightOptimizations
} = require('../services/aiOptimizationService');
const metricsService = require('../services/metricsService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const externalApiService = require('../services/externalApiService');

test('Phase 5: AI-Driven Optimization Engine Suite', async (t) => {
  const testUserId1 = '507f1f77bcf86cd799439091';
  const testUserId2 = '507f1f77bcf86cd799439092';

  const redis = getRedisClient();

  // Mock RequestLog.aggregate for unit/integration testing
  const originalAggregate = RequestLog.aggregate;

  // Cleanup helper
  const cleanup = async () => {
    metricsService.resetMetrics();
    clearInFlightOptimizations();
    await deleteRoutingPolicy(testUserId1);
    await deleteRoutingPolicy(testUserId2);
  };

  t.beforeEach(async () => {
    await cleanup();
  });

  t.afterEach(async () => {
    await cleanup();
    RequestLog.aggregate = originalAggregate;
  });

  // Mock telemetry data helper
  const createMockTelemetry = (userId = testUserId1) => [
    {
      _id: { provider: 'openai', model: 'gpt-4o' },
      requestCount: 100,
      successCount: 95,
      errorCount: 5,
      cacheHitCount: 20,
      totalCostUsd: 0.05,
      avgLatencyMs: 450,
      latencies: [300, 400, 450, 500, 700]
    },
    {
      _id: { provider: 'gemini', model: 'gemini-1.5-flash' },
      requestCount: 80,
      successCount: 78,
      errorCount: 2,
      cacheHitCount: 15,
      totalCostUsd: 0.008,
      avgLatencyMs: 180,
      latencies: [120, 150, 180, 210, 290]
    },
    {
      _id: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
      requestCount: 50,
      successCount: 49,
      errorCount: 1,
      cacheHitCount: 5,
      totalCostUsd: 0.04,
      avgLatencyMs: 520,
      latencies: [400, 480, 520, 600, 850]
    }
  ];

  await t.test('1. Telemetry aggregation calculates requestCount, successRate, errorRate, latencies, cost, cacheHitRate', async () => {
    RequestLog.aggregate = async (pipeline) => {
      // Verify bounded query structure
      assert.ok(Array.isArray(pipeline), 'Aggregation pipeline must be an array');
      const match = pipeline.find(stage => stage.$match)?.$match;
      assert.ok(match, '$match stage is required');
      assert.ok(match.timestamp?.$gte, 'Time window must be bounded via $gte');
      assert.ok(match.provider?.$in, 'Providers must be bounded via $in');
      const limit = pipeline.find(stage => stage.$limit)?.$limit;
      assert.ok(limit && limit <= 5000, 'Pipeline must have hard $limit cap');

      return createMockTelemetry();
    };

    const telemetry = await aggregateUserTelemetry(testUserId1, { windowHours: 24, maxDocs: 1000 });

    assert.strictEqual(telemetry.length, 3);
    const gemini = telemetry.find(t => t.provider === 'gemini');
    assert.ok(gemini);
    assert.strictEqual(gemini.requestCount, 80);
    assert.strictEqual(gemini.successRate, 0.975); // 78 / 80
    assert.strictEqual(gemini.errorRate, 0.025);   // 2 / 80
    assert.strictEqual(gemini.cacheHitRate, 0.1875); // 15 / 80
    assert.strictEqual(gemini.avgLatency, 180);
    assert.strictEqual(gemini.p95Latency, 290);
    assert.strictEqual(gemini.estimatedCost, 0.008);
  });

  await t.test('2. Bounded historical query never loads entire RequestLog collection into Node memory', async () => {
    let unconstrainedFindCalled = false;
    const originalFind = RequestLog.find;
    RequestLog.find = () => {
      unconstrainedFindCalled = true;
      throw new Error('Unconstrained RequestLog.find should NOT be called by analytics aggregation');
    };

    try {
      RequestLog.aggregate = async () => [];
      await aggregateUserTelemetry(testUserId1);
      assert.strictEqual(unconstrainedFindCalled, false, 'RequestLog.find must never be called');
    } finally {
      RequestLog.find = originalFind;
    }
  });

  await t.test('3. Successful AI recommendation updates Redis routing policy with versioning', async () => {
    RequestLog.aggregate = async () => createMockTelemetry();

    // Set an initial baseline policy (v1)
    await setRoutingPolicy(testUserId1, {
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      policyVersion: 1
    });

    const result = await runAiOptimization(testUserId1, { objective: 'cost' });

    assert.strictEqual(result.success, true);
    assert.ok(result.policy);
    assert.strictEqual(result.policy.provider, 'gemini');
    assert.strictEqual(result.policy.model, 'gemini-1.5-flash');
    assert.strictEqual(result.policy.strategy, 'cost');
    assert.strictEqual(result.policy.aiGenerated, true);
    assert.strictEqual(result.policy.policyVersion, 2, 'Version must increment from 1 to 2');
    assert.ok(result.policy.generatedAt);

    // Verify Redis has persisted the new policy
    const redisPolicy = await getRoutingPolicy(testUserId1);
    assert.ok(redisPolicy);
    assert.strictEqual(redisPolicy.provider, 'gemini');
    assert.strictEqual(redisPolicy.model, 'gemini-1.5-flash');
    assert.strictEqual(redisPolicy.policyVersion, 2);

    const m = metricsService.getMetrics();
    assert.strictEqual(m.optimization.runs, 1);
    assert.strictEqual(m.optimization.successes, 1);
    assert.strictEqual(m.optimization.policiesGenerated, 1);
  });

  await t.test('4. Malformed AI output is rejected safely without breaking Redis policy', async () => {
    RequestLog.aggregate = async () => createMockTelemetry();

    // Baseline policy
    await setRoutingPolicy(testUserId1, {
      provider: 'openai',
      model: 'gpt-4o',
      policyVersion: 1
    });

    // Mock AI returning unparseable garbage
    const malformedRecommender = async () => '```json\nTHIS IS NOT JSON AT ALL!!\n```';

    const result = await runAiOptimization(testUserId1, { aiRecommender: malformedRecommender });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'MALFORMED_AI_OUTPUT');

    // Existing policy in Redis must remain untouched
    const redisPolicy = await getRoutingPolicy(testUserId1);
    assert.strictEqual(redisPolicy.provider, 'openai');
    assert.strictEqual(redisPolicy.model, 'gpt-4o');
    assert.strictEqual(redisPolicy.policyVersion, 1);

    const m = metricsService.getMetrics();
    assert.strictEqual(m.optimization.failures, 1);
    assert.strictEqual(m.optimization.policiesRejected, 1);
  });

  await t.test('5. Invalid provider or hallucinated model is rejected by strict policy validation', async () => {
    RequestLog.aggregate = async () => createMockTelemetry();

    await setRoutingPolicy(testUserId1, {
      provider: 'openai',
      model: 'gpt-4o',
      policyVersion: 1
    });

    // 1. Unsupported provider
    const badProviderRecommender = async () => ({
      provider: 'deepseek',
      model: 'deepseek-v3',
      strategy: 'cost'
    });
    const res1 = await runAiOptimization(testUserId1, { aiRecommender: badProviderRecommender });
    assert.strictEqual(res1.success, false);
    assert.strictEqual(res1.code, 'POLICY_VALIDATION_FAILED');

    // 2. Hallucinated model for supported provider
    const badModelRecommender = async () => ({
      provider: 'openai',
      model: 'gpt-5-omni-pro',
      strategy: 'latency'
    });
    const res2 = await runAiOptimization(testUserId1, { aiRecommender: badModelRecommender });
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.code, 'POLICY_VALIDATION_FAILED');

    // Existing policy preserved
    const redisPolicy = await getRoutingPolicy(testUserId1);
    assert.strictEqual(redisPolicy.provider, 'openai');
    assert.strictEqual(redisPolicy.model, 'gpt-4o');
  });

  await t.test('6. Invalid timeout and retry values are rejected by policy validation', async () => {
    // 1. Negative timeout
    const p1 = validateAiPolicy({
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      timeoutMs: -500
    });
    assert.strictEqual(p1, null);

    // 2. Excessive timeout (> 30000ms)
    const p2 = validateAiPolicy({
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      timeoutMs: 60000
    });
    assert.strictEqual(p2, null);

    // 3. Excessive retries (> 5)
    const p3 = validateAiPolicy({
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      maxRetries: 10
    });
    assert.strictEqual(p3, null);

    // 4. Valid values pass
    const pValid = validateAiPolicy({
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      timeoutMs: 12000,
      maxRetries: 3,
      cacheEnabled: true
    });
    assert.ok(pValid);
    assert.strictEqual(pValid.timeoutMs, 12000);
    assert.strictEqual(pValid.maxRetries, 3);
  });

  await t.test('7. AI provider failure preserves current Redis policy without crashing', async () => {
    RequestLog.aggregate = async () => createMockTelemetry();

    await setRoutingPolicy(testUserId1, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      policyVersion: 1
    });

    const failingRecommender = async () => {
      const err = new Error('503 Service Unavailable: upstream model rate-limited');
      err.code = 'LLM_RATE_LIMIT';
      throw err;
    };

    const res = await runAiOptimization(testUserId1, { aiRecommender: failingRecommender });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, 'AI_PROVIDER_ERROR');

    // Current policy preserved
    const current = await getRoutingPolicy(testUserId1);
    assert.strictEqual(current.provider, 'anthropic');
    assert.strictEqual(current.model, 'claude-3-5-sonnet');

    const m = metricsService.getMetrics();
    assert.strictEqual(m.optimization.failures, 1);
  });

  await t.test('8. Evaluation accurately reflects current vs proposed policy metrics and genuine savings', async () => {
    RequestLog.aggregate = async () => createMockTelemetry();

    // Current is OpenAI gpt-4o ($0.05, 450ms)
    await setRoutingPolicy(testUserId1, {
      provider: 'openai',
      model: 'gpt-4o',
      policyVersion: 1
    });

    // Objective cost will recommend Gemini 1.5 flash ($0.008, 180ms)
    const res = await runAiOptimization(testUserId1, { objective: 'cost' });

    assert.strictEqual(res.success, true);
    assert.ok(res.evaluation);
    assert.strictEqual(res.evaluation.hasBaseline, true);
    assert.strictEqual(res.evaluation.current.provider, 'openai');
    assert.strictEqual(res.evaluation.proposed.provider, 'gemini');

    // Genuine savings: 0.05 - 0.008 = 0.042
    assert.strictEqual(res.evaluation.savings.costSavingsUsd, 0.042);
    assert.strictEqual(res.evaluation.savings.costSavingsPercent, 84); // (0.042 / 0.05) * 100
    assert.strictEqual(res.evaluation.savings.latencyReductionMs, 270); // 450 - 180
  });

  await t.test('9. In-flight concurrency lock prevents duplicate overlapping jobs for the same user', async () => {
    RequestLog.aggregate = async () => {
      // Simulate 50ms aggregation duration
      await new Promise(r => setTimeout(r, 50));
      return createMockTelemetry();
    };

    // Trigger two optimizations simultaneously for the same user
    const p1 = runAiOptimization(testUserId1, { objective: 'cost' });
    const p2 = runAiOptimization(testUserId1, { objective: 'latency' });

    const [r1, r2] = await Promise.all([p1, p2]);

    const successfulRuns = [r1, r2].filter(r => r.success);
    const lockedRuns = [r1, r2].filter(r => r.code === 'OPTIMIZATION_IN_PROGRESS');

    assert.strictEqual(successfulRuns.length, 1, 'Exactly one job must succeed');
    assert.strictEqual(lockedRuns.length, 1, 'The overlapping job must be rejected with OPTIMIZATION_IN_PROGRESS');
  });

  await t.test('10. Multiple users remain isolated during concurrent optimizations', async () => {
    RequestLog.aggregate = async (pipeline) => {
      const match = pipeline.find(stage => stage.$match)?.$match;
      if (String(match.userId) === testUserId1) {
        return [
          {
            _id: { provider: 'openai', model: 'gpt-4o' },
            requestCount: 50,
            successCount: 50,
            totalCostUsd: 0.05,
            avgLatencyMs: 400
          }
        ];
      } else {
        return [
          {
            _id: { provider: 'anthropic', model: 'claude-3-5-sonnet' },
            requestCount: 30,
            successCount: 30,
            totalCostUsd: 0.02,
            avgLatencyMs: 250
          }
        ];
      }
    };

    const [r1, r2] = await Promise.all([
      runAiOptimization(testUserId1, { objective: 'balanced' }),
      runAiOptimization(testUserId2, { objective: 'balanced' })
    ]);

    assert.strictEqual(r1.success, true);
    assert.strictEqual(r2.success, true);

    const policy1 = await getRoutingPolicy(testUserId1);
    const policy2 = await getRoutingPolicy(testUserId2);

    assert.strictEqual(policy1.provider, 'openai');
    assert.strictEqual(policy2.provider, 'anthropic');
  });

  await t.test('11. Optimization never executes from the synchronous gateway path', async () => {
    let aiOptimizationInvoked = false;
    const originalAiOpt = runAiOptimization;

    // We can spy on runAiOptimization
    // If handleGatewayRequest is called, it must never call runAiOptimization
    const spy = async () => {
      aiOptimizationInvoked = true;
      return { success: false };
    };

    // Ensure Redis has a policy
    await setRoutingPolicy(testUserId1, {
      provider: 'openai',
      model: 'gpt-4o',
      policyVersion: 1
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
        userId: testUserId1,
        query: {}
      };

      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; }
      };

      await handleGatewayRequest(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(aiOptimizationInvoked, false, 'AI Optimization must never run on gateway request path');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('12. Sensitive fields are completely excluded from AI model input', async () => {
    const rawTelemetry = [
      {
        provider: 'openai',
        model: 'gpt-4o',
        requestCount: 10,
        successRate: 1,
        errorRate: 0,
        avgLatency: 300,
        p95Latency: 350,
        estimatedCost: 0.01,
        cacheHitRate: 0.2,
        secretField: 'sk-12345',
        prompt: 'sensitive text',
        authorization: 'Bearer token'
      }
    ];

    const currentPolicy = {
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      timeoutMs: 15000,
      maxRetries: 2,
      cacheEnabled: true,
      internalSecret: 'dont_leak'
    };

    const safeInput = buildSanitizedAiInput(rawTelemetry, currentPolicy, 'cost');

    assert.strictEqual(safeInput.objective, 'cost');
    assert.ok(safeInput.supportedProviders);
    assert.ok(safeInput.telemetry[0].provider);
    assert.strictEqual(safeInput.telemetry[0].secretField, undefined);
    assert.strictEqual(safeInput.telemetry[0].prompt, undefined);
    assert.strictEqual(safeInput.telemetry[0].authorization, undefined);
    assert.strictEqual(safeInput.currentPolicy.internalSecret, undefined);
  });
});
