const express = require('express');
const router = express.Router();
const { getGatewayMetrics } = require('../controllers/metricsController');

router.get('/', getGatewayMetrics);

module.exports = router;
