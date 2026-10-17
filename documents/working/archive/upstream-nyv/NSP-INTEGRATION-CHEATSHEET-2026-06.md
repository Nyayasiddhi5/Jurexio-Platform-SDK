# NSP Integration Cheat Sheet — Nyayavigya SDK 5.0.10

> **Print target:** 2 pages · **Full API handoff:** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md) · **Guide:** `NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md` · **Live:** `https://api.nyayasiddhi.online`  
> **Updated:** 2026-08-17 · **Draft SLA:** [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md) · **Endpoint + timeout matrix (canonical):** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)

---

## 1. Connect (60 seconds)

| Item | Value |
|---|---|
| Base URL | `https://api.nyayasiddhi.online` |
| Env var | `NYV_SDK_KEY_NSP` (never in browser) |
| Auth header | `X-API-Key: nyv_live_sk_…` + `X-NYV-Platform: nsp` |
| SDK | `@nyayavigya/client-sdk@5.0.10` |
| OpenAPI | `GET /api/nv/docs` |

```bash
curl -H "X-API-Key: $NYV_SDK_KEY_NSP" -H "X-NYV-Platform: nsp" \
  https://api.nyayasiddhi.online/api/nv/gateway/health
cd nyayavigya-platform-312 && NYV_PLATFORM=NSP npm run partner:smoke:ec2
```

```typescript
import { NyvClient } from '@nyayavigya/client-sdk';
const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nsp',
  timeout: 90_000,               // interactive calls (NOT the 30_000 default)
  orchestrateTimeoutMs: 600_000, // full-counsel orchestrate only
});
```

Two numbers, not one: `timeout` applies to every non-orchestrate call, `orchestrateTimeoutMs` only to `nyv.orchestrate`. A single `600_000` lets a typeahead hang for ten minutes; the `30_000` default aborts a counsel draft. Full matrix: [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md).

---

## 2. Which endpoint when?

| NSP feature | Endpoint / SDK | Typical latency |
|---|---|---|
| Quick legal Q&A | `POST /api/nv/gateway/research/query` | 5–30 s |
| **Drafting / analysis / memos** | `POST /api/nv/orchestrate` · `nyv.orchestrate` | **fast:** `taskType=legal-draft-fast` 15–90 s · **full:** `legal-draft` 30–600 s |
| Trust badge / audit | Response: `riskBadge`, `auditHash`, `trust` | inline |
| Instant Search | `nyv.instantSearch.*` | <1–3 s |
| CNR New Case | `nyv.cnr.resolve` · `/api/nv/v1/sdk/cnr/resolve` | <5–60 s |
| **Doc companion** | `nyv.patraMitra.*` · `/api/nv/v1/sdk/patra-mitra/*` | 5–40 s |
| Summarize doc | `POST /api/nv/sdk/docs-pipeline/documents/summarize` | 10–60 s |
| Classify document | `POST /api/nv/v1/sdk/intelligence/classify-document` | 5–20 s |
| NSP file → AI index | `POST /api/nv/shared-docs/process` → poll | async |
| Large DMS / RAG | EDJ `/api/nv/v1/sdk/ecosystem-documents` | async |
| Matter packs | `nyv.matterVault.*` | async |
| Streaming UI | `POST /api/nv/orchestrate/stream` | SSE |

**Orchestrate body:**

```json
{
  "prompt": "<task>",
  "jurisdiction": "IN",
  "tier": "professional",
  "taskType": "legal-draft-fast",
  "enableRAG": true,
  "enableCitationVerification": true,
  "maxTokens": 16384,
  "ragDocumentIds": ["doc-id-after-indexing"],
  "sessionId": "nsp-matter-123"
}
```

Use `r.riskBadge` / `r.auditHash` / `r.trust` in Legal Chat UI.

---

## 3. Patra Mitra (copy-paste)

```ts
const open = await nyv.patraMitra.createSession({
  fileBase64: base64, filename: 'nda.pdf', mimeType: 'application/pdf', jurisdiction: 'IN',
});
const ask = await nyv.patraMitra.chat(sessionId, { message: 'List key obligations' });
await nyv.patraMitra.runTool(sessionId, { tool: 'extract_parties' });
```

---

## 4. Shared documents (NSP → Nyayavigya)

```
NSP uploads → POST /shared-docs/process → poll status → orchestrate with ragDocumentIds
```

Do **not** paste 200 KB of doc text into `prompt` — index first, then RAG.

---

## 5. Long prompts checklist

- [ ] Interactive AI buttons: `taskType` `*-fast`, client timeout **90 s**
- [ ] Counsel work: run on the **worker** at **600 s**, return `202` + `jobId` to the UI
- [ ] SDK `timeout: 90_000` + `orchestrateTimeoutMs: 600_000`
- [ ] Use `/orchestrate` for multi-domain work (never `gateway/documents/draft` for Assist)
- [ ] Attach `ragDocumentIds` for large matter files
- [ ] Log `requestId`, `riskBadge`, `auditHash`, `routing.path`, `requestPhase`

---

## 6. Troubleshooting (top)

| Code / symptom | Fix |
|---|---|
| 401 | Add `X-API-Key`; check env var name |
| 403 scope | Request documents/knowledge on key |
| 504 / abort | Interactive calls: 90 s. Counsel calls: run on the worker at 600 s + `202`/poll — do not hold a browser request |
| Abort while job still `generating` | Not a timeout. Keep polling your own job row; do not re-fire Queen |
| 503 CorpusBusy | Retry; FTS fallback may apply |
| Empty CNR | Show miss UI; never claim eCourts |
| Generic chatbot tone | Ensure NSP key + no lean header |

---

## 7. Honesty

Never claim: live eCourts · sealed HC forms · 100% caselaw vectors · SOC2 Type II · 1,042 live agents.
