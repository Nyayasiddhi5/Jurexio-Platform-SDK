# SDK Endpoints — Canonical Map (verified live 2026-05-02)

> **READ THIS FIRST** before integrating against any of the per-platform
> guides (`SDK-PLATFORM-NSP-WEB.md`, `…NSP-MOBILE.md`, `…NYAYAMITRA.md`,
> `…NSI.md`, `…JRX.md`).
>
> The per-platform guides were authored against the **intended product
> surface** in the v3.1.2 product spec. This file lists the **endpoints
> that actually exist on the running v5.0.0 gateway** as of
> 2026-05-02T14:35Z, probed against `nysdev` (instance
> `i-0df71e5ea1df8f588` / `13.232.165.242`).
>
> Where a per-platform guide and this file disagree, **this file is
> correct**. Open an issue in `Project-Tracker.md §5` if you find the
> deployed surface has changed.

## 1. Authentication models

| Path prefix | Auth | Header | Notes |
|---|---|---|---|
| `/health` (root) | none | — | Lightweight liveness; safe for ALB target group. |
| `/api/nv/health/full` | none | — | Verbose diagnostics; **public** but rate-limited. Returns `status="degraded"` if any subsystem is unhealthy. |
| `/api/nv/voice/info` | none | — | Voice provider capabilities. Public. |
| `/api/nv/auth/*` | varies | — | Login/register/rotate; some routes public, others JWT. |
| `/api/nv/sdk/*` | SDK API key | `X-API-Key: nyv_test_sk_…` (or `nyv_live_sk_…` in prod) | This is the **canonical SDK consumer surface**. Use the `sdk_api_key` from your 4-key bundle. |
| `/api/nv/gateway/*` | SDK API key OR JWT | `X-API-Key:` or `Authorization: Bearer` | Legacy gateway surface; still live for backward compat. |
| `/api/nv/orchestrate`, `/api/nv/orchestration/*`, `/api/nv/documents/*` (no `/sdk` prefix), `/api/nv/hitl/*`, etc. | **JWT only** | `Authorization: Bearer <jwt>` | These are the **end-user surface** — your platform's BFF authenticates the user, then exchanges credentials for a Nyayavigya JWT. **An SDK key alone returns 401 here.** |
| `/api/nv/admin/*` | JWT + admin role | `Authorization: Bearer <admin-jwt>` | Operator-only. |

## 2. SDK consumer surface (X-API-Key authed) — `/api/nv/sdk/*` + `/api/nv/gateway/*`

### 2.1 `/api/nv/sdk/docs-pipeline/*` — Document AI

| Verb | Path | Purpose |
|---|---|---|
| POST | `/api/nv/sdk/docs-pipeline/documents/parse` | Parse PDF / DOCX / image → text + structure |
| POST | `/api/nv/sdk/docs-pipeline/documents/intelligence` | Clause detection, party extraction, risk flags |
| POST | `/api/nv/sdk/docs-pipeline/documents/embeddings` | Document embeddings for RAG indexing |
| POST | `/api/nv/sdk/docs-pipeline/documents/compare` | Redline two documents |
| POST | `/api/nv/sdk/docs-pipeline/documents/summarize` | Executive summary |
| GET  | `/api/nv/sdk/docs-pipeline/documents/templates` | Available document templates |
| POST | `/api/nv/sdk/docs-pipeline/documents/compliance-check` | Statute/regulation compliance scan |
| GET  | `/api/nv/sdk/docs-pipeline/clauses/library` | Pre-built clause library |
| POST | `/api/nv/sdk/docs-pipeline/clauses/suggest` | AI-suggested clauses for a context |

### 2.2 `/api/nv/sdk/multimodal/*` — Voice + multimodal

| Verb | Path | Purpose |
|---|---|---|
| GET  | `/api/nv/sdk/multimodal/multimodal/capabilities` | Provider list |
| POST | `/api/nv/sdk/multimodal/voice/transcribe` | Audio → text (Sarvam IN, Deepgram, Whisper fallback) |
| POST | `/api/nv/sdk/multimodal/voice/synthesize` | Text → audio (TTS) |
| POST | `/api/nv/sdk/multimodal/voice/voiceover/generate` | Long-form voiceover |
| POST | `/api/nv/sdk/multimodal/voice/stream/start` | Open WS streaming session (returns session id) |
| POST | `/api/nv/sdk/multimodal/voice/stream/stop` | Close streaming session |
| POST | `/api/nv/sdk/multimodal/multimodal/vision/analyze` | Image / video frame analysis |
| POST | `/api/nv/sdk/multimodal/multimodal/rag/query` | Multi-modal RAG |

### 2.3 `/api/nv/sdk/enterprise/*` — Enterprise research + analytics

| Verb | Path | Purpose |
|---|---|---|
| POST | `/api/nv/sdk/enterprise/research/domain/legal` | Domain-restricted legal research |
| POST | `/api/nv/sdk/enterprise/research/domain/academic` | Academic corpus search |
| POST | `/api/nv/sdk/enterprise/research/domain/patents` | Patent corpus |
| POST | `/api/nv/sdk/enterprise/research/domain/synthesize` | Cross-corpus synthesis |
| POST | `/api/nv/sdk/enterprise/search/web` | Web search via SDK key |
| POST | `/api/nv/sdk/enterprise/code-review/analyze` | Code review (legal-engineering use) |
| POST | `/api/nv/sdk/enterprise/analytics/visual/chart` | Generate visualisations |
| POST | `/api/nv/sdk/enterprise/assets/upload` | Asset upload (charts, exports) |

### 2.4 `/api/nv/gateway/*` — Legacy SDK gateway (still live)

| Verb | Path | Purpose |
|---|---|---|
| GET  | `/api/nv/gateway/health` | Gateway health (requires SDK key — no anonymous health here; use `/health` for that) |
| GET  | `/api/nv/gateway/agents` | List agents available to your tier |
| POST | `/api/nv/gateway/agents/:agentId/execute` | Run a single agent |
| GET  | `/api/nv/gateway/agents/:agentId/status` | Poll agent execution status |
| POST | `/api/nv/gateway/research/query` | Statute + case-law search |
| POST | `/api/nv/gateway/research/precedent` | Precedent search |
| POST | `/api/nv/gateway/translate` | Single-string translate |
| POST | `/api/nv/gateway/translate/batch` | Batch translate |
| GET  | `/api/nv/gateway/translate/languages` | Supported language list |
| POST | `/api/nv/gateway/ocr/process` | Synchronous OCR |
| POST | `/api/nv/gateway/ocr/jobs` | Async OCR job |
| GET  | `/api/nv/gateway/usage` | Per-key usage |

### 2.5 `/api/nv/sdk/provision/*` — Key + app self-management

| Verb | Path | Purpose |
|---|---|---|
| POST | `/api/nv/sdk/provision/health` | Health echo using your `sdk_api_key` (good liveness check from the consumer side) |
| POST | `/api/nv/sdk/provision/validate` | Validate that a given `sdk_api_key` is active + return its scopes |
| POST | `/api/nv/sdk/create-app` | Admin only — create a new SDK app |

## 3. End-user surface (JWT authed) — your BFF must obtain a JWT

These DO require a Nyayavigya JWT and are **not callable with an SDK key alone**.

| Verb | Path | Purpose |
|---|---|---|
| POST | `/api/nv/orchestrate` | Multi-agent orchestration (Queen + agents). Body: `{prompt, jurisdiction, tier, enableMemory?, enableHITL?, sessionId?, matterId?, userId?}` (note: **`prompt` not `query`**). |
| GET  | `/api/nv/agents` | Full agent registry |
| POST | `/api/nv/orchestration/stream` | SSE / streaming variant |
| POST | `/api/nv/documents/upload` | User document upload |
| GET  | `/api/nv/documents/:docId/status` | Doc status |
| GET  | `/api/nv/documents/list` | List docs for the JWT user |
| POST | `/api/nv/documents/search` | Search user docs |
| GET  | `/api/nv/hitl/pending` | HITL review queue |
| GET  | `/api/nv/hitl/stats` | Throughput stats |
| POST | `/api/nv/hitl/:reviewId/decision` | Submit review |
| GET  | `/api/nv/health/full` | Public diagnostics — listed here because consumers often place it next to other health calls; auth not required. |

## 4. Endpoints REFERENCED in the per-platform guides but NOT live

The following appear in one or more guides and should be treated as
**planned / not yet shipped**. Do not build a critical path against them.

| Referenced in guide | Status | Real path to use today |
|---|---|---|
| `POST /api/nv/completions` | **404 — does not exist** | Use `POST /api/nv/orchestrate` (JWT) or `POST /api/nv/sdk/docs-pipeline/documents/intelligence` for AI calls. |
| `POST /api/nv/research/search` | **404** | `POST /api/nv/gateway/research/query` (SDK key) or `POST /api/nv/sdk/enterprise/research/domain/legal`. |
| `POST /api/nv/documents/analyse` | **JWT only** (not SDK key) | `POST /api/nv/sdk/docs-pipeline/documents/intelligence`. |
| `POST /api/nv/documents/presign-upload` | **Not exposed via SDK key** | Use `POST /api/nv/sdk/docs-pipeline/documents/parse` (multipart) or upload via JWT-authed `/api/nv/documents/upload`. Direct-to-S3 presigned uploads tracked for v3.2. |
| `POST /api/nv/documents/conflict-check` | Not yet shipped | Use `POST /api/nv/sdk/docs-pipeline/documents/intelligence` and inspect `parties[]`; conflict resolution is client-side for now. |
| `POST /api/nv/documents/bates-stamp` | Not yet shipped | Generate via your platform; Bates utility tracked for v3.2. |
| `POST /api/nv/voice/transcribe` (no `/sdk`) | JWT only | Use `POST /api/nv/sdk/multimodal/voice/transcribe` for SDK-key auth. |
| `POST /api/nv/twindesk/draft` | **Path wrong.** Router IS mounted at `/api/nv/twindesk` (line 617) but has no `/draft` sub-route. | `POST /api/nv/twindesk/twins` (create twin) then `POST /api/nv/twindesk/twins/:twinId/chat`. JWT required. |
| `POST /api/nv/automate/run` | **Path wrong.** Router IS mounted at `/api/nv/automateai` (line 614) but has no `/run` sub-route. | `POST /api/nv/automateai/workflows` (create) then `POST /api/nv/automateai/workflows/:workflowId/execute`. JWT required. |
| `GET /api/nv/skillshop/skills` | **Works.** Router IS mounted at `/api/nv/skillshop` (line 620). | Correct path. JWT required. |
| `GET /api/nv/health/full` returning `agents.loaded=1042` | Returns `agents=148` today | The 1042 figure is the **logical** agent count (148 base × 6 jurisdictions + extras); the API exposes the base 148. Update test assertions accordingly. |

## 5. Test-matrix patches

Where any per-platform `§9 Testing matrix` row uses an endpoint in §4
above, replace as follows:

```
T1: GET /api/nv/health/full → 200, services.database.status="healthy",
    services.redis.status="healthy", platform.agents=148 (NOT 1042).
T2: GET  /api/nv/gateway/agents          (X-API-Key: $SDK_API_KEY) → 200
T3: POST /api/nv/gateway/research/query  (X-API-Key) {"query":"IPC 420","jurisdiction":"IN"} → 200
T4: POST /api/nv/sdk/docs-pipeline/documents/intelligence (X-API-Key) {<doc-payload>} → 200
T5: POST /api/nv/sdk/multimodal/voice/transcribe (X-API-Key) {<audio>} → 200
T6: POST /api/nv/sdk/provision/validate (X-API-Key) → 200, scopes echoed
T7: POST /api/nv/orchestrate (Authorization: Bearer <jwt>) {"prompt":"…","jurisdiction":"IN"} → 200
T8: POST /api/nv/orchestrate WITHOUT a JWT (X-API-Key only) → 401
T9: POST /api/nv/admin/health/full as a non-admin JWT → 403
T10: GET /api/nv/sdk/provision/validate with a webhook_secret as X-API-Key → 401 (only sdk_api_key authenticates here)
```

## 6. HMAC signing (for `signing_key` + `webhook_secret`)

The `signing_key` (prefix `nyv_ss_…`) and `webhook_secret` (prefix
`nyv_wh_…`) are **NOT** API auth headers. They are HMAC-SHA256 secrets:

- `signing_key` — sign outbound requests TO Nyayavigya when extra
  integrity is required (e.g. webhook callback signatures from your
  side). The gateway **does not currently enforce request signing on
  ingress** — it is provisioned for v3.2 ingress signing.
- `webhook_secret` — verify incoming webhook bodies FROM Nyayavigya.
  Header: `X-Nyv-Signature: sha256=<hex>`. Compute
  `hmac_sha256(webhook_secret, raw_request_body)` and constant-time
  compare.

Sample webhook verifier:

```ts
import crypto from 'crypto';
function verifyNyvWebhook(rawBody: Buffer, headerSig: string, secret: string) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(headerSig || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

## 7. Retrieval

To pull the raw bundle keys (operator only, on EC2):

```bash
aws ssm send-command --region ap-south-1 \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --parameters '{"commands":["sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq \".platforms[] | select(.code==\\\"nsp-web\\\")\""]}'
```

The `code` filter values are `nsp-web`, `nsp-mobile`, `nayamitra`,
`nsi`, `jrx`. NSM is intentionally absent (DEFERRED).

## 8. Change log

- **2026-05-02T14:35Z** — Initial publication. Probed live nysdev gateway,
  documented the 5 mismatches above, set `agents=148` as the canonical
  health-check assertion.
