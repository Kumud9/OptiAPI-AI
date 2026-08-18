const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const ProviderKeySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: String,
    required: true,
    enum: ['openai', 'gemini', 'claude', 'anthropic', 'google_maps', 'stripe', 'twilio', 'weather', 'custom']
  },
  name: {
    type: String,
    required: [true, 'Please provide a descriptive name for this credentials set'],
    trim: true
  },
  value: {
    type: String,
    required: [true, 'Please provide the API key value']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  validationStatus: {
    type: String,
    enum: [
      'not_configured', 'validating', 'connected', 'validation_failed', 'unavailable',
      'healthy', 'rate_limited', 'quota_exhausted', 'authentication_failed', 'unknown'
    ],
    default: 'not_configured'
  },
  lastValidatedAt: {
    type: Date
  },
  validationErrorCode: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to automatically encrypt the provider credential value
ProviderKeySchema.pre('save', function (next) {
  if (!this.isModified('value')) return next();
  try {
    if (!this.value.startsWith('v1:')) {
      this.value = encrypt(this.value);
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Avoid returning raw API key values to UI by default; decrypt and mask them
ProviderKeySchema.methods.getMaskedValue = function () {
  if (!this.value) return '';
  const decrypted = decrypt(this.value);
  if (decrypted.length <= 8) return '********';
  return `${decrypted.substring(0, 4)}...${decrypted.substring(decrypted.length - 4)}`;
};

// Expose decrypted value for in-memory use immediately before provider operations
ProviderKeySchema.methods.getDecryptedValue = function () {
  return decrypt(this.value);
};

module.exports = mongoose.model('ProviderKey', ProviderKeySchema);
