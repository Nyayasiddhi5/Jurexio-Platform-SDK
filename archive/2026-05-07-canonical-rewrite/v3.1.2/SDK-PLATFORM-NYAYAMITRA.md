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
audience: Nyayamitra (NYM — citizen legal aid) engineers
last_verified: 2026-05-02
---

# Nyayavigya SDK — NYM (Nyayamitra) Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayamitra — Citizen Legal Aid (`nyayamitra` / `nym`)
**App ID:** `nvsdkapp-demo-nm-001` (refreshed 2026-05-02 — old `c7ce080f-…` retired)
**Platform type:** `nyayamitra`
**Jurisdiction:** IN (citizen-tier, scoped agent allowlist)
**Tier:** plus
**Environment:** sandbox (dev EC2 nysdev)
**Issued:** 2026-05-02T14:21Z

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Citizen-app domain | `https://nym.nyayasiddhi.online` |
| Status page | `https://status.nyayasiddhi.online` |

Tied to the same dev-edge ALB (TLS 1.3, ACM cert valid through Nov 7 2026).

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-nym-sk-sb-001` | `X-API-Key: <raw>` (server-side only — BFF / Lambda / Cloud Run) | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `translate:write`, `consumer_intake:write`, `usage:read` (live DB, re-verified 2026-05-06) | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-nym-pk-sb-001` | `X-Publishable-Key: <raw>` (safe in citizen web/PWA & RN app) | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-nym-ss-sb-001` | HMAC-sign sensitive requests: `X-NYV-Signature` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-nym-wh-sb-001` | verify legal-aid case-event webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

Prefixes: `nyv_test_sk_nym_…`, `nyv_test_pk_nym_…`, `nyv_ss_nym_…`, `nyv_wh_nym_…`

**Retrieve raw values:**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nyayamitra")'
```

---

## 3. Quickstart — Node.js BFF (citizen Q&A)

```ts
const NYV_BASE = 'https://api.nyayasiddhi.online';

export async function citizenAsk(question: string, language = 'hi') {
  const r = await fetch(`${NYV_BASE}/api/nv/orchestrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.NYV_API_KEY!,
    },
    body: JSON.stringify({
      query: question,
      jurisdiction: 'IN',
      tier: 'citizen',
      orchestration_pattern: 'mitra_chat',
      input_language: language,
      output_language: language,
      agents: ['mitra-conversational', 'agent-language-router', 'agent-jurisdiction-router'],
    }),
  });
  if (!r.ok) throw new Error(`NYV ${r.status}`);
  return r.json();
}
```

## 4. Quickstart — Browser PWA (publishable_key)

```ts
const r = await fetch('https://api.nyayasiddhi.online/api/nv/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Publishable-Key': import.meta.env.VITE_NYV_PUBLISHABLE_KEY,
  },
  body: JSON.stringify({ prompt: question, model: 'sarvam-105b' }),
});
```

---

## 5. Modules + endpoints (citizen subset)

Enabled (deliberately narrow for citizen safety): `openbot`, `voice_ai`, `doc_intelligence`, `nyayarag`.
Disabled: `clawdbot`, `twindesk`, `automateai`, `sdk_intelligence`, `skillshop`, `hitl`.

> NYM's allowlist is gateway-enforced from `nv_sdk_applications.settings.agents_allowed`. Citizens get conversational guidance, classifier output, and brief generation — but **no** human-review queue, **no** workflow automation, **no** SDK-management surfaces.

| Agent | Role |
|---|---|
| `mitra-conversational` | Citizen-facing chat (multilingual, plain-language). |
| `clause-classifier` | Tag clauses in user-uploaded documents. |
| `case-brief-generator` | Plain-language brief for any IPC / CrPC / Constitution citation. |
| `agent-jurisdiction-router` | Routes to the right state-law / central-law layer. |
| `agent-language-router` | Detects + translates among 11 Indian languages. |

All other agents return 403.

| Capability | Endpoint | Notes |
|---|---|---|
| Citizen Q&A | `POST /api/nv/orchestrate` (allowed agents above) | Plain-language; **IN jurisdiction only**. |
| Direct completions | `POST /api/nv/completions` | Primary `sarvam-105b` (Indic-native), fallback `kimi-k2-6`. |
| RAG retrieval | `POST /api/nv/research/search` | Indian statute + case-law corpus. |
| Document analysis | `POST /api/nv/documents/analyse` | Clause classification only (no contract redlining). |
| Voice AI | `POST /api/nv/voice/transcribe`, `POST /api/nv/voice/synthesise` | Sarvam STT/TTS for 11 Indian languages. |
| Live health | `GET /api/nv/health/full` | Public diagnostics. |

Rate limits (citizen-aid scale): `sdk_api_key` 1,000/min, `publishable_key` 200/min, `signing_key`/`webhook_secret` 100/min.

---

## 6. Multilingual operation

The gateway routes by `input_language` and forces output through Sarvam for these BCP-47 codes:
`hi-IN`, `mr-IN`, `ta-IN`, `te-IN`, `kn-IN`, `bn-IN`, `pa-IN`, `gu-IN`, `ml-IN`, `or-IN`, `en-IN` (default).

Pass `input_language` and `output_language` separately for translation; otherwise both default to detected input.

---

## 7. S3 document management — shared bucket `nyayavigya-sdk-devapp`

Same bucket as NSP/NSI. Region `ap-south-1`, `orgId=1` (Nyayavigya Demo Tenant — NYM falls under demo until a dedicated NYM tenant is created).

**Citizen-doc upload flow:**
1. Citizen uploads a doc (e.g. a notice they received) via the PWA.
2. PWA calls your BFF `/v1/citizen/upload-presign` → BFF calls `POST /api/nv/documents/presign-upload` with `sdk_api_key` and `org_id=1`. Returns `{ url, key }`.
3. PWA `PUT`s file to presigned URL.
4. PWA POSTs `{ key }` to BFF → BFF calls `POST /api/nv/documents/analyse` with `agents: ['clause-classifier']`.
5. Result lands in `ai-outputs/classifications/` and a webhook fires.

**Doc path:** `orgs/1/nv/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}`
Pipeline folders identical to other platforms (see [`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) §7).

---

## 8. Webhooks

Events: `orchestration.completed`, `orchestration.failed`, `voice.transcription.completed`, `documents.analysis.completed`, `usage.quota.warning`, `usage.quota.exceeded`, `key.expiring`.

Verify with `webhook_secret` (HMAC-SHA256, see NSP-Web guide §8).

---

## 9. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` | 200, `agents.loaded=1042` |
| T2 | `POST /api/nv/orchestrate` with allowed agent `mitra-conversational` + `X-API-Key` | 200 |
| T3 | T2 with denied agent `agent-litigation-strategist` | 403 |
| T4 | `POST /api/nv/completions` with `X-Publishable-Key`, prompt in Hindi | 200, response in Hindi (Sarvam) |
| T5 | Same as T4 with `output_language=ta-IN` | 200, response in Tamil |
| T6 | `POST /api/nv/voice/transcribe` with 10 s `audio/m4a` Marathi clip | 200, Devanagari Marathi text |
| T7 | `POST /api/nv/documents/analyse` with `agents:['clause-classifier']` on a sample contract | 200, classifications written to `ai-outputs/classifications/` |
| T8 | T7 with `agents:['contract-redliner']` (denied for NYM) | 403 |
| T9 | Burst 1,200 req/min on `sdk_api_key` | 429 after ~1,000 |
| T10 | Webhook signature verification (correct + incorrect) | 200 / 401 |

---

## 10. Operations

- **Console** — `https://console.nyayasiddhi.online` (NYM tenant view).
- **Re-mint bundle** — `NYV-OPS-RUNBOOK.md` §5.4.
- **Production cutover** — `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts`.
- **Revoke a single key** — `UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-nym-sk-sb-001'`.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md).
