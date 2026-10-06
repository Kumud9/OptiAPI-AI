const test = require('node:test');
const assert = require('node:assert');
const {
  generateDeduplicationKey,
  deduplicate,
  isInFlight,
  getInFlightCount,
  clearInFlight
} = require('../services/requestDeduplicationService');
const externalApiService = require('../services/externalApiService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const RequestLog = require('../models/RequestLog');

test('Phase 2A: Request Deduplication Service Suite', async (t) => {
  // Prevent Mongoose buffering timeout in tests when MongoDB is not connected
  const originalRequestLogCreate = RequestLog.create;
  RequestLog.create = async () => ({ _id: 'mock_log_id' });

  t.beforeEach(() => {
    clearInFlight();
  });

  t.afterEach(() => {
    clearInFlight();
  });

  t.after(() => {
    RequestLog.create = originalRequestLogCreate;
  });

  await t.test('1. Key Generation - Determinism and Security', async () => {
    const baseParams = {
      userId: 'user_123',
      provider: 'openai',
      model: 'gpt-4o',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      query: { temperature: '0.7', stream: 'false' },
      body: { prompt: 'Hello', max_tokens: 100 }
    };

    const key1 = generateDeduplicationKey(baseParams);
    assert.strictEqual(typeof key1, 'string');
    assert.strictEqual(key1.length, 64, 'SHA-256 hash must be 64 hexadecimal characters');

    // Key ordering in body and query must NOT alter the generated hash
    const unorderedParams = {
      userId: 'user_123',
      provider: 'openai',
      model: 'gpt-4o',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      query: { stream: 'false', temperature: '0.7' },
      body: { max_tokens: 100, prompt: 'Hello' }
    };
    const key2 = generateDeduplicationKey(unorderedParams);
    assert.strictEqual(key1, key2, 'Key generation must be canonical and deterministic');

    // Never sensitive to external headers, API keys, timestamps, or request IDs (they are not passed or factored)
    const keyWithIgnoredData = generateDeduplicationKey({
      ...baseParams,
      apiKey: 'secret_key_123',
      headers: { authorization: 'Bearer 1234' },
      requestId: 'req_xyz_999',
      timestamp: Date.now()
    });
    assert.strictEqual(key1, keyWithIgnoredData, 'Ignored metadata (apiKey, headers, requestId, timestamp) must not alter hash');
  });

  await t.test('2. Key Generation - Differentiation on user, provider, model, method, endpoint, query, body', async () => {
    const base = {
      userId: 'user_123',
      provider: 'openai',
      model: 'gpt-4o',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      query: {},
      body: { message: 'hi' }
    };
    const baseKey = generateDeduplicationKey(base);

    // Different user
    const diffUserKey = generateDeduplicationKey({ ...base, userId: 'user_456' });
    assert.notStrictEqual(baseKey, diffUserKey, 'Different user must produce different hash');

    // Different provider
    const diffProviderKey = generateDeduplicationKey({ ...base, provider: 'gemini' });
    assert.notStrictEqual(baseKey, diffProviderKey, 'Different provider must produce different hash');

    // Different model
    const diffModelKey = generateDeduplicationKey({ ...base, model: 'gpt-4o-mini' });
    assert.notStrictEqual(baseKey, diffModelKey, 'Different model must produce different hash');

    // Different method
    const diffMethodKey = generateDeduplicationKey({ ...base, method: 'GET' });
    assert.notStrictEqual(baseKey, diffMethodKey, 'Different method must produce different hash');

    // Different endpoint
    const diffEndpointKey = generateDeduplicationKey({ ...base, endpoint: '/v1/embeddings' });
    assert.notStrictEqual(baseKey, diffEndpointKey, 'Different endpoint must produce different hash');

    // Different query
    const diffQueryKey = generateDeduplicationKey({ ...base, query: { debug: 'true' } });
    assert.notStrictEqual(baseKey, diffQueryKey, 'Different query must produce different hash');

    // Different body
    const diffBodyKey = generateDeduplicationKey({ ...base, body: { message: 'bye' } });
    assert.notStrictEqual(baseKey, diffBodyKey, 'Different body must produce different hash');
  });

  await t.test('3. Deduplication - 10 identical concurrent requests → exactly 1 upstream call', async () => {
    let upstreamCallCount = 0;
    const testKey = 'test_shared_key_10_requests';

    const upstreamMock = async () => {
      upstreamCallCount++;
      // Simulate small upstream delay
      await new Promise(r => setTimeout(r, 40));
      return { answer: 'Paris', tokens: 42 };
    };

    // Launch 10 identical concurrent requests simultaneously
    const requests = Array.from({ length: 10 }, () => deduplicate(testKey, upstreamMock));

    // While in flight, the key should be tracked
    assert.strictEqual(isInFlight(testKey), true, 'Key must be tracked as in-flight');

    const results = await Promise.all(requests);

    // Verify all 10 received the exact same result
    assert.strictEqual(results.length, 10);
    results.forEach(res => {
      assert.deepStrictEqual(res, { answer: 'Paris', tokens: 42 });
    });

    // Upstream call must be executed EXACTLY 1 time
    assert.strictEqual(upstreamCallCount, 1, 'Exactly 1 upstream call should be made for 10 concurrent identical requests');

    // After completion, inFlight entry must be cleared
    assert.strictEqual(isInFlight(testKey), false, 'Key must be deleted from Map after completion');
    assert.strictEqual(getInFlightCount(), 0, 'In-flight count must return to 0');
  });

  await t.test('4. Deduplication - Different body/user/provider/model → no deduplication', async () => {
    let callCount = 0;
    const worker = async (id) => {
      callCount++;
      await new Promise(r => setTimeout(r, 20));
      return { workerId: id };
    };

    const keyUser1 = generateDeduplicationKey({ userId: 'u1', provider: 'openai', model: 'm1', method: 'POST', endpoint: '/e', body: { a: 1 } });
    const keyUser2 = generateDeduplicationKey({ userId: 'u2', provider: 'openai', model: 'm1', method: 'POST', endpoint: '/e', body: { a: 1 } });
    const keyProvider = generateDeduplicationKey({ userId: 'u1', provider: 'gemini', model: 'm1', method: 'POST', endpoint: '/e', body: { a: 1 } });
    const keyModel = generateDeduplicationKey({ userId: 'u1', provider: 'openai', model: 'm2', method: 'POST', endpoint: '/e', body: { a: 1 } });
    const keyBody = generateDeduplicationKey({ userId: 'u1', provider: 'openai', model: 'm1', method: 'POST', endpoint: '/e', body: { a: 2 } });

    const [r1, r2, r3, r4, r5] = await Promise.all([
      deduplicate(keyUser1, () => worker(1)),
      deduplicate(keyUser2, () => worker(2)),
      deduplicate(keyProvider, () => worker(3)),
      deduplicate(keyModel, () => worker(4)),
      deduplicate(keyBody, () => worker(5))
    ]);

    assert.strictEqual(callCount, 5, 'All 5 distinct requests must execute independently without deduplication');
    assert.strictEqual(r1.workerId, 1);
    assert.strictEqual(r2.workerId, 2);
    assert.strictEqual(r3.workerId, 3);
    assert.strictEqual(r4.workerId, 4);
    assert.strictEqual(r5.workerId, 5);
  });

  await t.test('5. Deduplication - Failed request releases the key and propagates error to all awaiters', async () => {
    let attempts = 0;
    const failKey = 'test_failure_key';

    const failingUpstream = async () => {
      attempts++;
      await new Promise(r => setTimeout(r, 30));
      const err = new Error('Upstream network timeout');
      err.status = 504;
      throw err;
    };

    // 3 concurrent requests awaiting the failing upstream
    const p1 = deduplicate(failKey, failingUpstream);
    const p2 = deduplicate(failKey, failingUpstream);
    const p3 = deduplicate(failKey, failingUpstream);

    assert.strictEqual(isInFlight(failKey), true);

    const outcomes = await Promise.allSettled([p1, p2, p3]);

    assert.strictEqual(attempts, 1, 'Only 1 upstream call attempted for concurrent requests');
    outcomes.forEach(out => {
      assert.strictEqual(out.status, 'rejected');
      assert.strictEqual(out.reason.message, 'Upstream network timeout');
    });

    // Key must be removed from the in-flight Map upon failure
    assert.strictEqual(isInFlight(failKey), false, 'Key must be released on failure');
    assert.strictEqual(getInFlightCount(), 0);
  });

  await t.test('6. Deduplication - Subsequent request can execute again after previous request finishes', async () => {
    let callCount = 0;
    const testKey = 'test_subsequent_key';

    const work = async () => {
      callCount++;
      return { execution: callCount };
    };

    // First request executes and completes
    const res1 = await deduplicate(testKey, work);
    assert.strictEqual(res1.execution, 1);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(isInFlight(testKey), false, 'Map must be empty after first completion');

    // Subsequent request with the same key arrives after the first finished
    const res2 = await deduplicate(testKey, work);
    assert.strictEqual(res2.execution, 2);
    assert.strictEqual(callCount, 2, 'Subsequent request must execute a new upstream call since previous finished');
  });

  await t.test('7. Gateway Integration - 10 concurrent requests to handleGatewayRequest execute exactly 1 upstream call', async () => {
    const originalSimulateApiCall = externalApiService.simulateApiCall;
    let upstreamCallCount = 0;

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      upstreamCallCount++;
      await new Promise(r => setTimeout(r, 50));
      return {
        data: { id: 'chatcmpl-dedup-1', choices: [{ message: { content: 'Gateway deduplicated response' } }] },
        tokensUsed: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'gpt-4o'
      };
    };

    try {
      // Create 10 concurrent express-like req/res contexts with identical user, provider, endpoint, body
      const promises = Array.from({ length: 10 }, (_, i) => {
        return new Promise((resolve) => {
          const req = {
            params: { provider: 'openai', '0': '/v1/chat/completions' },
            method: 'POST',
            body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is 2+2?' }] },
            headers: { 'content-type': 'application/json' },
            userId: '507f1f77bcf86cd799439099',
            query: {}
          };
          const res = {
            statusCode: 200,
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ index: i, statusCode: this.statusCode, payload }); }
          };
          handleGatewayRequest(req, res);
        });
      });

      const responses = await Promise.all(promises);

      // Verify all 10 received 200 with the exact same data payload
      assert.strictEqual(responses.length, 10);
      responses.forEach(r => {
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.payload.choices[0].message.content, 'Gateway deduplicated response');
      });

      // Crucial verification: exactly 1 call reached simulateApiCall
      assert.strictEqual(upstreamCallCount, 1, 'handleGatewayRequest must execute exactly 1 upstream call across 10 concurrent identical requests');
    } finally {
      externalApiService.simulateApiCall = originalSimulateApiCall;
    }
  });

  await t.test('8. Gateway Integration - Retry and 15s timeout behavior preserved during deduplication', async () => {
    const originalSimulateApiCall = externalApiService.simulateApiCall;
    let callAttempts = 0;

    externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
      callAttempts++;
      if (callAttempts === 1) {
        // Attempt 1: simulate timeout error (504, shouldRetry = true)
        const err = new Error('Upstream provider timed out');
        err.status = 504;
        err.shouldRetry = true;
        throw err;
      }
      // Attempt 2: succeeds
      return {
        data: { message: 'Recovered after retry' },
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        model: 'gpt-4o'
      };
    };

    try {
      // 3 concurrent requests
      const promises = Array.from({ length: 3 }, () => {
        return new Promise((resolve) => {
          const req = {
            params: { provider: 'openai', '0': '/v1/chat/completions' },
            method: 'POST',
            body: { model: 'gpt-4o', prompt: 'retry test' },
            headers: {},
            userId: '507f1f77bcf86cd799439088',
            query: {}
          };
          const res = {
            statusCode: 200,
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ statusCode: this.statusCode, payload }); }
          };
          handleGatewayRequest(req, res);
        });
      });

      const responses = await Promise.all(promises);

      // All 3 requests should succeed thanks to the singleflight retry execution
      assert.strictEqual(responses.length, 3);
      responses.forEach(r => {
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.payload.message, 'Recovered after retry');
      });

      // Exactly 2 attempts total (attempt 1 failed, retry attempt 2 succeeded for all 3 concurrent requests)
      assert.strictEqual(callAttempts, 2, 'Retry loop executed 2 attempts across all concurrent callers');
    } finally {
      externalApiService.simulateApiCall = originalSimulateApiCall;
    }
  });

});
