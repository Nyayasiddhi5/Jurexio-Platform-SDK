# Nyayavigya — Architecture, Use Cases, Flows & Components

> **Updated:** 2026-09-02 UTC · **Legal / Nyayasiddhi only**  
> **Diagrams:** [`14-PLATFORM-ARCHITECTURE-DIAGRAMS.md`](./14-PLATFORM-ARCHITECTURE-DIAGRAMS.md)

---

## 1. Component inventory

### 1.1 Control plane
- **Queen orchestrator** (`nv-queen-orchestrator`) · **AdaptiveRouter** · **Capability manifest** (`capability-manifest.ts` SSoT)  
- **INTENT map** (`INTENT_CAPABILITY_MAP`) · **Agent tool bridge** (`nv-agent-tool-bridge`) · **Concurrency governor**  
- Agent registry loader (**164** Default + optional jurisdiction overlay) · **22** streamable patterns (P01–P22)  
- Safety / response-engineering pipelines · **ROMA L5** outcome tracking · **CAM 2.0**

### 1.2 Data plane
- NYV Postgres (`nyayavigya` + `nv_schema`) · Redis (`NYV_REDIS_TCP_URL`) · S3  
- NYS Postgres (`nyv_caselaw`, `nyvapp`) · embed / ingest workers on caselaw EC2  
- **Multitenant RLS** via `req.withTenant` / `req.withSdkTenant` (transaction-pinned GUC)

### 1.3 Experience plane
- Partner SDK / MCP / HTTP — prefix **`/api/nv/*`**  
- Console Legal OS (Command Centre, Legal Chat, Document AI, Instant Search, Legal Feed, CAM, ROMA, Matter Vault, registry)  
- NyayaSearch Instant Search UI · NSP / NYM / ecosystem apps

### 1.4 Governance plane
- `/api/nv5/gov/*` · `/api/nv5/compliance/*` · `/api/nv5/legal-pipeline/*`  
- CAM 2.0 · HITL (default ON non-dev) · maker-checker (flag) · audit hash chain · credit/wallet metering · PII vault  
- Live citation verification (6 jurisdictions) · data lineage · compliance evidence stores

---

## 2. Primary use cases (Legal)

| ID | Use case | Primary path | Outcome |
|---|---|---|---|
| UC-01 | Partner legal Q&A / research | `POST /api/nv/orchestrate` → Queen/RAG | Grounded answer + `riskBadge` / `auditHash` |
| UC-02 | Document intake & fields | Docparse → Patra Mitra / doc-pipeline | 58-type classify, fields, tables, summary, doc-chat |
| UC-03 | New Case CNR lookup | `/api/nv/v1/sdk/cnr/*` → NYS | `found` \| `not_found`; **`claimEcourts:false`** |
| UC-04 | Drafting (bail, BNSS apps, HC papers) | Templates + Queen + gateway draft | Practice-pattern draft (not sealed forms) |
| UC-05 | Instant Search statutes/caselaw | `nyv.instantSearch.*` → `/api/nv/knowledge/*` | Ranked hits; hybrid FTS live, semantic embed ops backfill |
| UC-06 | Live Legal Feed | `/api/nv/v1/sdk/legal-intelligence/feed*` | Own RSS → S3/RDS/RAG |
| UC-07 | SME review / GRPO signal | Legal Chat + SME rubric | Preference pairs / online EMA |
| UC-08 | Admin CAM / ROMA inspect | Console + `/api/nv/v1/sdk/cam/dashboard` | **164** agents from live registry |
| UC-09 | A2A specialist handoff | INTENT `a2a` / `handoff` | Queen → specialist plan |
| UC-10 | Matter Vault persistence | `/api/nv/matter-vault/*` | Matter-scoped docs + tenant RAG probe |
| UC-11 | Statute transition FAQ | NYS knowledge fast path | IPC/CrPC/IEA → BNS/BNSS/BSA **without LLM** |
| UC-12 | Template generate | `/api/nv/templates/:id/generate` | SME-approved / platform_curated drafts |
| UC-13 | Legal-work evaluation | `/api/nv/legal-work/*` | Federated NYS task grading (SDK key) |
| UC-14 | Good-law treatment readout | `/api/nv/knowledge/caselaw/treatment` | Honest `unknown` default — not a citator |

---

## 3. @nyv/docparse — wired capabilities

**Package:** `@nyv/docparse@0.2.1` · **Flag:** `NYV_F_DOCPARSE` (default ON non-dev)  
**Adapter:** `nv-docparse-adapter-service.ts` · **Ingest helper:** `nv-docparse-ingest-helper.ts`

| Stage | Capability |
|---|---|
| Ingest | PDF text layer · rasterise · deskew · DOCX pre-convert |
| OCR | Router + arbitrate (Tesseract native · Paddle optional) · Indic script detection |
| Layout | Lines · blocks · **`tables[]`** extraction |
| Classify | **58** Indian legal document types (near-neighbour anti-cues) |
| Extract | Anchor profiles · grammar sweep (dates, money, sections) · party resolution |
| Privacy | **PII redact before resolution** (Aadhaar/PAN patterns) |
| Output | Autofill four-state · governance report · audit chain · `docparseMeta` provenance |
| Progress | Per-page `onPage` hook for partner SSE / job pollers |

### 3.1 Document type families (58 codes)

| Family | Types (code) |
|---|---|
| **POLICE** | FIR, CHARGESHEET, CASE_DIARY, SEIZURE_MEMO, ARREST_MEMO |
| **PLEADING** | PLAINT, WRITTEN_STATEMENT, WRIT_PETITION, PIL, CRIMINAL_APPEAL, CIVIL_APPEAL, SLP, BAIL_APPLICATION, QUASHING_PETITION, REVISION, COMPLAINT_138, MACT_CLAIM, CONSUMER_COMPLAINT, EXECUTION_PETITION, INTERIM_APPLICATION, CAVEAT |
| **FAMILY** | DIVORCE_PETITION, MAINTENANCE_PETITION, DV_APPLICATION |
| **ORDER** | JUDGEMENT, ORDER, DECREE, ARBITRAL_AWARD |
| **PROCESS** | SUMMONS, WARRANT, LEGAL_NOTICE, PROCLAMATION |
| **AFFIDAVIT / AUTHORITY** | AFFIDAVIT, VAKALATNAMA, POWER_OF_ATTORNEY |
| **CORPORATE** | BOARD_RESOLUTION, PARTNERSHIP_DEED, MOA_AOA |
| **CONTRACT** | AGREEMENT |
| **PROPERTY** | SALE_DEED, AGREEMENT_TO_SELL, LEASE_DEED |
| **FINANCIAL** | CHEQUE, RETURN_MEMO, BANK_STATEMENT, DEMAND_NOTICE_SARFAESI, INVOICE |
| **IDENTITY** | AADHAAR_CARD, PAN_CARD, PASSPORT |
| **STATUTE** | ACT, ORDINANCE, NOTIFICATION |
| **BOND** | BAIL_BOND |
| **COURT_ADMIN** | CAUSE_LIST, FILING_RECEIPT |
| **MEDICAL** | MLC, POST_MORTEM |

**Wired ingest paths:** gateway documents · doc-pipeline · orchestrate doc-pipeline leaf · Patra Mitra · production-doc-processor.

**Roadmap / deferred (not documented as live):** tenant OCR benchmark UI · handwriting-dedicated UX (P2 deferred per tracker).

---

## 4. Legal platform modules (wired)

| Module | Mount / surface | Status |
|---|---|---|
| Orchestrate best-outcome | `POST /api/nv/orchestrate` (+ stream, v1 SDK) | **LIVE** — Queen + RAG + citations for NSP/NYM |
| Legal Chat | `/api/nv/legal-chat/*` | **LIVE** — JWT; partner chat uses orchestrate |
| Legal-work tasks | `/api/nv/legal-work/*` | **LIVE** — dual SDK/JWT; NYS federated |
| Gateway draft | `/api/nv/gateway/documents/draft` | **LIVE** — HC/Sessions pattern |
| Templates + BNSS 25 pack | `/api/nv/templates*` | **LIVE** — SME review ≥0.75 |
| Patra Mitra | `/api/nv/v1/sdk/patra-mitra/*` | **LIVE** |
| CNR resolve | `/api/nv/v1/sdk/cnr/*` | **LIVE** — honest Open Data posture |
| Knowledge plane | `/api/nv/knowledge/*` | **LIVE** — statutes, caselaw, templates proxy |
| Instant Search facade | SDK `nyv.instantSearch.*` | **LIVE** |
| Live Legal Feed | `/api/nv/v1/sdk/legal-intelligence/feed*` | **LIVE** |
| Matter Vault | `/api/nv/matter-vault/*` | **LIVE** |
| Regulatory feed / NyayaWatch | intelligence routes + `nv_regulatory_feeds` | **LIVE** |
| Amendment impact | NyayaAmend DB adapter | **LIVE** |
| Legal-intel overlay | Queen merge + FORCE-001/002 | **LIVE** |
| Structure attach (IRAC/Prayer) | post-LLM deterministic attach | **LIVE** |
| GoodLawPanel | caselaw treatment API | **LIVE** — phrase extraction, not graph citator |
| Legal NER | `/api/nv/intelligence/legal-ner` | **LIVE** — regex; INLegal-BERT optional |
| Contract lifecycle | service tree | **WIRED** |
| e-filing adapters | service tree | **WIRED** — not sold as live eCourts |
| Digital Twin / TwinDesk | `/api/nv/twindesk/*` | **WIRED** |

**Retrieval order (mandatory):** NYS global → tenant RAG/KB → memory tiers → LLM (`nv-agent-retrieval-policy`).

---

## 5. End-to-end flows

### 5.1 Partner orchestrate (NSP/NYM best-outcome)

```
Client SDK
  → X-API-Key + org scope + optional tenantId
  → POST /api/nv/v1/sdk/orchestrate (or /orchestrate)
  → partnerIndiaScopeMiddleware (IN lock for India SKUs)
  → AdaptiveRouter (Queen preferred for research/complex; -fast SLA path when explicit)
  → RAG / NYS knowledge plane (as needed)
  → Specialist agents from Legal registry (164)
  → Safety ring (hallucination, citation, PII)
  → Quality envelope + outcome SSE (sanitized — NV-CLIENT-OUTCOME-SANITIZE-001)
  → ROMA trackOutcome · memory write · audit hash
```

### 5.2 Document intelligence (docparse path)

```
Upload / base64
  → nv-docparse-ingest-helper (batch cap 5)
  → @nyv/docparse run(): OCR → layout → 58-type classify → extract → redact → resolve
  → Fallback chain if flag off (pdf-parse + cloud OCR heuristics)
  → fields + tables[] + autofill + governance report
  → Patra Mitra session chat OR Matter Vault ingest OR orchestrate doc-pipeline leaf
```

### 5.3 CNR resolve (honest)

```
CNR string
  → Validate format
  → NYS RDS lookup (judgments / cnr_case_details / Athena cold path)
  → Response: found | not_found | invalid | suggested
  → Fields: courtType, sourceArchive, claimEcourts:false
```

### 5.4 Console Legal Chat

```
JWT user (SME/admin allocation)
  → Session create
  → POST /api/nv/legal-chat/send → Queen orchestrate directly
  → Stream rail (16 workflow steps + quality envelope)
  → GoodLawPanel per citation · ReasoningTrailPanel
  → Optional maker-check / SME feedback → GRPO online EMA
```

### 5.5 Multitenant data access

```
Authenticated request
  → orgId / tenantId resolved (JWT or SDK context)
  → DB work via req.withTenant(async tx => …)  // SET LOCAL on pinned connection
  → RLS policies filter nv_* tenant tables (fail-closed if unbound)
  → RAG namespaces + matter memory scoped by org
```

---

## 6. AdaptiveRouter decision (conceptual)

1. Classify intent (legal research, draft, parse, handoff, …) via `analyzePrompt`.  
2. Apply partner policy (NSP/NYM → force best-outcome depth; explicit `-fast` honors SLA path).  
3. Choose path: `queen` | `specialist` | `rag` | `doc-pipeline`.  
4. Attach tools via capability bridge (**NV-MESH-001**).  
5. Enforce India jurisdiction lock for partner SKUs when required.  
6. Emit QualityEnvelope + citations + `auditHash`.

---

## 7. Data sovereignty summary

| Control | Implementation |
|---|---|
| Primary residency | AWS **ap-south-1** (India posture) |
| Partner India lock | Server-enforced `jurisdiction=IN` for NSP/NYM |
| Sovereign LLM routing | `sovereignOnly` platforms (MIN/INS) → Bedrock-first; skip direct anthropic/openai/google |
| Federated knowledge | NYS corpus queried in place — not replicated into gateway OLTP |
| Tenant isolation | Postgres RLS + scoped SDK keys + per-org memory/RAG namespaces |
| Secrets | Side-channel only; **NV-NO-KEY-ROTATION-DEV-001** on nysdev |
| AgentZero | Always-on sovereign backup provider in router cascade |

---

## 8. Non-goals for this architecture doc

- Industry packs outside Legal (`NYV_DOMAIN_PACK=legal` only).  
- Claiming sealed court forms or live eCourts automation.  
- Treating forensic **1,042**-agent archive as production load.  
- SOC 2 Type II certification (evidence only).  
- Product ₹ pricing tiers (commercial — not in this pack).

---

## 9. Related

- **Diagrams:** [`14-PLATFORM-ARCHITECTURE-DIAGRAMS.md`](./14-PLATFORM-ARCHITECTURE-DIAGRAMS.md)  
- Algorithms: [`04-ALGORITHMS-AGENTIC-OS.md`](./04-ALGORITHMS-AGENTIC-OS.md)  
- Database: [`07-FULL-DATABASE-ARCHITECTURE.md`](./07-FULL-DATABASE-ARCHITECTURE.md)  
- Governance: [`10-GOVERNANCE-AND-COMPLIANCE.md`](./10-GOVERNANCE-AND-COMPLIANCE.md)  
- FEATURES-REGISTRY: `nyayavigya-platform-312/FEATURES-REGISTRY.md`
