const test = require('node:test');
const assert = require('node:assert');
const { getRedisClient } = require('../config/redis');
const { deleteKeysByPattern } = require('../utils/redisUtils');
const { clearUserCache } = require('../controllers/cacheController');

test('Phase 2C: Non-blocking Redis SCAN Test Suite', async (t) => {
  const redis = getRedisClient();

  t.beforeEach(async () => {
    if (redis.store) {
      redis.store.clear();
    }
  });

  await t.test('1. Proves SCAN / scanIterator is called and KEYS is NEVER called', async () => {
    let keysCalled = false;
    let scanIteratorCalled = false;
    let scanCalled = false;

    // Attach spy traps to verify KEYS is never called
    redis.keys = async () => {
      keysCalled = true;
      throw new Error('BLOCKING KEYS command should NEVER be called!');
    };

    const originalScanIterator = redis.scanIterator;
    redis.scanIterator = async function* (options) {
      scanIteratorCalled = true;
      yield* originalScanIterator.call(this, options);
    };

    const originalScan = redis.scan;
    redis.scan = async function (...args) {
      scanCalled = true;
      return originalScan.apply(this, args);
    };

    try {
      // Seed some test keys
      await redis.set('apicache:user123:req1', 'data1');
      await redis.set('apicache:user123:req2', 'data2');
      await redis.set('apicache:user456:req3', 'data3');

      const deletedCount = await deleteKeysByPattern(redis, 'apicache:user123:*');

      assert.strictEqual(deletedCount, 2, 'Should delete exactly 2 matching keys');
      assert.strictEqual(keysCalled, false, 'redis.keys MUST NOT be called');
      assert.ok(scanIteratorCalled || scanCalled, 'Either scanIterator or scan MUST be used');

      // Verify un-matched key still exists
      const remaining = await redis.get('apicache:user456:req3');
      assert.strictEqual(remaining, 'data3', 'Unrelated keys must not be deleted');
    } finally {
      delete redis.keys;
      redis.scanIterator = originalScanIterator;
      redis.scan = originalScan;
    }
  });

  await t.test('2. Batch deletion handles large key set in chunks without memory blowout', async () => {
    const totalKeys = 125;
    const batchSize = 25;
    const delBatches = [];

    for (let i = 0; i < totalKeys; i++) {
      await redis.set(`apicache:batch_user:key_${i}`, `val_${i}`);
    }

    // Spy on del to record batch sizes
    const originalDel = redis.del;
    redis.del = async function (keys) {
      if (Array.isArray(keys)) {
        delBatches.push(keys.length);
      } else {
        delBatches.push(1);
      }
      return originalDel.call(this, keys);
    };

    try {
      const deletedCount = await deleteKeysByPattern(redis, 'apicache:batch_user:*', { batchSize });
      assert.strictEqual(deletedCount, totalKeys, 'All 125 keys must be deleted');

      // 125 keys with batch size 25 should produce 5 batches of 25 keys
      assert.strictEqual(delBatches.length, 5, 'Should execute exactly 5 DEL batches');
      assert.deepStrictEqual(delBatches, [25, 25, 25, 25, 25], 'Each batch should be capped at batchSize');

      // Verify all keys are gone
      for (let i = 0; i < totalKeys; i++) {
        const val = await redis.get(`apicache:batch_user:key_${i}`);
        assert.strictEqual(val, null, `Key key_${i} must be deleted`);
      }
    } finally {
      redis.del = originalDel;
    }
  });

  await t.test('3. Zero matching keys handled safely without errors', async () => {
    let delCalled = false;
    const originalDel = redis.del;
    redis.del = async function (...args) {
      delCalled = true;
      return originalDel.apply(this, args);
    };

    try {
      // Key space has no matches for this pattern
      await redis.set('other:key:1', 'val1');

      const deletedCount = await deleteKeysByPattern(redis, 'apicache:nonexistent:*');
      assert.strictEqual(deletedCount, 0, 'Deleted count should be 0');
      assert.strictEqual(delCalled, false, 'redis.del should not be called when 0 keys match');
    } finally {
      redis.del = originalDel;
    }
  });

  await t.test('4. Redis error handling is graceful and logged', async () => {
    const brokenRedis = {
      scanIterator: async function* () {
        throw new Error('Redis connection dropped during SCAN');
      }
    };

    await assert.rejects(
      async () => {
        await deleteKeysByPattern(brokenRedis, 'apicache:err:*');
      },
      (err) => {
        assert.ok(err.message.includes('Redis connection dropped during SCAN'));
        return true;
      }
    );
  });

  await t.test('5. clearUserCache Controller integration uses SCAN and returns clean response', async () => {
    const userId = '507f1f77bcf86cd799439077';
    // Seed user cache keys
    await redis.set(`apicache:${userId}:route1`, JSON.stringify({ ok: 1 }));
    await redis.set(`apicache:${userId}:route2`, JSON.stringify({ ok: 2 }));
    await redis.set(`apicache:${userId}:route3`, JSON.stringify({ ok: 3 }));
    await redis.set(`apicache:another_user:route1`, JSON.stringify({ ok: 4 }));

    // Ensure redis.keys is never called in controller
    redis.keys = async () => {
      throw new Error('redis.keys called unexpectedly in clearUserCache');
    };

    const req = {
      user: { _id: userId }
    };

    let responseStatus = null;
    let responseData = null;
    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    try {
      await clearUserCache(req, res);

      assert.strictEqual(responseStatus, 200);
      assert.strictEqual(responseData.success, true);
      assert.strictEqual(responseData.message, 'Successfully cleared 3 cache records.');

      // Check user keys were cleared
      const k1 = await redis.get(`apicache:${userId}:route1`);
      const k2 = await redis.get(`apicache:${userId}:route2`);
      const k3 = await redis.get(`apicache:${userId}:route3`);
      assert.strictEqual(k1, null);
      assert.strictEqual(k2, null);
      assert.strictEqual(k3, null);

      // Other user key remains
      const kOther = await redis.get(`apicache:another_user:route1`);
      assert.notStrictEqual(kOther, null);
    } finally {
      delete redis.keys;
    }
  });

  await t.test('6. Cursor-based redis.scan fallback works when scanIterator is not available', async () => {
    // Custom redis mock that only implements cursor-based scan (not scanIterator)
    const store = new Map();
    store.set('apicache:cur:1', 'a');
    store.set('apicache:cur:2', 'b');
    store.set('apicache:cur:3', 'c');
    store.set('unrelated:1', 'd');

    const cursorOnlyRedis = {
      async scan(cursor, options) {
        const pattern = options.MATCH;
        const all = Array.from(store.keys()).filter(k => k.startsWith('apicache:cur:'));
        const cur = parseInt(cursor, 10);
        const batch = all.slice(cur, cur + 2);
        const nextCur = cur + 2 < all.length ? String(cur + 2) : '0';
        return { cursor: nextCur, keys: batch };
      },
      async del(keys) {
        let count = 0;
        for (const k of keys) {
          if (store.delete(k)) count++;
        }
        return count;
      }
    };

    const deleted = await deleteKeysByPattern(cursorOnlyRedis, 'apicache:cur:*', { batchSize: 2 });
    assert.strictEqual(deleted, 3);
    assert.strictEqual(store.size, 1);
    assert.strictEqual(store.has('unrelated:1'), true);
  });

});
