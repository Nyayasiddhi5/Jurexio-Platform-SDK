---

> **⚠️ REALITY CHECK 2026-05-02:** Several endpoints below describe the
> *intended* v3.1.2 product surface. The **canonical map of endpoints
> that actually exist on the running v5.0.0 gateway** is
> [`SDK-ENDPOINTS-CANONICAL-2026-05-02.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-02.md).
> If anything in this guide and that file disagree, the canonical map
> is correct. Notably: `/api/nv/completions`, `/api/nv/research/search`,
> `/api/nv/twindesk/draft`, `/api/nv/automate/run`, and
> `/api/nv/skillshop/skills` return **404** today and are tracked for
> later releases. Use the SDK consumer surface at `/api/nv/sdk/*` and
> `/api/nv/gateway/*` (auth: `X-API-Key`). End-user routes like
> `/api/nv/orchestrate` require a JWT, not an SDK key. Health-check
> assertion is `agents=148`, not `1042`.

status: active
version: 3.1.2
audience: JuRiX (JRX — US Institutional) engineers
last_verified: 2026-05-02
---

# Nyayavigya SDK — JRX (JuRiX, US-version of NSI) Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** JuRiX — US Institutional (`jrx`)
**App ID:** `nvsdkapp-demo-jrx-001` (created 2026-05-02)
**Platform type:** `nyayasiddhi_institutional` (US sibling of `nvsdkapp-demo-nyi-001`)
**Jurisdiction:** US (federal + state-law layer)
**Tier:** enterprise
**Environment:** sandbox (dev EC2 nysdev — `ap-south-1`; US-region edge planned for GA)
**Issued:** 2026-05-02T14:21Z

> JRX is the US-jurisdiction sibling of NSI. Same backend, same SDK, same key bundle layout — but jurisdiction-routing forces US statutes/case-law and disables Indian-law-only agents.

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Institutional console | `https://ins.nyayasiddhi.online` (shared with NSI; tenant routing by `org_id`) |
| Console (admin UI) | `https://console.nyayasiddhi.online` |
| Docs | `https://docs.nyayasiddhi.online` |
| Status | `https://status.nyayasiddhi.online` |

TLS 1.3 via Amazon-issued ACM cert. ALB target: `nysdev` EC2 in ap-south-1. **Latency note:** US clients will see ~180-260 ms RTT to ap-south-1; a US-region replica (`us-east-1`) is planned for GA.

> **Data-residency disclosure** — sandbox traffic is processed in ap-south-1. US clients with strict data-residency requirements should **not** ship production traffic until the US-region cutover (tracked in `Project-Tracker.md` § Open).

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-jrx-sk-sb-001` | `X-API-Key: <raw>` (server-to-server) | `*` (wildcard — full SDK surface incl. `enterprise:research`, `enterprise:assets`; live DB, re-verified 2026-05-06) | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-jrx-pk-sb-001` | `X-Publishable-Key: <raw>` (browser/SPA) | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-jrx-ss-sb-001` | HMAC-sign: `X-NYV-Signature` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-jrx-wh-sb-001` | verify webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

Prefixes: `nyv_test_sk_jrx_…`, `nyv_test_pk_jrx_…`, `nyv_ss_jrx_…`, `nyv_wh_jrx_…`

**Retrieve raw values:**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="jrx")'
```

---

## 3. Quickstart — Enterprise SDK (US-jurisdiction)

```ts
import { NyvClient } from '@nyayavigya/enterprise-sdk';

const nyv = new NyvClient({
  baseUrl:     'https://api.nyayasiddhi.online',
  apiKey:      process.env.NYV_API_KEY!,
  signingKey:  process.env.NYV_SIGNING_KEY,
  defaultTier: 'enterprise',
  jurisdiction: 'US',                              // ← key difference from NSI
});

const result = await nyv.orchestrate({
  query: 'Identify any indemnification clauses in this NDA that violate California Civil Code §1668',
  documentRef: 's3://nyayavigya-sdk-devapp/orgs/2/nv/users/77/documents/doc_…/nda.pdf',
  agents: ['clawdbot', 'doc_intelligence', 'nyayarag', 'twindesk'],
  outputs: ['redlined_doc', 'risk_register', 'fact_summary'],
});
```

## 4. Quickstart — Direct fetch

```ts
const r = await fetch('https://api.nyayasiddhi.online/api/nv/orchestrate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key':       process.env.NYV_API_KEY!,
    'X-NYV-Signature': hmac(process.env.NYV_SIGNING_KEY!, body),
  },
  body: JSON.stringify({
    query: 'Draft a 12(b)(6) motion to dismiss for breach of an oral contract under New York law',
    jurisdiction: 'US',
    tier: 'enterprise',
    orchestration_pattern: 'agentic_workflow',
  }),
});
```

## 5. HMAC signing helper

```ts
import crypto from 'crypto';
const hmac = (key: string, body: string) =>
  crypto.createHmac('sha256', key).update(body).digest('hex');
```

---

## 6. Modules + endpoints (US scope)

All ten core modules enabled. Jurisdiction layer forces US statutes (USC, CFR), federal case-law (Supreme Court + Federal Circuits + District Courts), and 50-state case-law via the `nyayarag` US corpus.

| Capability | Endpoint | Notes |
|---|---|---|
| Multi-agent orchestration | `POST /api/nv/orchestrate` | `jurisdiction=US` mandatory; non-US passes return 400. |
| Direct completions | `POST /api/nv/completions` | Primary `claude-sonnet-4-6`, fallback `gpt-5.5`. |
| RAG retrieval | `POST /api/nv/research/search` | US statute + federal/state case-law corpus (Bluebook citation format). |
| Document intelligence | `POST /api/nv/documents/analyse` | Clause classifier (NDA/MSA/SaaS templates), redlining, conflict-check. |
| Voice AI | `POST /api/nv/voice/transcribe`, `POST /api/nv/voice/synthesise` | Court-reporter-grade transcription with speaker diarisation. |
| TwinDesk | `POST /api/nv/twindesk/draft` | Per-attorney drafting persona. |
| AutomateAI | `POST /api/nv/automate/run` | Matter-management workflows. |
| HITL review | `GET /api/nv/hitl/queue` | Required for any output going on firm's letterhead (Model Rule 5.5 / supervised-AI compliance). |
| SkillShop | `GET /api/nv/skillshop/skills` | Includes US-specific skills (e.g. `westlaw-shepherdize`, `pacer-fetch`). |
| Live health | `GET /api/nv/health/full` | Public. |

Rate limits: `sdk_api_key` 10,000/min, `publishable_key` 2,000/min, `signing_key`/`webhook_secret` 100/min.

LLM monthly cap: enterprise default USD 10,000 (configurable per tenant).

**Disabled vs NSI:** `clause-classifier-IN`, `case-brief-generator-IN`, `agent-jurisdiction-router-IN-states` — these return 403 on JRX. Use `clause-classifier-US`, `case-brief-generator-US`, `agent-jurisdiction-router-US-states` instead.

---

## 7. S3 document management — shared bucket `nyayavigya-sdk-devapp`

Region `ap-south-1`, `orgId=2` (shared with NSI; JRX-specific docs distinguished by tenant settings on the app row: `settings.us_version_of='nsi'`).

**Doc path:** `orgs/2/nv/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}`

**Recommended naming for US matters:** include matter id and Bates range in the filename, e.g. `…/doc_{ts}_{hex}/JRX-2026-00042_BATES_000123-000457_NDA.pdf`.

Pipeline folders (`processing/*`, `ai-outputs/*`) identical to NSI/NSP-Web.

**Bates-stamping** — `POST /api/nv/documents/bates-stamp` (institutional-only) re-emits the doc with a Bates range applied; output goes to `ai-outputs/extracts/`.

---

## 8. Webhook receiver

Events (US institutional set, identical to NSI):
`orchestration.completed`, `orchestration.failed`, `documents.analysis.completed`, `documents.conflict_detected`, `hitl.decision.recorded`, `usage.quota.warning`, `usage.quota.exceeded`, `key.expiring`, `breaker.opened`, `automate.job.completed`.

Verify with `webhook_secret` (HMAC-SHA256 of raw body) — pattern identical to NSP-Web §8.

---

## 9. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` | 200, `agents.loaded=1042` |
| T2 | `POST /api/nv/orchestrate` with `jurisdiction=US` + valid `X-API-Key` | 200, US-corpus citations |
| T3 | T2 with `jurisdiction=IN` on JRX key | 400 (`jurisdiction_not_permitted_for_app`) |
| T4 | T2 with denied agent `clause-classifier-IN` | 403 |
| T5 | `POST /api/nv/research/search` with `q="Roe v. Wade"` | 200, Bluebook-formatted citation |
| T6 | `POST /api/nv/documents/conflict-check` with two parties | 200, conflict flag |
| T7 | `POST /api/nv/twindesk/draft` US persona | 200 |
| T8 | `POST /api/nv/documents/bates-stamp` on a sample PDF | 200, bates-stamped PDF in `ai-outputs/extracts/` |
| T9 | Tier-escalation: non-admin → `POST /api/nv/admin/health/full` | 403 |
| T10 | Burst 12,000 req/min | 429 after ~10,000 |

---

## 10. Operations

- **Console** — `https://console.nyayasiddhi.online` (JRX tenant view; toggle `Jurisdiction: US`).
- **US-region cutover** — see `Project-Tracker.md` open item; required before US clients can ship production traffic.
- **Re-mint bundle** — `NYV-OPS-RUNBOOK.md` §5.4.
- **Production cutover** — `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts`.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-jrx-sk-sb-001'`.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).
