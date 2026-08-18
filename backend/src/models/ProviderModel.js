const mongoose = require('mongoose');

const ProviderModelSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: String,
    required: true,
    enum: ['openai', 'gemini', 'anthropic', 'claude'] // Include 'claude' for legacy DB compatibility, normalized to 'anthropic' in logic
  },
  providerKeyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProviderKey',
    required: true
  },
  externalModelId: {
    type: String,
    required: true,
    trim: true
  },
  displayName: {
    type: String,
    trim: true,
    default: ''
  },
  capabilities: {
    text: { type: Boolean, default: null },
    streaming: { type: Boolean, default: null },
    vision: { type: Boolean, default: null },
    audio: { type: Boolean, default: null },
    tools: { type: Boolean, default: null },
    structuredOutput: { type: Boolean, default: null }
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  discoveredAt: {
    type: Date,
    default: Date.now
  },
  lastValidatedAt: {
    type: Date,
    default: Date.now
  }
});

// Unique index to prevent duplicate models for user + providerKey + externalModelId
ProviderModelSchema.index({ userId: 1, providerKeyId: 1, externalModelId: 1 }, { unique: true });

module.exports = mongoose.model('ProviderModel', ProviderModelSchema);
