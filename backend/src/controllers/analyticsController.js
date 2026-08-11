const RequestLog = require('../models/RequestLog');
const Recommendation = require('../models/Recommendation');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');


/**
 * Dashboard & Analytics Data Aggregator
 */
const getDashboardStats = async (req, res) => {
  const userId = req.user._id;

  try {
    // 1. Time limits setup
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 2. Parallel aggregation calculations for performance
    const [
      totalRequests,
      costStats,
      monthlyCostStats,
      cacheStats,
      latencyStats,
      failedStats,
      providers,
      recommendations
    ] = await Promise.all([
      // Total requests
      RequestLog.countDocuments({ userId }),
      
      // Total cost (USD)
      RequestLog.aggregate([
        { $match: { userId } },
        { $group: { _id: null, total: { $sum: '$costUsd' } } }
      ]),

      // Monthly cost (USD)
      RequestLog.aggregate([
        { $match: { userId, timestamp: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$costUsd' } } }
      ]),

      // Cache hit/miss counts
      RequestLog.aggregate([
        { $match: { userId, cacheStatus: { $in: ['HIT', 'MISS'] } } },
        { $group: { _id: '$cacheStatus', count: { $sum: 1 } } }
      ]),

      // Avg latency
      RequestLog.aggregate([
        { $match: { userId, status: 200 } },
        { $group: { _id: null, avgLatency: { $avg: '$responseTimeMs' } } }
      ]),

      // Failed request counts (status not 200 or 202)
      RequestLog.countDocuments({ userId, status: { $nin: [200, 202] } }),

      // Active unique providers
      RequestLog.distinct('provider', { userId }),

      // Recommendations for savings calculation
      Recommendation.find({ userId, isApplied: false })
    ]);

    // Rate-limit violations: read from the Redis counter incremented by rateLimiter.js.
    // RequestLog is never written for 429s (rate limiter fires before handleGatewayRequest),
    // so this must come from Redis, not MongoDB.
    const redis = getRedisClient();
    const rlViolationRaw = await redis.get(`rl_violations:${userId}`);
    const rateLimitStats = rlViolationRaw ? parseInt(rlViolationRaw, 10) : 0;


    // 3. Extract aggregated values
    const totalCost = costStats[0] ? costStats[0].total : 0.0;
    const monthlyCost = monthlyCostStats[0] ? monthlyCostStats[0].total : 0.0;
    const avgResponseTime = latencyStats[0] ? Math.round(latencyStats[0].avgLatency) : 0;

    let hitCount = 0;
    let missCount = 0;
    cacheStats.forEach(bucket => {
      if (bucket._id === 'HIT') hitCount = bucket.count;
      if (bucket._id === 'MISS') missCount = bucket.count;
    });

    const cacheTotal = hitCount + missCount;
    const cacheHitRatio = cacheTotal > 0 ? parseFloat((hitCount / cacheTotal).toFixed(4)) : 0.0;
    const cacheMissRatio = cacheTotal > 0 ? parseFloat((missCount / cacheTotal).toFixed(4)) : 0.0;

    // 4. Calculate Optimization Metrics
    const estimatedSavings = recommendations.reduce((acc, rec) => acc + rec.savingsInr, 0);
    
    // Optimization score deductions: high priority = -10, medium = -5, low = -2
    let optScore = 100;
    recommendations.forEach(rec => {
      if (rec.priority === 'high') optScore -= 10;
      else if (rec.priority === 'medium') optScore -= 5;
      else optScore -= 2;
    });
    optScore = Math.max(35, optScore);

    // 5. Gather daily aggregate trends for charts (Past 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyTrends = await RequestLog.aggregate([
      { $match: { userId, timestamp: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          requests: { $sum: 1 },
          cost: { $sum: '$costUsd' },
          hits: { $sum: { $cond: [{ $eq: ['$cacheStatus', 'HIT'] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 6. Gather provider breakdown stats for pie chart
    const providerTrends = await RequestLog.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$provider',
          requests: { $sum: 1 },
          cost: { $sum: '$costUsd' }
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalRequests,
          totalCost: parseFloat(totalCost.toFixed(4)),
          monthlyCost: parseFloat(monthlyCost.toFixed(4)),
          cacheHitRatio,
          cacheMissRatio,
          avgResponseTime,
          failedRequests: failedStats,
          rateLimitViolations: rateLimitStats,
          activeApis: providers.length,
          optimizationScore: optScore,
          estimatedMonthlySavings: estimatedSavings
        },
        charts: {
          dailyTrends,
          providerTrends
        }
      }
    });
  } catch (error) {
    logger.error(`Fetch Dashboard metrics failure: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Internal analytics engine failure' });
  }
};

/**
 * Retrieves lists of request log transactions. Supporting simple paginated searches.
 */
const getRequestLogs = async (req, res) => {
  const userId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const filter = { userId };
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.cacheStatus) filter.cacheStatus = req.query.cacheStatus;
  if (req.query.status) filter.status = parseInt(req.query.status, 10);

  try {
    const logs = await RequestLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const total = await RequestLog.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: {
        page,
        pages: Math.ceil(total / limit),
        total,
        data: logs
      }
    });
  } catch (error) {
    logger.error(`Fetch Request Logs error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve request logs' });
  }
};

module.exports = {
  getDashboardStats,
  getRequestLogs
};
