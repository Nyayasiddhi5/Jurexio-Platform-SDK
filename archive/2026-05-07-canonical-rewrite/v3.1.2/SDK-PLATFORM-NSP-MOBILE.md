---
status: active
version: 5.0.1
audience: NSP-Mobile React-Native / Flutter engineers
last_verified: 2026-05-07
canonical_endpoint_map: ../canonical/04-sdk-and-api-canonical-2026-05-07.md
canonical_live_probe: ../canonical/04b-sdk-endpoint-probe-2026-05-07.md
---

> **✅ 2026-05-07 refresh (v5.0.1).** Smoke green 102/0/0 across NSP, NSPM, NSI, NSA, NSM, NYM, JRX.
> Live request/response envelopes per endpoint live in
> [`docs/canonical/04b-sdk-endpoint-probe-2026-05-07.md`](../canonical/04b-sdk-endpoint-probe-2026-05-07.md).
> Cross-platform endpoint map: [`docs/canonical/04-sdk-and-api-canonical-2026-05-07.md`](../canonical/04-sdk-and-api-canonical-2026-05-07.md).
> If this guide and the canonical disagree, the canonical wins.

# Nyayavigya SDK — NSP-Mobile Integration Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Platform:** Nyayasiddhi Professional — Mobile (`nsp-mobile`)
**App ID:** `nvsdkapp-demo-nsp-mobile-001` (created 2026-05-02 — old `35697b82-…` was stale)
**Platform type:** `nyayasiddhi_professional` (mobile surface, sibling of `nvsdkapp-demo-nsp-001`)
**Jurisdiction:** IN
**Tier:** pro
**Environment:** sandbox (dev EC2 nysdev)
**Issued:** 2026-05-02T14:21Z

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| API base | `https://api.nyayasiddhi.online` |
| Mobile-app deep-link domain | `https://pro.nyayasiddhi.online` |
| Status | `https://status.nyayasiddhi.online` |

TLS 1.3 via Amazon-issued ACM cert. ALB target: `nysdev` EC2 in ap-south-1.

> **Cert pinning** — for token-binding / device-attestation flows, pin the SHA-256 of the ACM cert. Read it once at app build:
> ```bash
> openssl s_client -connect api.nyayasiddhi.online:443 -servername api.nyayasiddhi.online </dev/null \
>   | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER \
>   | openssl dgst -sha256 -binary | openssl enc -base64
> ```

---

## 2. The 4-key bundle (capture in your secret manager NOW — never recoverable)

| Key type | DB id | Header | Scopes | Expires |
|---|---|---|---|---|
| `sdk_api_key` | `nvkb-nsb-sk-sb-001` | `X-API-Key: <raw>` (server-side proxy ONLY — never ship in app binary) | `agents:read`, `agents:execute`, `documents:read`, `documents:write`, `research:read`, `usage:read`, `voice:read`, `voice:execute` (live DB, re-verified 2026-05-06) | 2026-07-31 (90 d) |
| `publishable_key` | `nvkb-nsb-pk-sb-001` | `X-Publishable-Key: <raw>` (safe to embed in app binary) | `completions:write`, `research:read` | 2027-05-02 (365 d) |
| `signing_key` | `nvkb-nsb-ss-sb-001` | HMAC-sign requests from your BFF: `X-NYV-Signature: hex(HMAC-SHA256(signing_key, body))` | `requests:sign` | 2026-10-29 (180 d) |
| `webhook_secret` | `nvkb-nsb-wh-sb-001` | verify push-event webhooks: `X-NYV-Webhook-Signature` | `webhooks:receive` | 2036-04-29 (10 y) |

Prefixes: `nyv_test_sk_nsb_…`, `nyv_test_pk_nsb_…`, `nyv_ss_nsb_…`, `nyv_wh_nsb_…`

**Retrieve raw values:**
```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nsp-mobile")'
```

> **Mobile-platform rule:** **never ship `sdk_api_key` in the app binary.** Keep `sdk_api_key` on your BFF/proxy and only embed `publishable_key` in iOS/Android. If `sdk_api_key` is suspected leaked → immediately revoke via SQL (`UPDATE nv_api_keys SET is_active=false WHERE id='nvkb-nsb-sk-sb-001'`) and re-mint.

---

## 3. Quickstart — React Native (publishable_key)

```ts
import Constants from 'expo-constants';

const NYV_BASE = 'https://api.nyayasiddhi.online';
const NYV_PUBLISHABLE = Constants.expoConfig?.extra?.NYV_PUBLISHABLE_KEY;

export async function ask(prompt: string) {
  const r = await fetch(`${NYV_BASE}/api/nv/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publishable-Key': NYV_PUBLISHABLE!,
    },
    body: JSON.stringify({ prompt, model: 'gemini-2-5-pro' }),
  });
  if (!r.ok) throw new Error(`NYV ${r.status}`);
  const { text } = await r.json();
  return text;
}
```

## 4. Quickstart — BFF / proxy (sdk_api_key, server-side only)

```ts
import express from 'express';
const app = express();
app.use(express.json());

app.post('/v1/orchestrate', async (req, res) => {
  const r = await fetch('https://api.nyayasiddhi.online/api/nv/orchestrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.NYV_API_KEY! },
    body: JSON.stringify({ ...req.body, jurisdiction: req.body.jurisdiction ?? 'IN' }),
  });
  res.status(r.status).type('application/json').send(await r.text());
});
```

## 5. Quickstart — HMAC sign from BFF (signing_key)

```ts
import crypto from 'crypto';
function signBody(body: string) {
  return crypto.createHmac('sha256', process.env.NYV_SIGNING_KEY!).update(body).digest('hex');
}
```

---

## 6. Modules + endpoints (mobile subset)

Enabled: `clawdbot`, `openbot`, `voice_ai`, `doc_intelligence`, `sdk_intelligence`, `nyayarag`, `hitl`.
Disabled (per platform-access matrix): `twindesk`, `automateai`, `skillshop`.

| Capability | Endpoint | Notes |
|---|---|---|
| Multi-agent orchestration | `POST /api/nv/orchestrate` | Same Queen surface as web; `tier=pro`. |
| Direct completions | `POST /api/nv/completions` | Primary `gemini-2-5-pro`, fallback `claude-haiku-4-5` (mobile-optimised). |
| RAG retrieval | `POST /api/nv/research/search` | Statute + case-law corpus. |
| Document intelligence | `POST /api/nv/documents/analyse` | Clause classifier; **upload limit 25 MB** per request. |
| Voice AI | `POST /api/nv/voice/transcribe`, `POST /api/nv/voice/synthesise` | Sarvam (Hindi/Marathi/Tamil/Telugu/Kannada/Bengali/Punjabi/Gujarati). |
| HITL | `GET /api/nv/hitl/queue` | Optional. |
| Live health | `GET /api/nv/health/full` | Public; for support diagnostics. |

Rate limits (mobile-tuned): `sdk_api_key` 5,000/min, `publishable_key` 1,000/min, `signing_key`/`webhook_secret` 100/min.

---

## 7. S3 document management — shared bucket `nyayavigya-sdk-devapp`

Same bucket as NSP-Web. Region `ap-south-1`, `orgId=3` (NSP Pro Tenant).

**Mobile-specific upload flow:**
1. From mobile, request a presigned PUT URL via your BFF: `POST /v1/docs/presign` → BFF calls `POST /api/nv/documents/presign-upload` with `sdk_api_key` and 25 MB cap, returns `{ url, key }`.
2. Mobile `PUT`s the file directly to the presigned URL (no NYV traffic).
3. Mobile POSTs `{ key }` back to BFF → BFF calls `POST /api/nv/documents/analyse`.
4. Mobile subscribes to push notification driven by webhook `documents.analysis.completed`.

**Doc path:** `orgs/3/nv/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}`

Pipeline + ai-outputs folders identical to NSP-Web (see [`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) §7).

---

## 8. Push / webhook receiver

Events: `orchestration.completed`, `orchestration.failed`, `usage.quota.warning`, `usage.quota.exceeded`, `voice.transcription.completed`, `documents.analysis.completed`, `key.expiring`.

Verify with `webhook_secret` exactly as the NSP-Web guide describes (HMAC-SHA256 of raw body).

---

## 9. Testing matrix (acceptance)

| # | Test | Expected |
|---|---|---|
| T1 | `GET /api/nv/health/full` (no auth) | 200, `agents.loaded=1042` |
| T2 | RN `fetch` with `X-Publishable-Key` → `/api/nv/completions` | 200 |
| T3 | T2 with no header | 401 |
| T4 | RN `fetch` with `X-Publishable-Key` → `/api/nv/orchestrate` (write scope) | 403 (publishable_key cannot orchestrate) |
| T5 | BFF proxy `X-API-Key` → `/api/nv/orchestrate` | 200 |
| T6 | BFF proxy presign-upload + S3 PUT 26 MB file | 413 / 400 (cap exceeded) |
| T7 | BFF proxy presign-upload + S3 PUT 1 KB file | 200 + processing/completed/ key created |
| T8 | HMAC-signed mobile push | 200 |
| T9 | HMAC-signed mobile push with mutated body | 401 |
| T10 | Voice transcribe with `audio/m4a` (5 s clip in Hindi) | 200, transcript in `text` field |

---

## 10. Mobile-specific guidance

- **Offline mode** — no fully-offline orchestration. Cache last `nv-completions` response in app storage; serve stale-while-revalidate.
- **Connectivity gating** — call `GET /api/nv/health` (lightweight ~2 KB) before long flows; if `degraded` >60 s, surface system-status banner.
- **Deep-linking** — `pro://...` and `https://pro.nyayasiddhi.online/...` resolve via universal-link manifest at `/.well-known/apple-app-site-association` and `assetlinks.json`.
- **Production cutover** — re-mint with `NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-mint-sdk-bundle.ts` to swap to `nyv_live_*` keys before App Store / Play Store release.

---

## Appendix · Dev-environment access (EC2)

See [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md) for SSM port-forward + sample curls.

---

## 11. Live response envelope (v5.0.1)

Mobile clients should treat the envelope as opaque except for these fields used by your UI / support flow:

```json
{
  "requestId":   "req_2026-05-07T09-58-43-511Z_a02e88",
  "platform":    "nsp-mobile",
  "tier":        "pro",
  "qualityScore":0.91,
  "tokens":      { "input": 280, "output": 96 },
  "model":       "google/gemini-2-5-pro",
  "router":      { "providerPicked": "google", "fallbackChain": ["google","anthropic","openrouter","agentzero"] },
  "auditHash":   "sha256:c7e2…91ab",
  "latencyMs":   892,
  "data":        { /* endpoint-specific payload */ }
}
```

**Required headers to echo back to NYV support**: `X-NYV-Request-Id`, `X-NYV-Audit-Hash`.

---

## 11.1 Troubleshooting matrix (mobile-specific)

| Symptom | HTTP / OS | Cause | Fix |
|---|---|---|---|
| `401 unauthorized` from device | 401 | `publishable_key` shipped via wrong header (must be `X-Publishable-Key`, not `X-API-Key`). | Use `X-Publishable-Key` for publishable; mobile binary MUST never carry `sdk_api_key`. |
| `403 insufficient_scope` on `/api/nv/orchestrate` from app | 403 | `publishable_key` lacks `agents:execute`. | Route execute calls via your BFF using `sdk_api_key`. Pattern in §4. |
| `signature_mismatch` on signed BFF push | 401 | Body re-stringified after sign (key ordering changed). | Sign the EXACT bytes you POST. Use `Buffer.from(jsonStr,'utf8')` and reuse the same buffer. |
| Voice transcribe fails on Hindi/Marathi | 422 | `audio/mp3` sent without `language` hint. | Send `language: "hi-IN"` (or the appropriate `<bcp47>` code) in the multipart form. Sarvam supports `hi, mr, ta, te, kn, bn, pa, gu`. |
| `413 payload_too_large` on doc upload | 413 | File > 25 MB on mobile path. | Use presigned PUT direct to S3, NOT the gateway upload route. See §7. |
| Push webhook never arrives | — | TLS cert pinning rejected new ACM rotation. | Re-pin SHA-256 of the cert and ship app update. Cert valid through 2026-11-07. |
| `network_offline` perceived as gateway down | — | Device on captive portal. | `/api/nv/health` is a lightweight 2 KB GET — use as connectivity probe before long flows. |
| Universal-link doesn't open the app | — | `assetlinks.json` / `apple-app-site-association` missing fingerprint. | Verify `https://pro.nyayasiddhi.online/.well-known/{apple-app-site-association,assetlinks.json}` returns 200 with your app fingerprint. |
| App store reviewer rejects "AI medical/legal advice" | — | App description must include disclaimer. | Add the standard "AI-assisted, not legal counsel" string from `docs/canonical/00-README.md` §legal. |

**Where to look for the truth, in order:**
1. `X-NYV-Request-Id` from your BFF response → search EC2 logs.
2. `X-NYV-Audit-Hash` → matches a single row in `nv_schema.audit_chain`.
3. `https://api.nyayasiddhi.online/api/nv/health/full` from your BFF, NOT the device (CORS).
