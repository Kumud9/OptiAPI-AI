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

router.post('/register', validate({ body: schemas.registerSchema }), registerUser);
router.post('/login', validate({ body: schemas.loginSchema }), authUser);
router.post('/forgot-password', validate({ body: schemas.forgotPasswordSchema }), forgotPassword);
router.get('/me', protect, getUserProfile);

module.exports = router;
