const logger = require('../utils/logger');
const metricsService = require('./metricsService');

const DEFAULT_FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD, 10) || 5;
const DEFAULT_RESET_TIMEOUT_MS = parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS, 10) || 30000;

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreakerError extends Error {
  constructor(provider, message = 'Provider temporarily unavailable') {
    super(message);
    this.name = 'CircuitBreakerError';
    this.provider = (provider || '').toLowerCase();
    this.statusCode = 503;
    this.status = 503;
    this.code = 'CIRCUIT_OPEN';
    this.errorClass = 'circuit_open';
    this.shouldRetry = false; // Never retry when circuit is open
  }
}

/**
 * Determine whether an error is a genuine upstream availability failure that trips the circuit.
 * Excludes 400, 401, 403, 404, validation errors, and configuration errors.
 */
function isCircuitBreakerFailure(err) {
  if (!err) return false;
  const status = err.statusCode || err.status;
  const errorClass = err.errorClass;

  // Client / Auth / Validation errors do NOT count as circuit failures
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    return false;
  }
  if (errorClass === 'permanent_request_error' || errorClass === 'authentication_failed' || errorClass === 'quota_exhausted') {
    return false;
  }
  if (err.name === 'ValidationError' || (err.message && (err.message.includes('ValidationError') || err.message.includes('ConfigurationError')))) {
    return false;
  }

  // Upstream availability failures: timeouts, 5xx, connection/network errors
  if (status >= 500 && status < 600) {
    return true;
  }
  if (errorClass === 'timeout' || errorClass === 'unavailable') {
    return true;
  }
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|timed out|abort|econnrefused|enotfound|fetch failed/i.test(err.message || '')) {
    return true;
  }

  return true;
}

class ProviderCircuit {
  constructor(provider, options = {}) {
    this.provider = (provider || '').toLowerCase();
    this.failureThreshold = options.failureThreshold || DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = options.resetTimeoutMs || DEFAULT_RESET_TIMEOUT_MS;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.halfOpenInFlight = false; // Concurrent HALF_OPEN test lock
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.halfOpenInFlight = false;
  }
}

// Bounded in-memory map storing circuits for known providers
const circuits = new Map();

function getCircuit(provider, options = {}) {
  const p = (provider || '').toLowerCase();
  let circuit = circuits.get(p);
  if (!circuit) {
    circuit = new ProviderCircuit(p, options);
    circuits.set(p, circuit);
  } else if (options.failureThreshold || options.resetTimeoutMs) {
    if (options.failureThreshold) circuit.failureThreshold = options.failureThreshold;
    if (options.resetTimeoutMs) circuit.resetTimeoutMs = options.resetTimeoutMs;
  }
  return circuit;
}

/**
 * Check circuit state before attempting an upstream request.
 * Throws CircuitBreakerError (HTTP 503) if OPEN or if another HALF_OPEN test request is in flight.
 */
function checkCircuit(provider, options = {}) {
  const circuit = getCircuit(provider, options);
  const now = Date.now();

  // If OPEN, check if reset cooldown has expired
  if (circuit.state === CircuitState.OPEN) {
    if (now - circuit.openedAt >= circuit.resetTimeoutMs) {
      // Cooldown expired: transition to HALF_OPEN
      circuit.state = CircuitState.HALF_OPEN;
      circuit.halfOpenInFlight = true; // Lock this request as the ONE test request
      logger.info(`Circuit breaker for [${circuit.provider.toUpperCase()}] transitioned to HALF_OPEN; allowing 1 test request`);
      if (metricsService.recordCircuitHalfOpen) {
        metricsService.recordCircuitHalfOpen(circuit.provider);
      }
      return { allowed: true, isTestRequest: true };
    }

    // Cooldown still active: fail fast without calling provider
    logger.warn(`Circuit breaker for [${circuit.provider.toUpperCase()}] is OPEN. Fast-failing request.`);
    if (metricsService.recordCircuitRejected) {
      metricsService.recordCircuitRejected(circuit.provider);
    }
    throw new CircuitBreakerError(circuit.provider, 'Provider temporarily unavailable');
  }

  // If HALF_OPEN, enforce single test request concurrency lock
  if (circuit.state === CircuitState.HALF_OPEN) {
    if (circuit.halfOpenInFlight) {
      // Test request already in-flight; reject concurrent requests
      logger.warn(`Circuit breaker for [${circuit.provider.toUpperCase()}] is HALF_OPEN and test request is already in-flight. Rejecting.`);
      if (metricsService.recordCircuitRejected) {
        metricsService.recordCircuitRejected(circuit.provider);
      }
      throw new CircuitBreakerError(circuit.provider, 'Provider temporarily unavailable');
    }

    circuit.halfOpenInFlight = true;
    return { allowed: true, isTestRequest: true };
  }

  // CLOSED state: allow request normally
  return { allowed: true, isTestRequest: false };
}

/**
 * Record a successful upstream execution.
 */
function recordSuccess(provider) {
  const circuit = getCircuit(provider);

  if (circuit.state === CircuitState.HALF_OPEN) {
    // Test request succeeded! Transition to CLOSED
    circuit.state = CircuitState.CLOSED;
    circuit.failureCount = 0;
    circuit.openedAt = null;
    circuit.halfOpenInFlight = false;
    circuit.successCount++;
    logger.info(`Circuit breaker for [${circuit.provider.toUpperCase()}] test request succeeded. Circuit CLOSED.`);
    if (metricsService.recordCircuitRecoverySuccess) {
      metricsService.recordCircuitRecoverySuccess(circuit.provider);
    }
    if (metricsService.recordCircuitClosed) {
      metricsService.recordCircuitClosed(circuit.provider);
    }
    return;
  }

  if (circuit.state === CircuitState.CLOSED) {
    circuit.failureCount = 0;
    circuit.successCount++;
  }
}

/**
 * Record a failed upstream execution.
 */
function recordFailure(provider, err) {
  const circuit = getCircuit(provider);

  // Filter out non-circuit failures (400, 401, 403, validation errors)
  if (!isCircuitBreakerFailure(err)) {
    // If half-open test failed with client error, the provider is still reachable
    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.halfOpenInFlight = false;
      circuit.state = CircuitState.CLOSED;
      circuit.failureCount = 0;
    }
    return;
  }

  circuit.lastFailureAt = Date.now();

  if (circuit.state === CircuitState.HALF_OPEN) {
    // Test request failed! Return circuit to OPEN and restart cooldown
    circuit.state = CircuitState.OPEN;
    circuit.openedAt = Date.now();
    circuit.halfOpenInFlight = false;
    logger.warn(`Circuit breaker for [${circuit.provider.toUpperCase()}] test request failed. Circuit returned to OPEN.`);
    if (metricsService.recordCircuitRecoveryFailed) {
      metricsService.recordCircuitRecoveryFailed(circuit.provider);
    }
    if (metricsService.recordCircuitOpened) {
      metricsService.recordCircuitOpened(circuit.provider);
    }
    return;
  }

  if (circuit.state === CircuitState.CLOSED) {
    circuit.failureCount++;
    if (circuit.failureCount >= circuit.failureThreshold) {
      circuit.state = CircuitState.OPEN;
      circuit.openedAt = Date.now();
      logger.warn(`Circuit breaker for [${circuit.provider.toUpperCase()}] reached failure threshold (${circuit.failureCount}/${circuit.failureThreshold}). Circuit OPEN.`);
      if (metricsService.recordCircuitOpened) {
        metricsService.recordCircuitOpened(circuit.provider);
      }
    }
  }
}

/**
 * Retrieve safe state for a provider circuit
 */
function getCircuitState(provider) {
  const p = (provider || '').toLowerCase();
  const circuit = circuits.get(p);
  if (!circuit) {
    return {
      provider: p,
      state: CircuitState.CLOSED,
      failureCount: 0,
      openedAt: null,
      lastFailureAt: null,
      successCount: 0
    };
  }

  let effectiveState = circuit.state;
  if (circuit.state === CircuitState.OPEN && circuit.openedAt && (Date.now() - circuit.openedAt >= circuit.resetTimeoutMs)) {
    effectiveState = CircuitState.HALF_OPEN;
  }

  return {
    provider: circuit.provider,
    state: effectiveState,
    failureCount: circuit.failureCount,
    openedAt: circuit.openedAt,
    lastFailureAt: circuit.lastFailureAt,
    successCount: circuit.successCount
  };
}

/**
 * Retrieve safe states for all standard providers
 */
function getAllCircuitStates() {
  const providers = ['openai', 'gemini', 'anthropic'];
  const res = {};
  for (const p of providers) {
    res[p] = getCircuitState(p);
  }
  return res;
}

/**
 * Reset a specific circuit (for testing)
 */
function resetCircuit(provider) {
  const p = (provider || '').toLowerCase();
  const circuit = circuits.get(p);
  if (circuit) {
    circuit.reset();
  }
}

/**
 * Reset all circuits (for test teardowns)
 */
function resetAllCircuits() {
  circuits.clear();
}

/**
 * Configure circuit threshold and reset timeout (for testing)
 */
function configureCircuit(provider, options = {}) {
  return getCircuit(provider, options);
}

module.exports = {
  CircuitState,
  CircuitBreakerError,
  isCircuitBreakerFailure,
  checkCircuit,
  recordSuccess,
  recordFailure,
  getCircuitState,
  getAllCircuitStates,
  resetCircuit,
  resetAllCircuits,
  configureCircuit,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RESET_TIMEOUT_MS
};
