---

> **⚠️ REALITY CHECK 2026-05-06:** Several endpoints below describe the
> *intended* v3.1.2 product surface. The **canonical map of endpoints
> that actually exist on the running v5.0.1 gateway** is
> [`SDK-ENDPOINTS-CANONICAL-2026-05-06.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-06.md).
> If anything in this guide and that file disagree, the canonical map
> is correct.

status: active
version: 3.1.2
audience: NSA (Nyayasiddhi Academy — IN/UK/US) engineers
last_verified: 2026-05-06
---

# Nyayavigya SDK — NSA (Nyayasiddhi Academy) Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayasiddhi Academy — Legal Intelligence Training (`nsa`)
**App ID:** `nvsdkapp-demo-nsa-001`
**Platform type:** `nyayasiddhi_academy` (`nys-academy` SDK variant)
**Jurisdiction:** IN (default), UK, US
**Tier:** pro (training/education)
**Environment:** sandbox (dev EC2 nysdev — `ap-south-1`)
**Issued:** 2026-05-02T14:21Z

> NSA is the legal-education surface. Moot-court simulation, exam tutoring,
> case-study analysis, and bar-prep for law students, professionals and bar
> associations. All write-paths default to `sandboxMode:true` so student
> traffic never hits production storage or billing.

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Academy console | `https://academy.nyayasiddhi.online` |
| Admin console | `https://console.nyayasiddhi.online` |
| Docs | `https://docs.nyayasiddhi.online` |
| Status | `https://status.nyayasiddhi.online` |

TLS 1.3 via Amazon-issued ACM cert. ALB target: `nysdev` EC2 in ap-south-1.

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

Live `sdk_app_api_keys.scopes` for NSA (re-verified 2026-05-06 against
`src/config/nv-sdk-variants.ts → nys-academy.scopes`):

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-nsa-sk-sb-001` | `X-API-Key: <raw>` | `agents:read`, `agents:execute`, `documents:read`, `research:read`, `translate:write` | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-nsa-pk-sb-001` | `X-Publishable-Key: <raw>` | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-nsa-ss-sb-001` | HMAC-sign requests: `X-NYV-Signature` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-nsa-wh-sb-001` | verify webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

> **Sandbox-mode default** — NSA platform-level flag `sandboxMode=true` means
> all `documents:write`-style mutations (other than `translate:write`) are
> rejected at the SDK gateway with `403 sandbox_no_write`. To enable a write
> route, an academy admin must mint a per-cohort key with the additional
> scope explicitly added by NYV ops.

Prefixes: `nyv_test_sk_nsa_…`, `nyv_test_pk_nsa_…`, `nyv_ss_nsa_…`, `nyv_wh_nsa_…`

**Retrieve raw values (root on EC2 nysdev):**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nsa")'
```

---

## 3. Quickstart — Node.js / TypeScript backend (sdk_api_key)

```ts
const NYV_BASE   = 'https://api.nyayasiddhi.online';
const NYV_API_KEY = process.env.NYV_API_KEY!;

async function tutorMe(question: string, jurisdiction = 'IN') {
  const r = await fetch(`${NYV_BASE}/api/nv/orchestrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': NYV_API_KEY,
    },
    body: JSON.stringify({
      query: question,
      jurisdiction,
      tier: 'pro',
      orchestration_pattern: 'JudgeSimulator',
      agents: ['exam-tutor', 'legal-research', 'case-analysis'],
    }),
  });
  if (!r.ok) throw new Error(`NYV ${r.status}: ${await r.text()}`);
  return r.json();
}
```

## 4. Quickstart — Browser SPA (publishable_key only)

```ts
const r = await fetch('https://api.nyayasiddhi.online/api/nv/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Publishable-Key': import.meta.env.VITE_NYV_PUBLISHABLE_KEY,
  },
  body: JSON.stringify({ prompt: 'Explain Article 14 of the Constitution of India' }),
});
```

---

## 5. Modules + endpoints

NSA enables: `nyayarag`, `doc_intelligence`, `voice_ai` (STT only),
`hitl`, plus the academy-specific `moot-court-judge`, `exam-tutor`,
`legal-writing-coach`, `quiz-generator`, `argument-evaluator` and
`curriculum-planner` agents.

| Capability | Endpoint | Notes |
|---|---|---|
| Orchestration | `POST /api/nv/orchestrate` | Patterns: `NyayaRAG`, `JudgeSimulator`, `AdversarialReview`, `ChainOfLegalThought`, `IterativeRefinement`, `PrecedentMining`. |
| Direct completions | `POST /api/nv/completions` | Primary `gpt-4.1`, fallback `gemini-2.5-flash`. |
| RAG retrieval | `POST /api/nv/research/search` | Read-only against the IN/UK/US case-law corpus. |
| Document intelligence | `POST /api/nv/documents/analyse` | Read-only — uploads disabled (sandbox). |
| Voice AI (STT) | `POST /api/nv/voice/transcribe` | TTS disabled in this variant. |
| HITL review | `GET /api/nv/hitl/queue` | Used to grade student submissions. |
| Translate | `POST /api/nv/translate` | 22 Indian languages via Sarvam. |
| Live health | `GET /api/nv/health/full` | Public diagnostics. |

Rate limits: `sdk_api_key` 80/min, `publishable_key` 80/min,
`signing_key`/`webhook_secret` 100/min. Daily cap 5,000 requests.

LLM monthly cap: 9,000,000 tokens (academy default).

---

## 6. Storage — read-only against shared bucket `nyayavigya-sdk-devapp`

Region `ap-south-1`, `orgId=4` (NSA cohort tenant). Students get **read-only**
S3 access to a curated case-law prefix:

```
orgs/4/nsa/curriculum/{course_id}/{module_id}/{filename}
```

Per-student personal scratch is local-only (not S3 backed) until the academy
upgrades to `pro+` writes via NYV ops.

---

## 7. Webhook receiver

Events:
`hitl.decision.recorded` (instructor grading),
`assessment.completed`,
`usage.quota.warning`,
`key.expiring`.

Verify with `webhook_secret` (HMAC-SHA256 of raw body) — pattern identical to
[`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) §8.

---

## 8. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` | 200, `agents.loaded≥148` |
| T2 | `POST /api/nv/orchestrate` with `pattern=JudgeSimulator` + `X-API-Key` | 200 |
| T3 | `POST /api/nv/documents/analyse` with body `{file:…}` | 403 `sandbox_no_write` |
| T4 | `POST /api/nv/research/search` with `q="Kesavananda Bharati"` | 200, ≥1 citation |
| T5 | `POST /api/nv/translate` with `{text:"hello", target:"hi"}` | 200, Hindi text |
| T6 | `POST /api/nv/voice/synthesise` | 403 (TTS disabled in NSA) |
| T7 | T2 with `X-Publishable-Key` instead of `X-API-Key` | 403 (publishable cannot orchestrate) |
| T8 | Burst 10,000 req/min on `sdk_api_key` | 429 after ~80 |

---

## 9. Operations

- **Console** — `https://console.nyayasiddhi.online` (academy admin view).
- **Re-mint bundle** — `NYV-OPS-RUNBOOK.md` §5.4.
- **Production cutover** — `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts`.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-nsa-sk-sb-001'`.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).
