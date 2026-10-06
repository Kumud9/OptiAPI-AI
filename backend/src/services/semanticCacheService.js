'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { deleteKeysByPattern } = require('../utils/redisUtils');
const metricsService = require('./metricsService');
const {
  cosineSimilarity,
  createLocalEmbedding,
  generateEmbedding,
  DEFAULT_DIMENSIONS
} = require('./embeddingService');

const INDEX_NAME = 'idx:semantic_cache';
const KEY_PREFIX = 'apicache_semantic:';
const DEFAULT_SIMILARITY_THRESHOLD = 0.90;
const MAX_CANDIDATE_SCANS = 50;

/**
 * Ensures the RediSearch index exists for semantic cache if supported.
 * Fails safely if RediSearch is unavailable (e.g. standard Redis or MockRedis).
 *
 * @param {object} redisClient
 */
async function ensureIndex(redisClient) {
  if (!redisClient || typeof redisClient.ft?.create !== 'function') {
    return;
  }
  try {
    const indices = await redisClient.sendCommand(['FT._LIST']);
    if (indices && indices.includes(INDEX_NAME)) {
      return;
    }
  } catch (err) {
    if (!err.message?.includes('Unknown index name')) {
      logger.debug(`RediSearch FT._LIST check: ${err.message}`);
    }
  }

  try {
    await redisClient.ft.create(INDEX_NAME, {
      userId: { type: 'TAG' },
      provider: { type: 'TAG' },
      endpoint: { type: 'TAG' },
      model: { type: 'TAG' },
      method: { type: 'TAG' },
      systemPromptHash: { type: 'TAG' },
      paramsHash: { type: 'TAG' },
      vector: {
        type: 'VECTOR',
        ALGORITHM: 'FLAT',
        TYPE: 'FLOAT32',
        DIM: DEFAULT_DIMENSIONS,
        DISTANCE_METRIC: 'COSINE'
      }
    }, {
      ON: 'HASH',
      PREFIX: KEY_PREFIX
    });
    logger.info('RediSearch index for semantic cache created successfully.');
  } catch (err) {
    if (!err.message?.includes('Index already exists')) {
      logger.debug(`RediSearch create index note: ${err.message}`);
    }
  }
}

/**
 * Normalizes and extracts safe user prompt text from request body.
 * Supports OpenAI, Anthropic, Gemini, and generic JSON payload formats.
 *
 * @param {string} provider
 * @param {object} body
 * @returns {string}
 */
function extractPrompt(provider, body) {
  if (!body || typeof body !== 'object') return '';
  const prov = String(provider || '').toLowerCase();

  try {
    // OpenAI & Anthropic chat messages
    if ((prov === 'openai' || prov === 'anthropic') && Array.isArray(body.messages)) {
      const userMsgs = body.messages.filter(m => m && (m.role === 'user' || !m.role));
      if (userMsgs.length > 0) {
        const lastMsg = userMsgs[userMsgs.length - 1];
        if (typeof lastMsg.content === 'string') return lastMsg.content.trim();
        if (Array.isArray(lastMsg.content)) {
          return lastMsg.content
            .map(c => (typeof c === 'string' ? c : c?.text || ''))
            .filter(Boolean)
            .join(' ')
            .trim();
        }
      }
    }

    // Gemini contents array
    if (prov === 'gemini' && Array.isArray(body.contents)) {
      const userContents = body.contents.filter(c => c && (c.role === 'user' || !c.role));
      if (userContents.length > 0) {
        const lastContent = userContents[userContents.length - 1];
        if (Array.isArray(lastContent.parts)) {
          return lastContent.parts
            .map(p => (typeof p === 'string' ? p : p?.text || ''))
            .filter(Boolean)
            .join(' ')
            .trim();
        }
      }
    }

    // Generic prompt, input, or text fields
    if (typeof body.prompt === 'string') return body.prompt.trim();
    if (typeof body.input === 'string') return body.input.trim();
    if (typeof body.text === 'string') return body.text.trim();
  } catch (err) {
    logger.debug(`Prompt extraction ignored error: ${err.message}`);
  }

  return '';
}

/**
 * Extracts system prompt to ensure system instructions are strictly isolated.
 *
 * @param {string} provider
 * @param {object} body
 * @returns {string}
 */
function extractSystemPrompt(provider, body) {
  if (!body || typeof body !== 'object') return '';
  const prov = String(provider || '').toLowerCase();

  try {
    if (prov === 'openai' && Array.isArray(body.messages)) {
      const sysMsgs = body.messages.filter(m => m && m.role === 'system');
      return sysMsgs.map(m => m.content).filter(Boolean).join('\n').trim();
    }
    if (prov === 'anthropic' && body.system) {
      return String(body.system).trim();
    }
    if (prov === 'gemini' && body.system_instruction) {
      if (typeof body.system_instruction === 'string') return body.system_instruction.trim();
      return JSON.stringify(body.system_instruction);
    }
  } catch (err) {
    logger.debug(`System prompt extraction error: ${err.message}`);
  }

  return '';
}

/**
 * Hashes values deterministically for metadata comparison.
 */
function hashValue(val) {
  if (val === undefined || val === null) return 'none';
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Validates whether an HTTP request is eligible for semantic caching.
 */
function isRequestEligible(req, body) {
  if (req) {
    const method = String(req.method || 'POST').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      return false;
    }
    const headers = req.headers || {};
    const cacheControl = String(headers['cache-control'] || '').toLowerCase();
    if (cacheControl.includes('no-store') || cacheControl.includes('no-cache')) {
      return false;
    }
    if (headers['x-optiapi-cache-bypass'] === 'true') {
      return false;
    }
  }
  return true;
}

/**
 * Validates whether an upstream response is safe and cacheable.
 */
function isResponseCacheable(responseData) {
  if (!responseData || typeof responseData !== 'object') {
    return false;
  }
  // Reject error responses
  if (responseData.error || responseData.errors || responseData.code === 'PROVIDER_ERROR') {
    return false;
  }
  return true;
}

/**
 * Float32Array to Buffer for RediSearch.
 */
function float32Buffer(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}

/**
 * Searches the semantic cache for a matching vector representation.
 * Prioritizes RediSearch if available; falls back seamlessly to Redis vector store.
 *
 * @param {object} redisClient
 * @param {string} userId
 * @param {string} provider
 * @param {string} endpoint
 * @param {object} body
 * @param {number} [threshold=0.90]
 * @param {object} [options]
 * @returns {Promise<object|null>} Cached response or null
 */
async function searchSemanticCache(redisClient, userId, provider, endpoint, body, threshold = null, options = {}) {
  if (!redisClient || !userId || !provider || !endpoint) {
    return null;
  }

  const req = options.req || null;
  if (!isRequestEligible(req, body)) {
    return null;
  }

  const prompt = extractPrompt(provider, body);
  if (!prompt || prompt.length < 3) {
    return null; // Prompt too short for semantic comparison
  }

  const effectiveThreshold = (typeof threshold === 'number' && !isNaN(threshold) && threshold >= 0.50 && threshold <= 0.99)
    ? threshold
    : (parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD) || DEFAULT_SIMILARITY_THRESHOLD);

  const queryVector = await generateEmbedding(prompt, options);
  if (!queryVector) {
    return null; // Fail-open: embedding unavailable
  }

  const normEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  const rawEndpoint = endpoint.toLowerCase();
  const method = String(req?.method || options.method || 'POST').toUpperCase();
  const model = String(body?.model || options.model || 'unknown').toLowerCase();
  const systemPrompt = extractSystemPrompt(provider, body);
  const systemPromptHash = hashValue(systemPrompt);
  const params = {
    temperature: body?.temperature,
    top_p: body?.top_p,
    response_format: body?.response_format
  };
  const paramsHash = hashValue(params);

  // 1. Attempt RediSearch KNN search if available
  if (typeof redisClient.ft?.search === 'function') {
    try {
      const queryStr = `(@userId:{${userId}} @provider:{${provider.toLowerCase()}} @endpoint:{${normEndpoint}} @method:{${method}} @systemPromptHash:{${systemPromptHash}} @paramsHash:{${paramsHash}})=>[KNN 1 @vector $blob AS score]`;
      const results = await redisClient.ft.search(INDEX_NAME, queryStr, {
        PARAMS: {
          blob: float32Buffer(queryVector)
        },
        DIALECT: 2,
        RETURN: ['score', 'responseBody', 'userId', 'method', 'endpoint', 'model']
      });

      if (results && results.total > 0 && Array.isArray(results.documents) && results.documents.length > 0) {
        const doc = results.documents[0];
        const distance = parseFloat(doc.value.score);
        const similarity = 1 - distance;

        // Verify compatibility: strict user and method isolation
        if (doc.value.userId === userId.toString() &&
            doc.value.method === method &&
            similarity >= effectiveThreshold) {
          logger.info(`Semantic Cache HIT (RediSearch): similarity ${similarity.toFixed(3)} >= ${effectiveThreshold} for prompt [${prompt.substring(0, 40)}]`);
          return JSON.parse(doc.value.responseBody);
        }
      }
    } catch (err) {
      if (!err.message?.includes('no such index') && !err.message?.includes('unknown command')) {
        logger.debug(`RediSearch search failed (${err.message}). Falling back to Redis vector store.`);
      }
    }
  }

  // 2. Production Fallback Vector Store using standard Redis scanIterator & Cosine Similarity
  try {
    const scanPattern = `${KEY_PREFIX}${userId}:${provider.toLowerCase()}:${normEndpoint}:*`;
    const candidateKeys = [];

    if (typeof redisClient.scanIterator === 'function') {
      for await (const key of redisClient.scanIterator({ MATCH: scanPattern, COUNT: 25 })) {
        candidateKeys.push(key);
        if (candidateKeys.length >= MAX_CANDIDATE_SCANS) break;
      }
    } else if (typeof redisClient.scan === 'function') {
      let cursor = '0';
      do {
        const reply = await redisClient.scan(cursor, { MATCH: scanPattern, COUNT: 25 });
        cursor = typeof reply === 'object' && reply.cursor !== undefined ? String(reply.cursor) : String(reply[0]);
        const keys = typeof reply === 'object' && Array.isArray(reply.keys) ? reply.keys : reply[1];
        if (keys && keys.length > 0) candidateKeys.push(...keys);
        if (candidateKeys.length >= MAX_CANDIDATE_SCANS) break;
      } while (cursor !== '0');
    }

    if (candidateKeys.length === 0) {
      return null;
    }

    let bestSimilarity = -1;
    let bestResponse = null;
    const now = Date.now();

    for (const key of candidateKeys) {
      if (key.endsWith(':hash')) continue;
      const rawData = await redisClient.get(key);
      if (!rawData) continue;

      let record;
      try {
        record = JSON.parse(rawData);
      } catch (e) {
        continue;
      }

      // Check TTL / expiration
      if (record.expiresAt && record.expiresAt <= now) {
        continue;
      }

      // Strict Metadata Compatibility Check
      if (record.userId !== userId.toString()) continue; // User isolation
      if (record.method !== method) continue; // Method isolation
      if (record.endpoint !== normEndpoint && record.endpoint !== rawEndpoint) continue; // Endpoint isolation
      if (record.provider !== provider.toLowerCase()) continue; // Provider isolation
      if (record.metadata?.systemPromptHash !== systemPromptHash) continue; // System prompt isolation
      if (record.metadata?.paramsHash !== paramsHash) continue; // Parameters isolation

      // Model compatibility check (if model specified and differs from candidate)
      if (model !== 'unknown' && record.model && record.model !== 'unknown' && record.model !== model) {
        continue;
      }

      // Compute genuine cosine similarity between query and candidate embedding
      const sim = cosineSimilarity(queryVector, record.embedding);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestResponse = record.response;
      }
    }

    if (bestSimilarity >= effectiveThreshold && bestResponse) {
      logger.info(`Semantic Cache HIT (Vector Store): similarity ${bestSimilarity.toFixed(3)} >= ${effectiveThreshold} for prompt [${prompt.substring(0, 40)}]`);
      return bestResponse;
    }

    return null;
  } catch (err) {
    logger.warn(`Semantic cache lookup error: ${err.message}. Failing open.`);
    return null;
  }
}

/**
 * Saves a successful upstream response and prompt vector into the semantic cache.
 *
 * @param {object} redisClient
 * @param {string} userId
 * @param {string} provider
 * @param {string} endpoint
 * @param {object} body
 * @param {object} responseData
 * @param {number} [ttlSeconds=300]
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
async function saveSemanticCache(redisClient, userId, provider, endpoint, body, responseData, ttlSeconds = 300, options = {}) {
  if (!redisClient || !userId || !provider || !endpoint || !responseData) {
    return false;
  }

  const req = options.req || null;
  if (!isRequestEligible(req, body)) {
    return false;
  }

  if (!isResponseCacheable(responseData)) {
    return false;
  }

  const prompt = extractPrompt(provider, body);
  if (!prompt || prompt.length < 3) {
    return false;
  }

  const vector = await generateEmbedding(prompt, options);
  if (!vector) {
    logger.debug('Semantic cache save skipped: embedding generation failed');
    return false;
  }

  const normEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  const method = String(req?.method || options.method || 'POST').toUpperCase();
  const model = String(options.model || body?.model || 'unknown').toLowerCase();
  const systemPrompt = extractSystemPrompt(provider, body);
  const systemPromptHash = hashValue(systemPrompt);
  const params = {
    temperature: body?.temperature,
    top_p: body?.top_p,
    response_format: body?.response_format
  };
  const paramsHash = hashValue(params);

  const id = crypto.randomBytes(16).toString('hex');
  const key = `${KEY_PREFIX}${userId}:${provider.toLowerCase()}:${normEndpoint}:${id}`;
  const effectiveTTL = Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 300;
  const now = Date.now();

  const record = {
    id,
    embedding: vector,
    normalizedRequest: prompt,
    response: responseData,
    provider: provider.toLowerCase(),
    model,
    endpoint: normEndpoint,
    userId: userId.toString(),
    method,
    createdAt: now,
    expiresAt: now + (effectiveTTL * 1000),
    metadata: {
      systemPromptHash,
      paramsHash,
      model,
      temperature: body?.temperature,
      top_p: body?.top_p
    }
  };

  try {
    // 1. Store in standard Redis with TTL
    await redisClient.setEx(key, effectiveTTL, JSON.stringify(record));

    // 2. If RediSearch is active, also store HASH representation
    if (typeof redisClient.hSet === 'function' && typeof redisClient.ft?.search === 'function') {
      try {
        await redisClient.hSet(`${key}:hash`, {
          userId: userId.toString(),
          provider: provider.toLowerCase(),
          endpoint: normEndpoint,
          model: model.replace(/[^a-zA-Z0-9_]/g, '_'),
          method,
          systemPromptHash,
          paramsHash,
          vector: float32Buffer(vector),
          responseBody: JSON.stringify(responseData)
        });
        await redisClient.expire(`${key}:hash`, effectiveTTL);
      } catch (hashErr) {
        logger.debug(`RediSearch hash write note: ${hashErr.message}`);
      }
    }

    metricsService.recordSemanticCacheWrite();
    logger.debug(`Semantic cache entry saved: [${provider.toUpperCase()}] ${normEndpoint} (${effectiveTTL}s)`);
    return true;
  } catch (err) {
    logger.warn(`Failed to save semantic cache: ${err.message}`);
    return false;
  }
}

/**
 * Invalidates semantic cache entries using non-blocking SCAN.
 *
 * @param {object} redisClient
 * @param {object} filter
 * @param {string} filter.userId
 * @param {string} [filter.provider]
 * @param {string} [filter.endpoint]
 * @returns {Promise<number>}
 */
async function invalidateSemanticCache(redisClient, filter = {}) {
  if (!redisClient || !filter.userId) {
    return 0;
  }

  const userId = filter.userId.toString();
  let pattern = `${KEY_PREFIX}${userId}:*`;

  if (filter.provider) {
    const prov = filter.provider.toLowerCase();
    if (filter.endpoint) {
      const normEp = filter.endpoint.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      pattern = `${KEY_PREFIX}${userId}:${prov}:${normEp}:*`;
    } else {
      pattern = `${KEY_PREFIX}${userId}:${prov}:*`;
    }
  }

  try {
    const deletedCount = await deleteKeysByPattern(redisClient, pattern, { batchSize: 100 });
    logger.info(`Invalidated ${deletedCount} semantic cache records for pattern [${pattern}]`);
    return deletedCount;
  } catch (err) {
    logger.error(`Error invalidating semantic cache: ${err.message}`);
    return 0;
  }
}

module.exports = {
  ensureIndex,
  searchSemanticCache,
  saveSemanticCache,
  invalidateSemanticCache,
  extractPrompt,
  extractSystemPrompt,
  isRequestEligible,
  isResponseCacheable,
  getMockEmbedding: createLocalEmbedding, // backwards compatibility
  DEFAULT_SIMILARITY_THRESHOLD
};
