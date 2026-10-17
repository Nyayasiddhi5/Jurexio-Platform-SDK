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
audience: NSI (Nyayasiddhi Institutional — IN) engineers
last_verified: 2026-05-02
---

# Nyayavigya SDK — NSI Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayasiddhi Institutional — IN (`nsi`)
**App ID:** `nvsdkapp-demo-nyi-001`
**Platform type:** `nyayasiddhi_institutional`
**Jurisdiction:** IN
**Tier:** enterprise
**Environment:** sandbox (dev EC2 nysdev)
**Issued:** 2026-05-02T14:21Z

> NSI is the institutional surface for Indian law firms, in-house counsel teams, GLCs, NGOs, and academic legal-research bodies. JuRiX (`jrx`) is the US-jurisdiction sibling of this platform — see [`SDK-PLATFORM-JRX.md`](./SDK-PLATFORM-JRX.md).

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Institutional console | `https://ins.nyayasiddhi.online` |
| Console (admin UI) | `https://console.nyayasiddhi.online` |
| Docs | `https://docs.nyayasiddhi.online` |
| Status | `https://status.nyayasiddhi.online` |

TLS 1.3 via Amazon-issued ACM cert. ALB target: `nysdev` EC2 in ap-south-1.

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-nsi-sk-sb-001` | `X-API-Key: <raw>` (server-to-server) | `*` (wildcard — full SDK surface incl. `enterprise:research`, `enterprise:assets`; live DB, re-verified 2026-05-06) | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-nsi-pk-sb-001` | `X-Publishable-Key: <raw>` (browser/SPA) | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-nsi-ss-sb-001` | HMAC-sign requests: `X-NYV-Signature` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-nsi-wh-sb-001` | verify webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

Prefixes: `nyv_test_sk_nsi_…`, `nyv_test_pk_nsi_…`, `nyv_ss_nsi_…`, `nyv_wh_nsi_…`

**Retrieve raw values:**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nsi")'
```

---

## 3. Quickstart — Enterprise SDK (Node.js / TypeScript)

```ts
import { NyvClient } from '@nyayavigya/enterprise-sdk';

const nyv = new NyvClient({
  baseUrl:     'https://api.nyayasiddhi.online',
  apiKey:      process.env.NYV_API_KEY!,        // sdk_api_key
  signingKey:  process.env.NYV_SIGNING_KEY,     // optional but recommended for institutional traffic
  defaultTier: 'enterprise',
  jurisdiction: 'IN',
});

const result = await nyv.orchestrate({
  query: 'Identify clauses in this MSA that conflict with Section 28 of the Indian Contract Act, 1872',
  documentRef: 's3://nyayavigya-sdk-devapp/orgs/2/nv/users/42/documents/doc_1777024143745_1615ae56f00f/msa.pdf',
  agents: ['clawdbot', 'doc_intelligence', 'nyayarag', 'twindesk'],
  outputs: ['redlined_doc', 'risk_register', 'fact_summary'],
});
```

## 4. Quickstart — Direct fetch (no SDK)

```ts
const r = await fetch('https://api.nyayasiddhi.online/api/nv/orchestrate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key':     process.env.NYV_API_KEY!,
    'X-NYV-Signature': hmac(process.env.NYV_SIGNING_KEY!, body),  // see §5
  },
  body: JSON.stringify({
    query: 'Draft a witness statement for a §138 NI Act prosecution',
    jurisdiction: 'IN',
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

## 6. Modules + endpoints

All ten core modules enabled (full enterprise surface):
`clawdbot`, `openbot`, `twindesk`, `voice_ai`, `automateai`, `doc_intelligence`, `sdk_intelligence`, `nyayarag`, `skillshop`, `hitl`.

| Capability | Endpoint | Notes |
|---|---|---|
| Multi-agent orchestration | `POST /api/nv/orchestrate` | All 6 jurisdictions; default `IN`. |
| Direct LLM completions | `POST /api/nv/completions` | Primary `claude-sonnet-4-6`, fallback `gpt-5.5`, frontier `gpt-5.5` for "needs-best" flag. |
| RAG retrieval | `POST /api/nv/research/search` | Statute + case-law (Supreme Court + 25 High Courts + Tribunals). |
| Document intelligence | `POST /api/nv/documents/analyse` | Clause classifier, contract redlining, fact extraction, conflict-check. |
| Voice AI | `POST /api/nv/voice/transcribe`, `POST /api/nv/voice/synthesise` | Court-grade transcription with diarisation. |
| TwinDesk drafting twin | `POST /api/nv/twindesk/draft` | Per-counsel drafting persona. |
| AutomateAI workflows | `POST /api/nv/automate/run` | Long-running matter-management automations via BullMQ. |
| HITL review | `GET /api/nv/hitl/queue`, `POST /api/nv/hitl/decisions` | Required for any artefact going on the firm's letterhead. |
| SkillShop | `GET /api/nv/skillshop/skills` | Discover firm-internal & marketplace skills. |
| Live health | `GET /api/nv/health/full` | Public diagnostics. |

Rate limits: `sdk_api_key` 10,000/min, `publishable_key` 2,000/min, `signing_key`/`webhook_secret` 100/min.

LLM monthly cap: enterprise default USD 10,000 (configurable per tenant from Console).

---

## 7. S3 document management — shared bucket `nyayavigya-sdk-devapp`

Same bucket. Region `ap-south-1`, `orgId=2` (Nyayasiddhi Internal — institutional shared tenant; per-firm sub-tenancy happens via additional `org_id` rows).

**Doc path:** `orgs/2/nv/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}`

**Institutional patterns:**
- **Matter-level grouping** — store the matter id in the doc filename or sidecar metadata: `…/doc_{ts}_{hex}/matter-NSI-2026-00417_msa.pdf`.
- **Conflict-check pre-upload** — call `POST /api/nv/documents/conflict-check` with party names before storing the doc to avoid storing conflicted material.
- **Retention** — by default S3 versioning is enabled (90-day lifecycle on noncurrent versions managed by NYV ops). For institutional tenants requiring 7-year retention, request a per-prefix lifecycle override from NYV ops (runbook §10).

Pipeline folders (`processing/*`, `ai-outputs/*`) and presigned-URL flow identical to NSP-Web (see [`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) §7).

**Direct read with the AWS SDK:**
```ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'ap-south-1' });
const url = await getSignedUrl(s3, new GetObjectCommand({
  Bucket: 'nyayavigya-sdk-devapp',
  Key:    'ai-outputs/extracts/doc_1777024143745_1615ae56f00f.json',
}), { expiresIn: 600 });
```

---

## 8. Webhook receiver

Events (institutional set):
`orchestration.completed`, `orchestration.failed`, `documents.analysis.completed`, `documents.conflict_detected`, `hitl.decision.recorded`, `usage.quota.warning`, `usage.quota.exceeded`, `key.expiring`, `breaker.opened`, `automate.job.completed`.

Verify with `webhook_secret` (HMAC-SHA256 of raw body) — pattern identical to NSP-Web §8.

---

## 9. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` | 200, `agents.loaded=1042` |
| T2 | `POST /api/nv/orchestrate` with all 10 modules requested + valid `X-API-Key` | 200 |
| T3 | T2 with `X-Publishable-Key` instead of `X-API-Key` | 403 (publishable_key cannot orchestrate) |
| T4 | T2 without `X-NYV-Signature` (signing optional but logged) | 200 + `_nyv_signature_status=absent` in audit |
| T5 | T2 with mutated body but original signature | 401 |
| T6 | `POST /api/nv/documents/conflict-check` with two opposing parties | 200, conflict flag returned |
| T7 | `POST /api/nv/twindesk/draft` enterprise persona | 200, draft + persona id |
| T8 | `POST /api/nv/automate/run` long-running workflow | 200, returns `job_id`; poll `/api/nv/automate/jobs/{id}` |
| T9 | Tier-escalation: non-admin enterprise user attempts `POST /api/nv/admin/health/full` | 403 |
| T10 | Burst 12,000 req/min | 429 after ~10,000 |

---

## 10. Operations

- **Console** — `https://console.nyayasiddhi.online` (institutional admin view).
- **Per-firm sub-tenancy** — request via Console `Settings → Tenants → Create child org`. Each firm gets its own `org_id` and `nvkb-nsi-…` keys can be re-minted scoped to that org.
- **Re-mint bundle** — `NYV-OPS-RUNBOOK.md` §5.4.
- **Production cutover** — `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts`.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-nsi-sk-sb-001'`.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).
