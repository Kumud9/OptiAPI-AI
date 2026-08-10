const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Setup Node path resolution for backend modules
const backendDir = 'd:/OptiAPI/backend';
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);

const dotenv = require(nodeModulesPath('dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const mongoose = require('mongoose');

const AUTH_URL = 'http://localhost:5000/api/v1/auth/login';
const PROVIDERS_URL = 'http://localhost:5000/api/v1/users/providers';

test('Provider Credentials Encryption Integration', async (t) => {
  try {
    // Connect to database to inspect stored documents
    const mongoUri = 'mongodb://localhost:27017/optiapi';
    await mongoose.connect(mongoUri);
    
    const ProviderKey = require('../models/ProviderKey');
    const User = require('../models/User');

    // Retrieve demo user
    const user = await User.findOne({ email: 'demo@optiapi.com' });
    assert.ok(user, 'Demo user must exist');

    // Authenticate user to obtain token for API checks
    const authRes = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@optiapi.com', password: 'password123' })
    });
    const authData = await authRes.json();
    const token = authData.data.token;

    await t.test('Case 1: Document pre-save hook encrypts raw value and getDecryptedValue works', async () => {
      // Delete existing custom credential if any
      await ProviderKey.deleteOne({ userId: user._id, provider: 'custom' });

      const rawKeyVal = 'my-super-secret-custom-token-values-12345';
      const providerKeyDoc = await ProviderKey.create({
        userId: user._id,
        provider: 'custom',
        name: 'Integration Test Key',
        value: rawKeyVal
      });

      // 1. Verify encrypted value in database is not plaintext
      assert.notStrictEqual(providerKeyDoc.value, rawKeyVal, 'Staged database value must be encrypted');
      assert.ok(providerKeyDoc.value.startsWith('v1:'), 'Staged value must have v1 version prefix');

      // 2. Verify getDecryptedValue returns the raw plaintext key in memory
      const decryptedVal = providerKeyDoc.getDecryptedValue();
      assert.strictEqual(decryptedVal, rawKeyVal, 'In-memory decrypted value must match original plaintext');

      // 3. Verify getMaskedValue returns masked version of decrypted plaintext
      const maskedVal = providerKeyDoc.getMaskedValue();
      assert.strictEqual(maskedVal, 'my-s...2345', 'Masked value must represent original plaintext, not ciphertext');
    });

    await t.test('Case 2: UI retrieval API endpoint returns masked key only (raw key is hidden)', async () => {
      const res = await fetch(PROVIDERS_URL, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      
      // Find our custom key in response array
      const testKeyResponse = body.data.find(k => k.provider === 'custom');
      assert.ok(testKeyResponse, 'Custom provider key should be returned in API response');
      
      // Assert value is masked and does not match raw plaintext nor raw ciphertext
      assert.strictEqual(testKeyResponse.value, 'my-s...2345', 'API response must contain the masked value');
      assert.notStrictEqual(testKeyResponse.value, 'my-super-secret-custom-token-values-12345', 'API response must never expose plaintext');
      assert.ok(!testKeyResponse.value.startsWith('v1:'), 'API response must never expose raw ciphertext');
    });

    // Cleanup test key and close DB connection
    await ProviderKey.deleteOne({ userId: user._id, provider: 'custom' });
    await mongoose.disconnect();
  } catch (err) {
    console.error('INTEGRATION TEST EXCEPTION DETECTED:', err);
    await mongoose.disconnect();
    throw err;
  }
});
