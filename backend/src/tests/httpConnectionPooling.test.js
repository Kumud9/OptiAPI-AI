const test = require('node:test');
const assert = require('node:assert');
const { Agent } = require('undici');
const {
  simulateApiCall,
  getProviderDispatcher,
  providerAgents,
  DEFAULT_POOL_CONFIG
} = require('../services/externalApiService');
const ProviderKey = require('../models/ProviderKey');

test('Phase 2B: HTTP Connection Pooling Suite', async (t) => {

  await t.test('1. Undici Agent Configuration and Reuse', async () => {
    // Check config defaults
    assert.strictEqual(DEFAULT_POOL_CONFIG.keepAliveTimeout, 60000, 'Keep-alive timeout should be 60s');
    assert.strictEqual(DEFAULT_POOL_CONFIG.keepAliveMaxTimeout, 600000, 'Keep-alive max timeout should be 10min');
    assert.strictEqual(DEFAULT_POOL_CONFIG.connections, 50, 'Max connections per origin should be 50');
    assert.strictEqual(DEFAULT_POOL_CONFIG.pipelining, 1, 'Pipelining should be 1');

    // Verify providerAgents
    assert.ok(providerAgents.openai instanceof Agent, 'OpenAI agent must be an undici Agent');
    assert.ok(providerAgents.gemini instanceof Agent, 'Gemini agent must be an undici Agent');
    assert.ok(providerAgents.anthropic instanceof Agent, 'Anthropic agent must be an undici Agent');

    // Verify reusable singleton references
    const agentOpenAI1 = getProviderDispatcher('openai');
    const agentOpenAI2 = getProviderDispatcher('OpenAI'); // case-insensitive check
    assert.strictEqual(agentOpenAI1, agentOpenAI2, 'Subsequent calls must return the same reusable Agent instance');
    assert.strictEqual(agentOpenAI1, providerAgents.openai);

    const agentGemini = getProviderDispatcher('gemini');
    assert.strictEqual(agentGemini, providerAgents.gemini);

    const agentAnthropic = getProviderDispatcher('anthropic');
    assert.strictEqual(agentAnthropic, providerAgents.anthropic);

    // Different providers have distinct isolated agents
    assert.notStrictEqual(agentOpenAI1, agentGemini, 'OpenAI and Gemini must have isolated agents');
    assert.notStrictEqual(agentOpenAI1, agentAnthropic, 'OpenAI and Anthropic must have isolated agents');

    // Unknown provider
    assert.strictEqual(getProviderDispatcher('unknown_provider'), null);
  });

  await t.test('2. Provider Requests Pass Reusable Dispatcher to Fetch (OpenAI)', async () => {
    const originalFetch = global.fetch;
    const originalFindOne = ProviderKey.findOne;
    let capturedOptions = null;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'sk-test-openai-key-real',
      validationStatus: 'valid'
    });

    global.fetch = async (url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-test',
          model: 'gpt-4o',
          choices: [{ message: { content: 'test response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      };
    };

    try {
      const res = await simulateApiCall(
        'openai',
        '/v1/chat/completions',
        'POST',
        { model: 'gpt-4o', messages: [{ role: 'user', content: 'test' }] },
        {},
        'user_123',
        'openai'
      );

      assert.ok(res.data);
      assert.ok(capturedOptions, 'Fetch must have been called');
      assert.strictEqual(
        capturedOptions.dispatcher,
        getProviderDispatcher('openai'),
        'Fetch must receive the reusable OpenAI connection pool dispatcher'
      );
      assert.ok(capturedOptions.signal, 'AbortSignal timeout must be passed alongside dispatcher');
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalFindOne;
    }
  });

  await t.test('3. Provider Requests Pass Reusable Dispatcher to Fetch (Gemini)', async () => {
    const originalFetch = global.fetch;
    const originalFindOne = ProviderKey.findOne;
    let capturedOptions = null;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'ai-test-gemini-key-real',
      validationStatus: 'valid'
    });

    global.fetch = async (url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          modelVersion: 'gemini-1.5-flash',
          candidates: [{ content: { parts: [{ text: 'gemini response' }] } }],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 }
        })
      };
    };

    try {
      const res = await simulateApiCall(
        'gemini',
        '/v1/models/gemini-1.5-flash:generateContent',
        'POST',
        { contents: [{ parts: [{ text: 'hi' }] }] },
        {},
        'user_123',
        'gemini'
      );

      assert.ok(res.data);
      assert.ok(capturedOptions, 'Fetch must have been called');
      assert.strictEqual(
        capturedOptions.dispatcher,
        getProviderDispatcher('gemini'),
        'Fetch must receive the reusable Gemini connection pool dispatcher'
      );
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalFindOne;
    }
  });

  await t.test('4. Provider Requests Pass Reusable Dispatcher to Fetch (Anthropic)', async () => {
    const originalFetch = global.fetch;
    const originalFindOne = ProviderKey.findOne;
    let capturedOptions = null;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'sk-ant-test-key-real',
      validationStatus: 'valid'
    });

    global.fetch = async (url, options) => {
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg_123',
          model: 'claude-3-5-sonnet-20241022',
          content: [{ text: 'claude response' }],
          usage: { input_tokens: 12, output_tokens: 6 }
        })
      };
    };

    try {
      const res = await simulateApiCall(
        'anthropic',
        '/v1/messages',
        'POST',
        { model: 'claude-3-5-sonnet-20241022', messages: [{ role: 'user', content: 'test' }] },
        {},
        'user_123',
        'anthropic'
      );

      assert.ok(res.data);
      assert.ok(capturedOptions, 'Fetch must have been called');
      assert.strictEqual(
        capturedOptions.dispatcher,
        getProviderDispatcher('anthropic'),
        'Fetch must receive the reusable Anthropic connection pool dispatcher'
      );
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalFindOne;
    }
  });

  await t.test('5. Reusable Connection Dispatcher Preserves Timeout and Error Classification', async () => {
    const originalFetch = global.fetch;
    const originalFindOne = ProviderKey.findOne;

    ProviderKey.findOne = async () => ({
      getDecryptedValue: () => 'sk-test-openai-key-real',
      validationStatus: 'valid'
    });

    global.fetch = async (url, options) => {
      assert.strictEqual(options.dispatcher, getProviderDispatcher('openai'));
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    };

    try {
      await assert.rejects(
        async () => {
          await simulateApiCall(
            'openai',
            '/v1/chat/completions',
            'POST',
            { model: 'gpt-4o' },
            {},
            'user_123',
            'openai'
          );
        },
        (err) => {
          assert.strictEqual(err.statusCode, 504);
          assert.strictEqual(err.errorClass, 'timeout');
          assert.strictEqual(err.shouldRetry, true);
          return true;
        }
      );
    } finally {
      global.fetch = originalFetch;
      ProviderKey.findOne = originalFindOne;
    }
  });

});
