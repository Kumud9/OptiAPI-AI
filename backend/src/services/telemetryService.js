'use strict';

const { getQueueChannel } = require('../config/queue');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');

const TELEMETRY_EXCHANGE = process.env.TELEMETRY_EXCHANGE || 'optiapi.telemetry.exchange';
const TELEMETRY_QUEUE = process.env.TELEMETRY_QUEUE || 'optiapi.telemetry';
const TELEMETRY_ROUTING_KEY = 'optiapi.telemetry.event';

const TELEMETRY_DLX = process.env.TELEMETRY_DLX || 'optiapi.telemetry.dlx';
const TELEMETRY_DLQ = process.env.TELEMETRY_DLQ || 'optiapi.telemetry.dlq';
const TELEMETRY_DEAD_ROUTING_KEY = 'optiapi.telemetry.dead';

const MAX_RETRIES = parseInt(process.env.TELEMETRY_MAX_RETRIES || '3', 10);

let topologyConfigured = false;

/**
 * Declares durable exchanges, telemetry queue, dead letter exchange (DLX),
 * dead letter queue (DLQ), and bindings.
 */
async function setupTelemetryTopology() {
  try {
    const channel = getQueueChannel();

    // 1. Dead Letter Exchange & Queue
    await channel.assertExchange(TELEMETRY_DLX, 'direct', { durable: true });
    await channel.assertQueue(TELEMETRY_DLQ, { durable: true });
    await channel.bindQueue(TELEMETRY_DLQ, TELEMETRY_DLX, TELEMETRY_DEAD_ROUTING_KEY);

    // 2. Primary Telemetry Exchange & Queue (with DLX routing)
    await channel.assertExchange(TELEMETRY_EXCHANGE, 'direct', { durable: true });
    await channel.assertQueue(TELEMETRY_QUEUE, {
      durable: true,
      deadLetterExchange: TELEMETRY_DLX,
      deadLetterRoutingKey: TELEMETRY_DEAD_ROUTING_KEY,
      arguments: {
        'x-dead-letter-exchange': TELEMETRY_DLX,
        'x-dead-letter-routing-key': TELEMETRY_DEAD_ROUTING_KEY
      }
    });
    await channel.bindQueue(TELEMETRY_QUEUE, TELEMETRY_EXCHANGE, TELEMETRY_ROUTING_KEY);

    topologyConfigured = true;
    logger.info('RabbitMQ telemetry topology configured successfully (Exchanges, Queues, DLQ).');
    return true;
  } catch (err) {
    logger.error(`Failed to setup telemetry RabbitMQ topology: ${err.message}`);
    return false;
  }
}

/**
 * Sanitizes telemetry event payload.
 * Strips raw API keys, bearer tokens, authorization headers, sensitive prompt texts,
 * and request/response bodies.
 *
 * @param {object} raw
 * @returns {object}
 */
function sanitizeTelemetryPayload(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const statusCode = Number(raw.statusCode || raw.status || 200);
  const latencyMs = Math.max(0, Number(raw.latencyMs || raw.responseTimeMs || 0));
  const success = raw.success !== undefined ? Boolean(raw.success) : (statusCode >= 200 && statusCode < 400);

  // Normalize tokens
  const tokensUsed = {
    promptTokens: Number(raw.tokensUsed?.promptTokens || 0),
    completionTokens: Number(raw.tokensUsed?.completionTokens || 0),
    totalTokens: Number(raw.tokensUsed?.totalTokens || (Number(raw.tokensUsed?.promptTokens || 0) + Number(raw.tokensUsed?.completionTokens || 0)))
  };

  const costUsd = typeof raw.costUsd === 'number' ? Number(raw.costUsd.toFixed(8)) : 0.0;

  return {
    userId: raw.userId ? String(raw.userId) : null,
    apiKeyId: raw.apiKeyId ? String(raw.apiKeyId) : null,
    provider: (raw.provider || 'unknown').toLowerCase(),
    model: raw.model || null,
    endpoint: raw.endpoint || '/',
    method: (raw.method || 'POST').toUpperCase(),
    statusCode,
    status: statusCode,
    latencyMs,
    responseTimeMs: latencyMs,
    success,
    errorClassification: raw.errorClassification || raw.errorMessage || null,
    costUsd,
    tokensUsed,
    cacheStatus: raw.cacheStatus || 'BYPASS',
    timestamp: raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString(),
    optimization: {
      optimizationEnabled: Boolean(raw.optimization?.optimizationEnabled),
      optimizationUsed: Boolean(raw.optimization?.optimizationUsed),
      optimizationMode: raw.optimization?.optimizationMode || null,
      actualProvider: raw.optimization?.actualProvider || raw.actualProvider || raw.provider || null,
      actualModel: raw.optimization?.actualModel || raw.actualModel || raw.model || null,
      didFailover: Boolean(raw.optimization?.didFailover || raw.didFailover)
    }
  };
}

/**
 * Asynchronously publishes a telemetry event to RabbitMQ.
 * Non-blocking, fault-tolerant: failure to publish never throws or breaks the gateway.
 *
 * @param {object} eventData
 * @returns {Promise<boolean>}
 */
async function publishTelemetryEvent(eventData) {
  try {
    if (!topologyConfigured) {
      await setupTelemetryTopology();
    }

    const payload = sanitizeTelemetryPayload(eventData);
    if (!payload) {
      logger.warn('Skipping telemetry publish: empty or invalid payload');
      metricsService.recordTelemetryPublishFailure();
      return false;
    }

    const channel = getQueueChannel();
    const content = Buffer.from(JSON.stringify(payload));

    const published = await channel.publish(
      TELEMETRY_EXCHANGE,
      TELEMETRY_ROUTING_KEY,
      content,
      {
        persistent: true,
        deliveryMode: 2,
        contentType: 'application/json',
        timestamp: Date.now(),
        headers: {
          'x-retry-count': 0,
          'x-original-exchange': TELEMETRY_EXCHANGE,
          'x-original-routing-key': TELEMETRY_ROUTING_KEY
        }
      }
    );

    metricsService.recordTelemetryPublished();
    logger.debug(`Telemetry event published for [${payload.provider}] status [${payload.statusCode}]`);
    return Boolean(published);
  } catch (err) {
    logger.warn(`Failed to publish telemetry event to RabbitMQ: ${err.message}. Degrading gracefully.`);
    metricsService.recordTelemetryPublishFailure();
    return false;
  }
}

module.exports = {
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
};
