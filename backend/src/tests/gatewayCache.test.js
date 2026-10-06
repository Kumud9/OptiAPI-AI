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

// Utility helper to clear user cache in Redis using SCAN
const { deleteKeysByPattern } = require('../utils/redisUtils');
async function flushRedisCache(userIdString) {
  const redisClient = redis.createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();
  await deleteKeysByPattern(redisClient, `apicache:${userIdString}:*`);
  await deleteKeysByPattern(redisClient, `apicache_semantic:${userIdString}:*`);
  await deleteKeysByPattern(redisClient, `cacherule:${userIdString}:*`);
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

    await new Promise(r => setTimeout(r, 50)); // Allow async Redis SET to complete

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

    await new Promise(r => setTimeout(r, 50)); // Allow async Redis SET to complete

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

  await t.test('Case 4: Gemini Cache Integration & Normalization', async (t2) => {
    // Ensure Gemini provider key is set to a simulated demo key
    await db.collection('providerkeys').deleteMany({ userId: user._id, provider: 'gemini' });
    await db.collection('providerkeys').insertOne({
      userId: user._id,
      provider: 'gemini',
      name: 'Gemini Dev Key',
      value: 'demo-gemini-key-replace-with-real-key',
      isActive: true,
      createdAt: new Date()
    });

    // 4.1 identical Gemini requests produce a MISS then HIT with actual gateway endpoint
    await db.collection('cacherules').deleteMany({ userId: user._id, provider: 'gemini' });
    await db.collection('cacherules').insertOne({
      userId: user._id,
      provider: 'gemini',
      endpoint: '/v1/models/gemini-3.6-flash:generatecontent',
      ttlSeconds: 3600,
      isActive: true,
      createdAt: new Date()
    });

    await flushRedisCache(userIdString);

    const body1 = { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] };

    // Request 1: Expect MISS
    const res1 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('x-optiapi-cache'), 'MISS');

    // Request 2: Expect HIT
    const res2 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('x-optiapi-cache'), 'HIT');

    // 4.2 different request bodies produce different keys -> MISS
    const body2 = { contents: [{ role: 'user', parts: [{ text: 'different query' }] }] };
    const res3 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body2)
    });
    assert.strictEqual(res3.status, 200);
    assert.strictEqual(res3.headers.get('x-optiapi-cache'), 'MISS');

    // 4.3 different models produce different keys -> MISS
    const res4 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-pro:generatecontent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res4.status, 200);
    assert.strictEqual(res4.headers.get('x-optiapi-cache'), 'MISS');

    // 4.4 TTL is respected
    await db.collection('cacherules').deleteMany({ userId: user._id, provider: 'gemini' });
    await db.collection('cacherules').insertOne({
      userId: user._id,
      provider: 'gemini',
      endpoint: '/v1/models/gemini-3.6-flash:generatecontent',
      ttlSeconds: 1, // 1 second TTL
      isActive: true,
      createdAt: new Date()
    });

    await flushRedisCache(userIdString);

    // Request with short TTL: Expect MISS
    const res5 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res5.status, 200);
    assert.strictEqual(res5.headers.get('x-optiapi-cache'), 'MISS');

    // Immediate request: Expect HIT
    const res6 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res6.status, 200);
    assert.strictEqual(res6.headers.get('x-optiapi-cache'), 'HIT');

    // Wait 1.5 seconds for TTL expiration
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Post-expiration request: Expect MISS
    const res7 = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res7.status, 200);
    assert.strictEqual(res7.headers.get('x-optiapi-cache'), 'MISS');
  });

  // Disconnect database
  await mongoose.disconnect();
});
