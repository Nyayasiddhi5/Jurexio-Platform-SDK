# Nyayavigya Platform Integration Guide — NSP · NYM · JRX (2026-07)

> **Audience:** Engineering leads integrating **Nyayasiddhi Professional (NSP)**, **Nyayamitra (NYM)**, and **JRX** (white-label / integrator) with the Nyayavigya (NYV) AI backbone.  
> **API / SDK / MCP line:** **5.0.0** (SemVer locked — additive only) · Client SDK **5.0.10+** for Patra Mitra / CNR / Instant Search / trust fields  
> **Live gateway:** `https://api.nyayasiddhi.online`  
> **NYS knowledge plane:** `https://nyayasearch.nyayasiddhi.online` (reached **only** via NYV Auto-RAG / knowledge proxies)  
> **Keys:** keep current shared / per-SKU keys (see §2). **Never** put live keys in browser bundles or this document.  
> **NSP API handoff (start here for endpoints):** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)  
> **Canonical entry:** [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) — §2.1–2.3 SME drafting + Instant Search / Legal Feed  
> **Playbook (req/res/use cases):** [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md)  
> **Companions:** `ECOSYSTEM-SDK-INTEGRATION-GUIDE-2026-07.md`, `NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`, `PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`, `NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`, `NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md`, `NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md`, `NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md`, `PARTNER-SDK-RELEASE-2026-05.md`  
> **Updated:** 2026-08-12

---

## 0. Executive topology (no gaps)

```text
┌─────────────────────────────────────────────────────────────────┐
│  Frontend platforms                                              │
│  NSP (web + Word add-in) · NYM (citizen) · JRX (white-label)     │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ API / SDK / MCP / Plugin       │
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  NYV Platform 5.0.0          │   │  Client Plugin (NSP Word)    │
│  Queen · RAG · Agents · EDJ  │◄──│  OAuth UX stays on NSP       │
│  Matter Vault · MCP · LLM    │   └──────────────────────────────┘
└───────────────┬──────────────┘
                │ Auto-RAG / knowledge plane (partner key forwarded)
                ▼
┌──────────────────────────────┐
│  NYS Agentic AI              │
│  Caselaw · Statutes · Tasks  │
│  Templates · Hybrid retrieve │
└──────────────────────────────┘
```

| Layer | Owns | Does **not** own |
|---|---|---|
| **NSP / NYM / JRX** | UX, auth sessions, Word/DMS OAuth, matter pickers, billing UX | Direct LLM calls, DMS bytes→AI without NYV |
| **NYV** | Orchestration, safety ring, LLM routing, EDJ, Matter Vault, citations, partner API/SDK/MCP | Word ribbon UI, iManage login screens |
| **NYS** | Caselaw/statutes/templates/legal-work knowledge | Partner keys, Word/DMS, billing |

**Rule:** Frontends never call NYS with end-user keys for product features. Always **NYV → NYS**.

---

## 1. Integration modes (choose one or combine)

| Mode | When to use | Entry |
|---|---|---|
| **A. REST API** | Backend-to-backend, server proxies, batch jobs | `https://api.nyayasiddhi.online/api/nv/...` + `X-API-Key` |
| **B. Client SDK** | Node/TS backends & BFF (recommended) | `@nyayavigya/client-sdk@5.0.0` → `NyvClient` |
| **C. MCP server** | Cursor / Claude Desktop / agent runtimes | `@nyayavigya/mcp-server@5.0.0` (stdio or SSE) |
| **D. Partner MCP HTTP** | Custom agents without local MCP process | `GET/POST /api/nv/sdk/workflows/protocols/mcp/tools[/invoke]` |
| **E. Client plugin (Word / Outlook)** | In-document drafting & review | **NSP** add-in → NSP BFF → NYV (see Word/DMS contract) |
| **F. Ecosystem Documents (EDJ)** | Large / offline / DMS-sourced docs | `POST /api/nv/v1/sdk/ecosystem-documents/jobs` |
| **G. Matter Vault** | Multi-doc matter review + playbooks | `/api/nv/matter-vault/*` |
| **H. Nyayamitra SDK** | Citizen chat (9 languages) | `@nyayavigya/nyayamitra-sdk@5.0.0` |
| **I. Enterprise SDK** | Multi-org / compliance admin (JRX/NSI) | `@nyayavigya/enterprise-sdk@5.0.0` |

### Recommended default by platform

| Platform | Primary mode | Secondary |
|---|---|---|
| **NSP** | SDK (B) + Word plugin (E) | MCP (C) for internal agents; EDJ (F) for DMS |
| **NYM** | Nyamamitra SDK (H) + `orchestrate` | Knowledge search via SDK |
| **JRX** | SDK (B) or raw API (A) | MCP (C/D) for customer agent stacks |

---

## 2. Authentication (same keys you use today)

### Headers (all modes)

```http
X-API-Key: <your-platform-key>
Content-Type: application/json
X-NYV-SDK-Version: 5.0.0
X-NYV-Platform: nsp
X-Request-Id: <uuid>
```

| Header | Required | Notes |
|---|---|---|
| `X-API-Key` | **Yes** (canonical) | Partner SDK key |
| `Authorization: Bearer <same-key>` | Fallback | Accepted where dual-auth is enabled |
| `Authorization: Bearer <JWT>` | Console only | Operator Console — not partner product path |
| `X-NYV-Platform` | Recommended | `nsp` \| `nym` \| `jrx` |
| `X-Customer-Org-Id` | Multi-tenant | Downstream customer org |
| `X-Request-Id` | Recommended | Audit correlation |

### Env vars (no values in git)

| Platform | Env var |
|---|---|
| Shared (dev-live until rotation) | `NYV_SDK_KEY_SHARED` + `NYV_SDK_SHARED_KEYS=1` |
| NSP | `NYV_SDK_KEY_NSP` |
| NYM | `NYV_SDK_KEY_NYM` |
| JRX | `NYV_SDK_KEY_JRX` |

Canonical secret file (operators): `.local/secrets/ecosystem-shared-integration.env`  
Handover stamps (no values): `documents/working/NSP-API-KEYS-HANDOVER.md`

### Dual auth

Routes marked **dualSdkOrJwt** accept SDK key **or** Console JWT. Partner products should always send **SDK key**.

---

## 3. Intelligence depth (all document APIs)

Canonical enum — **required** on new clients:

| `depth` | Aliases | ~words (summary) | Typical tier |
|---|---|---|---|
| `concise` | `brief`, `short` | ~150 | free / starter |
| `detailed` | `standard`, `medium` | ~400 | pro |
| `comprehensive` | `long`, `full` | ~800+ | enterprise |

Resolution order: `depth` → `detailLevel` → `length` → `verbosity` (default `detailed`).  
Optional gate: `NYV_ENFORCE_DEPTH_TIERS=1` on gateway.

**Contract document types:** `nda` \| `msa` \| `employment` \| `lease` \| `spa` \| `sha` \| `loan` \| `pleadings` \| `opinion` \| `policy` \| `generic_contract` \| `matter_vault_document`

---

## 4. REST API reference (partner-critical)

Base: `https://api.nyayasiddhi.online`  
Envelope (typical): `{ "success": true, "data": { ... }, "requestId"?: "..." }`  
Errors: `{ "success": false, "error": "...", "code"?: "..." }` or catalog message codes.

### 4.1 Health & catalog

#### `GET /api/nv/health`

**Auth:** none (or SDK key).  
**Response (200):**

```json
{
  "status": "healthy",
  "version": "5.0.0",
  "totalAgents": 164,
  "platform": "Nyayavigya Platform 5.0.0"
}
```

#### `GET /api/nv/health/full`

**Auth:** SDK key recommended.  
**Response:** `status` (`healthy` \| `degraded`), `services.{database,redis,llm,nys_knowledge_plane,...}`.

#### `GET /api/nv/gateway/health` · `GET /api/nv/gateway/info`

**Auth:** SDK key.  
**Info `data.capabilities`:** agent-execution, document-*, research, translate, ocr, citations, …

#### `GET /api/nv/v1/sdk/llm/catalog`

**Auth:** SDK key.  
**Response:** `{ success, data: [ { id, provider, ... }, ... ] }` — 50+ models.

#### `GET /api/nv/v1/sdk/llm/providers`

**Auth:** SDK key.  
**Response:** `{ data: { total_providers, total_models, providers: [{ id, available, model_count_in_catalog }] } }`.

#### `GET /api/nv/observability/router-stats`

**Auth:** SDK key / operator.  
**Response:** `providersAvailable`, `catalogSize`, per-model aggregates (calls, latency, cost).

---

### 4.2 Queen orchestration (primary chat / agent path)

#### `POST /api/nv/orchestrate`

**Auth:** dualSdkOrJwt + consent gate.  
**Alias:** also under `/api/nv/orchestration/orchestrate`.

**Request:**

```json
{
  "prompt": "Explain consideration under the Indian Contract Act with citations.",
  "agentKey": "legal-research",
  "jurisdiction": "IN",
  "tier": "pro",
  "taskType": "research",
  "sessionId": "sess_...",
  "matterId": "matter_...",
  "enableRAG": true,
  "enableMemory": true,
  "enableCitationVerification": true,
  "enableHallucinationCheck": true,
  "enableHITL": false,
  "orchestrationMode": "auto",
  "previousMessages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | **Yes** | User instruction |
| `agentKey` | string | No | Registry agent id |
| `jurisdiction` | string | No | `IN`, `US`, `ALL`, … |
| `enableRAG` | boolean | No | Prefer `true` for legal |
| `enableCitationVerification` | boolean | No | Post-check citations |
| `previousMessages` | array | No | Multi-turn |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "content": "...",
    "requestId": "...",
    "model": "gemini-3-flash-preview",
    "tokens": { "prompt": 1200, "completion": 800 },
    "agentsUsed": ["legal-research"],
    "orchestrationPattern": "react",
    "citations": [],
    "hallucinationCheck": { "score": 0.1, "status": "ok" },
    "grounding": { "source": "nys_global", "chunkCount": 6 }
  }
}
```

**SDK:** `nyv.orchestrate({ ... })` · **MCP:** `nyv_orchestrate`

#### `POST /api/nv/orchestration/stream`

Same body; **SSE** stream of tokens / events.

---

### 4.3 Gateway documents

Mount: `/api/nv/gateway` (also mirrored under `/api/nv/v1/sdk`).  
**Auth:** `sdkGatewayAuth` + scopes.

#### `POST /api/nv/gateway/documents/summarize`  
Scope: `documents:read`

**Request:**

```json
{
  "content": "NDA between Alpha and Beta under Indian law...",
  "jurisdiction": "IN",
  "documentType": "nda",
  "depth": "concise",
  "focusAreas": ["term", "arbitration", "confidentiality"],
  "maxWords": 150
}
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "summary": "...",
    "depth": "concise",
    "model": "...",
    "tokens": {},
    "latencyMs": 2400
  }
}
```

**SDK:** `nyv.gateway.summarizeDocument({ ... })`

#### `POST /api/nv/gateway/documents/draft`  
Scope: `documents:write`

**Request:**

```json
{
  "template": "nda_mutual",
  "jurisdiction": "IN",
  "documentType": "nda",
  "depth": "detailed",
  "parameters": {
    "partyA": "Alpha Pvt Ltd",
    "partyB": "Beta LLP",
    "termYears": 3,
    "governingLaw": "India",
    "arbitrationSeat": "Mumbai"
  },
  "instruction": "Prefer concise commercial language."
}
```

**Response:** `{ data: { draftId, content, model, tokens, orchestration } }`  
**SDK:** `nyv.draftDocument(template, parameters, jurisdiction)` / `nyv.gateway.draftDocument`

#### `POST /api/nv/gateway/documents/analyze`  
Scope: `documents:read`

**Request:** `{ "content": "...", "type": "contract", "jurisdiction": "IN", "depth": "detailed" }`  
**Response:** `{ data: { analysisId, analysis, model, tokens } }`

#### Other document routes

| Method | Path | Scope | Body highlights |
|---|---|---|---|
| POST | `/documents/extract-entities` | `documents:read` | `content` |
| POST | `/documents/compare` | `documents:read` | two docs / texts |
| POST | `/documents/classify-clauses` | `documents:read` | clause text |
| POST | `/documents/embeddings` | `documents:read` | content |
| POST | `/documents/qa` | `documents:read` | `content`, `question` |

Legacy shims: `POST /api/nv/gateway/{draft|analyze|summarize}` → **308** to `/documents/...`.

---

### 4.4 Research & safety

#### `POST /api/nv/gateway/research/query`  
Scope: `research:read`

**Request:**

```json
{
  "query": "What is consideration under the Indian Contract Act?",
  "jurisdiction": "IN",
  "sources": ["statutes", "case_law", "regulations"]
}
```

**Response:** `{ data: { researchId, research, model, tokens, orchestration } }`  
**SDK:** `nyv.legalResearch(query, jurisdiction)` / `nyv.gateway.researchQuery`

#### `POST /api/nv/gateway/research/precedent`

**Request:** `{ "caseDescription": "...", "jurisdiction": "IN" }`

#### `POST /api/nv/gateway/citations/verify`

**Request:** `{ "outputText": "...", "jurisdiction": "IN" }`  
**SDK:** `nyv.verifyCitations(text, jurisdiction)` · **MCP:** `nyv_verify_citations`

#### `POST /api/nv/gateway/hallucination/check`

**Request:** `{ "outputText": "...", "inputText": "...", "agentKey": "..." }`  
**SDK:** `nyv.checkHallucination(...)` · **MCP:** `nyv_hallucination_check`

#### `GET /api/nv/gateway/agents`

Lists executable agents (164+ on live).  
**SDK:** `nyv.gateway.listAgents()`

---

### 4.5 Translate · OCR · voice (LLM-backed)

| Method | Path | Body | Use |
|---|---|---|---|
| POST | `/api/nv/gateway/translate` | `text`, `targetLanguage`, `sourceLanguage?` | Legal translation |
| POST | `/api/nv/gateway/translate/detect-language` | `text` | Detect |
| POST | `/api/nv/gateway/translate/batch` | `items[]` | Batch |
| POST | `/api/nv/gateway/translate/transliterate` | `text`, `targetScript` | Indic scripts |
| POST | `/api/nv/gateway/ocr/process` | `imageBase64` / `storageRef`, `language?` | Document OCR (Gemini vision when configured) |

**SDK:** `nyv.gateway.translate` / `ocrProcess` · Gemini keys: §10.

---

### 4.6 Knowledge plane (NYV → NYS)

**Auth:** dualSdkOrJwt. Flag: `NYV_F_NYS_KNOWLEDGE_PLANE`.

#### `GET /api/nv/knowledge/plane/health`

**Response:**

```json
{
  "success": true,
  "flag": true,
  "client": {
    "configured": true,
    "baseUrl": "https://nyayasearch.nyayasiddhi.online/api",
    "circuit": "closed",
    "consecutiveFailures": 0
  },
  "upstream": { "ok": true, "status": 200, "latencyMs": 4 }
}
```

#### `POST /api/nv/knowledge/search`

**Request:**

```json
{
  "query": "Section 73 Indian Contract Act damages",
  "jurisdiction": "IN",
  "limit": 8,
  "taskType": "research"
}
```

**Response:** `{ chunks[], contextBlock, intent, layersUsed, confidence, latencyMs }`  
**SDK:** `nyv.knowledge.search` · **MCP:** `nyv_knowledge_search`

#### Additional knowledge routes

| Method | Path | Purpose |
|---|---|---|
| POST | `/knowledge/retrieve` | NYS retrieval planner |
| GET | `/knowledge/caselaw/search` | `q`, `jurisdiction`, `court`, `limit` |
| GET | `/knowledge/caselaw/documents/:id` | Case document |
| GET | `/knowledge/caselaw/embedding/coverage` | Embed SLO |
| GET | `/knowledge/statutes/search` | Hybrid statute search |
| GET | `/knowledge/statutes/acts` | Act catalog |
| GET/POST | `/knowledge/statutes/compare/:kind` | IPC↔BNS etc. |
| POST | `/knowledge/citations/extract` | `{ text }` |
| POST | `/knowledge/documents/search` | Archive / Athena |
| GET | `/knowledge/templates` | Templates by jurisdiction |

---

### 4.7 Legal work (NYS task runs via NYV)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/nv/legal-work/tasks` | `q`, `jurisdiction`, `category` | Task catalog |
| GET | `/api/nv/legal-work/tasks/:id` | — | Detail |
| POST | `/api/nv/legal-work/runs` | `instruction` (≥10), `jurisdiction`, `taskId`, `context` | `202 { run }` |
| GET | `/api/nv/legal-work/runs/:id` | — | Status / result |
| POST | `/api/nv/legal-work/runs/:id/evaluate` | — | Eval |
| POST | `/api/nv/legal-work/chat/conversations` | chat body | Conversation |
| POST | `/api/nv/legal-work/chat/conversations/:id/messages` | message | Reply (long timeout) |

**SDK:** `nyv.legalWork.*` · **MCP:** `nyv_legal_work_create_run` / `nyv_legal_work_get_run`

---

### 4.7b Patra Mitra — interactive parse · fields · summary · document Q&A (2026-08)

**Product:** Patra Mitra (Document Companion) — *Parse · Understand · Ask*  
**Mount:** `/api/nv/v1/sdk/patra-mitra` · **Auth:** SDK API key + consent  
**Canonical partner doc:** [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | — | product + capabilities |
| POST | `/sessions` | `base64` **or** `content`, `fileName`, `mimeType?`, `jurisdiction?` | `201` session: fields, summary, keyPoints, textPreview |
| GET | `/sessions/:id` | `?fullText=1` optional | session |
| POST | `/sessions/:id/chat` | `message` / `question`, `jurisdiction?` | `{ answer, session }` |

**Formats:** PDF / DOCX / TXT / MD / images; scanned PDFs use OCR when the text layer is thin.  
**NSP:** use for Word selection + short uploads; large DMS files → EDJ (§4.8).  
**NYM SDK:** `nym.openPatraMitra` / `nym.askPatraMitra` (`@nyayavigya/nyayamitra-sdk@5.1.2+`).  
**NYS UI:** `/patra-mitra` on nyayasearch.

---

### 4.8 Ecosystem Documents (EDJ) — large / DMS docs

**Mount:** `/api/nv/v1/sdk/ecosystem-documents`  
**Auth:** dualSdkOrJwt + consent on create.  
**Legacy:** `POST /api/nv-docs/process` · `GET /api/nv-docs/status/:jobId`

#### `POST /jobs`

**Request:**

```json
{
  "correlationId": "nsp-matter-123-doc-1",
  "orgId": "org_...",
  "platformCode": "NSP",
  "userId": "user_...",
  "jurisdiction": "IN",
  "documentType": "nda",
  "storageRef": {
    "type": "nyv_shared_key",
    "storageKey": "shared/org/.../file.pdf",
    "sha256": "...",
    "sizeBytes": 204800,
    "mimeType": "application/pdf",
    "fileName": "nda.pdf"
  },
  "outputProfile": "full_intelligence",
  "outputOptions": {
    "enableRagIndex": true,
    "enableGraphRag": false,
    "languages": ["en", "hi"],
    "depth": "detailed"
  },
  "delivery": { "mode": "poll" },
  "ttlSeconds": 86400
}
```

`storageRef.type`: `nyv_shared_key` \| `presigned_get` \| `nyv_doc_id`  
`outputProfile`: `ingest_only` \| `summary` \| `extraction` \| `full_intelligence` \| `custom`

**Response (202):**

```json
{
  "jobId": "edj_...",
  "taskId": "...",
  "status": "queued",
  "statusUrl": "/api/nv/v1/sdk/ecosystem-documents/jobs/edj_...",
  "resultUrl": "/api/nv/v1/sdk/ecosystem-documents/jobs/edj_.../result",
  "pollIntervalMs": 2000,
  "expiresAt": "..."
}
```

| Method | Path | Response |
|---|---|---|
| GET | `/jobs/:jobId` | status, progress, resultInline \| resultRef |
| GET | `/jobs/:jobId/result` | `EdjResultEnvelope` (ingest, intelligence, fields, artifacts) |
| GET | `/jobs/:jobId/content?format=text\|fields_only` | text or fields |

**SDK:** `nyv.ecosystemDocuments.createJob` / `processAndWait` / `processSharedDoc`  
**MCP:** `nyv_edj_create_job`, `nyv_edj_get_job`

---

### 4.9 Matter Vault

**Mount:** `/api/nv/matter-vault` · **Auth:** dualSdkOrJwt

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | — | `{ service, status, persistence, capabilities }` |
| GET | `/matters` | — | `{ matters[], total }` |
| POST | `/matters` | `name*`, `matterRef?`, `jurisdiction?`, `defaultDepth?` | `201 { vault }` |
| GET | `/matters/:vaultId` | — | Full vault |
| POST | `/matters/:vaultId/upload-batch` | `documents[]`: `fileName*`, `contentBase64*`, `mimeType?`, `depth?`, `outputProfile?` | `202 { vault }` |
| POST | `/matters/:vaultId/run-playbook` | `playbookId*`, `documentText?`, `probeRag?`, `ragQuery?`, `depth?` | `{ vault }` |

**SDK:** `nyv.matterVault.*`

**Word/DMS path:** NSP OAuth → upload / `storageRef` → EDJ or Matter Vault — **not** NYS. See `NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md`.

---

### 4.10 Partner MCP (HTTP)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/nv/sdk/workflows/protocols/mcp/tools` | — | Lists tools (live catalog size large; prefer curated MCP package) |
| POST | `/api/nv/sdk/workflows/protocols/mcp/tools/invoke` | `{ "toolName": "...", "parameters": {}, "context": {} }` | **Primary partner invoke** |

Scopes: `protocols:read|write` **or** aliases `agents:*` / `research:*` / `intelligence:*`.

---

## 5. SDK integration (`@nyayavigya/client-sdk@5.0.0`)

### Install

```bash
npm install ./vendor/nyayavigya-types-5.0.0.tgz \
            ./vendor/nyayavigya-client-sdk-5.0.0.tgz
# NYM additionally:
npm install ./vendor/nyayavigya-nyayamitra-sdk-5.0.0.tgz
```

Tarballs: `nyayavigya-platform-312/sdk-dist/v5.0.0/` (or EC2 `/opt/Nyayavigya/sdk-dist/v5.0.0/`).

### Bootstrap (NSP / JRX BFF)

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!,
  baseUrl: process.env.NYV_BASE_URL ?? 'https://api.nyayasiddhi.online',
  platform: 'nsp',
  sdkVersion: '5.0.0',
});

// Health
await nyv.healthCheck();

// Queen
const ans = await nyv.orchestrate({
  prompt: 'Draft a short arbitration clause for Mumbai seat.',
  jurisdiction: 'IN',
  enableRAG: true,
  enableCitationVerification: true,
});

// Documents
await nyv.gateway.summarizeDocument({
  content: docText,
  documentType: 'nda',
  depth: 'concise',
  jurisdiction: 'IN',
});

// Knowledge → NYS
await nyv.knowledge.search({ query: '...', jurisdiction: 'IN', limit: 8 });

// Matter Vault
const vault = await nyv.matterVault.createMatter({
  name: 'Alpha v Beta',
  jurisdiction: 'IN',
  defaultDepth: 'detailed',
});

// EDJ
await nyv.ecosystemDocuments.processAndWait({ /* CreateEdjRequest */ });
```

### NYM

```ts
import { NyayamitraClient } from '@nyayavigya/nyayamitra-sdk';

const nym = new NyayamitraClient({
  apiKey: process.env.NYV_SDK_KEY_NYM!,
  baseUrl: 'https://api.nyayasiddhi.online',
});
await nym.chat({ message: '...', language: 'hi', jurisdiction: 'IN' });
```

### Key `NyvClient` surfaces

| Accessor | Purpose |
|---|---|
| `orchestrate` / `callAgent` / `mentorChat` | Queen |
| `gateway.*` | Documents, research, translate, OCR, citations |
| `knowledge.*` / `legalWork.*` | NYS plane |
| `ecosystemDocuments.*` | EDJ |
| `matterVault.*` | Matter review |
| `mcp.*` | Partner MCP list/invoke |
| `patterns.*` | ReAct, CoT, GraphRAG, … |
| `partnerIntelligence.*` | Risk, invoice hints, hearing prep |
| `llmRouter.catalog` | Model catalog |

---

## 6. MCP integration (`@nyayavigya/mcp-server@5.0.0`)

### Env

| Variable | Required | Description |
|---|---|---|
| `NYV_API_KEY` | Yes | Same partner key |
| `NYV_BASE_URL` | No | Default live API |
| `NYV_MCP_SKU` | No | `nsp` \| `nym` \| `jrx` \| `full` |
| `NYV_MCP_ENABLE_HITL` | No | `1` to expose HITL tools |

### Cursor `mcp.json`

```json
{
  "mcpServers": {
    "nyayavigya": {
      "command": "npx",
      "args": ["-y", "@nyayavigya/mcp-server"],
      "env": {
        "NYV_API_KEY": "${NYV_SDK_KEY_NSP}",
        "NYV_BASE_URL": "https://api.nyayasiddhi.online",
        "NYV_MCP_SKU": "nsp"
      }
    }
  }
}
```

### Curated tools (full SKU ~35)

| Tool id | Kind |
|---|---|
| `nyv_orchestrate` | Queen |
| `nyv_knowledge_search` / `nyv_knowledge_retrieve` | NYS via NYV |
| `nyv_legal_work_create_run` / `nyv_legal_work_get_run` | Legal work |
| `nyv_rag_query` | Auto-RAG |
| `nyv_verify_citations` / `nyv_hallucination_check` | Safety |
| `nyv_edj_create_job` / `nyv_edj_get_job` | EDJ |
| `nyv_memory_get_matter` / `nyv_memory_get_client` | Memory |
| `nys_search_caselaw` / `nys_search_statutes` / `nys_retrieve` / … | Gateway MCP → NYS |
| `document_parse` / `clause_extractor` / `pii_scan` | Doc tools |
| `nyv_hitl_*` | Gated HITL |

HTTP equivalent: §4.10.

---

## 7. Client plugin (NSP Word / Outlook)

1. User signs in on **NSP**; Word task pane uses NSP session.  
2. NSP BFF holds `NYV_SDK_KEY_NSP` (never in the add-in).  
3. Selection / full doc → `summarize` / `draft` / EDJ / Matter Vault with `depth` + `documentType`.  
4. Insert returned text into Word.  
5. DMS: NSP OAuth to iManage/NetDocuments/SharePoint → `storageRef` → EDJ.

Full checklist: `NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md`.

---

## 8. Platform playbooks

### NSP

1. Install client-sdk 5.0.0; set `NYV_SDK_KEY_NSP`.  
2. BFF proxy all browser calls.  
3. Wire: orchestrate, research, draft/summarize (+ depth), knowledge.search, EDJ, Matter Vault.  
4. Word add-in per §7.  
5. Optional: MCP server for internal counsel agents.  
6. Smoke: `NYV_SDK_SHARED_KEYS=1 npm run partner:smoke:ec2` (NSP block).

### NYM

1. Install `nyayamitra-sdk` + client-sdk.  
2. Citizen chat → `NyayamitraClient.chat` / `nyv.orchestrate` with language.  
3. Ground answers with `knowledge.search` (IN default).  
4. Do **not** expose Matter Vault enterprise playbooks to citizens unless product requires.

### JRX

1. client-sdk or enterprise-sdk; `NYV_SDK_KEY_JRX`.  
2. White-label: pass `X-Customer-Org-Id` for tenant isolation.  
3. Expose subset of APIs to JRX customers; keep keys on JRX BFF.  
4. MCP SKU `jrx` for customer agent products.

---

## 9. Cohesion checklist (NYV ↔ NYS ↔ frontends)

| Capability | Frontend | NYV | NYS |
|---|---|---|---|
| Legal chat / agents | UI | Queen + safety ring + LLM | Grounding via Auto-RAG |
| Caselaw / statutes | Search UI | `/knowledge/*` proxy | Corpus + hybrid retrieve |
| Templates / legal tasks | Galleries | `/legal-work/*`, `/knowledge/templates` | Seeded catalogs |
| Doc intelligence | Upload / Word | Gateway + EDJ + Vault | Optional RAG index |
| Citations | Badges | verify + hallucination | Cite sources in chunks |
| Embed SLO | Status cards | coverage proxies | Worker embed jobs |
| LLM choice | (optional) model pick | Intelligent router / Bedrock / OpenRouter / Gemini | — |

**Anti-patterns:** frontend → NYS direct; Word add-in with embedded API key; skipping `enableRAG` on legal prompts; calling OpenAI/Gemini from the SPA.

---

## 10. Adding Gemini (and other LLMs) on EC2

Gemini is already wired in code (`real-llm-service`, OCR adapter, router catalog). To add / rotate **Gemini credits**:

### 10.1 Env vars (gateway container / `/opt/Nyayavigya/secrets/.env.production`)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | **Primary** Google Generative AI key (intelligence, chat, OCR vision) |
| `GOOGLE_API_KEY` | Alias accepted by OCR / some providers |
| `GOOGLE_AI_API_KEY` | Alias used by embedding / pipeline paths |

Also keep (already used for multi-model):

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Meta-router (200+ models, incl. Gemini via OpenRouter) |
| `OPENAI_API_KEY` | Direct OpenAI + embeddings fallback |
| `ANTHROPIC_API_KEY` | Direct Claude (optional if Bedrock covers Claude) |
| `NYV_BEDROCK_ENABLED` | `on` / `true` to use AWS Bedrock |
| `AWS_BEDROCK_REGION` / IAM | Bedrock invoke (platform IAM) |
| `SARVAM_API_KEY` | Indic translation / speech-adjacent |
| `PERPLEXITY_API_KEY` | Web-grounded search models (when enabled) |

### 10.2 Operator steps

1. Create / copy Gemini key from Google AI Studio (or Cloud).  
2. On EC2 (SSM), edit production env — **do not** commit values:

```bash
# Example operator flow (values via secure channel only)
sudoedit /opt/Nyayavigya/secrets/.env.production
# set GEMINI_API_KEY=...
# optional: GOOGLE_API_KEY= same value if OCR path expects it
```

3. Recreate gateway so env is injected:

```bash
cd /opt/Nyayavigya/CURRENT_DEPLOY   # or compose project dir
docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway
```

4. Verify (no secret echo):

```bash
curl -sS -H "X-API-Key: $NYV_SDK_KEY_NSP" \
  https://api.nyayasiddhi.online/api/nv/observability/router-stats \
  | jq '.providersAvailable.google, .catalogSize'
```

Expect `google: true`. Live traffic often shows `gemini-*-flash` / `gemini-2.5-pro` in `aggregates.byModel`.

5. Task mapping:

| Task | Typical path | Gemini role |
|---|---|---|
| General intelligence / chat | Queen / orchestrate | Router may select Gemini |
| Language translation | `/gateway/translate` | Gemini or Sarvam / OpenRouter |
| Web search–style Q&A | research + Perplexity/OpenRouter | Gemini optional |
| Document OCR | `/gateway/ocr/process`, EDJ OCR | Gemini vision when key set |
| Embeddings | RAG pipeline | Prefer OpenAI/OpenRouter embeddings; Gemini embeddings if configured |

### 10.3 Bedrock / OpenRouter notes

- **Bedrock:** ensure Anthropic/Llama model access in AWS console for the account, IAM `bedrock:InvokeModel`, `NYV_BEDROCK_ENABLED=on` (already in `docker-compose.aws-dev.yml`).  
- **OpenRouter:** single key unlocks many models; router uses it as failover / catalog expander.

---

## 11. Live EC2 status snapshot (post-deploy 2026-07-14T1015Z)

Captured against `https://api.nyayasiddhi.online` with shared partner key (values redacted).  
**Deploy:** `2026-07-14T1015Z-replit-ssm` (sha `1ab27435`) — SUCCESS.

| Check | Result |
|---|---|
| `GET /api/nv/health` | **200** `healthy`, version **5.0.0**, **164** agents |
| `GET /api/nv/matter-vault/health` | **200** `operational` — persistence `nv_schema.nv_matter_vaults`; capabilities include `depth-tiers` |
| `POST .../documents/summarize` (`depth: concise`) | **200** — `data.depth === "concise"` |
| `GET /api/nv/knowledge/plane/health` | **200** — NYS upstream **ok**, circuit **closed** |
| Partner smoke (7 SKUs incl. NSP/NYM/JRX) | **PASS** (0 failures) — health, catalog, agents, research, plane, knowledge search, legal-work, BNS orchestrate |
| MCP tools list / invoke | **200** partner path live |
| LLM catalog | **51** models |
| `providersAvailable` (router-stats) | **openai** ✓ · **google** ✓ · **openrouter** ✓ · **groq** ✓ · **sarvam** ✓ · **bedrock** ✓ · **agentzero** ✓ · **anthropic** direct ✗ · mistral/deepseek/xai/perplexity/together/cohere/vertex ✗ |
| Recent model traffic (pre-redeploy sample) | `gemini-3-flash-preview` + `gemini-2.5-pro` — **100%** success in aggregates |

**Interpretation:** RDS, Redis, LLM service, NYS plane, RAG/knowledge search, Matter Vault, depth tiers, and multi-provider routing (incl. **Gemini + Bedrock + OpenRouter**) are live on EC2. Direct Anthropic key appears unset (Claude still available via **Bedrock**). `health/full` may still show overall `degraded` when optional deps (`nsi_api`, payments, etc.) are `not_configured` — that is expected for partner-only stacks.

Apply Matter Vault migration if a fresh RDS ever lacks the table:

`migrations/2026-07-14-nv-matter-vaults.sql` → `nv_schema.nv_matter_vaults`.

---

## 12. Smoke & acceptance

```bash
cd nyayavigya-platform-312
# Local secrets loaded — do not print keys
export NYV_SDK_SHARED_KEYS=1
set -a; source ../.local/secrets/ecosystem-shared-integration.env; set +a

npm run partner:smoke:ec2
npm run smoke:offline-docs   # depth + vault (needs live Vault route)
```

Acceptance for NSP/NYM/JRX GA integration:

- [ ] Health 200 + SDK auth 200 on gateway/info  
- [ ] orchestrate legal prompt returns grounded content  
- [ ] knowledge/search returns chunks from NYS  
- [ ] summarize/draft honor `depth`  
- [ ] EDJ job create → poll → result  
- [ ] Matter Vault health + create matter  
- [ ] MCP list + one invoke (`nyv_orchestrate` or knowledge search)  
- [ ] Router-stats shows required providers (`google` if Gemini credits in use)

---

## 13. Document map

| Doc | Role |
|---|---|
| **This file** | Full multi-mode integration + API payloads for NSP/NYM/JRX |
| `ECOSYSTEM-SDK-INTEGRATION-GUIDE-2026-07.md` | All 7 platforms SDK playbooks |
| `NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md` | Word/DMS ownership + depth |
| `NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md` | NYS federation details |
| `PARTNER-SDK-RELEASE-2026-05.md` | Release / smoke / tarball handoff |
| `LLM-STACK.md` | Historical provider matrix (refresh via router-stats) |

---

*Generated for Nyayavigya Platform 5.0.0 · Integration keys unchanged · Update §11 after each EC2 deploy.*
