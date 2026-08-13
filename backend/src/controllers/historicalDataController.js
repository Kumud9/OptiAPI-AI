'use strict';

const { getHistoricalMetricsForUser } = require('../services/historicalDataService');
const logger = require('../utils/logger');

/**
 * Historical Data Analyzer Controller
 * ===================================
 * Read-only endpoint: returns historical per-(provider, model, endpoint)
 * performance and reliability metrics for the authenticated user.
 *
 * Route: GET /api/v1/optimization/historical-metrics
 * Auth:  JWT Bearer (protect middleware applied at router level)
 */
const getHistoricalMetrics = async (req, res) => {
  // Use req.userId (e.g. from gateway auth) or req.user._id (from standard protect middleware)
  const userId = req.userId || (req.user ? req.user._id : null);

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized, user identity could not be verified'
    });
  }

  try {
    const metrics = await getHistoricalMetricsForUser(userId);

    return res.status(200).json({
      success: true,
      userId: String(userId),
      count: metrics.length,
      data: metrics
    });
  } catch (error) {
    logger.error(`getHistoricalMetrics error for user ${userId}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to compute historical metrics'
    });
  }
};

module.exports = {
  getHistoricalMetrics
};
