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
    
    // Mask real API key values before sending to UI
    const maskedKeys = keys.map(key => ({
      _id: key._id,
      provider: key.provider,
      name: key.name,
      value: key.getMaskedValue(),
      isActive: key.isActive,
      createdAt: key.createdAt
    }));

    return res.status(200).json({ success: true, count: keys.length, data: maskedKeys });
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

    return res.status(201).json({
      success: true,
      data: {
        _id: providerKey._id,
        provider: providerKey.provider,
        name: providerKey.name,
        value: providerKey.getMaskedValue(),
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
  updateProfile
};
