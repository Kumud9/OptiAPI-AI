const Recommendation = require('../models/Recommendation');
const CacheRule = require('../models/CacheRule');
const ProviderKey = require('../models/ProviderKey');
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

    // Filter out stale unused_keys recommendations
    const validRecs = [];
    for (const rec of recs) {
      if (rec.type === 'unused_keys') {
        const providerName = rec.targetEndpoint;
        const keyName = rec.details?.keyName;
        
        const keyExists = await ProviderKey.findOne({
          userId,
          provider: providerName,
          name: keyName,
          isActive: true
        });
        
        if (keyExists) {
          validRecs.push(rec);
        } else {
          // Cleanup stale recommendation
          await Recommendation.deleteOne({ _id: rec._id });
        }
      } else {
        validRecs.push(rec);
      }
    }
    recs = validRecs;

    // 2. Dynamic log analysis fallback if list is empty
    if (recs.length === 0) {
      logger.info(`No active optimization suggestions. Triggering immediate analysis...`);
      recs = await analyzeLogsAndOptimize(userId);
    }

    return res.status(200).json({ success: true, count: recs.length, data: recs, optimizationMode: process.env.OPTIMIZATION_MODE || 'recommendation' });
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

let globalDefaultStrategy = 'balanced';

const getSettings = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        optimizationMode: process.env.OPTIMIZATION_MODE || 'recommendation',
        optimizationEnabled: process.env.OPTIMIZATION_ENABLED === 'true',
        defaultStrategy: globalDefaultStrategy,
        automaticRoutingAllowed: process.env.OPTIMIZATION_MODE === 'automatic'
      }
    });
  } catch (error) {
    logger.error(`Get optimization settings error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve settings' });
  }
};

const updateSettings = async (req, res) => {
  const { optimizationMode, optimizationEnabled, defaultStrategy, automaticRoutingAllowed } = req.body;
  try {
    if (optimizationMode !== undefined) {
      process.env.OPTIMIZATION_MODE = optimizationMode;
    }
    if (optimizationEnabled !== undefined) {
      process.env.OPTIMIZATION_ENABLED = optimizationEnabled ? 'true' : 'false';
    }
    if (automaticRoutingAllowed !== undefined) {
      process.env.OPTIMIZATION_MODE = automaticRoutingAllowed ? 'automatic' : 'recommendation';
    }
    if (defaultStrategy !== undefined) {
      globalDefaultStrategy = defaultStrategy;
    }

    logger.info(`Global optimization settings updated: Mode=${process.env.OPTIMIZATION_MODE}, Enabled=${process.env.OPTIMIZATION_ENABLED}, Strategy=${globalDefaultStrategy}`);
    
    return res.status(200).json({
      success: true,
      message: 'Global settings updated successfully.',
      data: {
        optimizationMode: process.env.OPTIMIZATION_MODE || 'recommendation',
        optimizationEnabled: process.env.OPTIMIZATION_ENABLED === 'true',
        defaultStrategy: globalDefaultStrategy,
        automaticRoutingAllowed: process.env.OPTIMIZATION_MODE === 'automatic'
      }
    });
  } catch (error) {
    logger.error(`Update optimization settings error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
};

module.exports = {
  getRecommendations,
  applyRecommendation,
  getSettings,
  updateSettings
};
