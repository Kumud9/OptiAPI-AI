const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');

const backendDir = 'd:/OptiAPI/backend';
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);
const dotenv = require(nodeModulesPath('dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const app = require('../app');

test('Provider Credential Validation, Discovery and Normalization Test Suite', async (t) => {
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  const ProviderKey = require('../models/ProviderKey');
  const ProviderModel = require('../models/ProviderModel');
  const User = require('../models/User');

  // Retrieve demo user
  const user = await User.findOne({ email: 'demo@optiapi.com' });
  assert.ok(user, 'Demo user must exist');

  // Retrieve or create secondary user for cross-user tests
  let otherUser = await User.findOne({ email: 'admin@optiapi.com' });
  if (!otherUser) {
    otherUser = await User.create({
      email: 'admin@optiapi.com',
      password: 'password123',
      role: 'admin'
    });
  }

  // Start in-process express server
  const server = app.listen(0);
  const port = server.address().port;
  const AUTH_URL = `http://localhost:${port}/api/v1/auth/login`;

  // Obtain authorization token
  const authRes = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@optiapi.com', password: 'password123' })
  });
  const authData = await authRes.json();
  const token = authData.data.token;

  // Mock global fetch helper
  const originalFetch = globalThis.fetch;

  await t.test('1. Ownership validation: User cannot validate another user\'s ProviderKey', async () => {
    // Create a key owned by otherUser
    const otherKey = await ProviderKey.create({
      userId: otherUser._id,
      provider: 'openai',
      name: 'Other User Key',
      value: 'secret-other-user-key-value'
    });

    // Try to validate it using user's token
    const res = await originalFetch(`http://localhost:${port}/api/v1/users/providers/${otherKey._id}/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // Should return 404
    assert.strictEqual(res.status, 404, 'Should fail to find provider key belonging to another user');

    // Clean up
    await ProviderKey.deleteOne({ _id: otherKey._id });
  });

  await t.test('2. OpenAI Valid Credential succeeds and discovers models', async () => {
    // Create a key for user
    const testKey = await ProviderKey.create({
      userId: user._id,
      provider: 'openai',
      name: 'Test OpenAI Key',
      value: 'valid-openai-key'
    });

    // Mock global fetch to return success models response
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.openai.com/v1/models') {
        const authHeader = options.headers['Authorization'];
        assert.ok(authHeader.includes('valid-openai-key'), 'Authorization header should contain decrypted API key');
        assert.ok(!authHeader.includes('v1:'), 'Authorization header must not contain encrypted ciphertext');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'gpt-4o', object: 'model' },
              { id: 'gpt-3.5-turbo', object: 'model' },
              { id: 'custom-unsupported-model-id', object: 'model' }
            ]
          })
        };
      }
      return originalFetch(url, options);
    };

    const res = await originalFetch(`http://localhost:${port}/api/v1/users/providers/${testKey._id}/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, 'connected');
    assert.strictEqual(body.modelsDiscovered, 3);

    // Verify ProviderModel records are stored
    const models = await ProviderModel.find({ providerKeyId: testKey._id });
    assert.strictEqual(models.length, 3);

    // Verify capability normalization
    const gpt4o = models.find(m => m.externalModelId === 'gpt-4o');
    assert.strictEqual(gpt4o.capabilities.vision, true);
    assert.strictEqual(gpt4o.capabilities.tools, true);

    const customModel = models.find(m => m.externalModelId === 'custom-unsupported-model-id');
    assert.strictEqual(customModel.capabilities.vision, null, 'Unknown model capability must remain null');

    // Clean up
    await ProviderKey.deleteOne({ _id: testKey._id });
    await ProviderModel.deleteMany({ providerKeyId: testKey._id });
  });

  await t.test('3. Anthropic Normalization: Normalizes "claude" to "anthropic" and handles invalid credentials', async () => {
    // Create a key with legacy provider "claude"
    const testKey = await ProviderKey.create({
      userId: user._id,
      provider: 'claude',
      name: 'Legacy Claude Key',
      value: 'invalid-claude-key'
    });

    // Mock global fetch to return unauthorized error
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.anthropic.com/v1/models') {
        return {
          ok: false,
          status: 401,
          text: async () => 'Unauthorized: Invalid API Key'
        };
      }
      return originalFetch(url, options);
    };

    const res = await originalFetch(`http://localhost:${port}/api/v1/users/providers/${testKey._id}/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.status, 'validation_failed');
    assert.strictEqual(body.errorCode, 'INVALID_CREDENTIALS');
    assert.strictEqual(body.provider, 'anthropic', 'Provider name must be normalized to anthropic');

    // Clean up
    await ProviderKey.deleteOne({ _id: testKey._id });
  });

  await t.test('4. Model Discovery: Revalidation updates availability without duplicate creation', async () => {
    const testKey = await ProviderKey.create({
      userId: user._id,
      provider: 'gemini',
      name: 'Gemini Key',
      value: 'gemini-key'
    });

    // Step A: First validation returns model A and B
    globalThis.fetch = async (url, options) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
            { name: 'models/gemini-1.0-pro', displayName: 'Gemini 1.0 Pro' }
          ]
        })
      };
    };

    let validateRes = await originalFetch(`http://localhost:${port}/api/v1/users/providers/${testKey._id}/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    let valBody = await validateRes.json();
    assert.strictEqual(valBody.modelsDiscovered, 2);

    let models = await ProviderModel.find({ providerKeyId: testKey._id });
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models.filter(m => m.isAvailable).length, 2);

    // Step B: Second validation returns model B and C
    globalThis.fetch = async (url, options) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.0-pro', displayName: 'Gemini 1.0 Pro' },
            { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' }
          ]
        })
      };
    };

    validateRes = await originalFetch(`http://localhost:${port}/api/v1/users/providers/${testKey._id}/validate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    valBody = await validateRes.json();
    assert.strictEqual(valBody.modelsDiscovered, 2);

    // Should still have exactly 3 total historical records (no duplicate for gemini-1.0-pro)
    models = await ProviderModel.find({ providerKeyId: testKey._id });
    assert.strictEqual(models.length, 3);

    // gemini-1.5-flash should be marked isAvailable: false
    const flash = models.find(m => m.externalModelId === 'gemini-1.5-flash');
    assert.strictEqual(flash.isAvailable, false);

    // gemini-1.0-pro and gemini-1.5-pro should be marked isAvailable: true
    const pro1 = models.find(m => m.externalModelId === 'gemini-1.0-pro');
    const pro15 = models.find(m => m.externalModelId === 'gemini-1.5-pro');
    assert.strictEqual(pro1.isAvailable, true);
    assert.strictEqual(pro15.isAvailable, true);

    // Clean up
    await ProviderKey.deleteOne({ _id: testKey._id });
    await ProviderModel.deleteMany({ providerKeyId: testKey._id });
  });

  // Restore fetch, close server, and disconnect database
  globalThis.fetch = originalFetch;
  server.close();
  await mongoose.disconnect();
});
