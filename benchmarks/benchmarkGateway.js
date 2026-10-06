'use strict';

const path = require('node:path');
module.paths.push(path.join(__dirname, '..', 'backend', 'node_modules'));

const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

// Set environment for benchmarking
process.env.NODE_ENV = 'production';
process.env.SEMANTIC_CACHE_ENABLED = 'true';
process.env.SEMANTIC_CACHE_THRESHOLD = '0.85';
process.env.JWT_SECRET = 'optiapi_benchmark_secret_key_jwt_2026';

const { getRedisClient } = require('../backend/src/config/redis');
const { getQueueChannel } = require('../backend/src/config/queue');
const metricsService = require('../backend/src/services/metricsService');
const externalApiService = require('../backend/src/services/externalApiService');
const circuitBreakerService = require('../backend/src/services/circuitBreakerService');
const { clearInFlight } = require('../backend/src/services/requestDeduplicationService');
const { setRoutingPolicy, deleteRoutingPolicy } = require('../backend/src/services/policyService');
const { setCachedRule } = require('../backend/src/services/cacheRuleService');


// Mock RequestLog.create to prevent MongoDB operations during benchmarks
try {
  const RequestLogModel = require('../backend/src/models/RequestLog');
  RequestLogModel.create = async (doc) => ({ _id: 'bench_log_id', ...doc });
} catch (_) {}

// Mock CacheRule.findOne
try {
  const CacheRuleModel = require('../backend/src/models/CacheRule');
  CacheRuleModel.findOne = () => ({
    lean: async () => null,
    then: (resolve) => resolve(null)
  });
} catch (_) {}

const app = express();
app.use(express.json());

const BENCHMARK_USER_ID = '507f1f77bcf86cd799439099';
const BENCHMARK_API_KEY = 'opti_bench_secret_key_123';
const UPSTREAM_PORT = 4010;

// Setup in-memory Redis auth key
async function seedBenchmarkData() {
  const redis = getRedisClient();
  const keyHash = crypto.createHash('sha256').update(BENCHMARK_API_KEY).digest('hex');
  await redis.set(`apikey:${keyHash}`, JSON.stringify({
    _id: 'mock_bench_key_id',
    userId: BENCHMARK_USER_ID,
    name: 'Benchmark API Key',
    rateLimitRps: 500, // High throughput for load testing
    isActive: true
  }));

  // Seed default 300s cache rule for /v1/chat/completions
  await setCachedRule(BENCHMARK_USER_ID, 'openai', '/v1/chat/completions', {
    enabled: true,
    ttlSeconds: 300
  });

  // Seed default AI routing policy
  await setRoutingPolicy(BENCHMARK_USER_ID, {
    strategy: 'cost_saving',
    provider: 'openai',
    model: 'gpt-4o',
    timeoutMs: 5000,
    maxRetries: 2,
    semanticCacheEnabled: true,
    semanticCacheThreshold: 0.85
  });
}

// Wire external API calls to Mock Upstream Server on port 4010
let mockUpstreamMode = 'normal';

externalApiService.simulateApiCall = async (provider, endpoint, method, body, headers, userId, inputProvider, options) => {
  const prov = (provider || 'openai').toLowerCase();
  const startTime = Date.now();

  if (mockUpstreamMode === 'always_500' && prov === 'openai') {
    const err = new Error('Mock Upstream 500 Internal Server Error');
    err.status = 500;
    err.statusCode = 500;
    throw err;
  }

  if (mockUpstreamMode === 'timeout' && prov === 'openai') {
    await new Promise((r) => setTimeout(r, (options?.timeoutMs || 5000) + 100));
    const err = new Error('Upstream provider timed out');
    err.name = 'TimeoutError';
    err.status = 504;
    throw err;
  }

  // Realistic mock response with fast transit (~15-20ms)
  await new Promise((r) => setTimeout(r, 15));

  if (prov === 'anthropic') {
    return {
      data: {
        id: `msg_bench_${Date.now()}`,
        role: 'assistant',
        model: 'claude-3-haiku',
        content: [{ type: 'text', text: 'Anthropic benchmark upstream response' }],
        usage: { input_tokens: 15, output_tokens: 25 }
      },
      model: 'claude-3-haiku',
      tokensUsed: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
      latency: Date.now() - startTime
    };
  }

  if (prov === 'gemini') {
    return {
      data: {
        candidates: [{
          content: { parts: [{ text: 'Gemini benchmark upstream response' }] }
        }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 }
      },
      model: 'gemini-1.5-flash',
      tokensUsed: { promptTokens: 12, completionTokens: 20, totalTokens: 32 },
      latency: Date.now() - startTime
    };
  }

  // Default OpenAI
  return {
    data: {
      id: `chatcmpl_bench_${Date.now()}`,
      choices: [{
        message: { role: 'assistant', content: 'OpenAI benchmark upstream response' }
      }],
      model: 'gpt-4o',
      usage: { prompt_tokens: 16, completion_tokens: 24, total_tokens: 40 }
    },
    model: 'gpt-4o',
    tokensUsed: { promptTokens: 16, completionTokens: 24, totalTokens: 40 },
    latency: Date.now() - startTime
  };
};

// Mount core routes
const gatewayRoutes = require('../backend/src/routes/gatewayRoutes');
const metricsRoutes = require('../backend/src/routes/metricsRoutes');
app.use('/api/v1/gateway', gatewayRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/v1/metrics', metricsRoutes);

// Benchmark management endpoints
app.post('/benchmark/reset', async (req, res) => {
  circuitBreakerService.resetAllCircuits();
  clearInFlight();
  metricsService.resetMetrics();
  mockUpstreamMode = 'normal';

  const redis = getRedisClient();
  if (redis.flushAll) {
    await redis.flushAll();
  }
  await seedBenchmarkData();

  res.json({ success: true, message: 'Benchmark state reset successfully' });
});

app.post('/benchmark/configure', (req, res) => {
  const { mode } = req.body;
  if (mode) mockUpstreamMode = mode;
  res.json({ success: true, mode: mockUpstreamMode });
});

app.get('/benchmark/stats', (req, res) => {
  const m = metricsService.getMetrics();
  const circuits = circuitBreakerService.getAllCircuitStates ? circuitBreakerService.getAllCircuitStates() : {};
  res.json({
    metrics: m,
    circuits
  });
});

let serverInstance = null;

async function startGateway(port = 5055) {
  await seedBenchmarkData();
  return new Promise((resolve) => {
    serverInstance = app.listen(port, '127.0.0.1', () => {
      resolve(serverInstance);
    });
  });
}

async function stopGateway() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => resolve());
    } else {
      resolve();
    }
  });
}

if (require.main === module) {
  startGateway(5055).then(() => {
    console.log('OptiAPI Benchmark Gateway running on http://127.0.0.1:5055');
  });
}

module.exports = {
  app,
  startGateway,
  stopGateway,
  seedBenchmarkData,
  BENCHMARK_API_KEY,
  BENCHMARK_USER_ID
};
