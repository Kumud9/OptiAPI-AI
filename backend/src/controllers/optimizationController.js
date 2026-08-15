const Recommendation = require('../models/Recommendation');
const CacheRule = require('../models/CacheRule');
const { analyzeLogsAndOptimize } = require('../services/optimizationEngine');
const logger = require('../utils/logger');

/**
 * Optimization Recommendations Management
 */

const getRecommendations = async (req, res) => {
  const userId = req.user._id;

  try {
    // 1. Fetch existing recommendations
    let recs = await Recommendation.find({ userId, isApplied: false }).sort({ createdAt: -1 });

    // 2. Dynamic log analysis fallback if list is empty
    if (recs.length === 0) {
      logger.info(`No active optimization suggestions. Triggering immediate analysis...`);
      recs = await analyzeLogsAndOptimize(userId);
    }

    return res.status(200).json({ success: true, count: recs.length, data: recs });
  } catch (error) {
    logger.error(`Get recommendations error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve optimization recommendations' });
  }
};

const applyRecommendation = async (req, res) => {
  const userId = req.user._id;

  try {
    const recommendation = await Recommendation.findOne({ _id: req.params.id, userId });

    if (!recommendation) {
      return res.status(404).json({ success: false, error: 'Recommendation not found' });
    }

    recommendation.isApplied = true;
    await recommendation.save();

    logger.info(`Optimization applied: [${recommendation.type}] for user: ${userId}`);

    // If type is cache_endpoint, automatically configure cache rule in MongoDB
    if (recommendation.type === 'cache_endpoint' && recommendation.targetEndpoint) {
      let matchedProvider = 'custom';
      
      // Attempt provider deduction from message / details
      const msg = recommendation.message.toLowerCase();
      if (msg.includes('openai')) matchedProvider = 'openai';
      else if (msg.includes('gemini')) matchedProvider = 'gemini';
      else if (msg.includes('claude')) matchedProvider = 'anthropic';
      else if (msg.includes('stripe')) matchedProvider = 'stripe';
      else if (msg.includes('google')) matchedProvider = 'google_maps';
      
      const formattedEndpoint = recommendation.targetEndpoint.startsWith('/') 
        ? recommendation.targetEndpoint 
        : `/${recommendation.targetEndpoint}`;

      // Check if CacheRule exists
      const existingRule = await CacheRule.findOne({
        userId,
        provider: matchedProvider,
        endpoint: formattedEndpoint
      });

      if (!existingRule) {
        await CacheRule.create({
          userId,
          provider: matchedProvider,
          endpoint: formattedEndpoint,
          ttlSeconds: 3600 // Auto-cache for 1 hour by default
        });
        logger.info(`Automated cache configuration applied: [${matchedProvider}] ${formattedEndpoint} cached for 3600s`);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Optimization recommendation applied successfully.',
      data: recommendation
    });
  } catch (error) {
    logger.error(`Apply recommendation error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to apply recommendation' });
  }
};

module.exports = {
  getRecommendations,
  applyRecommendation
};
