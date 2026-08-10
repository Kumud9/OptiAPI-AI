const mongoose = require('mongoose');

const RecommendationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['cache_endpoint', 'duplicate_requests', 'traffic_spike', 'switch_batch', 'high_latency', 'unused_keys']
  },
  message: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    required: true,
    enum: ['high', 'medium', 'low']
  },
  savingsInr: {
    type: Number,
    required: true,
    default: 0
  },
  impactLevel: {
    type: String,
    required: true,
    enum: ['high', 'medium', 'low']
  },
  isApplied: {
    type: Boolean,
    default: false
  },
  targetEndpoint: {
    type: String,
    default: ''
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Recommendation', RecommendationSchema);
