const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const backendDir = 'd:/OptiAPI/backend';
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);

const dotenv = require(nodeModulesPath('dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });

const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000/api/v1';

test('OptiAPI Validation Integration Test Suite', async (t) => {
  // Connect to MongoDB
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);

  // Authenticate user to obtain token for API checks
  let token;
  const authRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@optiapi.com', password: 'password123' })
  });
  if (authRes.status === 200) {
    const authData = await authRes.json();
    token = authData.data.token;
  }
  assert.ok(token, 'Demo user must authenticate successfully to get token');

  await t.test('1. Authentication Validations', async (t2) => {
    await t2.test('Case 1.1: Valid registration format is processed', async () => {
      // Clean up test user if exists
      const db = mongoose.connection.db;
      await db.collection('users').deleteOne({ email: 'newuser@optiapi.com' });

      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@optiapi.com',
          password: 'password123',
          organization: 'Acme Corp'
        })
      });
      assert.strictEqual(res.status, 201, 'Valid register should return 201 Created');
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    await t2.test('Case 1.2: Invalid email fails register', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'password123'
        })
      });
      assert.strictEqual(res.status, 400, 'Invalid email should return 400 Bad Request');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'email'));
    });

    await t2.test('Case 1.3: Short password fails register', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'someuser@optiapi.com',
          password: '123'
        })
      });
      assert.strictEqual(res.status, 400, 'Short password should return 400');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.errors.some(e => e.field === 'password'));
    });

    await t2.test('Case 1.4: Missing required fields fails register', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization: 'Acme Corp'
        })
      });
      assert.strictEqual(res.status, 400, 'Missing fields should return 400');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.errors.some(e => e.field === 'email'));
      assert.ok(body.errors.some(e => e.field === 'password'));
    });
  });

  await t.test('2. Cache Rules Configuration Validations', async (t2) => {
    // Helper to delete a cache rule to avoid "already exists" errors
    const db = mongoose.connection.db;
    await db.collection('cacherules').deleteMany({ provider: 'stripe', endpoint: '/v1/customers' });

    await t2.test('Case 2.1: Valid TTL is accepted', async () => {
      const res = await fetch(`${BASE_URL}/cache/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          provider: 'stripe',
          endpoint: '/v1/customers',
          ttlSeconds: 3600
        })
      });
      assert.strictEqual(res.status, 201, 'Valid TTL rules should succeed');
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    const testTtlValidationFailure = async (ttlVal, description) => {
      await db.collection('cacherules').deleteMany({ provider: 'stripe', endpoint: '/v1/customers' });
      const res = await fetch(`${BASE_URL}/cache/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          provider: 'stripe',
          endpoint: '/v1/customers',
          ttlSeconds: ttlVal
        })
      });
      assert.strictEqual(res.status, 400, `Should fail validation for: ${description}`);
      const body = await res.json();
      assert.strictEqual(body.success, false, 'Payload should report failure');
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'ttlSeconds'));
    };

    await t2.test('Case 2.2: String/non-numeric TTL is rejected', async () => {
      await testTtlValidationFailure('abc', 'string TTL');
    });

    await t2.test('Case 2.3: NaN-like TTL is rejected', async () => {
      await testTtlValidationFailure(NaN, 'NaN TTL');
    });

    await t2.test('Case 2.4: Zero TTL is rejected', async () => {
      await testTtlValidationFailure(0, 'zero TTL');
    });

    await t2.test('Case 2.5: Negative TTL is rejected', async () => {
      await testTtlValidationFailure(-60, 'negative TTL');
    });

    await t2.test('Case 2.6: Decimal TTL is rejected', async () => {
      await testTtlValidationFailure(300.5, 'decimal TTL');
    });

    await t2.test('Case 2.7: Array TTL is rejected', async () => {
      await testTtlValidationFailure([600], 'array TTL');
    });
  });

  await t.test('3. API Keys (Rate Limit) Validations', async (t2) => {
    const testRpsValidation = async (rpsVal, expectedStatus, shouldHaveError = false) => {
      const res = await fetch(`${BASE_URL}/users/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: 'RPS Test Key',
          rateLimitRps: rpsVal
        })
      });
      assert.strictEqual(res.status, expectedStatus);
      const body = await res.json();
      if (shouldHaveError) {
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.error, 'ValidationError');
        assert.ok(body.errors.some(e => e.field === 'rateLimitRps'));
      } else {
        assert.strictEqual(body.success, true);
        // clean up key
        await mongoose.connection.db.collection('apikeys').deleteOne({ _id: new mongoose.Types.ObjectId(body.data._id) });
      }
    };

    await t2.test('Case 3.1: Valid integer RPS is accepted', async () => {
      await testRpsValidation(25, 201, false);
    });

    await t2.test('Case 3.2: Zero RPS is rejected', async () => {
      await testRpsValidation(0, 400, true);
    });

    await t2.test('Case 3.3: Negative RPS is rejected', async () => {
      await testRpsValidation(-5, 400, true);
    });

    await t2.test('Case 3.4: Decimal RPS is rejected', async () => {
      await testRpsValidation(15.5, 400, true);
    });

    await t2.test('Case 3.5: Invalid string RPS is rejected', async () => {
      await testRpsValidation('very-fast', 400, true);
    });
  });

  await t.test('4. ObjectId Parameter Validations', async (t2) => {
    await t2.test('Case 4.1: Valid ObjectId path parameter is accepted', async () => {
      // Mock delete on key endpoint with valid ID format (even if key not found, it fails with 404, not validation error 400)
      const validId = '6a793c5a069f9d19581d7aef';
      const res = await fetch(`${BASE_URL}/users/keys/${validId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.ok(res.status === 404 || res.status === 200);
      const body = await res.json();
      if (res.status === 404) {
        assert.strictEqual(body.success, false);
        assert.strictEqual(body.error, 'API key not found');
      }
    });

    await t2.test('Case 4.2: Malformed ObjectId is rejected with 400 (not 500)', async () => {
      const invalidId = 'malformed-mongodb-id-123';
      const res = await fetch(`${BASE_URL}/users/keys/${invalidId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 400, 'Malformed ObjectId should trigger validation 400 Bad Request');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'id'));
    });
  });

  await t.test('5. Analytics Query Parameter Validations', async (t2) => {
    await t2.test('Case 5.1: Valid query pagination parameters are accepted', async () => {
      const res = await fetch(`${BASE_URL}/analytics/logs?page=2&limit=15&cacheStatus=HIT`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });

    const testAnalyticsQueryFail = async (queryString, failedField) => {
      const res = await fetch(`${BASE_URL}/analytics/logs?${queryString}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === failedField));
    };

    await t2.test('Case 5.2: Invalid page is rejected', async () => {
      await testAnalyticsQueryFail('page=abc', 'page');
      await testAnalyticsQueryFail('page=-3', 'page');
    });

    await t2.test('Case 5.3: Invalid limit is rejected', async () => {
      await testAnalyticsQueryFail('limit=abc', 'limit');
      await testAnalyticsQueryFail('limit=0', 'limit');
      await testAnalyticsQueryFail('limit=-10', 'limit');
    });

    await t2.test('Case 5.4: Excessive limit (>100) is rejected', async () => {
      await testAnalyticsQueryFail('limit=105', 'limit');
    });

    await t2.test('Case 5.5: Invalid cacheStatus is rejected', async () => {
      await testAnalyticsQueryFail('cacheStatus=NOT_REAL', 'cacheStatus');
    });
  });

  await t.test('6. API Gateway Validations', async (t2) => {
    const API_KEY = 'opti_live_demo_api_key_2026_xYz';

    await t2.test('Case 6.1: Valid provider + endpoint continues to mock service', async () => {
      const res = await fetch(`${BASE_URL}/gateway/weather/current`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ city: 'London' })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.location, 'Should successfully execute weather API proxy');
    });

    await t2.test('Case 6.2: Unsupported provider returns 400 ValidationError', async () => {
      const res = await fetch(`${BASE_URL}/gateway/notrealapi/v1/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ messages: [] })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'provider'));
    });

    await t2.test('Case 6.3: Empty/missing wildcard endpoint returns 400', async () => {
      const res = await fetch(`${BASE_URL}/gateway/openai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ messages: [] })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'endpoint'));
    });

    await t2.test('Case 6.4: Malformed queue parameter returns 400', async () => {
      const res = await fetch(`${BASE_URL}/gateway/openai/v1/chat/completions?queue=not-boolean`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'queue'));
    });

    await t2.test('Case 6.5: Malformed OpenAI payload (missing messages) returns 400', async () => {
      const res = await fetch(`${BASE_URL}/gateway/openai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ model: 'gpt-4o' }) // missing messages
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'messages'));
    });

    await t2.test('Case 6.6: Malformed Gemini payload (missing contents) returns 400', async () => {
      const res = await fetch(`${BASE_URL}/gateway/gemini/v1beta/models/gemini-1.5-flash:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ model: 'gemini' }) // missing contents
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
      assert.ok(body.errors.some(e => e.field === 'contents'));
    });

    await t2.test('Case 6.7: Malformed payload aborts instantly and does not enter retry logic', async () => {
      const startTime = Date.now();
      const res = await fetch(`${BASE_URL}/gateway/openai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ model: 'gpt-4o' }) // malformed
      });
      const duration = Date.now() - startTime;
      
      assert.strictEqual(res.status, 400);
      // Retries take at least 600ms due to backoff delays. Instantly aborted validation should take < 100ms.
      assert.ok(duration < 200, `Instantly aborted validation took ${duration}ms, which is too slow (expected <200ms)`);
    });

    await t2.test('Case 6.8: Malformed queued payload does not enter RabbitMQ and returns 400', async () => {
      const res = await fetch(`${BASE_URL}/gateway/openai/v1/chat/completions?queue=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify({ model: 'gpt-4o' }) // malformed
      });
      assert.strictEqual(res.status, 400, 'Queue request should reject with 400 if validation fails');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ValidationError');
    });
  });

  // Disconnect MongoDB connection
  await mongoose.disconnect();
});
