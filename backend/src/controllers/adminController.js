const User = require('../models/User');
const RequestLog = require('../models/RequestLog');
const ApiKey = require('../models/ApiKey');
const logger = require('../utils/logger');

/**
 * Admin Dashboard System Aggregator
 */
const getAdminStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalRequests,
      systemCostAgg,
      cacheStats,
      activeKeysCount
    ] = await Promise.all([
      User.countDocuments(),
      RequestLog.countDocuments(),
      RequestLog.aggregate([
        { $group: { _id: null, total: { $sum: '$costUsd' } } }
      ]),
      RequestLog.aggregate([
        { $match: { cacheStatus: { $in: ['HIT', 'MISS'] } } },
        { $group: { _id: '$cacheStatus', count: { $sum: 1 } } }
      ]),
      ApiKey.countDocuments({ isActive: true })
    ]);

    const systemTotalCost = systemCostAgg[0] ? systemCostAgg[0].total : 0.0;

    let hitCount = 0;
    let missCount = 0;
    cacheStats.forEach(bucket => {
      if (bucket._id === 'HIT') hitCount = bucket.count;
      if (bucket._id === 'MISS') missCount = bucket.count;
    });

    const cacheTotal = hitCount + missCount;
    const cacheHitRatio = cacheTotal > 0 ? parseFloat((hitCount / cacheTotal).toFixed(4)) : 0.0;

    // Get monthly registration timeline
    const userGrowth = await User.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          registrations: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalRequests,
        totalSystemCost: parseFloat(systemTotalCost.toFixed(4)),
        activeKeysCount,
        cacheHitRatio,
        userGrowth
      }
    });
  } catch (error) {
    logger.error(`Get admin stats error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve administrator metrics' });
  }
};

const getSystemUsers = async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).select('-password');
    return res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    logger.error(`Get system users error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve user listing' });
  }
};

module.exports = {
  getAdminStats,
  getSystemUsers
};
