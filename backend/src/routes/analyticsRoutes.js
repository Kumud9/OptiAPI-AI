const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getRequestLogs
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/auth');

router.use(protect);
const { validate, schemas } = require('../middleware/validate');

router.get('/stats', getDashboardStats);
router.get('/logs', validate({ query: schemas.getLogsQuerySchema }), getRequestLogs);

module.exports = router;
