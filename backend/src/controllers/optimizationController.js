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
        const createdRule = await CacheRule.create({
          userId,
          provider: matchedProvider,
          endpoint: formattedEndpoint,
          ttlSeconds: 3600 // Auto-cache for 1 hour by default
        });

        // Populate Redis cache for this new rule
        try {
          const { setCachedRule } = require('../services/cacheRuleService');
          await setCachedRule(userId, matchedProvider, formattedEndpoint, createdRule);
        } catch (ruleCacheErr) {
          logger.warn(`Failed to cache new rule in Redis: ${ruleCacheErr.message}`);
        }

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

const User = require('../models/User');

const getSettings = async (req, res) => {
  try {
    const userId = req.user ? req.user._id : null;
    let userSettings = {};

    if (userId) {
      const user = await User.findById(userId);
      if (user && user.optimizationSettings) {
        userSettings = user.optimizationSettings;
      }
    }

    const optimizationMode = userSettings.optimizationMode || process.env.OPTIMIZATION_MODE || 'recommendation';
    const optimizationEnabled = userSettings.optimizationEnabled !== undefined
      ? userSettings.optimizationEnabled
      : (process.env.OPTIMIZATION_ENABLED === 'true');
    const defaultStrategy = userSettings.defaultStrategy || 'balanced';
    const automaticRoutingAllowed = userSettings.automaticRoutingAllowed !== undefined
      ? userSettings.automaticRoutingAllowed
      : (optimizationMode === 'automatic');

    // Retrieve active AI routing policy from Redis
    const { getRoutingPolicy } = require('../services/policyService');
    const activePolicy = userId ? await getRoutingPolicy(userId) : null;

    return res.status(200).json({
      success: true,
      data: {
        optimizationMode,
        optimizationEnabled,
        defaultStrategy,
        automaticRoutingAllowed,
        activePolicy: activePolicy || null
      }
    });
  } catch (error) {
    logger.error(`Get optimization settings error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve settings' });
  }
};

const getActivePolicy = async (req, res) => {
  try {
    const userId = req.user ? req.user._id : req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { getRoutingPolicy } = require('../services/policyService');
    const policy = await getRoutingPolicy(userId);
    return res.status(200).json({
      success: true,
      data: policy || null
    });
  } catch (error) {
    logger.error(`Get active policy error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve active policy' });
  }
};

const updateSettings = async (req, res) => {
  const { optimizationMode, optimizationEnabled, defaultStrategy, automaticRoutingAllowed } = req.body;
  const userId = req.user ? req.user._id : null;

  try {
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!user.optimizationSettings) {
      user.optimizationSettings = {};
    }

    if (optimizationMode !== undefined) {
      user.optimizationSettings.optimizationMode = optimizationMode;
    }
    if (optimizationEnabled !== undefined) {
      user.optimizationSettings.optimizationEnabled = Boolean(optimizationEnabled);
    }
    if (automaticRoutingAllowed !== undefined) {
      user.optimizationSettings.automaticRoutingAllowed = Boolean(automaticRoutingAllowed);
      if (automaticRoutingAllowed) {
        user.optimizationSettings.optimizationMode = 'automatic';
      } else if (optimizationMode === undefined) {
        user.optimizationSettings.optimizationMode = 'recommendation';
      }
    }
    if (defaultStrategy !== undefined) {
      user.optimizationSettings.defaultStrategy = defaultStrategy;
    }

    await user.save();

    logger.info(`User [${userId}] optimization settings updated: Mode=${user.optimizationSettings.optimizationMode}, Enabled=${user.optimizationSettings.optimizationEnabled}, Strategy=${user.optimizationSettings.defaultStrategy}`);

    return res.status(200).json({
      success: true,
      message: 'Settings updated successfully.',
      data: {
        optimizationMode: user.optimizationSettings.optimizationMode,
        optimizationEnabled: user.optimizationSettings.optimizationEnabled,
        defaultStrategy: user.optimizationSettings.defaultStrategy,
        automaticRoutingAllowed: user.optimizationSettings.automaticRoutingAllowed
      }
    });
  } catch (error) {
    logger.error(`Update optimization settings error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
};

const { runAiOptimization } = require('../services/aiOptimizationService');

const runOptimization = async (req, res) => {
  const userId = req.user?._id || req.userId;
  const { objective, windowHours } = req.body || {};

  try {
    const result = await runAiOptimization(userId, { objective, windowHours });
    if (!result.success) {
      const status = result.code === 'OPTIMIZATION_IN_PROGRESS'
        ? 409
        : (result.code === 'INSUFFICIENT_TELEMETRY' ? 400 : 422);
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    logger.error(`Optimization run controller error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  getRecommendations,
  applyRecommendation,
  getSettings,
  updateSettings,
  runOptimization,
  getActivePolicy
};
