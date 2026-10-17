# NSP API Handoff — Nyayavigya 5.0.0 (2026-08-12)

> **Audience:** NSP / Nyayasiddhi Professional backend & BFF engineers  
> **Live API:** `https://api.nyayasiddhi.online`  
> **SDK:** `@nyayavigya/client-sdk@5.0.10`  
> **Deploy evidence:** NYV gateway `2026-08-12T1734Z-aws-ssm` (trust fields + Patra SDK surface)  
> **Auth:** `X-API-Key: <NYV_SDK_KEY_NSP>` · `X-NYV-Platform: nsp` · `X-NYV-SDK-Version: 5.0.10`  
> **Never call NYS directly from NSP** — always via NYV Knowledge Plane / SDK proxies.

This is the **updated partner API pack** for NSP. Deep contracts stay in the linked docs; this file is the single checklist for what to wire now.

---

## 0. Install

```bash
npm install @nyayavigya/client-sdk@5.0.10
```

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
  defaultPlatform: 'nsp',
  timeout: 600_000, // orchestrate / Queen
});
```

Always send `X-NYV-Platform: nsp` (SDK does this when `defaultPlatform: 'nsp'`).

### Rate limits / credits (NV-NSP-UNLIMITED-001)

NSP requests (**any user / any org SDK key**) skip product RPM, org AI rate limits, credit/hourly caps, and daily token budgets. Response header: `X-NSP-Unlimited: 1`. Escape: `NYV_NSP_UNLIMITED=0`. Safety ring / consent unchanged. Best-outcome Queen + RAG + 16k token floor remain forced.

Smoke (from NYV monorepo):

```bash
cd nyayavigya-platform-312 && NYV_PLATFORM=NSP npm run partner:smoke:ec2
```

Partner smoke now probes gateway health **plus** CNR / Patra Mitra / Matter Vault health.

---

## 1. Quick map — which API when

| NSP need | Prefer | Path / SDK |
|---|---|---|
| Legal Q&A, research, memos, multi-agent | Orchestrate | `POST /api/nv/orchestrate` · `nyv.orchestrate` |
| Streaming UI | Orchestrate stream | `POST /api/nv/orchestrate/stream` · `nyv.orchestrate.stream` |
| Instant Search typeahead | Instant Search | `nyv.instantSearch.*` (no `/instant` route) |
| Statutes / caselaw detail | Knowledge Plane | `/api/nv/knowledge/*` · `nyv.knowledge.*` |
| New Case CNR autofill | CNR resolve | `/api/nv/v1/sdk/cnr/*` · `nyv.cnr.*` |
| Word selection / short doc Q&A | Patra Mitra | `/api/nv/v1/sdk/patra-mitra/*` · `nyv.patraMitra.*` |
| India pleadings / BNSS apps | Draft + templates | `nyv.draftDocument` · `nyv.templates.*` |
| Large DMS / durable RAG | EDJ | `/api/nv/v1/sdk/ecosystem-documents/*` |
| Matter packs / playbooks | Matter Vault | `/api/nv/matter-vault/*` · `nyv.matterVault.*` |
| Live Legal Feed | Intelligence | `nyv.intelligence.getLegalFeed*` |

---

## 2. Orchestrate — partner trust envelope (NEW · live)

`POST /api/nv/orchestrate` returns an **outcome-only** payload (no Queen topology leak). Stable partner fields:

| Field | Type | Meaning |
|---|---|---|
| `content` | string | Primary answer |
| `curated` | `{ summary, sections[], recommendations[] }` | UI-ready breakdown |
| `citations` / `grounding` / `hallucinationCheck` | object | Quality signals |
| `qualityEnvelope` | object | Mandatory-section / quality gates |
| **`riskBadge`** | `GREEN` \| `YELLOW` \| `RED` | Trust badge for NSP UI |
| **`auditHash`** | string (32 hex) | Deterministic fingerprint for audit UX |
| **`trust`** | `{ grounded, citationsPresent, qualityOk, compliancePassed }` | Booleans for badges |
| `requestId` | string | Correlation id |
| `cost` | tokens + latencyMs + model/provider | Metering |

```ts
const r = await nyv.orchestrate({
  prompt: 'Draft grounds for anticipatory bail under BNSS 482…',
  taskType: 'document-drafting',
  jurisdiction: 'IN',
  sessionId: 'nsp-matter-123',
  enableRAG: true,
  enableCoT: true,
  enableCitationVerification: true,
});

// Wire into NSP Legal Chat / Word
const badge = r.riskBadge;      // GREEN | YELLOW | RED
const hash = r.auditHash;       // store with matter turn
const ok = r.trust?.qualityOk;
```

**Guarantees for NSP:** Queen depth + RAG + citation + hallucination + memory ON; `jurisdiction=IN` forced; lean headers ignored unless ops flag.

**Timeouts:** BFF / ALB / SDK ≥ **600 s** for Queen paths.

---

## 3. Patra Mitra — Document Companion (`nyv.patraMitra` · SDK 5.0.10)

Full contract: [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md)

| Method | Path | SDK |
|---|---|---|
| GET | `/api/nv/v1/sdk/patra-mitra/health` | `nyv.patraMitra.health()` |
| GET | `/api/nv/v1/sdk/patra-mitra/sessions` | `nyv.patraMitra.listSessions()` |
| POST | `/api/nv/v1/sdk/patra-mitra/sessions` | `nyv.patraMitra.createSession({…})` |
| GET | `/api/nv/v1/sdk/patra-mitra/sessions/:id` | `nyv.patraMitra.getSession(id)` |
| POST | `/api/nv/v1/sdk/patra-mitra/sessions/:id/chat` | `nyv.patraMitra.chat(id, { message, answerLanguage })` |
| POST | `/api/nv/v1/sdk/patra-mitra/sessions/:id/tools` | `nyv.patraMitra.runTool(id, { tool })` |

```ts
const session = await nyv.patraMitra.createSession({
  fileBase64: base64,
  filename: 'nda.pdf',
  mimeType: 'application/pdf',
  jurisdiction: 'IN',
  answerLanguage: 'en',
});

const { data } = await nyv.patraMitra.chat(sessionId, {
  message: 'Who are the parties and what is the term?',
  answerLanguage: 'en',
});

await nyv.patraMitra.runTool(sessionId, { tool: 'extract_parties' });
// tools: parties | dates | amounts | citations | clauses | pii | language | export | …
```

Use Patra for interactive Word/selection/short uploads. Prefer **EDJ** for large DMS ingest + durable RAG.

---

## 4. CNR resolve — New Case autofill

Full contract: [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md)

| Method | Path | SDK |
|---|---|---|
| GET | `/api/nv/v1/sdk/cnr/health` | `nyv.cnr.health()` |
| POST | `/api/nv/v1/sdk/cnr/resolve` | `nyv.cnr.resolve({ cnr, options })` |
| GET | `/api/nv/v1/sdk/cnr/{cnr}` | `nyv.cnr.get(cnr)` |
| GET | `/api/nv/v1/sdk/cnr/{cnr}/documents` | `nyv.cnr.listDocuments(cnr)` |

**Honesty:** always `claimEcourts: false`. UI badge: **Suggested · Judgment corpus** — never “live eCourts”.

```ts
const res = await nyv.cnr.resolve({
  cnr: 'RJHC010324382023',
  options: { includeDocuments: true, fuzzyLimit: 5 },
});
```

---

## 5. Instant Search & Knowledge

Detail: [`NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md`](./NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md)

```ts
await nyv.instantSearch.statutes('BNS 103', { jurisdiction: 'IN', limit: 8 });
await nyv.instantSearch.caselaw('anticipatory bail', { mode: 'fts', limit: 10 });
await nyv.instantSearch.search('BNS murder', { jurisdiction: 'IN', mode: 'fts' });
```

| Method | Path |
|---|---|
| GET/POST | `/api/nv/knowledge/statutes/search` |
| GET | `/api/nv/knowledge/caselaw/search?mode=fts\|hybrid` |
| POST | `/api/nv/knowledge/search` · `/retrieve` |

Caselaw semantic embed is still **ops-backfill** (not 100%). Prefer `mode=fts` for typeahead; hybrid for research panes. Gateway may fall back hybrid→FTS on `CorpusBusy`.

---

## 6. Templates · drafting · legal intel

| Surface | SDK / Path |
|---|---|
| India templates catalog | `GET /api/nv/templates` · `nyv.templates.*` |
| SME draft | `nyv.draftDocument(template, params, 'IN')` |
| BNSS 25 apps | template ids `nys-in-bnss-*` |
| Live Legal Feed | `nyv.intelligence.getLegalFeed*` |
| Legal intel surface map | [`NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`](./NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md) |

Drafting rules: HC/Sessions pattern; **no surety schedules in bail applications**; humanized counsel voice; templates = practice aids **not** sealed court forms.

---

## 7. Documents · EDJ · Matter Vault

| Need | API |
|---|---|
| Shared NSP bucket → RAG | `POST /api/nv/shared-docs/process` → poll status → `ragDocumentIds` on orchestrate |
| Async ecosystem jobs | `/api/nv/v1/sdk/ecosystem-documents/jobs` |
| Matter packs | `/api/nv/matter-vault/*` · `nyv.matterVault.*` |
| Doc convert (large) | `/api/nv5/doc-ai/jobs` |

---

## 8. Response / error conventions

| Code | Action |
|---|---|
| 200 / 201 | Success envelope `{ success, data }` (SDK unwraps) |
| 400 | Invalid CNR / body |
| 401 | Missing/wrong `X-API-Key` |
| 403 | Scope — request documents/knowledge on key |
| 503 `CorpusBusy` | Retry; FTS fallback may apply |
| Empty feed `no_data` | Honest empty — do **not** fabricate cards |

---

## 9. Do not claim (sell honesty)

- Live eCourts sync / scrape  
- 1,042 live agents (runtime = **164**)  
- Full MCP catalog as executable (curated ~125 live)  
- Sealed SC/HC court forms  
- 100% caselaw vector coverage  
- SOC 2 Type II certified  
- DocuSign / iManage OAuth as NYV-owned (NSP owns OAuth UX)

---

## 10. Related documents (full pack)

| Doc | Role |
|---|---|
| [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) | Canonical combined integration |
| [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md) | Request/response playbook |
| [`NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md`](./NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md) | Long-form NSP SDK guide |
| [`NSP-INTEGRATION-CHEATSHEET-2026-06.md`](./NSP-INTEGRATION-CHEATSHEET-2026-06.md) | 2-page cheat sheet |
| [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md) | Patra Mitra full API |
| [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md) | CNR contract |
| [`NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`](./NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md) | Legal intel / Instant Search |
| [`Nyayavigya-Platform-5.0.0-Business.md`](./Nyayavigya-Platform-5.0.0-Business.md) | Product / sell posture |
| [`Nyayavigya-Platform-5.0.0-Technical.md`](./Nyayavigya-Platform-5.0.0-Technical.md) | Technical product note |
| [`PLATFORM-STATUS.md`](./PLATFORM-STATUS.md) | Live status |

OpenAPI explorer: `GET https://api.nyayasiddhi.online/api/nv/docs`
