'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const User = require('../models/User');
const RequestLog = require('../models/RequestLog');
const { getOptimizationDecision } = require('../services/optimizationDecisionService');

const mockUserId = '507f1f77bcf86cd799439011';
const mockAdminId = '507f1f77bcf86cd799439012';

// Helper to generate mock raw logs
function generateMockLogs(openaiCount = 10, geminiCount = 42) {
  const logs = [];
  for (let i = 0; i < openaiCount; i++) {
    logs.push({
      userId: mockUserId,
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: '/v1/chat/completions',
      status: 200,
      responseTimeMs: 300,
      costUsd: 0.002,
      tokensUsed: { totalTokens: 100 },
      cacheStatus: 'MISS'
    });
  }
  for (let i = 0; i < geminiCount; i++) {
    logs.push({
      userId: mockUserId,
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      endpoint: '/v1/models/gemini-3.1-flash-lite:generateContent',
      status: 200,
      responseTimeMs: 150,
      costUsd: 0.0003,
      tokensUsed: { totalTokens: 200 },
      cacheStatus: 'MISS'
    });
  }
  return logs;
}

// Store original methods
const originalFindById = User.findById;
const originalFind = RequestLog.find;

test('Optimization Decision Engine Unit Tests', async (t) => {

  t.before(() => {
    // Mock User.findById
    User.findById = async (id) => {
      const idStr = id.toString();
      if (idStr === mockAdminId) {
        return { _id: id, role: 'admin' };
      }
      if (idStr === mockUserId) {
        return { _id: id, role: 'user' };
      }
      return null;
    };

    // Mock RequestLog.find to return raw logs
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 42)
      };
    };
  });

  t.after(() => {
    // Restore original methods
    User.findById = originalFindById;
    RequestLog.find = originalFind;
  });

  await t.test('1. Balanced decision', async () => {
    // Set mock logs
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 42)
      };
    };

    const res = await getOptimizationDecision(mockUserId, 'balanced');
    assert.ok(res);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.mode, 'balanced');
    assert.strictEqual(res.decision.provider, 'gemini');
    assert.strictEqual(res.decision.model, 'gemini-3.1-flash-lite');
    assert.ok(res.decision.reason.cost);
    assert.ok(res.decision.reason.latency);
    assert.ok(res.decision.reason.reliability);
    assert.strictEqual(res.metrics.successfulRequests, 42);
    // Ensure secrets are not exposed
    assert.strictEqual(res.decision.apiKey, undefined);
    assert.strictEqual(res.decision.jwt, undefined);
  });

  await t.test('2. Cost decision', async () => {
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 42)
      };
    };

    const res = await getOptimizationDecision(mockUserId, 'cost');
    assert.ok(res);
    assert.strictEqual(res.decision.provider, 'gemini');
    assert.strictEqual(res.decision.model, 'gemini-3.1-flash-lite');
  });

  await t.test('3. Latency decision', async () => {
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 42)
      };
    };

    const res = await getOptimizationDecision(mockUserId, 'latency');
    assert.ok(res);
    assert.strictEqual(res.decision.provider, 'gemini');
  });

  await t.test('4. Provider filter', async () => {
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 42)
      };
    };

    const res = await getOptimizationDecision(mockUserId, 'balanced', ['openai']);
    assert.ok(res);
    assert.strictEqual(res.decision.provider, 'openai');
    assert.strictEqual(res.decision.model, 'gpt-4o');
  });

  await t.test('5. Minimum 5 successful requests rule', async () => {
    // Generate only 4 successful gemini logs
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 4)
      };
    };

    const res = await getOptimizationDecision(mockUserId, 'balanced');
    assert.ok(res);
    assert.strictEqual(res.decision.provider, 'openai'); // Fallback to openai
  });

  await t.test('6. Insufficient data response', async () => {
    RequestLog.find = () => {
      return {
        lean: async () => []
      };
    };
    const res = await getOptimizationDecision(mockUserId, 'balanced');
    assert.strictEqual(res, null);
  });

  await t.test('7. Admin data exclusion', async () => {
    RequestLog.find = () => {
      return {
        lean: async () => generateMockLogs(10, 42)
      };
    };
    const res = await getOptimizationDecision(mockAdminId, 'balanced');
    assert.strictEqual(res, null);
  });
});
