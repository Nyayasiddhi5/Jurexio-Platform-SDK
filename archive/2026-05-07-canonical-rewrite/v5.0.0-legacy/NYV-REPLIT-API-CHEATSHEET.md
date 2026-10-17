# Nyayavigya Platform — Replit API & SDK Cheatsheet
**Date:** 2026-05-05  •  **Version:** v5.0.0

This is the copy-paste guide for using the Nyayavigya gateway running on Replit
from your other Nyayasiddhi-ecosystem projects (NSP, NSI, NSA, NSM, NYM, NSPM, JRX).

---

## 1 · Base URL

The Replit gateway is publicly reachable at:

```
https://${REPLIT_DEV_DOMAIN}
```

Where `REPLIT_DEV_DOMAIN` is set automatically per Repl. Get the live value with:
```bash
echo "https://${REPLIT_DEV_DOMAIN}"
```

The current domain is shown in the live chat output. For permanent/published URLs see §6.

---

## 2 · Authentication

Send your platform's SDK key in **either** of:
```http
x-api-key: nyv_live_sk_<platform>_<48hex>
```
or
```http
Authorization: Bearer nyv_live_sk_<platform>_<48hex>
```

**Never log, commit, or expose the raw key value.** Read from `process.env.NYV_SDK_KEY_<PLATFORM>`.

---

## 3 · Per-Platform Keys (read from your project's secrets)

| Platform | Use this env var | Tier | Rate limit | Allowed scopes |
|---|---|---|---|---|
| Nyayasiddhi Professional™ | `NYV_SDK_KEY_NSP` | pro | 60/min | agents, documents, research, usage |
| Nyayasiddhi Institutional™ | `NYV_SDK_KEY_NSI` | enterprise | 600/min | `*` (all) |
| Nyayasiddhi Academy™ | `NYV_SDK_KEY_NSA` | pro | 80/min | agents, research, usage |
| Nyayasiddhi Ministry™ | `NYV_SDK_KEY_NSM` | government | 200/min | `*` (all) |
| Nyayamitra™ Citizen App | `NYV_SDK_KEY_NYM` | plus | 100/min | agents, consumer_intake |
| Nyayasiddhi Professional Mobile™ | `NYV_SDK_KEY_NSPM` | pro | 60/min | agents, documents, research, voice |
| JurisX™ | `NYV_SDK_KEY_JRX` | enterprise | 400/min | `*` (all) |

These are the same SDK key values you have in this Replit project's Secrets pane.

---

## 4 · Quick test (curl)

```bash
# Public health (no auth)
curl https://${REPLIT_DEV_DOMAIN}/api/nv/health

# Authenticated SDK health-ping (requires SDK key)
curl -X POST https://${REPLIT_DEV_DOMAIN}/api/nv/sdk/provision/health \
  -H "x-api-key: $NYV_SDK_KEY_NSP" \
  -H "Content-Type: application/json" \
  -d '{"status":"healthy","sdk_version":"5.0.0"}'
```

Expected response on success:
```json
{
  "acknowledged": true,
  "server_time": "2026-05-05T12:11:58.776Z",
  "message": "Platform health status \"healthy\" recorded"
}
```

---

## 5 · TypeScript / JavaScript example

```typescript
const NYV_BASE_URL = 'https://your-repl-name.replit.dev';
const NYV_SDK_KEY  = process.env.NYV_SDK_KEY_NSP!;

async function callAgent(agentId: string, input: object) {
  const r = await fetch(`${NYV_BASE_URL}/api/nv/sdk/enterprise/agents/${agentId}/execute`, {
    method: 'POST',
    headers: {
      'x-api-key':    NYV_SDK_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Gateway ${r.status}: ${await r.text()}`);
  return r.json();
}
```

---

## 6 · Production / published URL (planned)

Once published via Replit Deployments, the URL becomes:
```
https://<your-deployment-name>.replit.app
```
Or, if you attach a custom domain (e.g. `api.nyayavigya.com`):
```
https://api.nyayavigya.com
```

The same SDK keys + same headers work against the production URL. Switch by changing
the `NYV_BASE_URL` constant in your client.

---

## 7 · Available endpoints (high-level)

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/api/nv/health` | GET | none | Gateway liveness |
| `/api/nv/health/full` | GET | none | Detailed subsystem health |
| `/api/nv/sdk/provision/health` | POST | SDK key | Client health-ping handshake |
| `/api/nv/sdk/agents` | GET | SDK key | List agents available to your platform |
| `/api/nv/sdk/agents/:agentId/execute` | POST | SDK key | Run a legal agent |
| `/api/nv/sdk/agents/:agentId/status` | GET | SDK key | Agent execution status |
| `/api/nv/sdk/voice/transcribe` | POST | SDK key | Sarvam-backed voice → text |
| `/api/nv/v1/sdk/intelligence/legal-research` | POST | SDK key | Legal-research agent execution |
| `/api/nv/v1/sdk/intelligence/case-risk-analysis` | POST | SDK key | Case risk scoring |
| `/api/nv/v1/sdk/intelligence/predict-outcome` | POST | SDK key | Outcome prediction |
| `/api/nv/v1/sdk/intelligence/classify-document` | POST | SDK key | Document classification |
| `/api/nv/v1/sdk/intelligence/sentiment-analysis` | POST | SDK key | Sentiment scoring |
| `/api/nv/v1/sdk/intelligence/translate-legal` | POST | SDK key | Legal translation |

> **Path-prefix note:** The SDK gateway routes mount at **`/api/nv/sdk/`** (no
> `/enterprise/` segment). The intelligence routes mount at **`/api/nv/v1/sdk/intelligence/`**
> (note the `/v1/`). For the complete surface, see `src/routes/nv-sdk-*.ts`.

---

## 8 · Where to get the actual key VALUES

Three options:
1. **From this Replit project's Secrets pane** — keys are stored as `NYV_SDK_KEY_*` env vars.
2. **From `.local/secrets-pending.json`** — the issuance script wrote the live values here (gitignored).
3. **From the agent chat** — when keys are minted, the values are displayed once for you to copy.

To re-mint keys (loses the old values; existing clients break):
```bash
cd nyayavigya-platform-312
npx tsx scripts/nv-seed-sdk-keys.ts          # NSP, NSI, NSA, NSM, NYM
npx tsx scripts/nv-issue-extra-sdk-keys.ts   # NSPM, JRX
npx tsx scripts/nv-mirror-sdk-keys-to-canonical.ts   # MUST run for keys to authenticate
```
