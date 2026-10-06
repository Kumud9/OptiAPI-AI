const { getMetrics } = require('../services/metricsService');
const { getAllCircuitStates } = require('../services/circuitBreakerService');

/**
 * Controller to expose in-memory gateway performance metrics.
 * GET /api/metrics
 */
const getGatewayMetrics = (req, res) => {
  const metrics = getMetrics();
  const circuits = getAllCircuitStates ? getAllCircuitStates() : {};
  return res.status(200).json({
    success: true,
    ...metrics,
    circuits
  });
};

module.exports = {
  getGatewayMetrics
};
