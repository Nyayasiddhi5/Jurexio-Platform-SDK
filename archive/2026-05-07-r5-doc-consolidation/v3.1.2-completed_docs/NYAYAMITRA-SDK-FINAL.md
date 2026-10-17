---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayamitra → Nyayavigya Public SDK — FINAL Design

**Version:** 1.0.0  
**Status:** Production Architecture (binding)  
**Date:** April 21, 2026  
**Source contract:** `NYAYAMITRA-AI-INTEGRATION-CONTRACT.md` v1  
**Target platform:** Nyayavigya Platform 3.1.2 / SDK v5.0.0  
**Audience:** Nyayavigya backend, SDK, and DevOps engineers

> **Strict mode.** This document only adapts **Nyayavigya** to honour the existing Nyayamitra contract. Nyayamitra is not modified. No contract semantics are assumed beyond what the source contract states.

---

## Table of Contents
1. [Contract Compatibility Matrix](#1-contract-compatibility-matrix)
2. [Critical Issue Detection](#2-critical-issue-detection)
3. [Public SDK Design](#3-public-sdk-design-nymv1)
4. [Adapter Layer (Nyayamitra → SDK → Orchestrator)](#4-adapter-layer)
5. [Standard Response Normalisation](#5-standard-response-normalisation)
6. [Required Changes in Nyayavigya](#6-required-changes-in-nyayavigya)
7. [Deployment Design](#7-deployment-design)
8. [Migration Plan](#8-migration-plan)
9. [Appendix A — Agent Prompts (verbatim)](#appendix-a--agent-prompts-verbatim)
10. [Appendix B — Reference Implementation Sketches](#appendix-b--reference-implementation-sketches)

---

## 1. Contract Compatibility Matrix

The Nyayamitra contract requires exactly three AI-bound endpoints. Each invokes a single Nyayavigya agent through `POST /api/nv/orchestrate`.

| # | Nyayamitra endpoint | NV agent key | Supported in NV? | Request shape match | Response shape match | Severity |
|---|---|---|---|---|---|---|
| 1 | `POST /api/chat/sessions/:id/messages` | `mitra-conversational` | ⚠️ Agent **NOT** in registry | Wrapper sends extra fields (`taskType`, `systemPrompt`, `sessionId`) — NV must accept | NV returns `{data:{content}}` ✅ shape OK; **content must be plain string, no disclaimer** | **HIGH** |
| 2 | `POST /api/documents/upload` | `clause-classifier` | ⚠️ Agent **NOT** in registry | OK — text-in via `prompt` field | Strict JSON-in-string in `data.content` ⚠️ regex extraction fragile | **HIGH** |
| 3 | `POST /api/casebriefs/generate` | `case-brief-generator` | ⚠️ Agent **NOT** in registry | OK — intake transcript embedded in `prompt` | Strict JSON-in-string in `data.content` ⚠️ + ISO-8601 dates required | **HIGH** |

### 1.1 Findings (verified against codebase)

A grep across `nyayavigya-platform-312/src/**` and `shared/**` for the three agent keys returned **zero matches**. Conclusion:

- The three Mitra agents **are not registered** in the NV agent registry today.  
- `/api/nv/orchestrate` will resolve them via the registry → falls through to the generic LLM router → returns generic content → contract drift.
- **Fix (HIGH):** add explicit registry entries for all three (see §6.1).

### 1.2 Envelope drift

| Aspect | Nyayamitra wrapper expects | NV current behaviour | Action |
|---|---|---|---|
| Auth header | `Authorization: Bearer <NV_API_KEY>` | NV expects `X-NSP-Inter-Secret: <NV_INTER_SERVICE_SECRET>` for service-to-service; SDK keys go in `Authorization: Bearer nyv_live_sk_*` | NV must accept the SDK key issued for `nyayamitra` app via `Authorization: Bearer` (already supported per `src/middleware/nv-auth.ts`). |
| Response data field | `data.content` (or `data.response`) | NV orchestrator returns `data.content` ✅ | OK |
| Latency budget | 8 s hard ceiling | NV orchestrate p95 currently varies 4–14 s (model-dependent) | Pin to fast tier model; add async fallback (§6.2). |
| Idempotency | `X-Correlation-ID` resent on retry | NV does not currently de-dupe by correlation id | Add request idempotency cache (TTL 60 s). |

---

## 2. Critical Issue Detection

| # | Issue | Source of truth | Severity | Impact |
|---|---|---|---|---|
| C1 | **Auth env mismatch** — Nyayamitra wrapper reads `NV_API_KEY`; NV exposes `NV_INTER_SERVICE_SECRET`. Today every NV call returns 401, then silently falls back to mock content. | Contract §5.1; `src/middleware/nv-auth.ts:162` | **CRITICAL** | All AI endpoints serve mocked content in production. |
| C2 | **Missing agents** — none of `mitra-conversational`, `clause-classifier`, `case-brief-generator` are registered. | grep, contract §1, §2 | **CRITICAL** | AI calls succeed at HTTP layer but return wrong content. |
| C3 | **JSON parsing risk** — wrapper extracts the first `{...}` block via regex `/\{[\s\S]*\}/`. Models that emit narrative + JSON, or nested unbalanced braces, break it. | Contract §2 (clause + brief) | **HIGH** | Silent fallback to mock for any malformed JSON. |
| C4 | **No async path** — large PDF / multi-page intake exceeds 8 s. | Contract §5.1 | **HIGH** | Document analysis times out for any non-trivial input. |
| C5 | **Double-disclaimer risk** — backend appends a disclaimer; some models still emit one of their own. | Contract §5.1 | **MEDIUM** | UX defect; trust signal damaged. |
| C6 | **Envelope drift** — NV emits flat `{success,error,code}`; SDK contract assumes nested `error:{code,message}` + `meta.timestamp`. | Contract §5.2 | **MEDIUM** | Two clients (current Flutter + future SDK) need shape coexistence. |
| C7 | **No idempotency on retries** — wrapper retries once with the same `X-Correlation-ID`, but NV does not de-dupe → double charges, double rows in `nym_ai_call_log`. | Contract §6.5 | **MEDIUM** | Billing accuracy and audit-trail integrity. |
| C8 | **Streaming not exposed** — long completions show no progress; the contract is sync-only today. | Contract §2 | **LOW** | UX — typing-indicator only, no token streaming. |
| C9 | **Model metadata not surfaced** — `model_used` flows through but is not standardised. | Contract §7 | **LOW** | "Powered by …" badges and per-model SLA dashboards blocked. |
| C10 | **No sandbox / test-mode flag** — every CI run burns real credits. | Contract §7 | **LOW** | Cost + flaky CI risk. |

---

## 3. Public SDK Design (`nym/v1`)

### 3.1 Topology

```
┌─────────────────────┐    HTTPS     ┌──────────────────────┐    inter-svc    ┌──────────────────────┐
│  nym-core-service   │ ───────────► │  Nyayavigya Public   │ ──────────────► │   NV Orchestrator     │
│  (Nyayamitra)       │              │  SDK Gateway (this)  │                 │  /api/nv/orchestrate  │
│  callNvAgent()      │  Bearer key  │  /nym/v1/*           │  X-NSP-Inter…   │                       │
└─────────────────────┘              └──────────────────────┘                 └──────────────────────┘
```

**Key points**
- The SDK Gateway is the **only** public surface. Raw `/api/nv/orchestrate` stays private.
- One SDK key per tenant app (`nyayamitra`, `nys-professional`, …) — already supported.
- The gateway translates the public SDK shape into the internal orchestrator shape. Nyayamitra's existing `callNvAgent()` continues to work via a thin compatibility shim (Phase 1, §8).

### 3.2 Base URL

```
Production : https://api.nyayavigya.com/nym/v1
Sandbox    : https://api-sandbox.nyayavigya.com/nym/v1
Local dev  : http://localhost:5000/nym/v1
```

### 3.3 Authentication

All public SDK requests:

```
Authorization: Bearer nyv_live_sk_<32 hex>      # production
Authorization: Bearer nyv_test_sk_<32 hex>      # sandbox / CI
Content-Type:  application/json
X-Request-ID:  <uuid v4>                        # client-generated, end-to-end
X-App-ID:      nyayamitra                       # multi-tenant routing
X-Idempotency-Key: <uuid v4>                    # optional; required for write/AI calls
```

> The SDK key prefix (`nyv_live_sk_` / `nyv_test_sk_`) is the only thing that determines billing-vs-sandbox routing. There is no separate `X-NV-Sandbox` header.

### 3.4 Endpoints

#### 3.4.1 `POST /nym/v1/chat`

Conversational reply from Mitra. Maps 1-to-1 onto `mitra-conversational`.

**Request**
```jsonc
{
  "message":    "Can my landlord evict me without notice?",
  "user_id":    "f9b6…",
  "session_id": "c1a4…",
  "context": {
    "history":      [{ "role": "user|mitra", "text": "…" }],   // last 8 turns max
    "language":     "en",                                      // ISO 639-1
    "tier":         "citizen",
    "jurisdiction": "IN"
  }
}
```

**Response (success)**
```jsonc
{
  "success": true,
  "data": {
    "reply":       "Under the Transfer of Property Act, 1882, a landlord must …",
    "suggestions": ["Send a legal notice", "Find a tenant lawyer near me"],
    "metadata": {
      "agent":     "mitra-conversational",
      "language":  "en",
      "session_id":"c1a4…"
    }
  },
  "error": null,
  "meta":  { "timestamp":"2026-04-21T10:30:00Z", "latency_ms": 2143, "model_used":"gemini-2.5-flash", "request_id":"…" }
}
```

**Notes**
- `reply` is a plain string. **The SDK does NOT append a disclaimer** (Nyayamitra appends its own).
- `suggestions` is a 0–3 element string array; SDK derives them deterministically from the reply (no extra LLM call).
- Errors: see §5.3.

#### 3.4.2 `POST /nym/v1/document/analyze`

Clause-by-clause risk analysis. Maps onto `clause-classifier`.

**Request**
```jsonc
{
  "document_text": "<full extracted text — UTF-8, ≤ 100 000 chars>",
  "file_name":     "rental-agreement.pdf",
  "mime_type":     "application/pdf",          // optional
  "user_id":       "f9b6…",
  "metadata": {
    "language":     "en",
    "tier":         "citizen",
    "jurisdiction": "IN"
  }
}
```

**Response (sync, ≤ 8 s)**
```jsonc
{
  "success": true,
  "data": {
    "summary":          "string",
    "risk_score":       72,
    "risk_level":       "medium",
    "clauses": [
      {
        "id":          "c1",
        "title":       "Lock-in Period",
        "text":        "verbatim clause text…",
        "risk_level":  "medium",
        "risk_score":  65,
        "explanation": "…"
      }
    ],
    "recommendations": ["Negotiate the rent escalation clause…"]
  },
  "error": null,
  "meta":  { "timestamp":"…", "latency_ms": 5840, "model_used":"claude-sonnet-4-6", "request_id":"…" }
}
```

**Async variant (recommended for documents > 10 KB)**

If `Prefer: respond-async` header is sent, the SDK responds 202 immediately:

```jsonc
{
  "success": true,
  "data": { "job_id": "doc_a1b2c3", "status": "queued", "poll_url": "/nym/v1/jobs/doc_a1b2c3" },
  "error": null,
  "meta":  { "timestamp":"…", "request_id":"…" }
}
```
Completion is delivered via **either** webhook (registered per app) **or** the polling URL. Webhook payload mirrors the sync `data` block.

#### 3.4.3 `POST /nym/v1/casebrief`

Generate a structured legal brief. Maps onto `case-brief-generator`.

**Request**
```jsonc
{
  "user_id": "f9b6…",
  "intake": {
    "session_id":    "c1a4…",
    "category_slug": "rental",
    "language":      "en",
    "responses": [
      { "step": 1, "question": "When did the issue start?", "answer": "Two months ago." }
    ]
  },
  "metadata": {
    "tier":         "citizen",
    "jurisdiction": "IN"
  }
}
```

**Response**
```jsonc
{
  "success": true,
  "data": {
    "title":              "Rental Matter — Legal Brief",
    "summary":            "Based on the intake…",
    "severity":           "medium",
    "mitra_score":        78,
    "laws":               ["Indian Contract Act, 1872", "Transfer of Property Act, 1882"],
    "recommended_actions":["Send a formal legal notice…"],
    "timeline": [
      { "date":"2026-04-21T10:30:00Z", "event":"Case brief generated", "type":"milestone" },
      { "date":"2026-04-24T10:30:00Z", "event":"Recommended: send legal notice", "type":"action" }
    ]
  },
  "error": null,
  "meta":  { "timestamp":"…", "latency_ms": 4210, "model_used":"claude-sonnet-4-6", "request_id":"…" }
}
```

**Validation rules enforced by SDK gateway**
- `severity` ∈ `low|medium|high` — else clamped + warning logged.
- `mitra_score` ∈ `[0,100]` — else clamped.
- `timeline[*].date` is parsed as ISO-8601 UTC — invalid items dropped, count emitted in `meta.dropped_timeline_items`.
- `laws[]` not validated against the legal corpus in v1 (planned v1.1).

#### 3.4.4 `GET /nym/v1/jobs/:job_id`

Poll an async job. Returns the same shape as the corresponding sync endpoint, plus `status: "queued|processing|completed|failed"`.

#### 3.4.5 `GET /nym/v1/health`

Public health check. No auth required.

```jsonc
{ "success": true, "data": { "status":"healthy", "version":"5.0.0" }, "meta": { "timestamp":"…" } }
```

### 3.5 Rate limits (per app key)

| Tier            | rpm | rpd     | Concurrent jobs |
|-----------------|-----|---------|-----------------|
| `free`          |  10 |    500  | 1 |
| `solo`          |  20 |  2,000  | 2 |
| `plus`          |  40 |  5,000  | 4 |
| `pro`           |  60 | 20,000  | 8 |
| `enterprise`    | 600 |200,000  | 32 |
| `government`    | 600 |200,000  | 32 |
| `internal`      |   ∞ |    ∞    |  ∞ (used by `nym-core` only) |

Headers returned on every response:
```
X-RateLimit-Limit:     60
X-RateLimit-Remaining: 41
X-RateLimit-Reset:     1745236800
```

---

## 4. Adapter Layer

The SDK Gateway is the only place that knows about both shapes. It **never** modifies Nyayamitra; instead it accepts whatever Nyayamitra sends today (via the legacy compat shim) and what new SDK clients will send tomorrow (via `/nym/v1/*`).

### 4.1 Chat — adapter

```text
SDK input                         →   NV orchestrate body
{message, user_id, session_id,         { agentKey: "mitra-conversational",
 context:{history,language,             taskType: "chat",
 tier,jurisdiction}}                    systemPrompt: <PROMPTS.chat>,    // see Appendix A
                                        prompt: composePrompt(history,message),
                                        userPrompt: message,
                                        tier: context.tier,
                                        jurisdiction: context.jurisdiction,
                                        sessionId: session_id,
                                        userId: user_id,
                                        options: {language: context.language} }

NV response                       →   SDK output
data.content (string)                  reply      = data.content.trim()
                                       suggestions= deriveSuggestions(reply, language)   // pure rule-based
                                       metadata   = { agent, language, session_id }
```

`composePrompt(history, message)`:
```
Conversation so far:
user: …
mitra: …
(repeat, last 8 turns)

New user message: <message>
```

### 4.2 Document — adapter

```text
SDK input                         →   NV orchestrate body
{document_text, file_name, mime_type,  { agentKey: "clause-classifier",
 user_id, metadata}                     taskType: "clause",
                                        systemPrompt: <PROMPTS.clause>,
                                        prompt: "Analyse this document and produce the JSON described:\n\n" + document_text,
                                        userId: user_id,
                                        tier, jurisdiction,
                                        options:{ expectJson: true } }

NV response                       →   SDK output
data.content (JSON string)             parsed = jsonExtract(data.content)        // §4.4
                                       summary, risk_score, risk_level, clauses[],
                                       recommendations = parsed.{…} normalised
```

### 4.3 Case brief — adapter

```text
SDK input                         →   NV orchestrate body
{user_id, intake:{session_id,          { agentKey: "case-brief-generator",
 category_slug,language,responses[]},   taskType: "brief",
 metadata}                              systemPrompt: <PROMPTS.brief>,
                                        prompt: "Category: <slug>\n\nIntake transcript:\n" +
                                                responses.map(r=>`Q${r.step}: ${r.question}\nA: ${r.answer}`).join('\n') +
                                                "\n\nProduce the brief JSON.",
                                        userId, sessionId: intake.session_id,
                                        tier, jurisdiction,
                                        options:{ expectJson: true } }

NV response                       →   SDK output (clamped + validated, §3.4.3)
```

### 4.4 Hardened JSON extraction (`jsonExtract`)

Replaces the contract's fragile single regex with a brace-balanced scan:

```ts
function jsonExtract(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?|```$/g, '').trim();
  let depth = 0, start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) {
      try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { start = -1; }
    }}
  }
  throw new SdkError('JSON_PARSE_FAILED', 'Model did not return parseable JSON.');
}
```

### 4.5 Legacy compat shim (Phase 1)

The current `callNvAgent()` wrapper in `nym-core-service` posts to `/api/nv/orchestrate` directly. To avoid changing Nyayamitra:

1. Keep `/api/nv/orchestrate` accepting the **existing** payload shape exactly as-is.
2. Add a route alias: `POST /nym/v1/_compat/orchestrate` → forwards to the same handler.
3. Phase 2 migrates `nym-core` to call the typed `/nym/v1/{chat,document/analyze,casebrief}` endpoints.

---

## 5. Standard Response Normalisation

### 5.1 Canonical envelope

Every `/nym/v1/*` response, regardless of success or failure, conforms to:

```jsonc
{
  "success": true | false,
  "data":    object | null,                       // null on error
  "error":   null | {
    "code":    "MACHINE_CODE",                    // SCREAMING_SNAKE_CASE, see §5.3
    "message": "Human-readable explanation",
    "details": { "field": "value" } | null        // optional, for validation errors
  },
  "meta": {
    "timestamp":   "2026-04-21T10:30:00.123Z",    // ISO-8601 UTC, ms precision
    "latency_ms":  2143,                          // gateway-measured wall clock
    "model_used":  "gemini-2.5-flash" | null,     // present when an LLM was invoked
    "request_id":  "uuid-v4"                      // echo of X-Request-ID
  }
}
```

### 5.2 Backward-compatibility (legacy clients)

Until Nyayamitra migrates, the Phase-1 compat shim continues to emit the **flat** envelope (`{success, data, error?, code?}`). The `/nym/v1/*` surface is the only place the new normalised shape is enforced. Both shapes coexist in the gateway via per-route formatters.

### 5.3 Error codes (canonical)

| HTTP | `error.code` | When |
|------|--------------|------|
| 400 | `BAD_REQUEST` | Generic 400 |
| 400 | `EMPTY_MESSAGE` | Chat `message` empty/whitespace |
| 400 | `DOCUMENT_TOO_LARGE` | `document_text` > 100 000 chars |
| 400 | `INVALID_JSON_FROM_MODEL` | `jsonExtract` failed (see §4.4) |
| 401 | `UNAUTHORIZED` | Missing/invalid Bearer key |
| 403 | `FORBIDDEN` | Key exists but lacks scope for this app |
| 404 | `NOT_FOUND` | Job id, session id, etc. |
| 408 | `UPSTREAM_TIMEOUT` | NV exceeded `NV_TIMEOUT_MS` |
| 409 | `IDEMPOTENCY_CONFLICT` | Same `X-Idempotency-Key` reused with different body |
| 422 | `MODEL_OUTPUT_INVALID` | Response failed schema validation |
| 429 | `RATE_LIMITED` | Tier rpm/rpd exceeded |
| 500 | `INTERNAL_ERROR` | Unhandled |
| 503 | `UPSTREAM_UNAVAILABLE` | NV orchestrator unreachable / 5xx |

---

## 6. Required Changes in Nyayavigya

### 6.1 HIGH PRIORITY (block production rollout)

1. **Fix C1 — Auth env-var mismatch.**  
   Either (a) export `NV_API_KEY=$NV_INTER_SERVICE_SECRET` in the `nym-core` container, **or** (b) add the public SDK key flow: issue a `nyv_live_sk_*` for app `nyayamitra` (already done — see `scripts/nv-seed-sdk-keys.ts`) and switch Nyayamitra's wrapper to read it. Recommended: (b), because it gives Nyayamitra a per-tenant rotatable key instead of the platform-wide inter-service secret.

2. **Fix C2 — Register the three Mitra agents.**  
   Add to the agent registry (sample shape):
   ```ts
   {
     key:           'mitra-conversational',
     name:          'Mitra Conversational',
     description:   'Empathetic Indian legal assistant for citizen Q&A.',
     practiceAreas: ['general'],
     jurisdiction:  'IN',
     tier:          'citizen',
     systemPrompt:  PROMPTS.chat,        // Appendix A
     model:         'gemini-2.5-flash',  // fast tier
     maxTokens:     1024,
     temperature:   0.4,
   }
   ```
   plus identical entries for `clause-classifier` (model `claude-sonnet-4-6`, `temperature 0.1`, `expectJson: true`) and `case-brief-generator` (model `claude-sonnet-4-6`, `temperature 0.2`, `expectJson: true`).

3. **Fix C3 — Hardened JSON extraction (§4.4).**  
   Replace the regex in the wrapper with the brace-balanced scan. Reject markdown fences. Add a single retry with `"JSON only — no commentary"` re-prompt.

4. **Fix C5 — Strip model-emitted disclaimers in chat.**  
   In the chat adapter, post-process `data.content` and remove any line beginning with `*Disclaimer*`, `Disclaimer:`, `**Disclaimer**`, etc., before returning. Backend appends the canonical disclaimer.

5. **Idempotency cache.**  
   For all `/nym/v1/*` POSTs, key on `(app_id, X-Idempotency-Key)`. TTL 60 s (Redis). Replay returns the cached response with `meta.idempotent_replay: true`.

### 6.2 MEDIUM

6. **Async job queue (C4).**  
   - Add Redis-backed BullMQ queue `nv-doc-jobs` and `nv-brief-jobs`.  
   - New endpoints: `POST /nym/v1/document/analyze` (with `Prefer: respond-async`) → 202; `GET /nym/v1/jobs/:id`.  
   - Webhook delivery (HMAC-signed `X-NV-Signature`) for app-registered URLs.

7. **Structured logging exposure.**  
   Promote the existing `nym_core.nym_ai_call_log` to an admin endpoint `GET /nym/v1/admin/calls?app_id=…&from=…` (paged, app-scoped).

8. **Streaming (`text/event-stream`) for `/nym/v1/chat`.**  
   Add `Accept: text/event-stream`. SDK already implements `/api/nv/stream`; expose a typed wrapper.

### 6.3 LOW

9. **Model metadata enumeration.**  
   Publish `GET /nym/v1/models` returning `{key, vendor, latency_class, cost_class}` for badge UX.

10. **Suggestion generation.**  
    Implement deterministic rule-based `deriveSuggestions(reply, language)` in §4.1. No extra LLM call. Emits 0–3 short follow-ups (e.g. "Find a lawyer", "See related laws").

11. **Sandbox flag honoured throughout.**  
    Keys with `nyv_test_sk_*` prefix → route to a deterministic mock LLM provider; do not bill credits; mark `meta.sandbox: true`.

---

## 7. Deployment Design

### 7.1 Public API Gateway

- Mounted at `/nym/v1/*` inside the existing NV gateway (port 5000) — no separate process required for v1.  
- TLS terminated upstream (AWS ALB / CloudFront). HSTS 6 months, TLS 1.2+.  
- WAF rules: block payloads > 256 KB, rate-shape per source IP, OWASP top-10 ruleset.

### 7.2 Rate limiting

Two-layer:
1. **Per source IP** — 600 rpm hard ceiling at the WAF.
2. **Per SDK key** — token-bucket in Redis (`nv:rl:<keyId>`), tier-driven (§3.5). On exceed: HTTP 429 + `Retry-After` seconds.

### 7.3 API key system (existing — confirmed working)

- Keys stored as SHA-256 hashes in `nv_api_keys`.  
- Format: `nyv_{live|test}_sk_<32 hex>`.  
- Scopes: `chat`, `document.analyze`, `casebrief`, `admin.read`.  
- Rotation: `POST /nym/v1/admin/keys/:id/rotate` issues a new key, leaves old key valid 24 h.  
- Revocation: `DELETE /nym/v1/admin/keys/:id` — immediate, distributed via Redis pub-sub to all gateway instances.

### 7.4 Multi-tenant `app_id`

| `X-App-ID` | Tier | Allowed agents | Notes |
|---|---|---|---|
| `nyayamitra` | citizen | `mitra-conversational`, `clause-classifier`, `case-brief-generator` | Citizen flows only |
| `nys-professional` | pro | + 18 practice-area agents | Lawyer practice mgmt |
| `nys-institutional` | enterprise | + 28 categories | Enterprise governance |
| `nys-academy` | pro | training agents | Read-only legal corpus + simulators |
| `nys-ministry` | government | + 20 categories | Sovereign-tier; dedicated VPC peering |

The gateway looks up `(app_id, key_id)` and rejects mismatches with `403 FORBIDDEN`.

### 7.5 Observability

- **Logs:** structured JSON to stdout → CloudWatch (`/nv/sdk/<env>`).  
- **Metrics:** Prometheus exposition at `/metrics` (orchestrator-internal); per-route p50/p95/p99 latency, success rate, JSON-parse-fail rate, fallback rate.  
- **Traces:** OpenTelemetry; propagate `X-Request-ID` as the trace id.  
- **Dashboards:** Grafana board `NV-SDK-Public` — one panel per public endpoint, plus a "model used" breakdown.

### 7.6 Environments

| Env | Domain | DB | Redis | NV agents source |
|---|---|---|---|---|
| Local | `localhost:5000` | Neon dev | local Redis | seeded via `scripts/nv-seed-*` |
| Sandbox | `api-sandbox.nyayavigya.com` | Neon staging | Elasticache staging | identical to prod, mock LLM |
| Production | `api.nyayavigya.com` | RDS Postgres ap-south-1 | Elasticache ap-south-1 | full registry, real LLMs |

---

## 8. Migration Plan

> Eight phases. Phases 1 + 2 unblock real AI traffic; phases 3-5 raise the platform to "world-class SDK" status.

### Phase 1 — Auth + Agents (Day 0; 1 day eng)

1. Issue / rotate `nyv_live_sk_*` for `nyayamitra` app → store in `nym-core`'s secret manager as `NV_API_KEY`.
2. Verify `Authorization: Bearer nyv_live_sk_*` is accepted by `src/middleware/nv-auth.ts`. (It is — confirmed.)
3. Add the three agent registry entries (§6.1.2).
4. Deploy → manually invoke `/api/nv/orchestrate` with `agentKey: "mitra-conversational"` → expect non-mocked content.

**Success metric:** `nym_ai_call_log` shows ≥ 95 % `success=true` rows for the next 24 h.

### Phase 2 — Real NV Calls in Nyayamitra (Day 1-2)

5. With Phase 1 verified, **disable the silent-fallback masking** in Nyayamitra's wrapper for non-citizen-impacting errors — so 5xx is logged, 4xx surfaces a friendly error, only timeouts fall back to canned content.
6. Smoke test: 1 chat / 1 document / 1 brief per region.

### Phase 3 — SDK Surface Stand-up (Week 1)

7. Implement `/nym/v1/chat`, `/nym/v1/document/analyze`, `/nym/v1/casebrief` with the canonical envelope (§5.1).
8. Wire idempotency cache, rate limiter, normalised error codes.
9. Publish `NYV-SDK-v5-INTEGRATION-GUIDE.md` updates pointing at `/nym/v1`.

### Phase 4 — Async + Streaming (Week 2)

10. Stand up BullMQ workers for documents and briefs.
11. Add webhook signing (`X-NV-Signature: sha256=…`) and per-app webhook URLs.
12. Expose `/nym/v1/chat` SSE streaming variant.

### Phase 5 — Migrate `nym-core` to typed SDK (Week 3)

13. Replace `callNvAgent()` with three typed callers (`nyvSdk.chat()`, `.documentAnalyze()`, `.casebrief()`).
14. Retire the legacy compat shim once Flutter ≥ 1.0.0 is the floor.

### Phase 6 — Observability (Week 4)

15. Ship Grafana dashboards, alerting rules, on-call playbook.
16. Expose `GET /nym/v1/admin/calls` for tenant audit.

### Phase 7 — Compliance hardening (Week 5)

17. PII redaction in `nym_ai_call_log` (mask emails, phone numbers, Aadhaar/PAN).
18. DPDPA 2023 retention: purge call logs > 90 d unless flagged for litigation hold.
19. Consent receipt id propagated via `X-Consent-Id` for every Nyayamitra call.

### Phase 8 — GA (Week 6)

20. Lock SDK contract at v1.0.0. Subsequent changes require a `/nym/v2` namespace.
21. Publish `nyayavigya-sdk` npm package + Dart pub package + Python SDK.

---

## Appendix A — Agent Prompts (verbatim)

These are the system prompts that MUST be registered with the agents in §6.1.2. They are reproduced from the contract verbatim so that any prompt drift is caught in code review.

### A.1 `mitra-conversational`
```
You are Mitra, an empathetic Indian legal assistant for citizens (jurisdiction: IN).
Give a clear, concise answer in plain language. Reference applicable Indian laws when relevant.
Do NOT invent statutes or case names.
Do NOT provide a disclaimer — the platform appends one.
```

### A.2 `clause-classifier`
```
You are a legal document clause classifier for Indian law (jurisdiction: IN).
Identify each material clause in the document and return STRICT JSON only with this shape:
{
  "summary": "...",
  "overallRiskScore": 0-100,
  "riskLevel": "low|medium|high",
  "clauses": [
    { "id":"c1", "title":"...", "text":"...", "riskLevel":"low|medium|high",
      "riskScore":0-100, "explanation":"..." }
  ],
  "recommendations": ["..."]
}
No markdown, no commentary — JSON only.
```

### A.3 `case-brief-generator`
```
You are a case brief generator for Indian citizen legal matters (jurisdiction: IN).
Given a structured intake transcript, return STRICT JSON only with this shape:
{
  "title":"...",
  "summary":"...",
  "severity":"low|medium|high",
  "mitraScore":0-100,
  "recommendedActions":["..."],
  "applicableLaws":["Statute Name, Year","..."],
  "timeline":[{"date":"YYYY-MM-DDTHH:MM:SSZ","event":"...","type":"milestone|action|deadline"}]
}
Cite only real Indian statutes; do NOT invent laws.
JSON only — no markdown.
```

---

## Appendix B — Reference Implementation Sketches

### B.1 SDK gateway route (TypeScript / Express 5)

```ts
// src/routes/nym-sdk-routes.ts
import { Router } from 'express';
import { requireSdkKey } from '../middleware/nv-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { idempotency } from '../middleware/idempotency.js';
import { adaptChat, adaptDocument, adaptBrief } from '../services/sdk-adapters/index.js';
import { orchestrate } from '../services/nv-orchestrator.js';
import { normaliseEnvelope, normaliseError } from '../services/sdk-envelope.js';

const r = Router();
r.use(requireSdkKey, rateLimit, idempotency);

r.post('/chat', async (req, res) => {
  const t0 = Date.now();
  try {
    const internal = adaptChat.toOrchestrator(req.body);
    const nv       = await orchestrate(internal);
    const data     = adaptChat.fromOrchestrator(nv, req.body.context?.language);
    res.json(normaliseEnvelope({ data, t0, model: nv.data?.model_used, requestId: req.id }));
  } catch (e) { res.status(e.status ?? 500).json(normaliseError(e, t0, req.id)); }
});

r.post('/document/analyze', /* … same pattern with adaptDocument … */);
r.post('/casebrief',        /* … same pattern with adaptBrief    … */);

export default r;
```

### B.2 Adapter signature (one per endpoint)

```ts
export interface SdkAdapter<TIn, TOut> {
  toOrchestrator(input: TIn): NvOrchestrateRequest;
  fromOrchestrator(nv: NvOrchestrateResponse, language?: string): TOut;
}
```

### B.3 Idempotency cache (Redis)

```ts
const key = `nv:idem:${appId}:${idemKey}`;
const cached = await redis.get(key);
if (cached) return res.json({ ...JSON.parse(cached), meta: { ...meta, idempotent_replay: true } });
res.on('finish', () => redis.set(key, JSON.stringify(payload), 'EX', 60));
```

### B.4 Webhook signing

```
X-NV-Signature: sha256=<hex(hmac_sha256(secret, body))>
X-NV-Timestamp: 1745236800
```
Replay window: 5 min. Receivers MUST reject older timestamps.

---

**End of `NYAYAMITRA-SDK-FINAL.md`**
