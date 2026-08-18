const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const logger = require('../utils/logger');

/**
 * Middleware to protect routes via JWT validation (Dashboard / App traffic)
 */
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'optiapi_secret_key_for_jwt_tokens_2026_secure');
      
      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'User not found in system' });
      }
      next();
    } catch (error) {
      logger.error(`Authentication validation failed: ${error.message}`);
      return res.status(401).json({ success: false, error: 'Not authorized, token validation failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized, token missing' });
  }
};

/**
 * Middleware to restrict action to Administrator role only
 */
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ success: false, error: 'Forbidden, admin authorization required' });
  }
};

/**
 * Middleware to authenticate API Gateway client requests using client API key header
 */
const verifyGatewayKey = async (req, res, next) => {
  // Retrieve apiKey case-insensitively from req.headers or via req.header() helper
  let apiKey = req.header('x-api-key');

  if (!apiKey && req.headers) {
    const target = 'x-api-key';
    const match = Object.keys(req.headers).find(k => k.toLowerCase() === target);
    if (match) {
      apiKey = req.headers[match];
    }
  }

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Gateway access denied, x-api-key header missing' });
  }

  try {
    const keyDoc = await ApiKey.findOne({ key: apiKey, isActive: true });
    
    if (!keyDoc) {
      return res.status(401).json({ success: false, error: 'Gateway access denied, invalid or inactive API key' });
    }

    // Attach details to request for downstream middlewares
    req.gatewayKey = keyDoc;
    req.userId = keyDoc.userId;
    
    // Asynchronously increment usage counter
    keyDoc.usageCount += 1;
    await keyDoc.save();
    
    next();
  } catch (error) {
    logger.error(`Gateway authentication middleware error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Internal gateway authentication error' });
  }
};

module.exports = {
  protect,
  admin,
  verifyGatewayKey
};
