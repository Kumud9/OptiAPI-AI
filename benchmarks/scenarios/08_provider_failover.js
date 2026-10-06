import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,
  duration: '5s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const CONFIG_URL = 'http://127.0.0.1:5055/benchmark/configure';
const API_KEY = 'opti_bench_secret_key_123';

export function setup() {
  // Set primary OpenAI to return 500 error, so failover automatically routes to Anthropic/Gemini
  http.post(CONFIG_URL, JSON.stringify({ mode: 'always_500' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export default function () {
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `Failover routing test query ${__ITER}` }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'X-OptiAPI-Failover': 'true',
      'X-OptiAPI-Cache-Bypass': 'true'
    },
  };

  const res = http.post(BASE_URL, payload, params);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'failover header present': (r) => r.headers['X-Optiapi-Failover'] === 'true' || r.headers['x-optiapi-failover'] === 'true',
  });
}

export function teardown() {
  http.post(CONFIG_URL, JSON.stringify({ mode: 'normal' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
