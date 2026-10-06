import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 40,
  duration: '5s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const API_KEY = 'opti_bench_secret_key_123';

export default function () {
  const payload = JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `High concurrency burst ${__VU}-${__ITER}` }]
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
