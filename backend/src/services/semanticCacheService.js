const logger = require('../utils/logger');
const crypto = require('crypto');

const INDEX_NAME = 'idx:semantic_cache';

/**
 * Ensures the RediSearch index exists for semantic cache.
 */
async function ensureIndex(redisClient) {
  if (!redisClient || typeof redisClient.ft?.create !== 'function') {
    return; // Mock redis or unsupported redis client
  }
  try {
    const indices = await redisClient.sendCommand(['FT._LIST']);
    if (indices && indices.includes(INDEX_NAME)) {
      return;
    }
  } catch (err) {
    if (!err.message.includes('Unknown index name')) {
      logger.warn(`Failed to check index list: ${err.message}`);
    }
  }

  try {
    await redisClient.ft.create(INDEX_NAME, {
      userId: { type: 'TAG' },
      provider: { type: 'TAG' },
      endpoint: { type: 'TAG' },
      model: { type: 'TAG' },
      systemPromptHash: { type: 'TAG' },
      paramsHash: { type: 'TAG' },
      vector: {
        type: 'VECTOR',
        ALGORITHM: 'FLAT',
        TYPE: 'FLOAT32',
        DIM: 256,
        DISTANCE_METRIC: 'COSINE'
      }
    }, {
      ON: 'HASH',
      PREFIX: 'apicache_semantic:'
    });
    logger.info('RediSearch index for semantic cache created successfully.');
  } catch (err) {
    if (!err.message.includes('Index already exists')) {
      logger.warn(`Failed to create semantic cache index: ${err.message}`);
    }
  }
}

/**
 * Extracts prompt text from the request body.
 */
function extractPrompt(provider, body) {
  if (!body) return '';
  try {
    if ((provider === 'openai' || provider === 'anthropic') && Array.isArray(body.messages)) {
      const msgs = body.messages.filter(m => m.role === 'user');
      if (msgs.length > 0) return msgs[msgs.length - 1].content || '';
    }
    if (provider === 'gemini' && Array.isArray(body.contents)) {
      const msgs = body.contents.filter(m => m.role === 'user' || !m.role);
      if (msgs.length > 0 && Array.isArray(msgs[msgs.length - 1].parts)) {
        return msgs[msgs.length - 1].parts.map(p => p.text).join(' ');
      }
    }
  } catch (err) {
    // Ignore extraction errors
  }
  return '';
}

/**
 * Extracts the system prompt from the request body for exact matching.
 */
function extractSystemPrompt(provider, body) {
  if (!body) return '';
  try {
    if (provider === 'openai' && Array.isArray(body.messages)) {
      const msgs = body.messages.filter(m => m.role === 'system');
      return msgs.map(m => m.content).join('\n');
    }
    if (provider === 'anthropic' && body.system) {
      return String(body.system);
    }
    if (provider === 'gemini' && body.system_instruction) {
      return JSON.stringify(body.system_instruction);
    }
  } catch (err) {
    // Ignore extraction errors
  }
  return '';
}

/**
 * Creates a deterministic 256-d mock embedding for local testing.
 * Uses character bi-gram frequencies normalized to length 1.
 */
function getMockEmbedding(text) {
  const vec = new Array(256).fill(0);
  if (!text) return vec;
  
  const str = text.toLowerCase();
  for (let i = 0; i < str.length - 1; i++) {
    const hash = (str.charCodeAt(i) * 31 + str.charCodeAt(i + 1)) % 256;
    vec[hash]++;
  }
  
  // Normalize
  let sumSq = 0;
  for (let i = 0; i < 256; i++) sumSq += vec[i] * vec[i];
  if (sumSq > 0) {
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < 256; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * Float32Array to Buffer for Redis.
 */
function float32Buffer(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}

/**
 * Hashes an object or string for exact matching.
 */
function hashValue(val) {
  if (val === undefined || val === null) return 'none';
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Searches the semantic cache.
 */
async function searchSemanticCache(redisClient, userId, provider, endpoint, body, threshold = 0.85) {
  if (!redisClient || typeof redisClient.ft?.search !== 'function') {
    return null;
  }

  const prompt = extractPrompt(provider, body);
  if (!prompt || prompt.length < 5) return null; // Too short to semantically cache

  const vector = getMockEmbedding(prompt);
  const systemPrompt = extractSystemPrompt(provider, body);
  
  const model = body?.model || 'unknown';
  const systemPromptHash = hashValue(systemPrompt);
  const params = {
    temperature: body?.temperature,
    top_p: body?.top_p,
    response_format: body?.response_format
  };
  const paramsHash = hashValue(params);

  // Normalize endpoint
  const normEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');

  try {
    const queryStr = `(@userId:{${userId}} @provider:{${provider}} @endpoint:{${normEndpoint}} @model:{${model.replace(/[^a-zA-Z0-9_]/g, '_')}} @systemPromptHash:{${systemPromptHash}} @paramsHash:{${paramsHash}})=>[KNN 1 @vector $blob AS score]`;
    
    const results = await redisClient.ft.search(INDEX_NAME, queryStr, {
      PARAMS: {
        blob: float32Buffer(vector)
      },
      DIALECT: 2,
      RETURN: ['score', 'responseBody']
    });

    if (results.total > 0) {
      // Redis vector similarity is distance, so score = distance.
      // Similarity = 1 - distance.
      const doc = results.documents[0];
      const distance = parseFloat(doc.value.score);
      const similarity = 1 - distance;

      logger.debug(`[DEBUG] Comparing:\nQuery: ${prompt}\nSimilarity: ${similarity}\nThreshold: ${threshold}`);

      if (similarity >= threshold) {
        logger.info(`Semantic Cache HIT: score ${similarity.toFixed(3)} (threshold ${threshold}) for query [${prompt}]`);
        return JSON.parse(doc.value.responseBody);
      }
    }
  } catch (err) {
    if (!err.message.includes('no such index')) {
      logger.error(`Semantic search error: ${err.message}`);
    }
  }

  return null;
}

/**
 * Saves to the semantic cache.
 */
async function saveSemanticCache(redisClient, userId, provider, endpoint, body, responseData, ttlSeconds) {
  if (!redisClient || typeof redisClient.ft?.search !== 'function') {
    return;
  }

  const prompt = extractPrompt(provider, body);
  if (!prompt || prompt.length < 5) return;

  const vector = getMockEmbedding(prompt);
  const systemPrompt = extractSystemPrompt(provider, body);
  
  const model = body?.model || 'unknown';
  const systemPromptHash = hashValue(systemPrompt);
  const params = {
    temperature: body?.temperature,
    top_p: body?.top_p,
    response_format: body?.response_format
  };
  const paramsHash = hashValue(params);

  const normEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');
  const id = crypto.randomBytes(16).toString('hex');
  const key = `apicache_semantic:${userId}:${provider}:${endpoint}:${id}`;

  try {
    // Create hash with vector using HSET
    await redisClient.hSet(key, {
      userId: userId.toString(),
      provider,
      endpoint: normEndpoint,
      model: model.replace(/[^a-zA-Z0-9_]/g, '_'),
      systemPromptHash,
      paramsHash,
      vector: float32Buffer(vector),
      responseBody: JSON.stringify(responseData)
    });
    
    // Set TTL
    if (ttlSeconds > 0) {
      await redisClient.expire(key, ttlSeconds);
    }
  } catch (err) {
    logger.error(`Failed to save semantic cache: ${err.message}`);
  }
}

module.exports = {
  ensureIndex,
  searchSemanticCache,
  saveSemanticCache,
  getMockEmbedding // exported for tests
};
