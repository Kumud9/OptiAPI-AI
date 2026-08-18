const logger = require('../utils/logger');
const ProviderKey = require('../models/ProviderKey');

class ProviderError extends Error {
  constructor(message, statusCode, errorClass, shouldRetry) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.errorClass = errorClass;
    this.shouldRetry = shouldRetry;
  }
}

function classifyAndSanitizeError(err, provider, providerKeyDoc) {
  let statusCode = err.status || 500;
  let errorText = err.message || '';
  
  if (err.message && err.message.includes('HTTP Error')) {
    const match = err.message.match(/HTTP Error (\d+)/i);
    if (match) {
      statusCode = parseInt(match[1], 10);
    }
  }

  let errorClass = 'unknown';
  let shouldRetry = true;

  if (statusCode === 400) {
    errorClass = 'permanent_request_error';
    shouldRetry = false;
  } else if (statusCode === 401) {
    errorClass = 'authentication_failed';
    shouldRetry = false;
  } else if (statusCode === 403) {
    errorClass = 'authentication_failed';
    shouldRetry = false;
  } else if (statusCode === 429) {
    const isQuota = /insufficient_quota|RESOURCE_EXHAUSTED|quota_exhausted|quota/i.test(errorText);
    if (isQuota) {
      errorClass = 'quota_exhausted';
      shouldRetry = false;
    } else {
      errorClass = 'rate_limited';
      shouldRetry = true;
    }
  } else if (statusCode >= 500 && statusCode < 600) {
    errorClass = 'unavailable';
    shouldRetry = true;
  } else {
    errorClass = 'unavailable';
    shouldRetry = true;
  }

  // Sanitize message: hide any API keys, tokens, or authorization headers
  let cleanMessage = errorText
    .replace(/Bearer\s+[a-zA-Z0-9_\-]+/gi, 'Bearer REDACTED')
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=REDACTED')
    .replace(/x-api-key:\s*[a-zA-Z0-9_\-]+/gi, 'x-api-key: REDACTED')
    .replace(/sk-[a-zA-Z0-9\-]{15,}/gi, 'sk-REDACTED');

  logger.warn(`Classified error for ${provider}: class=${errorClass}, shouldRetry=${shouldRetry}, status=${statusCode}`);

  return new ProviderError(cleanMessage, statusCode, errorClass, shouldRetry);
}

const simulateApiCall = async (provider, endpoint, method, body = {}, headers = {}, userId = null, inputProvider = null) => {
  const providerLower = provider.toLowerCase();
  const inputProvResolved = inputProvider || provider;
  const inputAdapter = require('../adapters').getAdapter(inputProvResolved);
  const targetAdapter = require('../adapters').getAdapter(provider);

  let canonicalRequest = null;
  let finalBody = body;
  let finalEndpoint = endpoint;
  let targetModel = null;

  if (inputAdapter && targetAdapter) {
    // 1. Normalize request to CanonicalInternalRequest
    canonicalRequest = inputAdapter.normalizeRequest(body, endpoint);

    // 2. Capability validation
    const { validateCapabilities } = require('../adapters');
    const capabilityCheck = validateCapabilities(canonicalRequest, provider);
    if (!capabilityCheck.supported) {
      throw new Error(`CapabilityError: ${capabilityCheck.reason}`);
    }

    // 3. Reroute endpoint if target provider is different from input provider
    if (inputProvResolved.toLowerCase() !== providerLower) {
      if (providerLower === 'openai') {
        finalEndpoint = '/v1/chat/completions';
      } else if (providerLower === 'anthropic') {
        finalEndpoint = '/v1/messages';
      } else if (providerLower === 'gemini') {
        const hasGeminiPath = /\/models\/gemini-/i.test(finalEndpoint);
        if (!hasGeminiPath) {
          const targetModelLocal = (canonicalRequest.model && canonicalRequest.model.startsWith('gemini-'))
            ? canonicalRequest.model
            : 'gemini-1.5-flash';
          finalEndpoint = `/v1/models/${targetModelLocal}:generateContent`;
        }
      }
    }

    // 4. Adapt model names
    const modelFromEndpoint = finalEndpoint.match(/\/models\/([^/:]+)/)?.[1];
    targetModel = modelFromEndpoint || canonicalRequest.model;
    if (providerLower === 'openai' && !targetModel.startsWith('gpt-')) {
      targetModel = 'gpt-4o';
    } else if (providerLower === 'gemini' && !targetModel.startsWith('gemini-')) {
      targetModel = 'gemini-1.5-flash';
    } else if (providerLower === 'anthropic' && !targetModel.startsWith('claude-')) {
      targetModel = 'claude-3-5-sonnet-20241022';
    }

    // 5. Adapt request to target format
    finalBody = targetAdapter.toProviderRequest(canonicalRequest, targetModel);
  }

  // Helper to execute provider API or fall back to simulation
  const executeCall = async () => {
    // Enforce API key configuration for real execution if userId is present
    if (userId && (providerLower === 'openai' || providerLower === 'gemini' || providerLower === 'anthropic')) {
      const providerKeyDoc = await ProviderKey.findOne({
        userId,
        provider: providerLower,
        isActive: true
      });
      if (!providerKeyDoc) {
        throw new Error(`ConfigurationError: Active API key for provider '${providerLower}' not found in vault`);
      }
      
      const apiKey = providerKeyDoc.getDecryptedValue();
      if (apiKey && !apiKey.startsWith('demo-')) {
        const startTime = Date.now();
        try {
          if (providerLower === 'openai') {
            const url = `https://api.openai.com${finalEndpoint}`;
            logger.info(`Routing gateway request to real OpenAI endpoint: ${finalEndpoint}`);
            const response = await fetch(url, {
              method,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(finalBody) : undefined
            });
            const latency = Date.now() - startTime;
            if (!response.ok) {
              const errorText = await response.text();
              const err = new Error(`OpenAI Provider HTTP Error ${response.status}: ${errorText}`);
              err.status = response.status;
              throw err;
            }
            const data = await response.json();
            const promptTokens = (data.usage && data.usage.prompt_tokens) || 0;
            const completionTokens = (data.usage && data.usage.completion_tokens) || 0;
            const totalTokens = (data.usage && data.usage.total_tokens) || (promptTokens + completionTokens);
            const model = data.model || finalBody.model || 'gpt-4o';
            return { data, tokensUsed: { promptTokens, completionTokens, totalTokens }, model, latency };
          }

          if (providerLower === 'gemini') {
            const geminiUrl = `https://generativelanguage.googleapis.com${finalEndpoint}?key=${apiKey}`;
            logger.info(`Routing gateway request to real Gemini endpoint: ${finalEndpoint}`);
            const response = await fetch(geminiUrl, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(finalBody) : undefined
            });
            const latency = Date.now() - startTime;
            if (!response.ok) {
              const errorText = await response.text();
              const err = new Error(`Gemini Provider HTTP Error ${response.status}: ${errorText}`);
              err.status = response.status;
              throw err;
            }
            const data = await response.json();
            const usage = data.usageMetadata || {};
            const gPromptTokens = usage.promptTokenCount || 0;
            const gCompletionTokens = usage.candidatesTokenCount || 0;
            const gTotalTokens = usage.totalTokenCount || (gPromptTokens + gCompletionTokens);
            const gModel = data.modelVersion || targetModel || 'gemini-1.5-flash';
            return { data, tokensUsed: { promptTokens: gPromptTokens, completionTokens: gCompletionTokens, totalTokens: gTotalTokens }, model: gModel, latency };
          }

          if (providerLower === 'anthropic') {
            const url = `https://api.anthropic.com${finalEndpoint}`;
            logger.info(`Routing gateway request to real Anthropic endpoint: ${finalEndpoint}`);
            const response = await fetch(url, {
              method,
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
              },
              body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(finalBody) : undefined
            });
            const latency = Date.now() - startTime;
            if (!response.ok) {
              const errorText = await response.text();
              const err = new Error(`Anthropic Provider HTTP Error ${response.status}: ${errorText}`);
              err.status = response.status;
              throw err;
            }
            const data = await response.json();
            const promptTokens = (data.usage && data.usage.input_tokens) || 0;
            const completionTokens = (data.usage && data.usage.output_tokens) || 0;
            const totalTokens = promptTokens + completionTokens;
            const model = data.model || finalBody.model || 'claude-3-5-sonnet-20241022';
            return { data, tokensUsed: { promptTokens, completionTokens, totalTokens }, model, latency };
          }
        } catch (err) {
          const classified = classifyAndSanitizeError(err, providerLower, providerKeyDoc);
          if (providerKeyDoc && (classified.errorClass === 'quota_exhausted' || classified.errorClass === 'authentication_failed' || classified.errorClass === 'rate_limited')) {
            providerKeyDoc.validationStatus = classified.errorClass;
            await providerKeyDoc.save();
          }
          throw classified;
        }
      }
  }

    // Simulation code if no active keys or userId is missing
    const latency = Math.floor(Math.random() * 600) + 200;
    await new Promise(resolve => setTimeout(resolve, latency));

    if (Math.random() < 0.02) {
      throw new Error(`${provider} Gateway Timeout (Simulated failure for retry testing)`);
    }

    switch (providerLower) {
      case 'openai': {
        const model = finalBody.model || 'gpt-4o';
        const promptText = (finalBody.messages && finalBody.messages[0] && finalBody.messages[0].content) || 'Hello';
        const promptTokens = Math.max(5, Math.ceil(promptText.length / 4));
        const completionTokens = Math.floor(Math.random() * 80) + 20;
        const responseData = {
          id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: `This is a simulated AI response from OpenAI for your prompt: "${promptText.substring(0, 30)}..."`
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        };
        return { data: responseData, tokensUsed: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }, model, latency };
      }

      case 'gemini': {
        const gModel = targetModel || 'gemini-1.5-flash';
        const gPrompt = (finalBody.contents && finalBody.contents[0] && finalBody.contents[0].parts && finalBody.contents[0].parts[0] && finalBody.contents[0].parts[0].text) || 'Hello';
        const gPromptTokens = Math.max(5, Math.ceil(gPrompt.length / 4));
        const gCompletionTokens = Math.floor(Math.random() * 60) + 15;
        const responseData = {
          candidates: [{
            content: {
              parts: [{ text: `Gemini simulated response. Input parsed: "${gPrompt.substring(0, 35)}"` }],
              role: 'model'
            },
            finishReason: 'STOP',
            index: 0
          }],
          usageMetadata: {
            promptTokenCount: gPromptTokens,
            candidatesTokenCount: gCompletionTokens,
            totalTokenCount: gPromptTokens + gCompletionTokens
          }
        };
        return { data: responseData, tokensUsed: { promptTokens: gPromptTokens, completionTokens: gCompletionTokens, totalTokens: gPromptTokens + gCompletionTokens }, model: gModel, latency };
      }

      case 'anthropic': {
        const aModel = finalBody.model || 'claude-3-5-sonnet-20241022';
        const aPrompt = (finalBody.messages && finalBody.messages[0] && finalBody.messages[0].content) || 'Hello';
        const promptTokens = Math.max(5, Math.ceil(aPrompt.length / 4));
        const completionTokens = Math.floor(Math.random() * 70) + 20;
        const responseData = {
          id: `msg_${Math.random().toString(36).substr(2, 9)}`,
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'text',
            text: `Claude simulated response. Input parsed: "${aPrompt.substring(0, 35)}"`
          }],
          model: aModel,
          usage: {
            input_tokens: promptTokens,
            output_tokens: completionTokens
          }
        };
        return { data: responseData, tokensUsed: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }, model: aModel, latency };
      }

      case 'stripe':
        return {
          data: {
            id: `ch_${Math.random().toString(36).substr(2, 14)}`,
            object: 'charge',
            amount: finalBody.amount || 2000,
            currency: finalBody.currency || 'usd',
            paid: true,
            status: 'succeeded',
            customer: finalBody.customer || 'cus_random123',
            payment_method: 'pm_card_visa'
          },
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'payment-intent',
          latency
        };

      case 'google_maps':
        return {
          data: {
            predictions: [
              { description: '1600 Amphitheatre Pkwy, Mountain View, CA, USA', place_id: 'ChIJ2eUgeAK6j4ARbn5u_wBq0hs' },
              { description: 'Google Building 40, Mountain View, CA, USA', place_id: 'ChIJ5345uAK6j4AR-Ua4wBq0hs' }
            ],
            status: 'OK'
          },
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'places-api',
          latency
        };

      case 'twilio':
        return {
          data: {
            sid: `SM${Math.random().toString(36).substr(2, 32)}`,
            status: 'queued',
            to: finalBody.to || '+1234567890',
            from: finalBody.from || '+0987654321',
            body: finalBody.body || 'Simulated text',
            date_created: new Date().toISOString()
          },
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'sms-api',
          latency
        };

      case 'weather':
        return {
          data: {
            location: { name: finalBody.city || 'San Francisco', country: 'US' },
            current: { temp_c: 18.5, condition: { text: 'Partly Cloudy' }, humidity: 62 }
          },
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'weather-fetch',
          latency
        };

      default:
        return {
          data: {
            message: 'Custom REST API response simulated successfully.',
            timestamp: new Date().toISOString(),
            echoPayload: finalBody
          },
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'rest-api',
          latency
        };
    }
  };

  // Run external API or simulation
  const result = await executeCall();

  // 6. Response transformation back to input protocol
  if (inputAdapter && targetAdapter && (providerLower === 'openai' || providerLower === 'gemini' || providerLower === 'anthropic')) {
    const canonicalResponse = targetAdapter.normalizeResponse(result.data, result.model);
    const finalClientResponse = inputAdapter.toClientResponse(canonicalResponse);
    return {
      data: finalClientResponse,
      tokensUsed: result.tokensUsed,
      model: result.model,
      latency: result.latency
    };
  }

  return result;
};

module.exports = {
  simulateApiCall,
  classifyAndSanitizeError
};
