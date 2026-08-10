/**
 * Cost Calculator Service
 * Calculates API pricing based on official pricing structures (per token or flat-rate per request)
 */
const logger = require('../utils/logger');

// Pricing dictionary (USD per unit)
const PRICING = {
  openai: {
    'gpt-4o': { prompt: 5.00 / 1e6, completion: 15.00 / 1e6 },
    'gpt-4-turbo': { prompt: 10.00 / 1e6, completion: 30.00 / 1e6 },
    'gpt-4': { prompt: 30.00 / 1e6, completion: 60.00 / 1e6 },
    'gpt-3.5-turbo': { prompt: 0.50 / 1e6, completion: 1.50 / 1e6 },
    'default': { prompt: 1.50 / 1e6, completion: 2.00 / 1e6 }
  },
  gemini: {
    'gemini-1.5-pro': { prompt: 3.50 / 1e6, completion: 10.50 / 1e6 },
    'gemini-1.5-flash': { prompt: 0.075 / 1e6, completion: 0.30 / 1e6 },
    'gemini-1.0-pro': { prompt: 0.50 / 1e6, completion: 1.50 / 1e6 },
    'default': { prompt: 0.50 / 1e6, completion: 1.50 / 1e6 }
  },
  claude: {
    'claude-3-opus': { prompt: 15.00 / 1e6, completion: 75.00 / 1e6 },
    'claude-3-sonnet': { prompt: 3.00 / 1e6, completion: 15.00 / 1e6 },
    'claude-3-haiku': { prompt: 0.25 / 1e6, completion: 1.25 / 1e6 },
    'default': { prompt: 3.00 / 1e6, completion: 15.00 / 1e6 }
  },
  stripe: {
    flatRate: 0.015, // $0.015 per API call
    endpoints: {
      '/v1/charges': 0.02,
      '/v1/payment_intents': 0.03,
      '/v1/refunds': 0.01
    }
  },
  google_maps: {
    flatRate: 0.005, // $0.005 flat geocoding rate
    endpoints: {
      '/maps/api/place/autocomplete': 0.0028,
      '/maps/api/place/details': 0.017,
      '/maps/api/geocode': 0.005,
      '/maps/api/directions': 0.008
    }
  },
  twilio: {
    flatRate: 0.0079 // $0.0079 per SMS API invocation
  },
  weather: {
    flatRate: 0.0001 // $0.0001 per weather forecast query
  },
  custom: {
    flatRate: 0.0005
  }
};

/**
 * Calculates cost of a request in USD
 * @param {string} provider Provider code
 * @param {string} endpoint API endpoint path
 * @param {string} model Model string (e.g. gpt-4o, gemini-1.5-flash) if LLM
 * @param {object} tokens Object containing promptTokens, completionTokens
 * @returns {number} Cost in USD
 */
const calculateCost = (provider, endpoint, model = '', tokens = { promptTokens: 0, completionTokens: 0 }) => {
  const providerLower = (provider || 'custom').toLowerCase();
  const pricingGroup = PRICING[providerLower] || PRICING.custom;

  // 1. LLM token-based cost
  if (['openai', 'gemini', 'claude'].includes(providerLower)) {
    const modelKey = Object.keys(pricingGroup).find(k => model.toLowerCase().includes(k)) || 'default';
    const rate = pricingGroup[modelKey];
    
    const promptCost = (tokens.promptTokens || 0) * rate.prompt;
    const completionCost = (tokens.completionTokens || 0) * rate.completion;
    
    return parseFloat((promptCost + completionCost).toFixed(6));
  }

  // 2. Flat rate / Endpoint-specific cost
  if (pricingGroup.endpoints) {
    // Find matching endpoint
    const matchedEndpoint = Object.keys(pricingGroup.endpoints).find(ep => endpoint.includes(ep));
    if (matchedEndpoint) {
      return pricingGroup.endpoints[matchedEndpoint];
    }
  }

  // 3. Fallback flat rate
  return pricingGroup.flatRate || 0.0005;
};

module.exports = {
  calculateCost,
  PRICING
};
