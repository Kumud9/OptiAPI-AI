const express = require('express');
const router = express.Router();
const {
  registerUser,
  authUser,
  getUserProfile,
  forgotPassword
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

const rateLimit = require('express-rate-limit');

// Rate limiting specifically for authentication routes (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      error: 'Too many login or registration attempts. Please try again after 15 minutes.'
    });
  }
});

router.post('/register', authLimiter, validate({ body: schemas.registerSchema }), registerUser);
router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), authUser);
router.post('/forgot-password', authLimiter, validate({ body: schemas.forgotPasswordSchema }), forgotPassword);
router.get('/me', protect, getUserProfile);

module.exports = router;
