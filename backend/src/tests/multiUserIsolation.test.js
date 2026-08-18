'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');

// Configure dotenv
const dotenv = require('dotenv');
const backendDir = 'd:/OptiAPI/backend';
dotenv.config({ path: path.join(backendDir, '.env') });

const User = require('../models/User');
const ProviderKey = require('../models/ProviderKey');
const ProviderModel = require('../models/ProviderModel');
const RequestLog = require('../models/RequestLog');
const { getOptimizationDecision } = require('../services/optimizationDecisionService');

test('Multi-User Telemetry Isolation Test', async (t) => {
  // Connect to MongoDB
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  // 1. Create User A (regular user)
  const userA = await User.create({
    email: `usera_${Date.now()}@test.com`,
    password: 'password123',
    role: 'user'
  });

  // 2. Create User B (regular user)
  const userB = await User.create({
    email: `userb_${Date.now()}@test.com`,
    password: 'password123',
    role: 'user'
  });

  // Create keys and models for User A
  const keyA = await ProviderKey.create({
    userId: userA._id,
    provider: 'gemini',
    name: 'Gemini A',
    value: 'key-a-12345',
    validationStatus: 'connected'
  });
  await ProviderModel.create({
    userId: userA._id,
    provider: 'gemini',
    providerKeyId: keyA._id,
    externalModelId: 'gemini-3.6-flash',
    isAvailable: true,
    capabilities: { text: true }
  });

  // Create keys and models for User B
  const keyB = await ProviderKey.create({
    userId: userB._id,
    provider: 'gemini',
    name: 'Gemini B',
    value: 'key-b-12345',
    validationStatus: 'connected'
  });
  await ProviderModel.create({
    userId: userB._id,
    provider: 'gemini',
    providerKeyId: keyB._id,
    externalModelId: 'gemini-3.6-flash',
    isAvailable: true,
    capabilities: { text: true }
  });

  // 3. Insert 10 successful telemetry logs ONLY for User A
  const logs = [];
  for (let i = 0; i < 10; i++) {
    logs.push({
      userId: userA._id,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      endpoint: '/v1beta/models/gemini-3.6-flash:generateContent',
      method: 'POST',
      status: 200,
      responseTimeMs: 250,
      costUsd: 0.00002,
      tokensUsed: { totalTokens: 120 },
      cacheStatus: 'MISS'
    });
  }
  await RequestLog.create(logs);

  const cleanup = async () => {
    await RequestLog.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await ProviderKey.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await ProviderModel.deleteMany({ userId: { $in: [userA._id, userB._id] } });
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await mongoose.disconnect();
  };

  try {
    // 4. Query decision for User A (should be recommended because of 10 logs)
    const decisionA = await getOptimizationDecision(userA._id, 'balanced');
    assert.strictEqual(decisionA.success, true, 'User A should receive a valid recommendation');
    assert.strictEqual(decisionA.decision.provider, 'gemini');

    // 5. Query decision for User B (should fail with INSUFFICIENT_DATA since they have 0 logs)
    const decisionB = await getOptimizationDecision(userB._id, 'balanced');
    assert.strictEqual(decisionB.success, false, 'User B should have insufficient data');
    assert.strictEqual(decisionB.code, 'INSUFFICIENT_DATA', 'User B should fail with INSUFFICIENT_DATA code');

    await cleanup();
  } catch (err) {
    await cleanup();
    throw err;
  }
});
