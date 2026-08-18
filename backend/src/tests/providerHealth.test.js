'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');

// Configure dotenv
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env') });

const ProviderKey = require('../models/ProviderKey');
const ProviderModel = require('../models/ProviderModel');
const User = require('../models/User');
const { getEligibleCandidates } = require('../services/providerEligibilityService');
const externalApiService = require('../services/externalApiService');

test('Provider Health and Error Status Routing Tests', async (t) => {
  // Connect to MongoDB
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  // Setup temp user
  const tempEmail = `health_test_${Date.now()}@test.com`;
  const user = await User.create({
    email: tempEmail,
    password: 'password123',
    role: 'user'
  });

  const originalFetch = globalThis.fetch;

  // Cleanup helper
  const cleanup = async () => {
    globalThis.fetch = originalFetch;
    await ProviderKey.deleteMany({ userId: user._id });
    await ProviderModel.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  };

  try {
    // 1. Quota exhaustion updates provider status
    await t.test('Quota exhaustion (429) updates provider status to quota_exhausted and is not retried', async () => {
      const pKey = await ProviderKey.create({
        userId: user._id,
        provider: 'openai',
        name: 'OpenAI Test Key',
        value: 'sk-testkey12345678901234567890',
        validationStatus: 'connected'
      });

      let callCount = 0;
      globalThis.fetch = async (url, options) => {
        callCount++;
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({
            error: { message: 'insufficient_quota', code: 'insufficient_quota' }
          })
        };
      };

      // Call API
      let errorThrown = null;
      try {
        await externalApiService.simulateApiCall('openai', '/v1/chat/completions', 'POST', { model: 'gpt-4o' }, {}, user._id);
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown, 'Should throw an error');
      assert.strictEqual(errorThrown.errorClass, 'quota_exhausted');
      assert.strictEqual(errorThrown.shouldRetry, false);
      assert.strictEqual(callCount, 1, 'Should not be retried within simulateApiCall');

      // Check DB
      const updatedKey = await ProviderKey.findById(pKey._id);
      assert.strictEqual(updatedKey.validationStatus, 'quota_exhausted');
    });

    // 2. Authentication failure updates provider status
    await t.test('Authentication failure (401/403) updates provider status to authentication_failed and is not retried', async () => {
      const pKey = await ProviderKey.create({
        userId: user._id,
        provider: 'gemini',
        name: 'Gemini Test Key',
        value: 'sk-testkeygemini',
        validationStatus: 'connected'
      });

      let callCount = 0;
      globalThis.fetch = async (url, options) => {
        callCount++;
        return {
          ok: false,
          status: 401,
          text: async () => 'Unauthorized'
        };
      };

      let errorThrown = null;
      try {
        await externalApiService.simulateApiCall('gemini', '/v1/models/gemini-1.5-flash:generateContent', 'POST', {}, {}, user._id);
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown, 'Should throw an error');
      assert.strictEqual(errorThrown.errorClass, 'authentication_failed');
      assert.strictEqual(errorThrown.shouldRetry, false);
      assert.strictEqual(callCount, 1);

      const updatedKey = await ProviderKey.findById(pKey._id);
      assert.strictEqual(updatedKey.validationStatus, 'authentication_failed');
    });

    // 3. 400 is not retried
    await t.test('400 Bad Request is not retried', async () => {
      await ProviderKey.create({
        userId: user._id,
        provider: 'anthropic',
        name: 'Anthropic Test Key',
        value: 'sk-anthropic',
        validationStatus: 'connected'
      });

      let callCount = 0;
      globalThis.fetch = async (url, options) => {
        callCount++;
        return {
          ok: false,
          status: 400,
          text: async () => 'Bad Request'
        };
      };

      let errorThrown = null;
      try {
        await externalApiService.simulateApiCall('anthropic', '/v1/messages', 'POST', {}, {}, user._id);
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown);
      assert.strictEqual(errorThrown.errorClass, 'permanent_request_error');
      assert.strictEqual(errorThrown.shouldRetry, false);
      assert.strictEqual(callCount, 1);
    });

    // 4. Temporary 429 can retry
    await t.test('Temporary 429 can retry', async () => {
      await ProviderKey.create({
        userId: user._id,
        provider: 'anthropic',
        name: 'Anthropic Test Key',
        value: 'sk-anthropic',
        validationStatus: 'connected'
      });

      let callCount = 0;
      globalThis.fetch = async (url, options) => {
        callCount++;
        return {
          ok: false,
          status: 429,
          text: async () => 'Too Many Requests'
        };
      };

      let errorThrown = null;
      try {
        await externalApiService.simulateApiCall('anthropic', '/v1/messages', 'POST', {}, {}, user._id);
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown);
      assert.strictEqual(errorThrown.errorClass, 'rate_limited');
      assert.strictEqual(errorThrown.shouldRetry, true);
    });

    // 5. 500/503 can retry
    await t.test('500/503 can retry', async () => {
      await ProviderKey.create({
        userId: user._id,
        provider: 'anthropic',
        name: 'Anthropic Test Key',
        value: 'sk-anthropic',
        validationStatus: 'connected'
      });

      let callCount = 0;
      globalThis.fetch = async (url, options) => {
        callCount++;
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable'
        };
      };

      let errorThrown = null;
      try {
        await externalApiService.simulateApiCall('anthropic', '/v1/messages', 'POST', {}, {}, user._id);
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown);
      assert.strictEqual(errorThrown.errorClass, 'unavailable');
      assert.strictEqual(errorThrown.shouldRetry, true);
    });

    // 6. Quota-exhausted provider is excluded from optimization, healthy provider remains eligible
    await t.test('Eligibility check excludes quota_exhausted but keeps healthy providers', async () => {
      // Clear keys
      await ProviderKey.deleteMany({ userId: user._id });

      const healthyKey = await ProviderKey.create({
        userId: user._id,
        provider: 'openai',
        name: 'OpenAI Healthy',
        value: 'sk-healthy',
        validationStatus: 'healthy'
      });

      const exhaustedKey = await ProviderKey.create({
        userId: user._id,
        provider: 'gemini',
        name: 'Gemini Exhausted',
        value: 'sk-exhausted',
        validationStatus: 'quota_exhausted'
      });

      // Create models
      await ProviderModel.create({
        userId: user._id,
        provider: 'openai',
        providerKeyId: healthyKey._id,
        externalModelId: 'gpt-4o',
        isAvailable: true,
        capabilities: { text: true }
      });

      await ProviderModel.create({
        userId: user._id,
        provider: 'gemini',
        providerKeyId: exhaustedKey._id,
        externalModelId: 'gemini-1.5-flash',
        isAvailable: true,
        capabilities: { text: true }
      });

      const result = await getEligibleCandidates(user._id, { text: true });
      assert.strictEqual(result.eligible.length, 1);
      assert.strictEqual(result.eligible[0].provider, 'openai');
      assert.strictEqual(result.eligible[0].model, 'gpt-4o');
    });

    await cleanup();
  } catch (err) {
    await cleanup();
    throw err;
  }
});
