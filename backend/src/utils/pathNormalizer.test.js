const test = require('node:test');
const assert = require('node:assert');
const { normalizeEndpoint } = require('./pathNormalizer');

test('Path Normalizer - Basic endpoint with leading slash', () => {
  assert.strictEqual(normalizeEndpoint('/v1/customers'), '/v1/customers');
});

test('Path Normalizer - Endpoint with duplicate leading slashes', () => {
  assert.strictEqual(normalizeEndpoint('//v1/customers'), '/v1/customers');
  assert.strictEqual(normalizeEndpoint('///v1/customers'), '/v1/customers');
});

test('Path Normalizer - Endpoint without leading slash', () => {
  assert.strictEqual(normalizeEndpoint('v1/customers'), '/v1/customers');
});

test('Path Normalizer - Root slash and multiple slashes', () => {
  assert.strictEqual(normalizeEndpoint('/'), '/');
  assert.strictEqual(normalizeEndpoint('//'), '/');
  assert.strictEqual(normalizeEndpoint('///'), '/');
  assert.strictEqual(normalizeEndpoint(''), '/');
  assert.strictEqual(normalizeEndpoint(null), '/');
  assert.strictEqual(normalizeEndpoint(undefined), '/');
});

test('Path Normalizer - Duplicate slashes inside path', () => {
  assert.strictEqual(normalizeEndpoint('/v1//customers'), '/v1/customers');
  assert.strictEqual(normalizeEndpoint('//v1//customers//details'), '/v1/customers/details');
});

test('Path Normalizer - Strip provider prefix', () => {
  assert.strictEqual(normalizeEndpoint('/gemini/v1/models'), '/v1/models');
  assert.strictEqual(normalizeEndpoint('openai/v1/chat/completions'), '/v1/chat/completions');
  assert.strictEqual(normalizeEndpoint('/stripe'), '/');
});

test('Path Normalizer - Standardize Gemini version prefix', () => {
  assert.strictEqual(normalizeEndpoint('/v1beta/models'), '/v1/models');
  assert.strictEqual(normalizeEndpoint('gemini/v1beta/models/gemini-3.6-flash:generateContent'), '/v1/models/gemini-3.6-flash:generateContent');
});

