const RequestLog = require('../models/RequestLog');
const Recommendation = require('../models/Recommendation');
const ProviderKey = require('../models/ProviderKey');
const logger = require('../utils/logger');

/**
 * Runs cost optimization rules on a user's logs and generates recommendations
 * @param {string} userId User ID to analyze logs for
 */
const analyzeLogsAndOptimize = async (userId) => {
  try {
    logger.info(`Running cost optimization engine for user: ${userId}`);
    const timeLimit = new Date();
    timeLimit.setDate(timeLimit.getDate() - 7); // Analyze past 7 days of logs

    // Fetch logs
    const logs = await RequestLog.find({ userId, timestamp: { $gte: timeLimit } });
    if (!logs.length) {
      logger.info('Not enough log data to run optimization analysis.');
      return [];
    }

    const recommendations = [];

    // Rule 1: High Latency Detection
    // Group logs by provider and endpoint to calculate avg latency
    const endpointStats = {};
    logs.forEach(log => {
      const key = `${log.provider}#${log.endpoint}`;
      if (!endpointStats[key]) {
        endpointStats[key] = { provider: log.provider, endpoint: log.endpoint, latencies: [], costs: [], count: 0, cacheStatus: [] };
      }
      endpointStats[key].latencies.push(log.responseTimeMs);
      endpointStats[key].costs.push(log.costUsd);
      endpointStats[key].count += 1;
      endpointStats[key].cacheStatus.push(log.cacheStatus);
    });

    for (const [key, stats] of Object.entries(endpointStats)) {
      const avgLatency = stats.latencies.reduce((a, b) => a + b, 0) / stats.count;
      const totalCost = stats.costs.reduce((a, b) => a + b, 0);
      const cacheHits = stats.cacheStatus.filter(status => status === 'HIT').length;
      const cacheHitRatio = cacheHits / stats.count;

      // If latency is high (>1200ms) and cache hit ratio is low (<30%), suggest caching
      if (avgLatency > 1200 && cacheHitRatio < 0.3 && stats.count > 10) {
        const estSavings = Math.round(totalCost * 0.4 * 30 * 84); // Estimate monthly savings in INR (converting USD to INR * 84)
        if (estSavings > 500) {
          recommendations.push({
            userId,
            type: 'cache_endpoint',
            message: `High latency detected on ${stats.provider} ${stats.endpoint}. Cache this endpoint to speed up response times and reduce API costs.`,
            priority: 'high',
            savingsInr: estSavings,
            impactLevel: 'high',
            targetEndpoint: stats.endpoint,
            details: { avgLatency: Math.round(avgLatency), count: stats.count, currentHitRatio: Math.round(cacheHitRatio * 100) }
          });
        }
      }
    }

    // Rule 2: Duplicate Requests (Exact same request bodies)
    // Find duplicate POST requests within a short interval (e.g. 10s)
    const postLogs = logs.filter(log => log.method === 'POST' && log.requestBody && log.cacheStatus !== 'HIT');
    let duplicateCount = 0;
    let duplicateCost = 0;

    for (let i = 0; i < postLogs.length; i++) {
      for (let j = i + 1; j < postLogs.length; j++) {
        const timeDiff = Math.abs(postLogs[i].timestamp - postLogs[j].timestamp) / 1000;
        if (
          postLogs[i].provider === postLogs[j].provider &&
          postLogs[i].endpoint === postLogs[j].endpoint &&
          postLogs[i].requestBody === postLogs[j].requestBody &&
          timeDiff < 10
        ) {
          duplicateCount++;
          duplicateCost += postLogs[i].costUsd;
        }
      }
    }

    if (duplicateCount > 5) {
      const estSavings = Math.round(duplicateCost * 30 * 84);
      recommendations.push({
        userId,
        type: 'duplicate_requests',
        message: `Duplicate requests detected for similar payloads. Implement client-side debouncing or enable short-term caching to resolve.`,
        priority: 'medium',
        savingsInr: estSavings > 0 ? estSavings : 1500,
        impactLevel: 'medium',
        targetEndpoint: 'gateway_level',
        details: { duplicateCount, estimatedCostWaste: duplicateCost }
      });
    }

    // Rule 3: High Spend Provider (Switch to Batch requests)
    const providerCosts = {};
    logs.forEach(log => {
      providerCosts[log.provider] = (providerCosts[log.provider] || 0) + log.costUsd;
    });

    for (const [provider, cost] of Object.entries(providerCosts)) {
      if (cost > 15 && ['stripe', 'google_maps'].includes(provider)) {
        // High transactional API calls
        recommendations.push({
          userId,
          type: 'switch_batch',
          message: `Frequent transactional queries to ${provider} detected. Switch to batch API requests or bulk caching rules.`,
          priority: 'medium',
          savingsInr: Math.round(cost * 0.25 * 30 * 84),
          impactLevel: 'medium',
          targetEndpoint: `/${provider}`,
          details: { currentWeeklySpend: cost }
        });
      }
    }

    // Rule 4: Unused Keys
    const activeProvidersInLogs = new Set(logs.map(l => l.provider));
    const userKeys = await ProviderKey.find({ userId });
    for (const key of userKeys) {
      if (!activeProvidersInLogs.has(key.provider)) {
        recommendations.push({
          userId,
          type: 'unused_keys',
          message: `Unused API credential detected for provider '${key.provider}'. Remove or deactivate it to secure your ecosystem.`,
          priority: 'low',
          savingsInr: 0,
          impactLevel: 'low',
          targetEndpoint: key.provider,
          details: { keyName: key.name }
        });
      }
    }

    // Write recommendations to DB
    for (const rec of recommendations) {
      // Check if a similar active recommendation already exists
      const existing = await Recommendation.findOne({
        userId,
        type: rec.type,
        targetEndpoint: rec.targetEndpoint,
        isApplied: false
      });

      if (!existing) {
        await Recommendation.create(rec);
      } else {
        // Update stats
        existing.savingsInr = rec.savingsInr;
        existing.details = rec.details;
        existing.message = rec.message;
        await existing.save();
      }
    }

    return await Recommendation.find({ userId, isApplied: false });
  } catch (error) {
    logger.error(`Error analyzing logs in Optimization Engine: ${error.message}`);
    return [];
  }
};

module.exports = {
  analyzeLogsAndOptimize
};
