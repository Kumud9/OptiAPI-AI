/**
 * In-memory Performance Metrics Service for OptiAPI Gateway.
 * Keeps metrics lightweight and purely in-memory with zero MongoDB writes on the request path.
 */

const MAX_SAMPLES = 10000;

class MetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.totalRequests = 0;
    this.upstreamRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.deduplicationHits = 0;
    this.errors = 0;
    this.failoverAttempts = 0;
    this.failoverSuccesses = 0;
    this.rateLimitHits = 0;
    this.rateLimitRejections = 0;
    this.providerQuotaChecks = 0;
    this.providerQuotaRejections = 0;
    this.telemetryPublished = 0;
    this.telemetryPublishFailures = 0;
    this.telemetryProcessed = 0;
    this.telemetryProcessingFailures = 0;
    this.telemetryDlqCount = 0;
    this.optimizationRuns = 0;
    this.optimizationSuccesses = 0;
    this.optimizationFailures = 0;
    this.policiesGenerated = 0;
    this.policiesRejected = 0;
    this.aiOptimizationLatencies = [];
    this.semanticCacheHits = 0;
    this.semanticCacheMisses = 0;
    this.semanticCacheWrites = 0;
    this.semanticCacheEmbeddingFailures = 0;
    this.semanticCacheLookupLatencies = [];
    this.semanticCacheEmbeddingLatencies = [];
    this.circuitMetrics = {
      opened: 0,
      closed: 0,
      halfOpen: 0,
      rejected: 0,
      recoverySuccess: 0,
      recoveryFailed: 0
    };
    this.providerStats = {
      openai: { requests: 0, errors: 0, latencies: [], failovers: 0, quotaRejections: 0 },
      gemini: { requests: 0, errors: 0, latencies: [], failovers: 0, quotaRejections: 0 },
      anthropic: { requests: 0, errors: 0, latencies: [], failovers: 0, quotaRejections: 0 }
    };
    this.latencies = [];
    this.startTime = Date.now();
  }

  recordSemanticCacheHit() {
    this.semanticCacheHits++;
  }

  recordSemanticCacheMiss() {
    this.semanticCacheMisses++;
  }

  recordSemanticCacheWrite() {
    this.semanticCacheWrites++;
  }

  recordSemanticCacheEmbeddingFailure() {
    this.semanticCacheEmbeddingFailures++;
  }

  recordSemanticCacheLookupLatency(ms) {
    if (typeof ms === 'number' && !isNaN(ms) && ms >= 0) {
      if (this.semanticCacheLookupLatencies.length >= MAX_SAMPLES) {
        this.semanticCacheLookupLatencies.shift();
      }
      this.semanticCacheLookupLatencies.push(ms);
    }
  }

  recordSemanticCacheEmbeddingLatency(ms) {
    if (typeof ms === 'number' && !isNaN(ms) && ms >= 0) {
      if (this.semanticCacheEmbeddingLatencies.length >= MAX_SAMPLES) {
        this.semanticCacheEmbeddingLatencies.shift();
      }
      this.semanticCacheEmbeddingLatencies.push(ms);
    }
  }

  recordRequest() {
    this.totalRequests++;
  }

  recordUpstreamRequest(provider) {
    this.upstreamRequests++;
    if (provider) {
      const p = String(provider).toLowerCase().trim();
      if (this.providerStats[p]) {
        this.providerStats[p].requests++;
      }
    }
  }

  recordCacheHit() {
    this.cacheHits++;
  }

  recordCacheMiss() {
    this.cacheMisses++;
  }

  recordDeduplicationHit() {
    this.deduplicationHits++;
  }

  recordError(provider) {
    this.errors++;
    if (provider) {
      const p = String(provider).toLowerCase().trim();
      if (this.providerStats[p]) {
        this.providerStats[p].errors++;
      }
    }
  }

  recordCircuitOpened(provider) {
    this.circuitMetrics.opened++;
  }

  recordCircuitClosed(provider) {
    this.circuitMetrics.closed++;
  }

  recordCircuitHalfOpen(provider) {
    this.circuitMetrics.halfOpen++;
  }

  recordCircuitRejected(provider) {
    this.circuitMetrics.rejected++;
  }

  recordCircuitRecoverySuccess(provider) {
    this.circuitMetrics.recoverySuccess++;
  }

  recordCircuitRecoveryFailed(provider) {
    this.circuitMetrics.recoveryFailed++;
  }

  recordFailoverAttempt(fromProvider, toProvider) {
    this.failoverAttempts++;
    if (toProvider) {
      const p = String(toProvider).toLowerCase().trim();
      if (this.providerStats[p]) {
        this.providerStats[p].failovers++;
      }
    }
  }

  recordFailoverSuccess(fromProvider, toProvider) {
    this.failoverSuccesses++;
  }

  recordRateLimitHit() {
    this.rateLimitHits++;
  }

  recordRateLimitRejection() {
    this.rateLimitRejections++;
  }

  recordProviderQuotaCheck(provider) {
    this.providerQuotaChecks++;
  }

  recordProviderQuotaRejection(provider) {
    this.providerQuotaRejections++;
    if (provider) {
      const p = String(provider).toLowerCase().trim();
      if (this.providerStats[p]) {
        this.providerStats[p].quotaRejections++;
      }
    }
  }

  recordTelemetryPublished() {
    this.telemetryPublished++;
  }

  recordTelemetryPublishFailure() {
    this.telemetryPublishFailures++;
  }

  recordTelemetryProcessed() {
    this.telemetryProcessed++;
  }

  recordTelemetryProcessingFailure() {
    this.telemetryProcessingFailures++;
  }

  recordTelemetryDlq() {
    this.telemetryDlqCount++;
  }

  recordOptimizationRun() {
    this.optimizationRuns++;
  }

  recordOptimizationSuccess() {
    this.optimizationSuccesses++;
  }

  recordOptimizationFailure() {
    this.optimizationFailures++;
  }

  recordPolicyGenerated() {
    this.policiesGenerated++;
  }

  recordPolicyRejected() {
    this.policiesRejected++;
  }

  recordAiOptimizationLatency(ms) {
    if (typeof ms === 'number' && !isNaN(ms) && ms >= 0) {
      if (this.aiOptimizationLatencies.length >= MAX_SAMPLES) {
        this.aiOptimizationLatencies.shift();
      }
      this.aiOptimizationLatencies.push(ms);
    }
  }

  recordLatency(ms, provider) {
    if (typeof ms !== 'number' || isNaN(ms) || ms < 0) {
      return;
    }
    if (this.latencies.length >= MAX_SAMPLES) {
      this.latencies.shift();
    }
    this.latencies.push(ms);
    if (provider) {
      const p = String(provider).toLowerCase().trim();
      if (this.providerStats[p]) {
        if (this.providerStats[p].latencies.length >= 1000) {
          this.providerStats[p].latencies.shift();
        }
        this.providerStats[p].latencies.push(ms);
      }
    }
  }

  calculatePercentile(percentile) {
    if (this.latencies.length === 0) {
      return 0;
    }
    const sorted = [...this.latencies].sort((a, b) => a - b);
    if (sorted.length === 1) {
      return sorted[0];
    }
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sorted[lower];
    }
    return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(2));
  }

  getMetrics() {
    const count = this.latencies.length;
    const sum = this.latencies.reduce((acc, val) => acc + val, 0);
    const avg = count > 0 ? Number((sum / count).toFixed(2)) : 0;
    const min = count > 0 ? Math.min(...this.latencies) : 0;
    const max = count > 0 ? Math.max(...this.latencies) : 0;

    const p50 = this.calculatePercentile(50);
    const p95 = this.calculatePercentile(95);
    const p99 = this.calculatePercentile(99);

    const totalCacheChecks = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheChecks > 0 ? Number(((this.cacheHits / totalCacheChecks) * 100).toFixed(2)) : 0;

    const providerHealth = {};
    for (const [p, stats] of Object.entries(this.providerStats)) {
      const pCount = stats.latencies.length;
      const pAvg = pCount > 0 ? Number((stats.latencies.reduce((a, b) => a + b, 0) / pCount).toFixed(1)) : 0;
      providerHealth[p] = {
        requests: stats.requests,
        errors: stats.errors,
        latency: pAvg,
        failovers: stats.failovers,
        quotaRejections: stats.quotaRejections
      };
    }

    return {
      totalRequests: this.totalRequests,
      requestCount: this.totalRequests,
      upstreamRequests: this.upstreamRequests,
      upstreamRequestCount: this.upstreamRequests,
      cacheHits: this.cacheHits,
      cacheHitCount: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheMissCount: this.cacheMisses,
      cacheHitRate: `${cacheHitRate}%`,
      deduplicationHits: this.deduplicationHits,
      deduplicationHitCount: this.deduplicationHits,
      errors: this.errors,
      errorCount: this.errors,
      p50Latency: p50,
      p95Latency: p95,
      p99Latency: p99,
      latency: {
        avg,
        min,
        max,
        p50,
        p95,
        p99,
        sampleCount: count
      },
      requests: {
        total: this.totalRequests,
        upstream: this.upstreamRequests,
        errors: this.errors
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: `${cacheHitRate}%`,
        exactHits: Math.max(0, this.cacheHits - this.semanticCacheHits),
        semanticHits: this.semanticCacheHits,
        semanticMisses: this.semanticCacheMisses,
        writes: this.semanticCacheWrites,
        embeddingFailures: this.semanticCacheEmbeddingFailures
      },
      semanticCacheHits: this.semanticCacheHits,
      semanticCacheMisses: this.semanticCacheMisses,
      semanticCacheWrites: this.semanticCacheWrites,
      semanticCacheEmbeddingFailures: this.semanticCacheEmbeddingFailures,
      semanticCacheLookupLatency: this.semanticCacheLookupLatencies.length > 0
        ? this.semanticCacheLookupLatencies[this.semanticCacheLookupLatencies.length - 1]
        : 0,
      semanticCacheEmbeddingLatency: this.semanticCacheEmbeddingLatencies.length > 0
        ? this.semanticCacheEmbeddingLatencies[this.semanticCacheEmbeddingLatencies.length - 1]
        : 0,
      deduplication: {
        hits: this.deduplicationHits
      },
      failover: {
        attempts: this.failoverAttempts,
        successes: this.failoverSuccesses
      },
      failoverAttempts: this.failoverAttempts,
      failoverSuccesses: this.failoverSuccesses,
      rateLimitHits: this.rateLimitHits,
      rateLimitRejections: this.rateLimitRejections,
      providerQuotaChecks: this.providerQuotaChecks,
      providerQuotaRejections: this.providerQuotaRejections,
      rateLimit: {
        hits: this.rateLimitHits,
        rejections: this.rateLimitRejections
      },
      providerQuota: {
        checks: this.providerQuotaChecks,
        rejections: this.providerQuotaRejections
      },
      providers: providerHealth,
      providerStats: providerHealth,
      telemetry: {
        published: this.telemetryPublished,
        publishFailures: this.telemetryPublishFailures,
        processed: this.telemetryProcessed,
        processingFailures: this.telemetryProcessingFailures,
        dlq: this.telemetryDlqCount
      },
      telemetryPublished: this.telemetryPublished,
      telemetryPublishFailures: this.telemetryPublishFailures,
      telemetryProcessed: this.telemetryProcessed,
      telemetryProcessingFailures: this.telemetryProcessingFailures,
      telemetryDlqCount: this.telemetryDlqCount,
      optimization: {
        runs: this.optimizationRuns,
        successes: this.optimizationSuccesses,
        failures: this.optimizationFailures,
        policiesGenerated: this.policiesGenerated,
        policiesRejected: this.policiesRejected,
        avgLatencyMs: this.aiOptimizationLatencies.length > 0
          ? Math.round(this.aiOptimizationLatencies.reduce((a, b) => a + b, 0) / this.aiOptimizationLatencies.length)
          : 0
      },
      optimizationRuns: this.optimizationRuns,
      optimizationSuccesses: this.optimizationSuccesses,
      optimizationFailures: this.optimizationFailures,
      policiesGenerated: this.policiesGenerated,
      policiesRejected: this.policiesRejected,
      aiOptimizationLatency: this.aiOptimizationLatencies.length > 0
        ? this.aiOptimizationLatencies[this.aiOptimizationLatencies.length - 1]
        : 0,
      circuitBreaker: {
        opened: this.circuitMetrics.opened,
        closed: this.circuitMetrics.closed,
        halfOpen: this.circuitMetrics.halfOpen,
        rejected: this.circuitMetrics.rejected,
        recoverySuccess: this.circuitMetrics.recoverySuccess,
        recoveryFailed: this.circuitMetrics.recoveryFailed
      },
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }
}

const defaultCollector = new MetricsCollector();

module.exports = {
  recordRequest: () => defaultCollector.recordRequest(),
  recordUpstreamRequest: (prov) => defaultCollector.recordUpstreamRequest(prov),
  recordCacheHit: () => defaultCollector.recordCacheHit(),
  recordCacheMiss: () => defaultCollector.recordCacheMiss(),
  recordSemanticCacheHit: () => defaultCollector.recordSemanticCacheHit(),
  recordSemanticCacheMiss: () => defaultCollector.recordSemanticCacheMiss(),
  recordSemanticCacheWrite: () => defaultCollector.recordSemanticCacheWrite(),
  recordSemanticCacheEmbeddingFailure: () => defaultCollector.recordSemanticCacheEmbeddingFailure(),
  recordSemanticCacheLookupLatency: (ms) => defaultCollector.recordSemanticCacheLookupLatency(ms),
  recordSemanticCacheEmbeddingLatency: (ms) => defaultCollector.recordSemanticCacheEmbeddingLatency(ms),
  recordDeduplicationHit: () => defaultCollector.recordDeduplicationHit(),
  recordError: (prov) => defaultCollector.recordError(prov),
  recordFailoverAttempt: (from, to) => defaultCollector.recordFailoverAttempt(from, to),
  recordFailoverSuccess: (from, to) => defaultCollector.recordFailoverSuccess(from, to),
  recordRateLimitHit: () => defaultCollector.recordRateLimitHit(),
  recordRateLimitRejection: () => defaultCollector.recordRateLimitRejection(),
  recordProviderQuotaCheck: (prov) => defaultCollector.recordProviderQuotaCheck(prov),
  recordProviderQuotaRejection: (prov) => defaultCollector.recordProviderQuotaRejection(prov),
  recordTelemetryPublished: () => defaultCollector.recordTelemetryPublished(),
  recordTelemetryPublishFailure: () => defaultCollector.recordTelemetryPublishFailure(),
  recordTelemetryProcessed: () => defaultCollector.recordTelemetryProcessed(),
  recordTelemetryProcessingFailure: () => defaultCollector.recordTelemetryProcessingFailure(),
  recordTelemetryDlq: () => defaultCollector.recordTelemetryDlq(),
  recordOptimizationRun: () => defaultCollector.recordOptimizationRun(),
  recordOptimizationSuccess: () => defaultCollector.recordOptimizationSuccess(),
  recordOptimizationFailure: () => defaultCollector.recordOptimizationFailure(),
  recordPolicyGenerated: () => defaultCollector.recordPolicyGenerated(),
  recordPolicyRejected: () => defaultCollector.recordPolicyRejected(),
  recordAiOptimizationLatency: (ms) => defaultCollector.recordAiOptimizationLatency(ms),
  recordCircuitOpened: (p) => defaultCollector.recordCircuitOpened(p),
  recordCircuitClosed: (p) => defaultCollector.recordCircuitClosed(p),
  recordCircuitHalfOpen: (p) => defaultCollector.recordCircuitHalfOpen(p),
  recordCircuitRejected: (p) => defaultCollector.recordCircuitRejected(p),
  recordCircuitRecoverySuccess: (p) => defaultCollector.recordCircuitRecoverySuccess(p),
  recordCircuitRecoveryFailed: (p) => defaultCollector.recordCircuitRecoveryFailed(p),
  recordLatency: (ms) => defaultCollector.recordLatency(ms),
  getMetrics: () => defaultCollector.getMetrics(),
  resetMetrics: () => defaultCollector.reset(),
  calculatePercentile: (arr, p) => {
    const col = new MetricsCollector();
    arr.forEach(val => col.recordLatency(val));
    return col.calculatePercentile(p);
  },
  MetricsCollector
};
