---

> **⚠️ REALITY CHECK 2026-05-06:** Several endpoints below describe the
> *intended* v3.1.2 product surface. The **canonical map of endpoints
> that actually exist on the running v5.0.1 gateway** is
> [`SDK-ENDPOINTS-CANONICAL-2026-05-06.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-06.md).
> If anything in this guide and that file disagree, the canonical map
> is correct.

status: active
version: 3.1.2
audience: NSM (Nyayasiddhi Ministry — sovereign GoI) engineers
last_verified: 2026-05-06
---

# Nyayavigya SDK — NSM (Nyayasiddhi Ministry) Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayasiddhi Ministry — Sovereign Regulatory Governance (`nsm`)
**App ID:** `nvsdkapp-demo-nsm-001`
**Platform type:** `nyayasiddhi_ministry` (`nys-ministry` SDK variant)
**Jurisdiction:** IN (sovereign — no foreign jurisdiction permitted)
**Tier:** government
**Environment:** sandbox (dev EC2 nysdev — `ap-south-1`; sovereign-tenant
production deployments are air-gapped per `NYV-OPS-RUNBOOK.md` §11)
**Issued:** 2026-05-02T14:21Z

> NSM is the sovereign-government surface — ministries, regulators, judiciary.
> All keys are wildcard-scoped (`*`) but every call is mediated by the
> sovereign-compliance middleware: PQC-ready encryption, full audit-chain
> emission, no foreign data residency.

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` (sovereign tenants override to in-country edge) |
| Ministry console | `https://gov.nyayasiddhi.online` |
| Admin console | `https://console.nyayasiddhi.online` |
| Docs | `https://docs.nyayasiddhi.online` |
| Status | `https://status.nyayasiddhi.online` |

TLS 1.3 via Amazon-issued ACM cert. Sovereign-air-gap deployments terminate
at an in-country WAF/ALB pair instead — see runbook §11.

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

Live `sdk_app_api_keys.scopes` for NSM (re-verified 2026-05-06 against
`src/config/nv-sdk-variants.ts → nys-ministry.scopes`):

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-nsm-sk-sb-001` | `X-API-Key: <raw>` (server-to-server) | `*` (wildcard — full surface incl. `enterprise:research`, `enterprise:assets`, `sovereign:*`) | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-nsm-pk-sb-001` | `X-Publishable-Key: <raw>` | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-nsm-ss-sb-001` | HMAC-sign requests: `X-NYV-Signature` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-nsm-wh-sb-001` | verify webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

> **Sovereign-mode default** — the platform-level `complianceLevel:sovereign`
> flag forces every orchestration call through the sovereign-compliance
> middleware: full audit-chain row, PQC-ready signing, no cross-jurisdiction
> data egress (`jurisdiction!='IN'` returns 400). Override is impossible
> without a separate ministry-issued root override token.

Prefixes: `nyv_test_sk_nsm_…`, `nyv_test_pk_nsm_…`, `nyv_ss_nsm_…`, `nyv_wh_nsm_…`

**Retrieve raw values (root on EC2 nysdev):**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nsm")'
```

---

## 3. Quickstart — sovereign Node.js / TypeScript backend

```ts
import { NyvClient } from '@nyayavigya/enterprise-sdk';

const nyv = new NyvClient({
  baseUrl:     'https://api.nyayasiddhi.online',
  apiKey:      process.env.NYV_API_KEY!,        // sdk_api_key — wildcard scopes
  signingKey:  process.env.NYV_SIGNING_KEY!,    // MANDATORY for sovereign tier
  defaultTier: 'government',
  jurisdiction: 'IN',
});

const result = await nyv.orchestrate({
  query: 'Draft a regulatory impact assessment for the proposed Personal Data Protection (Amendment) Bill, 2026',
  agents: ['regulatory-analysis', 'policy-drafting', 'legislative-review', 'constitutional-analysis'],
  outputs: ['risk_register', 'fact_summary', 'legal_memo'],
});
```

## 4. Quickstart — Direct fetch with HMAC

```ts
const r = await fetch('https://api.nyayasiddhi.online/api/nv/orchestrate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key':       process.env.NYV_API_KEY!,
    'X-NYV-Signature': hmac(process.env.NYV_SIGNING_KEY!, body),
  },
  body: JSON.stringify({
    query: 'Analyse Article 14/19/21 implications of §69A IT Act takedown orders',
    jurisdiction: 'IN',
    tier: 'government',
    orchestration_pattern: 'SovereignDeployment',
  }),
});
```

---

## 5. Modules + endpoints (sovereign surface)

All ten core modules enabled. Sovereign jurisdiction layer forces IN
statutes, parliamentary records, gazette notifications, and the full
SCI/HC case-law corpus. **Cross-border traffic is rejected at the
gateway** (returns `400 jurisdiction_not_permitted_for_app`).

| Capability | Endpoint | Notes |
|---|---|---|
| Multi-agent orchestration | `POST /api/nv/orchestrate` | Patterns: `SovereignDeployment`, `HierarchicalOrchestration`, `FederatedPrivacy`, `MultiAgentDebate`, `ConsensusBuilding`, `EscalationChain`, `GRPOOptimization`. |
| Direct completions | `POST /api/nv/completions` | Primary `o3`, fallback `claude-opus-4-6`. Temperature pinned at 0.3 for determinism. |
| RAG retrieval | `POST /api/nv/research/search` | IN statute + SCI + 25 HC + Tribunals + Gazette. |
| Document intelligence | `POST /api/nv/documents/analyse` | Clause classifier, redlining, regulatory-impact extraction. |
| Voice AI | `POST /api/nv/voice/transcribe`, `POST /api/nv/voice/synthesise` | Court-grade transcription with diarisation; 22 Indian languages. |
| AutomateAI workflows | `POST /api/nv/automate/run` | Long-running matter automations via BullMQ. |
| HITL review | `GET /api/nv/hitl/queue`, `POST /api/nv/hitl/decisions` | **Required** for any output going on government letterhead. |
| Sovereign audit export | `GET /api/nv/admin/audit/export` | PQC-signed daily audit-chain export to in-country object store. |
| Live health | `GET /api/nv/health/full` | Public diagnostics. |

Rate limits: `sdk_api_key` 200/min, `publishable_key` 200/min,
`signing_key`/`webhook_secret` 100/min. Daily cap 200,000 requests.

LLM monthly cap: 60,000,000 tokens (government default). Storage quota:
unlimited. Max doc size: 1 GB.

---

## 6. Storage — sovereign-prefix on shared bucket `nyayavigya-sdk-devapp`

Region `ap-south-1`, `orgId=5` (NSM ministry tenant). For air-gapped
production deployments, the bucket is replaced by an in-country MinIO
target — see runbook §11.

**Doc path:**
```
orgs/5/nsm/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}
```

**Sovereign retention:** versioning + 7-year immutable lock (Object Lock
in compliance mode). Lifecycle to Glacier after 90 d, deletion forbidden.

---

## 7. Webhook receiver

Events:
`orchestration.completed`, `orchestration.failed`,
`documents.analysis.completed`, `documents.conflict_detected`,
`hitl.decision.recorded`, `usage.quota.warning`, `usage.quota.exceeded`,
`key.expiring`, `breaker.opened`, `automate.job.completed`,
`audit.chain.exported` (NSM-only).

Verify with `webhook_secret` (HMAC-SHA256 of raw body) — pattern identical to
[`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) §8.

---

## 8. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` | 200, `agents.loaded≥148` |
| T2 | `POST /api/nv/orchestrate` with `jurisdiction=IN` + valid signed `X-API-Key` | 200, sovereign audit-chain row written |
| T3 | T2 with `jurisdiction=US` on NSM key | 400 `jurisdiction_not_permitted_for_app` |
| T4 | T2 without `X-NYV-Signature` | 400 `sovereign_signing_required` |
| T5 | `POST /api/nv/documents/analyse` on a 1 GB PDF | 200, processed via streaming pipeline |
| T6 | `GET /api/nv/admin/audit/export?date=2026-05-06` | 200, PQC-signed JSONL |
| T7 | Burst 250/min on `sdk_api_key` | 429 after ~200 |
| T8 | Tier-escalation: non-admin → `POST /api/nv/admin/health/full` | 403 |

---

## 9. Operations

- **Console** — `https://console.nyayasiddhi.online` (NSM tenant view).
- **Air-gapped deployment** — see `NYV-OPS-RUNBOOK.md` §11. Requires
  in-country VPC, MinIO bucket, Vault HSM, and PQC-ready ACM cert.
- **Re-mint bundle** — `NYV-OPS-RUNBOOK.md` §5.4.
- **Production cutover** — `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts`.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-nsm-sk-sb-001'`.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).
