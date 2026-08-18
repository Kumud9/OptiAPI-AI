'use strict';

const { getHistoricalMetricsForUser } = require('./historicalDataService');
const { calculateRecommendation } = require('./scoringService');

const SUPPORTED_PROVIDERS = ['gemini', 'openai', 'anthropic'];

/**
 * Builds the optimization decision for a given user, mode, and optional request details / provider filter.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} mode
 * @param {object|null} reqDetails - { provider, endpoint, body }
 * @param {Array<string>|null} providersFilter
 * @returns {Promise<object|null>}
 */
async function getOptimizationDecision(userId, mode = 'balanced', reqDetails = null, providersFilter = null) {
  const { extractRequiredCapabilities, getEligibleCandidates } = require('./providerEligibilityService');

  // 1. Determine required capabilities from request
  let requiredCaps = {};
  if (reqDetails) {
    requiredCaps = extractRequiredCapabilities(reqDetails.provider, reqDetails.endpoint, reqDetails.body);
  }

  // 2. Fetch eligible candidates and exclusions list
  const { eligible, explanations } = await getEligibleCandidates(userId, requiredCaps);

  // If no candidates are eligible, abort
  if (eligible.length === 0) {
    return {
      success: false,
      code: 'NO_ELIGIBLE_PROVIDERS',
      message: 'No providers match the capability requirements or have active credentials.',
      explanations
    };
  }

  // 3. Fetch historical metrics
  const metrics = await getHistoricalMetricsForUser(userId);

  // 4. Filter metrics based on eligibility list
  let eligibleMetrics = metrics.filter(m =>
    eligible.some(el => el.provider === m.provider && el.model === m.model)
  );

  // Apply providersFilter if present
  if (providersFilter && Array.isArray(providersFilter)) {
    eligibleMetrics = eligibleMetrics.filter(m => providersFilter.includes(m.provider));
  }

  // 5. Evaluate the best recommendation candidate from eligible metrics
  const recommendation = calculateRecommendation(eligibleMetrics, mode);

  if (!recommendation) {
    // Collect cold starts / insufficient telemetry models for details
    const coldStarts = eligible.map(el => {
      const hist = metrics.find(m => m.provider === el.provider && m.model === el.model);
      const reqCount = hist ? hist.successfulRequests : 0;
      return {
        provider: el.provider,
        model: el.model,
        reason: reqCount < 5 ? 'Insufficient historical data' : 'Eligible but uncalculated'
      };
    });

    return {
      success: false,
      code: 'INSUFFICIENT_DATA',
      message: 'Not enough historical provider data to make a reliable recommendation.',
      explanations: [...explanations, ...coldStarts]
    };
  }

  // Find the original metric details for explanation
  const matchingMetric = metrics.find(
    m => m.provider === recommendation.provider &&
         m.model === recommendation.model &&
         m.endpoint === recommendation.endpoint
  );

  if (!matchingMetric) {
    return {
      success: false,
      code: 'INSUFFICIENT_DATA',
      message: 'Not enough historical provider data to make a reliable recommendation.'
    };
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
      costScore: recommendation.costScore,
      latencyScore: recommendation.latencyScore,
      reliabilityScore: recommendation.reliabilityScore,
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
    },
    explanations
  };
}

module.exports = {
  getOptimizationDecision,
  SUPPORTED_PROVIDERS
};
