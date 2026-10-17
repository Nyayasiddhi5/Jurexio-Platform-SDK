---
status: active
version: 5.0.1
audience: NSP-Web frontend & backend engineers
last_verified: 2026-05-07
canonical_endpoint_map: ../canonical/04-sdk-and-api-canonical-2026-05-07.md
canonical_live_probe: ../canonical/04b-sdk-endpoint-probe-2026-05-07.md
---

> **✅ 2026-05-07 refresh (v5.0.1).** Replit-dev smoke is **102 PASS / 0 FAIL / 0 SKIP**
> against all 7 SDK keys (NSP, NSPM, NSI, NSA, NSM, NYM, JRX). Every endpoint
> below is verified against the live gateway (`v5.0.1`), and per-call envelopes
> (`requestId`, `qualityScore`, `tokens.input/output`, `auditHash`) are captured
> in [`docs/canonical/04b-sdk-endpoint-probe-2026-05-07.md`](../canonical/04b-sdk-endpoint-probe-2026-05-07.md).
> The cross-platform canonical endpoint map is
> [`docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`](../canonical/04-sdk-and-api-canonical-2026-05-07.md).
> If this guide and the canonical disagree, the canonical wins.

# Nyayavigya SDK — NSP-Web Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayasiddhi Professional — Web (`nsp-web`)
**App ID:** `nvsdkapp-demo-nsp-001` (refreshed 2026-05-02 — old `3b420b5a-…` retired)
**Platform type:** `nyayasiddhi_professional`
**Jurisdiction:** IN
**Tier:** pro
**Environment:** sandbox (dev EC2 nysdev). For production, re-mint with `NYV_PLATFORM_ENV=production`.
**Issued:** 2026-05-02T14:21Z (latest mint via `scripts/nv-mint-sdk-bundle.ts`)

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Console (admin UI) | `https://console.nyayasiddhi.online` |
| Docs (Swagger/Redoc) | `https://docs.nyayasiddhi.online` |
| Public status | `https://status.nyayasiddhi.online` |

All endpoints are TLS 1.3 via the Amazon-issued ACM cert (`CN=nyayasiddhi.online`, valid through Nov 7 2026), terminated at `nyv-dev-edge-alb` and forwarded to the nysdev EC2 instance (`13.232.165.242`, ap-south-1).

For Replit↔EC2 dev gateway access (deploy `2026-05-02T0946Z-replit-ssm-a558dbab`), see [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

| Key type | DB id (lookup) | Header / channel | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-nsw-sk-sb-001` | `X-API-Key: <raw>` (or `Authorization: Bearer <raw>`) | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read` (live DB, re-verified 2026-05-06) | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-nsw-pk-sb-001` | `X-Publishable-Key: <raw>` | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-nsw-ss-sb-001` | sign body → `X-NYV-Signature: hex(HMAC-SHA256(signing_key, body))` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-nsw-wh-sb-001` | verify incoming `X-NYV-Webhook-Signature` header | `webhooks:receive` | 2036-04-29 (10 y) |

Prefixes (visible in DB and in stdout when minted):
`nyv_test_sk_nsw_…`, `nyv_test_pk_nsw_…`, `nyv_ss_nsw_…`, `nyv_wh_nsw_…`

**Where to retrieve the raw values:**
On EC2 nysdev as root:
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nsp-web")'
```
S3 mirror (root-only IAM): `s3://nyayavigya-sdk-devapp/_dba/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json` (AES256-SSE).

> Keys are SHA-256 hashed in `nv_api_keys.key_hash` — once the JSON file is wiped, **re-rotate** by re-running `npx tsx /app/scripts/nv-mint-sdk-bundle.ts` inside the gateway container.

---

## 3. Quickstart — Node.js / TypeScript backend (sdk_api_key)

```ts
const NYV_BASE   = 'https://api.nyayasiddhi.online';
const NYV_API_KEY = process.env.NYV_API_KEY!;       // sdk_api_key — server only

async function orchestrate(prompt: string, jurisdiction = 'IN') {
  const r = await fetch(`${NYV_BASE}/api/nv/orchestrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': NYV_API_KEY,
    },
    body: JSON.stringify({
      query: prompt,
      jurisdiction,
      tier: 'pro',
      orchestration_pattern: 'agentic_workflow',
    }),
  });
  if (!r.ok) throw new Error(`NYV ${r.status}: ${await r.text()}`);
  return r.json();
}
```

## 4. Quickstart — Browser SPA (publishable_key only)

```ts
// Use ONLY publishable_key in browser code. Never ship sdk_api_key.
const r = await fetch('https://api.nyayasiddhi.online/api/nv/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Publishable-Key': import.meta.env.VITE_NYV_PUBLISHABLE_KEY,
  },
  body: JSON.stringify({ prompt: 'Summarise IPC §420', model: 'claude-sonnet-4-6' }),
});
```

## 5. Quickstart — HMAC request signing (server only)

```ts
import crypto from 'crypto';

function signedFetch(path: string, body: object) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', process.env.NYV_SIGNING_KEY!).update(raw).digest('hex');
  return fetch(`https://api.nyayasiddhi.online${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.NYV_API_KEY!,
      'X-NYV-Signature': sig,            // gateway recomputes & rejects mismatch
    },
    body: raw,
  });
}
```

---

## 6. Modules + endpoints

All ten core modules enabled:
`clawdbot`, `openbot`, `twindesk`, `voice_ai`, `automateai`, `doc_intelligence`, `sdk_intelligence`, `nyayarag`, `skillshop`, `hitl`.

| Capability | Endpoint | Notes |
|---|---|---|
| Multi-agent orchestration | `POST /api/nv/orchestrate` | Queen + 1042 specialised agents, all 6 jurisdictions (`IN`, `UK`, `US`, `EU`, `GC`, `SG`). |
| Direct LLM completions | `POST /api/nv/completions` | Primary `claude-sonnet-4-6`, fallback `gpt-5.5`. |
| RAG retrieval | `POST /api/nv/research/search` | Statute + case-law corpus across enabled jurisdictions. |
| Document intelligence | `POST /api/nv/documents/analyse` | Clause classifier, contract redlining, fact extraction. |
| Voice AI (STT/TTS) | `POST /api/nv/voice/transcribe`, `POST /api/nv/voice/synthesise` | Sarvam + Google providers. |
| HITL review | `GET /api/nv/hitl/queue`, `POST /api/nv/hitl/decisions` | Human-in-the-loop approvals. |
| Live health | `GET /api/nv/health/full` | Public; do not surface to end-users. |
| Legacy SDK gateway | `POST /api/nv/gateway/agents`, `POST /api/nv/gateway/research/query` | Used by `@nyayavigya/client-sdk`. |

Rate limits enforced by gateway:
`sdk_api_key` 5,000/min · `publishable_key` 1,000/min · `signing_key` & `webhook_secret` 100/min.

---

## 7. S3 document management — shared bucket `nyayavigya-sdk-devapp`

The same bucket used by NYV/NYM/NSP for document workflows. Region `ap-south-1`, AES256 SSE, versioning enabled, full public-access-block.

**Document path convention** (per-tenant isolation):
```
orgs/{orgId}/nv/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}
```
For NSP-Web: `orgId=3` (NSP Pro Tenant).

**Pipeline folders** (gateway-managed, do not upload to these directly):
```
processing/queue/        ← gateway moves new docs here for orchestration
processing/in-progress/
processing/completed/
processing/failed/
ai-outputs/classifications/
ai-outputs/extracts/
ai-outputs/ocr-results/
ai-outputs/summaries/
```

**Upload flow (recommended):**
1. Generate the doc key client-side using the convention above.
2. `PUT` directly to S3 using a presigned URL — request one from `POST /api/nv/documents/presign-upload` with `{ filename, contentType, sizeBytes }` and a valid `sdk_api_key`.
3. POST the resulting S3 key to `POST /api/nv/documents/analyse` to trigger orchestration. The gateway moves it through `processing/*` and writes results to `ai-outputs/*`.
4. Poll `GET /api/nv/documents/{docId}/status` or subscribe to webhook `documents.analysis.completed`.

**Direct read (post-processing):**
```ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'ap-south-1' });
const url = await getSignedUrl(s3, new GetObjectCommand({
  Bucket: 'nyayavigya-sdk-devapp',
  Key:    'ai-outputs/extracts/doc_1777024143745_1615ae56f00f.json',
}), { expiresIn: 600 });
```

Per-platform IAM scoping (operator action — see `NYV-OPS-RUNBOOK.md` §10): each platform's IAM principal gets `s3:GetObject` + `s3:PutObject` only on the org-prefix it owns.

---

## 8. Webhook receiver

Events: `orchestration.completed`, `orchestration.failed`, `usage.quota.warning`, `usage.quota.exceeded`, `documents.analysis.completed`, `key.expiring`, `breaker.opened`.

```ts
import crypto from 'crypto';

function verify(req: { headers: Record<string,string>; rawBody: Buffer }) {
  const sig = req.headers['x-nyv-webhook-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.NYV_WEBHOOK_SECRET!)
    .update(req.rawBody)
    .digest('hex');
  if (sig !== expected) throw new Error('signature mismatch');
}
```

---

## 9. Testing matrix (acceptance)

Run these against `https://api.nyayasiddhi.online` from a host with the keys exported as `NYV_API_KEY` / `NYV_PUBLISHABLE_KEY` / `NYV_SIGNING_KEY` / `NYV_WEBHOOK_SECRET`.

| # | Test | Expected |
|---|---|---|
| T1 | `curl https://api.nyayasiddhi.online/api/nv/health/full` | 200, `db.connected=true`, `redis.connected=true \|\| in-memory-fallback`, `agents.loaded=1042` |
| T2 | `curl -H "X-API-Key: $NYV_API_KEY" https://api.nyayasiddhi.online/api/nv/gateway/agents` | 200, agents list filtered by allowed scopes |
| T3 | `curl -X POST -H "X-API-Key: $NYV_API_KEY" -H "Content-Type: application/json" -d '{"query":"IPC 420","jurisdiction":"IN"}' https://api.nyayasiddhi.online/api/nv/research/search` | 200, RAG hits |
| T4 | T3 with `X-API-Key: invalid` | 401 |
| T5 | T3 with `X-Publishable-Key: $NYV_PUBLISHABLE_KEY` and route `/api/nv/research/search` | 403 (publishable_key has only `completions:write`+`research:read`; verify scope mismatch on a write-route) |
| T6 | `curl -X POST -H "X-Publishable-Key: $NYV_PUBLISHABLE_KEY" -d '{"prompt":"hello"}' https://api.nyayasiddhi.online/api/nv/completions` | 200 |
| T7 | HMAC-signed POST as in §5 with valid signature | 200 |
| T8 | T7 with mutated body | 401 (signature mismatch) |
| T9 | Webhook receiver with crafted payload + correct signature | 200 OK from your endpoint |
| T10 | Rate-limit burst: 6,000 req/min on `sdk_api_key` | 429 after ~5,000 |

---

## 10. Operations

- **Console** — `https://console.nyayasiddhi.online`
- **Health** — `https://api.nyayasiddhi.online/api/nv/health/full`
- **Re-mint bundle** — see `NYV-OPS-RUNBOOK.md` §5.4 (`scripts/nv-mint-sdk-bundle.ts`).
- **Production cutover** — re-run with `NYV_PLATFORM_ENV=production` to issue `nyv_live_*` keys.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-nsw-sk-sb-001'`.

---

## Appendix · Dev-environment (EC2) cheatsheet

Base URL via SSM port-forward to gateway: `http://localhost:5000` (after `aws ssm start-session --target i-0df71e5ea1df8f588 --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["5000"],"localPortNumber":["5000"]}'`).

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md) for full sample curls and the SSH-less SSM ops procedure.

---

## 11. Live request / response envelope (v5.0.1)

Every successful SDK call returns a uniform envelope. Capture these fields for support tickets — they are required to trace a request through the safety ring.

```json
{
  "requestId": "req_2026-05-07T09-58-43-211Z_8fd1c2",
  "platform":  "nsp-web",
  "tier":      "pro",
  "jurisdiction": "IN",
  "qualityScore": 0.92,
  "tokens": { "input": 412, "output": 118, "prompt": 412, "completion": 118 },
  "model":   "anthropic/claude-sonnet-4-6",
  "router":  { "providerPicked": "anthropic", "fallbackChain": ["anthropic","openrouter","agentzero"] },
  "metadata":{ "agentsUsed": 3, "pattern": "agentic_workflow", "ragHits": 7 },
  "auditHash": "sha256:f31b…ab90",
  "latencyMs": 1184,
  "data": { /* endpoint-specific payload */ }
}
```

**Header echo**: `X-NYV-Request-Id`, `X-NYV-Audit-Hash`, `X-RateLimit-Remaining`, `X-NYV-Quality-Score`.

---

## 12. Troubleshooting matrix

| Symptom | HTTP | Likely cause | Fix |
|---|---|---|---|
| `{"error":"unauthorized","code":"NYV-AUTH-001"}` | 401 | Missing or wrong header. `X-API-Key` for `sdk_api_key`, `X-Publishable-Key` for browser. | Verify header NAME matches the key TYPE; `Bearer` token is also accepted on `Authorization`. |
| `{"error":"key_not_found","code":"NYV-AUTH-002"}` | 401 | Key revoked or rotated. | Check DB `nv_api_keys.is_active=true`. Re-mint via `scripts/nv-mint-sdk-bundle.ts`. |
| `{"error":"insufficient_scope","code":"NYV-SCOPE-001","required":"agents:execute"}` | 403 | Key has scope `research:read` but not `agents:execute`. | Browser code MUST use `publishable_key` + read-only routes. For execute use `sdk_api_key` from server only. |
| `{"error":"signature_mismatch","code":"NYV-HMAC-001"}` | 401 | HMAC body changed after signing or wrong `signing_key`. | Sign the EXACT raw body bytes you POST (no JSON re-stringify after sign). |
| `{"error":"rate_limited","code":"NYV-RL-001","retryAfterMs":12450}` | 429 | Burst above 5,000/min on `sdk_api_key`. | Honour `Retry-After` header; back off exponentially. |
| `{"error":"quota_exceeded","code":"NYV-QUOTA-001"}` | 402 | Tenant ran out of monthly orchestration tokens. | Top up in Console → Billing, or upgrade tier. |
| `{"error":"safety_blocked","code":"NYV-SAFETY-001","reason":"pii_redaction_failure"}` | 422 | Guardrail caught PII in prompt. | Strip PII client-side or set `metadata.allowPii=true` only on a tenant explicitly allowlisted. |
| `{"error":"hallucination_gate_blocked","code":"NYV-HALL-001","citations":0}` | 422 | Response had 0 citations on a citation-required prompt. | Re-issue with `metadata.requireCitations=false` for ideation, or refine the query. |
| `502 Bad Gateway` from `console.nyayasiddhi.online/api/nv/*` | 502 | Console nginx can't resolve gateway IP after a recreate. | Operator: `docker compose restart console` on EC2. (Auto-handled by `deploy-replit-ssm.sh`.) |
| `503 service_unavailable` with `degraded` body | 503 | Redis or DB pool saturated; gateway in degraded mode. | Check `/api/nv/health/full`; if Redis red, this is the v5.0.1 in-memory fallback — calls still succeed but cache cold. |
| Request hangs > 30 s | — | Long-running orchestration; HTTP timeout in your client. | Set client timeout to 60 s for `/api/nv/orchestrate`; for >60 s flows, switch to streaming SSE on `/api/nv/orchestrate/stream`. |
| Smoke `200` on `/api/nv/sdk/provision/validate` returns `{ok:false}` | 200 | Key is valid but the validate endpoint always 200s with `ok` flag (post-NYV-PROV-VAL-DEFENSIVE-001). | Inspect `ok` boolean; do not key off HTTP status alone. |

**Where to look for the truth, in order:**
1. `X-NYV-Request-Id` from your response → search EC2 `docker logs nyv-gateway --since 10m | grep <reqId>`.
2. `X-NYV-Audit-Hash` → `psql -c "select * from nv_schema.audit_chain where hash='<hash>'"` on RDS.
3. `/api/nv/health/full` for db / redis / agents / llm health.

---

## 13. Environment matrix

| Env | API base | Console | RDS | Redis | SDK keys (Replit Secret name) |
|---|---|---|---|---|---|
| Replit dev (this workspace) | `http://localhost:5000` | `http://localhost:3004` | Neon (DATABASE_URL) | Upstash REST (TEMP-degrade per `nv-start-dev.sh`) | `NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}` |
| Replit publish | `https://<repl-slug>.replit.app` | same domain `/console` | Neon | Upstash REST | same secrets |
| EC2 prod (nysdev) | `https://api.nyayasiddhi.online` | `https://console.nyayasiddhi.online` | RDS PostgreSQL 16.6 ap-south-1 | ElastiCache `nyv-dev-edge-redis` (TLS+AUTH); `nyscluster` (master+replica) provisioned for next cutover | Same secrets — overlaid via `/opt/Nyayavigya/secrets/.env.production` |

Code, SDK keys, and flows are identical across all three. Only the domain / DNS differs (NV-PARITY-001).
