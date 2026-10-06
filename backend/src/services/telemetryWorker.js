'use strict';

const { getQueueChannel } = require('../config/queue');
const RequestLog = require('../models/RequestLog');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const {
  TELEMETRY_QUEUE,
  TELEMETRY_DLX,
  TELEMETRY_DEAD_ROUTING_KEY,
  MAX_RETRIES,
  setupTelemetryTopology
} = require('./telemetryService');

let workerRunning = false;

/**
 * Validates whether parsed payload is a well-formed telemetry event.
 *
 * @param {object} payload
 * @returns {boolean}
 */
function isValidTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.provider || typeof payload.provider !== 'string') return false;
  if (typeof payload.statusCode !== 'number' && typeof payload.status !== 'number') return false;
  if (!payload.endpoint || typeof payload.endpoint !== 'string') return false;
  return true;
}

/**
 * Routes a poison or exhausted message to the Dead Letter Queue.
 *
 * @param {object} channel
 * @param {object} msg
 * @param {string} reason
 */
async function sendToDLQ(channel, msg, reason) {
  try {
    const rawContent = msg.content;
    const properties = {
      ...msg.properties,
      headers: {
        ...(msg.properties?.headers || {}),
        'x-dlq-reason': reason,
        'x-dlq-timestamp': new Date().toISOString()
      }
    };

    await channel.publish(TELEMETRY_DLX, TELEMETRY_DEAD_ROUTING_KEY, rawContent, properties);
    await channel.ack(msg);
    metricsService.recordTelemetryDlq();
    metricsService.recordTelemetryProcessingFailure();
    logger.warn(`Telemetry message sent to DLQ [${TELEMETRY_DEAD_ROUTING_KEY}]: ${reason}`);
  } catch (dlqErr) {
    logger.error(`Critical: Failed to route poison message to DLQ: ${dlqErr.message}`);
    try {
      await channel.ack(msg);
    } catch (_) {}
  }
}

/**
 * Processes an individual telemetry message buffer.
 *
 * @param {object} channel
 * @param {object} msg
 */
async function processTelemetryMessage(channel, msg) {
  if (!msg) return;

  let payload = null;
  try {
    payload = JSON.parse(msg.content.toString());
  } catch (parseErr) {
    logger.error(`Malformed telemetry JSON received: ${parseErr.message}`);
    await sendToDLQ(channel, msg, `Malformed JSON: ${parseErr.message}`);
    return;
  }

  if (!isValidTelemetryPayload(payload)) {
    logger.error('Invalid telemetry payload structure rejected.');
    await sendToDLQ(channel, msg, 'Invalid telemetry schema fields');
    return;
  }

  try {
    const status = Number(payload.statusCode || payload.status || 200);
    const responseTimeMs = Number(payload.latencyMs || payload.responseTimeMs || 0);

    // Persist to MongoDB RequestLog
    await RequestLog.create({
      userId: payload.userId || null,
      apiKeyId: payload.apiKeyId || null,
      provider: payload.provider,
      model: payload.model || null,
      endpoint: payload.endpoint,
      method: payload.method || 'POST',
      status,
      responseTimeMs,
      costUsd: typeof payload.costUsd === 'number' ? payload.costUsd : 0.0,
      tokensUsed: payload.tokensUsed || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cacheStatus: payload.cacheStatus || 'BYPASS',
      errorMessage: payload.errorClassification || null,
      timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
      optimizationEnabled: Boolean(payload.optimization?.optimizationEnabled),
      optimizationUsed: Boolean(payload.optimization?.optimizationUsed),
      optimizationMode: payload.optimization?.optimizationMode || null,
      actualProvider: payload.optimization?.actualProvider || payload.provider,
      actualModel: payload.optimization?.actualModel || payload.model,
      routedProvider: payload.optimization?.actualProvider || payload.provider
    });

    metricsService.recordTelemetryProcessed();
    await channel.ack(msg);
    logger.debug(`Telemetry event persisted to MongoDB for [${payload.provider}] status [${status}]`);
  } catch (dbErr) {
    const currentRetries = Number(msg.properties?.headers?.['x-retry-count'] || 0);
    logger.warn(`Telemetry persistence error (attempt ${currentRetries + 1}/${MAX_RETRIES}): ${dbErr.message}`);

    if (currentRetries < MAX_RETRIES) {
      // Re-queue message with incremented retry header
      const updatedHeaders = {
        ...(msg.properties?.headers || {}),
        'x-retry-count': currentRetries + 1,
        'x-last-error': dbErr.message
      };

      try {
        await channel.sendToQueue(TELEMETRY_QUEUE, msg.content, {
          ...msg.properties,
          headers: updatedHeaders
        });
        await channel.ack(msg);
        logger.info(`Telemetry event requeued for retry attempt ${currentRetries + 1}`);
      } catch (requeueErr) {
        logger.error(`Failed to requeue telemetry message: ${requeueErr.message}`);
        await sendToDLQ(channel, msg, `Re-queue failure: ${requeueErr.message}`);
      }
    } else {
      // Exceeded max retries -> Poison message to DLQ
      await sendToDLQ(channel, msg, `Exceeded max retries (${MAX_RETRIES}): ${dbErr.message}`);
    }
  }
}

/**
 * Initializes and starts the background telemetry worker consumer.
 */
async function initTelemetryWorker() {
  if (workerRunning) {
    return true;
  }

  try {
    await setupTelemetryTopology();
    const channel = getQueueChannel();

    await channel.prefetch(20);
    logger.info(`Starting background Telemetry Consumer on queue [${TELEMETRY_QUEUE}]...`);

    await channel.consume(TELEMETRY_QUEUE, async (msg) => {
      await processTelemetryMessage(channel, msg);
    });

    workerRunning = true;
    return true;
  } catch (err) {
    logger.error(`Failed to initialize telemetry worker: ${err.message}`);
    return false;
  }
}

function resetWorkerState() {
  workerRunning = false;
}

module.exports = {
  initTelemetryWorker,
  processTelemetryMessage,
  isValidTelemetryPayload,
  sendToDLQ,
  resetWorkerState
};
