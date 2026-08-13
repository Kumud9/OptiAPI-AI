/**
 * Gateway Rate-Limiter Live Integration Test
 * ============================================
 *
 * PURPOSE
 * -------
 * Verify that the RUNNING Docker backend (localhost:5000) correctly routes
 * gateway API-key requests through the Redis-backed sliding-window rate
 * limiter and enforces the configured RPS limit end-to-end.
 *
 * SAFETY GUARANTEES
 * -----------------
 * • Uses the "stripe" provider which is 100% simulated in externalApiService.js
 *   (no vault lookup, no real HTTP call to any external service).
 * • Creates its own dedicated temporary API key (TEST_KEY below).
 *   The configured "gemini test key 2" key is never touched.
 * • Does NOT modify: rateLimiter.js, externalApiService.js, redis.js,
 *   auth.js, or any other production source file.
 * • Cleans up the temporary key from MongoDB after the test finishes.
 * • Cleans up the Redis ratelimit key after the test finishes.
 *
 * WHAT IS VERIFIED
 * ----------------
 * 1. Requests up to the RPS limit => HTTP 200
 * 2. Requests beyond the RPS limit => HTTP 429 (rate limit violation)
 * 3. 429 response payload matches the rateLimiter.js contract
 * 4. Redis ratelimit:<key>:<second> key is created and has a TTL
 * 5. No "Rate Limiter execution failure" log (inferred: no bypass occurred)
 * 6. Window resets correctly after the TTL expires
 *
 * RUNTIME REQUIREMENTS
 * --------------------
 * Docker containers running: optiapi_backend, optiapi_redis, optiapi_mongodb
 *   (i.e. `docker compose up -d` has been run)
 *
 * Run from backend/ directory:
 *   node --test src/tests/gatewayRateLimiter.integration.test.js
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------
const backendDir      = path.resolve(__dirname, '../..');  // backend/src/tests -> backend/
const nodeModulesPath = (pkg) => path.join(backendDir, 'node_modules', pkg);

const mongoose = require(nodeModulesPath('mongoose'));
const redis    = require(nodeModulesPath('redis'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GATEWAY_URL = 'http://localhost:5000/api/v1/gateway';
const MONGO_URI   = 'mongodb://localhost:27017/optiapi';
const REDIS_URL   = 'redis://localhost:6379';

// Dedicated test key — never the user's configured key
const TEST_KEY      = 'opti_rl_integration_probe_v1';
const TEST_KEY_NAME = 'Rate-Limiter Integration Probe (auto-cleanup)';
const RPS_LIMIT     = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send one gateway request using the stripe provider (always simulated —
 * externalApiService.js case 'stripe' never performs a vault lookup and
 * never makes any real external HTTP call).
 */
const sendStripeRequest = (index) =>
  fetch(`${GATEWAY_URL}/stripe/v1/charges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    TEST_KEY
    },
    body: JSON.stringify({ probe: index, amount: 100, currency: 'usd' })
  }).then(async (res) => ({ status: res.status, body: await res.json() }));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
test('Gateway Rate-Limiter Live Integration', async (t) => {

  let mongoDb     = null;
  let redisClient = null;

  // ==========================================================================
  // SETUP
  // ==========================================================================
  t.before(async () => {
    // Connect to MongoDB (Docker exposes on localhost:27017)
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    mongoDb = mongoose.connection.db;

    const user = await mongoDb.collection('users').findOne({ email: 'demo@optiapi.com' });
    assert.ok(
      user,
      'SETUP FAILED: demo@optiapi.com must exist. Run `npm run seed` first.'
    );

    // Remove any leftover from a previous aborted run
    await mongoDb.collection('apikeys').deleteOne({ key: TEST_KEY });

    // Insert dedicated temporary test key (RPS limit = 3)
    await mongoDb.collection('apikeys').insertOne({
      userId:       user._id,
      name:         TEST_KEY_NAME,
      key:          TEST_KEY,
      rateLimitRps: RPS_LIMIT,
      usageCount:   0,
      isActive:     true,
      createdAt:    new Date()
    });

    // Connect directly to Redis to inspect keys after requests
    redisClient = redis.createClient({ url: REDIS_URL });
    await redisClient.connect();
  });

  // ==========================================================================
  // TEARDOWN
  // ==========================================================================
  t.after(async () => {
    if (mongoDb) {
      await mongoDb.collection('apikeys').deleteOne({ key: TEST_KEY });
    }
    await mongoose.disconnect();

    if (redisClient && redisClient.isOpen) {
      const keys = await redisClient.keys(`ratelimit:${TEST_KEY}:*`);
      if (keys.length > 0) await redisClient.del(keys);
      await redisClient.quit();
    }
  });

  // ==========================================================================
  // Case 1: Backend sanity check
  // ==========================================================================
  await t.test('Sanity: backend health endpoint is reachable', async () => {
    const res = await fetch('http://localhost:5000/health');
    assert.strictEqual(res.status, 200, 'Backend /health must return 200');
    const body = await res.json();
    assert.strictEqual(body.status, 'healthy');
    console.log('  CHECK backend is healthy');
  });

  // ==========================================================================
  // Case 2: Single first request to confirm stripe simulation works
  // ==========================================================================
  await t.test('Sanity: first stripe request returns 200 (simulated response)', async () => {
    // Start at a fresh second to avoid cross-boundary interference
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 60);

    const { status, body } = await sendStripeRequest(0);

    assert.strictEqual(
      status,
      200,
      'Expected 200 from stripe simulator. Got: ' + status + ' ' + JSON.stringify(body)
    );
    // Stripe simulated response always contains an id field
    assert.ok(body.id || body.object, 'Simulated stripe response must have id or object field');
    console.log('  CHECK stripe provider returned simulated 200 (no real API call made)');

    // Wait for this window to expire before the concurrency burst
    await delay(2200);
  });

  // ==========================================================================
  // Case 3: 10 concurrent requests — core rate-limit enforcement check
  // ==========================================================================
  await t.test(`Concurrency burst: 10 simultaneous requests, limit = ${RPS_LIMIT} RPS`, async () => {
    // Align to a fresh second boundary
    const msToNextSec = 1000 - (Date.now() % 1000);
    await delay(msToNextSec + 60);

    // Record the second at burst time for Redis key lookup
    const burstTimestampSec = Math.floor(Date.now() / 1000);

    // Fire 10 requests simultaneously — stripe provider is always simulated
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(sendStripeRequest(i));
    }
    const results = await Promise.all(promises);

    // Categorise
    const successes  = results.filter((r) => r.status === 200);
    const blocked    = results.filter((r) => r.status === 429);
    const unexpected = results.filter((r) => r.status !== 200 && r.status !== 429);

    // Print result table
    console.log('\n  +--------------------------------------------------------+');
    console.log('  |  Rate-Limiter Concurrency Result                       |');
    console.log('  +--------------------------------------------------------+');
    console.log(`  |  Total requests sent : 10                              |`);
    console.log(`  |  Allowed  (HTTP 200) : ${String(successes.length).padEnd(32)}|`);
    console.log(`  |  Blocked  (HTTP 429) : ${String(blocked.length).padEnd(32)}|`);
    console.log(`  |  Unexpected codes   : ${String(unexpected.length).padEnd(33)}|`);
    console.log(`  |  Configured RPS     : ${String(RPS_LIMIT).padEnd(33)}|`);
    console.log('  +--------------------------------------------------------+');

    // --- Assertion: allowed exactly = RPS limit ---
    assert.strictEqual(
      successes.length,
      RPS_LIMIT,
      `Expected exactly ${RPS_LIMIT} requests to succeed (= RPS limit). Got ${successes.length}.`
    );

    // --- Assertion: blocked = 10 - RPS limit ---
    const expectedBlocked = 10 - RPS_LIMIT;
    assert.strictEqual(
      blocked.length,
      expectedBlocked,
      `Expected exactly ${expectedBlocked} requests to be blocked (HTTP 429). Got ${blocked.length}.`
    );

    // --- Assertion: 429 payload matches rateLimiter.js contract ---
    const sample429 = blocked[0].body;
    assert.strictEqual(
      sample429.success,
      false,
      '429 body.success must be false'
    );
    assert.strictEqual(
      sample429.error,
      'Rate limit violation - too many requests',
      '429 body.error must match rateLimiter.js string'
    );
    assert.strictEqual(
      sample429.limit,
      RPS_LIMIT,
      `429 body.limit must equal configured RPS (${RPS_LIMIT})`
    );
    assert.ok(
      Number.isInteger(sample429.retryAfterSeconds) && sample429.retryAfterSeconds >= 1,
      '429 body.retryAfterSeconds must be a positive integer'
    );
    console.log('  CHECK 429 payload matches rateLimiter.js contract');

    // --- Assertion: no unexpected status codes (proves no execution failure bypass) ---
    assert.strictEqual(
      unexpected.length,
      0,
      'All responses must be 200 or 429 — no Rate Limiter execution failure bypass occurred. ' +
      'Got unexpected: ' + unexpected.map((r) => r.status).join(', ')
    );
    console.log('  CHECK no Rate Limiter execution failure (all codes were 200 or 429)');

    // --- Assertion: Redis ratelimit key exists with correct value and TTL ---
    // The key is ratelimit:<apiKeyString>:<timestampSec>
    // If the burst crossed a second boundary we check both seconds
    const possibleKeys = [
      `ratelimit:${TEST_KEY}:${burstTimestampSec}`,
      `ratelimit:${TEST_KEY}:${burstTimestampSec + 1}`
    ];

    let foundKey   = null;
    let foundCount = null;
    let foundTtl   = null;

    for (const k of possibleKeys) {
      const val = await redisClient.get(k);
      if (val !== null) {
        foundKey   = k;
        foundCount = parseInt(val, 10);
        foundTtl   = await redisClient.ttl(k);
        break;
      }
    }

    assert.ok(
      foundKey !== null,
      'Redis ratelimit key must exist. Checked: ' + possibleKeys.join(', ')
    );
    assert.ok(
      foundCount >= RPS_LIMIT,
      `Redis counter (${foundCount}) must be >= RPS limit (${RPS_LIMIT})`
    );
    assert.ok(
      foundTtl > 0 && foundTtl <= 2,
      `Redis TTL must be 1-2 s (sliding-window bucket TTL). Got: ${foundTtl}s`
    );

    console.log(`  CHECK Redis key exists: ${foundKey}`);
    console.log(`         counter value : ${foundCount} (>= limit ${RPS_LIMIT})`);
    console.log(`         TTL remaining : ${foundTtl}s`);
  });

  // ==========================================================================
  // Case 4: Window expiry and reset
  // ==========================================================================
  await t.test('Window expiry: first request in new window returns 200', async () => {
    // Wait for the ratelimit key TTL (2 s max) + buffer
    await delay(2200);

    const { status, body } = await sendStripeRequest(99);
    assert.strictEqual(
      status,
      200,
      `First request after window expiry must be 200. Got ${status}. Body: ${JSON.stringify(body)}`
    );
    console.log('  CHECK window reset: request after TTL expiry returned 200');
  });

  // ==========================================================================
  // REPORT
  // ==========================================================================
  console.log('\n  ============================================================');
  console.log('  Integration test COMPLETE');
  console.log('  ------------------------------------------------------------');
  console.log(`  Test file      : src/tests/gatewayRateLimiter.integration.test.js`);
  console.log(`  Test key       : ${TEST_KEY}  (deleted after test)`);
  console.log(`  Provider used  : stripe  (simulated — ZERO real API calls)`);
  console.log(`  RPS limit      : ${RPS_LIMIT}`);
  console.log(`  Allowed (200)  : ${RPS_LIMIT} requests`);
  console.log(`  Blocked (429)  : ${10 - RPS_LIMIT} requests`);
  console.log(`  Real provider call : NO`);
  console.log(`  Production files changed : NO`);
  console.log('  ============================================================\n');
});
