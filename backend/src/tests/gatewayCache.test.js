const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Setup Node path resolution for backend modules
const backendDir = 'd:/OptiAPI/backend';
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);

const mongoose = require(nodeModulesPath('mongoose'));
const redis = require(nodeModulesPath('redis'));

const GATEWAY_URL = 'http://localhost:5000/api/v1/gateway';
const API_KEY = 'opti_live_demo_api_key_2026_xYz';

// Utility helper to clear user cache in Redis
async function flushRedisCache(userIdString) {
  const redisClient = redis.createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();
  const keys = await redisClient.keys(`apicache:${userIdString}:*`);
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
  await redisClient.quit();
}

test('Gateway Cache Integration - Endpoint Resolution & Cache Rules Matching', async (t) => {
  // Connect to database
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  // Retrieve demo user
  const user = await db.collection('users').findOne({ email: 'demo@optiapi.com' });
  assert.ok(user, 'Demo user demo@optiapi.com must exist');
  const userIdString = user._id.toString();

  // Ensure Cache Rule for stripe /v1/customers exists
  await db.collection('cacherules').updateOne(
    { userId: user._id, provider: 'stripe', endpoint: '/v1/customers' },
    { $set: { ttlSeconds: 1800, isActive: true, createdAt: new Date() } },
    { upsert: true }
  );

  await t.test('Case 1: Standard path /v1/customers', async () => {
    // Clear cache first
    await flushRedisCache(userIdString);

    // Request 1: Expect Cache MISS
    const res1 = await fetch(`${GATEWAY_URL}/stripe/v1/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ testCase: 'standard' })
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('x-optiapi-cache'), 'MISS');

    // Request 2: Expect Cache HIT (exact same payload)
    const res2 = await fetch(`${GATEWAY_URL}/stripe/v1/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ testCase: 'standard' })
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('x-optiapi-cache'), 'HIT');
    assert.strictEqual(res2.headers.get('x-optiapi-ttl'), '1800');
  });

  await t.test('Case 2: Duplicate leading slash //v1/customers', async () => {
    await flushRedisCache(userIdString);

    // Request 1 with double slash: Expect MISS (will be normalized backend-side to /v1/customers)
    const res1 = await fetch(`${GATEWAY_URL}/stripe//v1/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ testCase: 'double-slash' })
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('x-optiapi-cache'), 'MISS');

    // Request 2 with double slash: Expect HIT (matching the normalized key)
    const res2 = await fetch(`${GATEWAY_URL}/stripe//v1/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ testCase: 'double-slash' })
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('x-optiapi-cache'), 'HIT');
    assert.strictEqual(res2.headers.get('x-optiapi-ttl'), '1800');
  });

  await t.test('Case 3: Root path /', async () => {
    // There is no CacheRule for root path '/', so it should return MISS (default non-hit status) without caching
    const res = await fetch(`${GATEWAY_URL}/stripe/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ testCase: 'root' })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'MISS');
  });

  // Disconnect database
  await mongoose.disconnect();
});
