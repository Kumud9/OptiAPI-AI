const logger = require('../utils/logger');
const ProviderKey = require('../models/ProviderKey');

const simulateApiCall = async (provider, endpoint, method, body = {}, headers = {}, userId = null) => {
  const providerLower = provider.toLowerCase();

  // 1. Check if a real credential exists in the vault for this user and provider
  if (userId && providerLower === 'openai') {
    try {
      const providerKeyDoc = await ProviderKey.findOne({
        userId,
        provider: 'openai',
        isActive: true
      });
      logger.info(`OpenAI vault lookup: ${providerKeyDoc ? 'FOUND' : 'NOT FOUND'}`);

      if (providerKeyDoc) {
        const apiKey = providerKeyDoc.getDecryptedValue();
        const startTime = Date.now();
        const url = `https://api.openai.com${endpoint}`;

        logger.info(`Routing gateway request to real OpenAI endpoint: ${endpoint}`);

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined
        });

        const latency = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI Provider HTTP Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const promptTokens = (data.usage && data.usage.prompt_tokens) || 0;
        const completionTokens = (data.usage && data.usage.completion_tokens) || 0;
        const totalTokens = (data.usage && data.usage.total_tokens) || (promptTokens + completionTokens);
        const model = data.model || body.model || 'gpt-4o';

        return {
          data,
          tokensUsed: { promptTokens, completionTokens, totalTokens },
          model,
          latency
        };
      }
    } catch (err) {
      logger.error(`Real OpenAI API execution error: ${err.message}`);
      // Re-throw to trigger retry mechanism for genuine provider failures
      throw err;
    }
  }

  // Simulate network latency (200ms - 800ms)
  const latency = Math.floor(Math.random() * 600) + 200;
  await new Promise(resolve => setTimeout(resolve, latency));

  // Custom error injection (1% rate to test gateway retries)
  if (Math.random() < 0.02) {
    throw new Error(`${provider} Gateway Timeout (Simulated failure for retry testing)`);
  }

  switch (providerLower) {
    case 'openai':
      const model = body.model || 'gpt-4o';
      const promptText = (body.messages && body.messages[0] && body.messages[0].content) || 'Hello';
      const promptTokens = Math.max(5, Math.ceil(promptText.length / 4));
      const completionTokens = Math.floor(Math.random() * 80) + 20;

      return {
        data: {
          id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: `This is a simulated AI response from OptiAPI for your prompt: "${promptText.substring(0, 30)}..."`
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        },
        tokensUsed: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
        model,
        latency
      };

    case 'gemini':
      // 2. Real Gemini routing: vault lookup for active credential
      if (userId) {
        try {
          const geminiKeyDoc = await ProviderKey.findOne({
            userId,
            provider: 'gemini',
            isActive: true
          });

          if (geminiKeyDoc) {
            const geminiApiKey = geminiKeyDoc.getDecryptedValue();
            const geminiStartTime = Date.now();
            // Forward endpoint as-is (e.g. /v1/models/gemini-1.5-flash:generateContent)
            const geminiUrl = `https://generativelanguage.googleapis.com${endpoint}?key=${geminiApiKey}`;

            logger.info(`Routing gateway request to real Gemini endpoint: ${endpoint}`);

            const geminiResponse = await fetch(geminiUrl, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined
            });

            const geminiLatency = Date.now() - geminiStartTime;

            if (!geminiResponse.ok) {
              const errorText = await geminiResponse.text();
              throw new Error(`Gemini Provider HTTP Error ${geminiResponse.status}: ${errorText}`);
            }

            const geminiData = await geminiResponse.json();
            const usage = geminiData.usageMetadata || {};
            const gPromptTokens = usage.promptTokenCount || 0;
            const gCompletionTokens = usage.candidatesTokenCount || 0;
            const gTotalTokens = usage.totalTokenCount || (gPromptTokens + gCompletionTokens);
            const gModel = (geminiData.modelVersion) ||
              (geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.model) ||
              body.model || 'gemini-1.5-flash';

            return {
              data: geminiData,
              tokensUsed: { promptTokens: gPromptTokens, completionTokens: gCompletionTokens, totalTokens: gTotalTokens },
              model: gModel,
              latency: geminiLatency
            };
          }
        } catch (err) {
          logger.error(`Real Gemini API execution error: ${err.message}`);
          // Re-throw to trigger retry mechanism for genuine provider failures
          throw err;
        }
      }

      // Simulated Gemini fallback (no active vault credential found)
      {
        const gModel = body.model || 'gemini-1.5-flash';
        const gPrompt = (body.contents && body.contents[0] && body.contents[0].parts[0].text) || 'Hello';
        const gPromptTokens = Math.max(5, Math.ceil(gPrompt.length / 4));
        const gCompletionTokens = Math.floor(Math.random() * 60) + 15;

        return {
          data: {
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
          },
          tokensUsed: { promptTokens: gPromptTokens, completionTokens: gCompletionTokens, totalTokens: gPromptTokens + gCompletionTokens },
          model: gModel,
          latency
        };
      }

    case 'anthropic':
      if (!userId) {
        throw new Error('User authentication required for Anthropic API requests');
      }
      {
        const providerKeyDoc = await ProviderKey.findOne({
          userId,
          provider: 'anthropic',
          isActive: true
        });

        if (!providerKeyDoc) {
          throw new Error('No active Anthropic API key found in vault for this user');
        }

        const apiKey = providerKeyDoc.getDecryptedValue();
        const startTime = Date.now();
        const url = `https://api.anthropic.com${endpoint}`;

        logger.info(`Routing gateway request to real Anthropic endpoint: ${endpoint}`);

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined
        });

        const latency = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Anthropic Provider HTTP Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const promptTokens = (data.usage && data.usage.input_tokens) || 0;
        const completionTokens = (data.usage && data.usage.output_tokens) || 0;
        const totalTokens = promptTokens + completionTokens;
        const model = data.model || body.model || 'claude-sonnet-4-6';

        return {
          data,
          tokensUsed: { promptTokens, completionTokens, totalTokens },
          model,
          latency
        };
      }

    case 'stripe':
      return {
        data: {
          id: `ch_${Math.random().toString(36).substr(2, 14)}`,
          object: 'charge',
          amount: body.amount || 2000,
          currency: body.currency || 'usd',
          paid: true,
          status: 'succeeded',
          customer: body.customer || 'cus_random123',
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
          to: body.to || '+1234567890',
          from: body.from || '+0987654321',
          body: body.body || 'Simulated text',
          date_created: new Date().toISOString()
        },
        tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: 'sms-api',
        latency
      };

    case 'weather':
      return {
        data: {
          location: { name: body.city || 'San Francisco', country: 'US' },
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
          echoPayload: body
        },
        tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: 'rest-api',
        latency
      };
  }
};

module.exports = {
  simulateApiCall
};
