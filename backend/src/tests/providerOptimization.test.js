const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');

const backendDir = 'd:/OptiAPI/backend';
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);
const dotenv = require(nodeModulesPath('dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const app = require('../app');

test('Provider Registry Optimization Integration Test Suite', async (t) => {
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  const ProviderKey = require('../models/ProviderKey');
  const ProviderModel = require('../models/ProviderModel');
  const User = require('../models/User');
  const RequestLog = require('../models/RequestLog');

  // Create clean test user A (role: user) and user B (role: admin)
  await User.deleteMany({ email: { $in: ['test-user-a@optiapi.com', 'test-user-b@optiapi.com'] } });
  
  const userA = await User.create({
    email: 'test-user-a@optiapi.com',
    password: 'password123',
    role: 'user'
  });

  const userB = await User.create({
    email: 'test-user-b@optiapi.com',
    password: 'password123',
    role: 'admin'
  });

  // Start in-process express server
  const server = app.listen(0);
  const port = server.address().port;

  // Obtain authorization token for User A
  const authRes = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test-user-a@optiapi.com', password: 'password123' })
  });
  const authData = await authRes.json();
  const tokenA = authData.data.token;

  // Clean up existing keys/models for these test users
  await ProviderKey.deleteMany({ userId: { $in: [userA._id, userB._id] } });
  await ProviderModel.deleteMany({ userId: { $in: [userA._id, userB._id] } });
  await RequestLog.deleteMany({ userId: { $in: [userA._id, userB._id] } });

  await t.test('1. Eligibility Check: Active, validated, and available models are eligible; disabled/unvalidated are excluded', async () => {
    // OpenAI Key: Connected & Enabled
    const openAiKey = await ProviderKey.create({
      userId: userA._id,
      provider: 'openai',
      name: 'OpenAI Dev Key',
      value: 'secret-key-1',
      isActive: true,
      validationStatus: 'connected'
    });

    const openAiModel = await ProviderModel.create({
      userId: userA._id,
      provider: 'openai',
      providerKeyId: openAiKey._id,
      externalModelId: 'gpt-4o',
      isAvailable: true,
      capabilities: { text: true, streaming: true, vision: true, tools: true, structuredOutput: true }
    });

    // Gemini Key: Connected but Disabled
    const geminiKey = await ProviderKey.create({
      userId: userA._id,
      provider: 'gemini',
      name: 'Gemini Dev Key',
      value: 'secret-key-2',
      isActive: false,
      validationStatus: 'connected'
    });

    const geminiModel = await ProviderModel.create({
      userId: userA._id,
      provider: 'gemini',
      providerKeyId: geminiKey._id,
      externalModelId: 'gemini-1.5-flash',
      isAvailable: true,
      capabilities: { text: true, streaming: true, vision: true }
    });

    // Anthropic Key: Enabled but Unvalidated (not_configured)
    const anthropicKey = await ProviderKey.create({
      userId: userA._id,
      provider: 'anthropic',
      name: 'Anthropic Key',
      value: 'secret-key-3',
      isActive: true,
      validationStatus: 'not_configured'
    });

    const anthropicModel = await ProviderModel.create({
      userId: userA._id,
      provider: 'anthropic',
      providerKeyId: anthropicKey._id,
      externalModelId: 'claude-3-5-sonnet',
      isAvailable: true,
      capabilities: { text: true, streaming: true }
    });

    const { getEligibleCandidates } = require('../services/providerEligibilityService');
    const { eligible } = await getEligibleCandidates(userA._id);

    // Only OpenAI should be eligible. Gemini is disabled, Anthropic is unvalidated
    assert.strictEqual(eligible.length, 1);
    assert.strictEqual(eligible[0].provider, 'openai');
    assert.strictEqual(eligible[0].model, 'gpt-4o');

    // Clean up
    await ProviderKey.deleteMany({ _id: { $in: [openAiKey._id, geminiKey._id, anthropicKey._id] } });
    await ProviderModel.deleteMany({ _id: { $in: [openAiModel._id, geminiModel._id, anthropicModel._id] } });
  });

  await t.test('2. User Isolation: User A cannot optimize using User B\'s provider configurations', async () => {
    // User B's Key: Connected & Enabled
    const keyB = await ProviderKey.create({
      userId: userB._id,
      provider: 'openai',
      name: 'User B Key',
      value: 'secret-key-b',
      isActive: true,
      validationStatus: 'connected'
    });

    const modelB = await ProviderModel.create({
      userId: userB._id,
      provider: 'openai',
      providerKeyId: keyB._id,
      externalModelId: 'gpt-4o',
      isAvailable: true,
      capabilities: { text: true }
    });

    const { getEligibleCandidates } = require('../services/providerEligibilityService');
    const { eligible } = await getEligibleCandidates(userA._id);

    // User A should have zero eligible candidates because they have no keys of their own in this test context
    assert.strictEqual(eligible.length, 0);

    // Clean up
    await ProviderKey.deleteOne({ _id: keyB._id });
    await ProviderModel.deleteOne({ _id: modelB._id });
  });

  await t.test('3. Capability Filtering: Excludes models that do not support requested capabilities', async () => {
    const key = await ProviderKey.create({
      userId: userA._id,
      provider: 'openai',
      name: 'OpenAI Dev Key',
      value: 'secret-key-1',
      isActive: true,
      validationStatus: 'connected'
    });

    const model = await ProviderModel.create({
      userId: userA._id,
      provider: 'openai',
      providerKeyId: key._id,
      externalModelId: 'gpt-3.5-turbo',
      isAvailable: true,
      capabilities: { text: true, streaming: true, vision: false, tools: true, structuredOutput: false }
    });

    const { getEligibleCandidates } = require('../services/providerEligibilityService');
    
    // Vision request
    const resVision = await getEligibleCandidates(userA._id, { vision: true });
    assert.strictEqual(resVision.eligible.length, 0, 'Should exclude gpt-3.5-turbo because vision is false');
    assert.ok(resVision.explanations[0].reason.includes('vision'), 'Reason should mention vision is unsupported');

    // Tools request
    const resTools = await getEligibleCandidates(userA._id, { tools: true });
    assert.strictEqual(resTools.eligible.length, 1, 'Should include gpt-3.5-turbo because tools capability is true');

    // Structured output request (capability is false)
    const resStruct = await getEligibleCandidates(userA._id, { structuredOutput: true });
    assert.strictEqual(resStruct.eligible.length, 0, 'Should exclude gpt-3.5-turbo because structuredOutput is false');

    // Clean up
    await ProviderKey.deleteOne({ _id: key._id });
    await ProviderModel.deleteOne({ _id: model._id });
  });

  await t.test('4. Telemetry Evaluation: Scores are based on historical telemetry database of eligible candidates only', async () => {
    const key = await ProviderKey.create({
      userId: userA._id,
      provider: 'openai',
      name: 'OpenAI Key',
      value: 'secret-key-1',
      isActive: true,
      validationStatus: 'connected'
    });

    const model = await ProviderModel.create({
      userId: userA._id,
      provider: 'openai',
      providerKeyId: key._id,
      externalModelId: 'gpt-4o',
      isAvailable: true,
      capabilities: { text: true }
    });

    // Populate mock telemetry logs (10 successful logs)
    await RequestLog.deleteMany({ userId: userA._id });
    const mockLogs = Array.from({ length: 10 }).map((_, i) => ({
      userId: userA._id,
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      status: 200,
      responseTimeMs: 250,
      costUsd: 0.01
    }));
    await RequestLog.create(mockLogs);

    const { getOptimizationDecision } = require('../services/optimizationDecisionService');
    const decisionRes = await getOptimizationDecision(userA._id, 'balanced');

    assert.strictEqual(decisionRes.success, true);
    assert.strictEqual(decisionRes.decision.provider, 'openai');
    assert.strictEqual(decisionRes.decision.model, 'gpt-4o');
    assert.ok(decisionRes.metrics.successfulRequests >= 5, 'Must have at least 5 successful requests');

    // Clean up
    await ProviderKey.deleteOne({ _id: key._id });
    await ProviderModel.deleteOne({ _id: model._id });
    await RequestLog.deleteMany({ userId: userA._id });
  });

  // Cleanup users
  await User.deleteMany({ email: { $in: ['test-user-a@optiapi.com', 'test-user-b@optiapi.com'] } });

  server.close();
  await mongoose.disconnect();
});
