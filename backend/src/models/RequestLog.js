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
  },
  optimizationEnabled: {
    type: Boolean,
    default: false
  },
  optimizationUsed: {
    type: Boolean,
    default: false,
    index: true
  },
  optimizationMode: {
    type: String,
    default: null
  },
  optimizationSelectedProvider: {
    type: String,
    default: null
  },
  optimizationSelectedModel: {
    type: String,
    default: null
  },
  requestedProvider: {
    type: String,
    default: null
  },
  requestedModel: {
    type: String,
    default: null
  },
  recommendedProvider: {
    type: String,
    default: null
  },
  recommendedModel: {
    type: String,
    default: null
  },
  recommendationScore: {
    type: Number,
    default: null
  },
  costScore: {
    type: Number,
    default: null
  },
  latencyScore: {
    type: Number,
    default: null
  },
  reliabilityScore: {
    type: Number,
    default: null
  },
  actualProvider: {
    type: String,
    default: null
  },
  actualModel: {
    type: String,
    default: null
  },
  routedProvider: {
    type: String,
    default: null
  },
  inputProvider: {
    type: String,
    default: null
  },
  inputModel: {
    type: String,
    default: null
  }
});

// Compound indexes for analytics dashboard querying efficiency
RequestLogSchema.index({ userId: 1, timestamp: -1 });
RequestLogSchema.index({ userId: 1, provider: 1, timestamp: -1 });

module.exports = mongoose.model('RequestLog', RequestLogSchema);
