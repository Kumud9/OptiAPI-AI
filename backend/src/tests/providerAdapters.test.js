'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { getAdapter } = require('../adapters');
const { simulateApiCall } = require('../services/externalApiService');
const { classifyAndSanitizeError } = require('../services/externalApiService');

test('Provider Adapter Suite', async (t) => {

  await t.test('1. OpenAI -> OpenAI: Original model remains target model', () => {
    const openaiAdapter = getAdapter('openai');
    const body = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say hello.' }]
    };
    
    // Step 1: Normalize
    const canonical = openaiAdapter.normalizeRequest(body, '/v1/chat/completions');
    assert.strictEqual(canonical.model, 'gpt-3.5-turbo');

    // Step 2: To Provider Request
    const providerReq = openaiAdapter.toProviderRequest(canonical, 'gpt-3.5-turbo');
    assert.strictEqual(providerReq.model, 'gpt-3.5-turbo');
  });

  await t.test('2. OpenAI -> Gemini: Input model gpt-3.5-turbo translates to target gemini-3.6-flash', () => {
    const openaiAdapter = getAdapter('openai');
    const geminiAdapter = getAdapter('gemini');
    
    const body = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say hello.' }]
    };

    // Normalize from OpenAI
    const canonical = openaiAdapter.normalizeRequest(body, '/v1/chat/completions');
    
    // Adapt to Gemini body using target model gemini-3.6-flash
    const geminiReq = geminiAdapter.toProviderRequest(canonical, 'gemini-3.6-flash');
    
    // Check that we never send gpt-3.5-turbo inside the adapted Gemini body
    const bodyString = JSON.stringify(geminiReq);
    assert.ok(!bodyString.includes('gpt-3.5-turbo'), 'Gemini request must never contain gpt-3.5-turbo');
    assert.ok(geminiReq.contents[0].parts[0].text.includes('Say hello.'));
  });

  await t.test('3. Gemini request -> Gemini: Gemini-native request preserved correctly', () => {
    const geminiAdapter = getAdapter('gemini');
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Hello!' }] }],
      generationConfig: { temperature: 0.7 }
    };

    const canonical = geminiAdapter.normalizeRequest(body, '/v1beta/models/gemini-3.6-flash:generateContent');
    assert.strictEqual(canonical.messages[0].content, 'Hello!');

    const providerReq = geminiAdapter.toProviderRequest(canonical, 'gemini-3.6-flash');
    assert.strictEqual(providerReq.contents[0].parts[0].text, 'Hello!');
    assert.strictEqual(providerReq.generationConfig.temperature, 0.7);
  });

  await t.test('4. Gemini -> OpenAI: Model translation works in the opposite direction', () => {
    const geminiAdapter = getAdapter('gemini');
    const openaiAdapter = getAdapter('openai');

    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Hello!' }] }]
    };

    const canonical = geminiAdapter.normalizeRequest(body, '/v1beta/models/gemini-3.6-flash:generateContent');
    const openaiReq = openaiAdapter.toProviderRequest(canonical, 'gpt-4o');

    assert.strictEqual(openaiReq.model, 'gpt-4o');
    assert.strictEqual(openaiReq.messages[0].content, 'Hello!');
  });

  await t.test('5. Response normalization: Gemini response -> OpenAI-compatible response', () => {
    const geminiAdapter = getAdapter('gemini');
    const openaiAdapter = getAdapter('openai');

    // Simulate response returned by Gemini API
    const geminiResponse = {
      candidates: [{
        content: {
          parts: [{ text: 'Greetings!' }],
          role: 'model'
        },
        finishReason: 'STOP',
        index: 0
      }],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 20,
        totalTokenCount: 35
      },
      modelVersion: 'gemini-3.6-flash'
    };

    // Normalize Gemini response to CanonicalResponse
    const canonical = geminiAdapter.normalizeResponse(geminiResponse, 'gemini-3.6-flash');
    assert.strictEqual(canonical.text, 'Greetings!');
    assert.strictEqual(canonical.usage.promptTokens, 15);

    // Convert CanonicalResponse back to OpenAI client protocol
    const clientResponse = openaiAdapter.toClientResponse(canonical);
    assert.strictEqual(clientResponse.object, 'chat.completion');
    assert.strictEqual(clientResponse.choices[0].message.content, 'Greetings!');
    assert.strictEqual(clientResponse.usage.prompt_tokens, 15);
  });

  await t.test('6 & 7. Provider error normalization and sanitization (API keys never exposed)', () => {
    const sampleErrorMsg = 'Failed to execute call. Key value: sk-proj-supersecretkey123456';
    const err = new Error(sampleErrorMsg);
    err.status = 401;

    const normalized = classifyAndSanitizeError(err, 'openai');
    
    // Normalized check
    assert.strictEqual(normalized.errorClass, 'authentication_failed');
    assert.strictEqual(normalized.shouldRetry, false);
    
    // Key sanitization check
    assert.ok(!normalized.message.includes('sk-proj-'), 'Normalized error message must never expose sensitive API key values');
    assert.ok(normalized.message.includes('REDACTED'));
  });
});
