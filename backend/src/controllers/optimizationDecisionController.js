'use strict';

const { getOptimizationDecision, SUPPORTED_PROVIDERS } = require('../services/optimizationDecisionService');
const logger = require('../utils/logger');

/**
 * Optimization Decision Engine Controller
 * =======================================
 * Protected endpoint: returns a dry-run optimization decision
 * recommending the best provider and model candidate.
 *
 * Route: GET /api/v1/optimization/decision
 * Auth:  JWT Bearer
 */
const getDecision = async (req, res) => {
  const userId = req.userId || (req.user ? req.user._id : null);

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized, user identity could not be verified'
    });
  }

  // 1. Validate Mode
  const mode = req.query.mode;
  if (!mode) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_MODE',
      message: 'Mode must be balanced, cost, or latency.'
    });
  }

  if (!['balanced', 'cost', 'latency'].includes(mode)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_MODE',
      message: 'Mode must be balanced, cost, or latency.'
    });
  }

  // 2. Validate Providers Filter (if supplied)
  let providersFilter = null;
  const providersQuery = req.query.providers;
  if (providersQuery) {
    // split by comma and trim
    const providersList = providersQuery.split(',').map(p => p.trim().toLowerCase());
    
    // Check if any provider in list is unsupported
    const hasInvalid = providersList.some(p => !SUPPORTED_PROVIDERS.includes(p));
    if (hasInvalid) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PROVIDER',
        message: `Supported providers are: ${SUPPORTED_PROVIDERS.join(', ')}`
      });
    }
    providersFilter = providersList;
  }

  try {
    const decisionResponse = await getOptimizationDecision(userId, mode, providersFilter);

    if (!decisionResponse) {
      return res.status(200).json({
        success: false,
        code: 'INSUFFICIENT_DATA',
        message: 'Not enough historical provider data to make a reliable optimization decision.'
      });
    }

    return res.status(200).json(decisionResponse);
  } catch (error) {
    logger.error(`getDecision error for user ${userId}: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to evaluate optimization decision'
    });
  }
};

module.exports = {
  getDecision
};
