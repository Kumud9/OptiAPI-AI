'use strict';

const http = require('node:http');

class MockUpstreamServer {
  constructor(port = 4010) {
    this.port = port;
    this.server = null;
    this.requestCounts = {
      openai: 0,
      anthropic: 0,
      gemini: 0,
      total: 0
    };
    this.failureMode = null; // null | 'always_500' | 'timeout' | 'fail_n_times'
    this.failureCountTarget = 0;
    this.currentFailures = 0;
    this.defaultLatencyMs = 25; // Simulated upstream transit & token generation baseline
  }

  setFailureMode(mode, target = 0) {
    this.failureMode = mode;
    this.failureCountTarget = target;
    this.currentFailures = 0;
  }

  resetStats() {
    this.requestCounts = { openai: 0, anthropic: 0, gemini: 0, total: 0 };
    this.failureMode = null;
    this.failureCountTarget = 0;
    this.currentFailures = 0;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let parsedBody = {};
          try { parsedBody = JSON.parse(body || '{}'); } catch (_) {}

          const url = req.url || '';
          let provider = 'openai';
          if (url.includes('/messages') || req.headers['x-api-key']) provider = 'anthropic';
          else if (url.includes('generateContent') || url.includes('/v1beta/models/')) provider = 'gemini';

          this.requestCounts[provider]++;
          this.requestCounts.total++;

          // Check if artificial failure should be triggered
          let shouldFail = false;
          if (this.failureMode === 'always_500') {
            shouldFail = true;
          } else if (this.failureMode === 'fail_n_times') {
            if (this.currentFailures < this.failureCountTarget) {
              this.currentFailures++;
              shouldFail = true;
            }
          } else if (req.headers['x-mock-fail'] === 'true' || parsedBody.mockFail === true) {
            shouldFail = true;
          }

          if (shouldFail) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                message: 'Mock Upstream 500: Server Overload',
                type: 'server_error',
                code: 'internal_error'
              }
            }));
            return;
          }

          // Simulate upstream processing latency
          const latency = parseInt(req.headers['x-mock-latency'], 10) || this.defaultLatencyMs;
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (provider === 'anthropic') {
              res.end(JSON.stringify({
                id: `msg_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                model: parsedBody.model || 'claude-3-haiku',
                content: [{ type: 'text', text: 'Anthropic mock response completion.' }],
                usage: { input_tokens: 15, output_tokens: 25 }
              }));
            } else if (provider === 'gemini') {
              res.end(JSON.stringify({
                candidates: [{
                  content: { parts: [{ text: 'Google Gemini mock response completion.' }] },
                  finishReason: 'STOP'
                }],
                usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 22, totalTokenCount: 34 }
              }));
            } else {
              // OpenAI default
              res.end(JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: parsedBody.model || 'gpt-4o-mini',
                choices: [{
                  index: 0,
                  message: { role: 'assistant', content: 'OpenAI mock response completion.' },
                  finish_reason: 'stop'
                }],
                usage: { prompt_tokens: 14, completion_tokens: 24, total_tokens: 38 }
              }));
            }
          }, latency);
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

if (require.main === module) {
  const s = new MockUpstreamServer(4010);
  s.start().then(() => {
    console.log(`Mock Upstream Server running on http://127.0.0.1:4010`);
  });
}

module.exports = MockUpstreamServer;
