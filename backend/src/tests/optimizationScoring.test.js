'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { calculateRecommendation } = require('../services/scoringService');

test('Optimization Scoring Engine Unit Tests', async (t) => {

  // Mock metrics data for testing
  const mockMetrics = [
    {
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: '/v1/chat/completions',
      requestCount: 10,
      successfulRequests: 10, // 100% success rate
      successRate: 1.0,
      avgLatencyMs: 300,
      p95LatencyMs: 400,
      avgCostUsd: 0.002,
      totalCostUsd: 0.02,
      avgTotalTokens: 100,
      cacheHits: 0,
      cacheMisses: 10,
      cacheBypasses: 0
    },
    {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      endpoint: '/v1/models/gemini-1.5-flash:generateContent',
      requestCount: 8,
      successfulRequests: 8, // 100% success rate
      successRate: 1.0,
      avgLatencyMs: 150, // much faster latency
      p95LatencyMs: 200,
      avgCostUsd: 0.004, // higher cost
      totalCostUsd: 0.032,
      avgTotalTokens: 200,
      cacheHits: 0,
      cacheMisses: 8,
      cacheBypasses: 0
    },
    {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      endpoint: '/v1/chat/completions',
      requestCount: 20,
      successfulRequests: 18, // 90% success rate
      successRate: 0.9,
      avgLatencyMs: 250,
      p95LatencyMs: 350,
      avgCostUsd: 0.0005, // very cheap cost
      totalCostUsd: 0.01,
      avgTotalTokens: 100,
      cacheHits: 0,
      cacheMisses: 20,
      cacheBypasses: 0
    }
  ];

  await t.test('1. Cost Mode (prefers cheapest)', () => {
    const rec = calculateRecommendation(mockMetrics, 'cost');
    assert.ok(rec);
    assert.strictEqual(rec.provider, 'openai');
    assert.strictEqual(rec.model, 'gpt-3.5-turbo'); // Should be gpt-3.5-turbo because of lowest cost
  });

  await t.test('2. Latency Mode (prefers fastest)', () => {
    const rec = calculateRecommendation(mockMetrics, 'latency');
    assert.ok(rec);
    assert.strictEqual(rec.provider, 'gemini');
    assert.strictEqual(rec.model, 'gemini-1.5-flash'); // Should be gemini because of lowest latency (150ms)
  });

  await t.test('3. Balanced Mode weighting', () => {
    const rec = calculateRecommendation(mockMetrics, 'balanced');
    assert.ok(rec);
    // Let's check which is recommended in balanced mode
    // openai/gpt-4o: costScore = 100*(0.004-0.002)/(0.004-0.0005) = 57.14
    //                latScore  = 100*(300-300)/(300-150) = 0.0 (max lat is 300)
    //                relScore  = 100.0
    //                final = 57.14*0.40 + 0*0.35 + 100*0.25 = 22.85 + 25 = 47.9
    // gemini/gemini-1.5-flash: costScore = 100*(0.004-0.004)/(0.004-0.0005) = 0.0
    //                           latScore  = 100*(300-150)/(300-150) = 100.0
    //                           relScore  = 100.0
    //                           final = 0*0.40 + 100*0.35 + 100*0.25 = 35 + 25 = 60.0
    // openai/gpt-3.5-turbo: costScore = 100*(0.004-0.0005)/(0.004-0.0005) = 100.0
    //                       latScore  = 100*(300-250)/(300-150) = 33.33
    //                       relScore  = 90.0
    //                       final = 100*0.40 + 33.33*0.35 + 90*0.25 = 40 + 11.66 + 22.5 = 74.2
    // Therefore, gpt-3.5-turbo should win with score ~74.2
    assert.strictEqual(rec.provider, 'openai');
    assert.strictEqual(rec.model, 'gpt-3.5-turbo');
    assert.strictEqual(rec.score, 74.2);
  });

  await t.test('4. Candidate requires at least 5 successful requests', () => {
    const lowVolumeMetrics = [
      {
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat/completions',
        successfulRequests: 4, // less than 5
        successRate: 1.0,
        avgLatencyMs: 100,
        avgCostUsd: 0.001
      },
      {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        endpoint: '/v1/models/gemini-1.5-pro',
        successfulRequests: 5, // exactly 5
        successRate: 1.0,
        avgLatencyMs: 200,
        avgCostUsd: 0.002
      }
    ];

    const rec = calculateRecommendation(lowVolumeMetrics, 'balanced');
    assert.ok(rec);
    assert.strictEqual(rec.model, 'gemini-1.5-pro'); // gpt-4o must be filtered out
  });

  await t.test('5. Insufficient Data returns null', () => {
    const insufficientMetrics = [
      {
        provider: 'openai',
        model: 'gpt-4o',
        successfulRequests: 3, // less than 5
        successRate: 1.0,
        avgLatencyMs: 100,
        avgCostUsd: 0.001
      }
    ];

    const rec = calculateRecommendation(insufficientMetrics, 'balanced');
    assert.strictEqual(rec, null);
  });

  await t.test('6. Confidence rating is scaled correctly', () => {
    const candidates = [
      {
        provider: 'openai',
        model: 'gpt-4o',
        endpoint: '/v1/chat/completions',
        successfulRequests: 10,
        successRate: 1.0,
        avgLatencyMs: 150,
        avgCostUsd: 0.001
      },
      {
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        endpoint: '/v1/models/gemini-1.5-flash',
        successfulRequests: 60, // more than 50
        successRate: 1.0,
        avgLatencyMs: 200,
        avgCostUsd: 0.002
      }
    ];

    const rec10 = calculateRecommendation([candidates[0]], 'balanced');
    assert.strictEqual(rec10.confidence, 0.2); // 10 / 50 = 0.2

    const rec60 = calculateRecommendation([candidates[1]], 'balanced');
    assert.strictEqual(rec60.confidence, 1.0); // capped at 1.0
  });

  await t.test('7. Excludes admin data (returns null if user metrics is empty)', () => {
    // When getHistoricalMetricsForUser returns an empty array for an admin user,
    // the scoring service receives [] and must return null (insufficient data).
    const rec = calculateRecommendation([], 'balanced');
    assert.strictEqual(rec, null);
  });
});
