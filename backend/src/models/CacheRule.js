const mongoose = require('mongoose');

const CacheRuleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: String,
    required: true, // e.g. openai, gemini, custom
    index: true
  },
  endpoint: {
    type: String,
    required: true, // e.g. /v1/chat/completions or /v1/embeddings
    index: true
  },
  ttlSeconds: {
    type: Number,
    required: true,
    default: 3600 // 1 hour default caching
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Avoid duplicate cache rules for same user-provider-endpoint
CacheRuleSchema.index({ userId: 1, provider: 1, endpoint: 1 }, { unique: true });

module.exports = mongoose.model('CacheRule', CacheRuleSchema);
