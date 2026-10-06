'use strict';

const logger = require('../utils/logger');
const { CircuitState, getCircuitState } = require('./circuitBreakerService');

const SUPPORTED_PROVIDERS = ['openai', 'gemini', 'anthropic'];

/**
 * Resolves candidate providers in prioritized order for a request.
 * Primary provider is always first (selected by routing policy or requested provider).
 * Fallback providers are only included if failover is enabled via routing policy,
 * headers, query parameter, or environment configuration.
 *
 * @param {string} primaryProvider
 * @param {object|null} routingPolicy
 * @param {object} req
 * @returns {Array<string>}
 */
function getFailoverCandidates(primaryProvider, routingPolicy = null, req = {}) {
  const primary = (primaryProvider || 'openai').toLowerCase().trim();

  // If failover is explicitly disabled by header or query param
  if (req?.headers?.['x-optiapi-failover'] === 'false' || req?.query?.failover === 'false') {
    return [primary];
  }

  // Determine if failover is active
  const isFailoverEnabled = Boolean(
    req?.headers?.['x-optiapi-failover'] === 'true' ||
    req?.query?.failover === 'true' ||
    req?.headers?.['x-optiapi-fallback-providers'] ||
    (routingPolicy && routingPolicy.failover !== false) ||
    process.env.FAILOVER_ENABLED === 'true'
  );

  if (!isFailoverEnabled) {
    return [primary];
  }

  let fallbacks = [];

  // 1. Explicit fallback providers header
  if (req?.headers?.['x-optiapi-fallback-providers']) {
    fallbacks = req.headers['x-optiapi-fallback-providers']
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(p => SUPPORTED_PROVIDERS.includes(p) && p !== primary);
  }
  // 2. Fallback providers from routing policy
  else if (routingPolicy && Array.isArray(routingPolicy.fallbackProviders) && routingPolicy.fallbackProviders.length > 0) {
    fallbacks = routingPolicy.fallbackProviders
      .map(p => String(p).trim().toLowerCase())
      .filter(p => SUPPORTED_PROVIDERS.includes(p) && p !== primary);
  }
  // 3. Default to other supported providers in stable order
  else {
    fallbacks = SUPPORTED_PROVIDERS.filter(p => p !== primary);
  }

  // De-duplicate in case of duplicate entries
  const uniqueCandidates = Array.from(new Set([primary, ...fallbacks]));
  return uniqueCandidates;
}

/**
 * Checks whether an error is a client-side error (4xx auth/validation/bad request)
 * which must NOT trigger provider failover.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isClientError(err) {
  if (!err) return false;

  const status = err.statusCode || err.status;
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return true;
  }

  if (err.name === 'ValidationError' || err.name === 'ZodError') {
    return true;
  }

  if (err.errorClass === 'permanent_request_error' || err.errorClass === 'authentication_failed') {
    return true;
  }

  if (/HTTP Error (400|401|403|404|422)/i.test(err.message || '')) {
    return true;
  }

  return false;
}

/**
 * Returns default routing endpoint for a provider
 */
function getEndpointForProvider(targetProvider, defaultModel) {
  const p = (targetProvider || '').toLowerCase().trim();
  if (p === 'openai') return '/v1/chat/completions';
  if (p === 'anthropic') return '/v1/messages';
  if (p === 'gemini') {
    const model = defaultModel || 'gemini-1.5-flash';
    return `/v1/models/${model}:generateContent`;
  }
  return '/v1/chat/completions';
}

/**
 * Returns default model for a provider
 */
function getDefaultModelForProvider(targetProvider) {
  const p = (targetProvider || '').toLowerCase().trim();
  if (p === 'openai') return 'gpt-4o';
  if (p === 'gemini') return 'gemini-1.5-flash';
  if (p === 'anthropic') return 'claude-3-5-sonnet-20241022';
  return null;
}

/**
 * Check if a provider's circuit is healthy (i.e. not OPEN)
 */
function isProviderHealthy(provider) {
  const state = getCircuitState(provider);
  return state.state !== CircuitState.OPEN;
}

module.exports = {
  SUPPORTED_PROVIDERS,
  getFailoverCandidates,
  isClientError,
  getEndpointForProvider,
  getDefaultModelForProvider,
  isProviderHealthy
};
