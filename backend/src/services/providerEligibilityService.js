'use strict';

const ProviderKey = require('../models/ProviderKey');
const ProviderModel = require('../models/ProviderModel');

/**
 * Extracts capability requirements from a gateway request details
 */
function extractRequiredCapabilities(provider, endpoint, body) {
  const reqCaps = {};
  const endpointLower = (endpoint || '').toLowerCase();
  
  if (endpointLower.includes('completions') || endpointLower.includes('generatecontent') || endpointLower.includes('messages')) {
    reqCaps.text = true;
  }
  
  if (body) {
    if (body.stream === true || body.stream === 'true') {
      reqCaps.streaming = true;
    }
    
    if (body.tools || body.functions || body.tool_choice || body.toolConfig) {
      reqCaps.tools = true;
    }
    
    if (body.response_format || body.responseSchema || body.responseMimeType) {
      reqCaps.structuredOutput = true;
    }
    
    // Vision checks
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'image_url') {
              reqCaps.vision = true;
            }
          }
        }
      }
    }
    if (Array.isArray(body.contents)) {
      for (const content of body.contents) {
        if (Array.isArray(content.parts)) {
          for (const part of content.parts) {
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
              reqCaps.vision = true;
            }
          }
        }
      }
    }
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'image') {
              reqCaps.vision = true;
            }
          }
        }
      }
    }
    
    if (Array.isArray(body.modalities) && body.modalities.includes('audio')) {
      reqCaps.audio = true;
    }
  }
  
  return reqCaps;
}

/**
 * Resolves user's eligible candidates and filters out excluded ones with explanations
 */
async function getEligibleCandidates(userId, requiredCaps = {}) {
  // 1. Fetch connected and active provider keys for the user
  const activeKeys = await ProviderKey.find({
    userId,
    isActive: true,
    validationStatus: { $in: ['connected', 'healthy'] }
  });

  if (activeKeys.length === 0) {
    return { 
      eligible: [], 
      explanations: [{ reason: 'No active and connected provider credentials found.' }] 
    };
  }

  const activeKeyIds = activeKeys.map(k => k._id);
  
  // 2. Fetch available models for these provider keys
  const models = await ProviderModel.find({
    userId,
    providerKeyId: { $in: activeKeyIds },
    isAvailable: true
  });

  const eligible = [];
  const explanations = [];

  for (const model of models) {
    const modelId = model.externalModelId;
    const provider = model.provider;

    let isMatch = true;
    const reasons = [];

    // Capability matching
    for (const [capKey, reqVal] of Object.entries(requiredCaps)) {
      if (reqVal === true) {
        const modelVal = model.capabilities ? model.capabilities[capKey] : null;
        if (modelVal !== true) {
          isMatch = false;
          if (modelVal === false) {
            reasons.push(`Model '${modelId}' capability '${capKey}' is unsupported.`);
          } else {
            reasons.push(`Model '${modelId}' capability '${capKey}' is unknown.`);
          }
        }
      }
    }

    if (isMatch) {
      eligible.push({
        provider,
        model: modelId,
        providerKeyId: model.providerKeyId
      });
    } else {
      explanations.push({
        provider,
        model: modelId,
        reason: reasons.join(', ')
      });
    }
  }

  return { eligible, explanations };
}

module.exports = {
  extractRequiredCapabilities,
  getEligibleCandidates
};
