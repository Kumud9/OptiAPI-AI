const ApiKey = require('../models/ApiKey');
const ProviderKey = require('../models/ProviderKey');
const User = require('../models/User');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * API Keys (Gateway credentials) Management
 */

const getApiKeys = async (req, res) => {
  try {
    const keys = await ApiKey.find({ userId: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: keys.length, data: keys });
  } catch (error) {
    logger.error(`Get API keys error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve API keys' });
  }
};

const createApiKey = async (req, res) => {
  const { name, rateLimitRps } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, error: 'Please provide a name for the API key' });
  }

  try {
    // Generate secure random string prefixed with 'opti_live_'
    const randomBytes = crypto.randomBytes(24).toString('hex');
    const key = `opti_live_${randomBytes}`;

    const apiKey = await ApiKey.create({
      userId: req.user._id,
      name,
      key,
      rateLimitRps: rateLimitRps || 10
    });

    logger.info(`New Gateway API Key created: [${name}] for user ${req.user.email}`);
    return res.status(201).json({ success: true, data: apiKey });
  } catch (error) {
    logger.error(`Create API key error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to generate API key' });
  }
};

const deleteApiKey = async (req, res) => {
  try {
    const apiKey = await ApiKey.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!apiKey) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }
    logger.info(`Gateway API Key deleted: ${req.params.id}`);
    return res.status(200).json({ success: true, data: {} });
  } catch (error) {
    logger.error(`Delete API key error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to delete API key' });
  }
};

/**
 * Provider Keys (Stored third-party credentials vault) Management
 */

const getProviderKeys = async (req, res) => {
  try {
    const keys = await ProviderKey.find({ userId: req.user._id }).sort({ createdAt: -1 });
    const ProviderModel = require('../models/ProviderModel');
    
    // Mask real API key values before sending to UI
    const maskedKeys = await Promise.all(keys.map(async key => {
      let providerNormalized = key.provider.toLowerCase();
      if (providerNormalized === 'claude') {
        providerNormalized = 'anthropic';
      }
      const modelsCount = await ProviderModel.countDocuments({ providerKeyId: key._id, isAvailable: true });
      return {
        _id: key._id,
        provider: providerNormalized,
        name: key.name,
        value: key.getMaskedValue(),
        isActive: key.isActive,
        validationStatus: key.validationStatus || 'not_configured',
        lastValidatedAt: key.lastValidatedAt || null,
        validationErrorCode: key.validationErrorCode || null,
        modelsDiscovered: modelsCount,
        createdAt: key.createdAt
      };
    }));

    return res.status(200).json({ success: true, count: maskedKeys.length, data: maskedKeys });
  } catch (error) {
    logger.error(`Get provider credentials error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve credentials' });
  }
};

const createProviderKey = async (req, res) => {
  const { provider, name, value } = req.body;

  if (!provider || !name || !value) {
    return res.status(400).json({ success: false, error: 'Please provide provider, name, and API key value' });
  }

  try {
    // If provider key already exists for this provider and user, update it, otherwise create
    let providerKey = await ProviderKey.findOne({ userId: req.user._id, provider });

    if (providerKey) {
      providerKey.name = name;
      providerKey.value = value;
      await providerKey.save();
      logger.info(`Updated external credentials for provider [${provider}]`);
    } else {
      providerKey = await ProviderKey.create({
        userId: req.user._id,
        provider,
        name,
        value
      });
      logger.info(`Created new credentials entry for provider [${provider}]`);
    }

    let providerNormalized = providerKey.provider.toLowerCase();
    if (providerNormalized === 'claude') {
      providerNormalized = 'anthropic';
    }

    return res.status(201).json({
      success: true,
      data: {
        _id: providerKey._id,
        provider: providerNormalized,
        name: providerKey.name,
        value: providerKey.getMaskedValue(),
        isActive: providerKey.isActive,
        validationStatus: providerKey.validationStatus || 'not_configured',
        lastValidatedAt: providerKey.lastValidatedAt || null,
        validationErrorCode: providerKey.validationErrorCode || null,
        modelsDiscovered: 0,
        createdAt: providerKey.createdAt
      }
    });
  } catch (error) {
    logger.error(`Save provider key error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to save provider key' });
  }
};

const deleteProviderKey = async (req, res) => {
  try {
    const key = await ProviderKey.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Provider credentials not found' });
    }
    logger.info(`External credentials deleted: [${key.provider}]`);
    return res.status(200).json({ success: true, data: {} });
  } catch (error) {
    logger.error(`Delete provider key error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to delete provider key' });
  }
};

const updateProviderKey = async (req, res) => {
  const { name, isActive } = req.body;
  try {
    const key = await ProviderKey.findOne({ _id: req.params.id, userId: req.user._id });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Provider credentials not found' });
    }
    if (name !== undefined) key.name = name;
    if (isActive !== undefined) key.isActive = isActive;
    await key.save();
    
    let providerNormalized = key.provider.toLowerCase();
    if (providerNormalized === 'claude') {
      providerNormalized = 'anthropic';
    }

    const ProviderModel = require('../models/ProviderModel');
    const modelsCount = await ProviderModel.countDocuments({ providerKeyId: key._id, isAvailable: true });

    logger.info(`External credentials updated for provider [${providerNormalized}]: active status = ${key.isActive}`);
    return res.status(200).json({
      success: true,
      data: {
        _id: key._id,
        provider: providerNormalized,
        name: key.name,
        value: key.getMaskedValue(),
        isActive: key.isActive,
        validationStatus: key.validationStatus || 'not_configured',
        lastValidatedAt: key.lastValidatedAt || null,
        validationErrorCode: key.validationErrorCode || null,
        modelsDiscovered: modelsCount,
        createdAt: key.createdAt
      }
    });
  } catch (error) {
    logger.error(`Update provider key error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to update provider key' });
  }
};

const validateProvider = async (req, res) => {
  try {
    const key = await ProviderKey.findOne({ _id: req.params.id, userId: req.user._id });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Provider credentials not found' });
    }

    const { validateProviderKey } = require('../services/providerValidationService');
    const validationResult = await validateProviderKey(key);
    
    return res.status(200).json(validationResult);
  } catch (error) {
    logger.error(`Controller validateProvider error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to execute credential validation' });
  }
};

const getProviderModels = async (req, res) => {
  try {
    const key = await ProviderKey.findOne({ _id: req.params.id, userId: req.user._id });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Provider credentials not found' });
    }
    const ProviderModel = require('../models/ProviderModel');
    const models = await ProviderModel.find({ providerKeyId: key._id });
    return res.status(200).json({ success: true, data: models });
  } catch (error) {
    logger.error(`Get provider models error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve provider models' });
  }
};

/**
 * Profile Management
 */
const updateProfile = async (req, res) => {
  const { organization, password } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (organization !== undefined) user.organization = organization;
    if (password) user.password = password;

    await user.save();
    logger.info(`User profile updated: ${user.email}`);
    
    return res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        email: user.email,
        organization: user.organization,
        role: user.role
      }
    });
  } catch (error) {
    logger.error(`Update profile error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
};

module.exports = {
  getApiKeys,
  createApiKey,
  deleteApiKey,
  getProviderKeys,
  createProviderKey,
  deleteProviderKey,
  updateProviderKey,
  validateProvider,
  getProviderModels,
  updateProfile
};
