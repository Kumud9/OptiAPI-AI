# OptiAPI Phase 3C: Distributed Rate Limiting & Provider Quota Protection

## 1. Overview & Architecture

OptiAPI Phase 3C introduces a production-grade, distributed rate-limiting and provider-quota protection subsystem. It guards upstream LLM providers (OpenAI, Anthropic, Gemini) and OptiAPI itself against accidental traffic spikes, runaway loops, credential abuse, and sudden provider quota exhaustion.

The layer integrates natively into OptiAPI's pipeline, positioned between Authentication and Upstream Routing, and directly orchestrating with Phase 3A's Circuit Breaker and Phase 3B's Failover engine.

### High-Level Architecture Diagram

```text
                     [ Incoming Client HTTP Request ]
                                   │
                                   ▼
             ┌───────────────────────────────────────────┐
             │    1. Authentication & Validation         │
             │   (Verify JWT / API Key, sanitize ID)     │
             └───────────────────────────────────────────┘
                                   │
                                   ▼
             ┌───────────────────────────────────────────┐
             │    2. Client Distributed Rate Limiting    │
             │       (Atomic Lua Script in Redis)        │
             └───────────────────────────────────────────┘
                       │                        │
                 Limit Exceeded              Allowed
                       │                        │
                       ▼                        ▼
             ┌───────────────────┐    ┌───────────────────────────────────┐
             │ HTTP 429 Response │    │    3. Routing Policy Lookup       │
             │ Retry-After: <sec>│    │   (Provider/Model/Cost Strategy)  │
             └───────────────────┘    └───────────────────────────────────┘
                                                │
                                                ▼
                                      ┌───────────────────┐
                                      │ Candidate Loop    │◄─────────────────┐
                                      └───────────────────┘                  │
                                                │                            │
                                                ▼                            │
                                      ┌───────────────────┐                  │
                                      │ 4. Provider Quota │── Exhausted ─────┤ (Failover)
                                      │    Check (Redis)  │                  │
                                      └───────────────────┘                  │
                                                │ Available                  │
                                                ▼                            │
                                      ┌───────────────────┐                  │
                                      │ 5. Circuit Breaker│── OPEN ──────────┘ (Failover)
                                      │    State Check    │
                                      └───────────────────┘
                                                │ CLOSED / HALF-OPEN
                                                ▼
                                      ┌───────────────────┐
                                      │ 6. Request Dedup  │ (Phase 2A Singleflight)
                                      └───────────────────┘
                                                │
                                                ▼
                                      ┌───────────────────┐
                                      │ 7. Upstream Call  │ (Phase 2B Connection Pool)
                                      │    with Retries   │
                                      └───────────────────┘
                                                │
                              ┌─────────────────┴─────────────────┐
                              │                                   │
                           Success                             Failure (5xx/Network)
                              │                                   │
                              ▼                                   ▼
                    ┌──────────────────┐                ┌──────────────────┐
                    │ HTTP 200 Return  │                │ Failover Trigger │
                    │ X-RateLimit-*    │                │ (Next Candidate) │
                    └──────────────────┘                └──────────────────┘
```

---

## 2. Redis Strategy & Distributed Atomic Algorithm

### Atomic Fixed-Window with TTL via Lua

To prevent race conditions across horizontally scaled gateway instances, OptiAPI executes rate checks and increments inside a single atomic Redis Lua script (`eval`). No multiple round-trips or distributed locks are required.

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = tonumber(redis.call('get', key) or "0")
if current >= limit then
  local ttlRemaining = redis.call('ttl', key)
  if ttlRemaining < 0 then
    ttlRemaining = ttl
    redis.call('expire', key, ttl)
  end
  return { 0, current, ttlRemaining }
end

current = redis.call('incr', key)
if current == 1 then
  redis.call('expire', key, ttl)
end
local ttlRemaining = redis.call('ttl', key)
if ttlRemaining < 0 then
  ttlRemaining = ttl
  redis.call('expire', key, ttl)
end
return { 1, current, ttlRemaining }
```

### Key Formatting & Automatic Expiration

1. **Client Rate Limit Keys:**
   ```text
   rl:client:<clientIdentifierHash>:<windowSeconds>:<windowId>
   ```
   - `clientIdentifierHash`: SHA-256 hash (or safe MongoDB ObjectId) of user ID or API key.
   - `windowSeconds`: Configured window duration (e.g., `60`).
   - `windowId`: `Math.floor(Date.now() / (windowSeconds * 1000))`.
   - Keys automatically expire after `windowSeconds` to ensure zero memory leaks.

2. **Provider Quota Keys:**
   ```text
   rl:quota:<safeScope>:<provider>:<windowSeconds>:<windowId>
   ```
   - `safeScope`: Client hash or `global`.
   - `provider`: Target AI provider in lowercase (e.g. `openai`, `gemini`, `anthropic`).

---

## 3. Provider Quota Protection & Failover Interaction

Before dispatching an upstream HTTP request to a provider candidate, OptiAPI checks whether that provider's local quota has been exhausted.

### Candidate Selection & Failover Lifecycle

```text
[ Primary: OpenAI, Fallbacks: [Gemini, Anthropic] ]
                        │
                        ▼
               OpenAI Quota Check
                        │
              ┌─────────┴─────────┐
          Exhausted            Available
              │                    │
              ▼                    ▼
       Record Quota Rejection     Check Circuit Breaker
              │                    │
              ▼                    ▼
     Trigger Failover         Send Request
              │
              ▼
       Gemini Quota Check
              │
          Available
              │
              ▼
   Gemini Serves Request
 (X-OptiAPI-Provider: gemini, X-OptiAPI-Failover: true)
```

### Safety Rules:
- **No Pointless Upstream Calls:** If a provider is quota-exhausted, zero network calls or retries are sent to it.
- **Failover to Eligible Candidates:** The router automatically proceeds to the next eligible healthy provider configured in the fallback list.
- **Client Error Non-Failover:** Ordinary client errors (HTTP 400, 401, 403, 404, 422) immediately short-circuit and never trigger failover.
- **Exhaustion of All Candidates:** If every eligible provider is quota-exhausted or circuit-broken, OptiAPI returns a clean `429 Too Many Requests` (or `503 Service Unavailable`) without crashing.

---

## 4. Gateway Integration & Request Lifecycle

The complete order of operations in `gatewayController.js`:

1. **Request Ingestion & Auth:** Extract credentials, client ID, and request payload.
2. **Client Rate Limit Check:** Evaluate client against policy or global limits. If exceeded, return `429 Too Many Requests` with `Retry-After`.
3. **Routing Policy Lookup:** Retrieve user routing policy from Redis or MongoDB.
4. **Provider Candidate Selection:** Build candidate list `[selectedProvider, ...fallbacks]`.
5. **Provider Quota Check:** Verify provider quota. If exhausted, skip candidate and advance in loop.
6. **Circuit Breaker Check:** Verify provider circuit state. If `OPEN`, skip candidate and advance in loop.
7. **Request Deduplication:** Check in-flight singleflight cache (Phase 2A).
8. **Upstream Request with Connection Pool:** Execute through keep-alive pool (Phase 2B) with timeout & retries.
9. **Outcome / Failover:** If 5xx or network error, record failure in circuit breaker and attempt next candidate.

---

## 5. Redis Degradation & Failure Behavior

### Fail-Open vs Fail-Closed Strategy

In high-throughput API gateways, a cache infrastructure glitch should not cause total API blackouts unless strict billing guarantees demand it.

- **Default Behavior: Fail-Open (`RATE_LIMIT_FAIL_OPEN=true`)**
  - If Redis fails, times out, or drops connection, the rate limiter allows the request through to preserve gateway availability.
  - Adds response header: `X-RateLimit-Degraded: true`.
  - Logs a structured warning with error details.
  - Does NOT crash the gateway.
- **Configurable Fail-Closed Mode (`RATE_LIMIT_FAIL_CLOSED=true`)**
  - For billing-critical environments where quota leaks are intolerable, setting `RATE_LIMIT_FAIL_CLOSED=true` will reject requests with `429` during Redis outages.

---

## 6. Configuration Examples

### Policy-Level Rate Limiting and Provider Quotas

Stored in Redis / MongoDB under the user's routing policy:

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "fallbackProviders": ["gemini", "anthropic"],
  "rateLimit": {
    "enabled": true,
    "requests": 100,
    "windowSeconds": 60
  },
  "providerLimits": {
    "openai": {
      "requests": 1000,
      "windowSeconds": 60
    },
    "gemini": {
      "requests": 500,
      "windowSeconds": 60
    },
    "anthropic": {
      "requests": 500,
      "windowSeconds": 60
    }
  }
}
```

### Global Environment Defaults (`.env`)

```ini
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_FAIL_CLOSED=false
```

---

## 7. Response Headers

### On Successful Requests (HTTP 200):
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1727957400000
X-OptiAPI-Provider: openai
```

### On Rate Limit Rejection (HTTP 429):
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1727957400000
Content-Type: application/json

{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please retry later.",
  "retryAfterSeconds": 42
}
```

---

## 8. Metrics & Observability

### Metrics Schema (`GET /api/metrics` via `metricsService.getMetrics()`)

```json
{
  "rateLimit": {
    "hits": 1250,
    "rejections": 42
  },
  "providerQuota": {
    "checks": 3100,
    "rejections": 17
  },
  "requests": { ... },
  "performance": { ... }
}
```

### Structured Logging

Security-compliant logging guarantees sensitive headers, raw API keys, bearer tokens, and prompts are never recorded:

```text
2026-10-03 17:32:03 [warn]: Rate limit exceeded for client [9d1542101be3296f]: 100/100 in 60s window.
2026-10-03 17:32:03 [warn]: Provider quota exhausted for [OPENAI] user [507f1f77bcf86cd799439066]: 1000/1000 in 60s. Skipping candidate.
```

---

## 9. Security & Scalability Considerations

1. **Non-reversible Client Hashes:** All client identifiers (API keys, IP addresses, tokens) are normalized and hashed via SHA-256 before being used in Redis cache keys or logs.
2. **Zero In-Memory Leaks:** In-memory maps are not used for rate limiting state; state is purely maintained in Redis with automatic TTLs.
3. **Cursor-Based Flushing:** Any administrative cache resets use non-blocking cursor SCAN rather than blocking `KEYS *`.
4. **Horizontal Scaling:** Because all state operations are atomic in Redis, multiple gateway instances running behind a reverse proxy (e.g. NGINX, Cloud Load Balancer) share exact, synchronized counters.
