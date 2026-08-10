# OptiAPI AI

**An intelligent API gateway and cost optimization platform** built with Node.js, Express, React, MongoDB, Redis, and RabbitMQ.

OptiAPI sits in front of third-party APIs — AI providers, payment platforms, messaging services, and more — and adds a uniform layer of authentication, caching, rate limiting, async queueing, retry logic, cost tracking, and credential encryption. A React dashboard provides real-time analytics and optimization recommendations based on 7-day request history.

---

## Key Features

| Feature | Detail |
|---|---|
| **Unified API Gateway** | Routes requests to any provider through a single `/:provider/*` wildcard endpoint |
| **Redis Response Caching** | Per-user, per-endpoint cache rules with configurable TTL; keyed by request body hash |
| **Atomic Rate Limiting** | Per-API-key RPS enforcement via a Lua script running atomically inside Redis |
| **Async Queue Processing** | RabbitMQ `gateway_requests` queue with a background consumer worker |
| **Exponential Backoff Retry** | Up to 3 attempts with 200 ms / 400 ms backoff on provider failures |
| **AES-256-GCM Credential Vault** | Provider API keys are encrypted at rest; decrypted only in server memory |
| **MongoDB Telemetry** | Every request logged with status, latency, cost, token usage, and cache status |
| **Cost Calculator** | Real per-token / flat-rate pricing model covering OpenAI, Gemini, Claude, Stripe, Twilio, Google Maps |
| **Heuristic Optimization Engine** | Analyzes 7-day request logs and generates cost/latency/cache recommendations |
| **Zod Input Validation** | Schema-enforced validation on all route bodies, query parameters, and path parameters |
| **JWT Authentication** | Register/login with bcrypt-hashed passwords; all user routes protected by Bearer token |
| **React Dashboard** | Real-time analytics, API key management, cache rule configuration, and optimization insights |

---

## Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 18 (LTS) |
| Framework | Express 4 |
| Database | MongoDB 6 via Mongoose 8 |
| Cache / Rate Limiter | Redis 7 (via `redis` v4 client) |
| Message Queue | RabbitMQ 3.11 via `amqplib` |
| Auth | JSON Web Token (`jsonwebtoken`), bcrypt (`bcryptjs`) |
| Encryption | Node.js native `crypto` — AES-256-GCM |
| Validation | Zod 3 |
| Logging | Winston + Morgan |
| Testing | Node.js built-in `node:test` runner |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + Vite 5 |
| Routing | React Router v6 |
| State / Data Fetching | TanStack React Query v5 |
| HTTP Client | Axios |
| Charts | Recharts |
| Animations | Framer Motion, GSAP |
| Icons | Lucide React |
| Styling | Tailwind CSS 3 |

### Infrastructure
| Service | Image |
|---|---|
| MongoDB | `mongo:6.0` |
| Redis | `redis:7.0-alpine` |
| RabbitMQ | `rabbitmq:3.11-management-alpine` |
| Backend | `node:18-alpine` (custom Dockerfile) |

---

## Architecture & Request Flow

```
Client Request
      │
      ▼
[Zod Validation]          ← rejects malformed payloads before any downstream cost
      │
      ▼
[JWT / API Key Auth]      ← verifies Bearer token or x-api-key header
      │
      ▼
[Redis Rate Limiter]      ← atomic Lua script: INCR + EXPIRE per key per second
      │
      ▼
[Redis Cache Check]       ← SHA-256 keyed on userId:provider:endpoint:body+query hash
      │ MISS
      ▼
[Gateway Controller]
      ├─ queue=true? ──▶ [RabbitMQ Publish] ──▶ 202 Accepted
      │                        │
      │                        ▼
      │               [Background Worker]
      │                        │
      └─ direct ──────▶ [externalApiService]
                               │
                               ├─ OpenAI vault key found? ──▶ real HTTPS fetch → api.openai.com
                               └─ no vault key?            ──▶ high-fidelity mock response
                               │
                               ▼ (on failure → exponential backoff, up to 3 attempts)
                               │
                               ▼
                      [Cost Calculator]
                               │
                               ▼
                      [MongoDB RequestLog]  +  [Redis Cache Write]
                               │
                               ▼
                         Response to Client
```

---

## Core Components

### API Gateway (`/api/v1/gateway/:provider/*`)

The gateway is a wildcard Express route that intercepts all HTTP methods. Every request passes through validation → auth → rate limiter → cache → controller in sequence.

- Supported built-in providers: `openai`, `gemini`, `claude`, `google_maps`, `stripe`, `twilio`, `weather`, `custom`
- Provider and endpoint extracted from path params and normalized (strips duplicate leading slashes)
- Gateway validation enforces provider enum and non-empty wildcard path before auth runs

### Redis Caching (`middleware/cache.js`)

- Per-user cache rules stored in MongoDB (`CacheRule` model) with `provider`, `endpoint`, and `ttlSeconds`
- Cache key: `apicache:{userId}:{provider}:{endpoint}:{SHA-256(body+query)}`
- Cache hit returns stored response with `X-OptiAPI-Cache: HIT` header; skips all downstream processing
- Cache miss writes result to Redis after successful provider response

### Atomic Rate Limiter (`middleware/rateLimiter.js`)

Per-API-key sliding-window rate limiting using a Lua script evaluated atomically inside Redis:

```lua
local current = redis.call('incr', key)
if tonumber(current) == 1 then
  redis.call('expire', key, ttl)
end
return tonumber(current)
```

- RPS limit is configurable per API key (`rateLimitRps` field)
- Exceeding the limit returns `429 Too Many Requests` with `retryAfterSeconds: 1`
- Redis failures are caught gracefully; the request is passed through rather than dropped

### RabbitMQ Async Processing (`services/queueService.js`, `services/queueWorker.js`)

- Client sends `?queue=true` or `x-optiapi-queue: true` header to trigger async deferral
- Gateway publishes a JSON payload to the `gateway_requests` durable queue and immediately returns `202 Accepted`
- Background worker subscribes to the queue, executes the provider call with full retry logic, writes MongoDB logs, and updates Redis cache

### Retry with Exponential Backoff (`controllers/gatewayController.js`)

```
Attempt 1 → fail → wait 200 ms
Attempt 2 → fail → wait 400 ms
Attempt 3 → fail → log 502, return Bad Gateway
```

- Maximum 3 attempts; backoff calculated as `2^attempt * 100ms`
- Same retry loop runs in both the direct request controller and the background queue worker
- Validation errors abort before the retry loop is entered

### MongoDB Telemetry (`models/RequestLog.js`)

Every request — successful, failed, cached, or queued — produces a `RequestLog` document containing:

- `provider`, `endpoint`, `method`, `status`
- `responseTimeMs`, `costUsd`
- `tokensUsed` (prompt, completion, total)
- `cacheStatus` (`HIT` / `MISS` / `BYPASS`)
- `requestBody`, `responseBody`, `errorMessage`

Analytics endpoints aggregate these logs for dashboard display.

### AES-256-GCM Credential Encryption (`utils/crypto.js`, `models/ProviderKey.js`)

Provider API keys are never stored in plaintext:

1. On save, the `ProviderKey` Mongoose pre-save hook calls `encrypt(value)`
2. Encryption: `AES-256-GCM` with a random 96-bit IV; output format: `v1:{iv_hex}:{auth_tag_hex}:{ciphertext_hex}`
3. The 256-bit key is derived via SHA-256 from `VAULT_ENCRYPTION_KEY` at runtime
4. `getDecryptedValue()` decrypts in memory immediately before any provider API call
5. `getMaskedValue()` exposes only first 4 and last 4 characters to the UI
6. The raw key is never logged, returned in API responses, or serialized to the client

### Zod Input Validation (`middleware/validate.js`)

Schema-enforced validation runs before authentication on all routes:

- **Auth routes**: email format, password minimum length
- **API keys**: `rateLimitRps` must be a positive integer
- **Cache rules**: `ttlSeconds` must be a positive integer (decimals, strings, zero rejected)
- **Analytics**: `page` ≥ 1, `limit` 1–100, `cacheStatus` enum
- **ObjectId params**: 24-character hex validation before any MongoDB query
- **Gateway params**: provider enum + non-empty wildcard endpoint
- **Provider-specific body schemas**: OpenAI requires `messages[]`, Gemini requires `contents[]`
- All errors return `400` with field-level messages; raw input values are never echoed back

### React Dashboard (`/frontend`)

Built with Vite + React 18. Provides:

- **Login / Register** — JWT-based auth stored in session
- **Analytics Dashboard** — request volume, latency trends, cost breakdown, cache hit ratio (Recharts)
- **API Key Management** — create, list, and delete gateway API keys with per-key RPS limits
- **Provider Vault** — store and manage encrypted provider credentials; only masked values displayed
- **Cache Rules** — configure per-endpoint cache TTLs
- **Request Logs** — paginated log viewer with filters for provider, cache status, and HTTP status
- **Optimization** — view heuristic recommendations generated from 7-day request history

---

## Authentication & Security

| Mechanism | Implementation |
|---|---|
| User auth | JWT (HS256), 30-day expiry, verified on all protected routes |
| Password storage | bcrypt with salt rounds |
| Gateway auth | `x-api-key` header matched against active `ApiKey` documents |
| Credential storage | AES-256-GCM, keys never stored in plaintext |
| Input validation | Zod schemas on all routes; sensitive fields never echoed in error responses |
| CORS | Configurable origin list (open for development) |

---

## Provider Integration Status

| Provider | Status | Notes |
|---|---|---|
| **OpenAI** | 🟡 Adapter ready | Real HTTP client implemented; activates when a vault credential exists for the user. Requires an API key to be added via the vault to go live. |
| **Gemini** | 🔵 Mock | High-fidelity simulated responses |
| **Claude** | 🔵 Mock | High-fidelity simulated responses |
| **Stripe** | 🔵 Mock | High-fidelity simulated responses |
| **Twilio** | 🔵 Mock | High-fidelity simulated responses |
| **Google Maps** | 🔵 Mock | High-fidelity simulated responses |
| **Weather** | 🔵 Mock | High-fidelity simulated responses |
| **Custom** | 🔵 Mock | Echoes payload; ready for custom adapter |

**Mock/Real Switch Logic:** For OpenAI, `externalApiService.js` first looks up a `ProviderKey` document for the requesting user. If an active credential exists, it decrypts it and makes a real HTTPS request to `api.openai.com`. If no vault credential is found, it falls back to the mock simulator automatically — no configuration flag required.

---

## Local Setup & Installation

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/optiapi.git
cd optiapi
```

### 2. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Configure environment variables

Create `backend/.env`:

```env
PORT=5000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/optiapi

# Redis
REDIS_URL=redis://localhost:6379

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672

# JWT — use a long random string in production
JWT_SECRET=your_jwt_secret_here

# AES-256-GCM vault key — must be at least 32 characters
VAULT_ENCRYPTION_KEY=your_vault_encryption_key_here_minimum_32_chars
```

> **Never commit `.env` to version control.** The `.gitignore` excludes it by default.

### 4. Start infrastructure services

```bash
# From project root
docker-compose up mongodb redis rabbitmq -d
```

### 5. Seed the database

```bash
cd backend
npm run seed
```

This creates a demo user (`demo@optiapi.com` / `demo1234`) and sample provider configurations.

---

## Running the Application

### Backend

```bash
cd backend
npm run dev        # Development (nodemon hot reload)
npm start          # Production
```

Server starts on `http://localhost:5000`

### Frontend

```bash
cd frontend
npm run dev
```

Dashboard available at `http://localhost:5173`

---

## Docker (Full Stack)

To run the entire stack including the backend in a container:

```bash
docker-compose up --build
```

> **Note:** The frontend is not included in the Docker Compose setup and should be run locally with `npm run dev` for development.

Services started:
- MongoDB: `localhost:27017`
- Redis: `localhost:6379`
- RabbitMQ: `localhost:5672` | Management UI: `localhost:15672`
- Backend API: `localhost:5000`

---

## Testing

Tests use the Node.js built-in `node:test` runner — no external test framework required.

```bash
cd backend
npm test
```

The test suite runs sequentially across 6 test files covering:

| Test File | Coverage |
|---|---|
| `pathNormalizer.test.js` | URL normalization edge cases |
| `crypto.test.js` | AES-256-GCM encrypt / decrypt / tamper detection |
| `gatewayCache.test.js` | Cache miss → hit → Redis key presence flow |
| `rateLimiter.test.js` | Burst limit enforcement, window expiry, concurrency |
| `providerKey.test.js` | Vault pre-save encryption, masked UI value, decryption |
| `validation.test.js` | Auth, cache rules, API keys, ObjectIds, analytics query params, gateway validation (38 cases) |

**Current result: 60 / 60 tests passing.**

> Tests run against the live local Docker environment (MongoDB + Redis + RabbitMQ). Ensure infrastructure is up before running.

---

## Project Status

### ✅ Completed

- Express REST API with full route structure
- JWT authentication + bcrypt password hashing
- Redis gateway caching with SHA-256 request fingerprinting
- Atomic Lua rate limiting per API key
- RabbitMQ async queue + background worker
- Exponential backoff retry (3 attempts)
- MongoDB request telemetry and cost tracking
- AES-256-GCM credential vault with pre-save encryption
- Heuristic optimization engine (high latency, low cache ratio, high cost detection)
- Zod validation on all routes
- OpenAI real-provider adapter (activates when vault credential exists)
- React dashboard with analytics, logs, key management, and optimization
- 60-test backend suite (pathNormalizer, crypto, cache, rate limiter, vault, validation)

### 🔜 Planned

- Real provider adapters for Gemini, Claude, Stripe, Twilio
- Budget alerts and cost threshold notifications
- OAuth 2.0 / SSO provider support
- Team workspaces and multi-user key scoping
- Webhook delivery with retry guarantees
- Admin analytics panel
- Frontend unit and integration test coverage
- Kubernetes deployment manifests

---

## License

MIT
