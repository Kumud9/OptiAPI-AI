const express = require('express');
const router = express.Router();
const {
  getRecommendations,
  applyRecommendation
} = require('../controllers/optimizationController');
const { protect } = require('../middleware/auth');

router.use(protect);
const { validate, schemas } = require('../middleware/validate');

router.route('/recommendations')
  .get(getRecommendations);

router.route('/recommendations/:id/apply')
  .post(validate({ params: schemas.objectIdSchema }), applyRecommendation);

module.exports = router;
