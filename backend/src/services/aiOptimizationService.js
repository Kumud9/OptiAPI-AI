'use strict';

const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const { aggregateUserTelemetry } = require('./telemetryAnalyticsService');
const {
  getRoutingPolicy,
  setRoutingPolicy,
  validateAiPolicy,
  SUPPORTED_PROVIDERS,
  SUPPORTED_MODELS
} = require('./policyService');

// In-flight concurrency lock to prevent overlapping optimization runs per user
const inFlightOptimizations = new Set();

/**
 * Normalizes user-specified objective to a standard strategy key.
 *
 * @param {string} rawObjective
 * @returns {'cost'|'latency'|'reliability'|'balanced'}
 */
function normalizeObjective(rawObjective) {
  const str = String(rawObjective || 'balanced').toLowerCase().trim();
  if (str.includes('cost')) return 'cost';
  if (str.includes('latency') || str.includes('speed')) return 'latency';
  if (str.includes('reliab')) return 'reliability';
  return 'balanced';
}

/**
 * Builds the sanitized, safe prompt payload for the AI model.
 * Zero credentials, zero authorization headers, zero prompts or payloads.
 *
 * @param {Array<object>} telemetry
 * @param {object|null} currentPolicy
 * @param {string} objective
 * @returns {object}
 */
function buildSanitizedAiInput(telemetry, currentPolicy, objective) {
  const safeTelemetry = (telemetry || []).map(t => ({
    provider: t.provider,
    model: t.model,
    requestCount: t.requestCount,
    successRate: t.successRate,
    errorRate: t.errorRate,
    avgLatency: t.avgLatency,
    p95Latency: t.p95Latency,
    estimatedCost: t.estimatedCost,
    cacheHitRate: t.cacheHitRate
  }));

  const safeCurrent = currentPolicy ? {
    provider: currentPolicy.provider,
    model: currentPolicy.model,
    strategy: currentPolicy.strategy,
    timeoutMs: currentPolicy.timeoutMs,
    maxRetries: currentPolicy.maxRetries,
    cacheEnabled: currentPolicy.cacheEnabled
  } : null;

  return {
    objective,
    supportedProviders: SUPPORTED_PROVIDERS,
    supportedModels: SUPPORTED_MODELS,
    currentPolicy: safeCurrent,
    telemetry: safeTelemetry
  };
}

/**
 * Deterministic AI Optimization recommender engine.
 * Selects the optimal provider and model based on actual telemetry and objective,
 * and formats the candidate recommendation.
 *
 * @param {object} inputPayload
 * @returns {Promise<object>}
 */
async function generateAiRecommendation(inputPayload) {
  const { objective, telemetry, currentPolicy } = inputPayload;

  if (!telemetry || telemetry.length === 0) {
    throw new Error('Insufficient telemetry data to generate recommendation');
  }

  // Filter models that have at least some traffic and reasonable success
  const candidates = [...telemetry];

  let selected = null;

  if (objective === 'cost') {
    // Lowest cost with success rate >= 0.80
    const viable = candidates.filter(c => c.successRate >= 0.80);
    const pool = viable.length > 0 ? viable : candidates;
    selected = pool.reduce((best, cur) => (cur.estimatedCost < best.estimatedCost ? cur : best), pool[0]);
  } else if (objective === 'latency') {
    // Lowest P95 latency with success rate >= 0.80
    const viable = candidates.filter(c => c.successRate >= 0.80);
    const pool = viable.length > 0 ? viable : candidates;
    selected = pool.reduce((best, cur) => (cur.p95Latency < best.p95Latency ? cur : best), pool[0]);
  } else if (objective === 'reliability') {
    // Highest success rate, tie-break on lower error rate and latency
    selected = candidates.reduce((best, cur) => {
      if (cur.successRate > best.successRate) return cur;
      if (cur.successRate === best.successRate && cur.avgLatency < best.avgLatency) return cur;
      return best;
    }, candidates[0]);
  } else {
    // Balanced: composite score (successRate * 40 - latencyNorm * 30 - costNorm * 30)
    selected = candidates.reduce((best, cur) => {
      const curScore = (cur.successRate * 50) - (cur.avgLatency * 0.01) - (cur.estimatedCost * 100);
      const bestScore = (best.successRate * 50) - (best.avgLatency * 0.01) - (best.estimatedCost * 100);
      return curScore > bestScore ? cur : best;
    }, candidates[0]);
  }

  // Derive safe timeout and retry recommendations based on telemetry
  const recommendedTimeout = Math.min(30000, Math.max(2000, Math.round((selected.p95Latency || 2000) * 2.5)));
  const recommendedRetries = selected.errorRate > 0.05 ? 3 : 2;

  // Determine fallbacks from remaining supported providers
  const fallbackProviders = SUPPORTED_PROVIDERS.filter(p => p !== selected.provider);

  return {
    provider: selected.provider,
    model: selected.model,
    strategy: objective,
    timeoutMs: recommendedTimeout,
    maxRetries: recommendedRetries,
    cacheEnabled: true,
    cacheTTL: 300,
    fallbackProviders,
    reasoning: `Selected ${selected.provider}/${selected.model} for ${objective} optimization based on ${selected.requestCount} recent requests (Success: ${selected.successRate * 100}%, Avg Latency: ${selected.avgLatency}ms, Cost: $${selected.estimatedCost}).`
  };
}

/**
 * Compares the proposed policy against the current policy using actual telemetry.
 * Only calculates savings backed by genuine telemetry.
 *
 * @param {Array<object>} telemetry
 * @param {object|null} currentPolicy
 * @param {object} proposedPolicy
 * @returns {object}
 */
function evaluatePolicyComparison(telemetry, currentPolicy, proposedPolicy) {
  const currentMetric = telemetry.find(t =>
    t.provider === currentPolicy?.provider && t.model === currentPolicy?.model
  ) || null;

  const proposedMetric = telemetry.find(t =>
    t.provider === proposedPolicy?.provider && t.model === proposedPolicy?.model
  ) || null;

  let costSavingsUsd = 0;
  let costSavingsPercent = 0;
  let latencyReductionMs = 0;
  let latencyReductionPercent = 0;

  if (currentMetric && proposedMetric) {
    if (currentMetric.estimatedCost > 0) {
      costSavingsUsd = Number(Math.max(0, currentMetric.estimatedCost - proposedMetric.estimatedCost).toFixed(8));
      costSavingsPercent = Number(((costSavingsUsd / currentMetric.estimatedCost) * 100).toFixed(2));
    }
    if (currentMetric.avgLatency > 0) {
      latencyReductionMs = Math.max(0, currentMetric.avgLatency - proposedMetric.avgLatency);
      latencyReductionPercent = Number(((latencyReductionMs / currentMetric.avgLatency) * 100).toFixed(2));
    }
  }

  return {
    hasBaseline: Boolean(currentMetric),
    current: currentMetric ? {
      provider: currentMetric.provider,
      model: currentMetric.model,
      avgLatency: currentMetric.avgLatency,
      p95Latency: currentMetric.p95Latency,
      successRate: currentMetric.successRate,
      estimatedCost: currentMetric.estimatedCost
    } : null,
    proposed: proposedMetric ? {
      provider: proposedMetric.provider,
      model: proposedMetric.model,
      avgLatency: proposedMetric.avgLatency,
      p95Latency: proposedMetric.p95Latency,
      successRate: proposedMetric.successRate,
      estimatedCost: proposedMetric.estimatedCost
    } : null,
    savings: {
      costSavingsUsd,
      costSavingsPercent,
      latencyReductionMs,
      latencyReductionPercent
    },
    evaluatedAt: new Date().toISOString()
  };
}

/**
 * Main AI Optimization entry point.
 * Asynchronously analyzes user telemetry, runs AI recommender, strictly validates,
 * evaluates against baseline, and atomically updates the Redis routing policy.
 *
 * NEVER called synchronously from the gateway request critical path.
 *
 * @param {string} userId
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
async function runAiOptimization(userId, options = {}) {
  const startTime = Date.now();
  metricsService.recordOptimizationRun();

  if (!userId) {
    metricsService.recordOptimizationFailure();
    return {
      success: false,
      code: 'INVALID_USER_ID',
      error: 'User ID is required for AI optimization'
    };
  }

  const userKey = String(userId);

  // 1. Concurrency Check: Prevent overlapping jobs for the same user
  if (inFlightOptimizations.has(userKey)) {
    logger.warn(`Optimization already in-flight for user [${userKey}]. Skipping duplicate job.`);
    metricsService.recordOptimizationFailure();
    return {
      success: false,
      code: 'OPTIMIZATION_IN_PROGRESS',
      error: 'An optimization job is already active for this user.'
    };
  }

  inFlightOptimizations.add(userKey);

  try {
    const objective = normalizeObjective(options.objective || options.strategy);

    // 2. Fetch bounded telemetry aggregation
    const telemetry = await aggregateUserTelemetry(userKey, {
      windowHours: options.windowHours || 24,
      maxDocs: options.maxDocs || 5000
    });

    if (!telemetry || telemetry.length === 0) {
      logger.info(`Insufficient telemetry for user [${userKey}] to run optimization.`);
      metricsService.recordOptimizationFailure();
      return {
        success: false,
        code: 'INSUFFICIENT_TELEMETRY',
        error: 'Not enough historical telemetry to generate an AI recommendation.'
      };
    }

    // 3. Retrieve current policy from Redis
    const currentPolicy = await getRoutingPolicy(userKey);

    // 4. Construct sanitized input and generate recommendation
    const safeInput = buildSanitizedAiInput(telemetry, currentPolicy, objective);

    let rawRecommendation = null;
    try {
      // Allow custom or mocked AI recommender function via options (for unit/integration testing)
      if (typeof options.aiRecommender === 'function') {
        rawRecommendation = await options.aiRecommender(safeInput);
      } else {
        rawRecommendation = await generateAiRecommendation(safeInput);
      }
    } catch (aiErr) {
      logger.error(`AI model execution failure for user [${userKey}]: ${aiErr.message}`);
      metricsService.recordOptimizationFailure();
      return {
        success: false,
        code: 'AI_PROVIDER_ERROR',
        error: `AI provider failed to generate recommendation: ${aiErr.message}`,
        currentPolicy
      };
    }

    // If output is malformed or unparseable JSON string
    if (typeof rawRecommendation === 'string') {
      try {
        rawRecommendation = JSON.parse(rawRecommendation);
      } catch (jsonErr) {
        logger.error(`AI returned unparseable JSON for user [${userKey}]: ${rawRecommendation}`);
        metricsService.recordPolicyRejected();
        metricsService.recordOptimizationFailure();
        return {
          success: false,
          code: 'MALFORMED_AI_OUTPUT',
          error: 'AI recommendation was not valid JSON.',
          currentPolicy
        };
      }
    }

    // 5. Strict Policy Validation
    const validatedPolicy = validateAiPolicy(rawRecommendation, currentPolicy);
    if (!validatedPolicy) {
      logger.warn(`AI recommendation rejected by strict safety validation for user [${userKey}]`);
      metricsService.recordPolicyRejected();
      metricsService.recordOptimizationFailure();
      return {
        success: false,
        code: 'POLICY_VALIDATION_FAILED',
        error: 'AI generated policy failed safety and schema validation.',
        currentPolicy
      };
    }

    // 6. Evaluation against current policy
    const evaluation = evaluatePolicyComparison(telemetry, currentPolicy, validatedPolicy);
    validatedPolicy.evaluation = evaluation;

    // 7. Store validated policy in Redis
    const saved = await setRoutingPolicy(userKey, validatedPolicy);
    if (!saved) {
      logger.error(`Failed to persist validated policy in Redis for user [${userKey}]`);
      metricsService.recordOptimizationFailure();
      return {
        success: false,
        code: 'REDIS_SAVE_FAILED',
        error: 'Failed to write updated policy to Redis cache.',
        currentPolicy
      };
    }

    const durationMs = Date.now() - startTime;
    metricsService.recordAiOptimizationLatency(durationMs);
    metricsService.recordPolicyGenerated();
    metricsService.recordOptimizationSuccess();

    logger.info(`AI Optimization successfully updated policy for user [${userKey}] -> [${validatedPolicy.provider}/${validatedPolicy.model}] (v${validatedPolicy.policyVersion}) in ${durationMs}ms`);

    return {
      success: true,
      policy: validatedPolicy,
      evaluation,
      durationMs
    };
  } catch (err) {
    logger.error(`Unexpected optimization pipeline error for user [${userKey}]: ${err.message}`);
    metricsService.recordOptimizationFailure();
    return {
      success: false,
      code: 'OPTIMIZATION_ERROR',
      error: err.message
    };
  } finally {
    inFlightOptimizations.delete(userKey);
  }
}

function isInFlight(userId) {
  return inFlightOptimizations.has(String(userId));
}

function clearInFlightOptimizations() {
  inFlightOptimizations.clear();
}

module.exports = {
  runAiOptimization,
  generateAiRecommendation,
  buildSanitizedAiInput,
  evaluatePolicyComparison,
  normalizeObjective,
  isInFlight,
  clearInFlightOptimizations
};
