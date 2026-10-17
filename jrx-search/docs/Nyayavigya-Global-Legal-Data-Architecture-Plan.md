# Nyayavigya — Global Legal Data & Intelligence Architecture Plan
## Integrating BigLaw Bench, CourtListener, and the Indian Judgments Open Datasets (AWS) into the Nyayavigya SDK

**Prepared:** July 8, 2026
**Inputs studied:**
- Nyayavigya Platform 3.1.2 Full Final Product Note (v7.1 canonical, frozen)
- Nyayavigya Business Product Note (5 platforms + 2 partners: NSPM, JRX)
- Nyayavigya v5.0.0 Part-2 Technical Note (governed runtime: 164-agent Default registry, no-bypass safety ring, single-router rule)
- Platform Readiness & Roadmap 2026-06-17 (Auto-RAG, Bedrock, 25 wired providers)
- **Open-source projects:** `harveyai/biglaw-bench`, `freelawproject/courtlistener`, `vanga/indian-high-court-judgments`, `vanga/indian-supreme-court-judgments` — including their AWS Open Data metadata schemas
- NYS Agentic AI module (this workspace): 144 benchmark tasks, agentic work execution, AI-judge rubric grading

---

# PART 1 — STUDY OF THE FOUR OPEN-SOURCE PROJECTS & THEIR METADATA

## 1.1 Harvey BigLaw Bench (`harveyai/biglaw-bench`)

**What it is:** the professional-grade evaluation standard for legal AI — tasks mirror actual billable lawyer work, scored as *"what % of a lawyer-quality work product does the model complete?"*

| Component | Content | Value to NYV |
|---|---|---|
| **BLB-Core** | Tasks across 9 transactional categories (Corporate Strategy, Drafting, Legal Research, Due Diligence, Risk & Compliance, Negotiation Strategy, Deal Management, Transaction Structuring, Regulatory) + 7 litigation categories (Filings Analysis, Case Management, Drafting, Case Law Research, Transcript Analysis, Document Review, Trial Prep) | The task taxonomy + rubric methodology for NYV's L4/L5 evaluation layers and agent scorecards |
| **BLB-Workflows** | Composite agentic tasks — e.g., SPA Deal Points extraction across a dataset of Share Purchase Agreements | Blueprint for evaluating NYV's multi-agent DAG/swarm workflows end-to-end, not just single answers |
| **BLB-Retrieval** | Retrieval benchmarks over (a) Merger Agreements/SPAs — hundreds of pages, cross-references, defined terms; (b) Discovery Emails — high volume, thread relationships, rich metadata (sender, recipient, attachments) | Direct test harness for NyayaRAG / Auto-RAG / GraphRAG retrieval quality on exactly the document classes NSI/NSP handle |
| **Scoring model** | Positive points for meeting requirements **minus negative points for hallucinations/errors**; two axes: Answer Quality + Source Reliability | Upgrades NYV's LLM-as-Judge from 5 generic dimensions to task-specific rubric scoring with hallucination penalties |

**Metadata available:** per-task rubric criteria (points-weighted), task category, sub-task type, source documents. Public samples on GitHub; full dataset by contact with Harvey. *(Our NYS Agentic AI module already operationalizes this format: 144 tasks, 24 practice areas, per-criterion rubrics, AI-judge grading — a ready-made BLB-style engine.)*

## 1.2 CourtListener / Free Law Project (`freelawproject/courtlistener`) — USA corpus

**What it is:** the largest open US legal data platform — case law, PACER (RECAP) dockets, judges, oral arguments, citation graph — with quarterly bulk exports and a REST v4 API.

**Bulk data (PostgreSQL `COPY` CSVs + `schema.sql`, quarterly, public S3 `com-courtlistener-storage`):**

| Dataset | Schema / metadata | NYV use |
|---|---|---|
| **Courts** | Court table — every US federal + state court, hierarchy, `appeals_to` graph | US court-hierarchy metadata for citation formatting, forum analysis, NyayaTimeline procedural rules |
| **Dockets** | Millions of rows: docket number, case name, parties, federal fields (`federal_dn_case_type`, office code, judge initials, `parent_docket_id`) | Matter-linked US case tracking for NSI/JRX; litigation-risk features (forum, judge) |
| **Opinion Clusters + Opinions** | Full opinion text, precedential status, judges, `filepath_pdf_harvard` (Harvard Caselaw Access PDFs) | The US case-law corpus for RAG ingestion — the direct US counterpart of the Indian judgments buckets |
| **Citations Map** | `search_opinionscited (id, depth, cited_opinion_id, citing_opinion_id)` — which opinion cites which and how deeply | **Drop-in edge list for NyayaGraph US**: multi-hop traversal, treatment analysis, overruled-case detection |
| **Parentheticals** | Court-authored one-line case summaries | High-quality distilled snippets for retrieval reranking and citation-context display |
| **Judges + Financial Disclosures** | Judge bios, positions, 32K disclosure docs / 1.9M investments | Judge-risk dimension of Litigation Risk v2; conflict-of-interest checks |
| **Oral Arguments** | World's largest audio archive | Voice/multimodal training + hearing-prep intelligence |
| **Case Law Embeddings** | **~2TB pre-computed embeddings** (`modernbert-embed-base_finetune_512`), nightly S3 inventories, `aws s3 sync --no-sign-request` | Bootstrap US semantic search **without paying to embed the corpus ourselves** (re-embed selectively later with our Legal-BERT/ALG-04 pipeline) |
| **Related** | Harvard LIL **COLD Cases** dataset on Hugging Face | Alternative parquet-native ingestion path |

Field definitions live in the Django `models.py` files and via `OPTIONS` on the REST v4 API. Bulk files import cleanly into PostgreSQL — the same engine NYV runs.

## 1.3 Indian High Court Judgments (`vanga/indian-high-court-judgments`) — India corpus at scale

**What it is:** an AWS Open Data Registry dataset of **17.8M judgments (~1.25 TiB)** from **25 High Courts**, scraped from the eCourts portal, **synced daily** via GitHub Actions. License **CC-BY-4.0**; storage/transfer sponsored by AWS.

**S3 layout (`s3://indian-high-court-judgments/`, `--no-sign-request`):**
- `data/tar/` — judgment PDFs in tar archives, partitioned `year=/court=STATE~CODE/bench` (e.g., `27_1` = Bombay HC)
- `metadata/tar/` — raw metadata JSON
- `metadata/parquet/` — **structured metadata queryable with Athena / DuckDB / Spark / pandas**
- `metadata/parquet_case_details/court/bench/` — **mobile-API dimension table keyed by CNR** with fields the website never exposed: **acts/sections invoked, full hearing history, linked cases, documents, advocates** — including disposed-without-order cases

**Key metadata semantics:**
- Cross-source identity: `(cnr, decision_date, order_number)` — CNR (Case Number Record) is India's universal case identifier; join the per-order judgments parquet to the case-details dimension table on `cnr`
- `source = "mobile"` vs web rows; `pdf_exists` null on mobile rows (treat as unknown)
- Court codes `STATE~COURT` canonical in `court-codes.json`

## 1.4 Indian Supreme Court Judgments (`vanga/indian-supreme-court-judgments`)

**What it is:** SCI judgments **1950 → present**, ~35K English judgments (~52 GB), many with **regional-language versions**, on AWS Open Data (CC-BY-4.0).

**S3 layout (`s3://indian-supreme-court-judgments/`):** `data/pdf|tar/year=YYYY/{english,regional}/`, `metadata/{json,tar,parquet}/year=YYYY/`, V2 index files with multi-part archives.

**Parquet metadata fields:** `title, petitioner, respondent, description, judge, author_judge, citation, case_id, cnr, decision_date, disposal_nature, court, available_languages, raw_html, path, nc_display, scraped_at, year`.

Athena tutorials included; public HTTPS access per object.

## 1.5 Why these four together are the winning combination

| Layer | USA | India |
|---|---|---|
| **Case-law corpus** | CourtListener opinions + Harvard PDFs | SC (1950→) + 25 HCs (17.8M docs), daily-synced |
| **Citation graph** | CourtListener Citations Map (ready-made edges) | Built by extraction from judgment text + CNR linkage (NyayaGraph pipeline) |
| **Structured metadata** | PostgreSQL CSV dumps + REST v4 | Parquet on S3 (Athena-ready), CNR-keyed case-details dimension |
| **Embeddings** | 2TB pre-computed, free to sync | Generate via ALG-04 (Legal-BERT / Sarvam for Indic) |
| **Judges/dockets intelligence** | Judges DB + FJC IDB + financial disclosures | Hearing history, advocates, acts/sections per CNR |
| **Evaluation standard** | BigLaw Bench methodology (both jurisdictions) | Same methodology, India-authored tasks (BNS/BNSS/BSA era) |

All four are **AWS-native and free** (CC-BY-4.0 / public domain) — and NYV already runs in AWS ap-south-1. This is the raw material for FU-T004 (statute/corpus expansion) and the P3 roadmap item "GraphRAG/LightRAG corpus expansion beyond statutes (case-law graph)" — both already open items in NYV's own tracker.

---

# PART 2 — COMPLETE TARGET ARCHITECTURE

## 2.1 The seven-layer architecture with the new Legal Data Plane

```
┌────────────────────────────────────────────────────────────────────────┐
│ L7  CONSUMER SURFACES                                                  │
│     NYM · NSP · NSI · NSA · NSM · NSPM · JRX (Jurexio) · 3P apps      │
│     Customer modules: ClaWdBot · OpenBot · AutomateAI · TwinDesk ·    │
│     SkillShop  — all via NYV SDK family (Web/Node/React/RN/Enterprise) │
├────────────────────────────────────────────────────────────────────────┤
│ L6  NYV GATEWAY — /api/nv/* · no-bypass safety ring (12 stages) ·     │
│     tenant isolation · guardrails · credits · hash-chain audit         │
├────────────────────────────────────────────────────────────────────────┤
│ L5  ORCHESTRATION — NS-Queen · NS-LRM Core v9 · 22 patterns ·         │
│     107 topologies · BM25 agent selection (governed 164-agent          │
│     Default registry + jurisdiction overlays) · maker-checker · GRPO   │
├────────────────────────────────────────────────────────────────────────┤
│ L4  AGENTIC WORK & EVALUATION  ◄── NEW (NYS Agentic AI + BLB)         │
│     Benchmark task library (US + IN) · full work-product execution ·  │
│     per-criterion rubric judge (+/− scoring, hallucination penalties) │
│     · BLB-Workflows composite evals · BLB-Retrieval RAG evals          │
├────────────────────────────────────────────────────────────────────────┤
│ L3  KNOWLEDGE FABRIC — NyayaRAG/Auto-RAG · GraphRAG · NyayaGraph ·    │
│     semantic cache · 5-tier memory · citation verification (ALG-07)   │
│         ◄── NEW: US case-law graph (CourtListener citations map)      │
│         ◄── NEW: IN judgment graph (CNR-linked SC + 25 HC corpus)     │
├────────────────────────────────────────────────────────────────────────┤
│ L2  LEGAL DATA PLANE (AWS)  ◄── NEW                                   │
│     Ingestion pipelines · S3 data lake · Athena/parquet queries ·     │
│     pgvector/Qdrant indexes · nightly/quarterly sync jobs ·           │
│     NyayaWatch feed integration                                        │
├────────────────────────────────────────────────────────────────────────┤
│ L1  SOURCES (open, AWS-hosted)                                        │
│     s3://indian-high-court-judgments (17.8M docs, daily)              │
│     s3://indian-supreme-court-judgments (1950→, multilingual)         │
│     s3://com-courtlistener-storage (bulk CSVs + 2TB embeddings)       │
│     harveyai/biglaw-bench (task + rubric methodology)                 │
│     + existing: indiacode.nic.in, USC/CFR, gazettes, regulators       │
└────────────────────────────────────────────────────────────────────────┘
```

## 2.2 Legal Data Plane — AWS design (ap-south-1 primary)

```
                    ┌─ SOURCE BUCKETS (public, --no-sign-request) ─┐
                    │  indian-high-court-judgments (Mumbai-local!)  │
                    │  indian-supreme-court-judgments               │
                    │  com-courtlistener-storage (us-west-2)        │
                    └──────────────────┬────────────────────────────┘
                                       │ scheduled sync (EventBridge / cron on EC2 pre-GA)
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  NYV LEGAL DATA LAKE  s3://nyv-legal-corpus-prod/                    │
│    in/sc/…   in/hc/court=…/…   us/opinions/…   us/embeddings/…      │
│    Raw zone (tar mirrors) → Structured zone (parquet) → Index zone   │
└───────────┬──────────────────────────┬───────────────────────────────┘
            │                          │
            ▼                          ▼
   AWS Athena / DuckDB          Ingestion workers (PgJobQueue,
   (ad-hoc metadata queries,    nv-job-worker): ALG-01 Tika parse →
   corpus stats, NyayaTrail     ALG-02 OCR routing → ALG-03 legal
   e-discovery selection)       chunker → ALG-04 embeddings →
            │                   pgvector/Qdrant `nyv_caselaw_{IN|US}`
            │                          │
            ▼                          ▼
   ┌────────────────────┐    ┌──────────────────────────────┐
   │ Metadata DB tables │    │ NyayaGraph (Neo4j/AuraDB)    │
   │ nv_caselaw_in_*    │    │ US: citations-map bulk load  │
   │ nv_caselaw_us_*    │    │ IN: extracted cites + CNR    │
   │ (CNR / docket keys)│    │ linked-cases edges           │
   └────────────────────┘    └──────────────────────────────┘
```

**Design decisions (aligned with NYV's own conventions and open follow-ups):**

1. **Mirror, don't hotlink.** Sync tar/parquet prefixes into `nyv-legal-corpus-prod` (same account `789925699169`). The HC bucket syncs daily upstream; run our sync nightly (IN) and quarterly + nightly-inventory-diff (US embeddings). `aws s3 sync` is incremental by design — upstream READMEs explicitly recommend this.
2. **Parquet-first metadata.** IN metadata is already parquet; convert CourtListener CSVs to parquet on ingest. One Athena-queryable metadata lake covering both jurisdictions; Glue tables `in_hc_judgments`, `in_sc_judgments`, `in_hc_case_details`, `us_dockets`, `us_opinion_clusters`, `us_citations`.
3. **Selective full-text ingestion, exhaustive metadata ingestion.** Metadata (all 17.8M + all US dockets) is cheap and powers search/insights immediately. Full-text embedding is tiered: SC + apex-value HC benches + precedential US opinions first; long-tail on demand (query-triggered lazy ingestion with Corrective-RAG web fallback in the interim).
4. **Reuse CourtListener's 2TB embeddings** for US semantic search bootstrap behind the Qdrant/pgvector `VectorStoreAdapter`; keep our ALG-04 pipeline as the target state (re-embed hot documents with Legal-BERT; Indic content with Sarvam embeddings, per the v5 technical note).
5. **Respect the freeze + single-EC2 pre-GA posture:** Phase-0 sync jobs run as cron on the retained EC2 host; EventBridge/ECS scheduling moves in only post-GA with the deferred EKS migration. All seeders use `pg.Pool` (FU-T003: never `neon()` against RDS).
6. **Compliance:** all four sources are open-licensed (CC-BY-4.0 / public domain) — attribution strings stored per corpus row and surfaced in citation output. Data-residency: IN corpora stay in ap-south-1; US corpus mirrored to ap-south-1 (public data, no residency constraint) with optional us-east mirror post-GA.

## 2.3 Canonical unified schema (both jurisdictions)

New `nv_schema` tables (additive — no breaking changes, honoring the additive-only OpenAPI freeze):

```
nv_caselaw_documents      id · jurisdiction (IN|US) · source (sc|hc|cl) ·
                          native_id (CNR | opinion_id) · court_code · bench ·
                          title · parties (petitioner/respondent | case_name) ·
                          judges[] · author_judge · decision_date ·
                          disposal_nature/precedential_status · citation ·
                          languages[] · s3_path_pdf · s3_path_text ·
                          embedding_status · attribution · synced_at

nv_caselaw_citations      citing_doc_id · cited_doc_id · depth · treatment
                          (cites/applies/distinguishes/overrules — LLM-classified
                          for IN, depth-weighted from CL map for US)

nv_case_events            doc_id · cnr/docket_id · event_type (hearing/order/
                          filing) · event_date · detail (from IN case-details
                          dimension + US docket entries)

nv_case_participants      doc_id · role (judge/advocate/party) · name ·
                          normalized_id (→ judges DB for US)

nv_statute_case_links     statute_id (existing 305-statute table) · doc_id ·
                          section_ref (from IN acts/sections metadata +
                          extraction for US)
```

The **CNR** (India) and **docket/opinion id** (US) remain the native keys; `nv_caselaw_documents.id` is the NYV-canonical key that the rest of the platform (RAG chunks, NyayaGraph nodes, matter links) references.

---

# PART 3 — WHAT EACH NYV CAPABILITY GAINS (search, drafting, citations, insights, intelligence — US + IN)

| Capability | Today | After integration |
|---|---|---|
| **Search** | Hybrid RAG over 305 statutes + templates; Auto-RAG router live | Full-corpus legal search: 17.8M IN judgments + complete US case law; metadata-filtered (court, bench, judge, date, disposal nature, acts/sections); semantic via reused CL embeddings (US) + ALG-04 (IN); GraphRAG multi-hop over real citation edges — closes P3 "corpus expansion beyond statutes" |
| **Citations** | ALG-07 6-step verification limited to statutes + citation *format* templates | **Real citation resolution**: every case citation resolved against the corpus → [VERIFIED] with link to actual judgment PDF; treatment check via NyayaGraph (overruled/distinguished — CL citation map for US, extracted edges for IN); temporal validity from decision dates; AIR/SCC/SCR ↔ neutral-citation cross-mapping from SC metadata |
| **Drafting** | ALG-08 template + constraint drafting; 500+ templates | Drafts grounded in controlling authority: retrieval of on-point precedent per section; Maker-Checker checker verifies every authority against the corpus; BLB Drafting rubrics grade output quality per task type |
| **Research** | NyayaRAG/GraphRAG over statutes | True case-law research: "authorities interpreting BNS §103" answered from actual SC/HC judgments via `nv_statute_case_links`; US 50-state + federal survey via CL courts hierarchy; parentheticals as ranked snippets; precedent-similarity engine fed with real structure-extracted cases |
| **Insights** | Dashboards, E-Series (Morning Briefing, Portfolio Analytics…) | Judge analytics (US judges DB + IN author_judge/hearing history) · court/bench disposal-time and outcome statistics from metadata parquet (Athena) · advocate appearance analytics (IN case-details) · matter-book exposure heatmaps when NyayaAmend detects a statute change (statute→case links) |
| **Intelligence (6 world-firsts)** | Seeded/known-pattern based | Litigation Risk v2's judge-risk, forum-risk, precedent-alignment dimensions computed from **real data**; Precedent Similarity across actual corpora incl. cross-jurisdiction IN↔US mapping; Conflict Detector evidenced by real case outcomes; NyayaWatch extended with the HC daily-sync feed as a "new judgments" source alongside gazettes |
| **NyayaTools** | 8 tools, statute/template-centric | NyayaGraph gets millions of real nodes/edges; NyayaTimeline gets real hearing-history training data for duration estimates; NyayaTrail e-discovery selection can query Athena over corpus metadata; NyayaCompare can diff judgment versions (English vs regional) |
| **Evaluation & agents** | 6-layer testing pyramid, L4 generic 5-dim judge; GRPO 7-dim reward | **BLB-grade eval**: task-specific rubrics with hallucination penalties (L4↑), BLB-Retrieval harness for every RAG variant (new standing regression suite), BLB-Workflows for swarm/DAG evals, criterion-level failures → GRPO reward shaping and SLM training-data selection (feeds the Q3-2026 IN SLM and Q1-2027 US SLM training sets) |
| **Multilingual** | 47-language router | SC regional-language judgment pairs = aligned legal translation corpus for the 23 Indian-language legal terminology calibration |

---

# PART 4 — INTEGRATION OF THE NYS AGENTIC AI MODULE (this project)

As designed in the companion blueprint (`docs/NYS-AgenticAI-Nyayavigya-Integration-Blueprint.md`), the module lands as the **`agenticWork` SDK module** at `/api/nv/agentic-work/*`. The new data plane upgrades it:

1. **Task library → BLB superset.** Merge our 144 tasks with BLB-Core public samples and BLB-Workflows (SPA Deal Points) → a governed US task set; author the IN mirror set (BNS/BNSS/BSA-era) validated by the L5 HITL expert panel. Task schema gains `jurisdiction`, `blb_category`, `source_dataset` fields.
2. **Runs become corpus-grounded.** The agent's work products cite real authorities retrieved from `nyv_caselaw_{IN|US}` collections; ALG-07 verifies each citation against `nv_caselaw_documents`; prompt-level "don't fabricate" becomes pipeline-level "cannot pass unverified."
3. **The rubric judge becomes the platform's L4.** Our per-criterion pass/fail judge, extended with BLB's negative scoring (hallucination penalties) and source-reliability axis, replaces/augments `nv-llm-judge-service.ts` scoring — one judge service, configurable rubric, used by both the benchmark suite and production sampling.
4. **BLB-Retrieval as standing CI for RAG.** Register retrieval benchmark runs as validation steps: every Auto-RAG/reranker/chunker change must hold or improve BLB-Retrieval scores on Merger-Agreement and Discovery-Email sets (and an IN analogue built from HC case-details linked documents).
5. **Execution model:** PgJobQueue job (20–90s runs) + AG-UI SSE thinking-step streaming; 13-step pipeline compliance (credits, guardrails, audit) exactly as previously specified.

---

# PART 5 — AGENTIC ORCHESTRATION OVER THE NEW DATA (US + IN, all practice areas)

```
Request (any surface, jurisdiction = US | IN)
  → Safety ring stages 1–2 (tenant, guardrails/PII)
  → NS-Queen: intent (research/draft/review/filing/strategy) + complexity + domain
  → Pattern auto-select:
      research  → Auto-RAG router → NyayaRAG/GraphRAG over nyv_caselaw_{jur}
                  (multi-hop: statute → interpreting cases → treatment check)
      draft     → Plan-Execute → per-section authority retrieval → ALG-08 →
                  Maker-Checker (checker queries corpus to verify authorities)
      review    → NyayaCompare + Contract Analysis v2 + precedent-risk lookup
      strategy  → Swarm (fan-out: merits agent + judge-analytics agent +
                  forum agent + settlement agent) → Litigation Risk v2 (12-dim,
                  now data-backed) → Digital-Twin for high-stakes (HITL)
  → BM25 agent shortlist from governed registry (+ jurisdiction overlay)
  → Single-router LLM execution (cascade; Bedrock/Vertex as they activate;
    jurisdiction SLM fast-path when confidence ≥ 0.85)
  → Output gate: hallucination + ALG-07 corpus-verified citations + bias +
    jurisdiction match + HITL triggers
  → Optional: rubric evaluation (agenticWork judge) for graded surfaces
  → Hash-chain audit + credits + response envelope with ai_metadata.citations[]
    linking to actual judgment PDFs (presigned from nyv-legal-corpus-prod)
```

Practice-area coverage: the 24-area US↔IN matrix from the companion blueprint applies unchanged; every area now resolves to real corpora — e.g., IBC insolvency research hits NCLT-relevant HC/SC judgments via acts/sections metadata; US securities work hits CL opinions filtered to relevant federal courts via the courts hierarchy table.

Ecosystem delivery: **NYM** (citizen answers cite real judgments in 47 languages, with disclaimers/HITL), **NSP** (citation discovery + hearing prep on real dockets/hearing history), **NSI** (litigation risk + regulator tracking with case evidence), **NSA** (BLB-style graded practice with real-authority answer keys, moot generation from real cases), **NSM** (policy drafting with judicial-interpretation evidence; gazette→case impact), **NSPM** (compliance posture with case-law evidence packs), **JRX/Jurexio** (records exchange enriched with CNR/docket-resolved metadata, WORM + hash-chain ancestry — per the v5 note, Jurexio receives the full capability through the same one SDK surface and governance ring).

---

# PART 6 — API & SDK ADDITIONS (additive-only, per the OpenAPI freeze rule)

```
GET  /api/nv/caselaw/search            (jur, q, court, bench, judge, date range,
                                        acts/sections, disposal_nature; hybrid or
                                        metadata-only mode)
GET  /api/nv/caselaw/documents/:id     (canonical record + citation links + PDF url)
GET  /api/nv/caselaw/cnr/:cnr          (IN: full case detail — hearings, advocates,
                                        linked cases, acts/sections)
GET  /api/nv/caselaw/citations/:id     (in/out edges, treatment, depth)
POST /api/nv/caselaw/verify-citation   (citation string → resolved doc + status tag)
GET  /api/nv/caselaw/judges/:id/analytics (US: CL judges DB; IN: author_judge stats)
POST /api/nv/agentic-work/…            (tasks/runs/evaluate/scorecards — Part 4)
GET  /api/nv/corpus/status             (per-source sync freshness, doc counts,
                                        embedding coverage — feeds Readiness tab)
```

SDK v6.x additions: `client.caselaw.*`, `client.agenticWork.*`; React hooks `useCaselawSearch()`, `useCitationVerify()`, `useAgenticRun()`, `useRubricEvaluation()`. Regenerate the OpenAPI snapshot additively (the readiness roadmap already has an OpenAPI-regen item queued — batch with it).

---

# PART 7 — PHASED EXECUTION PLAN

**Phase 0 — Data lake bootstrap (2–3 weeks, freeze-compliant: no NYV core changes)**
- Provision `nyv-legal-corpus-prod` (ap-south-1, SSE-S3, lifecycle to IA/Glacier for raw tars).
- Nightly cron (retained EC2): sync IN SC + HC `metadata/parquet/` + `parquet_case_details/` (metadata first — small, high value); tar PDF sync for SC (52 GB) and priority HC benches.
- Glue/Athena tables over all parquet; validate CNR join (judgments ⋈ case_details); corpus stats notebook.
- Quarterly CourtListener bulk import into a staging Postgres (`schema.sql` + `COPY FROM`): courts, dockets, clusters, opinions, citations map, judges. Sync embeddings inventory (defer the full 2TB pull until Phase 2 US search; note the $200 transfer courtesy — donate to FLP).
- Contact Harvey for full BLB dataset access; ingest public samples now.

**Phase 1 — Canonical schema + ingestion pipeline (3–4 weeks)**
- `nv_caselaw_*` tables (Drizzle migration, additive); loaders: IN parquet → canonical; CL staging → canonical.
- PgJobQueue ingestion handlers: Tika/OCR-routed text extraction → recursive legal chunker → embeddings (Sarvam/Legal-BERT for IN; reuse CL embeddings for US) → `nyv_caselaw_{IN|US}` collections.
- NyayaGraph load: US citations map bulk edges; IN linked-cases + statute→case edges from acts/sections metadata; LLM treatment classification (batched, Tier-1 cascade) for high-traffic IN edges.
- `/api/nv/caselaw/*` routes + citation-verify wired into ALG-07.

**Phase 2 — Capability wiring (3–4 weeks)**
- Auto-RAG router: register `caselaw_{IN|US}` retrieval layers; GraphRAG over new graph; parentheticals into reranker features.
- Litigation Risk v2: judge/forum/precedent dimensions fed from analytics tables; E-Series briefings include new-judgment digests (HC daily sync → NyayaWatch source).
- NyayaTimeline: hearing-history-derived duration models; NyayaTrail: Athena-backed e-discovery selection.

**Phase 3 — Agentic work + evaluation layer (parallel with Phase 2, 3–4 weeks)**
- `agenticWork` module (Part 4): tasks/runs/evaluate, PgJobQueue + AG-UI streaming, corpus-grounded generation.
- BLB-Retrieval harness as standing validation; BLB-Workflows SPA eval against swarm/DAG execution; rubric judge as configurable L4 service; criterion failures → GRPO reward + SLM training-data selection.
- India benchmark task authoring (L5 expert-panel validated).

**Phase 4 — Surface rollout + Jurexio (2–3 weeks)**
- NSP citation-discovery + hearing-prep UI; NSA graded practice; NSI risk dashboards; NYM cited answers; NSM gazette→case impact.
- Jurexio/JRX onboarding as SDK consumer (platform registry, `nyv_live_sk_`, tier/credit config); records-exchange metadata enrichment via CNR/docket resolution.
- Post-GA: move sync jobs to EventBridge/ECS with the EKS migration; consider us-east read mirror for US corpus.

**Ongoing operations:** nightly IN sync + quarterly US bulk refresh; `corpus/status` freshness SLOs on the Readiness tab; L6 amendment-regression extended to "landmark judgment overruled" events; monthly re-embedding of hot documents with the in-house pipeline.

---

# PART 8 — RISKS & GUARDRAILS

| Risk | Mitigation |
|---|---|
| **Scale** — 17.8M IN judgments ≠ all embeddable at once | Metadata-exhaustive / full-text-tiered strategy (§2.2.3); lazy ingestion on retrieval miss; INT8 quantization in Qdrant (4× reduction, already in NYV design) |
| **OCR quality** — older HC PDFs are scans, regional scripts | ALG-02 GOT-OCR2.0 routing (already built: Devanagari/Tamil/Telugu, 85% cost reduction); `pdf_exists`-null mobile rows treated as unknown until verified |
| **Citation treatment accuracy (IN)** — no ready-made citation map | Start with high-precision extraction (explicit citation strings), LLM-classify treatment only above confidence threshold, tag the rest UNCERTAIN — consistent with ALG-07's tagging honesty |
| **Upstream drift** — bucket layouts/formats evolve (V2 index format precedent) | Pin schema versions per sync run; validate parquet schema before load; alert on drift via corpus/status |
| **License compliance** | CC-BY-4.0 attribution stored per document and emitted in `ai_metadata.citations[]`; CL data public domain; BLB full dataset only after Harvey grants access — public samples until then |
| **Freeze discipline** | Phase 0 touches zero NYV core; Phases 1+ are additive-only routes/tables/SDK modules post-GA; tracker (`Project-Tracker.md` §1) updated first, per house rules |
| **Cost** | Public-bucket egress is sponsor-paid; our storage ~1.5 TB raw + indexes; embeddings reuse avoids the largest compute cost; Athena per-query pennies on parquet; batch LLM classification on Tier-1 cascade |

---

# SUMMARY

The four open-source projects supply exactly the three ingredients Nyayavigya's own tracker says it still needs: **corpus depth** (17.8M+ Indian judgments daily-synced + the complete open US case-law record, both already sitting on AWS with structured parquet/CSV metadata), **a real citation graph** (CourtListener's citations map for the US; CNR-linked extraction for India) to make NyayaGraph, ALG-07 verification, and GraphRAG operate on real authority rather than templates, and **a professional evaluation standard** (BigLaw Bench's rubric methodology — already operationalized by our NYS Agentic AI module) to grade every agent, pattern, and RAG variant at lawyer-work quality across both jurisdictions. Layered under the existing gateway, safety ring, and SDK — additively, freeze-compliantly, and on infrastructure NYV already runs — this turns the platform from a statute-grounded reasoning engine into a **full-corpus, citation-verified, benchmark-graded legal intelligence system for India and the USA**, delivered unchanged through one SDK to all five Nyayasiddhi platforms, NSPM, and Jurexio.
