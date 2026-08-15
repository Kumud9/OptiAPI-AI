'use strict';

const { evaluateOptimization } = require('../services/optimizationEvaluationService');
const logger = require('../utils/logger');

/**
 * Optimization Evaluation Controller
 * ==================================
 * Read-only protected endpoint: returns performance evaluation metrics
 * of optimizer-controlled requests for the authenticated user, comparing
 * them to historical baselines when available.
 *
 * Route: GET /api/v1/optimization/evaluation
 * Auth:  JWT Bearer
 */
const getOptimizationEvaluation = async (req, res) => {
  const userId = req.userId || (req.user ? req.user._id : null);

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized, user identity could not be verified'
    });
  }

  const { mode, provider, model } = req.query;

  try {
    const evaluation = await evaluateOptimization(userId, { mode, provider, model });

    if (!evaluation) {
      return res.status(200).json({
        success: false,
        code: 'NO_OPTIMIZED_DATA',
        message: 'No optimizer-controlled requests are available for evaluation.'
      });
    }

    return res.status(200).json({
      success: true,
      data: evaluation
    });
  } catch (error) {
    logger.error(`getOptimizationEvaluation error for user ${userId}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to evaluate optimization performance'
    });
  }
};

module.exports = {
  getOptimizationEvaluation
};
