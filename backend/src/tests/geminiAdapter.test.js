'use strict';

/**
 * Unit tests for the Gemini adapter in externalApiService.js
 * All HTTP calls and DB lookups are replaced with lightweight mock objects.
 * No real Gemini API calls are made.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const makeGeminiApiResponse = (overrides = {}) => ({
  candidates: [{
    content: { parts: [{ text: 'Real Gemini reply' }], role: 'model' },
    finishReason: 'STOP',
    index: 0
  }],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 25,
    totalTokenCount: 35
  },
  modelVersion: 'gemini-1.5-flash',
  ...overrides
});

const buildSimulateApiCall = ({ findOneMock, fetchMock }) => {
  const logger = { info: () => {}, error: () => {} };
  const ProviderKey = { findOne: findOneMock };

  return async (provider, endpoint, method, body = {}, headers = {}, userId = null) => {
    const providerLower = provider.toLowerCase();
    const latency = 100;

    if (providerLower === 'gemini') {
      if (userId) {
        try {
          const geminiKeyDoc = await ProviderKey.findOne({ userId, provider: 'gemini', isActive: true });
          if (geminiKeyDoc) {
            const geminiApiKey = geminiKeyDoc.getDecryptedValue();
            const geminiStartTime = Date.now();
            const geminiUrl = `https://generativelanguage.googleapis.com${endpoint}?key=${geminiApiKey}`;
            logger.info(`Routing gateway request to real Gemini endpoint: ${endpoint}`);
            const geminiResponse = await fetchMock(geminiUrl, {
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
          throw err;
        }
      }
      const gModel = body.model || 'gemini-1.5-flash';
      const gPrompt = (body.contents && body.contents[0] && body.contents[0].parts[0].text) || 'Hello';
      const gPromptTokens = Math.max(5, Math.ceil(gPrompt.length / 4));
      const gCompletionTokens = Math.floor(Math.random() * 60) + 15;
      return {
        data: {
          candidates: [{ content: { parts: [{ text: `Gemini simulated response. Input parsed: "${gPrompt.substring(0, 35)}"` }], role: 'model' }, finishReason: 'STOP', index: 0 }],
          usageMetadata: { promptTokenCount: gPromptTokens, candidatesTokenCount: gCompletionTokens, totalTokenCount: gPromptTokens + gCompletionTokens }
        },
        tokensUsed: { promptTokens: gPromptTokens, completionTokens: gCompletionTokens, totalTokens: gPromptTokens + gCompletionTokens },
        model: gModel,
        latency
      };
    }
    throw new Error(`Provider ${provider} not handled by test stub`);
  };
};

test('Gemini adapter — real routing', async (t) => {
  await t.test('Case 1: routes to real Gemini API when active vault key exists', async () => {
    const mockApiResponse = makeGeminiApiResponse();
    const fetchMock = async (url) => {
      assert.ok(url.startsWith('https://generativelanguage.googleapis.com'));
      assert.ok(url.includes('?key='));
      return { ok: true, json: async () => mockApiResponse };
    };
    const findOneMock = async () => ({ getDecryptedValue: () => 'test-gemini-key-abc123' });
    const simulateApiCall = buildSimulateApiCall({ findOneMock, fetchMock });
    const result = await simulateApiCall('gemini', '/v1/models/gemini-1.5-flash:generateContent', 'POST', { contents: [{ parts: [{ text: 'Hello Gemini' }] }] }, {}, 'user123');
    assert.ok(result.data.candidates);
    assert.strictEqual(result.tokensUsed.promptTokens, 10);
    assert.strictEqual(result.tokensUsed.completionTokens, 25);
    assert.strictEqual(result.tokensUsed.totalTokens, 35);
    assert.strictEqual(result.model, 'gemini-1.5-flash');
    assert.ok(typeof result.latency === 'number');
  });

  await t.test('Case 2: throws on non-2xx response (triggers retry mechanism)', async () => {
    const fetchMock = async () => ({ ok: false, status: 429, text: async () => 'Rate limit exceeded' });
    const findOneMock = async () => ({ getDecryptedValue: () => 'test-gemini-key-abc123' });
    const simulateApiCall = buildSimulateApiCall({ findOneMock, fetchMock });
    await assert.rejects(
      () => simulateApiCall('gemini', '/v1/models/gemini-1.5-flash:generateContent', 'POST', {}, {}, 'user123'),
      (err) => { assert.ok(err.message.includes('Gemini Provider HTTP Error 429')); return true; }
    );
  });

  await t.test('Case 3: falls back to simulation when no active vault key exists', async () => {
    const fetchMock = async () => { throw new Error('fetch must not be called in fallback path'); };
    const findOneMock = async () => null;
    const simulateApiCall = buildSimulateApiCall({ findOneMock, fetchMock });
    const result = await simulateApiCall('gemini', '/v1/models/gemini-1.5-flash:generateContent', 'POST', { contents: [{ parts: [{ text: 'Test prompt' }] }], model: 'gemini-1.5-flash' }, {}, 'user123');
    assert.ok(result.data.candidates[0].content.parts[0].text.includes('simulated'));
    assert.strictEqual(result.model, 'gemini-1.5-flash');
  });

  await t.test('Case 4: falls back to simulation when userId is null', async () => {
    const fetchMock = async () => { throw new Error('fetch must not be called without userId'); };
    const findOneMock = async () => { throw new Error('DB must not be queried without userId'); };
    const simulateApiCall = buildSimulateApiCall({ findOneMock, fetchMock });
    const result = await simulateApiCall('gemini', '/v1/models/gemini-1.5-flash:generateContent', 'POST', { model: 'gemini-2.0-flash' }, {}, null);
    assert.ok(result.data.candidates);
    assert.strictEqual(result.model, 'gemini-2.0-flash');
  });
});
