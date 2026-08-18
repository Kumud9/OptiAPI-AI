'use strict';

const ProviderModel = require('../models/ProviderModel');
const ProviderKey = require('../models/ProviderKey');
const logger = require('../utils/logger');

// Static capability mapping for known models (Priority 2 fallback)
const KNOWN_CAPABILITIES = {
  // OpenAI
  'gpt-4o': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: true },
  'gpt-4o-mini': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: true },
  'gpt-4-turbo': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: true },
  'gpt-4': { text: true, streaming: true, vision: false, audio: false, tools: true, structuredOutput: false },
  'gpt-3.5-turbo': { text: true, streaming: true, vision: false, audio: false, tools: true, structuredOutput: false },
  // Gemini 3.x
  'gemini-3.5-flash-lite': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: true },
  'gemini-3.1-flash-lite': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: true },
  'gemini-3.5-pro': { text: true, streaming: true, vision: true, audio: true, tools: true, structuredOutput: true },
  'gemini-3.5-flash': { text: true, streaming: true, vision: true, audio: true, tools: true, structuredOutput: true },
  // Anthropic
  'claude-3-5-sonnet': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: true },
  'claude-3-opus': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: false },
  'claude-3-sonnet': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: false },
  'claude-3-haiku': { text: true, streaming: true, vision: true, audio: false, tools: true, structuredOutput: false }
};

/**
 * Determine model capabilities based on priorities:
 * 1. API metadata (if explicitly provided)
 * 2. Static capability mapping for known models
 * 3. Default to null (unknown)
 */
function detectCapabilities(modelId, apiMetadata = {}) {
  const capabilities = {
    text: null,
    streaming: null,
    vision: null,
    audio: null,
    tools: null,
    structuredOutput: null
  };

  // Priority 1: Explicit provider API metadata
  if (apiMetadata && typeof apiMetadata === 'object') {
    if (apiMetadata.supportedFeatures && Array.isArray(apiMetadata.supportedFeatures)) {
      capabilities.text = apiMetadata.supportedFeatures.includes('text') ? true : null;
      capabilities.streaming = apiMetadata.supportedFeatures.includes('streaming') ? true : null;
      capabilities.vision = apiMetadata.supportedFeatures.includes('vision') ? true : null;
      capabilities.audio = apiMetadata.supportedFeatures.includes('audio') ? true : null;
      capabilities.tools = apiMetadata.supportedFeatures.includes('tools') ? true : null;
      capabilities.structuredOutput = apiMetadata.supportedFeatures.includes('structuredOutput') ? true : null;
    }
  }

  // Priority 2: Static capability mapping for known models
  const normalizedId = modelId.toLowerCase();
  let matchedKey = null;

  for (const key of Object.keys(KNOWN_CAPABILITIES)) {
    if (normalizedId.includes(key)) {
      matchedKey = key;
      break;
    }
  }

  // Dynamic fallback for new versions of known models
  if (!matchedKey) {
    if (normalizedId.includes('gemini') && normalizedId.includes('flash') && normalizedId.includes('lite')) {
      matchedKey = 'gemini-3.5-flash-lite';
    } else if (normalizedId.includes('gemini') && normalizedId.includes('flash')) {
      matchedKey = 'gemini-3.5-flash';
    } else if (normalizedId.includes('gemini') && normalizedId.includes('pro')) {
      matchedKey = 'gemini-3.5-pro';
    } else if (normalizedId.includes('gpt-4') || normalizedId.includes('gpt-5')) {
      matchedKey = 'gpt-4o';
    } else if (normalizedId.includes('claude-3')) {
      matchedKey = 'claude-3-5-sonnet';
    }
  }

  if (matchedKey) {
    const known = KNOWN_CAPABILITIES[matchedKey];
    Object.keys(capabilities).forEach(cap => {
      if (capabilities[cap] === null) {
        capabilities[cap] = known[cap];
      }
    });
  }

  return capabilities;
}

/**
 * Validate OpenAI API Key and Discover Models
 */
async function validateOpenAI(apiKey) {
  const url = 'https://api.openai.com/v1/models';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;
    const errorObj = new Error(errorText);
    errorObj.status = status;
    throw errorObj;
  }

  const result = await response.json();
  const models = (result.data || []).map(m => ({
    externalModelId: m.id,
    displayName: m.id,
    capabilities: detectCapabilities(m.id)
  }));

  return models;
}

/**
 * Validate Gemini API Key and Discover Models
 */
async function validateGemini(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;
    const errorObj = new Error(errorText);
    errorObj.status = status;
    throw errorObj;
  }

  const result = await response.json();
  const models = (result.models || []).map(m => {
    // Extract name without the leading 'models/'
    const cleanId = m.name.startsWith('models/') ? m.name.substring(7) : m.name;
    
    // Check supported methods for metadata extraction
    const hasGenerate = m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent');
    
    return {
      externalModelId: cleanId,
      displayName: m.displayName || cleanId,
      capabilities: detectCapabilities(cleanId, {
        supportedFeatures: hasGenerate ? ['text'] : []
      })
    };
  });

  return models;
}

/**
 * Validate Anthropic API Key and Discover Models
 */
async function validateAnthropic(apiKey) {
  const url = 'https://api.anthropic.com/v1/models';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;
    const errorObj = new Error(errorText);
    errorObj.status = status;
    throw errorObj;
  }

  const result = await response.json();
  const models = (result.data || []).map(m => ({
    externalModelId: m.id,
    displayName: m.display_name || m.id,
    capabilities: detectCapabilities(m.id)
  }));

  return models;
}

/**
 * Main credentials validation orchestrator
 */
async function validateProviderKey(providerKeyDoc) {
  const decryptedKey = providerKeyDoc.getDecryptedValue();
  let providerLower = providerKeyDoc.provider.toLowerCase();

  // Normalize "claude" provider branding name to "anthropic"
  if (providerLower === 'claude') {
    providerLower = 'anthropic';
  }

  logger.info(`Starting credential validation for user ${providerKeyDoc.userId} provider [${providerLower.toUpperCase()}]`);

  providerKeyDoc.validationStatus = 'validating';
  await providerKeyDoc.save();

  let discoveredModels = [];
  try {
    if (providerLower === 'openai') {
      discoveredModels = await validateOpenAI(decryptedKey);
    } else if (providerLower === 'gemini') {
      discoveredModels = await validateGemini(decryptedKey);
    } else if (providerLower === 'anthropic') {
      discoveredModels = await validateAnthropic(decryptedKey);
    } else {
      throw new Error(`Unsupported provider type: ${providerLower}`);
    }

    // Success transition
    providerKeyDoc.validationStatus = 'connected';
    providerKeyDoc.lastValidatedAt = new Date();
    providerKeyDoc.validationErrorCode = null;
    await providerKeyDoc.save();

    // Registry database sync (Upsert discovered models, mark missing as unavailable)
    const discoveredIds = discoveredModels.map(m => m.externalModelId);
    
    // Mark models not returned as unavailable
    await ProviderModel.updateMany(
      {
        userId: providerKeyDoc.userId,
        providerKeyId: providerKeyDoc._id,
        externalModelId: { $nin: discoveredIds }
      },
      {
        $set: { isAvailable: false, lastValidatedAt: new Date() }
      }
    );

    // Upsert discovered models
    for (const model of discoveredModels) {
      await ProviderModel.findOneAndUpdate(
        {
          userId: providerKeyDoc.userId,
          providerKeyId: providerKeyDoc._id,
          externalModelId: model.externalModelId
        },
        {
          $set: {
            provider: providerLower,
            displayName: model.displayName,
            capabilities: model.capabilities,
            isAvailable: true,
            lastValidatedAt: new Date()
          },
          $setOnInsert: {
            discoveredAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
    }

    return {
      success: true,
      provider: providerLower,
      status: 'connected',
      validatedAt: providerKeyDoc.lastValidatedAt,
      modelsDiscovered: discoveredModels.length
    };

  } catch (error) {
    logger.error(`Validation failed for provider [${providerLower.toUpperCase()}]: ${error.message}`);
    
    const status = error.status;
    let errorCode = 'VALIDATION_FAILED';

    if (status === 401 || status === 403) {
      providerKeyDoc.validationStatus = 'validation_failed';
      errorCode = 'INVALID_CREDENTIALS';
    } else if (status === 429) {
      providerKeyDoc.validationStatus = 'unavailable';
      errorCode = 'RATE_LIMIT_EXCEEDED';
    } else {
      // Differentiate network/unavailable from bad credentials
      providerKeyDoc.validationStatus = 'unavailable';
      errorCode = 'PROVIDER_UNAVAILABLE';
    }

    providerKeyDoc.lastValidatedAt = new Date();
    providerKeyDoc.validationErrorCode = errorCode;
    await providerKeyDoc.save();

    return {
      success: false,
      provider: providerLower,
      status: providerKeyDoc.validationStatus,
      validatedAt: providerKeyDoc.lastValidatedAt,
      errorCode
    };
  }
}

module.exports = {
  validateProviderKey,
  detectCapabilities
};
