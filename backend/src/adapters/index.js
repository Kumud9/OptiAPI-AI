'use strict';

const openaiAdapter = require('./openaiAdapter');
const geminiAdapter = require('./geminiAdapter');
const anthropicAdapter = require('./anthropicAdapter');

const adapters = {
  openai: openaiAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter
};

function getAdapter(providerName) {
  const normalized = (providerName || '').toLowerCase().trim();
  if (normalized === 'claude') return adapters.anthropic;
  return adapters[normalized];
}

/**
 * Validates target provider capabilities against a CanonicalInternalRequest.
 * If validation fails, returns { supported: false, reason: '...' }.
 * Otherwise returns { supported: true }.
 */
function validateCapabilities(internalRequest, targetProvider) {
  const target = (targetProvider || '').toLowerCase().trim();
  
  if (internalRequest.stream) {
    return { supported: false, reason: 'Streaming is not supported in Phase 2 adapter execution' };
  }
  if (internalRequest.hasTools) {
    return { supported: false, reason: 'Tool/function calling is not supported in Phase 2 adapter execution' };
  }
  if (internalRequest.isMultimodal) {
    return { supported: false, reason: 'Multimodal input is not supported in Phase 2 adapter execution' };
  }
  if (internalRequest.isAudio) {
    return { supported: false, reason: 'Audio input is not supported in Phase 2 adapter execution' };
  }

  // Ensure target provider exists in our adapter registry
  if (!getAdapter(target)) {
    return { supported: false, reason: `Unsupported target provider: ${targetProvider}` };
  }

  return { supported: true };
}

module.exports = {
  getAdapter,
  validateCapabilities
};
