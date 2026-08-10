const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'optiapi_secret_key_for_jwt_tokens_2026_secure', {
    expiresIn: '30d'
  });
};

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 */
const registerUser = async (req, res) => {
  const { email, password, organization } = req.body;

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ success: false, error: 'User already exists with this email address' });
    }

    const user = await User.create({
      email,
      password,
      organization: organization || ''
    });

    if (user) {
      logger.info(`User registered successfully: ${user.email}`);
      return res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          email: user.email,
          organization: user.organization,
          role: user.role,
          token: generateToken(user._id)
        }
      });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid user registration input' });
    }
  } catch (error) {
    logger.error(`Register user error: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/v1/auth/login
 */
const authUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).select('+password');

    if (user && (await user.comparePassword(password))) {
      logger.info(`User authenticated successfully: ${user.email}`);
      return res.status(200).json({
        success: true,
        data: {
          _id: user._id,
          email: user.email,
          organization: user.organization,
          role: user.role,
          token: generateToken(user._id)
        }
      });
    } else {
      return res.status(401).json({ success: false, error: 'Invalid email address or password' });
    }
  } catch (error) {
    logger.error(`Auth user error: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/v1/auth/me
 */
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      return res.status(200).json({
        success: true,
        data: {
          _id: user._id,
          email: user.email,
          organization: user.organization,
          role: user.role,
          createdAt: user.createdAt
        }
      });
    } else {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
  } catch (error) {
    logger.error(`Get profile error: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc    Mock forgot password recovery link
 * @route   POST /api/v1/auth/forgot-password
 */
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found with this email' });
    }

    logger.info(`Password recovery link simulated for email: ${email}`);
    return res.status(200).json({
      success: true,
      message: 'Password recovery email sent successfully. (Recovery Link simulated in logs)'
    });
  } catch (error) {
    logger.error(`Forgot password error: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  registerUser,
  authUser,
  getUserProfile,
  forgotPassword
};
