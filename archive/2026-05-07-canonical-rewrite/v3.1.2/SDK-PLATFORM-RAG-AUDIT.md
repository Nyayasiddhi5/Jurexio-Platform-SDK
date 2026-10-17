---

> **⚠️ REALITY CHECK 2026-05-06:** Several endpoints below describe the
> *intended* v3.1.2 product surface. The **canonical map of endpoints
> that actually exist on the running v5.0.1 gateway** is
> [`SDK-ENDPOINTS-CANONICAL-2026-05-06.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-06.md).

status: active
version: 3.1.2
audience: Enterprise RAG-AUDIT integrators (research + audit-chain consumers)
last_verified: 2026-05-06
---

# Nyayavigya SDK — RAG-AUDIT Platform Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayavigya RAG-AUDIT (`rag-audit`)
**App ID:** `nvsdkapp-demo-rag-audit-001`
**Platform type:** `nyayavigya_enterprise_rag_audit`
**Jurisdiction:** IN (default), UK, US, EU, GC, SG (multi-juris with audit-chain hash continuity)
**Tier:** enterprise
**Environment:** sandbox (dev EC2 nysdev — `ap-south-1`)
**Issued:** 2026-05-02T14:21Z

> RAG-AUDIT is the *enterprise research + audit* surface — used by compliance
> teams, internal audit, regulators-shadowing-clients, and external assurance
> firms that need full provenance over every retrieval and every answer.
> Every call writes to the IronLedger hash-chain (`nv_audit_logs`) and every
> retrieval is accompanied by a verifiable citation chain.

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Audit console | `https://audit.nyayasiddhi.online` |
| Admin console | `https://console.nyayasiddhi.online` |
| Docs | `https://docs.nyayasiddhi.online` |
| Status | `https://status.nyayasiddhi.online` |

TLS 1.3 via Amazon-issued ACM cert.

---

## 2. The 4-key bundle

Live `sdk_app_api_keys.scopes` for RAG-AUDIT (re-verified 2026-05-06 against
`src/routes/nv-sdk-enterprise-routes.ts` scope checks):

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-rga-sk-sb-001` | `X-API-Key: <raw>` | **`enterprise:research`**, **`enterprise:assets`**, `documents:read`, `audit:read`, `audit:export`, `usage:read` | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-rga-pk-sb-001` | `X-Publishable-Key: <raw>` | `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-rga-ss-sb-001` | HMAC-sign requests: `X-NYV-Signature` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-rga-wh-sb-001` | verify webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

**Critical scope contract** — `enterprise:research` and `enterprise:assets`
are *both* required for the `/api/nv/sdk/research/*` and
`/api/nv/sdk/assets/*` routes (see `src/routes/nv-sdk-enterprise-routes.ts`
lines 170/196/215/234/253/285/304 — every research route hard-checks
`enterprise:research`; every asset route hard-checks `enterprise:assets`).
Wildcard `['*']` keys pass automatically; everyone else MUST have both
explicit scopes minted on the `sdk_app_api_keys` row.

Prefixes: `nyv_test_sk_rga_…`, `nyv_test_pk_rga_…`, `nyv_ss_rga_…`, `nyv_wh_rga_…`

**Retrieve raw values (root on EC2 nysdev):**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="rag-audit")'
```

---

## 3. Quickstart — research + audit-chain consumer

```ts
const NYV_BASE   = 'https://api.nyayasiddhi.online';
const NYV_API_KEY = process.env.NYV_API_KEY!;       // must carry both
                                                    // enterprise:research
                                                    // and enterprise:assets

async function auditedSearch(q: string, jurisdiction = 'IN') {
  const r = await fetch(`${NYV_BASE}/api/nv/sdk/research/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': NYV_API_KEY,
    },
    body: JSON.stringify({
      query: q,
      jurisdiction,
      include_provenance: true,    // returns per-citation hash chain
      include_audit_id:  true,     // returns nv_audit_logs row id
    }),
  });
  if (!r.ok) throw new Error(`NYV ${r.status}: ${await r.text()}`);
  return r.json();
  // → { hits, citations[], provenance{retrieval_hash,model_hash,prompt_hash}, audit_id }
}
```

## 4. Quickstart — pulling the audit chain back

```ts
async function fetchAuditChain(fromIso: string, toIso: string) {
  const r = await fetch(`${NYV_BASE}/api/nv/sdk/assets/audit-chain?from=${fromIso}&to=${toIso}`, {
    headers: { 'X-API-Key': process.env.NYV_API_KEY! },
  });
  return r.json();
  // → JSONL: { id, prevHash, recordHash, eventType, payload, timestamp, … }
  // External verifier should re-hash payload+prevHash and compare to recordHash.
}
```

---

## 5. Modules + endpoints

| Capability | Endpoint | Required scopes |
|---|---|---|
| Audited research | `POST /api/nv/sdk/research/search` | `enterprise:research` |
| Statute/case-law deep-dive | `POST /api/nv/sdk/research/statute` | `enterprise:research` |
| Vector-store query | `POST /api/nv/sdk/research/vector` | `enterprise:research` |
| Asset registry list | `GET /api/nv/sdk/assets` | `enterprise:assets` |
| Asset detail (with hash) | `GET /api/nv/sdk/assets/:id` | `enterprise:assets` |
| Asset bundle (signed zip) | `GET /api/nv/sdk/assets/:id/bundle` | `enterprise:assets` |
| Audit-chain stream | `GET /api/nv/sdk/assets/audit-chain` | `enterprise:assets` + `audit:read` |
| Audit-chain export (PQC-signed) | `GET /api/nv/sdk/assets/audit-chain/export` | `audit:export` |
| Live health | `GET /api/nv/health/full` | none |

Rate limits: `sdk_api_key` 600/min, `publishable_key` 200/min,
`signing_key`/`webhook_secret` 100/min.

---

## 6. Storage — read-only audit prefix on shared bucket `nyayavigya-sdk-devapp`

Region `ap-south-1`, audit exports written to:

```
system/audit/{YYYY-MM-DD}/audit-chain-{timestamp}.jsonl.gz.sig
```

Object Lock in compliance mode (7 yr). Every export is dual-signed (server
SHA-256 + optional PQC signature when `NYV_PQC_AUDIT=true`).

---

## 7. Webhook receiver

Events:
`research.query.completed`, `audit.chain.exported`, `audit.chain.broken`
(if hash mismatch detected by recovery script — see
`scripts/nv-audit-chain-repair.sh`), `usage.quota.warning`, `key.expiring`.

---

## 8. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` | 200 |
| T2 | `POST /api/nv/sdk/research/search` with both scopes | 200 + `provenance` + `audit_id` |
| T3 | T2 with key missing `enterprise:research` | 403 `Insufficient scope. Required: enterprise:research` |
| T4 | `GET /api/nv/sdk/assets` with key missing `enterprise:assets` | 403 `Insufficient scope. Required: enterprise:assets` |
| T5 | `GET /api/nv/sdk/assets/audit-chain?from=…&to=…` | 200 JSONL stream |
| T6 | Re-hash any row in T5 and compare to `recordHash` | exact match |
| T7 | `GET /api/nv/sdk/assets/audit-chain/export?date=2026-05-06` | 200 + `Content-Type: application/jsonl+signed` |
| T8 | Burst 800/min on `sdk_api_key` | 429 after ~600 |

---

## 9. Operations

- **Console** — `https://audit.nyayasiddhi.online` (audit-team view).
- **Hash-chain recovery** — `bash scripts/nv-audit-chain-repair.sh --dry-run`
  (see `docs/v5.0.0/V5-PLAN-WORKSTREAMS-1-2.md` T011 — never run live without a backup snapshot first).
- **Re-mint bundle** — `NYV-OPS-RUNBOOK.md` §5.4.
- **Production cutover** — `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts`.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-rga-sk-sb-001'`.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).
