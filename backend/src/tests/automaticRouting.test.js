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
const ApiKey = require('../models/ApiKey');
const { handleGatewayRequest } = require('../controllers/gatewayController');

test('Automatic Routing Optimization Pipeline Test', async (t) => {
  // Connect to MongoDB
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  // Setup temp user
  const tempEmail = `auto_route_${Date.now()}@test.com`;
  const user = await User.create({
    email: tempEmail,
    password: 'password123',
    role: 'user' // MUST be 'user' (not admin) so telemetry is not excluded!
  });

  const apiTokenDoc = await ApiKey.create({
    userId: user._id,
    name: 'Auto Route API Key',
    key: `opti_live_test_key_${Date.now()}`,
    isActive: true
  });

  // Create provider keys
  const openaiKey = await ProviderKey.create({
    userId: user._id,
    provider: 'openai',
    name: 'OpenAI key',
    value: 'sk-openai-key-value-12345',
    validationStatus: 'connected'
  });

  const geminiKey = await ProviderKey.create({
    userId: user._id,
    provider: 'gemini',
    name: 'Gemini key',
    value: 'sk-gemini-key-value-12345',
    validationStatus: 'connected'
  });

  // Create provider models
  await ProviderModel.create({
    userId: user._id,
    provider: 'openai',
    providerKeyId: openaiKey._id,
    externalModelId: 'gpt-4o',
    isAvailable: true,
    capabilities: { text: true }
  });

  await ProviderModel.create({
    userId: user._id,
    provider: 'gemini',
    providerKeyId: geminiKey._id,
    externalModelId: 'gemini-3.6-flash',
    isAvailable: true,
    capabilities: { text: true }
  });

  // Create historical telemetry
  // Gemini has 6 successful logs
  const logs = [];
  for (let i = 0; i < 6; i++) {
    logs.push({
      userId: user._id,
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      endpoint: '/v1beta/models/gemini-3.6-flash:generateContent',
      method: 'POST',
      status: 200,
      responseTimeMs: 300,
      costUsd: 0.00001,
      tokensUsed: { totalTokens: 100 },
      cacheStatus: 'MISS'
    });
  }
  // OpenAI has 2 successful logs (not enough to pass 5 successful requests threshold)
  for (let i = 0; i < 2; i++) {
    logs.push({
      userId: user._id,
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      status: 200,
      responseTimeMs: 400,
      costUsd: 0.002,
      tokensUsed: { totalTokens: 100 },
      cacheStatus: 'MISS'
    });
  }
  await RequestLog.create(logs);

  const originalFetch = globalThis.fetch;
  const originalEnvOptEnabled = process.env.OPTIMIZATION_ENABLED;
  const originalEnvOptMode = process.env.OPTIMIZATION_MODE;

  // Enable optimization and set mode to automatic
  process.env.OPTIMIZATION_ENABLED = 'true';
  process.env.OPTIMIZATION_MODE = 'automatic';

  // Mock fetch to simulate successful Gemini response
  let executedProvider = null;
  globalThis.fetch = async (url, options) => {
    if (url.includes('googleapis.com')) {
      executedProvider = 'gemini';
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Hello!' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 }
        })
      };
    } else {
      executedProvider = 'openai';
      return {
        ok: true,
        json: async () => ({})
      };
    }
  };

  const cleanup = async () => {
    globalThis.fetch = originalFetch;
    process.env.OPTIMIZATION_ENABLED = originalEnvOptEnabled;
    process.env.OPTIMIZATION_MODE = originalEnvOptMode;
    await RequestLog.deleteMany({ userId: user._id });
    await ProviderKey.deleteMany({ userId: user._id });
    await ProviderModel.deleteMany({ userId: user._id });
    await ApiKey.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  };

  try {
    // Construct mock req/res
    const req = {
      params: {
        provider: 'openai',
        0: '/v1/chat/completions'
      },
      method: 'POST',
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello.' }]
      },
      headers: {
        'x-api-key': apiTokenDoc.key
      },
      gatewayKey: apiTokenDoc,
      userId: user._id
    };

    let statusCalled = null;
    let jsonCalled = null;
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCalled = code;
        return {
          json: (data) => {
            jsonCalled = data;
          }
        };
      }
    };

    // Run the gateway request!
    await handleGatewayRequest(req, res);

    // Verify optimization redirected from openai to gemini!
    assert.strictEqual(executedProvider, 'gemini', 'Request should be routed to gemini instead of openai');
    assert.strictEqual(statusCalled, 200);

    // Verify normalized OpenAI-compatible response format
    assert.ok(jsonCalled, 'Response body must be present');
    assert.strictEqual(jsonCalled.object, 'chat.completion', 'Response must be normalized to OpenAI format');
    assert.strictEqual(jsonCalled.model, 'gemini-3.6-flash', 'Response model must be the target Gemini model');
    assert.strictEqual(jsonCalled.choices[0].message.content, 'Hello!', 'Normalized content must match Gemini text');

    // Verify logged request details (wait for async logging write to complete)
    await new Promise(resolve => setTimeout(resolve, 100));
    const lastLog = await RequestLog.findOne({ userId: user._id }).sort({ _id: -1 });
    assert.strictEqual(lastLog.requestedProvider, 'openai');
    assert.strictEqual(lastLog.provider, 'gemini'); // actualProvider

    await cleanup();
  } catch (err) {
    await cleanup();
    throw err;
  }
});
