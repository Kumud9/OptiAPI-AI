const mongoose = require('mongoose');

const RequestLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  apiKeyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ApiKey'
  },
  provider: {
    type: String,
    required: true,
    index: true
  },
  model: {
    type: String,
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    index: true
  },
  method: {
    type: String,
    required: true
  },
  status: {
    type: Number,
    required: true,
    index: true
  },
  responseTimeMs: {
    type: Number,
    required: true
  },
  costUsd: {
    type: Number,
    default: 0.0,
    index: true
  },
  tokensUsed: {
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 }
  },
  cacheStatus: {
    type: String,
    enum: ['HIT', 'MISS', 'BYPASS'],
    default: 'BYPASS',
    index: true
  },
  requestBody: {
    type: String,
    default: ''
  },
  responseBody: {
    type: String,
    default: ''
  },
  errorMessage: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound indexes for analytics dashboard querying efficiency
RequestLogSchema.index({ userId: 1, timestamp: -1 });
RequestLogSchema.index({ userId: 1, provider: 1, timestamp: -1 });

module.exports = mongoose.model('RequestLog', RequestLogSchema);
