# SDK Endpoints — Canonical Map (verified live 2026-05-06)

> **2026-05-06 addendum (Phase G scope tightening):**
> - `/api/nv/sdk/enterprise/research/*` and `/api/nv/sdk/enterprise/search/web`
>   now require `enterprise:research` (was `documents:read`).
> - `/api/nv/sdk/enterprise/assets/*` now requires `enterprise:assets`
>   (new scope, was `documents:read`).
> - Wildcard keys (`['*']` — NSI, NSM, JRX) continue to pass.
> - NSP, NSPM, NYM, NSA explicitly do NOT have these scopes and are
>   correctly denied. If a new platform needs enterprise research/assets,
>   add the explicit scope to its variant in `src/config/nv-sdk-variants.ts`
>   AND `UPDATE sdk_app_api_keys SET scopes = '[...]'::jsonb` for every
>   existing live key (per the gotcha in `replit.md`).
> - Smoke harness verification: 100/101 PASS as of 2026-05-06 (commit `b131c41`).

> **READ THIS FIRST** before integrating against any of the per-platform
> guides (`SDK-PLATFORM-NSP-WEB.md`, `…NSP-MOBILE.md`, `…NYAYAMITRA.md`,
> `…NSI.md`, `…JRX.md`).
>
> The per-platform guides were authored against the **intended product
> surface** in the v3.1.2 product spec. This file lists the **endpoints
> that actually exist on the running v5.0.0 gateway** as of
> 2026-05-06T00:00Z, probed against the live Replit gateway with all 7
> SDK keys (`NYV_SDK_KEY_{NSP,NSPM,NSI,NSM,NSA,NYM,JRX}`).
>
> Where a per-platform guide and this file disagree, **this file is
> correct**. Open an issue in `Project-Tracker.md §5` if you find the
> deployed surface has changed.
>
> **Supersedes:** `SDK-ENDPOINTS-CANONICAL-2026-05-02.md` (3-day-stale).

## 0. Audit fixes applied since 2026-05-02

The 2026-05-02 canonical run identified 6 endpoint failures. As of
2026-05-05 all 6 are fixed and the live matrix is green for the entries
the platform contracts:

| # | Marker | Endpoint | Old behavior | Root cause | Fix |
|---|---|---|---|---|---|
| F6 | `nv-rate-limit-middleware.ts:254` | every `/api/nv/sdk/*` POST | 429 after 30s on 2nd request | `publicRateLimit` ran even when `X-API-Key` was present, overriding the per-key tier limits | Skip `publicRateLimit` when an SDK key is supplied |
| F7 | `sdk-document-pipeline-service.ts:254` | `GET /api/nv/sdk/docs-pipeline/clauses/library` | 500 — `syntax error at or near "="` | Drizzle `eq(undefined, 'active')` produced `WHERE = 'active'` because `sdkClauseLibrary` has no `status` column | Removed `where()` (no soft-delete on this table) |
| F8 | `nv-sdk-multimodal-voice-routes.ts:136` | `GET /api/nv/sdk/multimodal/multimodal/capabilities` | 403 — `Insufficient scope: multimodal:read` (which only `*`-wildcard keys had) | Capabilities is a metadata endpoint and shouldn't require any scope (NYM/NSA need to ask "what's available?" even if they can't transcribe) | Removed scope check on `/capabilities` only; per-feature handlers (`/voice/transcribe`, `/voice/synthesize`, `/multimodal/vision/analyze`, etc.) remain scope-gated |
| F9 | `nv-sdk-provision-routes.ts:217` | `POST /api/nv/sdk/provision/validate` | 401 / 500 — looked up legacy `nv_api_keys` + `nv_sdk_applications` which the v5.0.0 seeder no longer populates | Wrong tables | Switched to canonical `sdk_app_api_keys` + `sdk_applications`; matches the writer used by `sdk-create-app` and the gateway auth middleware |
| F10 | `sdk-document-pipeline-service.ts:240` | `GET /api/nv/sdk/docs-pipeline/documents/templates` | 500 — same `syntax error at or near "="` | Same Drizzle `eq(undefined,'active')` bug because `sdkDocumentTemplates` has no `status` column either | Removed `where()` (no soft-delete on this table) |
| F11 | `nv-sdk-provision-routes.ts:241..254` | `POST /api/nv/sdk/provision/validate` | `{valid:false, reason:"Key revoked"}` for keys whose `is_active=true` in psql | `@neondatabase/serverless` (v0.10.4) returns Postgres `BOOLEAN` columns as the literal `false` for `true` rows under the http-fetch transport (verified by side-by-side `psql` vs neon test). Drizzle is unaffected because it deserialises booleans differently. | Cast to `int` in SQL — `(k.is_active)::int AS is_active_int` — and check `=== 1` in JS. **Other raw-neon callers should follow the same pattern**. |
| F12 | `sdk-application-service.ts:586..654` | `GET /api/nv/gateway/usage` | 500 — `syntax error at or near "::"` (after F11 unblocked the auth) | `getAppUsageAnalytics` referenced `sdkApiRequestLogs.{organizationId, tokensUsed, estimatedCost, errorMessage}` — none of which exist on the Drizzle definition (`shared/schema.ts:144`) or the public table | Switched to actual columns: `tokensIn + tokensOut`; dropped redundant orgId filter (SDK key auth already binds 1 app → 1 org) |
| `seed` | DB row backfill | `GET /api/nv/gateway/usage` | 500 — `Application not found` even after F11/F12 | 7 of 8 `sdk_applications` rows had `organization_id IS NULL` because the v5.0.0 seeder didn't backfill the FK | One-shot SQL to assign org IDs (NSP/NSPM→3, NSI/JRX→2, NSA/NSM→4, NYM→1) |

## 1. Authentication models

| Path prefix | Auth | Header | Notes |
|---|---|---|---|
| `/health` (root) | none | — | Lightweight liveness; safe for ALB target group. |
| `/api/nv/health/full` | none | — | Verbose diagnostics; **public** but rate-limited. Returns `status="degraded"` if any subsystem is unhealthy. |
| `/api/nv/voice/info` | none | — | Voice provider capabilities. Public. |
| `/api/nv/auth/*` | varies | — | Login/register/rotate; some routes public, others JWT. |
| `/api/nv/sdk/*` | SDK API key | `X-API-Key: nyv_live_sk_…` (or `nyv_test_sk_…` in sandbox) | This is the **canonical SDK consumer surface**. Use the `sdk_api_key` from your 4-key bundle. |
| `/api/nv/gateway/*` | SDK API key OR JWT | `X-API-Key:` or `Authorization: Bearer` | Legacy gateway surface; still live for backward compat. |
| `/api/nv/orchestrate`, `/api/nv/orchestration/*`, `/api/nv/documents/*` (no `/sdk` prefix), `/api/nv/hitl/*`, etc. | **JWT only** | `Authorization: Bearer <jwt>` | These are the **end-user surface** — your platform's BFF authenticates the user, then exchanges credentials for a Nyayavigya JWT. **An SDK key alone returns 401 here.** |
| `/api/nv/twindesk/*`, `/api/nv/automateai/*`, `/api/nv/skillshop/*` | **JWT only** | `Authorization: Bearer <jwt>` | Mounted but JWT-gated. SDK key alone → 401. |
| `/api/nv/admin/*` | JWT + admin role | `Authorization: Bearer <admin-jwt>` | Operator-only. |

## 2. SDK consumer surface (X-API-Key authed) — `/api/nv/sdk/*` + `/api/nv/gateway/*`

### 2.1 `/api/nv/sdk/docs-pipeline/*` — Document AI

| Verb | Path | Required scope | Purpose |
|---|---|---|---|
| POST | `/api/nv/sdk/docs-pipeline/documents/parse` | `documents:read` | Parse PDF / DOCX / image → text + structure |
| POST | `/api/nv/sdk/docs-pipeline/documents/intelligence` | `documents:read` | Clause detection, party extraction, risk flags |
| POST | `/api/nv/sdk/docs-pipeline/documents/embeddings` | `documents:write` | Document embeddings for RAG indexing |
| POST | `/api/nv/sdk/docs-pipeline/documents/compare` | `documents:read` | Redline two documents |
| POST | `/api/nv/sdk/docs-pipeline/documents/summarize` | `documents:read` | Executive summary |
| GET  | `/api/nv/sdk/docs-pipeline/documents/templates` | `documents:read` | Available document templates (**fixed F10 — was 500**) |
| POST | `/api/nv/sdk/docs-pipeline/documents/compliance-check` | `documents:read` | Statute/regulation compliance scan |
| GET  | `/api/nv/sdk/docs-pipeline/clauses/library` | `documents:read` | Pre-built clause library (**fixed F7 — was 500**) |
| POST | `/api/nv/sdk/docs-pipeline/clauses/suggest` | `documents:write` | AI-suggested clauses for a context |

> Keys **without** `documents:read` (NSA, NYM): all entries above return `403 Forbidden`. By design.

### 2.2 `/api/nv/sdk/multimodal/*` — Voice + multimodal

| Verb | Path | Required scope | Purpose |
|---|---|---|---|
| GET  | `/api/nv/sdk/multimodal/multimodal/capabilities` | none | Provider list (**fixed F8 — was 403**, now public to all 7 keys) |
| POST | `/api/nv/sdk/multimodal/voice/transcribe` | `voice:read` | Audio → text (Sarvam IN, Deepgram, Whisper fallback) |
| POST | `/api/nv/sdk/multimodal/voice/synthesize` | `voice:write` | Text → audio (TTS) |
| POST | `/api/nv/sdk/multimodal/voice/voiceover/generate` | `voice:write` | Long-form voiceover |
| POST | `/api/nv/sdk/multimodal/voice/stream/start` | `voice:write` | Open WS streaming session (returns session id) |
| POST | `/api/nv/sdk/multimodal/voice/stream/stop` | `voice:write` | Close streaming session |
| POST | `/api/nv/sdk/multimodal/multimodal/vision/analyze` | `vision:read` | Image / video frame analysis |
| POST | `/api/nv/sdk/multimodal/multimodal/rag/query` | `rag:read` | Multi-modal RAG |

### 2.3 `/api/nv/sdk/enterprise/*` — Enterprise research + analytics

| Verb | Path | Required scope | Purpose |
|---|---|---|---|
| POST | `/api/nv/sdk/enterprise/research/domain/legal` | `enterprise:research` | Domain-restricted legal research |
| POST | `/api/nv/sdk/enterprise/research/domain/academic` | `enterprise:research` | Academic corpus search |
| POST | `/api/nv/sdk/enterprise/research/domain/patents` | `enterprise:research` | Patent corpus |
| POST | `/api/nv/sdk/enterprise/research/domain/synthesize` | `enterprise:research` | Cross-corpus synthesis |
| POST | `/api/nv/sdk/enterprise/search/web` | `enterprise:research` | Web search via SDK key |
| POST | `/api/nv/sdk/enterprise/code-review/analyze` | `enterprise:code` | Code review (legal-engineering use) |
| POST | `/api/nv/sdk/enterprise/analytics/visual/chart` | `enterprise:analytics` | Generate visualisations |
| POST | `/api/nv/sdk/enterprise/assets/upload` | `enterprise:assets` | Asset upload (charts, exports) |

> Only NSI, NSM, JRX hold the `*` wildcard scope and can hit these. NSP/NSPM/NSA/NYM → `403`.

### 2.4 `/api/nv/gateway/*` — Legacy SDK gateway (still live)

| Verb | Path | Required scope | Purpose |
|---|---|---|---|
| GET  | `/api/nv/gateway/health` | none | Gateway health (requires SDK key — no anonymous health here; use `/health` for that) |
| GET  | `/api/nv/gateway/agents` | `agents:read` | List agents available to your tier |
| POST | `/api/nv/gateway/agents/:agentId/execute` | `agents:execute` | Run a single agent |
| GET  | `/api/nv/gateway/agents/:agentId/status` | `agents:read` | Poll agent execution status |
| POST | `/api/nv/gateway/research/query` | `research:read` | Statute + case-law search |
| POST | `/api/nv/gateway/research/precedent` | `research:read` | Precedent search |
| POST | `/api/nv/gateway/translate` | none | Single-string translate |
| POST | `/api/nv/gateway/translate/batch` | none | Batch translate |
| GET  | `/api/nv/gateway/translate/languages` | none | Supported language list |
| POST | `/api/nv/gateway/ocr/process` | none | Synchronous OCR |
| POST | `/api/nv/gateway/ocr/jobs` | none | Async OCR job |
| GET  | `/api/nv/gateway/usage` | `usage:read` | Per-key usage (**fixed F11+F12 — was 500**) |
| GET  | `/api/nv/gateway/usage/tokens` | `usage:read` | Daily/monthly token consumption |

### 2.5 `/api/nv/sdk/provision/*` — Key + app self-management

| Verb | Path | Required auth | Purpose |
|---|---|---|---|
| POST | `/api/nv/sdk/provision/health` | SDK key | Health echo using your `sdk_api_key` (good liveness check from the consumer side) |
| POST | `/api/nv/sdk/provision/validate` | none (key in body) | Validate that a given `sdk_api_key` is active + return its scopes (**fixed F9+F11 — was returning "Key revoked" for valid keys**) |
| POST | `/api/nv/sdk/create-app` | Admin JWT | Admin only — create a new SDK app |

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
| `*` | `/api/nv/twindesk/*` | All TwinDesk endpoints (twins create/list/chat/simulate) |
| `*` | `/api/nv/automateai/*` | All AutomateAI workflow endpoints |
| `*` | `/api/nv/skillshop/*` | Skill marketplace |
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
| `POST /api/nv/voice/transcribe` (no `/sdk`) | **Now SDK-key OR JWT** (post-F13 hardening, 2026-05-05). Was unauthenticated before this audit — anyone could trigger billable STT. | Either path works: `POST /api/nv/voice/transcribe` (with `X-API-Key:` or `Authorization: Bearer`) or `POST /api/nv/sdk/multimodal/voice/transcribe` (the SDK-namespaced version). The latter is preferred for new code as it gets per-key tier rate-limits + audit logging. |
| `POST /api/nv/twindesk/draft` | **Path wrong.** Router IS mounted at `/api/nv/twindesk` but has no `/draft` sub-route. | `POST /api/nv/twindesk/twins` (create twin) then `POST /api/nv/twindesk/twins/:twinId/chat`. JWT required. |
| `POST /api/nv/automate/run` | **Path wrong.** Router IS mounted at `/api/nv/automateai` but has no `/run` sub-route. | `POST /api/nv/automateai/workflows` (create) then `POST /api/nv/automateai/workflows/:workflowId/execute`. JWT required. |
| `GET /api/nv/skillshop/skills` | **Works.** Router IS mounted at `/api/nv/skillshop`. | Correct path. JWT required. |
| `GET /api/nv/health/full` returning `agents.loaded=1042` | Returns `agents=148` today | The 1042 figure is the **logical** agent count (148 base × 6 jurisdictions + extras); the API exposes the base 148. Update test assertions accordingly. |

## 5. Test-matrix patches (post-2026-05-05)

Where any per-platform `§9 Testing matrix` row uses an endpoint in §4
above, replace as follows:

```
T1: GET /api/nv/health/full → 200, services.database.status="healthy",
    services.redis.status="healthy", platform.agents=148 (NOT 1042).
T2: GET  /api/nv/gateway/agents          (X-API-Key: $SDK_API_KEY) → 200
T3: POST /api/nv/gateway/research/query  (X-API-Key) {"query":"IPC 420","jurisdiction":"IN"} → 200
T4: POST /api/nv/sdk/docs-pipeline/documents/intelligence (X-API-Key) {<doc-payload>} → 200 (NSA/NYM → 403)
T5: POST /api/nv/sdk/multimodal/voice/transcribe (X-API-Key) {<audio>} → 200 (NSA/NYM → 403)
T6: POST /api/nv/sdk/provision/validate (X-API-Key in body) → 200, {valid:true, scopes:[...]}
T7: POST /api/nv/orchestrate (Authorization: Bearer <jwt>) {"prompt":"…","jurisdiction":"IN"} → 200
T8: POST /api/nv/orchestrate WITHOUT a JWT (X-API-Key only) → 401
T9: POST /api/nv/admin/health/full as a non-admin JWT → 403
T10: POST /api/nv/sdk/provision/validate with a webhook_secret as the body's api_key → {valid:false}
T11: GET  /api/nv/sdk/docs-pipeline/clauses/library    (X-API-Key for NSP) → 200, total>=15 (post-F7)
T12: GET  /api/nv/sdk/docs-pipeline/documents/templates (X-API-Key for NSP) → 200, total>=10 (post-F10)
T13: GET  /api/nv/sdk/multimodal/multimodal/capabilities (X-API-Key for NYM) → 200 (post-F8)
T14: GET  /api/nv/gateway/usage                       (X-API-Key for NSP) → 200, applicationId=2 (post-F11+F12)
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

## 7. Retrieval — per-platform SDK bundles

To pull the raw bundle keys (operator only, on EC2):

```bash
aws ssm send-command --region ap-south-1 \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --parameters '{"commands":["sudo cat /opt/Nyayavigya/secrets/sdk-bundle-2026-05-05.json | jq \".platforms[] | select(.code==\\\"nsp-web\\\")\""]}'
```

The 7 `code` filter values are: `nsp-web`, `nsp-mobile`, `nayamitra`,
`nsi`, `nsa`, `nsm`, `jrx`.

## 8. Change log

- **2026-05-06T00:00Z** — Major refresh after audit fixes F6..F12.
  - All 4 doc-claimed-broken endpoints now return 200: `/clauses/library`,
    `/documents/templates`, `/multimodal/capabilities`, `/provision/validate`.
  - `/gateway/usage` fixed by F12 (column rename) + DB backfill of
    `sdk_applications.organization_id` (7 of 8 rows were NULL).
  - Documented the `@neondatabase/serverless` boolean coercion bug (F11);
    workaround: cast to `int` in raw SQL.
  - Added per-key scope column to §2 tables.
  - Listed all 7 platform codes (was 5; added NSPM and NSA).
  - 14 entries in test matrix (was 10) — added T11..T14 for the fixed endpoints.
- **2026-05-02T14:35Z** — Initial publication. Probed live nysdev gateway,
  documented 5 mismatches, set `agents=148` as the canonical
  health-check assertion.
