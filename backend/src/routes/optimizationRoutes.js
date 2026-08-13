const express = require('express');
const router = express.Router();
const {
  getRecommendations,
  applyRecommendation
} = require('../controllers/optimizationController');
const { getTelemetryMetrics } = require('../controllers/telemetryController');
const { getHistoricalMetrics } = require('../controllers/historicalDataController');
const { getRecommendation } = require('../controllers/scoringController');
const { getDecision } = require('../controllers/optimizationDecisionController');

const { protect } = require('../middleware/auth');

router.use(protect);
const { validate, schemas } = require('../middleware/validate');

router.route('/recommendations')
  .get(getRecommendations);

router.route('/recommendations/:id/apply')
  .post(validate({ params: schemas.objectIdSchema }), applyRecommendation);

// Historical telemetry analysis: per-(provider, model, endpoint) metrics.
// Read-only. No external API calls. No secrets exposed.
router.get('/telemetry', getTelemetryMetrics);

// Historical data analyzer metrics.
router.get('/historical-metrics', getHistoricalMetrics);

// Recommendation scoring engine route.
router.get('/recommendation', getRecommendation);

// Optimization decision engine route.
router.get('/decision', getDecision);


module.exports = router;
