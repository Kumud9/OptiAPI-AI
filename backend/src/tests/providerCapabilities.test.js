'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectCapabilities } = require('../services/providerValidationService');

test('Provider Capabilities Verification Tests', async (t) => {
  await t.test('gemini-3.6-flash does not inherit from gemini-1.5-flash capabilities', () => {
    const capabilities = detectCapabilities('gemini-3.6-flash');
    // Ensure it inherits from current gemini-3.5-flash family (audio is true)
    assert.strictEqual(capabilities.text, true);
    assert.strictEqual(capabilities.audio, true);
  });

  await t.test('explicit Gemini API metadata takes priority', () => {
    const capabilities = detectCapabilities('gemini-3.6-flash', {
      supportedFeatures: ['text', 'vision', 'tools']
    });
    assert.strictEqual(capabilities.vision, true);
    assert.strictEqual(capabilities.tools, true);
  });

  await t.test('unknown capabilities remain null', () => {
    const capabilities = detectCapabilities('random-llm-model');
    assert.strictEqual(capabilities.text, null);
    assert.strictEqual(capabilities.streaming, null);
    assert.strictEqual(capabilities.vision, null);
    assert.strictEqual(capabilities.audio, null);
  });

  await t.test('current Gemini family fallback works only when metadata is unavailable', () => {
    const capabilities = detectCapabilities('gemini-3.5-flash-lite', {
      supportedFeatures: ['text']
    });
    // audio is not in metadata, so it falls back to gemini-3.5-flash-lite fallback which is false
    assert.strictEqual(capabilities.audio, false);
  });
});
