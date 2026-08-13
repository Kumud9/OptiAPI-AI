'use strict';

const mongoose = require('mongoose');
const RequestLog = require('../models/RequestLog');
const User = require('../models/User');
const logger = require('../utils/logger');

const ANALYZED_PROVIDERS = ['gemini', 'openai'];

/**
 * Helper to compute the 95th percentile latency from an array of latencies.
 */
function calculateP95(latencies) {
  if (!latencies || latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Resolves the model name for a log record.
 * Rules:
 *  - Use RequestLog.model if present.
 *  - For Gemini, derive it from `/v1/models/<MODEL>:generateContent`.
 *  - Otherwise, use 'unknown'.
 */
function resolveModelName(log) {
  if (log.model && log.model.trim()) {
    return log.model.trim();
  }
  if (log.provider === 'gemini' && log.endpoint) {
    const match = log.endpoint.match(/\/models\/([^/:]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return 'unknown';
}

/**
 * Calculates historical provider/model metrics from RequestLog for the given user.
 * Excludes admin user data entirely.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Array<object>>}
 */
async function getHistoricalMetricsForUser(userId) {
  if (!userId) {
    return [];
  }

  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  // 1. Check user role. Exclude admin users' logs.
  const user = await User.findById(userObjectId);
  if (!user || user.role === 'admin') {
    logger.info(`HistoricalDataService: Excluded query for user: ${userId} (User not found or is admin)`);
    return [];
  }

  // 2. Fetch logs for the specified user and providers
  const logs = await RequestLog.find({
    userId: userObjectId,
    provider: { $in: ANALYZED_PROVIDERS }
  }).lean();

  if (!logs || logs.length === 0) {
    return [];
  }

  // Group logs by provider, resolved model, and endpoint
  const groupings = {};

  for (const log of logs) {
    const model = resolveModelName(log);
    const provider = log.provider;
    const endpoint = log.endpoint || '';
    const key = `${provider}|${model}|${endpoint}`;

    if (!groupings[key]) {
      groupings[key] = {
        provider,
        model,
        endpoint,
        requestCount: 0,
        successfulRequests: 0,
        perfLatencies: [],
        perfCosts: [],
        perfTokens: [],
        cacheHits: 0,
        cacheMisses: 0,
        cacheBypasses: 0
      };
    }

    const group = groupings[key];
    group.requestCount += 1;

    if (log.status === 200) {
      group.successfulRequests += 1;
    }

    // Cache hit/miss/bypass counts (case-insensitive checking to be safe)
    const cacheStatus = (log.cacheStatus || 'BYPASS').toUpperCase();
    if (cacheStatus === 'HIT') {
      group.cacheHits += 1;
    } else if (cacheStatus === 'MISS') {
      group.cacheMisses += 1;
    } else {
      group.cacheBypasses += 1;
    }

    // Performance metrics: status 200 only, and exclude cacheStatus === 'HIT'
    if (log.status === 200 && cacheStatus !== 'HIT') {
      group.perfLatencies.push(log.responseTimeMs || 0);
      group.perfCosts.push(log.costUsd || 0);
      const totalTokens = log.tokensUsed && typeof log.tokensUsed.totalTokens === 'number'
        ? log.tokensUsed.totalTokens
        : 0;
      group.perfTokens.push(totalTokens);
    }
  }

  const result = [];

  for (const key of Object.keys(groupings)) {
    const group = groupings[key];
    const perfCount = group.perfLatencies.length;

    const avgLatencyMs = perfCount
      ? Math.round(group.perfLatencies.reduce((sum, val) => sum + val, 0) / perfCount)
      : 0;

    const p95LatencyMs = perfCount ? calculateP95(group.perfLatencies) : 0;

    const totalCostUsd = perfCount
      ? parseFloat(group.perfCosts.reduce((sum, val) => sum + val, 0).toFixed(8))
      : 0;

    const avgCostUsd = perfCount
      ? parseFloat((totalCostUsd / perfCount).toFixed(8))
      : 0;

    const avgTotalTokens = perfCount
      ? Math.round(group.perfTokens.reduce((sum, val) => sum + val, 0) / perfCount)
      : 0;

    const successRate = group.requestCount > 0
      ? parseFloat((group.successfulRequests / group.requestCount).toFixed(4))
      : 0;

    result.push({
      provider: group.provider,
      model: group.model,
      endpoint: group.endpoint,
      requestCount: group.requestCount,
      successfulRequests: group.successfulRequests,
      successRate,
      avgLatencyMs,
      p95LatencyMs,
      avgCostUsd,
      totalCostUsd,
      avgTotalTokens,
      cacheHits: group.cacheHits,
      cacheMisses: group.cacheMisses,
      cacheBypasses: group.cacheBypasses
    });
  }

  // Sort deterministically by provider, model, endpoint
  result.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.endpoint.localeCompare(b.endpoint);
  });

  return result;
}

module.exports = {
  getHistoricalMetricsForUser,
  resolveModelName,
  calculateP95
};
