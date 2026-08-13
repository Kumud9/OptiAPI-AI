'use strict';

const { getHistoricalMetricsForUser } = require('./historicalDataService');

const MODES = {
  balanced: { cost: 0.40, latency: 0.35, reliability: 0.25 },
  cost: { cost: 0.60, latency: 0.20, reliability: 0.20 },
  latency: { cost: 0.20, latency: 0.60, reliability: 0.20 }
};

/**
 * Calculates scores for candidates based on historical metrics and selected mode.
 * Excludes candidates with < 5 successful requests.
 * Normalizes scores dynamically between 0-100.
 *
 * @param {Array<object>} metrics - Historical metrics of the user
 * @param {string} mode - Mode ('balanced', 'cost', 'latency')
 * @returns {object|null} - Best candidate recommendation or null if insufficient data
 */
function calculateRecommendation(metrics, mode = 'balanced', providersFilter = null) {
  const weights = MODES[mode] || MODES.balanced;

  // Filter candidates: minimum 5 successful requests
  let eligible = metrics.filter(m => m.successfulRequests >= 5);
  if (providersFilter && Array.isArray(providersFilter)) {
    eligible = eligible.filter(m => providersFilter.includes(m.provider));
  }
  if (eligible.length === 0) {
    return null;
  }

  // If there is only one candidate, it gets perfect score in relative metrics
  if (eligible.length === 1) {
    const candidate = eligible[0];
    const score = 100.0;
    const confidence = parseFloat(Math.min(1.0, candidate.successfulRequests / 50).toFixed(2));
    return {
      provider: candidate.provider,
      model: candidate.model,
      endpoint: candidate.endpoint,
      score,
      confidence
    };
  }

  // Find min/max values for cost and latency across eligible candidates
  const costs = eligible.map(e => e.avgCostUsd);
  const latencies = eligible.map(e => e.avgLatencyMs);

  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  const scoredCandidates = eligible.map(c => {
    // Normalization logic:
    // Lower cost is better. If max == min, score is 100.
    const costScore = maxCost === minCost 
      ? 100.0 
      : 100.0 * (maxCost - c.avgCostUsd) / (maxCost - minCost);

    // Lower latency is better. If max == min, score is 100.
    const latencyScore = maxLatency === minLatency 
      ? 100.0 
      : 100.0 * (maxLatency - c.avgLatencyMs) / (maxLatency - minLatency);

    // Higher successRate is better (successRate is 0 to 1.0, scale to 0-100)
    const reliabilityScore = c.successRate * 100.0;

    // Final weighted score
    const finalScore = parseFloat((
      (costScore * weights.cost) +
      (latencyScore * weights.latency) +
      (reliabilityScore * weights.reliability)
    ).toFixed(1));

    // Confidence is relative to the volume of successful requests
    const confidence = parseFloat(Math.min(1.0, c.successfulRequests / 50).toFixed(2));

    return {
      provider: c.provider,
      model: c.model,
      endpoint: c.endpoint,
      score: finalScore,
      confidence
    };
  });

  // Sort by final score descending. If tied, sort by successfulRequests volume descending.
  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Find original objects to compare counts
    const origA = eligible.find(e => e.provider === a.provider && e.model === a.model && e.endpoint === a.endpoint);
    const origB = eligible.find(e => e.provider === b.provider && e.model === b.model && e.endpoint === b.endpoint);
    return origB.successfulRequests - origA.successfulRequests;
  });

  return scoredCandidates[0];
}

/**
 * Main service method that retrieves metrics and evaluates the recommendation.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} mode
 * @returns {Promise<object|null>}
 */
async function getRecommendationForUser(userId, mode = 'balanced', providersFilter = null) {
  const metrics = await getHistoricalMetricsForUser(userId);
  return calculateRecommendation(metrics, mode, providersFilter);
}

module.exports = {
  getRecommendationForUser,
  calculateRecommendation,
  MODES
};
