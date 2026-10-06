'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getRedisClient } = require('../config/redis');
const metricsService = require('../services/metricsService');
const externalApiService = require('../services/externalApiService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const { gatewayCache } = require('../middleware/cache');
const RequestLog = require('../models/RequestLog');
const CacheRule = require('../models/CacheRule');
const { setCachedRule } = require('../services/cacheRuleService');
const { clearInFlight } = require('../services/requestDeduplicationService');
const {
  setRoutingPolicy,
  deleteRoutingPolicy,
  getRoutingPolicy,
  validateAiPolicy,
  validatePolicy
} = require('../services/policyService');
const {
  searchSemanticCache,
  saveSemanticCache,
  invalidateSemanticCache,
  extractPrompt,
  extractSystemPrompt
} = require('../services/semanticCacheService');
const {
  cosineSimilarity,
  createLocalEmbedding,
  generateEmbedding,
  setEmbeddingProvider,
  resetEmbeddingProvider
} = require('../services/embeddingService');
const { clearUserCache, deleteCacheRule } = require('../controllers/cacheController');

test('Phase 6: Real Semantic Cache & Cache Intelligence Suite', async (t) => {
  const userA = '507f1f77bcf86cd799439011';
  const userB = '507f1f77bcf86cd799439022';
  const defaultProvider = 'openai';
  const defaultEndpoint = '/v1/chat/completions';

  const redis = getRedisClient();

  // Mock RequestLog.create to prevent MongoDB operations
  const originalRequestLogCreate = RequestLog.create;
  RequestLog.create = async () => ({ _id: 'mock_log_id' });

  // Mock CacheRule.findOne to return chainable object with .lean()
  const cacheRuleStore = new Map();
  const originalRuleFindOne = CacheRule.findOne;
  CacheRule.findOne = (query) => {
    const normEp = (query.endpoint || '').toLowerCase();
    const key = `${query.userId}:${query.provider}:${normEp}`;
    const result = cacheRuleStore.get(key) || null;
    return {
      lean: async () => result,
      then: (resolve) => resolve(result)
    };
  };

  const registerRule = async (userId, provider, endpoint, ttlSeconds = 600) => {
    const normEp = endpoint.toLowerCase();
    const rule = {
      userId,
      provider: provider.toLowerCase(),
      endpoint: normEp,
      ttlSeconds,
      isActive: true
    };
    cacheRuleStore.set(`${userId}:${provider.toLowerCase()}:${normEp}`, rule);
    await setCachedRule(userId, provider, normEp, rule);
  };

  t.beforeEach(async () => {
    if (redis.store) redis.store.clear();
    cacheRuleStore.clear();
    clearInFlight();
    metricsService.resetMetrics();
    resetEmbeddingProvider();
    process.env.SEMANTIC_CACHE_ENABLED = 'true';
    delete process.env.SEMANTIC_CACHE_THRESHOLD;

    try {
      await deleteRoutingPolicy(userA);
      await deleteRoutingPolicy(userB);
    } catch (_) {}
  });

  t.afterEach(async () => {
    if (redis.store) redis.store.clear();
    cacheRuleStore.clear();
    clearInFlight();
    metricsService.resetMetrics();
    resetEmbeddingProvider();
    process.env.SEMANTIC_CACHE_ENABLED = 'true';
    delete process.env.SEMANTIC_CACHE_THRESHOLD;

    try {
      await deleteRoutingPolicy(userA);
      await deleteRoutingPolicy(userB);
    } catch (_) {}
  });

  t.after(() => {
    RequestLog.create = originalRequestLogCreate;
    CacheRule.findOne = originalRuleFindOne;
  });

  // Helper to run request through cache middleware then gateway controller
  const executePipeline = async (req) => {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        getHeader(k) { return this.headers[k.toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
        json(payload) {
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            payload
          });
        }
      };

      gatewayCache(req, res, () => {
        handleGatewayRequest(req, res);
      });
    });
  };

  await t.test('1. Cosine similarity calculates exact dot-product normalization', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];
    const vecD = [0.7071, 0.7071, 0];

    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecB) * 1000) / 1000, 1);
    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecC) * 1000) / 1000, 0);
    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecD) * 1000) / 1000, 0.707);
    assert.strictEqual(cosineSimilarity([], []), 0);
    assert.strictEqual(cosineSimilarity([1, 2], [1]), 0);
  });

  await t.test('2. Local embedding generates high similarity for paraphrases and low for distinct topics', async () => {
    const prompt1 = 'What is the capital of France?';
    const prompt2 = 'What is the capital city of France?';
    const prompt3 = 'Explain quantum computing in detail.';

    const emb1 = await generateEmbedding(prompt1);
    const emb2 = await generateEmbedding(prompt2);
    const emb3 = await generateEmbedding(prompt3);

    assert.ok(Array.isArray(emb1) && emb1.length === 256);
    assert.ok(Array.isArray(emb2) && emb2.length === 256);
    assert.ok(Array.isArray(emb3) && emb3.length === 256);

    const simClose = cosineSimilarity(emb1, emb2);
    const simFar = cosineSimilarity(emb1, emb3);

    assert.ok(simClose > 0.85, `Paraphrase similarity must be > 0.85, got ${simClose}`);
    assert.ok(simFar < 0.40, `Unrelated topic similarity must be < 0.40, got ${simFar}`);
  });

  await t.test('3. Exact Cache Checked Before Semantic Cache (L1 before L2)', async () => {
    await registerRule(userA, 'openai', '/v1/chat/completions', 600);

    let upstreamCalls = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      upstreamCalls++;
      return {
        data: { id: 'resp_1', choices: [{ message: { content: 'Paris' } }] },
        tokensUsed: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        model: 'gpt-4o'
      };
    };

    try {
      const req = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        headers: {}
      };

      // Request 1: Cold cache -> Upstream call, writes L1 exact and L2 semantic
      const res1 = await executePipeline(req);
      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(res1.headers['x-optiapi-cache'], 'MISS');
      assert.strictEqual(upstreamCalls, 1);

      // Request 2: Identical request -> L1 Exact Cache HIT
      const res2 = await executePipeline(req);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.headers['x-optiapi-cache'], 'HIT');
      assert.strictEqual(upstreamCalls, 1, 'Upstream should not be called on exact cache hit');

      const metrics = metricsService.getMetrics();
      assert.strictEqual(metrics.cacheHits, 1);
      assert.strictEqual(metrics.semanticCacheHits, 0, 'Exact hit should not increment semantic hits');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('4. Semantic Cache Hit avoids upstream when query is semantically similar', async () => {
    await registerRule(userA, 'openai', '/v1/chat/completions', 600);

    let upstreamCalls = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      upstreamCalls++;
      return {
        data: { id: 'resp_sem', choices: [{ message: { content: 'Paris is the capital of France.' } }] },
        tokensUsed: { promptTokens: 6, completionTokens: 8, totalTokens: 14 },
        model: 'gpt-4o'
      };
    };

    try {
      // Prime cache with Question A
      const req1 = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        headers: {}
      };

      const res1 = await executePipeline(req1);
      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(res1.headers['x-optiapi-cache'], 'MISS');
      assert.strictEqual(upstreamCalls, 1);

      // Query B: Semantically identical/paraphrased question -> Should produce L2 SEMANTIC_HIT
      process.env.SEMANTIC_CACHE_THRESHOLD = '0.85';
      const req2 = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is the capital city of France?' }] },
        headers: {}
      };

      const res2 = await executePipeline(req2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.headers['x-optiapi-cache'], 'SEMANTIC_HIT');
      assert.strictEqual(upstreamCalls, 1, 'Upstream should NOT be called on semantic cache hit');
      assert.strictEqual(res2.payload.id, 'resp_sem');

      const metrics = metricsService.getMetrics();
      assert.strictEqual(metrics.cacheHits, 1);
      assert.strictEqual(metrics.semanticCacheHits, 1);
      assert.strictEqual(metrics.semanticCacheWrites, 1);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('5. Similarity threshold behavior: Below threshold misses and calls upstream', async () => {
    await registerRule(userA, 'openai', '/v1/chat/completions', 600);

    let upstreamCalls = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      upstreamCalls++;
      return {
        data: { id: `resp_${upstreamCalls}`, choices: [{ message: { content: 'Answer' } }] },
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        model: 'gpt-4o'
      };
    };

    try {
      // Prime cache with Question A
      const req1 = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        headers: {}
      };
      await executePipeline(req1);
      assert.strictEqual(upstreamCalls, 1);

      // Question C: completely different topic -> Similarity far below default 0.90 threshold
      const req2 = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Explain quantum computing in detail.' }] },
        headers: {}
      };
      const res2 = await executePipeline(req2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.headers['x-optiapi-cache'], 'MISS');
      assert.strictEqual(upstreamCalls, 2, 'Unrelated topic must reach upstream');

      const metrics = metricsService.getMetrics();
      assert.ok(metrics.semanticCacheMisses >= 1);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('6. User Isolation: User A cannot receive User B cached response', async () => {
    await registerRule(userA, 'openai', '/v1/chat/completions', 600);
    await registerRule(userB, 'openai', '/v1/chat/completions', 600);

    let currentServingUser = null;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      return {
        data: { secretForUser: currentServingUser },
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        model: 'gpt-4o'
      };
    };

    try {
      // User A populates cache
      currentServingUser = userA;
      const reqA = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        headers: {}
      };
      const resA = await executePipeline(reqA);
      assert.strictEqual(resA.payload.secretForUser, userA);

      // User B makes identical query
      currentServingUser = userB;
      const reqB = {
        userId: userB,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        headers: {}
      };
      const resB = await executePipeline(reqB);

      // User B must get User B's fresh response, NOT User A's cached response!
      assert.strictEqual(resB.headers['x-optiapi-cache'], 'MISS');
      assert.strictEqual(resB.payload.secretForUser, userB, 'User B must not receive User A data');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });

  await t.test('7. Endpoint and Method Isolation in Semantic Cache', async () => {
    const cachedData = { message: 'cached endpoint payload' };
    const body = { prompt: 'Translate this sentence into Spanish' };

    // Save semantic entry for endpoint /v1/chat/completions, method POST
    await saveSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, cachedData, 300, {
      method: 'POST'
    });

    // 1. Same user and body, but different endpoint -> should return null
    const diffEndpointResult = await searchSemanticCache(redis, userA, 'openai', '/v1/translations', body, 0.80, {
      method: 'POST'
    });
    assert.strictEqual(diffEndpointResult, null, 'Different endpoint must not match semantic cache');

    // 2. Same user, body, and endpoint, but method GET -> should return null
    const diffMethodResult = await searchSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, 0.80, {
      method: 'GET'
    });
    assert.strictEqual(diffMethodResult, null, 'Different HTTP method must not match semantic cache');

    // 3. Same parameters -> should match
    const matchResult = await searchSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, 0.80, {
      method: 'POST'
    });
    assert.deepStrictEqual(matchResult, cachedData, 'Exact parameters must match');
  });

  await t.test('8. Provider and Model Compatibility Isolation', async () => {
    const cachedData = { model: 'gpt-4o', text: 'result' };
    const body = { model: 'gpt-4o', prompt: 'Summarize the document' };

    await saveSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, cachedData, 300, {
      model: 'gpt-4o'
    });

    // Request with different model 'gpt-3.5-turbo' should not cross-match
    const diffModelBody = { model: 'gpt-3.5-turbo', prompt: 'Summarize the document' };
    const diffModelResult = await searchSemanticCache(redis, userA, 'openai', '/v1/chat/completions', diffModelBody, 0.80, {
      model: 'gpt-3.5-turbo'
    });
    assert.strictEqual(diffModelResult, null, 'Incompatible model must not return cached response');

    // Request with different provider 'gemini' should not cross-match
    const diffProvResult = await searchSemanticCache(redis, userA, 'gemini', '/v1/chat/completions', body, 0.80, {
      model: 'gpt-4o'
    });
    assert.strictEqual(diffProvResult, null, 'Different provider must not match');
  });

  await t.test('9. Expired Semantic Entry is safely ignored (TTL expiration)', async () => {
    const body = { prompt: 'Temporary cached data' };
    const cachedData = { result: 'old data' };

    // Save with 1 second TTL
    await saveSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, cachedData, 1);

    // Immediate lookup -> matches
    const immediate = await searchSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, 0.80);
    assert.deepStrictEqual(immediate, cachedData);

    // Wait 1.1s for expiration
    await new Promise(r => setTimeout(r, 1100));

    // Post-expiration lookup -> null
    const postExpiry = await searchSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body, 0.80);
    assert.strictEqual(postExpiry, null, 'Expired semantic record must be ignored');
  });

  await t.test('10. Embedding Provider Failure fails open to upstream without breaking user request', async () => {
    await registerRule(userA, 'openai', '/v1/chat/completions', 600);

    // Inject a failing embedding provider
    setEmbeddingProvider({
      embed: async () => {
        throw new Error('External Embedding Provider 503 Service Unavailable');
      }
    });

    let upstreamCalls = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      upstreamCalls++;
      return {
        data: { text: 'Upstream successfully answered' },
        tokensUsed: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        model: 'gpt-4o'
      };
    };

    try {
      const req = {
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Will this fail?' }] },
        headers: {}
      };

      const res = await executePipeline(req);
      assert.strictEqual(res.statusCode, 200, 'Request must succeed despite embedding failure');
      assert.strictEqual(upstreamCalls, 1);
      assert.strictEqual(res.payload.text, 'Upstream successfully answered');

      const metrics = metricsService.getMetrics();
      assert.ok(metrics.semanticCacheEmbeddingFailures >= 1, 'Should record embedding failure metric');
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
      resetEmbeddingProvider();
    }
  });

  await t.test('11. Embedding Timeout fails open gracefully', async () => {
    // Inject a provider that hangs
    setEmbeddingProvider({
      embed: async () => {
        return new Promise((resolve) => setTimeout(resolve, 5000));
      }
    });

    const startTime = Date.now();
    const result = await generateEmbedding('Testing timeout', { timeoutMs: 50 });
    const duration = Date.now() - startTime;

    assert.strictEqual(result, null, 'Timed out embedding must return null');
    assert.ok(duration < 500, `Timeout should abort quickly, took ${duration}ms`);

    const metrics = metricsService.getMetrics();
    assert.ok(metrics.semanticCacheEmbeddingFailures >= 1);
  });

  await t.test('12. Semantic Cache Invalidation: by user, provider, and endpoint via SCAN', async () => {
    const body1 = { prompt: 'User A prompt one' };
    const body2 = { prompt: 'User A prompt two' };
    const bodyOther = { prompt: 'User B prompt' };

    await saveSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body1, { data: 1 }, 300);
    await saveSemanticCache(redis, userA, 'gemini', '/v1/models/gemini-1.5-pro:generateContent', body2, { data: 2 }, 300);
    await saveSemanticCache(redis, userB, 'openai', '/v1/chat/completions', bodyOther, { data: 3 }, 300);

    // Invalidate userA openai cache only
    const deletedCount = await invalidateSemanticCache(redis, { userId: userA, provider: 'openai' });
    assert.ok(deletedCount >= 1);

    // userA openai cache should now be gone
    const lookup1 = await searchSemanticCache(redis, userA, 'openai', '/v1/chat/completions', body1, 0.80);
    assert.strictEqual(lookup1, null, 'Deleted provider cache must return null');

    // userA gemini cache still present
    const lookup2 = await searchSemanticCache(redis, userA, 'gemini', '/v1/models/gemini-1.5-pro:generateContent', body2, 0.80);
    assert.deepStrictEqual(lookup2, { data: 2 }, 'Other provider cache must remain');

    // userB cache still present
    const lookup3 = await searchSemanticCache(redis, userB, 'openai', '/v1/chat/completions', bodyOther, 0.80);
    assert.deepStrictEqual(lookup3, { data: 3 }, 'Other user cache must remain');

    // Invalidate entire userA cache
    await invalidateSemanticCache(redis, { userId: userA });
    const lookup4 = await searchSemanticCache(redis, userA, 'gemini', '/v1/models/gemini-1.5-pro:generateContent', body2, 0.80);
    assert.strictEqual(lookup4, null, 'User cache must be fully purged');
  });

  await t.test('13. clearUserCache Controller integration clears both exact and semantic cache via SCAN', async () => {
    // Seed exact and semantic keys
    await redis.set(`apicache:${userA}:openai:req1`, JSON.stringify({ a: 1 }));
    await redis.set(`apicache_semantic:${userA}:openai:norm:id1`, JSON.stringify({ b: 2 }));
    await redis.set(`apicache:${userB}:openai:req2`, JSON.stringify({ c: 3 }));

    let status = null;
    let jsonResp = null;
    const res = {
      status(code) { status = code; return this; },
      json(d) { jsonResp = d; return this; }
    };

    await clearUserCache({ user: { _id: userA } }, res);

    assert.strictEqual(status, 200);
    assert.strictEqual(jsonResp.success, true);
    assert.strictEqual(jsonResp.message, 'Successfully cleared 2 cache records.');

    // User A keys are gone
    const k1 = await redis.get(`apicache:${userA}:openai:req1`);
    const k2 = await redis.get(`apicache_semantic:${userA}:openai:norm:id1`);
    assert.strictEqual(k1, null);
    assert.strictEqual(k2, null);

    // User B key remains untouched
    const kB = await redis.get(`apicache:${userB}:openai:req2`);
    assert.notStrictEqual(kB, null);
  });

  await t.test('14. Policy-Controlled Semantic Caching: AI policy configures threshold and enable/disable', async () => {
    // Set custom policy with semanticCacheThreshold 0.95 and semanticCacheEnabled true
    await setRoutingPolicy(userA, {
      provider: 'openai',
      model: 'gpt-4o',
      cacheEnabled: true,
      semanticCacheEnabled: true,
      semanticCacheThreshold: 0.95,
      cacheTTL: 600
    });

    const activePolicy = await getRoutingPolicy(userA);
    assert.strictEqual(activePolicy.semanticCacheEnabled, true);
    assert.strictEqual(activePolicy.semanticCacheThreshold, 0.95);

    // Disable semantic cache via policy
    await setRoutingPolicy(userA, {
      ...activePolicy,
      semanticCacheEnabled: false
    });

    const disabledPolicy = await getRoutingPolicy(userA);
    assert.strictEqual(disabledPolicy.semanticCacheEnabled, false);
  });

  await t.test('15. Malformed AI semantic cache settings are rejected by validateAiPolicy', () => {
    const validBase = {
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'balanced',
      cacheEnabled: true,
      semanticCacheEnabled: true,
      semanticCacheThreshold: 0.90,
      timeoutMs: 10000,
      maxRetries: 2
    };

    // Valid policy passes
    const validated = validateAiPolicy(validBase);
    assert.ok(validated);
    assert.strictEqual(validated.semanticCacheThreshold, 0.90);
    assert.strictEqual(validated.semanticCacheEnabled, true);

    // Invalid threshold > 0.99 must be rejected
    const invalidHigh = validateAiPolicy({ ...validBase, semanticCacheThreshold: 1.50 });
    assert.strictEqual(invalidHigh, null);

    // Invalid threshold < 0.50 must be rejected
    const invalidLow = validateAiPolicy({ ...validBase, semanticCacheThreshold: 0.30 });
    assert.strictEqual(invalidLow, null);

    // NaN threshold must be rejected
    const invalidNaN = validateAiPolicy({ ...validBase, semanticCacheThreshold: 'super-strict' });
    assert.strictEqual(invalidNaN, null);
  });

  await t.test('16. Non-cacheable responses (errors) are never saved to semantic cache', async () => {
    const errorResponse = { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } };
    const saved = await saveSemanticCache(
      redis,
      userA,
      'openai',
      '/v1/chat/completions',
      { prompt: 'Tell me a joke' },
      errorResponse,
      300
    );

    assert.strictEqual(saved, false, 'Error response must not be written to semantic cache');
  });

  await t.test('17. Metrics observability tracks all semantic cache operations', async () => {
    metricsService.resetMetrics();

    metricsService.recordSemanticCacheHit();
    metricsService.recordSemanticCacheMiss();
    metricsService.recordSemanticCacheWrite();
    metricsService.recordSemanticCacheEmbeddingFailure();
    metricsService.recordSemanticCacheLookupLatency(12);
    metricsService.recordSemanticCacheEmbeddingLatency(45);

    const m = metricsService.getMetrics();
    assert.strictEqual(m.semanticCacheHits, 1);
    assert.strictEqual(m.semanticCacheMisses, 1);
    assert.strictEqual(m.semanticCacheWrites, 1);
    assert.strictEqual(m.semanticCacheEmbeddingFailures, 1);
    assert.strictEqual(m.semanticCacheLookupLatency, 12);
    assert.strictEqual(m.semanticCacheEmbeddingLatency, 45);
    assert.strictEqual(m.cache.semanticHits, 1);
    assert.strictEqual(m.cache.semanticMisses, 1);
  });

  await t.test('18. Concurrent identical requests still work with deduplication and populate cache', async () => {
    await registerRule(userA, 'openai', '/v1/chat/completions', 600);

    let upstreamCount = 0;
    const originalSimulate = externalApiService.simulateApiCall;
    externalApiService.simulateApiCall = async () => {
      upstreamCount++;
      await new Promise(r => setTimeout(r, 50)); // simulate upstream latency
      return {
        data: { text: 'deduped result' },
        tokensUsed: { promptTokens: 4, completionTokens: 4, totalTokens: 8 },
        model: 'gpt-4o'
      };
    };

    try {
      const makeReq = () => ({
        userId: userA,
        method: 'POST',
        params: { provider: 'openai', 0: '/v1/chat/completions' },
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Concurrent singleflight question' }] },
        headers: {}
      });

      // Fire 5 concurrent identical requests simultaneously
      const results = await Promise.all([
        executePipeline(makeReq()),
        executePipeline(makeReq()),
        executePipeline(makeReq()),
        executePipeline(makeReq()),
        executePipeline(makeReq())
      ]);

      // All 5 must succeed with 200
      for (const res of results) {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.payload.text, 'deduped result');
      }

      // Exactly 1 upstream call made thanks to request deduplication
      assert.strictEqual(upstreamCount, 1);

      // Subsequent 6th request should hit L1 exact cache
      const res6 = await executePipeline(makeReq());
      assert.strictEqual(res6.statusCode, 200);
      assert.strictEqual(res6.headers['x-optiapi-cache'], 'HIT');
      assert.strictEqual(upstreamCount, 1);
    } finally {
      externalApiService.simulateApiCall = originalSimulate;
    }
  });
});
