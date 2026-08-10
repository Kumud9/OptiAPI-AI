const express = require('express');
const router = express.Router();
const {
  getCacheRules,
  createCacheRule,
  deleteCacheRule,
  clearUserCache
} = require('../controllers/cacheController');
const { protect } = require('../middleware/auth');

router.use(protect);
const { validate, schemas } = require('../middleware/validate');

router.route('/rules')
  .get(getCacheRules)
  .post(validate({ body: schemas.createCacheRuleSchema }), createCacheRule);

router.route('/rules/:id')
  .delete(validate({ params: schemas.objectIdSchema }), deleteCacheRule);

router.post('/clear', clearUserCache);

module.exports = router;
