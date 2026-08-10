const express = require('express');
const router = express.Router();
const { getAdminStats, getSystemUsers } = require('../controllers/adminController');
const { protect, admin } = require('../middleware/auth');

// Protect all admin endpoints
router.use(protect);
router.use(admin);

router.get('/stats', getAdminStats);
router.get('/users', getSystemUsers);

module.exports = router;
