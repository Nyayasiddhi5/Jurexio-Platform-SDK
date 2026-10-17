---
status: live
version: 5.0.1
audience: SDK partners (NSP / NSPM / NSI / NSM / NSA / NYM / JRX) + integrators
last_updated: 2026-05-11 (Session-15 v14)
authority: NV-DOC-001 — partner-facing canonical for SDK request/response, error envelopes, and troubleshooting
companion: `04-sdk-and-api-canonical-2026-05-07.md` (full route map), `04b-sdk-endpoint-probe-2026-05-07.md` (endpoint smoke harness)
---

# 04c — SDK Troubleshooting & Error Envelope (Partner-Facing Canonical)

> **Single screen-source for every Nyayasiddhi ecosystem partner that calls our gateway/SDK as their AI backbone.** Covers: how requests must be shaped, what every response envelope looks like, every error code we emit, the exact remedy per code (with retry + idempotency rules), and a troubleshooting decision tree for the most common partner-reported failures.

---

## 1 — Quick reference card

| Concern | Answer |
|---|---|
| **Auth header (canonical)** | `X-API-Key: nyv_live_sk_…` (primary) **or** `Authorization: Bearer nyv_live_sk_…` (fallback) |
| **Base URL (prod)** | `https://api.nyayasiddhi.online` |
| **Base URL (Replit dev)** | gateway listens on port 5000 (preview-proxied) |
| **Content type** | `application/json` (or `multipart/form-data` for `/doc-ai/convert`) |
| **Encoding** | UTF-8 |
| **Standard envelope** | `{ success, data?, error?, requestId?, platform? }` |
| **Echoed correlation** | `requestId` (16-hex on intelligence surfaces; UUID v4 on platform routes — both are opaque, treat as a string) — echoed on every error; pass back to support |
| **Status code rules** | `4xx` → caller bug (do NOT retry without changing input). `5xx` → server / upstream LLM (retry per `retry_after_seconds`) |
| **Retry budget** | ≤ 3 attempts, exponential backoff starting 1 s, jitter ±20 %, ceiling 60 s |
| **Idempotency** | All `GET` is idempotent. End-to-end `Idempotency-Key` de-dupe is **not yet implemented** for SDK mutating routes (planned, NV-IDEMPOTENCY-001 — track in canonical-10). Until then: treat retried POSTs as potentially duplicate, and on the application side gate by your own client-generated `clientReqId` field where the schema supports it. |
| **Versioning** | Default `/api/nv/*` is v1; opt-in to a future major via `X-API-Version: v6` (no major bump until first prod deploy) |

---

## 2 — Authentication (NV-AUTH-HEADER-001, CI-enforced)

### 2.1 The ONLY accepted SDK auth headers

```http
X-API-Key: nyv_live_sk_<your-key>
```
or, equivalently:
```http
Authorization: Bearer nyv_live_sk_<your-key>
```

**Anything else is rejected.** Specifically these are NOT accepted (we used to support them; they are gone):
- `X-NV-SDK-Key`
- `X-SDK-Key`
- `X-NYV-Key`
- `X-Platform-Key`

### 2.2 Errors you may see at the auth layer

| HTTP | `error.code` | Meaning | Remedy |
|---|---|---|---|
| 401 | `AUTH_TOKEN_MISSING` | No `X-API-Key` and no `Authorization: Bearer` header | Add the header. Check for HTTP→HTTPS redirect stripping it (some proxies drop `Authorization` on 30x). |
| 401 | `AUTH_INVALID_KEY` | Header present but the key isn't recognised | Confirm key in your console at `/sdk-applications`. Make sure you're not using a console JWT in the SDK header. |
| 403 | `AUTH_KEY_REVOKED` | Key was disabled/rotated by an org_admin | Reissue from `/sdk-applications` and update your secrets store. |
| 403 | `SCOPE_INSUFFICIENT` | Key is valid but lacks the scope for that route (e.g. NYM calling `/research/*`) | Check `04-sdk-and-api-canonical-2026-05-07.md § 1`. Request a scope expansion via your account contact. |
| 429 | `RATE_LIMIT_EXCEEDED` | Per-key bucket exhausted | Honour `Retry-After`. Reduce concurrent requests. |

### 2.3 East-west header (DO NOT use in SDK)

`X-NV-API-Key` is **reserved for inter-service traffic** (`nv-inter-service-auth.ts`). If you put it on an SDK call you'll be rejected with 401 even if the key value is correct.

### 2.4 Browser-safe pattern (for NSP-Web / NSP-Mobile examples)

Never ship an `nyv_live_sk_…` key to the browser. The reference `examples/nsp-web-quickstart/src/app/providers.tsx` does it correctly:

```ts
new NyvClient({
  apiKey: 'nyv_live_sk_browser_proxied',  // stub — real key never leaves the server
  baseUrl: '/api/nyv-proxy',              // intercepted by Next.js route handlers
});
```
The Next.js route handler holds the real key in a server-only env var. If you need a short-lived browser-scoped token (e.g. for streaming), mint one via `/sdk/tokens/exchange` instead of shipping the long-lived key.

---

## 3 — The canonical response envelope

Every JSON response — success or error — uses one of these two shapes:

### 3.1 Success
```jsonc
{
  "success": true,
  "data":    { /* endpoint-specific payload */ },
  "requestId": "ff7d9223796566f6", // optional but emitted on AI surfaces; intelligence routes use 16-hex, gateway core uses UUID v4 — treat as opaque
  "platform":  "3.1.2",            // optional; current intelligence-API surface returns "3.1.2" (PLATFORM_VERSION constant) — gateway core returns "5.0.1"
  "cached":    false,              // optional; true if served from Redis
  "generated_at": "2026-05-11T18:36:00.000Z"
}
```

> **Important — auto-unwrap behaviour.** Our official `@nyayavigya/client-sdk` automatically unwraps `{success, data}`, so partner application code reads `result.matches`, NOT `result.data.matches`. If you see `result.data.data.matches`, you're double-unwrapping — drop one layer.

### 3.2 Error
```jsonc
{
  "success": false,
  "error": {
    "code": "POLICY_VIOLATION",                  // machine-readable
    "message": "…explanation for humans…",        // human-readable
    "cause": "guardrails-banned-content",         // root cause subkey (see § 5)
    "retryable": false,                           // boolean — drives SDK retry policy
    "retry_after_seconds": 30,                    // present when retryable=true and we know
    "requestId": "ff7d9223796566f6",              // pass back to support
    "docs_url": "https://docs.nyayasiddhi.online/canonical/04c-sdk-troubleshooting"
  },
  "platform": "3.1.2"
}
```

If `error.retryable` is `false`, **do not retry the same payload** — the caller must change something (prompt, scope, payload shape, idempotency key, etc.).

---

## 4 — End-to-end request examples (copy-paste ready)

### 4.1 Health & registry probe (no AI cost)

```bash
curl -sS https://api.nyayasiddhi.online/api/nv/health
curl -sS https://api.nyayasiddhi.online/api/nv/gateway/agents \
     -H "X-API-Key: $NYV_API_KEY" | jq '.data | length'
```
Expected: `200` and a non-empty list (1,042 agents in the canonical registry).

### 4.2 Single-agent AI call — `/api/nv/gateway/chat`

```bash
curl -sS -X POST https://api.nyayasiddhi.online/api/nv/gateway/chat \
  -H "X-API-Key: $NYV_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "tenantId": "acme-law",
    "agentKey": "legal-analyst",
    "jurisdiction": "IN",
    "message": "Summarise BNS 2023 § 103 and list 2 leading precedents.",
    "maxTokens": 1200
  }'
```

Successful response (auto-unwrapped by client SDK to `result.content`):
```jsonc
{
  "success": true,
  "data": {
    "content": "BNS 2023 § 103 codifies the offence of murder…\n\nLeading precedents:\n1. K.M. Nanavati v. State of Maharashtra (1962)…\n2. Bachan Singh v. State of Punjab (1980)…",
    "agentKey": "legal-analyst",
    "model": "anthropic.claude-4.5-sonnet",
    "tokensUsed": 612,
    "costUsd": 0.0124,
    "citations": [ { "case": "K.M. Nanavati v. State of Maharashtra", "year": 1962, "court": "SC India" } ],
    "halluc_check": { "score": 0.97, "verdict": "ok" }
  },
  "requestId": "8c4a7e3f-…",
  "platform": "nyayavigya-v5.0.1"
}
```

### 4.3 Multi-agent orchestrated call — `/api/nv/orchestrate`

(Same shape, but JWT auth — first-party console only. SDK partners use `/api/nv/sdk/<plat>/orchestrate` which is API-key-auth.)

### 4.4 Document upload + RAG indexing — `/api/nv/v1/documents/upload`

```bash
curl -sS -X POST https://api.nyayasiddhi.online/api/nv/v1/documents/upload \
  -H "X-API-Key: $NYV_API_KEY" \
  -F "file=@./contract.pdf" \
  -F 'meta={"matterId":"M-1042","fileName":"contract.pdf","jurisdiction":"IN"};type=application/json'
```
Response: `{ success: true, data: { docId, status: "queued" } }`. Poll `/api/nv/v1/documents/<docId>/status` until `status === "indexed"`.

### 4.5 Streaming pattern execution — `/api/nv/v1/patterns/<pattern>/stream`

Use the SDK helper (handles SSE framing + reconnect):
```ts
await nyv.stream.streamPattern('cot', { task: '…' }, {
  onThinking: (step, i, total) => console.log(`Step ${i}/${total}: ${step}`),
  onTextDelta: (delta) => process.stdout.write(delta),
  onComplete: (result) => console.log('Done:', result.traceId),
  onError: (e) => console.error(e),
});
```

---

## 5 — Error code reference (every code we may emit on a partner call)

### 5.1 4xx — caller-side, do NOT retry without changing input

| `error.code` | HTTP | Where | What to do |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | request body fails Zod schema | Look at `error.message` — it lists `field: reason` per failure. Fix and resend. |
| `INVALID_JURISDICTION` | 400 | `jurisdiction` not in {IN,UK,US,GC,EU,SG,Default} | Use one of the seven canonical codes. |
| `IDEMPOTENCY_KEY_MISMATCH` | 409 | replay with same `Idempotency-Key` and a different body | Use a new key, or repeat the original body verbatim. |
| `AUTH_TOKEN_MISSING` | 401 | no auth header | See § 2.2. |
| `AUTH_INVALID_KEY` | 401 | header present, key unknown | See § 2.2. |
| `AUTH_KEY_REVOKED` | 403 | key disabled by admin | Reissue. |
| `SCOPE_INSUFFICIENT` | 403 | key lacks scope for this route | Request scope expansion. |
| `TENANT_MISMATCH` | 403 | body claims a tenant your key doesn't own | The tenant on every request must match the org that owns the key. |
| `POLICY_VIOLATION` | 422 | guardrails detected banned content in your prompt or in the model output | **Change the prompt** — strip lawyer-rating / bail-drafting / direct-legal-advice patterns (see `nv-guardrails-enforcement.ts`). NOT retryable. |
| `RATE_LIMIT_EXCEEDED` | 429 | per-key bucket | Honour `Retry-After`. Drop concurrency. |

### 5.2 5xx — server / upstream, retryable per `retry_after_seconds`

| `error.code` | HTTP | `cause` | Retry? | What to do |
|---|---|---|---|---|
| `LLM_RATE_LIMIT` | 502 | `upstream-rate-limit` | yes (≥30 s) | Provider-level 429. We've already failed over once; a longer pause usually clears it. |
| `LLM_TIMEOUT` | 502 | `upstream-timeout` | yes (~5 s) | Single-provider hang; retry will land on another provider. |
| `LLM_PROVIDER_5XX` | 502 | `upstream-5xx` | yes | Provider 5xx. Standard exponential backoff. |
| `LLM_ALL_PROVIDERS_EXHAUSTED` | 502 | `fallback-chain-exhausted` | yes (≥60 s) | Every provider in the deterministic fallback chain failed. Health is reported at `/api/nv/observability/router-stats`. |
| `AI_UNAVAILABLE` | 502 | `ai-unknown` | yes | Catch-all. Pass `requestId` to support. |
| `NV5_PROXY_UPSTREAM_ERROR` | 502 | — | yes | Console admin proxy couldn't reach the upstream nv5 route. Usually means an internal service restart. |
| `INTERNAL_ERROR` | 500 | — | yes | Genuine server bug. Always file a ticket with `requestId`. |

> **What changed (Session-15 v14, 2026-05-11).** The old opaque `502 AI_UNAVAILABLE` envelope on every intelligence endpoint is now classified into the `LLM_*` / `POLICY_VIOLATION` codes above. The HTTP status switches to `422` for `POLICY_VIOLATION` so SDK retry loops stop hammering a prompt that will never succeed.

---

## 6 — The exact failure the user reported (worked example)

> "the SDK fallback handled it correctly by retrying legal-analyst (which then hit BANNED_CONTENT on the prompt content) and falling through to precedent-researcher (aborted)"

What actually happened on the wire, station by station:

1. NSP posted a request to (e.g.) `/api/nv/v1/sdk/intelligence/legal-research`.
2. Safety-ring stations 1–7 ran normally. Station 8 (`orchestrateLLM`) picked Anthropic Claude.
3. The model produced text that matched a `LEGAL_ADVICE_PATTERNS` regex in `src/middleware/nv-guardrails-enforcement.ts` (e.g. "I recommend filing…", "you have a strong case", "best lawyer").
4. The response guardrail middleware threw → `callNyayavigya` re-threw with `policy_violation`.
5. The intelligence route catch block ran. **Before today**, you got `502 AI_UNAVAILABLE: "Legal research temporarily unavailable."` — no actionable signal. Your SDK then retried (default behaviour for 5xx), hit the same banned pattern again on `legal-analyst`, and on the next retry your local circuit aborted on `precedent-researcher` with no useful info.
6. **After today (Session-15 v14)**, the same path returns:
   ```jsonc
   {
     "success": false,
     "error": {
       "code": "POLICY_VIOLATION",
       "message": "Legal research: request rejected by guardrails. Modify the prompt to remove banned-content patterns and retry.",
       "cause": "guardrails-banned-content",
       "retryable": false,
       "requestId": "…",
       "docs_url": "https://docs.nyayasiddhi.online/canonical/04c-sdk-troubleshooting"
     }
   }
   ```
   `HTTP 422`, `retryable=false` — your SDK should not retry. The user must reword the prompt.

This was the user's hypothesis exactly: the 502 was runtime-emitted from our gateway catching a guardrails throw, not a code bug. We now classify it correctly so partner SDKs can branch.

---

## 7 — Troubleshooting decision tree

```
Did you get an HTTP response at all?
├── NO  → connectivity issue (DNS / firewall / wrong base URL). curl from
│        the same network. Check $REPLIT_DEV_DOMAIN if working from Replit.
└── YES, status …
    ├── 200  → check `success`. If false, treat as the corresponding 4xx/5xx.
    ├── 308  → you hit a route that moved (e.g. /gateway/summarize →
    │          /gateway/documents/summarize). Follow the Location header,
    │          OR upgrade your client SDK ≥ 5.0.1 which already follows.
    ├── 401  → § 2.2. Most common: env var unset, or key ended up URL-encoded.
    ├── 403  → § 5.1 SCOPE_INSUFFICIENT or TENANT_MISMATCH.
    ├── 422 POLICY_VIOLATION  → reword prompt; remove direct legal-advice /
    │                            lawyer-rating / bail-drafting patterns.
    ├── 429  → honour Retry-After; reduce concurrency.
    ├── 502 LLM_*  → § 5.2. Retry per `retry_after_seconds`. If persistent,
    │                check /api/nv/observability/router-stats — provider may
    │                be flagged `down`.
    ├── 502 AI_UNAVAILABLE (legacy callers only)  → upgrade to read the new
    │                                                 `error.cause` field.
    ├── 502 NV5_PROXY_UPSTREAM_ERROR  → internal service hiccup; retry once.
    └── 500 INTERNAL_ERROR  → file a ticket with requestId.
```

---

## 8 — Retry & idempotency policy

| Aspect | Rule |
|---|---|
| Retry budget | ≤ 3 attempts |
| Backoff | exponential, base 1 s, ceiling 60 s, jitter ±20 % |
| Honour | `Retry-After` header and `error.retry_after_seconds` field — whichever is larger |
| Never retry on | 4xx codes (except `429`) |
| Always retry on | 502/503/504 once or twice |
| Idempotency key | **not yet implemented end-to-end** (NV-IDEMPOTENCY-001 — planned). Until then, the only routes that are safely auto-retryable are the AI ones whose `error.retryable=true` (the LLM call is non-mutating from your tenant's perspective — it produces fresh text). For routes that mutate persistent state (matter creation, document upload), gate retries on your side using a deterministic `clientReqId` field where the route schema supports it; otherwise use a circuit-breaker rather than a blind retry. |
| Streaming | non-resumable; reconnect counts as a NEW request — do NOT pass the same `Idempotency-Key` |

---

## 9 — Per-platform scope reality + known auth-mount split (today)

### 9.1 Scope source of truth
The DB column `sdk_app_api_keys.scopes` is the source of truth (NOT `src/config/nv-sdk-variants.ts`). Re-verified 2026-05-09: **all 7 platform keys are currently `["*"]`** (operationally permissive). Granular target scopes are documented in `04-sdk-and-api-canonical-2026-05-07.md § 1`. Plan: tighten to granular before the first external production audit. Until then, every key passes every scope check — so if you see `SCOPE_INSUFFICIENT` today, something else (e.g. tenant mismatch) is the real cause.

### 9.2 Two distinct intelligence mounts (read carefully — naming overlaps)

There are **two different routers** named "intelligence" in the gateway today, with **different auth models** and **different endpoint sets**:

| Mount | Auth | Source file | Surface |
|---|---|---|---|
| `POST /api/nv/v1/sdk/intelligence/<E>` | `sdkGatewayAuth` (X-API-Key) | `src/routes/nv-sdk-intelligence-routes.ts` | AI insight endpoints: `dashboard-insights`, `case-risk-analysis`, `predict-outcome`, `suggest-invoice-items`, `hearing-prep-checklist`, `classify-document`, `sentiment-analysis`, `legal-research`, `translate-legal`, `portfolio-risk-analysis`, `client-health/:id`, `capabilities` |
| `POST /api/nv/intelligence/<route>` | `authenticateToken` (JWT) | `src/routes/nv-intelligence-routes.ts` | Domain analytics: `precedent-similarity`, `contract-analysis`, `legal-ner`, `conflict-detect`, `amendment-impact`, `statute-history`, `litigation-risk-v2`, `regulatory-feed`, `regulatory-digest`, `compliance-calendar`, `secure-session/create` |

The published `@nyayavigya/client-sdk` `IntelligenceApi` posts to the JWT path (`/api/nv/intelligence/*`). That works when the SDK is invoked from a **first-party server context** (e.g. the NSP-Web Next.js route handlers that hold a JWT) but **returns 401 `AUTH_TOKEN_MISSING` if you point the SDK directly at the gateway with only an `X-API-Key`**. Two safe partner patterns:

1. **Server-side proxy (recommended, mirrors `examples/nsp-web-quickstart`).** Your server holds both the SDK key (for `X-API-Key` calls) and a JWT minted via `/api/nv/auth/login` (for the JWT calls). The browser-side SDK is configured with a stub key + `baseUrl: '/api/your-proxy'`, and your proxy chooses which header to attach per route.
2. **Use the `/api/nv/v1/sdk/intelligence/*` surface directly with `X-API-Key`** for the AI insight endpoints listed in the top row above. The two endpoint sets do NOT overlap — pick the surface that matches the operation you need.

Backlog item: collapse to a single API-key-friendly mount (NV-INTELLIGENCE-AUTH-UNIFY-001 — out of scope for Session-15 v14 because changing auth on `/api/nv/intelligence/*` would alter behaviour for first-party console consumers; tracked under the pre-deploy E2E sweep).

---

## 10 — Endpoint-by-endpoint canonical request/response

For every wired Batch A–J namespace, the request body schema, response schema, auth model, feature-flag gate, and rate-limit family are documented in `04-sdk-and-api-canonical-2026-05-07.md §§ 11–17`. This troubleshooting doc is the partner-facing complement; that doc is the authoritative endpoint-level reference. The two together cover every public-API surface.

A standalone smoke harness (one curl per Batch) is at `04b-sdk-endpoint-probe-2026-05-07.md` — copy/paste to verify your env var + base URL setup end-to-end in under 30 seconds.

---

## 11 — When in doubt

- **Capture the `requestId`** from the response (or response header `X-Request-Id`) and quote it when filing a support ticket — it lets us pull the safety-ring trace from the audit hash chain.
- **Run the smoke harness** in `04b-sdk-endpoint-probe-2026-05-07.md` first — eliminates 80% of "is the gateway up?" questions.
- **Check `/api/nv/observability/router-stats`** — if a provider is `down` for everyone, your retry budget will burn for nothing.
- **Check `/api/nv/health`** — JSON includes per-component status (postgres, redis, llm-providers).

---

*End of partner-facing SDK troubleshooting canonical.*

---

## 11 — Session-15 v15 additions (2026-05-11) — NV-PARTNER-INTROSPECTION + CAM bridge + AGUI dual-auth

Three additive surfaces shipped. **Zero breaking changes** — every existing route, header, and envelope shape is unchanged; new routes are additive and pass `npm run guardrail:api-contract`.

### 11.1 SDK LLM catalog + router introspection (`/api/nv/v1/sdk/llm/*`, X-API-Key)

For partners that need to know "which model/provider is going to serve my call, and at what cost" **before** invoking an AI route.

| Route | Method | Purpose |
|---|---|---|
| `/api/nv/v1/sdk/llm/catalog` | GET | Full May-2026 frontier model catalog (Claude Opus 4.7, GPT-5.5-pro, Gemini 3.1 Pro, DeepSeek v4-pro, Grok 4.20, Sarvam-105B, Mistral Large 2-2411, Bedrock Nova-Premier 1M ctx, …). Filters: `?provider=`, `?jurisdiction=IN|UK|US|EU|GCC|SG|GLOBAL`, `?taskKind=`, `?latestOnly=true`, `?free=true`, `?vision=true`, `?reasoning=true`. Per model returns `id, provider, displayName, contextWindow, maxOutput, costInPer1M, costOutPer1M, capabilities, legalQuality, generalQuality, speedScore, isLatest, jurisdictionFit, providerAvailable`. |
| `/api/nv/v1/sdk/llm/providers` | GET | Provider availability matrix (15 providers). Per provider: `id, available, model_count_in_catalog, latest_models[], sample_model`. |
| `/api/nv/v1/sdk/llm/router/health` | GET | Live router aggregates + health snapshot + catalog size. Counters only — no PII. |
| `/api/nv/v1/sdk/llm/router/explain` | POST | Body: `{ tier?, jurisdiction?, taskKind?, requireVision?, requireReasoning?, requireJson?, maxCostUsd?, preferCheaper?, preferredModels?, fallbackModels?, forbiddenModels?, ... }`. Returns `primary` model + full `sequence[]` (with reasons) WITHOUT calling the LLM. Use this to estimate cost/latency upfront. |

All under `sdkGatewayAuth` (`X-API-Key` primary, `Authorization: Bearer` fallback). 401 without a valid key.

### 11.2 CAM (Continuous Agent Monitoring 2.0) dashboard bridge

Two mounts, one shape:

| Route | Auth | Audience |
|---|---|---|
| `/api/nv/v1/sdk/cam/dashboard[/:startupId]` | X-API-Key (`sdkGatewayAuth`) | Partner SDK clients |
| `/api/nyayavigya/cam/dashboard[/:startupId]` | JWT (`authenticateToken`) | Internal Console UI (existing `CAMMonitoringDashboard.tsx` queryKey) |

Returns `{ overview, agents, costs, quality, recentExecutions }` synthesised from real telemetry (`nv_agents` count, `nv_router_decisions` rolling 24-hour window). Includes auto-generated cost/utilisation recommendations (e.g. *"Cost-per-call rising in last hour — consider preferCheaper tier or semantic caching."*). Refresh interval safe at 5 s.

### 11.3 AGUI streaming — dual auth

`POST /api/nv/stream/<pattern>` and `POST /api/nv/stream/` now accept **either** an SDK X-API-Key **or** a JWT (was JWT-only). Implemented via `dualSdkOrJwt` middleware in `src/middleware/nv-dual-auth.ts` (tries `extractSdkApiKey` first, falls back to `authenticateToken`). NV-AUTH-HEADER-001 compliant: no new accepted headers.

```bash
curl -sS -N -X POST https://api.nyayasiddhi.online/api/nv/stream/cot \
  -H "X-API-Key: nyv_live_sk_..." \
  -H 'content-type: application/json' \
  --data '{"task":"explain force-majeure under Indian law","jurisdiction":"IN"}'
```

22 patterns supported via short-name aliases (`react`, `cot`, `tot`, `reflect`, `plan-exec`, `refine`, `maker-checker`, `tool-retry`, `function-router`, `mcp-chain`, `nyayarag`, `graphrag`, `mem0`, `semantic-cache`, `hta`, `swarm`, `aconic`, `moat`, `adapt`, `computer-use`, `grpo`, `digital-twin`).

### 11.4 Operational fixes shipped same day

- **R5 — AWS Bedrock duplicate row removed** from `nv_llm_providers` (deleted `id=16492 provider_id='aws-bedrock' is_active=false`; canonical row remains `id=16432 provider_id='bedrock' is_active=true`).
- **R6 — `nv_voice_sessions.provider` column** added (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS provider TEXT` + partial index `WHERE provider IS NOT NULL`). Voice session inserts that carry a provider tag now persist it.
- **R7 — DeepSeek "skipped 1 model" startup log line** is informative, NOT a bug. `BUILT_IN_PROVIDERS.deepseek.enabled=false` in `nyv-dynamic-model-registry.ts` (file-config) keeps the *direct* DeepSeek provider gated until `DEEPSEEK_API_KEY` is set; OpenRouter-routed `deepseek-v3-or` and `deepseek-r1-or` continue to load and serve. `intelligent-router/MODEL_CATALOG` (50 frontier entries) is independent and unaffected.

### 11.5 Two model registries — partner-facing reality

The platform carries **two** model registries today:

| Registry | File | Count | Purpose |
|---|---|---|---|
| `MODEL_CATALOG` | `src/services/intelligent-router/model-catalog.ts` | **50 May-2026 frontier entries** | Source of truth for the new `/api/nv/v1/sdk/llm/*` introspection surface and the router's `pickSequence` decisions. |
| `BUILT_IN_MODELS` | `src/config/nyv-dynamic-model-registry.ts` | **115 entries** | Older orchestration registry consumed by `nv-orchestration-engine` paths and the seeded `nv_llm_providers`/`nv_model_catalog` tables. |

Consolidation is a future-session refactor. Today: partners should treat the SDK catalog endpoint as authoritative for "what model can I get."
