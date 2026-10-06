# OptiAPI AI — Live Demonstration & Technical Walkthrough

This guide provides a structured, reproducible script for presenting a technical demo of OptiAPI's gateway, caching, resilience, and observability capabilities.

---

## 1. Prerequisites & Starting the Services

### Option A: Local Development Mode (In-Memory Sandboxes)
```bash
# Terminal 1: Start Backend (Port 5000)
cd backend
npm run dev

# Terminal 2: Start Frontend (Port 5173)
cd frontend
npm run dev
```

### Option B: Dockerized Full-Stack Mode
```bash
docker compose up --build
```

Access the Web Dashboard at: [http://localhost:5173](http://localhost:5173)  
Default Credentials:
- **Email:** `demo@optiapi.com`
- **Password:** `password123`
- **Client API Key:** `opti_live_demo_api_key_2026_xYz`

---

## 2. Interactive Feature Demonstrations

### Step 1: Baseline Upstream Request & Telemetry
Send a standard chat completion request through the gateway:
```bash
curl -X POST http://localhost:5000/api/v1/gateway/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: opti_live_demo_api_key_2026_xYz" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
  }' -v
```
**Expected Response Headers:**
- `X-OptiAPI-Provider: openai`
- `X-OptiAPI-Cache: MISS`
- `X-OptiAPI-Time: ~20-250ms`

---

### Step 2: L1 Exact Redis Cache Hit (< 2ms)
Re-send the identical request immediately:
```bash
curl -X POST http://localhost:5000/api/v1/gateway/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: opti_live_demo_api_key_2026_xYz" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Explain quantum computing in one sentence."}]
  }' -v
```
**Expected Response Headers:**
- `X-OptiAPI-Cache: HIT`
- `X-OptiAPI-Cost: 0.00000000`
- `X-OptiAPI-Time: < 2ms`

---

### Step 3: L2 Semantic Vector Cache Hit
Send a paraphrased query with identical semantic intent but distinct text:
```bash
curl -X POST http://localhost:5000/api/v1/gateway/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: opti_live_demo_api_key_2026_xYz" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Could you describe quantum computing in just one sentence please?"}]
  }' -v
```
**Expected Response Headers:**
- `X-OptiAPI-Cache: SEMANTIC_HIT`
- `X-OptiAPI-Cost: 0.00000000`
- `X-OptiAPI-Time: ~12-18ms` (dense vector embedding generation + cosine match)

---

### Step 4: Singleflight Concurrent Request Deduplication
Simulate an in-flight traffic spike where 10 concurrent requests query the same prompt:
```bash
# In PowerShell:
1..10 | ForEach-Object -Parallel {
  Invoke-RestMethod -Uri "http://localhost:5000/api/v1/gateway/openai/v1/chat/completions" `
    -Method Post `
    -Headers @{ "x-api-key" = "opti_live_demo_api_key_2026_xYz"; "Content-Type" = "application/json" } `
    -Body '{"model":"gpt-4o","messages":[{"role":"user","content":"Deep research topic 42"}]}'
}
```
**Observation on Dashboard:**
- Upstream requests increment by exactly **1**.
- **9 Deduplication Hits** recorded.

---

### Step 5: Multi-Provider Failover & Circuit Breaker
Enable failover header while simulating primary provider outage:
```bash
curl -X POST http://localhost:5000/api/v1/gateway/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: opti_live_demo_api_key_2026_xYz" \
  -H "X-OptiAPI-Failover: true" \
  -d '{
    "model": "gpt-4o",
    "mockFail": true,
    "messages": [{"role": "user", "content": "Failover demonstration"}]
  }' -v
```
**Expected Response Headers:**
- `X-OptiAPI-Failover: true`
- `X-OptiAPI-Provider: anthropic` (or `gemini`)
- HTTP Status `200 OK` (client experienced zero disruption)

---

### Step 6: Live Control Dashboard Tour
Navigate to `http://localhost:5173` to showcase:
1. **Overview KPI Cards:** Total Traffic, P50/P95 Latencies, Cache Hit Rate, Semantic Hit Rate, Dedup Hits.
2. **Dual-Tier Cache Intelligence:** Visual distribution bar, L1 exact vs L2 semantic metrics, lookup latencies.
3. **Provider Circuit Breakers:** Real-time pulsing status badges (`CLOSED`, `HALF-OPEN`, `OPEN`), error counters.
4. **Reliability Telemetry:** Circuit trip events, rate-limit rejections, failover success rate.
5. **AI Dynamic Policy:** Current validated provider, model, timeout, retry budget, and similarity threshold.
