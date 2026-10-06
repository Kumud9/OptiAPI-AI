import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 30, // High burst to hit client rate limit
  duration: '5s',
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const API_KEY = 'opti_bench_secret_key_123';

export default function () {
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Testing rate limit burst exhaustion' }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'X-OptiAPI-RateLimit-Test': 'burst'
    },
  };

  const res = http.post(BASE_URL, payload, params);
  check(res, {
    'status is valid (200 or 429)': (r) => r.status === 200 || r.status === 429,
  });
}
