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
const API_KEY = 'opti_bench_secret_key_123';

export default function () {
  // Unique random queries force cache miss directly to upstream
  const randId = Math.random().toString(36).substring(2, 10);
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `Unique uncacheable request ${randId} timestamp ${Date.now()}` }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'X-OptiAPI-Cache-Bypass': 'true'
    },
  };

  const res = http.post(BASE_URL, payload, params);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
