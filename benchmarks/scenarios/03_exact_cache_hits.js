import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 25,
  duration: '5s',
  thresholds: {
    http_req_duration: ['p(95)<15'], // L1 cache hits should be extremely fast (<15ms)
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const API_KEY = 'opti_bench_secret_key_123';

export function setup() {
  // Prime the exact cache with a warm-up request
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'What is the speed of light in vacuum?' }]
  });
  http.post(BASE_URL, payload, {
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }
  });
}

export default function () {
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'What is the speed of light in vacuum?' }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
  };

  const res = http.post(BASE_URL, payload, params);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'cache header present': (r) => r.headers['X-Optiapi-Cache'] !== undefined || r.headers['x-optiapi-cache'] !== undefined,
  });
}
