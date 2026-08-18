'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { getAdapter, validateCapabilities } = require('../adapters');

test('OptiAPI Adapter Transformation Matrix', async (t) => {
  
  await t.test('OpenAI input → Gemini request conversion', () => {
    const openaiPayload = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' }
      ],
      temperature: 0.7,
      max_tokens: 150
    };

    const openaiAdapter = getAdapter('openai');
    const geminiAdapter = getAdapter('gemini');

    const canonical = openaiAdapter.normalizeRequest(openaiPayload, '/v1/chat/completions');
    
    // Assert canonical format
    assert.strictEqual(canonical.model, 'gpt-4o');
    assert.strictEqual(canonical.messages.length, 2);
    assert.strictEqual(canonical.messages[0].role, 'system');
    assert.strictEqual(canonical.messages[0].content, 'You are a helpful assistant.');
    assert.strictEqual(canonical.messages[1].role, 'user');
    assert.strictEqual(canonical.messages[1].content, 'What is the capital of France?');
    assert.strictEqual(canonical.temperature, 0.7);
    assert.strictEqual(canonical.maxTokens, 150);

    // Convert to Gemini request
    const geminiRequest = geminiAdapter.toProviderRequest(canonical, 'gemini-1.5-flash');
    assert.ok(geminiRequest.contents);
    assert.strictEqual(geminiRequest.contents.length, 1);
    assert.strictEqual(geminiRequest.contents[0].role, 'user');
    assert.strictEqual(geminiRequest.contents[0].parts[0].text, 'What is the capital of France?');
    assert.strictEqual(geminiRequest.systemInstruction.parts[0].text, 'You are a helpful assistant.');
    assert.strictEqual(geminiRequest.generationConfig.temperature, 0.7);
    assert.strictEqual(geminiRequest.generationConfig.maxOutputTokens, 150);
  });

  await t.test('OpenAI input → Anthropic request conversion', () => {
    const openaiPayload = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'Hello Claude' }
      ]
    };

    const openaiAdapter = getAdapter('openai');
    const anthropicAdapter = getAdapter('anthropic');

    const canonical = openaiAdapter.normalizeRequest(openaiPayload, '/v1/chat/completions');
    const anthropicRequest = anthropicAdapter.toProviderRequest(canonical, 'claude-3-5-sonnet-20241022');

    assert.strictEqual(anthropicRequest.model, 'claude-3-5-sonnet-20241022');
    assert.strictEqual(anthropicRequest.system, 'System instruction');
    assert.strictEqual(anthropicRequest.messages.length, 1);
    assert.strictEqual(anthropicRequest.messages[0].role, 'user');
    assert.strictEqual(anthropicRequest.messages[0].content, 'Hello Claude');
  });

  await t.test('Gemini input → OpenAI request conversion', () => {
    const geminiPayload = {
      contents: [
        { role: 'user', parts: [{ text: 'Question' }] }
      ],
      systemInstruction: {
        parts: [{ text: 'System' }]
      }
    };

    const geminiAdapter = getAdapter('gemini');
    const openaiAdapter = getAdapter('openai');

    const canonical = geminiAdapter.normalizeRequest(geminiPayload, '/v1/models/gemini-1.5-flash:generateContent');
    const openaiRequest = openaiAdapter.toProviderRequest(canonical, 'gpt-4o');

    assert.strictEqual(openaiRequest.model, 'gpt-4o');
    assert.strictEqual(openaiRequest.messages.length, 2);
    assert.strictEqual(openaiRequest.messages[0].role, 'system');
    assert.strictEqual(openaiRequest.messages[0].content, 'System');
    assert.strictEqual(openaiRequest.messages[1].role, 'user');
    assert.strictEqual(openaiRequest.messages[1].content, 'Question');
  });

  await t.test('Response normalization and output back-formatting', () => {
    const geminiResponse = {
      candidates: [{
        content: {
          parts: [{ text: 'Gemini response text' }],
          role: 'model'
        },
        finishReason: 'STOP',
        index: 0
      }],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 30,
        totalTokenCount: 45
      },
      modelVersion: 'gemini-1.5-flash'
    };

    const geminiAdapter = getAdapter('gemini');
    const openaiAdapter = getAdapter('openai');

    // Gemini response → CanonicalResponse
    const canonicalResponse = geminiAdapter.normalizeResponse(geminiResponse, 'gemini-1.5-flash');
    assert.strictEqual(canonicalResponse.text, 'Gemini response text');
    assert.strictEqual(canonicalResponse.usage.promptTokens, 15);
    assert.strictEqual(canonicalResponse.usage.completionTokens, 30);

    // CanonicalResponse → OpenAI Response (formatted back to OpenAI client)
    const clientResponse = openaiAdapter.toClientResponse(canonicalResponse);
    assert.strictEqual(clientResponse.object, 'chat.completion');
    assert.strictEqual(clientResponse.choices[0].message.content, 'Gemini response text');
    assert.strictEqual(clientResponse.usage.prompt_tokens, 15);
  });

  await t.test('Capability validation rejection for streaming and multimodal', () => {
    const streamRequest = {
      stream: true,
      messages: [{ role: 'user', content: 'test' }]
    };
    const canonical = getAdapter('openai').normalizeRequest(streamRequest, '/v1/chat/completions');
    const check = validateCapabilities(canonical, 'gemini');
    
    assert.strictEqual(check.supported, false);
    assert.ok(check.reason.includes('Streaming'));
  });
});
