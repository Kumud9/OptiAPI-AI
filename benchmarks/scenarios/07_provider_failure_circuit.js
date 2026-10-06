import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,
  duration: '5s',
  thresholds: {
    // We expect fast failures (circuit breaker fast-fail < 5ms)
    http_req_duration: ['p(95)<30'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const CONFIG_URL = 'http://127.0.0.1:5055/benchmark/configure';
const API_KEY = 'opti_bench_secret_key_123';

export function setup() {
  // Set mock provider to always return 500 error
  http.post(CONFIG_URL, JSON.stringify({ mode: 'always_500' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export default function () {
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Testing circuit breaker trip on provider 500' }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'X-OptiAPI-Cache-Bypass': 'true'
    },
  };

  const res = http.post(BASE_URL, payload, params);
  // Status should be 502 or 503 (fast-fail circuit breaker error)
  check(res, {
    'status is 502 or 503': (r) => r.status === 502 || r.status === 503,
  });
}

export function teardown() {
  // Reset back to normal mode
  http.post(CONFIG_URL, JSON.stringify({ mode: 'normal' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
