import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 15,
  duration: '5s',
  thresholds: {
    http_req_duration: ['p(95)<30'], // L2 semantic cache should be faster than upstream
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const API_KEY = 'opti_bench_secret_key_123';

const paraphrases = [
  'Could you explain the theory of general relativity by Einstein in brief?',
  'Explain Einstein general relativity theory briefly please.',
  'Briefly summarize Einstein theory of general relativity.',
  'Can you describe the general relativity theory of Einstein?'
];

export function setup() {
  // Prime L2 semantic cache with baseline query
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Could you explain the theory of general relativity by Einstein in brief?' }]
  });
  http.post(BASE_URL, payload, {
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }
  });
}

export default function () {
  const query = paraphrases[__ITER % paraphrases.length];
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: query }]
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
  });
}
