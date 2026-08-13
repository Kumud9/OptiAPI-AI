'use strict';

const { getHistoricalMetricsForUser } = require('./historicalDataService');
const { calculateRecommendation } = require('./scoringService');

const SUPPORTED_PROVIDERS = ['gemini', 'openai'];

/**
 * Builds the optimization decision for a given user, mode, and provider filter.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} mode
 * @param {Array<string>|null} providersFilter
 * @returns {Promise<object|null>}
 */
async function getOptimizationDecision(userId, mode = 'balanced', providersFilter = null) {
  // Fetch historical metrics
  const metrics = await getHistoricalMetricsForUser(userId);

  // Evaluate the best recommendation candidate
  const recommendation = calculateRecommendation(metrics, mode, providersFilter);

  if (!recommendation) {
    return null;
  }

  // Find the original metric details for explanation
  const matchingMetric = metrics.find(
    m => m.provider === recommendation.provider &&
         m.model === recommendation.model &&
         m.endpoint === recommendation.endpoint
  );

  if (!matchingMetric) {
    return null;
  }

  // Build the explainability reasons
  const costReason = `Average cost of ${matchingMetric.avgCostUsd} USD`;
  const latencyReason = `Average latency of ${matchingMetric.avgLatencyMs}ms`;
  const reliabilityReason = `Success rate of ${(matchingMetric.successRate * 100).toFixed(1)}%`;

  return {
    success: true,
    mode,
    decision: {
      provider: recommendation.provider,
      model: recommendation.model,
      endpoint: recommendation.endpoint,
      score: recommendation.score,
      confidence: recommendation.confidence,
      reason: {
        cost: costReason,
        latency: latencyReason,
        reliability: reliabilityReason
      }
    },
    metrics: {
      successfulRequests: matchingMetric.successfulRequests,
      successRate: matchingMetric.successRate,
      avgLatencyMs: matchingMetric.avgLatencyMs,
      p95LatencyMs: matchingMetric.p95LatencyMs,
      avgCostUsd: matchingMetric.avgCostUsd
    }
  };
}

module.exports = {
  getOptimizationDecision,
  SUPPORTED_PROVIDERS
};
