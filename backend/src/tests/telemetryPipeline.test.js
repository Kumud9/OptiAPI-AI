'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getQueueChannel } = require('../config/queue');
const {
  TELEMETRY_EXCHANGE,
  TELEMETRY_QUEUE,
  TELEMETRY_ROUTING_KEY,
  TELEMETRY_DLX,
  TELEMETRY_DLQ,
  TELEMETRY_DEAD_ROUTING_KEY,
  MAX_RETRIES,
  setupTelemetryTopology,
  sanitizeTelemetryPayload,
  publishTelemetryEvent
} = require('../services/telemetryService');
const {
  initTelemetryWorker,
  processTelemetryMessage,
  isValidTelemetryPayload,
  resetWorkerState
} = require('../services/telemetryWorker');
const metricsService = require('../services/metricsService');
const externalApiService = require('../services/externalApiService');
const { handleGatewayRequest } = require('../controllers/gatewayController');
const RequestLog = require('../models/RequestLog');

test('Phase 4: Async Telemetry Pipeline Suite', async (t) => {
  const testUserId = '507f1f77bcf86cd799439088';
  const testApiKey = 'opti_telemetry_test_key_abc';

  let loggedEntries = [];
  const originalCreate = RequestLog.create;

  const originalSimulate = externalApiService.simulateApiCall;
  const mockFastSimulate = async () => ({
    data: { id: 'mock_chat_1', choices: [{ message: { content: 'telemetry test' } }] },
    model: 'gpt-4o',
    tokensUsed: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
  });

  t.beforeEach(async () => {
    metricsService.resetMetrics();
    loggedEntries = [];
    resetWorkerState();
    const channel = getQueueChannel();
    if (typeof channel.reset === 'function') {
      channel.reset();
    }
    await setupTelemetryTopology();
    externalApiService.simulateApiCall = mockFastSimulate;

    RequestLog.create = async (doc) => {
      loggedEntries.push(doc);
      return { _id: 'mock_log_id', ...doc };
    };
  });

  t.afterEach(() => {
    externalApiService.simulateApiCall = originalSimulate;
    RequestLog.create = originalCreate;
    resetWorkerState();
  });

  // Mock Express response helper
  const createMockRes = () => {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, val) { this.headers[name] = val; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
  };

  await t.test('1. Normal gateway request publishes telemetry event to RabbitMQ', async () => {
    const channel = getQueueChannel();
    let publishedMsg = null;

    const originalPublish = channel.publish.bind(channel);
    channel.publish = async (exchange, routingKey, buffer, options) => {
      if (exchange === TELEMETRY_EXCHANGE) {
        publishedMsg = {
          exchange,
          routingKey,
          content: JSON.parse(buffer.toString()),
          options
        };
      }
      return originalPublish(exchange, routingKey, buffer, options);
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] },
        headers: { authorization: 'Bearer secret_token' },
        userId: testUserId,
        query: {}
      };

      const res = createMockRes();
      await handleGatewayRequest(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.ok(publishedMsg, 'Telemetry message must be published to RabbitMQ');
      assert.strictEqual(publishedMsg.exchange, TELEMETRY_EXCHANGE);
      assert.strictEqual(publishedMsg.routingKey, TELEMETRY_ROUTING_KEY);
      assert.strictEqual(publishedMsg.content.provider, 'openai');
      assert.strictEqual(publishedMsg.content.statusCode, 200);
      assert.strictEqual(publishedMsg.content.tokensUsed.totalTokens, 30);
      assert.strictEqual(publishedMsg.options.persistent, true);
    } finally {
      channel.publish = originalPublish;
    }
  });

  await t.test('2. Gateway does not wait for MongoDB telemetry persistence', async () => {
    // Simulate a slow MongoDB operation (e.g. 80ms delay)
    let mongoCallStarted = false;
    let mongoCallCompleted = false;

    RequestLog.create = async (doc) => {
      mongoCallStarted = true;
      await new Promise(r => setTimeout(r, 80));
      mongoCallCompleted = true;
      loggedEntries.push(doc);
      return doc;
    };

    await initTelemetryWorker();

    const req = {
      params: { provider: 'openai', '0': '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-4o' },
      headers: {},
      userId: testUserId,
      query: {}
    };

    const res = createMockRes();
    const start = Date.now();
    await handleGatewayRequest(req, res);
    const duration = Date.now() - start;

    assert.strictEqual(res.statusCode, 200);
    // Gateway must return fast without waiting for 80ms MongoDB write
    assert.ok(duration < 70, `Gateway took ${duration}ms, should not block on MongoDB persistence`);
    assert.strictEqual(mongoCallCompleted, false, 'MongoDB persistence should not be finished when gateway returns');

    // Await async worker completion with deadline polling
    const deadline = Date.now() + 1500;
    while (!mongoCallCompleted && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.strictEqual(mongoCallCompleted, true);
  });

  await t.test('3. Telemetry worker consumes event and persists to MongoDB RequestLog', async () => {
    await initTelemetryWorker();

    const testEvent = {
      userId: testUserId,
      apiKeyId: 'key_123',
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      endpoint: '/v1/models/gemini-1.5-flash:generateContent',
      method: 'POST',
      statusCode: 200,
      latencyMs: 145,
      costUsd: 0.00015,
      tokensUsed: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
      cacheStatus: 'MISS',
      timestamp: new Date().toISOString()
    };

    await publishTelemetryEvent(testEvent);

    // Wait for consumer with deadline polling
    const deadline = Date.now() + 1500;
    while (loggedEntries.length === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
    }

    assert.strictEqual(loggedEntries.length, 1);
    const entry = loggedEntries[0];
    assert.strictEqual(entry.provider, 'gemini');
    assert.strictEqual(entry.model, 'gemini-1.5-flash');
    assert.strictEqual(entry.status, 200);
    assert.strictEqual(entry.responseTimeMs, 145);
    assert.strictEqual(entry.tokensUsed.totalTokens, 150);

    const m = metricsService.getMetrics();
    assert.ok(m.telemetry.published >= 1);
    assert.ok(m.telemetry.processed >= 1);
  });

  await t.test('4. Transient worker failure triggers retry with incremented retry header', async () => {
    const channel = getQueueChannel();
    let attempt = 0;
    let requeuedCount = 0;

    RequestLog.create = async (doc) => {
      attempt++;
      if (attempt === 1) {
        throw new Error('Transient Mongo network timeout');
      }
      loggedEntries.push(doc);
      return doc;
    };

    // Track re-queues
    const originalSendToQueue = channel.sendToQueue.bind(channel);
    channel.sendToQueue = async (queue, content, options) => {
      if (options?.headers?.['x-retry-count']) {
        requeuedCount = options.headers['x-retry-count'];
      }
      return originalSendToQueue(queue, content, options);
    };

    await initTelemetryWorker();

    await publishTelemetryEvent({
      userId: testUserId,
      provider: 'openai',
      endpoint: '/v1/chat/completions',
      statusCode: 200
    });

    // Wait for initial failure + requeue + retry success
    await new Promise(r => setTimeout(r, 80));

    assert.ok(requeuedCount >= 1, 'Message must be requeued with x-retry-count');
    assert.strictEqual(loggedEntries.length, 1, 'Event persisted successfully after retry');
    channel.sendToQueue = originalSendToQueue;
  });

  await t.test('5. Poison message exceeding MAX_RETRIES reaches Dead Letter Queue (DLQ)', async () => {
    const channel = getQueueChannel();
    let dlqReceived = null;

    // Fail all Mongo writes for this test
    RequestLog.create = async () => {
      throw new Error('Permanent database constraint error');
    };

    // Intercept DLQ messages
    await channel.consume(TELEMETRY_DLQ, (msg) => {
      dlqReceived = {
        content: JSON.parse(msg.content.toString()),
        headers: msg.properties?.headers
      };
    });

    await initTelemetryWorker();

    await publishTelemetryEvent({
      userId: testUserId,
      provider: 'anthropic',
      endpoint: '/v1/messages',
      statusCode: 500,
      errorMessage: 'Fatal upstream error'
    });

    // Wait for retries to exhaust
    await new Promise(r => setTimeout(r, 150));

    assert.ok(dlqReceived, 'Poison message must arrive in DLQ');
    assert.strictEqual(dlqReceived.content.provider, 'anthropic');
    assert.ok(dlqReceived.headers['x-dlq-reason'].includes('Exceeded max retries'));

    const m = metricsService.getMetrics();
    assert.ok(m.telemetry.dlq >= 1, 'DLQ metric must be incremented');
    assert.ok(m.telemetry.processingFailures >= 1);
  });

  await t.test('6. Malformed telemetry is rejected safely and routed to DLQ', async () => {
    const channel = getQueueChannel();
    const dlqMessages = [];

    await channel.consume(TELEMETRY_DLQ, (msg) => {
      dlqMessages.push({
        raw: msg.content.toString(),
        headers: msg.properties?.headers || {}
      });
    });

    await initTelemetryWorker();

    // 1. Send corrupted JSON directly to the telemetry queue
    const corruptBuffer = Buffer.from('NOT_A_VALID_JSON{abc::123');
    await channel.sendToQueue(TELEMETRY_QUEUE, corruptBuffer, { headers: { 'x-retry-count': 0 } });

    const deadline1 = Date.now() + 1500;
    while (dlqMessages.length < 1 && Date.now() < deadline1) {
      await new Promise(r => setTimeout(r, 20));
    }

    assert.ok(dlqMessages.length >= 1, 'Corrupt message must arrive in DLQ');
    assert.ok(dlqMessages[0].headers['x-dlq-reason'].includes('Malformed JSON'));

    // 2. Also test valid JSON but missing required schema fields
    const invalidSchemaBuffer = Buffer.from(JSON.stringify({ randomField: 123 }));
    await channel.sendToQueue(TELEMETRY_QUEUE, invalidSchemaBuffer, { headers: { 'x-retry-count': 0 } });

    const deadline2 = Date.now() + 1500;
    while (dlqMessages.length < 2 && Date.now() < deadline2) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(dlqMessages.length >= 2, 'Invalid schema message must be routed to DLQ');
    assert.ok(dlqMessages[1].headers['x-dlq-reason'].includes('Invalid telemetry schema'));
  });

  await t.test('7. RabbitMQ failure does not break gateway response (graceful degradation)', async () => {
    const channel = getQueueChannel();
    const originalPublish = channel.publish.bind(channel);

    // Simulate RabbitMQ crash / connection drop on publish
    channel.publish = async () => {
      throw new Error('Connection to RabbitMQ broker lost');
    };

    try {
      const req = {
        params: { provider: 'openai', '0': '/v1/chat/completions' },
        method: 'POST',
        body: { model: 'gpt-4o' },
        headers: {},
        userId: testUserId,
        query: {}
      };

      const res = createMockRes();
      // Must not throw or return 500
      await handleGatewayRequest(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.id, 'mock_chat_1');

      const m = metricsService.getMetrics();
      assert.ok(m.telemetry.publishFailures >= 1, 'Publish failure metric must be incremented');
    } finally {
      channel.publish = originalPublish;
    }
  });

  await t.test('8. Sensitive fields are never included in telemetry messages', async () => {
    const raw = {
      userId: testUserId,
      apiKey: 'sk-super-secret-key-12345',
      authorization: 'Bearer jwt_token_here',
      headers: { authorization: 'Bearer jwt_token_here', 'x-api-key': 'secret' },
      requestBody: { prompt: 'Super secret private user prompt' },
      responseBody: { completion: 'Secret response from LLM' },
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: '/v1/chat/completions',
      method: 'POST',
      statusCode: 200,
      costUsd: 0.005,
      tokensUsed: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
    };

    const sanitized = sanitizeTelemetryPayload(raw);

    assert.strictEqual(sanitized.provider, 'openai');
    assert.strictEqual(sanitized.model, 'gpt-4o');
    assert.strictEqual(sanitized.statusCode, 200);
    assert.strictEqual(sanitized.tokensUsed.totalTokens, 20);

    // Sensitive properties must NOT exist in sanitized output
    assert.strictEqual(sanitized.apiKey, undefined);
    assert.strictEqual(sanitized.authorization, undefined);
    assert.strictEqual(sanitized.headers, undefined);
    assert.strictEqual(sanitized.requestBody, undefined);
    assert.strictEqual(sanitized.responseBody, undefined);
    assert.strictEqual(sanitized.prompt, undefined);
  });

  await t.test('9. Topology durability and persistence attributes verified', async () => {
    const channel = getQueueChannel();

    const mainQ = channel.queues.get(TELEMETRY_QUEUE);
    assert.ok(mainQ, 'Telemetry queue must exist');
    assert.strictEqual(mainQ.options.durable, true, 'Telemetry queue must be durable');
    assert.strictEqual(mainQ.options.deadLetterExchange, TELEMETRY_DLX, 'DLX must be configured on queue');

    const dlQ = channel.queues.get(TELEMETRY_DLQ);
    assert.ok(dlQ, 'DLQ must exist');
    assert.strictEqual(dlQ.options.durable, true, 'DLQ must be durable');

    const mainEx = channel.exchanges.get(TELEMETRY_EXCHANGE);
    assert.ok(mainEx, 'Telemetry exchange must exist');
    assert.strictEqual(mainEx.options.durable, true, 'Exchange must be durable');

    const dlEx = channel.exchanges.get(TELEMETRY_DLX);
    assert.ok(dlEx, 'DLX exchange must exist');
    assert.strictEqual(dlEx.options.durable, true, 'DLX exchange must be durable');
  });

  await t.test('10. Metrics tracking covers all telemetry events', async () => {
    metricsService.resetMetrics();

    metricsService.recordTelemetryPublished();
    metricsService.recordTelemetryPublished();
    metricsService.recordTelemetryPublishFailure();
    metricsService.recordTelemetryProcessed();
    metricsService.recordTelemetryProcessingFailure();
    metricsService.recordTelemetryDlq();

    const m = metricsService.getMetrics();
    assert.strictEqual(m.telemetry.published, 2);
    assert.strictEqual(m.telemetry.publishFailures, 1);
    assert.strictEqual(m.telemetry.processed, 1);
    assert.strictEqual(m.telemetry.processingFailures, 1);
    assert.strictEqual(m.telemetry.dlq, 1);
  });

  await t.test('11. Preserves existing queued request functionality (gateway_requests queue)', async () => {
    const channel = getQueueChannel();
    let queuedJobReceived = null;

    await channel.consume('gateway_requests', (msg) => {
      queuedJobReceived = JSON.parse(msg.content.toString());
    });

    const req = {
      params: { provider: 'openai', '0': '/v1/chat/completions' },
      method: 'POST',
      body: { model: 'gpt-4o' },
      headers: { 'x-optiapi-queue': 'true' },
      userId: testUserId,
      query: { queue: 'true' }
    };

    const res = createMockRes();
    await handleGatewayRequest(req, res);

    assert.strictEqual(res.statusCode, 202);
    assert.strictEqual(res.body.status, 'queued');

    await new Promise(r => setTimeout(r, 40));
    assert.ok(queuedJobReceived, 'Standard gateway_requests queue must still receive heavy traffic tasks');
    assert.strictEqual(queuedJobReceived.provider, 'openai');
  });
});
