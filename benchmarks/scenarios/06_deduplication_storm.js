import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 30, // 30 concurrent callers hitting the exact same endpoint simultaneously
  duration: '5s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const API_KEY = 'opti_bench_secret_key_123';

export default function () {
  // Identical payload sent by all 30 VUs without pause
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Identical concurrent storm query for singleflight dedup testing' }]
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'X-OptiAPI-Cache-Bypass': 'true' // Bypass cache to isolate deduplication savings
    },
  };

  const res = http.post(BASE_URL, payload, params);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
