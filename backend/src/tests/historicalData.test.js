'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('../models/User');
const RequestLog = require('../models/RequestLog');
const { getHistoricalMetricsForUser, resolveModelName, calculateP95 } = require('../services/historicalDataService');

test('Historical Data Analyzer Integration & Unit Tests', async (t) => {
  // 1. Pure Unit Tests
  await t.test('resolveModelName Unit Test', () => {
    const logWithModel = { provider: 'openai', model: 'gpt-4o', endpoint: '/v1/chat/completions' };
    assert.strictEqual(resolveModelName(logWithModel), 'gpt-4o');

    const logGeminiNoModel = { provider: 'gemini', model: '', endpoint: '/v1/models/gemini-2.0-flash-exp:generateContent' };
    assert.strictEqual(resolveModelName(logGeminiNoModel), 'gemini-2.0-flash-exp');

    const logOtherNoModel = { provider: 'openai', model: ' ', endpoint: '/v1/chat/completions' };
    assert.strictEqual(resolveModelName(logOtherNoModel), 'unknown');
  });

  await t.test('calculateP95 Unit Test', () => {
    assert.strictEqual(calculateP95([]), 0);
    assert.strictEqual(calculateP95([100]), 100);
    
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    assert.strictEqual(calculateP95(latencies), 1000);

    const latencies3 = [150, 300, 250];
    assert.strictEqual(calculateP95(latencies3), 300);
  });

  // 2. Integration / Database-dependent Tests
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  const tempUserEmail = `temp_user_${Date.now()}@test.com`;
  const tempAdminEmail = `temp_admin_${Date.now()}@test.com`;
  let tempUser, tempAdmin;

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

    await t.test('Excludes admin users from results entirely', async () => {
      await RequestLog.create({
        userId: tempAdmin._id,
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        status: 200,
        responseTimeMs: 250,
        costUsd: 0.005,
        tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        cacheStatus: 'MISS'
      });

      const metrics = await getHistoricalMetricsForUser(tempAdmin._id);
      assert.strictEqual(metrics.length, 0, 'Admin metrics must return empty array');
    });

    await t.test('Calculates metrics correctly for authenticated user', async () => {
      const logsData = [
        {
          userId: tempUser._id,
          provider: 'openai',
          model: 'gpt-4o',
          endpoint: '/v1/chat/completions',
          method: 'POST',
          status: 200,
          responseTimeMs: 200,
          costUsd: 0.001,
          tokensUsed: { totalTokens: 50 },
          cacheStatus: 'MISS'
        },
        {
          userId: tempUser._id,
          provider: 'openai',
          model: 'gpt-4o',
          endpoint: '/v1/chat/completions',
          method: 'POST',
          status: 200,
          responseTimeMs: 10,
          costUsd: 0.0,
          tokensUsed: { totalTokens: 0 },
          cacheStatus: 'HIT'
        },
        {
          userId: tempUser._id,
          provider: 'openai',
          model: 'gpt-4o',
          endpoint: '/v1/chat/completions',
          method: 'POST',
          status: 200,
          responseTimeMs: 300,
          costUsd: 0.002,
          tokensUsed: { totalTokens: 100 },
          cacheStatus: 'BYPASS'
        },
        {
          userId: tempUser._id,
          provider: 'openai',
          model: 'gpt-4o',
          endpoint: '/v1/chat/completions',
          method: 'POST',
          status: 500,
          responseTimeMs: 100,
          costUsd: 0.0,
          tokensUsed: { totalTokens: 0 },
          cacheStatus: 'MISS'
        },
        {
          userId: tempUser._id,
          provider: 'openai',
          model: 'gpt-4o',
          endpoint: '/v1/chat/completions',
          method: 'POST',
          status: 200,
          responseTimeMs: 400,
          costUsd: 0.003,
          tokensUsed: { totalTokens: 150 },
          cacheStatus: 'MISS'
        },
        {
          userId: tempUser._id,
          provider: 'gemini',
          model: '',
          endpoint: '/v1/models/gemini-1.5-flash:generateContent',
          method: 'POST',
          status: 200,
          responseTimeMs: 500,
          costUsd: 0.0005,
          tokensUsed: { totalTokens: 200 },
          cacheStatus: 'MISS'
        }
      ];

      await RequestLog.create(logsData);

      const metrics = await getHistoricalMetricsForUser(tempUser._id);
      assert.strictEqual(metrics.length, 2, 'Should return exactly 2 metric groups');

      const openaiMetric = metrics.find(m => m.provider === 'openai');
      const geminiMetric = metrics.find(m => m.provider === 'gemini');

      assert.ok(openaiMetric, 'OpenAI metrics must exist');
      assert.ok(geminiMetric, 'Gemini metrics must exist');

      assert.strictEqual(openaiMetric.requestCount, 5, 'Total requestCount should be 5');
      assert.strictEqual(openaiMetric.successfulRequests, 4, 'Successful requests should be 4 (status 200)');
      assert.strictEqual(openaiMetric.successRate, 0.8, 'Success rate should be 4/5 = 0.8');

      assert.strictEqual(openaiMetric.cacheHits, 1, 'cacheHits should be 1');
      assert.strictEqual(openaiMetric.cacheMisses, 3, 'cacheMisses should be 3');
      assert.strictEqual(openaiMetric.cacheBypasses, 1, 'cacheBypasses should be 1');

      assert.strictEqual(openaiMetric.avgLatencyMs, 300, 'Average latency must be 300ms');
      assert.strictEqual(openaiMetric.p95LatencyMs, 400, 'P95 latency must be 400ms');
      assert.strictEqual(openaiMetric.totalCostUsd, 0.006, 'Total cost must be 0.006 USD');
      assert.strictEqual(openaiMetric.avgCostUsd, 0.002, 'Average cost must be 0.002 USD');
      assert.strictEqual(openaiMetric.avgTotalTokens, 100, 'Average tokens must be 100');

      assert.strictEqual(geminiMetric.model, 'gemini-1.5-flash', 'Gemini model fallback should resolve gemini-1.5-flash');
      assert.strictEqual(geminiMetric.requestCount, 1, 'Gemini request count should be 1');
      assert.strictEqual(geminiMetric.successfulRequests, 1, 'Gemini success count should be 1');
      assert.strictEqual(geminiMetric.successRate, 1.0, 'Gemini success rate should be 1.0');
      assert.strictEqual(geminiMetric.avgLatencyMs, 500, 'Gemini average latency should be 500ms');
      assert.strictEqual(geminiMetric.avgTotalTokens, 200, 'Gemini average tokens should be 200');
    });

  } finally {
    if (tempUser && tempUser._id) {
      await RequestLog.deleteMany({ userId: tempUser._id });
      await User.deleteOne({ _id: tempUser._id });
    }
    if (tempAdmin && tempAdmin._id) {
      await RequestLog.deleteMany({ userId: tempAdmin._id });
      await User.deleteOne({ _id: tempAdmin._id });
    }
    await mongoose.disconnect();
  }
});
