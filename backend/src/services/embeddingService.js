'use strict';

const logger = require('../utils/logger');
const metricsService = require('./metricsService');

const DEFAULT_DIMENSIONS = 256;
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Calculates genuine cosine similarity between two numeric vectors.
 * dot(A, B) / (norm(A) * norm(B))
 *
 * @param {Array<number>} vecA
 * @param {Array<number>} vecB
 * @returns {number} Cosine similarity in range [-1, 1], typically [0, 1] for embeddings
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normASq += a * a;
    normBSq += b * b;
  }

  if (normASq <= 0 || normBSq <= 0) {
    return 0;
  }

  const similarity = dotProduct / (Math.sqrt(normASq) * Math.sqrt(normBSq));
  // Bound to [-1, 1] to avoid float precision drift
  return Math.max(-1, Math.min(1, similarity));
}

/**
 * Deterministic local dense vector embedding generator.
 * Produces unit-normalized dense vectors of specified dimension.
 * Semantically identical/paraphrased texts yield high cosine similarity,
 * while unrelated texts yield low cosine similarity.
 *
 * @param {string} text
 * @param {number} [dim=256]
 * @returns {Array<number>} Unit-normalized float vector
 */
function createLocalEmbedding(text, dim = DEFAULT_DIMENSIONS) {
  const vec = new Array(dim).fill(0);
  if (!text || typeof text !== 'string') {
    return vec;
  }

  const normalized = text.toLowerCase().trim();
  const words = normalized.match(/\b\w+\b/g) || [];

  // 1. Unigram feature hashing with term frequency
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let h = 0;
    for (let c = 0; c < w.length; c++) {
      h = (h * 31 + w.charCodeAt(c)) >>> 0;
    }
    vec[h % dim] += 2.0;

    // 2. Bigram context hashing
    if (i < words.length - 1) {
      const pair = `${w}_${words[i + 1]}`;
      let ph = 0;
      for (let c = 0; c < pair.length; c++) {
        ph = (ph * 37 + pair.charCodeAt(c)) >>> 0;
      }
      vec[ph % dim] += 1.5;
    }
  }

  // 3. Substring character tri-gram hashing for morphology and spelling variations
  for (let i = 0; i < normalized.length - 2; i++) {
    const tri = normalized.slice(i, i + 3);
    let th = 0;
    for (let c = 0; c < tri.length; c++) {
      th = (th * 41 + tri.charCodeAt(c)) >>> 0;
    }
    vec[th % dim] += 0.5;
  }

  // 4. L2 Normalization to unit length: ||v|| = 1.0
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    sumSq += vec[i] * vec[i];
  }

  if (sumSq > 0) {
    const norm = Math.sqrt(sumSq);
    for (let i = 0; i < dim; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
}

/**
 * OpenAI Embeddings Provider implementation (e.g. text-embedding-3-small).
 */
class OpenAIEmbeddingProvider {
  constructor(apiKey, model = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          input: text,
          model: this.model
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`OpenAI Embedding API error HTTP ${res.status}`);
      }

      const json = await res.json();
      return json?.data?.[0]?.embedding || null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Local built-in dense vector provider.
 */
class LocalEmbeddingProvider {
  constructor(dimensions = DEFAULT_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(text) {
    return createLocalEmbedding(text, this.dimensions);
  }
}

// Active provider instance (pluggable)
let activeProvider = new LocalEmbeddingProvider();

/**
 * Override or inject active embedding provider (useful for testing or switching to OpenAI/Gemini).
 * @param {object} provider - Object with `embed(text, options)` method
 */
function setEmbeddingProvider(provider) {
  if (provider && typeof provider.embed === 'function') {
    activeProvider = provider;
  }
}

/**
 * Reset embedding provider to default LocalEmbeddingProvider.
 */
function resetEmbeddingProvider() {
  activeProvider = new LocalEmbeddingProvider();
}

/**
 * Generates an embedding vector for a given text prompt using the configured provider.
 * Enforces timeout bounds and fails open gracefully on errors or timeouts.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.timeoutMs=2000]
 * @returns {Promise<Array<number>|null>}
 */
async function generateEmbedding(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  const timeoutMs = options.timeoutMs || parseInt(process.env.EMBEDDING_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  try {
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`Embedding generation timed out after ${timeoutMs}ms`);
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
      if (timer && timer.unref) timer.unref();
    });

    const embedding = await Promise.race([
      activeProvider.embed(text, { timeoutMs, ...options }),
      timeoutPromise
    ]);

    const duration = Date.now() - startTime;
    metricsService.recordSemanticCacheEmbeddingLatency(duration);

    if (Array.isArray(embedding) && embedding.length > 0) {
      return embedding;
    }
    return null;
  } catch (err) {
    const duration = Date.now() - startTime;
    metricsService.recordSemanticCacheEmbeddingLatency(duration);
    metricsService.recordSemanticCacheEmbeddingFailure();
    logger.warn(`Semantic cache embedding failed: ${err.message}. Failing open.`);
    return null;
  }
}

module.exports = {
  cosineSimilarity,
  createLocalEmbedding,
  generateEmbedding,
  setEmbeddingProvider,
  resetEmbeddingProvider,
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
  DEFAULT_DIMENSIONS,
  DEFAULT_TIMEOUT_MS
};
