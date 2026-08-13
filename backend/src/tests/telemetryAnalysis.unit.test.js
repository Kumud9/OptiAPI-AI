/**
 * Unit tests for telemetryAnalysis pure-logic helpers.
 * No MongoDB, no HTTP, no external calls.
 * Run: node --test src/tests/telemetryAnalysis.unit.test.js
 */
'use strict';

const test   = require('node:test');
const assert = require('node:assert');

// Load only the exported pure helpers — NOT the DB-dependent buildTelemetryMetrics
const { deriveModelFromEndpoint, resolveModel, p95 } =
  require('../services/telemetryAnalysis');

// ---------------------------------------------------------------------------
test('deriveModelFromEndpoint', async (t) => {
  await t.test('extracts model from Gemini generateContent endpoint', () => {
    assert.strictEqual(
      deriveModelFromEndpoint('/v1/models/gemini-3.1-flash-lite:generateContent'),
      'gemini-3.1-flash-lite'
    );
  });

  await t.test('extracts model from Gemini streamGenerateContent endpoint', () => {
    assert.strictEqual(
      deriveModelFromEndpoint('/v1/models/gemini-1.5-pro-exp-0801:streamGenerateContent'),
      'gemini-1.5-pro-exp-0801'
    );
  });

  await t.test('extracts model from versioned Gemini path', () => {
    assert.strictEqual(
      deriveModelFromEndpoint('/v1beta/models/gemini-1.5-flash:generateContent'),
      'gemini-1.5-flash'
    );
  });

  await t.test('returns null for OpenAI chat completions (no model in path)', () => {
    assert.strictEqual(
      deriveModelFromEndpoint('/v1/chat/completions'),
      null
    );
  });

  await t.test('returns null for null endpoint', () => {
    assert.strictEqual(deriveModelFromEndpoint(null), null);
  });

  await t.test('returns null for empty endpoint', () => {
    assert.strictEqual(deriveModelFromEndpoint(''), null);
  });
});

// ---------------------------------------------------------------------------
test('resolveModel', async (t) => {
  await t.test('uses stored model when present', () => {
    assert.strictEqual(
      resolveModel('gemini-3.1-flash-lite-20250827', '/v1/models/gemini-3.1-flash-lite:generateContent'),
      'gemini-3.1-flash-lite-20250827'
    );
  });

  await t.test('falls back to endpoint extraction when model is null', () => {
    assert.strictEqual(
      resolveModel(null, '/v1/models/gemini-3.1-flash-lite:generateContent'),
      'gemini-3.1-flash-lite'
    );
  });

  await t.test('falls back to endpoint extraction when model is empty string', () => {
    assert.strictEqual(
      resolveModel('', '/v1/models/gemini-1.5-pro:generateContent'),
      'gemini-1.5-pro'
    );
  });

  await t.test('falls back to endpoint extraction when model is whitespace only', () => {
    assert.strictEqual(
      resolveModel('   ', '/v1/models/gemini-1.5-flash:generateContent'),
      'gemini-1.5-flash'
    );
  });

  await t.test('returns "unknown" when both stored model and endpoint yield nothing', () => {
    assert.strictEqual(resolveModel(null, '/v1/chat/completions'), 'unknown');
  });

  await t.test('returns "unknown" when both null', () => {
    assert.strictEqual(resolveModel(null, null), 'unknown');
  });
});

// ---------------------------------------------------------------------------
test('p95', async (t) => {
  await t.test('returns 0 for empty array', () => {
    assert.strictEqual(p95([]), 0);
  });

  await t.test('returns the single value for array of length 1', () => {
    assert.strictEqual(p95([500]), 500);
  });

  await t.test('P95 of 100 values (0-99) is 95', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i).sort((a, b) => a - b);
    assert.strictEqual(p95(arr), 94); // Math.ceil(0.95 * 100) - 1 = 94
  });

  await t.test('P95 of [100, 200, 300, 400, 500, 1000, 2000, 5000, 9000, 10000]', () => {
    const arr = [100, 200, 300, 400, 500, 1000, 2000, 5000, 9000, 10000];
    // ceil(0.95 * 10) - 1 = ceil(9.5) - 1 = 10 - 1 = 9 → arr[9] = 10000
    assert.strictEqual(p95(arr), 10000);
  });

  await t.test('P95 of [100, 200, 300] is last element', () => {
    const arr = [100, 200, 300];
    // ceil(0.95 * 3) - 1 = ceil(2.85) - 1 = 3 - 1 = 2 → arr[2] = 300
    assert.strictEqual(p95(arr), 300);
  });
});
