'use strict';

const { getRecommendationForUser } = require('../services/scoringService');
const logger = require('../utils/logger');

/**
 * Optimization Scoring Engine Controller
 * =======================================
 * Protected endpoint: Returns the best recommended provider/model candidate
 * based on the authenticated user's logs and chosen mode.
 *
 * Route: GET /api/v1/optimization/recommendation
 * Auth:  JWT Bearer
 */
const getRecommendation = async (req, res) => {
  const userId = req.userId || (req.user ? req.user._id : null);

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized, user identity could not be verified'
    });
  }

  let mode = req.query.mode || 'balanced';
  // Normalize "cost_optimized" or similar shorthand modes to cost/latency
  if (mode === 'cost_optimized' || mode === 'cost') {
    mode = 'cost';
  } else if (mode === 'latency_optimized' || mode === 'latency') {
    mode = 'latency';
  } else {
    mode = 'balanced';
  }

  try {
    const recommendation = await getRecommendationForUser(userId, mode);

    if (!recommendation) {
      return res.status(200).json({
        success: false,
        code: 'INSUFFICIENT_DATA',
        message: 'Not enough historical provider data to make a reliable recommendation.'
      });
    }

    return res.status(200).json({
      success: true,
      mode,
      recommendation
    });
  } catch (error) {
    logger.error(`getRecommendation error for user ${userId}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to evaluate optimization recommendation'
    });
  }
};

module.exports = {
  getRecommendation
};
