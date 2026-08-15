'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const RequestLog = require('../models/RequestLog');
const { evaluateOptimization } = require('../services/optimizationEvaluationService');

test('Optimization Evaluation / Feedback Tests', async (t) => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  const tempUserEmail = `eval_user_${Date.now()}@test.com`;
  const tempAdminEmail = `eval_admin_${Date.now()}@test.com`;
  const otherUserEmail = `other_user_${Date.now()}@test.com`;

  let tempUser, tempAdmin, otherUser;

  try {
    tempUser = await User.create({
      email: tempUserEmail,
      password: 'password123',
      role: 'user'
    });

    tempAdmin = await User.create({
      email: tempAdminEmail,
      password: 'password123',
      role: 'admin'
    });

    otherUser = await User.create({
      email: otherUserEmail,
      password: 'password123',
      role: 'user'
    });

    // 11. Admin data excluded test
    await t.test('Admin/mock data excluded', async () => {
      await RequestLog.create({
        userId: tempAdmin._id,
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite',
        endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
        method: 'POST',
        status: 200,
        responseTimeMs: 1500,
        costUsd: 0.0001,
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        cacheStatus: 'MISS',
        optimizationUsed: true
      });

      const res = await evaluateOptimization(tempAdmin._id);
      assert.strictEqual(res, null, 'Evaluation for admin must be null');
    });

    // 12. No optimized data response test
    await t.test('No optimized data response', async () => {
      const res = await evaluateOptimization(tempUser._id);
      assert.strictEqual(res, null, 'Should return null if no optimizer-controlled logs exist for this user');
    });

    // Main functional tests
    await t.test('Comprehensive optimization evaluation calculations', async () => {
      // Seed data for tempUser
      // 1. Optimized request metrics
      // 2. Successful request calculation
      // 3. Failed request calculation
      // 4. Cache HIT excluded from provider-performance metrics
      // 5. Average latency
      // 6. Average cost
      // 7. P95 latency
      // 10. User isolation (by adding some logs for otherUser and validating they are not mixed in)

      const seedLogs = [
        // User's optimized logs
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 200, // successful request 1
          responseTimeMs: 1000,
          costUsd: 0.00001,
          tokensUsed: { totalTokens: 10 },
          cacheStatus: 'MISS',
          optimizationUsed: true
        },
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 200, // successful request 2
          responseTimeMs: 2000,
          costUsd: 0.00002,
          tokensUsed: { totalTokens: 20 },
          cacheStatus: 'MISS',
          optimizationUsed: true
        },
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 200, // successful request 3 but CACHE HIT (should be excluded from latency/cost stats)
          responseTimeMs: 5,
          costUsd: 0.0,
          tokensUsed: { totalTokens: 0 },
          cacheStatus: 'HIT',
          optimizationUsed: true
        },
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 502, // failed request 1
          responseTimeMs: 3000,
          costUsd: 0.0,
          tokensUsed: { totalTokens: 0 },
          cacheStatus: 'BYPASS',
          optimizationUsed: true
        },
        // Other user's optimized log (User Isolation verification)
        {
          userId: otherUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 200,
          responseTimeMs: 500,
          costUsd: 0.000005,
          tokensUsed: { totalTokens: 5 },
          cacheStatus: 'MISS',
          optimizationUsed: true
        }
      ];

      await RequestLog.create(seedLogs);

      // Perform evaluation for tempUser with missing baseline (should return null for baseline improvement values)
      // 9. Missing baseline returns null
      const evalResultNoBaseline = await evaluateOptimization(tempUser._id, {
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite'
      });

      assert.ok(evalResultNoBaseline, 'Evaluation result should be defined');
      assert.strictEqual(evalResultNoBaseline.optimizedRequests, 4, 'Optimized requests count should be 4');
      assert.strictEqual(evalResultNoBaseline.successfulRequests, 3, 'Successful requests count should be 3');
      assert.strictEqual(evalResultNoBaseline.successRate, 0.75, 'Success rate should be 3/4 = 0.75');

      // Cache hit excluded checks (successful ones with MISS/BYPASS are responseTimeMs: [1000, 2000] -> avg = 1500, p95 = 2000)
      assert.strictEqual(evalResultNoBaseline.avgLatencyMs, 1500, 'Average latency should be 1500 (ignoring cache hits and failed requests)');
      assert.strictEqual(evalResultNoBaseline.p95LatencyMs, 2000, 'P95 latency should be 2000');
      assert.strictEqual(evalResultNoBaseline.avgCostUsd, 0.000015, 'Average cost should be 0.000015');
      assert.strictEqual(evalResultNoBaseline.avgTotalTokens, 15, 'Average total tokens should be 15');

      // Baseline comparisons should be null
      assert.strictEqual(evalResultNoBaseline.latencyImprovementPercent, null);
      assert.strictEqual(evalResultNoBaseline.costImprovementPercent, null);
      assert.strictEqual(evalResultNoBaseline.reliabilityDifference, null);

      // 8. Baseline comparison when data exists
      // Add baseline data for tempUser (optimizationUsed is false or not set)
      const baselineLogs = [
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 200,
          responseTimeMs: 3000, // Baseline avg latency will be 3000
          costUsd: 0.00003,      // Baseline avg cost will be 0.00003
          tokensUsed: { totalTokens: 30 },
          cacheStatus: 'MISS',
          optimizationUsed: false
        },
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite',
          endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
          method: 'POST',
          status: 200,
          responseTimeMs: 3000,
          costUsd: 0.00003,
          tokensUsed: { totalTokens: 30 },
          cacheStatus: 'MISS',
          optimizationUsed: undefined // testing undefined field
        }
      ];

      await RequestLog.create(baselineLogs);

      const evalResultWithBaseline = await evaluateOptimization(tempUser._id, {
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite'
      });

      // Baseline success rate = 2/2 = 100% (1.0). Optimized success rate = 75% (0.75)
      // reliabilityDifference = optimizedSuccessRate - baselineSuccessRate = 0.75 - 1.0 = -0.25
      assert.strictEqual(evalResultWithBaseline.reliabilityDifference, -0.25);

      // Baseline avg latency = 3000ms. Optimized avg latency = 1500ms.
      // Latency improvement = ((3000 - 1500) / 3000) * 100 = 50%
      assert.strictEqual(evalResultWithBaseline.latencyImprovementPercent, 50.0);

      // Baseline avg cost = 0.00003. Optimized avg cost = 0.000015.
      // Cost improvement = ((0.00003 - 0.000015) / 0.00003) * 100 = 50%
      assert.strictEqual(evalResultWithBaseline.costImprovementPercent, 50.0);
    });

  } finally {
    // Cleanup seed data
    if (tempUser && tempUser._id) {
      await RequestLog.deleteMany({ userId: tempUser._id });
      await User.deleteOne({ _id: tempUser._id });
    }
    if (tempAdmin && tempAdmin._id) {
      await RequestLog.deleteMany({ userId: tempAdmin._id });
      await User.deleteOne({ _id: tempAdmin._id });
    }
    if (otherUser && otherUser._id) {
      await RequestLog.deleteMany({ userId: otherUser._id });
      await User.deleteOne({ _id: otherUser._id });
    }
    await mongoose.disconnect();
  }
});
