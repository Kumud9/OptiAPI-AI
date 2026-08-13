/**
 * Telemetry Analysis Controller
 * ==============================
 * Read-only endpoint: returns historical per-(provider, model, endpoint)
 * performance and reliability metrics for the authenticated user.
 *
 * Route: GET /api/v1/optimization/telemetry
 * Auth:  JWT Bearer (protect middleware applied at router level)
 *
 * No writes, no external API calls, no secrets exposed.
 */

'use strict';

const { buildTelemetryMetrics } = require('../services/telemetryAnalysis');
const logger = require('../utils/logger');

const getTelemetryMetrics = async (req, res) => {
  const userId = req.user._id;

  try {
    const metrics = await buildTelemetryMetrics(userId);

    return res.status(200).json({
      success: true,
      userId: String(userId),
      count: metrics.length,
      data: metrics
    });
  } catch (error) {
    logger.error(`getTelemetryMetrics error for user ${userId}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to compute telemetry metrics'
    });
  }
};

module.exports = {
  getTelemetryMetrics
};
