const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');
const redis = require('redis');

const GATEWAY_URL = 'http://localhost:5000/api/v1/gateway';
const API_KEY = 'opti_live_demo_api_key_2026_xYz';

async function flushRedisCache(userIdString) {
  const redisClient = redis.createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();
  const keys = await redisClient.keys(`apicache:${userIdString}:*`);
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
  const semanticKeys = await redisClient.keys(`apicache_semantic:${userIdString}:*`);
  if (semanticKeys.length > 0) {
    await redisClient.del(semanticKeys);
  }
  
  // Drop index so it gets recreated with 384 dimensions
  try {
    await redisClient.ft.dropIndex('idx:semantic_cache');
  } catch (err) {
    // Ignore if it doesn't exist
  }

  await redisClient.quit();
}

test('Semantic Cache Integration', async (t) => {
  const mongoUri = 'mongodb://localhost:27017/optiapi';
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const user = await db.collection('users').findOne({ email: 'demo@optiapi.com' });
  assert.ok(user, 'Demo user must exist');
  const userIdString = user._id.toString();

  // Create another user for isolation testing
  let user2 = await db.collection('users').findOne({ email: 'demo2@optiapi.com' });
  if (!user2) {
    const res = await db.collection('users').insertOne({
      email: 'demo2@optiapi.com',
      name: 'Demo User 2',
      passwordHash: 'fake',
      createdAt: new Date()
    });
    user2 = { _id: res.insertedId };
  }
  const user2IdString = user2._id.toString();

  await db.collection('apikeys').updateOne(
    { userId: user2._id, key: 'opti_live_demo2_api_key_2026_xYz' },
    { $set: { name: 'Demo 2 Key', isActive: true, createdAt: new Date(), rateLimitRps: 10 } },
    { upsert: true }
  );

  await db.collection('providerkeys').deleteMany({ userId: user2._id, provider: 'gemini' });
  await db.collection('providerkeys').insertOne({
    userId: user2._id,
    provider: 'gemini',
    name: 'Gemini Dev Key User2',
    value: 'demo-gemini-key-user2',
    isActive: true,
    createdAt: new Date()
  });

  await db.collection('cacherules').deleteMany({ provider: 'gemini' });
  await db.collection('cacherules').insertOne({
    userId: user._id,
    provider: 'gemini',
    endpoint: '/v1/models/gemini-3.6-flash:generatecontent',
    ttlSeconds: 3600,
    isActive: true,
    createdAt: new Date()
  });
  await db.collection('cacherules').insertOne({
    userId: user2._id,
    provider: 'gemini',
    endpoint: '/v1/models/gemini-3.6-flash:generatecontent',
    ttlSeconds: 3600,
    isActive: true,
    createdAt: new Date()
  });

  await flushRedisCache(userIdString);
  await flushRedisCache(user2IdString);

  await t.test('Case 1: Query A -> MISS (calls provider, saves both caches)', async () => {
    const body1 = { 
      model: 'gemini-3.6-flash',
      temperature: 0.7,
      contents: [{ role: 'user', parts: [{ text: 'what is the capital of france?' }] }] 
    };
    const res = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'MISS');
  });

  await t.test('Case 2: Exact identical Query -> exact HIT', async () => {
    const body1 = { 
      model: 'gemini-3.6-flash',
      temperature: 0.7,
      contents: [{ role: 'user', parts: [{ text: 'what is the capital of france?' }] }] 
    };
    const res = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body1)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'HIT');
  });

  await t.test('Case 3: Similar Query B -> SEMANTIC_HIT', async () => {
    // With real embeddings, these two sentences should have high similarity
    const body2 = { 
      model: 'gemini-3.6-flash',
      temperature: 0.7,
      contents: [{ role: 'user', parts: [{ text: 'What exactly is the capital city of France?' }] }] 
    };
    const res = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body2)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'SEMANTIC_HIT');
  });

  await t.test('Case 4: Different parameters (temperature) -> MISS', async () => {
    // Temperature changed -> exact match on paramsHash fails -> MISS
    const body3 = { 
      model: 'gemini-3.6-flash',
      temperature: 0.8,
      contents: [{ role: 'user', parts: [{ text: 'What exactly is the capital city of France?' }] }] 
    };
    const res = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body3)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'MISS');
  });

  await t.test('Case 5: Different user -> MISS', async () => {
    const body2 = { 
      model: 'gemini-3.6-flash',
      temperature: 0.7,
      contents: [{ role: 'user', parts: [{ text: 'What exactly is the capital city of France?' }] }] 
    };
    const res = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'opti_live_demo2_api_key_2026_xYz' },
      body: JSON.stringify(body2)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'MISS');
  });

  await t.test('Case 6: Low similarity -> MISS', async () => {
    const body = { 
      model: 'gemini-3.6-flash',
      temperature: 0.7,
      contents: [{ role: 'user', parts: [{ text: 'Explain quantum computing simply' }] }] 
    };
    const res = await fetch(`${GATEWAY_URL}/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(body)
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-optiapi-cache'), 'MISS');
  });

  await mongoose.disconnect();
});
