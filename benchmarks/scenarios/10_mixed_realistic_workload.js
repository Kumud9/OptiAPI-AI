import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '8s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = 'http://127.0.0.1:5055/api/v1/gateway/openai/v1/chat/completions';
const API_KEY = 'opti_bench_secret_key_123';

const cachedQueries = [
  'What is the capital of Japan?',
  'How many continents are there on Earth?',
  'Explain the concept of recursion in programming.'
];

export function setup() {
  // Prime exact cache with the 3 common queries
  for (const q of cachedQueries) {
    http.post(BASE_URL, JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: q }]
    }), {
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }
    });
  }
}

export default function () {
  const rand = Math.random();
  let payload;
  let headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY
  };

  if (rand < 0.45) {
    // 45%: Exact cache hits (frequently asked queries)
    const q = cachedQueries[Math.floor(Math.random() * cachedQueries.length)];
    payload = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: q }]
    });
  } else if (rand < 0.70) {
    // 25%: Semantic cache variations
    payload = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: `Please explain the concept of recursion in computer programming with examples.` }]
    });
  } else {
    // 30%: Fresh unique upstream queries
    payload = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: `Unique dynamic question ${Math.random().toString(36).substring(2, 8)}` }]
    });
    headers['X-OptiAPI-Cache-Bypass'] = 'true';
  }

  const res = http.post(BASE_URL, payload, { headers });
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(0.02);
}
