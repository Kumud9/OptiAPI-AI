'use strict';

const mongoose = require('mongoose');
const RequestLog = require('../models/RequestLog');
const logger = require('../utils/logger');

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_PROVIDERS = ['openai', 'gemini', 'anthropic'];

/**
 * Calculates P95 latency from an array of numeric latencies.
 *
 * @param {Array<number>} latencies
 * @returns {number}
 */
function calculateP95(latencies) {
  if (!latencies || latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] || 0;
}

/**
 * Aggregates recent RequestLog telemetry per user/provider/model using a bounded
 * MongoDB aggregation query.
 *
 * NEVER loads the full RequestLog collection into Node memory.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {object} [options={}]
 * @param {number} [options.windowHours=24] - Bounded time window in hours
 * @param {Array<string>} [options.providers] - Allowed provider list
 * @param {number} [options.maxDocs=5000] - Hard cap on analyzed documents
 * @returns {Promise<Array<object>>}
 */
async function aggregateUserTelemetry(userId, options = {}) {
  if (!userId) {
    return [];
  }

  const windowHours = Number.isInteger(options.windowHours) && options.windowHours > 0
    ? options.windowHours
    : DEFAULT_WINDOW_HOURS;

  const providers = Array.isArray(options.providers) && options.providers.length > 0
    ? options.providers.map(p => String(p).toLowerCase().trim())
    : DEFAULT_PROVIDERS;

  const maxDocs = Number.isInteger(options.maxDocs) && options.maxDocs > 0
    ? options.maxDocs
    : 5000;

  const userObjectId = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  try {
    const pipeline = [
      {
        $match: {
          userId: userObjectId,
          timestamp: { $gte: since },
          provider: { $in: providers }
        }
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $limit: maxDocs
      },
      {
        $group: {
          _id: {
            provider: '$provider',
            model: { $ifNull: ['$model', 'default'] }
          },
          requestCount: { $sum: 1 },
          successCount: {
            $sum: {
              $cond: [{ $and: [{ $gte: ['$status', 200] }, { $lt: ['$status', 400] }] }, 1, 0]
            }
          },
          errorCount: {
            $sum: {
              $cond: [{ $gte: ['$status', 400] }, 1, 0]
            }
          },
          cacheHitCount: {
            $sum: {
              $cond: [{ $in: ['$cacheStatus', ['HIT', 'SEMANTIC_HIT']] }, 1, 0]
            }
          },
          totalCostUsd: { $sum: '$costUsd' },
          avgLatencyMs: { $avg: '$responseTimeMs' },
          latencies: { $push: '$responseTimeMs' }
        }
      }
    ];

    const results = await RequestLog.aggregate(pipeline);

    if (!results || results.length === 0) {
      return [];
    }

    const aggregated = results.map(row => {
      const provider = row._id.provider;
      const model = row._id.model;
      const requestCount = row.requestCount || 0;
      const successCount = row.successCount || 0;
      const errorCount = row.errorCount || 0;
      const cacheHitCount = row.cacheHitCount || 0;
      const successRate = requestCount > 0 ? Number((successCount / requestCount).toFixed(4)) : 0;
      const errorRate = requestCount > 0 ? Number((errorCount / requestCount).toFixed(4)) : 0;
      const cacheHitRate = requestCount > 0 ? Number((cacheHitCount / requestCount).toFixed(4)) : 0;
      const avgLatency = Math.round(row.avgLatencyMs || 0);
      const p95Latency = calculateP95(row.latencies || []);
      const estimatedCost = Number((row.totalCostUsd || 0).toFixed(8));

      return {
        provider,
        model,
        requestCount,
        successCount,
        errorCount,
        successRate,
        errorRate,
        cacheHitRate,
        avgLatency,
        p95Latency,
        estimatedCost,
        totalCostUsd: estimatedCost
      };
    });

    // Sort deterministically by provider and model
    aggregated.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.model.localeCompare(b.model);
    });

    return aggregated;
  } catch (err) {
    logger.error(`Error aggregating telemetry for user [${userId}]: ${err.message}`);
    return [];
  }
}

module.exports = {
  aggregateUserTelemetry,
  calculateP95,
  DEFAULT_WINDOW_HOURS,
  DEFAULT_PROVIDERS
};
