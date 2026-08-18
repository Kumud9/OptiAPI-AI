const express = require('express');
const router = express.Router();
const {
  getApiKeys,
  createApiKey,
  deleteApiKey,
  getProviderKeys,
  createProviderKey,
  deleteProviderKey,
  updateProviderKey,
  validateProvider,
  getProviderModels,
  updateProfile
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// All user actions are protected behind JWT auth
router.use(protect);

router.put('/profile', validate({ body: schemas.updateProfileSchema }), updateProfile);

router.route('/keys')
  .get(getApiKeys)
  .post(validate({ body: schemas.createApiKeySchema }), createApiKey);

router.route('/keys/:id')
  .delete(validate({ params: schemas.objectIdSchema }), deleteApiKey);

router.route('/providers')
  .get(getProviderKeys)
  .post(validate({ body: schemas.createProviderKeySchema }), createProviderKey);

router.route('/providers/:id')
  .delete(validate({ params: schemas.objectIdSchema }), deleteProviderKey)
  .patch(validate({ params: schemas.objectIdSchema, body: schemas.updateProviderKeySchema }), updateProviderKey);

router.route('/providers/:id/validate')
  .post(validate({ params: schemas.objectIdSchema }), validateProvider);

router.route('/providers/:id/models')
  .get(validate({ params: schemas.objectIdSchema }), getProviderModels);

module.exports = router;
