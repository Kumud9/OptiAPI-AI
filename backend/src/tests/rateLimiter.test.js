const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Setup Node path resolution for backend modules
const backendDir = 'd:/OptiAPI/backend';
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);

const mongoose = require(nodeModulesPath('mongoose'));

const GATEWAY_URL = 'http://localhost:5000/api/v1/gateway';
const TEST_KEY = 'opti_test_rate_limit_key_123';

// Helper to wait
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('Gateway Rate Limiter Integration - Concurrency and Limits', async (t) => {
  // Connect to database to setup test API key
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  // Retrieve demo user
  const user = await db.collection('users').findOne({ email: 'demo@optiapi.com' });
  assert.ok(user, 'Demo user must exist');

  // Insert a custom key with rate limit of 3 RPS
  await db.collection('apikeys').deleteOne({ key: TEST_KEY });
  await db.collection('apikeys').insertOne({
    userId: user._id,
    name: 'Rate Limit Test Key',
    key: TEST_KEY,
    rateLimitRps: 3,
    usageCount: 0,
    isActive: true,
    createdAt: new Date()
  });
  
  await t.test('Case 1: Burst requests checking limits (Limit: 3 RPS)', async () => {
    // Wait for the start of a new second to avoid cross-second boundary issues
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 50); // safety buffer

    // Send 5 requests concurrently (limit is 3 RPS)
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        fetch(`${GATEWAY_URL}/stripe/v1/customers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_KEY },
          body: JSON.stringify({ burst: i })
        }).then(async res => ({ status: res.status, body: await res.json() }))
      );
    }

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 200);
    const blocks = results.filter(r => r.status === 429);

    // Verify limit (exactly 3 requests succeed, 2 get blocked)
    assert.strictEqual(successes.length, 3, 'Exactly 3 requests should succeed below/at limit');
    assert.strictEqual(blocks.length, 2, 'Exactly 2 requests should exceed limit and get 429');

    // Verify rate limit response payload
    const blockedRes = blocks[0].body;
    assert.strictEqual(blockedRes.success, false);
    assert.strictEqual(blockedRes.error, 'Rate limit violation - too many requests');
    assert.strictEqual(blockedRes.limit, 3);
  });

  await t.test('Case 2: Expiration and reset of the window', async () => {
    // Wait 2.1 seconds for rate limit key to expire
    await delay(2100);

    // Send a new request, should succeed (first request of the new window)
    const res = await fetch(`${GATEWAY_URL}/stripe/v1/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_KEY },
      body: JSON.stringify({ resetTest: true })
    });
    assert.strictEqual(res.status, 200, 'Request after window expiration should succeed');
  });

  await t.test('Case 3: Concurrency test - firing 10 simultaneous requests', async () => {
    // Wait for a fresh window
    await delay(2100);
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 50);

    // Launch 10 concurrent requests (limit is 3 RPS)
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        fetch(`${GATEWAY_URL}/stripe/v1/customers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': TEST_KEY },
          body: JSON.stringify({ concurrent: i })
        }).then(res => res.status)
      );
    }

    const statuses = await Promise.all(promises);
    const successCount = statuses.filter(s => s === 200).length;
    const rateLimitedCount = statuses.filter(s => s === 429).length;

    console.log(`\n  [Concurrency Test Result]`);
    console.log(`  Total requests sent simultaneously: 10`);
    console.log(`  Allowed (200 OK):                  ${successCount}`);
    console.log(`  Blocked (429 Rate Exceeded):      ${rateLimitedCount}`);

    // Assert that exactly 3 succeeded (limit is 3) and 7 were blocked
    assert.strictEqual(successCount, 3, 'Exactly 3 requests should succeed under concurrent load');
    assert.strictEqual(rateLimitedCount, 7, 'Exactly 7 requests should be blocked under concurrent load');
  });

  // Cleanup test key and close DB connection
  await db.collection('apikeys').deleteOne({ key: TEST_KEY });
  await mongoose.disconnect();
});
