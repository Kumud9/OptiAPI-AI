const express = require('express');
const router = express.Router();
const { handleGatewayRequest } = require('../controllers/gatewayController');
const { verifyGatewayKey } = require('../middleware/auth');
const { gatewayRateLimiter } = require('../middleware/rateLimiter');
const { gatewayCache } = require('../middleware/cache');

const { validateGateway } = require('../middleware/validate');

/**
 * Main API Gateway interceptor route.
 * Matches all HTTP verbs (GET, POST, etc.) for any provider endpoint.
 * Example: /api/v1/gateway/openai/v1/chat/completions
 */
router.all('/:provider*', validateGateway, verifyGatewayKey, gatewayRateLimiter, gatewayCache, handleGatewayRequest);

module.exports = router;
