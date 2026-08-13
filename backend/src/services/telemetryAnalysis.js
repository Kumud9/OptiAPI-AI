/**
 * Historical Telemetry Analysis Service
 * ======================================
 * Reads and aggregates RequestLog data to produce per-(provider, model, endpoint)
 * performance and reliability metrics.
 *
 * Design constraints:
 *  - Read-only: NEVER modifies, creates, or deletes any document.
 *  - No external API calls (Gemini, OpenAI, etc.).
 *  - Model resolution: RequestLog.model -> endpoint path -> "unknown".
 *  - Performance metrics (latency, cost) exclude cacheStatus = "HIT" records
 *    because the provider was never actually called in those cases.
 *  - Reliability metrics (success rate) use all records.
 */

'use strict';

const mongoose = require('mongoose');
const RequestLog = require('../models/RequestLog');
const logger = require('../utils/logger');

/** Providers the Optimization Engine cares about. */
const ANALYSED_PROVIDERS = ['gemini', 'openai'];

/**
 * Derive a model name from a gateway endpoint path.
 *   /v1/models/gemini-3.1-flash-lite:generateContent -> "gemini-3.1-flash-lite"
 *   /v1/chat/completions (OpenAI) -> null (no model in path)
 */
function deriveModelFromEndpoint(endpoint) {
  if (!endpoint) return null;
  const m = endpoint.match(/\/models\/([^/:]+)/);
  return m ? m[1] : null;
}

/**
 * Resolve model for a log record:
 *  1. Stored RequestLog.model (if non-empty).
 *  2. Endpoint-based extraction.
 *  3. "unknown".
 */
function resolveModel(storedModel, endpoint) {
  if (storedModel && storedModel.trim()) return storedModel.trim();
  const derived = deriveModelFromEndpoint(endpoint);
  return derived || 'unknown';
}

/**
 * Compute P95 latency from a pre-sorted ascending array.
 */
function p95(sorted) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * Build per-(provider, model, endpoint) telemetry metrics for the given user.
 *
 * Performance metrics (avgLatencyMs, p95LatencyMs, avgCostUsd, totalCostUsd,
 * avgTokens) exclude cacheStatus=HIT records — provider was not called for those.
 * Reliability metrics (requestCount, successRate) include all records.
 *
 * @param {mongoose.Types.ObjectId|string} userId
 * @returns {Promise<Array<object>>}
 */
async function buildTelemetryMetrics(userId) {
  const userObjectId =
    userId instanceof mongoose.Types.ObjectId
      ? userId
      : new mongoose.Types.ObjectId(String(userId));

  const logs = await RequestLog.find(
    {
      userId: userObjectId,
      provider: { $in: ANALYSED_PROVIDERS }
    },
    {
      provider: 1,
      model: 1,
      endpoint: 1,
      status: 1,
      responseTimeMs: 1,
      costUsd: 1,
      'tokensUsed.totalTokens': 1,
      cacheStatus: 1,
      _id: 0
    }
  ).lean();

  if (!logs.length) {
    logger.info(`telemetryAnalysis: no ${ANALYSED_PROVIDERS.join('/')} logs for user ${userId}`);
    return [];
  }

  logger.info(`telemetryAnalysis: processing ${logs.length} records for user ${userId}`);

  const groups = new Map();

  for (const log of logs) {
    const resolvedModelName = resolveModel(log.model, log.endpoint);
    const groupKey = `${log.provider}||${resolvedModelName}||${log.endpoint}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        provider: log.provider,
        model: resolvedModelName,
        endpoint: log.endpoint || '',
        allCount: 0,
        successCount: 0,
        perfLatencies: [],
        perfCosts: [],
        perfTokens: [],
        hitCount: 0,
        missCount: 0,
        bypassCount: 0
      });
    }

    const g = groups.get(groupKey);
    g.allCount += 1;
    if (log.status === 200) g.successCount += 1;

    if (log.cacheStatus === 'HIT')         g.hitCount    += 1;
    else if (log.cacheStatus === 'MISS')   g.missCount   += 1;
    else                                   g.bypassCount += 1;

    // Performance data: status 200 + provider was actually called (not HIT)
    if (log.status === 200 && log.cacheStatus !== 'HIT') {
      g.perfLatencies.push(log.responseTimeMs || 0);
      g.perfCosts.push(log.costUsd || 0);
      g.perfTokens.push(
        (log.tokensUsed && log.tokensUsed.totalTokens) ? log.tokensUsed.totalTokens : 0
      );
    }
  }

  const results = [];
  for (const [, g] of groups) {
    const perfCount = g.perfLatencies.length;
    const sortedLat = [...g.perfLatencies].sort((a, b) => a - b);

    const avgLatencyMs   = perfCount ? Math.round(g.perfLatencies.reduce((s, v) => s + v, 0) / perfCount) : 0;
    const p95LatencyMs   = perfCount ? p95(sortedLat) : 0;
    const totalCostUsd   = perfCount ? parseFloat(g.perfCosts.reduce((s, v) => s + v, 0).toFixed(8)) : 0;
    const avgCostUsd     = perfCount ? parseFloat((totalCostUsd / perfCount).toFixed(8)) : 0;
    const avgTokens      = perfCount ? Math.round(g.perfTokens.reduce((s, v) => s + v, 0) / perfCount) : 0;
    const successRate    = g.allCount > 0 ? parseFloat((g.successCount / g.allCount).toFixed(4)) : 0;

    results.push({
      provider:           g.provider,
      model:              g.model,
      endpoint:           g.endpoint,
      requestCount:       g.allCount,
      successfulRequests: g.successCount,
      successRate,
      avgLatencyMs,
      p95LatencyMs,
      avgCostUsd,
      totalCostUsd,
      avgTokens,
      cacheHitCount:      g.hitCount,
      cacheMissCount:     g.missCount,
      bypassCount:        g.bypassCount
    });
  }

  // Deterministic sort: provider -> model -> endpoint
  results.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    if (a.model    !== b.model)    return a.model.localeCompare(b.model);
    return a.endpoint.localeCompare(b.endpoint);
  });

  return results;
}

module.exports = {
  buildTelemetryMetrics,
  deriveModelFromEndpoint,
  resolveModel,
  p95
};
