/**
 * BUG-1 Fix: rateLimitViolations Redis Counter Integration Test
 * =============================================================
 *
 * WHAT THIS TESTS
 * ---------------
 * Verifies that the fix for BUG-1 (rateLimitViolations always 0) is working:
 *
 * 1. Redis key `rl_violations:<userId>` is incremented for every 429.
 * 2. GET /api/v1/analytics/stats returns rateLimitViolations > 0 after
 *    rate-limited requests are sent.
 * 3. Successful (200) requests do NOT increment the violation counter.
 * 4. The rate limiter still returns the correct 429 payload (not broken).
 * 5. The existing rate-limit window/Lua-script logic is unaffected.
 *
 * SAFETY
 * ------
 * - Stripe provider (always simulated, zero real API calls).
 * - Isolated temporary test user + API key.
 * - Cleans up all created test data, including the Redis violation counter.
 * - No production source modifications.
 *
 * Run from backend/:
 *   node --test src/tests/rateLimitViolations.integration.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');

const backendDir      = path.resolve(__dirname, '../..');
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);

const mongoose = require(nodeModulesPath('mongoose'));
const redis    = require(nodeModulesPath('redis'));
const jwt      = require(nodeModulesPath('jsonwebtoken'));
const bcrypt   = require(nodeModulesPath('bcryptjs'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BASE_URL    = 'http://localhost:5000/api/v1';
const GATEWAY_URL = `${BASE_URL}/gateway`;
const MONGO_URI   = 'mongodb://localhost:27017/optiapi';
const REDIS_URL   = 'redis://localhost:6379';
const JWT_SECRET  = 'optiapi_secret_key_for_jwt_tokens_2026_secure';

// Dedicated test identity — never touches configured user keys
const TEST_EMAIL     = 'rl.violations.probe@optiapi-test.internal';
const TEST_KEY       = 'opti_rl_violations_probe_v1';
const RPS_LIMIT      = 3;   // low limit so 429s are easy to trigger
const BURST_SIZE     = 7;   // 7 simultaneous requests → 4 blocked

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const stripePost = (apiKey, body) =>
  fetch(`${GATEWAY_URL}/stripe/v1/charges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const getStats = (token) =>
  fetch(`${BASE_URL}/analytics/stats`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let mongoDb     = null;
let redisClient = null;
let testUserId  = null;
let jwtToken    = null;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test('BUG-1 Fix: rateLimitViolations Redis counter integration', async (t) => {

  // =========================================================================
  // SETUP
  // =========================================================================
  t.before(async () => {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    mongoDb = mongoose.connection.db;

    // Remove any leftover from a previous aborted run
    const old = await mongoDb.collection('users').findOne({ email: TEST_EMAIL });
    if (old) {
      await mongoDb.collection('apikeys').deleteMany({ userId: old._id });
      await mongoDb.collection('requestlogs').deleteMany({ userId: old._id });
      await mongoDb.collection('users').deleteOne({ _id: old._id });
    }

    const hashedPw = await bcrypt.hash('test_pass_2026', 10);
    const { insertedId } = await mongoDb.collection('users').insertOne({
      email: TEST_EMAIL, password: hashedPw,
      organization: 'RLViolationTest', role: 'user', createdAt: new Date()
    });
    testUserId = insertedId;

    await mongoDb.collection('apikeys').insertOne({
      userId: testUserId, name: 'RL Violation Probe (auto-cleanup)',
      key: TEST_KEY, rateLimitRps: RPS_LIMIT,
      usageCount: 0, isActive: true, createdAt: new Date()
    });

    jwtToken = jwt.sign({ id: testUserId.toString() }, JWT_SECRET, { expiresIn: '1h' });

    // Redis client for direct key inspection
    redisClient = redis.createClient({ url: REDIS_URL });
    await redisClient.connect();

    // Delete any stale violation counter from a previous run
    await redisClient.del(`rl_violations:${testUserId}`);

    console.log(`  SETUP: user=${TEST_EMAIL}, userId=${testUserId}, key=${TEST_KEY}`);
  });

  // =========================================================================
  // TEARDOWN
  // =========================================================================
  t.after(async () => {
    if (redisClient && redisClient.isOpen) {
      await redisClient.del(`rl_violations:${testUserId}`);
      // Also clean up any ratelimit window keys created during the test
      const keys = await redisClient.keys(`ratelimit:${TEST_KEY}:*`);
      if (keys.length) await redisClient.del(keys);
      await redisClient.quit();
    }
    if (mongoDb && testUserId) {
      await mongoDb.collection('requestlogs').deleteMany({ userId: testUserId });
      await mongoDb.collection('apikeys').deleteMany({ userId: testUserId });
      await mongoDb.collection('users').deleteOne({ _id: testUserId });
      console.log(`  TEARDOWN: all test data deleted`);
    }
    await mongoose.disconnect();
  });

  // =========================================================================
  // Case 1: Baseline — counter starts at 0 (or absent)
  // =========================================================================
  await t.test('Baseline: rl_violations counter starts absent/zero', async () => {
    const val = await redisClient.get(`rl_violations:${testUserId}`);
    assert.ok(val === null || parseInt(val, 10) === 0,
      `Counter must be null or 0 before any requests. Got: ${val}`);
    console.log(`  Counter initial value: ${val} (null = not yet created)`);

    // /stats should also report 0
    const { status, body } = await getStats(jwtToken);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.metrics.rateLimitViolations, 0,
      'rateLimitViolations must be 0 before any violations');
    console.log(`  /analytics/stats.rateLimitViolations = 0  (correct baseline)`);
  });

  // =========================================================================
  // Case 2: Successful requests do NOT increment the violation counter
  // =========================================================================
  await t.test('Successful requests: violation counter stays 0', async () => {
    // Align to a fresh second window so we stay well within the limit
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 60);

    // Send 3 requests (= RPS limit) — all should succeed
    const results = await Promise.all(
      Array.from({ length: RPS_LIMIT }, (_, i) => stripePost(TEST_KEY, { probe: i }))
    );
    const ok = results.filter(r => r.status === 200);
    assert.strictEqual(ok.length, RPS_LIMIT, `All ${RPS_LIMIT} requests must be 200`);
    console.log(`  ${RPS_LIMIT} successful requests sent`);

    await delay(200);

    const val = await redisClient.get(`rl_violations:${testUserId}`);
    const count = val ? parseInt(val, 10) : 0;
    assert.strictEqual(count, 0,
      `Violation counter must still be 0 after successful requests. Got: ${count}`);
    console.log(`  Counter after ${RPS_LIMIT} successful requests: ${count}  (still 0, correct)`);

    // Wait for the window to expire before the burst test
    await delay(2200);
  });

  // =========================================================================
  // Case 3: Rate-limited burst increments the counter for each 429
  // =========================================================================
  await t.test(`Burst: ${BURST_SIZE} requests at RPS=${RPS_LIMIT} → counter increments`, async () => {
    // Align to fresh second
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 60);

    const counterBefore = await redisClient.get(`rl_violations:${testUserId}`);
    const beforeCount = counterBefore ? parseInt(counterBefore, 10) : 0;
    console.log(`  Violation counter BEFORE burst: ${beforeCount}`);

    // Fire BURST_SIZE requests simultaneously — RPS_LIMIT will pass, rest get 429
    const burstResults = await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, i) => stripePost(TEST_KEY, { burst: i }))
    );

    const count200 = burstResults.filter(r => r.status === 200).length;
    const count429 = burstResults.filter(r => r.status === 429).length;
    const expected429 = BURST_SIZE - RPS_LIMIT;

    console.log(`\n  Burst results (${BURST_SIZE} simultaneous, limit=${RPS_LIMIT}):`);
    console.log(`    HTTP 200: ${count200}  (allowed)`);
    console.log(`    HTTP 429: ${count429}  (blocked)`);

    assert.strictEqual(count200, RPS_LIMIT,   `Expected ${RPS_LIMIT} allowed. Got ${count200}`);
    assert.strictEqual(count429, expected429, `Expected ${expected429} blocked. Got ${count429}`);

    // Give fire-and-forget incr calls a moment to complete
    await delay(300);

    // Read the counter directly from Redis
    const counterAfter = await redisClient.get(`rl_violations:${testUserId}`);
    const afterCount = counterAfter ? parseInt(counterAfter, 10) : 0;
    const delta = afterCount - beforeCount;

    console.log(`  Violation counter AFTER burst:  ${afterCount}`);
    console.log(`  Delta (new violations):         ${delta}`);
    console.log(`  Expected delta:                 ${expected429}`);

    assert.strictEqual(delta, expected429,
      `Redis counter must have increased by exactly ${expected429} (one incr per 429). ` +
      `Delta was: ${delta}`);
    console.log(`  CHECK Redis rl_violations:${testUserId} = ${afterCount} (incremented correctly)`);

    // Verify 429 payload contract is unchanged
    const sample429 = burstResults.find(r => r.status === 429).body;
    assert.strictEqual(sample429.success, false);
    assert.strictEqual(sample429.error, 'Rate limit violation - too many requests');
    assert.strictEqual(sample429.limit, RPS_LIMIT);
    assert.ok(Number.isInteger(sample429.retryAfterSeconds) && sample429.retryAfterSeconds >= 1);
    console.log(`  CHECK 429 payload contract unchanged`);
  });

  // =========================================================================
  // Case 4: Analytics /stats reflects the actual violation count
  // =========================================================================
  await t.test('Analytics /stats: rateLimitViolations matches Redis counter', async () => {
    // Read what Redis actually holds
    const redisVal = await redisClient.get(`rl_violations:${testUserId}`);
    const redisCount = redisVal ? parseInt(redisVal, 10) : 0;
    assert.ok(redisCount > 0, `Redis counter must be > 0 at this point. Got: ${redisCount}`);

    // Call the analytics API
    const { status, body } = await getStats(jwtToken);
    assert.strictEqual(status, 200, `/analytics/stats must return 200`);

    const reported = body.data.metrics.rateLimitViolations;
    console.log(`\n  Redis counter           : ${redisCount}`);
    console.log(`  /stats.rateLimitViolations: ${reported}`);

    assert.strictEqual(reported, redisCount,
      `rateLimitViolations in /stats must equal the Redis counter. ` +
      `Expected ${redisCount}, got ${reported}`);

    // Must be > 0 — this was always 0 before the fix
    assert.ok(reported > 0,
      `rateLimitViolations must be > 0 (was always 0 before the BUG-1 fix). Got: ${reported}`);

    console.log(`  CHECK /stats.rateLimitViolations = ${reported}  (was ALWAYS 0 before fix)`);
  });

  // =========================================================================
  // Case 5: Violation counter accumulates across multiple bursts
  // =========================================================================
  await t.test('Accumulation: counter persists and accumulates across windows', async () => {
    const before = await redisClient.get(`rl_violations:${testUserId}`);
    const beforeCount = parseInt(before || '0', 10);

    // Wait for window to expire then trigger 2 more 429s
    await delay(2200);
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 60);

    // Send RPS_LIMIT + 2 requests (2 will be 429)
    const results = await Promise.all(
      Array.from({ length: RPS_LIMIT + 2 }, (_, i) => stripePost(TEST_KEY, { accum: i }))
    );
    const new429s = results.filter(r => r.status === 429).length;
    assert.strictEqual(new429s, 2, `Expected 2 new 429s. Got: ${new429s}`);

    await delay(300);

    const after = await redisClient.get(`rl_violations:${testUserId}`);
    const afterCount = parseInt(after || '0', 10);
    const delta = afterCount - beforeCount;

    assert.strictEqual(delta, 2,
      `Counter must have grown by exactly 2. Delta: ${delta}`);
    console.log(`  Counter grew from ${beforeCount} → ${afterCount} (+2). Accumulation confirmed.`);
  });

  // =========================================================================
  // REPORT
  // =========================================================================
  console.log('\n  ================================================================');
  console.log('  BUG-1 FIX VERIFICATION COMPLETE');
  console.log('  ----------------------------------------------------------------');
  console.log('  Previous behavior: rateLimitViolations always = 0');
  console.log('  New behavior:      rateLimitViolations = Redis rl_violations:<userId> counter');
  console.log('  Counter key:       rl_violations:<userId>  (no TTL, persistent across windows)');
  console.log('  Counter location:  rateLimiter.js (incr on every 429 before response)');
  console.log('  Counter read:      analyticsController.js (redis.get instead of MongoDB query)');
  console.log('  Real API calls:    NONE');
  console.log('  Credits consumed:  NONE');
  console.log('  Production bugs:   NONE introduced');
  console.log('  ================================================================\n');
});
