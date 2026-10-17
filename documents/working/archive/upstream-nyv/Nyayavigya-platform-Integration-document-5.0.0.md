# Nyayavigya Platform Integration Document 5.0.0

> **Title:** Nyayavigya Platform — SDK & API Integration Guide for Nyayasiddhi Ecosystem Platforms  
> **Version:** **5.0.0** (platform release line) · Client SDK surface **5.0.10+** (additive)  
> **Updated:** 2026-08-20T10:15Z — **GO deploy** NYV `8c6852aa` / NYS `712e35ea…` (§4e–§4f in [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)). Prior: **NV-DRAFT-FAST-SLA-001** + **NV-QE-COT-CAPTURE-FAIL-001** (Job 297).  
> **Audience:** NSP, NSPM, NSI, NSA, NSM, NYM, JRX engineering leads  
> **Live API:** `https://api.nyayasiddhi.online`  
> **Console:** `https://console.nyayasiddhi.online` · Legal Drafting UI: `/legal-drafting`  
> **Knowledge Plane (NYS):** federated under `/api/nv/knowledge/*` and `/api/nv/legal-work/*`  
> **NSP API handoff (2026-08-17 draft SLA):** [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md)  
> **AI task endpoint + timeout + tracking matrix (NSP / NYM):** [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md)  
> **NSP API handoff (2026-08-12 Patra/CNR/trust):** [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)  
> **August 2026 pack:** [`Nyayavigya Documents 5.0.0-August2026/00-README-INDEX.md`](./Nyayavigya%20Documents%205.0.0-August2026/00-README-INDEX.md) · Integration extract: [`03-Integration-Guide-NSP-NYM-Ecosystem.md`](./Nyayavigya%20Documents%205.0.0-August2026/03-Integration-Guide-NSP-NYM-Ecosystem.md)  
> **Companions:** [`Nyayavigya-Platform-5.0.0-Technical.md`](./Nyayavigya-Platform-5.0.0-Technical.md) · [`Nyayavigya-Platform-5.0.0-Business.md`](./Nyayavigya-Platform-5.0.0-Business.md) · **[`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md)**  
> **Legal intel / Instant Search / Patra / CNR:** [`NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`](./NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md) · [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md) · [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md)

This is the **single combined integration document** for Nyayavigya API + SDK + Knowledge Plane (caselaw, statutes, templates, legal-work, Instant Search, Live Legal Feed) used by all Nyayasiddhi ecosystem platforms.

### Partner claims matrix (Wave D — sell honestly)

| Claim | Posture | Honest fact |
|---|---|---|
| Partner curated MCP | **Live** | **~125** tools — **109** gateway curated executable + **~16** MCP-server API tools (`packages/mcp-server` SKU `full`) |
| MCP in-code catalog | **Catalog only** | **~556** definitions; remainder return honest `501 not_implemented` — do **not** sell the full catalog |
| OAuth connector stubs | **Not sold** | **~25** tools (DocuSign, iManage/DMS OAuth, Drive, Slack, …) return `oauth_required` — **not** live integrations |
| Runtime agents | **Live** | **164** in default registry — **not** “1,042 agents live” (1,042 = archived v5.0.0 forensic backup only) |
| Caselaw semantic embed | **Ops-backfill** | **~3–7%** of **~20.5M** judgments embedded; hybrid + FTS search work today — corpus is **not** fully vectorized |
| Queen CoT + maker-checker + neural rerank | **Live** | **Ecosystem (NSP/NYM/NSI/NSA/NSM/NSPM/NYV):** always max depth + RAG + citations + hallucination + memory; lean ignored unless `NYV_ALLOW_NSP_NYM_LEAN=1`. JRX selective. Other: Queen on research/complex |
| India-grade drafting / summarize | **Live** | NV-LEGAL-DRAFT-BEST-001 + **NV-SME-LEGAL-DRAFT-002**: HC/Sessions patterns, humanized counsel voice, no sureties in bail apps, forum (district/court) fields, Console mic dictation |
| BNSS 25 essential court applications | **Live** | Templates `nys-in-bnss-*` + knowledge pack matcher + statute expansion |
| Mesh v1 manifest leaves | **Live** (schedulable) | Queen intent map schedules: `templates.*`, `digital_twin.simulate`, `clm.*`, `efiling.*`, `intelligence.precedent` |
| Multi-AZ RDS / ElastiCache | **Not sold** | Single-AZ dev-tier today — production Multi-AZ requires explicit **GO** |
| Sealed SC/HC court forms | **Not sold** | India templates = practitioner / SME-approved **drafts** — counsel filing responsibility |
| SOC 2 Type II certification | **Not sold** | ISO/SOC **evidence mappers** + audit hash chain — **no** Type II cert yet |
| Full DMS OAuth (DocuSign / iManage) | **Not sold** | NSP/JRX own OAuth UX; NYV accepts content/`storageRef` — no live NYV-side DMS OAuth |
| Instant Search (dedicated `/instant` route) | **Not sold** | Use `nyv.instantSearch.*` → Knowledge Plane statutes/caselaw/acts (no separate Instant Search microservice) |
| Live Legal Feed (own RSS→S3/RDS/RAG) | **Live** | `nyv.intelligence.getLegalFeed*` — Tavily off by default; empty digest = honest `no_data` |
| Gazette → matter notify | **Deferred** | Phase C — do not sell |

Authority: `MCP_REGISTRY_STATS` in `src/data/nv-mcp-tools-registry.ts` · `FEATURES-REGISTRY.md` · `PLATFORM-STATUS.md` § honesty.

---

## 1. What you integrate

| Layer | What partners call | Package / surface |
|---|---|---|
| **Orchestration / AI tasks** | `POST /api/nv/orchestrate`, research, gateway agents | `@nyayavigya/client-sdk` → `nyv.orchestrate` (+ `riskBadge` / `auditHash` / `trust`) |
| **Instant Search** | statutes / caselaw / acts typeahead (composed) | `nyv.instantSearch.*` (**5.0.7+**) |
| **Knowledge Plane (NYS)** | search, caselaw, statutes, citations, archive, templates | `nyv.knowledge.*` |
| **CNR resolve (New Case)** | corpus / Open Data autofill (`claimEcourts:false`) | `nyv.cnr.*` (**5.0.9+**) |
| **Patra Mitra (Document Companion)** | parse / OCR / fields / summary / doc-chat / tools | `nyv.patraMitra.*` (**5.0.10+**) |
| **Live Legal Feed / regulatory digest** | daily digest, history, generate; regulatory list | `nyv.intelligence.getLegalFeed*` / `getRegulatoryFeed` |
| **Legal work** | tasks, runs, evaluate, legal chat | `nyv.legalWork.*` |
| **Legal templates (India approved)** | catalog, approved, SME review, generate | `nyv.templates.*` |
| **Documents** | EDJ / Matter Vault / draft | `nyv.ecosystemDocuments` / `matterVault` / gateway draft |

**Auth (mandatory):**

```http
X-API-Key: <NYV_SDK_KEY_*>
Authorization: Bearer <NYV_SDK_KEY_*>   # accepted fallback
Content-Type: application/json
X-NYV-SDK-Version: 5.0.10
```

| Platform | Env var |
|---|---|
| NSP | `NYV_SDK_KEY_NSP` |
| NSPM | `NYV_SDK_KEY_NSPM` |
| NSI | `NYV_SDK_KEY_NSI` |
| NSA | `NYV_SDK_KEY_NSA` |
| NSM | `NYV_SDK_KEY_NSM` |
| NYM | `NYV_SDK_KEY_NYM` |
| JRX | `NYV_SDK_KEY_JRX` |

---

## 2. Quick start (SDK)

```bash
npm install @nyayavigya/client-sdk@5.0.10
# or vendor tarball from sdk-dist / partner handoff
```

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_SDK_KEY_NSP!, // NYM: NYV_SDK_KEY_NYM
  baseUrl: 'https://api.nyayasiddhi.online',
  defaultJurisdiction: 'IN',
});

// AI task (RAG + citation gates ON by default for partners)
const ai = await nyv.orchestrate({
  prompt: 'Summarise essentials of consideration under Indian Contract Act.',
  jurisdiction: 'IN',
  enableRAG: true,
  enableCoT: true,
  enableCitationVerification: true,
});
// Partner trust (live 2026-08-12): ai.riskBadge · ai.auditHash · ai.trust

// Patra Mitra — short doc companion (SDK 5.0.10)
// await nyv.patraMitra.createSession({ fileBase64, filename, mimeType: 'application/pdf' });
// await nyv.patraMitra.chat(sessionId, { message: 'Who are the parties?' });

// CNR New Case autofill (SDK 5.0.9+) — never claim eCourts
// await nyv.cnr.resolve({ cnr: 'RJHC010324382023', options: { includeDocuments: true } });

// Instant Search (typeahead) — preferred over raw parallel knowledge calls
const instant = await nyv.instantSearch.search('BNS 103', {
  jurisdiction: 'IN',
  mode: 'fts',
  limit: 8,
});

// Knowledge Plane — hybrid research search (detail pane, not every keystroke)
const hits = await nyv.knowledge.search({
  query: 'anticipatory bail BNSS',
  jurisdiction: 'IN',
  limit: 5,
});

// Caselaw (resilient: gateway retries + FTS fallback on CorpusBusy)
const cases = await nyv.knowledge.searchCaselaw({
  q: 'anticipatory bail',
  jurisdiction: 'IN',
  limit: 5,
  mode: 'fts',
});

// Live Legal Feed (own RSS → S3/RDS/RAG — no Tavily by default)
const feed = await nyv.intelligence.getLegalFeed({ jurisdiction: 'IN' });
const reg = await nyv.intelligence.getRegulatoryFeed('IN', 50);

// India approved templates
const templates = await nyv.templates.list({ jurisdiction: 'IN' }); // approvedOnly default
const filled = await nyv.templates.generate(templates.data.templates[0].id, {
  court_name: 'District Court, Bengaluru',
});
```

**NSP vs NYM (frontend):** NSP should bump to **`@nyayavigya/client-sdk@5.0.10`**, wire Instant Search + Legal Feed + Patra Mitra + CNR + orchestrate `riskBadge`/`auditHash`. NYM keeps `@nyayavigya/nyayamitra-sdk` for chat/voice/Patra helpers; may also use client-sdk. Statute FAQ grounding is server-side on orchestrate/Queen.

### 2.1 Ecosystem — always best legal AI outcome (NV-ECOSYSTEM-BEST-OUTCOME-001)

For every `POST /api/nv/orchestrate` and `/orchestrate/stream` (and gateway draft/summarize) authenticated as a **NYV-dependent** platform — **NSP, NYM, NSI, NSA, NSM, NSPM, NYV** (and other SDK partners except **JRX**) — the gateway automatically:

| Guarantee | Behaviour |
|---|---|
| **Agentic depth** | AdaptiveRouter prefers **Queen** (multi-agent) + `queenDepth` + CoT + maker-checker for legal prompts |
| **Document path** | OCR/parse/summarize/extract → **doc-pipeline** capability leaves (real document intelligence), then safety ring |
| **Legal drafting (NV-LEGAL-DRAFT-BEST-001)** | `POST /api/nv/gateway/documents/draft` uses India pleading/contract system prompts (BNS/BNSS/BSA, cause title, Prayer, Verification); quality gates forced ON; advocate disclaimer. Freeform `orchestrate` drafts use Queen agents + same overlay — **not** blank template fill |
| **Summarize / classify** | NSP/NYM summarize via safety ring + India-aware prompts; clause classify uses India taxonomy |
| **Grounding** | RAG **ON**; citation verification **ON**; hallucination check **ON**; explainability **ON** |
| **Memory** | Session/matter memory **ON** when a user id is present |
| **India lock** | `jurisdiction=IN` forced |
| **Statute FAQs** | Short BNS/IPC section FAQs use grounded **specialist** (accurate statute title — not Queen waffle) |
| **Lean opt-out** | `partnerSyncLean` / `X-NYV-Partner-Sync-Lean` **ignored** (set `NYV_ALLOW_NSP_NYM_LEAN=1` only for rare sync extracts) |
| **Legal-intel force (NV-LEGAL-INTEL-FORCE-001)** | Universal counsel overlay on Queen / specialist / research / `/agents/run`; overlays **survive** prompt compiler; ecosystem never forced to single-agent lean |
| **Prompt load-once (NV-AGENT-PROMPT-SESSION-001)** | Session Turn 1 loads full 23-section constitution (L0); Turn 2+ uses §1 identity + §2 mandate + short §0 binding (L1) + task/legal overlay (L2). Ecosystem auto-mints `sessionId` when omitted. Single-shot uses L1+L2 (never mid-§0 truncate). Middleware (L3) still enforces security/governance. **Live** EC2 `2026-08-04T0846Z-aws-ssm`. |
| **Instant Search / Feed** | Use `nyv.instantSearch.*` + `nyv.intelligence.getLegalFeed*` — composed Knowledge Plane + own feed (not a separate stub microservice) |

**Preferred partner calls for drafts:**

1. **Sync / UI-bound (Written Statement, Describe & Generate, case-create draft):** `nyv.orchestrate({ prompt, taskType: 'legal-draft-fast', jurisdiction: 'IN' })` — specialist, RAG+citations ON, **CoT off**. Worker timeout **90s**. See [`NSP-API-HANDOFF-2026-08-17.md`](./NSP-API-HANDOFF-2026-08-17.md).  
2. `nyv.draftDocument(template, parameters, 'IN')` — India-grade gateway drafting (best-outcome for NSP/NYM).  
3. **Full counsel (user opted into long generation):** `nyv.orchestrate({ prompt: 'Draft …', taskType: 'legal-draft' or 'document-drafting', jurisdiction: 'IN' })` — Queen when earned. Worker timeout **600s**.  
4. Catalog fill only when you have a known template id: `templates.generate(id, fields)`.

A `-fast` suffix is a **latency contract**. Bare `legal-draft` / `legal-chat` / `drafting` still run Queen + CoT. `legal-draft-deep` is the opposite of `-fast`.

If Queen CoT JSON fails to parse after a completed answer, NYV now returns **HTTP 200** with the draft (`NV-QE-COT-CAPTURE-FAIL-001`) instead of `QUALITY_ENVELOPE_FAILED missing:["cot"]` (Job 297).

Partners should **not** send `enableRAG: false` / `enableCitationVerification: false` on NSP/NYM — those flags are forced ON. Prefer omitting lean headers entirely.

Disable mandate (ops only): `NYV_ECOSYSTEM_BEST_OUTCOME=0` (alias `NYV_NSP_NYM_BEST_OUTCOME=0`).

**Model cascade (legal drafting / research):** Bedrock primary region **`us-east-1`** (failover `ap-south-1`) — Claude Sonnet / DeepSeek R1 / Kimi / Qwen / Gemma / Nova → Gemini pool → OpenRouter → OmniRoute → AgentZero. Partner `maxTokens` floor **16384**.

**Partner trust fields (NV-ORCH-RESPONSE-CONTRACT-001 · live `2026-08-12T1734Z`):** every orchestrate outcome includes `riskBadge` (`GREEN`|`YELLOW`|`RED`), `auditHash` (32-hex fingerprint), and `trust.{grounded,citationsPresent,qualityOk,compliancePassed}` — safe for NSP audit UX; Queen topology remains sanitized unless diagnostics flag is on.

### 2.2 SME drafting contract (High Court pattern · humanized · context)

Full request/response examples: [`NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md`](./NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md).

| Rule | Behaviour |
|---|---|
| **HC / Sessions pattern** | Cause title with named Court → MOST RESPECTFULLY SHOWETH → grounds → Prayer → Verification |
| **Humanized counsel voice** | No chatbot preamble; practising-advocate register |
| **Bail sureties** | **Not** in application body/Prayer; furnish only **after** grant |
| **Forum precision** | Pass `highCourt`, `courtName`, `district`, `state`, `seat`, `policeStation` in `parameters` (or top-level draft body) |
| **Templates honesty** | Practice-pattern practitioner aids — **not** sealed HC certified forms |
| **Mic dictation** | Console `/legal-drafting` + Doc Pipeline textareas (Web Speech `en-IN`) — NSP Word should mirror |

```ts
await nyv.draftDocument('anticipatory_bail', {
  instruction: 'FIR 123/2026 Cubbon Park — apprehends arrest…',
  highCourt: 'High Court of Karnataka',
  district: 'Bengaluru Urban',
  courtName: 'Sessions Judge, Bengaluru Urban',
  state: 'Karnataka',
}, 'IN');
```

### 2.3 BNSS 25 court applications

Catalog slugs `nys-in-bnss-*` (anticipatory/regular/default bail, discharge, remand, adjournment, revision, transfer, property, proclamation, …). Drafting overlays match BNSS sections (aliases corrected: cancel bail §492, HC transfer §447, property §497/§498).

---

## 3. Canonical API map (ecosystem)

### 3.1 Health & readiness

| Method | Path | Notes |
|---|---|---|
| GET | `/api/nv/health` | Public liveness |
| GET | `/api/nv/health/full` | Service map (auth) |
| GET | `/api/nv/gateway/health` | Partner smoke |
| GET | `/api/nv/knowledge/plane/health` | NYS client + upstream |

### 3.2 Orchestration & AI tasks

| Method | Path | SDK |
|---|---|---|
| POST | `/api/nv/orchestrate` | `nyv.orchestrate` / `orchestrateApi.run` → includes `riskBadge`/`auditHash`/`trust` |
| POST | `/api/nv/orchestrate/stream` | `nyv.orchestrate.stream` (AG-UI SSE; outcome-only for partners) |
| POST | `/api/nv/gateway/research/query` | Gateway research |
| GET | `/api/nv/v1/sdk/llm/catalog` | Model catalog |
| GET | `/api/nv/gateway/agents` | Agent list |

**Recommended body (smooth legal quality):**

```json
{
  "prompt": "<user task>",
  "jurisdiction": "IN",
  "taskType": "legal-research",
  "agentId": "summarizer",
  "enableRAG": true,
  "enableCoT": true,
  "enableCitationVerification": true,
  "enableHallucinationCheck": true,
  "maxTokens": 16384
}
```

**Fallback cascade:** Bedrock (`us-east-1`) / Gemini / OpenAI / … → **OmniRoute** last-mile when key present (skipped for `sensitivity: critical`) → AgentZero.

### 3.2a Patra Mitra & CNR (partner SDK mounts)

| Method | Path | SDK |
|---|---|---|
| * | `/api/nv/v1/sdk/patra-mitra/*` | `nyv.patraMitra.*` — see [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md) |
| * | `/api/nv/v1/sdk/cnr/*` | `nyv.cnr.*` — see [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md) |

### 3.3 Knowledge Plane (NYS federated)

| Method | Path | SDK method |
|---|---|---|
| POST | `/api/nv/knowledge/search` | `knowledge.search` |
| POST | `/api/nv/knowledge/retrieve` | `knowledge.retrieve` |
| GET | `/api/nv/knowledge/caselaw/search` | `knowledge.searchCaselaw` / `instantSearch.caselaw` (`?mode=fts\|hybrid`) |
| GET | `/api/nv/knowledge/caselaw/documents/:id` | `getCaselawDocument` |
| GET | `/api/nv/knowledge/caselaw/documents/:id/similar` | `similarCases` |
| POST | `/api/nv/knowledge/caselaw/verify-citation` | `verifyCitation` |
| GET | `/api/nv/knowledge/caselaw/stats` | `caselawStats` |
| GET | `/api/nv/knowledge/caselaw/embedding/coverage` | `caselawEmbeddingCoverage` |
| GET | `/api/nv/knowledge/statutes/search` | `searchStatutes` / `instantSearch.statutes` |
| GET | `/api/nv/knowledge/statutes/acts` | `listStatuteActs` / `instantSearch.acts` |
| POST | `/api/nv/knowledge/statutes/compare/:kind` | `compareCodes` / `compareOldToNew` / `compareNewToOld` |
| GET | `/api/nv/knowledge/statutes/embedding/coverage` | `statutesEmbeddingCoverage` |
| POST | `/api/nv/knowledge/citations/extract` | `extractCitations` |
| POST | `/api/nv/knowledge/documents/search` | `searchArchive` |
| GET | `/api/nv/knowledge/templates` | `listTemplates` |
| GET | `/api/nv/knowledge/templates/:id` | `getTemplate` |

**Caselaw resilience (2026-07-29):** Upstream may return **503 `CorpusBusyError`** while embedding backfill is heavy. Gateway now:

1. Retries transient 503/502/429 (default 2) with backoff  
2. Falls back **hybrid → FTS** automatically  
3. Returns `data.fallbackMode: "fts"` when fallback used  

Query: `?q=…&jurisdiction=IN&limit=10&mode=hybrid|fts`

**Instant Search UX (NSP):** debounce 250–300 ms; `q.length ≥ 2`; dropdown `limit` 5–10; prefer `mode=fts` for keystrokes; use `instantSearch.search` for parallel statutes+caselaw. There is **no** `/api/nv/instant-search` route. Detail: [`NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md`](./NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md).

### 3.3a Live Legal Feed & regulatory digest (2026-08)

| Method | Path | SDK |
|---|---|---|
| GET | `/api/nv/v1/sdk/legal-intelligence/feed` | `intelligence.getLegalFeed` |
| GET | `/api/nv/v1/sdk/legal-intelligence/feed/history` | `intelligence.getLegalFeedHistory` |
| POST | `/api/nv/v1/sdk/legal-intelligence/feed/generate` | `intelligence.generateLegalFeed` |
| GET | `/api/nv/intelligence/regulatory-feed` | `intelligence.getRegulatoryFeed` |

Own ingest path (RSS → S3 + `nv_regulatory_feeds` + KM RAG). Tavily sweeps only if `NYV_ENABLE_TAVILY_REG_SWEEP=1`. Empty feed = honest empty / `no_data` — do not fabricate cards. Full surface: [`NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`](./NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md).

### 3.4 Legal templates (India partner catalog)

| Method | Path | SDK |
|---|---|---|
| GET | `/api/nv/templates` | `templates.list` — **approvedOnly** default |
| GET | `/api/nv/templates/catalog` | `templates.catalog` |
| GET | `/api/nv/templates/approved` | `templates.approved` |
| GET | `/api/nv/gateway/templates` | `templates.listViaGateway` |
| GET | `/api/nv/templates/:id` | `templates.get` |
| POST | `/api/nv/templates/:id/generate` | `templates.generate` |
| GET | `/api/nv/templates/reviews/stats` | `templates.reviewStats` |
| GET | `/api/nv/templates/reviews/queue` | `templates.reviewQueue` |
| POST | `/api/nv/templates/:id/review` | `templates.submitReview` |
| POST | `/api/nv/templates/reviews/bootstrap` | `templates.bootstrapReviews` |

**MVP envelope:**

```json
{
  "success": true,
  "data": {
    "templates": [{
      "id": "…",
      "name": "…",
      "content": "…",
      "description": "…",
      "document_type": "…",
      "jurisdiction_code": "IN",
      "tags": [],
      "variables": [],
      "version": "1.0.0",
      "approval_status": "platform_curated|sme_approved",
      "partner_approved": true
    }],
    "total": 43,
    "quality": "approved",
    "provenance": "…"
  }
}
```

**Honest provenance:** India practitioner / curated drafts — **not** sealed SC/HC certified forms. Counsel remains responsible for filing-ready accuracy. SME `sme_approved` requires rubric overall ≥ 0.75.

NSP probe order (8s timeout): `/api/nv/templates` → `/api/nv/gateway/templates` → `/api/nv/templates/catalog`.

### 3.5 Legal-work

| Surface | Path prefix | SDK |
|---|---|---|
| Tasks / runs / evaluate / chat | `/api/nv/legal-work/*` | `nyv.legalWork.*` |

Requires Knowledge Plane flag + `NYS_KNOWLEDGE_BASE_URL`.

---

## 4. AI task quality contract (ecosystem)

Every partner AI request should traverse:

1. Tenant / SDK identity  
2. Consent / soft policy  
3. Safety ring (PII, guardrails)  
4. RAG / Knowledge Plane (when `enableRAG`)  
5. Queen or single-agent ring  
6. Intelligent router + provider cascade (+ OmniRoute last-mile)  
7. Citation / hallucination gates (default ON for partners as of 2026-07-29)  
8. Structured response + audit hash  

**Do:** pass `jurisdiction: "IN"`, enable RAG/CoT/citations for legal answers.  
**Don’t:** call provider APIs directly; strip governance; treat templates as court-sealed.

**Timeouts:** orchestrate up to 600s (SDK default); research ≥60–120s; caselaw search ≥45–60s.

---

## 5. Live verification (2026-07-29)

| Check | Result |
|---|---|
| Partner smoke NSP (orchestrate, research, knowledge, legal-work) | PASS |
| Templates approved catalog | PASS (~43 approved) |
| SME `POST /:id/review` | PASS |
| SDK matrix Knowledge + Orchestrate + Templates | **21/22** pre-fix; post-fix caselaw hybrid burst **8/8 PASS** (~0.9–5s, `method=hybrid_rrf`) |
| Caselaw embed loop | Active — concurrency **28**, HC windows enlarged |
| OmniRoute gate | Aligned (key ⇒ enabled unless explicitly false) |

Commands:

```bash
cd nyayavigya-platform-312
npm run partner:smoke:ec2
npm run sdk:matrix:ec2
```

Matrix artifact: `nyayavigya-platform-312/docs/audit/sdk-knowledge-orch-matrix-latest.json`

---

## 6. Environment checklist (gateway)

| Var | Role |
|---|---|
| `NYV_SDK_KEY_*` | Partner keys |
| `NYS_KNOWLEDGE_BASE_URL` | Knowledge Plane base |
| `NYS_KNOWLEDGE_API_KEY` | Machine key to NYS |
| `NYS_KNOWLEDGE_RETRIES` | Transient retries (default 2) |
| `NYV_F_NYS_KNOWLEDGE_PLANE` | Feature flag |
| `OMNIROUTE_API_KEY` | Last-mile LLM fallback |
| `NYV_OMNIROUTE_ENABLED` | Default on when key set; set `false` to disable |
| `NYV_LEGAL_INTEL_FEED` | Daily Legal Feed job (default on; set `off` to disable) |
| `NYV_LEGAL_INTEL_CRON_HOUR_UTC` | UTC hour for daily digest (default `2`) |
| `NYV_ENABLE_TAVILY_REG_SWEEP` | Ops escape hatch only (default **off**) |
| `NYV_NSP_NYM_BEST_OUTCOME` | Force max legal AI for NSP/NYM (default **on**) |
| `NYV_ALLOW_NSP_NYM_LEAN` | Permit `partnerSyncLean` for NSP/NYM (default **off**) |

**EC2-dev / local:** do **not** rotate JWT/SDK/provider keys without explicit GO (`NV-NO-KEY-ROTATION-DEV-001`).

---

## 7. Error handling

| Code | Meaning | Partner action |
|---|---|---|
| 401 | Bad/missing SDK key | Fix `X-API-Key` |
| 503 `NYS_UPSTREAM` / CorpusBusy | Knowledge plane busy | Retry 1–2×; gateway already retries + FTS fallback |
| 503 circuit open | Too many upstream failures | Back off 30s; check `/knowledge/plane/health` |
| 400 orchestrate | Missing `prompt` | Send `prompt` field |

---

## 8. Document & package map

| Asset | Path |
|---|---|
| **This integration doc** | `documents/working/Nyayavigya-platform-Integration-document-5.0.0.md` |
| **Ecosystem playbook (req/res/use cases)** | `documents/working/NSP-NYM-ECOSYSTEM-INTEGRATION-PLAYBOOK-2026-08.md` |
| **Legal intel SDK surface (5.0.7)** | `documents/working/NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md` |
| **Instant Search API (NSP)** | `documents/working/NSP-INSTANT-SEARCH-NYAYASEARCH-API-2026-07.md` |
| Platform status | `documents/working/PLATFORM-STATUS.md` |
| Integration PDF | `documents/working/Nyayavigya-platform-Integration-document-5.0.0.pdf` |
| Technical product note | `documents/working/Nyayavigya-Platform-5.0.0-Technical.md` |
| Business product note | `documents/working/Nyayavigya-Platform-5.0.0-Business.md` |
| Features registry | `nyayavigya-platform-312/FEATURES-REGISTRY.md` |
| Client SDK CHANGELOG | `nyayavigya-platform-312/packages/client-sdk/CHANGELOG.md` |

---

*Nyayavigya Platform Integration Document 5.0.0 — combined API + SDK + Knowledge Plane for Nyayasiddhi ecosystem · Updated 2026-08-03T15:30:00Z (SME HC drafting + BNSS 25 + playbook)*
