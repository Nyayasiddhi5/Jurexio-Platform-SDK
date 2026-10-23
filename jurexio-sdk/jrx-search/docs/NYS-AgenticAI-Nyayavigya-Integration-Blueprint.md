# NYS Agentic AI × Nyayavigya Platform 3.1.2 — Integration Blueprint

**Prepared:** July 8, 2026
**Inputs studied:** `Full-Final-Nyayavigya-ProductNote-312-April2026` (v7.1 canonical, Platform 3.1.2 FROZEN, SDK v6.0.0), plus the working NYS Agentic AI module in this workspace (benchmark task library, synchronous legal-work agent, AI-judge rubric grader, activity dashboard).

---

## PART 1 — STUDY OF THE NYAYAVIGYA DOCUMENT

### 1.1 Core Themes

1. **Sovereign Legal AI Operating System** — NYV is positioned as India's legal AI backbone: 1,042 agents (target; 1,046 live on dev-edge), 22 agentic patterns (P01–P22), 74 route files, 83 DB tables, 210+ services, targeting 120M users from AWS ap-south-1.
2. **SDK-first architecture** — the five Nyayasiddhi platforms (NYM, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN) never touch LLMs directly. Every AI call flows through `/api/nv/*` via NYV SDK v6.0.0 (frozen) with a 13-step gateway pipeline (auth → rate limit → tier gate → credit reservation → guardrails → RAG → agent select → LRM route → LLM → hallucination check → citation grounding → post-guardrails → credit deduct → hash-chain audit).
3. **Jurisdiction-native agents** — 6 jurisdictions + DEFAULT (IN, UK, EU, US, GC, SG), each with 148 specialists + 1 NS-Queen Tier-0 orchestrator, 23-section system prompts (§23 = Data Privacy & PII Redaction Charter), BM25 capability selection.
4. **Safety and verifiability as first-class citizens** — pre/post guardrails (30+ PII patterns, injection detection, 14 hard-banned keywords), 6-dimension bias detection, zero-hallucination citation verification (ALG-07, every citation tagged VERIFIED/UNVERIFIED/EXPIRED/UNCERTAIN), HITL escalation for high-risk output, tamper-evident hash-chain audit.
5. **Cost-engineered LLM orchestration** — 3-tier model cascade (80% of calls at ~$0.0005), jurisdiction SLM router, semantic cache, prefix KV cache, LLMLingua-2 compression — combined 65–75% token cost reduction (~$1.05M/month at 5M calls/day).
6. **Legal-grade quality assurance** — a 6-layer testing pyramid (L1 statute accuracy ≥98% → L6 amendment regression), GRPO 7-dimension legal reward loop, LLM-as-Judge weighted rubric (Accuracy 30% / Citation 25% / Jurisdiction 20% / Bias 15% / Actionability 10%).
7. **Discipline of a frozen release** — v3.1.2 frozen until GA (May 15, 2026), `Project-Tracker.md` §1 is the pinned-facts source of truth, hot-patches (NV-NSP-FIX-002→005) documented with open follow-ups (FU-T003→T012e).

### 1.2 Highlights (most consequential facts)

- **22 agentic patterns** at `POST /api/nv/patterns/{name}` — ReAct, CoT, ToT, Reflection, Plan+Execute, Refine, Maker-Checker, Tool-Retry, Function-Router, MCP-Chain, NyayaRAG, GraphRAG, Mem0, Semantic-Cache, HTA, Swarm (107 topologies), ACONIC, MOAt, ADaPT, Computer-Use, GRPO, Digital-Twin.
- **5 RAG variants** (Adaptive, Corrective, Self, NyayaRAG, GraphRAG) + LightRAG; hybrid retrieval 65% vector / 35% BM25 with cross-encoder reranking and a 0.85 citation-grounding gate; pgvector HNSW 3072-dim (Qdrant adapter for prod).
- **Nyaya Tools Suite (8 tools)** — NyayaGraph (knowledge graph, overruled-case detection), NyayaWatch (200+ regulatory sources), NyayaCompare (clause-level semantic diff), NyayaTemplate (500+ jurisdiction-validated templates, enforceability scoring), NyayaTimeline (limitation-period calculator, eCourts), NyayaForensic (AI-text/forgery/signature detection), NyayaTrail (privilege logs, e-discovery), NyayaAmend (gazette → affected matters → client notices).
- **6 world-first intelligence features** — Cross-Jurisdiction Conflict Detector (e.g., DPDPA-IN vs GDPR-EU consent), Amendment Impact Analyzer, Precedent Similarity Engine (structure-aware: issue 0.40 / argument 0.35 / facts 0.25), Regulatory Change Monitor, Multi-Party Secure Collaboration, Predictive Litigation Risk v2 (12-dimension Bayesian).
- **12 E-Series intelligence APIs** — Morning Briefing, Risk Scan, Research Deep-Dive, Contract Review, Compliance Check, Client Health, Hearing Prep, Invoice AI, Portfolio Analytics, Translate, Classify, Sentiment.
- **Live production**: `nyayasiddhi.online` + 10 subdomains live on AWS since 2026-04-25; single-EC2 pre-GA (EKS deferred post-GA); Replit → EC2 blue/green deploy path.
- **Known open items to respect**: agent-count drift (1,042 target vs 1,046 live), MCP tool reconciliation (502 in code vs 102 capabilities live), statute corpus expansion FU-T004 (305 → ≥500), audit-chain wiring FU-T006a, seeders off `neon()` (FU-T003).

### 1.3 Statutes & Legal Corpus (as documented)

| Area | Content |
|---|---|
| **Seeded statutes** | **305 across 6 jurisdictions** (FU-T004 target ≥500 for IN) |
| **India** | BNS 2023 (replaces IPC), BNSS 2023 (replaces CrPC), BSA 2023 (replaces Evidence Act), Constitution, CPC, IBC, IT Act, DPDPA 2023, Companies Act; 1000+ section-level provisions; terminology standard: always BNS/BNSS/BSA, never IPC/CrPC/Evidence Act |
| **USA** | US Code (USC), CFR, PACER filings, SEC, HIPAA, state court opinions; planned US SLM (Llama 3.1 8B, ≥91% accuracy, Q1 2027) |
| **UK / EU / GCC / SG** | Legislation.gov.uk, BAILII, FCA; EUR-Lex, GDPR, AI Act, ECJ; UAE Commercial, Saudi Labour, DIFC, Islamic finance; Singapore Statutes Online, PDPA, MAS, SIAC |
| **Sources pipeline** | indiacode.nic.in, SCI/eCourts NIC, Legislation.gov.uk, USC/CFR, EUR-Lex → Parse → Structure → Embed → Index (pgvector) → RAG-ready |
| **Citation formats** | AIR/SCC/SCR templates; 6-step citation verification (ALG-07) with zero hallucination tolerance |

### 1.4 Document References (cross-reference map in the product note)

- `Project-Tracker.md` §1 — **canonical pinned facts; wins on any conflict**
- `Project-Tracker-Nyayavigya-SDK-312.md` — Apr 13 sprint snapshot (superseded)
- `docs/v3.1.2/NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md` — live code-vs-deployed divergences
- `docs/v3.1.2/NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md` — schema migration matrix + FU items
- `docs/v3.1.2/completed_docs/NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md` / `NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md`
- `docs/v3.1.2/pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md`
- Key code anchors: `src/routes/nv-patterns-routes.ts`, `src/services/nyv-pattern-auto-selector.ts`, `src/data/jurisdiction-registries/Nyayavigya-Legal-registry-{IN,US,...}.json`, `src/services/nv-statute-seeding-service.ts`, `src/services/testing/nv-llm-judge-service.ts`, `src/guardrails/index.ts`

---

## PART 2 — WHAT NYS AGENTIC AI BRINGS (the module we built)

| Capability | Implementation | NYV gap it fills |
|---|---|---|
| **Benchmark task library** | 144 curated professional tasks across 24 practice areas (from Harvey's Legal Agent Benchmark), each with instructions, deliverables, data-room document references, and a 45–60-criterion professional rubric | NYV's L4 LLM-as-Judge uses a 5-dimension generic rubric; NYS-AAI adds **per-task, per-deliverable rubrics at professional-work granularity** — no equivalent exists in NYV today |
| **End-to-end agentic work execution** | Agent performs the full work product (draft/analyze/review/research) in one run, prompt-enforced against fabricated citations | A ready-made "perform complete legal work product" capability, directly compatible with NYV patterns P05/P07 |
| **AI-judge rubric grading** | Per-criterion pass/fail + rationale; score = passCount/totalCount × 100; rubric snapshotted per run for stability | Feeds NYV's GRPO 7-dimension reward and the 6-layer testing pyramid (esp. L4) with fine-grained, criterion-level signals |
| **Run history + activity dashboard** | Full audit of instruction, context, output, evaluation | Maps to NYV portfolio analytics + agent scorecards |

---

## PART 3 — INTEGRATION DESIGN: NYS AGENTIC AI AS AN NYV SDK MODULE

### 3.1 Positioning

Integrate as a new **`agenticWork` SDK module + route family**, mounted per NYV conventions:

```
/api/nv/agentic-work/*        (route file: nv-agentic-work-routes.ts, Auth)
```

Because v3.1.2 and SDK v6.0.0 are **frozen until GA (May 15, 2026)** with a no-version-bump policy, the integration lands one of two ways:

- **Track A (pre-GA, zero core change):** NYS Agentic AI runs as an **SDK consumer** — an NSP-partner-style service holding an `nyv_live_sk_` key, calling `/api/nv/patterns/*`, `/api/nv/knowledge/*`, `/api/nv/rag/*` through the standard 13-step gateway. No NYV code changes; fully compliant with the freeze.
- **Track B (post-GA, first-class module):** fold into the platform as `nv-agentic-work-routes.ts` + `nv-agentic-work-service.ts` + SDK `agenticWork` namespace + React hooks (`useAgenticTask`, `useAgenticRun`, `useRubricEvaluation`) in the v6.1.0 SDK cycle, alongside the deferred EKS migration.

### 3.2 Proposed API surface (NYV conventions: `/api/nv/` base, `{error:{code,message}}` errors, `nyv_*` keys, `?page&limit` pagination)

| Endpoint | Purpose | Maps to existing NYS-AAI |
|---|---|---|
| `GET /api/nv/agentic-work/tasks` | Benchmark task catalog (filter: jurisdiction, practiceArea, workType, search) | `GET /tasks` |
| `GET /api/nv/agentic-work/tasks/:id` | Task detail incl. rubric + document references | `GET /tasks/{id}` |
| `POST /api/nv/agentic-work/runs` | Execute a full legal work product (async job via PgJobQueue — see 3.4) | `POST /runs` |
| `GET /api/nv/agentic-work/runs/:id` | Run detail + work product + evaluation | `GET /runs/{id}` |
| `POST /api/nv/agentic-work/runs/:id/evaluate` | AI-judge rubric grading (per-criterion pass/fail + rationale) | `POST /runs/{id}/evaluate` |
| `GET /api/nv/agentic-work/scorecards` | Aggregate rubric performance by agent/jurisdiction/practice area | Dashboard summary, extended |

Request/response carry NYV's standard `ai_metadata` envelope (`trace_id`, `risk_score`, `citations[]`, `governance`).

### 3.3 Pipeline compliance (13-step gateway)

Every agentic-work run flows through the full pipeline unchanged: JWT/SDK-key auth → tier gate (Pro/Enterprise for run execution; Solo read-only catalog) → **credit reservation sized by work type** (draft/research runs are premium-tier LLM calls; see cascade note below) → guardrails pre-check (PII redaction before instructions reach the LLM) → RAG pre-retrieval (statute grounding — see 3.5) → BM25 agent selection from the jurisdiction registry → LRM/cascade routing → generation → hallucination check + **ALG-07 6-step citation verification on the finished work product** → post-guardrails (incl. the 14 hard-banned keywords and `SOFT_BANNED` legal-advice disclaimer patterns from NV-NSP-FIX-002) → credit deduction → hash-chain audit (`nv_audit_logs`; note FU-T006a must be closed for this to be automatic).

**Timeout note:** NYS-AAI runs take 20–90 s. NV-NSP-FIX-003 already raised `outbound:llm` breaker to 120 s, but synchronous HTTP is fragile at this duration — hence 3.4.

### 3.4 Execution model change: synchronous → job-based

The current NYS-AAI `POST /runs` is synchronous (20–90 s). Inside NYV this must become a **PgJobQueue job** (the platform already runs 4 queues + 6 handlers):

```
POST /api/nv/agentic-work/runs  → 202 { runId, status: "queued" }
    → PgJobQueue "analysis" queue → agentic-work handler
    → AG-UI SSE stream at /api/nv/stream (thinking steps: task decomposition,
      statute retrieval, section drafting, self-review)
    → GET /runs/:id polls status: queued → working → completed → evaluated
```

This gives the Nyayasiddhi frontends the same real-time "agent working" experience NYS-AAI already renders, via NYV's existing AG-UI event bridge.

### 3.5 Grounding upgrade: from prompt-enforced honesty to verified citations

NYS-AAI currently **prohibits fabricated pinpoint citations by prompt**. Inside NYV it upgrades to *positive* grounding:

1. Pre-generation: task instruction → NyayaRAG (IN) or hybrid RAG over the US corpus (USC/CFR/SEC/HIPAA) → retrieved sections injected as context.
2. Generation: agent drafts citing only retrieved, real provisions.
3. Post-generation: ALG-07 verification tags every citation [VERIFIED]/[UNVERIFIED]/[EXPIRED]/[UNCERTAIN]; UNVERIFIED triggers Corrective-RAG re-pass; citation-grounding gate at 0.85.
4. NyayaGraph cross-check: overruled-case detection on any case authority cited.

---

## PART 4 — CAPABILITY MAP: SEARCH, DRAFT, RESEARCH, INSIGHTS, INTELLIGENCE

How each requested capability is delivered by the combined stack:

| Capability | NYV building blocks | NYS-AAI contribution |
|---|---|---|
| **Search** | `/api/nv/knowledge` statute search, `/api/nv/filter`, hybrid RAG (65/35), ALG-05 RRF+COLIEE reranker, NyayaGraph multi-hop traversal | Task-library faceted search (practice area × work type × text) as the entry point for "find me the right legal task template" |
| **Draft** | ALG-08 Template + Constraint Grammar drafting, NyayaTemplate (500+ templates, enforceability 0–100), P07 Maker-Checker | Full free-form work-product drafting from benchmark-grade instructions; rubric grading of every draft |
| **Research** | P11 NyayaRAG, P12 GraphRAG, P16 Swarm (multi-perspective), E3 Research Deep-Dive, precedent similarity engine | Research-memo work type with question-presented/short-answer/authorities/analysis structure, graded against research rubrics |
| **Review** | NyayaCompare semantic diff, Contract Analysis v2 (147-class clauses, risk 1–5), E4 Contract Review, P04 Reflection | Review work type: markup-style commentary, missing-protection flags, market-standard deviation, proposed revisions |
| **Insights** | Intelligence Hub pages (case-risk heatmaps, outcome prediction, portfolio, client health), E-Series E1/E2/E6/E9 | Rubric-score analytics: per-practice-area and per-agent pass-rate trends — a quality dimension NYV dashboards don't yet chart |
| **Intelligence** | 6 world-first features (conflict detector, amendment impact, precedent similarity, regulatory monitor, secure collaboration, litigation risk v2) | Criterion-level failure taxonomy (which rubric criteria fail most, per jurisdiction/practice area) → feeds GRPO reward shaping and SLM training data selection |
| **Document references** | Document Module (upload → OCR → embed → namespace-isolated index), NyayaTrail classification, NyayaForensic authenticity | Each benchmark task's data-room document list; when real documents are uploaded, they attach to the run via the Document Module and the agent reasons over actual contents instead of document types |
| **Statutes** | 305 seeded (IN: BNS/BNSS/BSA/DPDPA/Constitution/IBC/IT Act…; US: USC/CFR/SEC/HIPAA), statute-version-aware semantic cache, NyayaAmend | Statute-grounded work products; rubric criteria referencing specific statutory requirements become automatically verifiable |

---

## PART 5 — AGENTIC ORCHESTRATION: USA + INDIA, ALL PRACTICE AREAS

### 5.1 Orchestration flow (NS-Queen integrated)

```
Attorney request (task or custom instruction, jurisdiction=US|IN)
    │
    ▼
NS-Queen Intent Analysis
    ├── work_type: draft | analyze | review | research   (NYS-AAI taxonomy)
    ├── complexity: simple → critical                      (drives cascade tier)
    └── practice area: 24-area taxonomy → NYV domain map
    │
    ▼
Pattern selection (NyvPatternAutoSelector, seeded with NYS-AAI mapping):
    ├── draft    → P05 Plan+Execute → ALG-08 constraint drafting → P07 Maker-Checker
    ├── analyze  → P02 CoT (simple) / P03 ToT (adversarial) / P15 HTA (enterprise matters)
    ├── review   → P04 Reflection + NyayaCompare + Contract Analysis v2
    └── research → P11 NyayaRAG (IN) / GraphRAG+hybrid RAG (US) / P16 Swarm (multi-angle)
    │
    ▼
BM25 agent selection from jurisdiction registry
    ├── IN: Nyayavigya-Legal-registry-IN.json (148 specialists + NS-Queen)
    ├── US: Nyayavigya-Legal-registry-US.json (148 specialists + NS-Queen)
    └── agent id format: in-contract-specialist / us-ip-rights-analyst
    │
    ▼
Execution (A2A / MCP / BMAD protocols; DAG orchestration for multi-deliverable tasks)
    ├── RAG statute grounding (jurisdiction corpus)
    ├── PII vault, guardrails, HITL escalation (risk > 70)
    └── AG-UI SSE thinking-step stream to the client
    │
    ▼
Work product → ALG-07 citation verification → rubric evaluation (NYS-AAI judge)
    │
    ▼
GRPO feedback: rubric criterion results mapped onto the 7-dimension legal reward
    (legal accuracy, citation quality, coherence, bias absence,
     jurisdiction compliance, comprehensiveness, user satisfaction)
    │
    ▼
Hash-chain audit + credit deduction + scorecard update
```

### 5.2 Practice-area coverage matrix

The NYS-AAI 24-area taxonomy applies to both jurisdictions; each area routes to the matching registry specialists and statute corpus:

| NYS-AAI practice area (24) | US grounding | India grounding |
|---|---|---|
| Mergers & Acquisitions | DGCL, SEC, HSR | Companies Act 2013, SEBI, CCI |
| Antitrust & Competition | Sherman/Clayton, FTC, HSR | Competition Act 2002, CCI |
| Capital Markets | Securities Act '33/'34, SEC | SEBI Act, ICDR, LODR |
| Banking & Finance | Dodd-Frank, OCC, UCC Art. 9 | RBI Act, Banking Regulation Act, SARFAESI |
| Bankruptcy & Restructuring | Bankruptcy Code (Ch. 7/11) | IBC 2016, NCLT |
| Litigation & Dispute Resolution | FRCP, state rules, PACER | CPC, BNSS 2023, eCourts |
| Arbitration & Int'l Disputes | FAA, NY Convention | Arbitration & Conciliation Act 1996 |
| White Collar & Investigations | FCPA, DOJ/SEC enforcement | BNS 2023, PMLA, CBI/ED |
| Employment & Labor | FLSA, Title VII, NLRA | Industrial Relations Code, Shops Acts |
| Intellectual Property | USPTO, Lanham, Copyright Act | Patents Act 1970, Trade Marks Act 1999 |
| Data Privacy & Cybersecurity | CCPA/CPRA, HIPAA, state laws | DPDPA 2023, IT Act 2000 |
| Tax | IRC, Treasury Regs | Income-tax Act 1961, GST Acts |
| Real Estate | State recording acts, RESPA | RERA 2016, Transfer of Property Act |
| Corporate Governance | DGCL, SOX, listing rules | Companies Act 2013, SEBI LODR |
| Healthcare & Life Sciences | FDA, HIPAA, Stark/AKS | Drugs & Cosmetics Act, CDSCO |
| Energy & Natural Resources | FERC, EPA | Electricity Act 2003, MMDR |
| Environmental & ESG | NEPA, CERCLA, SEC climate | EPA 1986, NGT Act, BRSR |
| Funds & Asset Management | Investment Advisers/Company Acts | SEBI AIF/MF Regulations |
| Structured Finance | UCC, Reg AB | RBI Securitisation Directions |
| Insurance | State insurance codes | Insurance Act 1938, IRDAI |
| Immigration | INA, USCIS | Citizenship Act, FRRO |
| International Trade & Sanctions | OFAC, EAR, ITAR | FTDR Act, DGFT, FEMA |
| Emerging Companies & VC | Reg D, SAFE conventions | DPIIT, SEBI ICDR, FEMA NDI |
| Trusts, Estates & Private Client | UPC, state trust codes | Indian Succession Act, Hindu Succession Act |

*(Cross-jurisdiction matters — e.g., a US–India data-transfer agreement — additionally invoke the Cross-Jurisdiction Conflict Detector, which already seeds the DPDPA-vs-GDPR pattern and extends naturally to DPDPA-vs-CCPA.)*

### 5.3 Benchmark expansion for India

The current 144 tasks are US-benchmark-derived. For IN parity: clone the task schema, author IN equivalents per practice area grounded in BNS/BNSS/BSA-era terminology (the platform mandate: never IPC/CrPC/Evidence Act), validate rubrics with the L5 HITL expert panel (5 senior lawyers per jurisdiction), and seed via the statute-seeding pipeline. This directly supports FU-T004's IN corpus expansion and gives NYS-ACE graded practice material.

---

## PART 6 — ECOSYSTEM SUPPORT: FIVE NYAYASIDDHI PLATFORMS + JUREXIO

| Consumer | How the agentic-work module serves it |
|---|---|
| **Nyayamitra (NYM)** — citizens | Simplified work types only (explain/summarize derivatives of `analyze`); mandatory disclaimers via SOFT_BANNED pattern; HITL gate on anything approaching formal notices; 47-language output via language router; WhatsApp delivery of finished summaries |
| **Nyayasiddhi Professional (NYS-PRO)** — lawyers | The full module: task library, draft/analyze/review/research runs, rubric self-grading before client delivery, NyayaTemplate integration for jurisdiction-validated first drafts |
| **Nyayasiddhi Institutional (NYS-INS)** — firms | Matter-scoped runs (namespace isolation Global/Org/User/Matter), RLS-scoped run history, firm-level rubric scorecards as an associate-work-quality analytic, portfolio integration (E9) |
| **Nyayasiddhi Academy (NYS-ACE)** — students | **Strongest fit**: benchmark tasks become graded practice exercises — student drafts, AI judge grades per-criterion with rationales, score trends feed certification. The rubric engine is precisely the "AI-graded practice" the platform promises |
| **Nyayasiddhi Ministry (NYS-MIN)** — government | Policy-drafting and regulatory-analysis work types; NyayaWatch/NyayaAmend hooks so gazette changes trigger re-analysis of affected work products |
| **Jurexio** | Not referenced anywhere in the 3.1.2 product note — treated here as a **sixth SDK consumer**. Onboard exactly like an NSP platform: platform registry entry (`/api/nv/platforms`), `X-NYV-Platform: jurexio` header, own `nyv_live_sk_` key, tier/credit configuration, white-label config if client-facing. No special-casing needed — the SDK-consumer model is jurisdiction- and product-agnostic by design. If Jurexio is US-market-facing, it becomes the natural home for the US benchmark library and US-jurisdiction orchestration. |

---

## PART 7 — PHASED ROLLOUT & OPEN RISKS

### Phase plan

1. **Phase 0 (now, pre-GA — freeze-compliant):** NYS-AAI runs standalone as SDK consumer (Track A). No NYV core changes. Validate rubric-grading quality against NYV's L4 judge on overlapping outputs.
2. **Phase 1 (post-GA, SDK v6.1.0):** `nv-agentic-work-routes.ts` + service + PgJobQueue handler + AG-UI streaming + SDK `agenticWork` module + React hooks. Task catalog seeded via `pg.Pool` seeders (respect FU-T003 — do **not** use `neon()`).
3. **Phase 2:** ALG-07 citation verification + NyayaRAG grounding wired into run generation; rubric results mapped into GRPO reward; scorecards in the Intelligence Hub.
4. **Phase 3:** India benchmark authoring (L5 expert-validated), NYS-ACE graded-practice product launch, Jurexio onboarding, cross-jurisdiction task support with conflict-detector integration.

### Risks / cautions from the document itself

- **Version freeze:** nothing ships into 3.1.2 core before May 15, 2026 GA — Track A is the only pre-GA path.
- **Long-run timeouts:** 60→120 s breaker helps, but job-queue conversion (3.4) is mandatory before platform-scale traffic.
- **Seeder trap:** 11 of 12 existing seed scripts break against RDS (`neon()` hostname munging) — new task seeders must use `pg.Pool` from day one.
- **Audit completeness:** hash-chain auto-write into `/api/nv/orchestrate` is not yet wired (FU-T006a); agentic-work runs must not assume audit logging exists until it closes.
- **Corpus depth:** 305 statutes is thin for benchmark-grade grounding; FU-T004 (≥500 IN) and an equivalent US expansion should precede claims of "verified citation" coverage in those areas.
- **Naming discipline:** all keys `nyv_*` (never `nv_*`), base path `/api/nv/` (never `/api/nyv/`), `Math.random()` banned — use `secureRandom()`.

---

## SUMMARY

NYS Agentic AI plugs into Nyayavigya as the **execution-and-quality layer for complete legal work products**: NYV supplies jurisdiction agents, patterns, RAG/statute grounding, guardrails, billing, and audit; NYS-AAI supplies the benchmark task library, the full-work-product execution model, and — its most differentiated asset — **professional per-task rubric grading**, which upgrades NYV's generic 5-dimension judge into criterion-level quality measurement that feeds GRPO training, agent scorecards, Academy graded practice, and firm-level quality analytics across US and India in all 24 practice areas, delivered to all five Nyayasiddhi platforms and Jurexio through the standard SDK-consumer model.
