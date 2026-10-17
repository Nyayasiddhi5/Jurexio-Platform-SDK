# NYS Knowledgesearch — Final Product Note

**Project:** NYS Knowledgesearch (formerly NYS Agentic AI / Nyaya Knowledge Layer)
**Role in ecosystem:** Real-document legal knowledge substrate + agentic legal-work engine for the Nyayavigya (NYV) Agentic AI SDK and all Nyayasiddhi platforms (NSP, Nyayamitra, NYS-INS, NYS-ACE, NYS-MIN, Jurexio). All NYV orchestration, agents, RAG, memory, and CoT pipelines use this platform for legal intelligence and legal tasks in every jurisdiction — starting with US and India.
**Live production:** `https://nyayasearch.nyayasiddhi.online` (dashboard + `/api`, superadmin-protected)
**Last updated:** July 9, 2026 (2nd prod ship of the day: demo-readiness — RunDetail drafting workspace, template order fix, citation lawyer-syntax, caselaw PDF links)
**Companion docs:** `docs/CHANGELOG.md` (all changes) · `docs/PROJECT-TRACKER.md` (execution plan, architecture, testing/UAT, EC2 ship gates)
**Sources consolidated:** NKL Product Note & Roadmap · NKL Plan v2 · NKL Status/Governance & SDK Integration · Nyayavigya Global Legal Data Architecture Plan · NYS-AgenticAI × Nyayavigya Integration Blueprint · live codebase audit

**NYV SDK merge plan:** `docs/NYS-Nyayavigya-SDK-Integration-Plan-v5.md` — post-100%, NYS merges into the Nyayavigya SDK v5 as its knowledge plane (RAG tier + executable MCP tool handlers + citation-verification oracle); NYV supplies orchestration/CoT, LLM routing, 5-tier memory, and governance.

---

## 1. Product identity

| Field | Value |
|---|---|
| Purpose | Grounded legal knowledge + agentic work service: caselaw search, retrieval-first intelligence, citation extraction/verification, statutes corpus, grounded drafting/analysis/review/research, Legal Chat, rubric-based AI grading, streaming, MCP — over **real** legal documents, honest error states, no mocks |
| Consumers | NYV agents (via MCP tools + typed SDK), NSP lawyer modules, Nyayasiddhi frontends, external SDK integrators |
| Stack | pnpm monorepo · Node 24 · Express 5 · React 19 + Vite · PostgreSQL + Drizzle · OpenAPI-first (Zod, Orval codegen) · Anthropic Claude (dev via Replit proxy) / AWS Bedrock Converse (prod — Nova Pro today; Claude after use-case approval; Titan v2 embeddings). **Standing rule: when Claude is unavailable, use the available Bedrock models for all LLM tasks.** |
| Production infra | EC2 `nyv-caselaw-worker` (systemd `nyv-api`) + RDS Postgres `nyv-caselaw-pg` (private, pgvector + pg_trgm, weighted FTS, HNSW) in ap-south-1 · edge ALB + wildcard ACM + Route53 — same Nyayavigya infrastructure namespace; will share the NYV dashboard once developed |
| Data (live) | India: full SC corpus 1950–2026 (43,505 judgments, audited 0 gaps vs AWS Open Data) + all 25 High Courts 1950–2026 (20.44M judgments, audited) in RDS · Statutes: 38,138 rows / 851 act codes (COI 477 + BNS/BNSS/BSA/IPC/CrPC/IEA core + ~843 central Acts from India Code incl. 19 PDF-ingested acts + USC) · US: live CourtListener v4 · Dev: local 43,333-doc SC corpus |
| Error contract | Explicit typed errors; upstream failure returns 502 — no silent fallbacks |
| Auth | Prod: superadmin HMAC session; MCP Bearer token; SDK X-API-Key/Bearer ready (per-key metering planned) |
| Scale targets | 10K users at initial production launch → 1M with staged architecture/testing (see PROJECT-TRACKER.md) |

### Position in the Nyayasiddhi stack

```
NSP / Nyayamitra / NYS-INS / NYS-ACE / NYS-MIN / Jurexio   (frontends)
        │
        ▼
Nyayavigya Agentic AI SDK (agents · patterns · orchestration · RAG · memory · CoT)
        │  all legal intelligence calls → this platform (MCP tools / typed SDK)
        ▼
NYS KNOWLEDGESEARCH (this project)
  caselaw search · similar cases (pgvector) · statutes + IPC→BNS ·
  citation extract/verify · retrieval router · Legal Chat (6 modes) ·
  grounded agentic work · rubric AI judge · streaming (SSE) · MCP ·
  analytics · templates · API tester · Athena
        │
CourtListener (US live) · AWS RDS full IN corpus (SC + 25 HCs) ·
NCRB Sankalan statutes · owned S3 PDF buckets · AWS Open Data parquet
```

---

## 2. Feature status — full list

Legend: ✅ Done & verified · 🚢 Built in dev, prod ship pending · 🔄 In progress · 🔜 Planned

### 2.1 Caselaw & retrieval intelligence

| Feature | Status | Notes |
|---|---|---|
| India SC search (Postgres FTS, ranked) | ✅ | Dev: 43,333 local; Prod: full RDS corpus |
| India High Courts search (all 25 HCs) | ✅ (prod) | Weighted tsvector, court-type/year filters |
| US caselaw search (live CourtListener v4) | ✅ | Explicit 502 on upstream failure; UI surfaces the server's outage message (Task #65) |
| Judgment detail incl. HC metadata (CNR, bench, PDF link) | ✅ | |
| Citation verification (`/caselaw/verify-citation`) | ✅ | IN corpus + US CourtListener; `v.`/`vs.`/`vs` normalized to `versus` before the IN FTS query so lawyer-style case names (e.g. "X vs State of Kerala") verify instead of `not_found` (2026-07-09 prod ship) |
| Open judgment PDF link on caselaw search cards | ✅ prod (2026-07-09) | Fetch-and-open button backed by `GET /caselaw/documents/{id}/pdf-url` — works for SC (presigned) and HC (public bucket) rows, not just absolute URLs |
| View judgment PDF in-app on Caselaw Search (#87) | ✅ dev (2026-07-09) | Opens the shared in-app viewer dialog (same as Archive Search) instead of a new tab; fresh URL fetched on every open so 5-min presigned links never go stale; rides next static-build deploy to prod |
| Deterministic citation extraction (AIR/SCC/SCC OnLine/SCR/INSC + US reporters, no LLM) | ✅ | `POST /citations/extract`; 30+ unit tests; bare-year US cites fixed (Task #20) |
| Embeddings + pgvector similar cases (`method: vector`) | ✅ (prod) | Bedrock Titan v2 1024-dim, HNSW; FTS fallback labeled; full-corpus backfill running with DB checkpoints (`embed_progress` table, visible via `GET /caselaw/stats` `embedding` field); dashboard "Semantic Search Readiness" cards show per-scope progress %, complete state, and a stalled warning (#85) |
| Judgment PDF links (`GET /caselaw/documents/{id}/pdf-url`) | ✅ (prod) | Resolves per-document: SC → presigned owned-bucket URL (parquet `path` backfilled at ingest); HC → public Open Data bucket URL (HEAD-checked); absolute links passed through; UI fetch-and-open button on Caselaw Search |
| Coverage audit (`audit-coverage.mjs` on worker) | ✅ | Parquet source counts vs RDS per partition; SC 43,505/43,505 (0 gaps); HC 20.44M with 12 flagged partitions confirmed as cross-partition dedupe duplicates |
| Retrieval-first router (`POST /retrieve`) | ✅ | citation → CrPC→BNSS/IEA→BSA compare → statute → IPC↔BNS compare → case FTS; `llmRequired` flag; decisions logged |
| Plain-language CrPC→BNSS / IEA→BSA answers (`old-new-compare` intent) | ✅ | Task #37; deterministic via `compareOldToNew()`, no LLM; e2e CrPC 438 → BNSS 482, IEA 65B → BSA 63 |
| Reverse new→old answers (`new-old-compare` intent: BNSS→CrPC, BSA→IEA, BNS→IPC) | ✅ | Task #42; deterministic via `compareNewToOld()`, no LLM; e2e BNSS 482 → CrPC 438, BSA 63 → IEA 65B, BNS 318 → IPC 415/417/418/420 |
| Statutes corpus: full BNS/BNSS/BSA + IPC + CrPC 1973 + Evidence Act 1872 with official new-law mappings (2,279 rows) | ✅ dev + prod (Task #43: prod reseeded to 2,279 rows, live smoke passed) | NCRB Sankalan (new laws + mappings) + devgan.in bare acts (historical full text) |
| Hybrid statute search: FTS + pgvector semantic with RRF fusion (#95) | ✅ (prod) | `statutes.embedding vector(1024)` + resumable `embed-statutes` batch embedder (Titan v2 prod / hash dev; HNSW + ANALYZE on completion); `/statutes/search` fuses FTS + cosine KNN via RRF (k=60) with a distance cutoff (0.8 Titan / 0.5 dev hash) so no-match queries stay empty; `method` labeled `hybrid_rrf` vs `fts` — prod smoke returns `hybrid_rrf`; full statute backfill **complete** (56,209/56,209 rows embedded, HNSW index live; embedder hardened with 45s per-call timeout + retries after Bedrock socket hangs) |
| Embedding-coverage drift visibility (#112, #117) | ✅ dev + prod (shipped 2026-07-10) | `/statutes/search` + `/statutes/retrieve` return `embeddingCoverage` (`total`/`embedded`/`unembedded`/`coveragePct`, 60s-cached count) and log a warn with the fix command when rows are unembedded; every statute loader (`seed:statutes`, `seed:constitution`, both India Code ingesters, prod `load-statutes-appdb`) ends with a loud `ACTION REQUIRED → embed:statutes` warning on drift; §4 ship gate step 7a requires verifying coverage after any statute data load. Prod smoke (2026-07-10): both endpoints return live `embeddingCoverage` at 100% (56,209/56,209 embedded, unembedded 0). Ship (#117) also applied the idempotent `STATUTES_DDL` to prod `nyvapp` to add the newer act-metadata columns (`department`, `source_act_id`) the current Drizzle schema selects — they were missing on the prod table and had begun 500-ing `/statutes/{search,retrieve}` |
| **Complete India statutes corpus: Constitution of India (477 rows) + ~843 central Acts from indiacode.nic.in — 38,138 rows / 851 act codes total** | ✅ dev + prod (Task #69 HTML corpus; Task #94 added the 19 PDF-only acts incl. Income-tax Act 1961 via PDF ingest, shipped to prod via the same S3+SSM JSONL loader, smoke passed — Income-tax 783 §, FTS §4 hit) | India Code (Ministry of Law & Justice) section-level ingest with act metadata (ministry, year, act no, practice area); resumable pipeline with WAF-degradation circuit breaker + health probe; PDF-only acts handled by `ingest:indiacode-pdf` (unpdf extract + arrangement/body-scan parser, OCR fallback, full-act row for unstructured pre-1900 acts) |
| **Statutes corpus stays current: refresh mode + prod delta sync** | ✅ dev (Task #96) | `ingest:indiacode:refresh` ingests only new/failed acts (monthly cadence, or after known legislative activity); `updated_at` stamps every upsert; `export:statutes-delta --since <ISO>` + `scripts/sync-statutes-delta.mjs` push the JSONL delta to prod via content-addressed S3 + md5-verified SSM loader |
| Act-level statute browse (`GET /statutes/acts`: search, jurisdiction/practice-area filters, section counts) + Statutes page acts-browse UI | ✅ dev + prod (Task #69) | SDK `statutes.acts()` |
| **Statutes RAG: pgvector embeddings + hybrid FTS∪vector retrieval with RRF fusion (`GET /statutes/retrieve`) + similar provisions (`GET /statutes/{id}/similar`)** | ✅ dev (Task #70; prod deploy + Titan v2 backfill pending) | `embedding vector(1024)` on `statutes`, resumable `embed:statutes` batcher (`statute_embed_progress`, HNSW + ANALYZE on completion); RRF k=60 over FTS + cosine-KNN legs with `method`/per-hit rank telemetry; jurisdiction/code/practice-area filters; retrieval router step 3 + chat/draft grounding + run grounding use it |

| IPC→BNS comparator (API + side-by-side UI) | ✅ | CrPC/Evidence comparator UIs 🔄 (Task #23) |
| New→old comparator UI + API (`GET /statutes/compare/new-old`: BNS→IPC, BNSS→CrPC, BSA→IEA) | 🚢 (Task #45 implemented) | Direction swap on comparator page; deterministic via `compareNewToOld()`; full IPC text where in corpus; SDK `statutes.compareNewToOld()` |
| Comparator route regression suite (all 3 compare endpoints, both directions) | ✅ | Task #49; supertest route tests pin BNSS 482↔CrPC 438, BNS 318↔IPC 415/417/418/420, BSA 63↔IEA 65B + 404/400 paths; guards future mapping reseeds/schema changes |
| Deep links into the reverse comparator from chat + statutes browser | 🚢 (Task #48 implemented) | Chat reverse answers append a verified "Compare side-by-side" link (`/statutes/compare?from=…&section=…`); BNS/BNSS/BSA rows on the Statutes page get "See old equivalent"; chat UI renders internal markdown links as router links |
| Statute search & browse route regression suite | ✅ | Task #50; supertest tests for `/statutes/search` (FTS ranking, code/jurisdiction filters, 400 on <2-char query, limit clamping 1–50) and `/statutes` (filters, ordering, default 100/max 600 limits); fixture-token pattern runs green on empty or seeded DB |
| Acts-browse route regression suite (`/statutes/acts`) + optional `limit` (clamped 1–1000, totals unaffected) | ✅ | Task #97; supertest tests pin act search by name+code, jurisdiction + practiceArea filters, per-act section counts, total/totalSections, actName ordering, metadata passthrough, pre-filter practiceAreas facet, limit clamping, 400 paths (20 tests); fixture-token pattern runs green on empty or seeded DB |
| Forward (old→new) compare links in chat | 🚢 (Task #51 implemented) | Forward questions ("What replaced IPC 302?", "CrPC 438 under BNSS?") also append a verified "Compare side-by-side" link (IPC → `?section=…`; CrPC/IEA → `?from=…&section=…`); detection via new `detectOldNewCompareIntent()`, mapping verified via `compareIpcToBns()`/`compareOldToNew()`, never blocks the answer |
| Mixed-direction compare links in chat (one question naming both old and new sections links both ways, shared 5-link cap) | 🚢 (Task #61 implemented) | "BNSS 482 was which CrPC section, and what replaced IPC 302?" → verified links for both; forward detector skips only reverse-claimed refs; `buildCompareLink()` merges reverse + forward into one footer |
| Multi-provision compare links in chat | 🚢 (Task #57 implemented) | Questions naming several provisions ("What replaced IPC 302 and IPC 420?", "BNSS 482 and BSA 63 were which old sections?") append one verified compare link per mapped section (deduped, max 5; bulleted list when >1); unverified sections silently skipped; plural detectors `detectNewOldCompareIntents()`/`detectOldNewCompareIntents()` |
| Exact-section lookup regression suite | ✅ | Task #54; direct unit tests for `getStatuteBySection` (exact match, prefix fallback both directions, case/whitespace normalization, code scoping, null on miss) + `POST /api/retrieve` statute path resolves "IPC <sec>" deterministically without an LLM; self-contained 990xxx fixtures, green on empty or seeded DB |
| Historical IPC full text | 🔄 Task #22 | Currently official heading + repeal note (no fabricated text) |
| Athena search over judgment PDF buckets | 🚢 (Task #17 implemented) | SELECT-only, scan-capped, cost-guarded; dedicated `nyv-docs` workgroup enforces a 5 GB/query cutoff at AWS + 7-day result expiry (#31) |
| Open judgment PDFs from Athena hits (presigned URLs + Archive Search UI) | 🚢 (Task #32 implemented) | Bucket allowlist; 5-min TTL; `/archive` page |
| HC archive search — 20.4M High Court judgments (all 25 HCs) | ✅ prod (#72) | `judgments_meta_hc` Athena table; `archive=sc\|hc\|all` search param; per-hit archive badge; same 5 GB cost cap |
| On-demand PDF→text extraction (`POST /athena/extract`) | ✅ prod (#72) | Auth-gated, owned-bucket allowlist, 25 MB cap, OCR fallback for scanned judgments, cached in `archive_extracts`, sibling-bucket fallback |
| Archive doc → chat ("Summarize in chat") | ✅ prod (#72) | `from-archive` attach endpoint; deep-links to `/chat?c=<id>` with the judgment as a chat document |
| Archive doc → run drafting reference | ✅ prod (#72) | `archiveReferences` (max 3) on `POST /runs/stream`; extracted text grounds drafts with provenance; chips on New Run |
| Presign allowlist hardening (`parseAllowedS3Path`) | ✅ prod (#41) | Rejects percent-encoding, control chars, scheme confusion, lookalike buckets (exact allowlist match), traversal, wildcard/empty/oversized/non-pdf keys; `athena-presign.test.ts` (25 cases: 1 positive + 24 adversarial, presigner never called) |
| In-app PDF viewer (dialog, fresh presign per open, download/new-tab) | ✅ prod (#40) | Honest loading/error + Retry states |
| Full-corpus ingestion pipeline (parquet → RDS, resumable, deduped) | ✅ | |

### 2.2 Agentic legal work & Legal Chat

| Feature | Status | Notes |
|---|---|---|
| Benchmark task library (144 tasks, 24 practice areas, professional rubrics) | ✅ | |
| Full work-product execution (draft/analyze/review/research) | ✅ | Task or custom instruction |
| Grounding: real authorities + real statute text pre-draft (retrieval router) | ✅ | Stored per run, shown in UI; never blocks; reserved jurisdictions skip gracefully |
| AI-judge rubric grading (per-criterion pass/fail + rationale) | ✅ | Rubric snapshotted per run |
| Legal Chat workspace — 6 action modes (summary, extract, case_details, draft, intelligence, predictions) | ✅ | Multi-file upload (PDF/DOCX/TXT), history + search, per-conversation memory, brief/detailed toggle, copy + save-as-PDF; retrieval-first extract/case_details; predictions carry mandatory disclaimer |
| SSE streaming (`/runs/stream`, chat message stream) | ✅ API + UI | Anthropic + Bedrock ConverseStream; cancel + live markdown (#33/#34) |
| Chat responsiveness — stage-boundary progress across all 6 action modes | ✅ prod (#13) | Real retrieving/analyzing/formatting SSE events over the status channel (`onStage` callback + `ActionStage`, `onStage → sse.status`); `LegalChat` shows live stage labels (`STAGE_LABEL`), composer never freezes; cancel/`AbortSignal` preserved |
| Draft mode template grounding (70 seeded templates/checklists + Templates UI) | ✅ | IN 47 + US 23 across 17 practice-area categories (criminal, civil, constitutional, corporate, commercial, employment, family, property, IP, arbitration, insolvency, banking, consumer, litigation, compliance, privacy, estate); BNSS/BNS/BSA-current with old-code cross-refs, FRCP-based US litigation set; every template carries drafting notes |
| `POST /advise` grounded strategy advisory | ✅ | Retrieval router + live authorities |
| OCR for scanned PDFs (chat document upload) | ✅ prod (#14) | Falls back to OCR (`pdf-to-img` rasterize + `tesseract.js`) when embedded text <50 chars/page; 25-page cap + explicit truncation note; typed `OcrError`→422 (never silent empty); additive `ocrUsed` on `ChatDocument`; `ocr.test.ts` (4 tests). Verified live: `ocrUsed: true` with recovered text |
| Chat content search (message bodies, ranked, matched snippet) | ✅ prod (#12) | Title hits first, then content hits with ~180-char snippet |
| Mid-stream cancel + live markdown rendering (runs + chat) | ✅ prod (#33, #34) | End-to-end abort (client → SSE route → Anthropic/Bedrock stream); partial output preserved, marked Cancelled |
| RunDetail drafting workspace — TipTap WYSIWYG editor + Intelligence side-panel | ✅ prod (2026-07-09) | **Edit draft** toggle, H1–H3 / bold / italic / underline / lists / blockquote / yellow-highlight toolbar, **Copy** + **Download .md** (client-side only) over the run's work product; sticky right-rail Intelligence panel: Sections & Statutes chips (regex-extracted, link to `/statutes?q=`), Parties, Citations & References (link to `/caselaw?q=`), Case summary, Case details, Verified authorities. `Statutes.tsx` + `CaselawSearch.tsx` accept a `?q=` URL param for the deep links |
| Templates listing orders full templates before checklists | ✅ prod (2026-07-09) | `routes/templates.ts` `orderBy desc(kind)` — fixes the "only checklists" impression on the default **All** tab |
| Custom templates — create, upload, edit, delete (#74) | ✅ | "New template" markdown editor + "Upload document" (DOCX/PDF/MD/TXT → extraction with OCR fallback → editable draft) on the Templates page; category/jurisdiction/kind metadata; custom badge; seeded rows are read-only (403 on PATCH/DELETE) and reseed deletes only `is_custom=false` rows, so user templates survive every reseed |
| Run history, dashboard, analytics widgets (usage, models, score trends) | ✅ | `api_usage` middleware + `GET /analytics/usage` |

### 2.3 Jurisdictions

| Jurisdiction | Status |
|---|---|
| 🇮🇳 India (SC + 25 HCs + statutes) | ✅ Live in production |
| 🇺🇸 United States (CourtListener + USC) | ✅ Live |
| Global jurisdiction selector (persistent; coming-soon panels; ungrounded-run notice) | ✅ Live in production (Task #5 merged) |
| Reserved-jurisdiction regression net (16 API+UI tests) | ✅ (Task #6 merged) |
| Platform-wide jurisdiction segregation (task library, dashboard, templates, statutes, chat, runs, archive, comparator all scoped to the selector; `jurisdiction` on `legal_tasks` + `runs`; additive `jurisdiction` API param with 400 on unknown values) | ✅ Dev complete (Task #73; prod deploy pending) |
| GCC / UK / EU / Singapore | 🔜 Roadmap Phase 8 — after US+IN SDK-complete |

### 2.4 Platform surface & SDK

| Feature | Status | Notes |
|---|---|---|
| OpenAPI contract-first, full platform surface covered | ✅ | Spec = source of truth |
| Typed SDK v2 `@workspace/nyv-sdk` — caselaw, agenticWork, chat, statutes, retrieval, templates, intelligence modules + streaming helpers | ✅ | Async-generator SSE parsing |
| MCP server (`POST /api/mcp`, JSON-RPC 2.0, 8 tools incl. chat_action) | ✅ | Bearer MCP_TOKEN; 503 in prod without token |
| Schema-driven API tester page (from live openapi.json) | ✅ | Playwright-verified |
| Public API reference (`GET /api/openapi.json` without login) | ✅ prod (#35) | Spec public; endpoints stay auth-gated in prod |
| True statute totals (uncapped COUNT with filters) | ✅ prod (#27) | 2,279 unfiltered verified |
| Usage analytics + per-model AI tracking | ✅ | |
| Prod deploy of platform-surface features | 🚢 Task #18 implemented | |
| API keys + per-key metering/rate limits/scopes | 🔜 | Out of Task #4 scope; blocking external billing-grade SDK consumption |
| Registry publish (`@nyayasiddhi/knowledge-sdk`) | 🔜 | Via `nyv-sdk-distribution` bucket |

### 2.5 Quality, testing & operations

| Item | Status |
|---|---|
| Reserved-jurisdiction tests (10 API + 6 UI) | ✅ Merged |
| Citation-parser + retrieval-router unit tests (30 tests, registered validation step) | ✅ Merged |
| Streaming/MCP regression tests | 🚢 Task #19 implemented |
| Chat-action regression suite (6 modes, disclaimer, 400s) | ✅ prod (#15) |
| MCP input-schema drift suite (vs OpenAPI Zod) | ✅ prod (#26) |
| Ingest-window search resilience (8s timeout, retry-once, typed 503) | ✅ prod (#7; ported to prod RDS caselaw path in `rdsCaselaw.ts` 2026-07-09 — bounded `ts_rank` over ≤10K GIN candidates + capped count, fixes broad-query 25s pool timeout) |
| Template-category drift guard in seed pre-flight | ✅ prod (#47) |
| Auto-seed on dev setup (`seed:ensure` in post-merge; loud startup warning when statutes empty) | ✅ prod (#53) |
| Test-run seed-drift pre-flight (vitest globalSetup verifies the 90 GLOBAL / 54 US task split vs seed file and auto-reseeds on drift; #110 extends it to templates (IN 47 / US 23 `is_custom=false`, custom rows untouched) and core statutes per-code counts) | ✅ dev (#98, #110) |
| Empty caselaw-corpus guard (loud startup warning + explicit `message` hint on empty IN search; skipped when `CASELAW_BACKEND=rds`; hint + route passthrough pinned by regression suites, #60) | ✅ dev (#56, #60) |
| Full typecheck green across workspace | ✅ |
| Prod AI: Bedrock Converse (Nova Pro) verified e2e; Claude pending AWS approval; **Bedrock fallback is the standing rule** | ✅ |
| Redeploy pipeline (esbuild → content-addressed S3 releases + manifest → md5-verified SSM deploy + restart, `upload-deploy.mjs --deploy`; `--frontend` for verified static swap; `--scripts` for verified worker-script installs) | ✅ (overwrite-safe for API bundle, frontend tarball, and worker scripts) |
| RDS security (private, SG-only, Secrets Manager, TLS verify-full) | ✅ |
| CI automation of safety tests | ✅ prod (#8) — registered validation workflows: `api-server-tests` (full vitest), `typecheck`, `check-seeds`, `check-statutes` + existing `citation-router-tests`; all 5 pass |

---

## 3. Open work (path to 100% and beyond)

| Ref | Item | Status |
|---|---|---|
| #16–#19, #21–#23 | Streaming UI, Athena, prod ship, streaming/MCP tests, prod statutes, historical IPC, CrPC/BSA comparators | 🚢 Implemented, awaiting merge |
| #7, #8, #12–#15 | Ingest-window search resilience, CI tests, chat content search, chat responsiveness, OCR, chat-action regression tests | Proposed/queued |
| #37 | Plain-language CrPC→BNSS / IEA→BSA chat routing (`old-new-compare`) | 🚢 Implemented, awaiting merge |
| #24–#36 | Embedding scale, deploy automation, statute QA, Athena PDF links/cost caps, stream cancel/rendering, public API docs | Proposed |
| Post-100% | **Performance & "global best" program** — RAG quality (hybrid FTS+vector+rerank), retrieval benchmarks, latency/scale hardening for 10K → 1M users | Tracked in PROJECT-TRACKER.md §6 |

---

## 4. Design principles

1. **Source reliability first** (BigLaw-Bench): every assertion carries a verifiable citation; hallucination penalized; no fabricated statute or judgment text — ever (repeal notes over invented text).
2. **Benchmark-driven development**: 144-task rubric library + AI judge as the standing quality harness; retrieval benchmarks before similarity claims.
3. **Real data, honest errors**: no mocks; upstream failures are explicit 502s; fallback methods are labeled (`method: fts` vs `vector`).
4. **Retrieval-first, LLM-last**: deterministic extraction and corpus lookup before any generative call.
5. **Additive OpenAPI evolution**: spec is the contract; breaking changes only via a new version namespace.
6. **Nyayavigya alignment**: Nyayasiddhi brand guidelines throughout; same AWS infrastructure namespace; designed as the legal-intelligence layer of the NYV Agentic AI SDK; Bedrock models when Claude is unavailable.

---

## 5. Operations quick reference

- Redeploy API: `cd artifacts/api-server && node build.mjs` → `cd scripts && node upload-deploy.mjs --deploy` (content-addressed `releases/<name>-<md5>.mjs` keys + manifest.json; worker downloads the hashed key, verifies md5, atomic mv, restarts `nyv-api`, health-checks; fails loudly on mismatch). Frontend: Vite build → `tar czf /tmp/public.tgz .` from `dist/public/` → add `--frontend` (verified download → staged extract → atomic swap of `/opt/nyv/api/public`). Worker scripts (ingest/embed/audit): `--scripts` installs `/opt/nyv/api/*.mjs` from the manifest's hashed keys with md5 verification.
- Embedding backfill monitor: `node ssm-run.mjs 'tail -3 /opt/nyv/embed.log'`
- Statute embedding monitor: `node ssm-run.mjs 'tail -3 /opt/nyv/embed-statutes.log; pgrep -f embed-statutes.mjs && echo RUNNING'`; relaunch (resumable, with auto-retry wrapper): `cd /opt/nyv/api && setsid nohup bash -c 'for i in $(seq 1 60); do env NODE_ENV=production node --env-file=.env embed-statutes.mjs >> /opt/nyv/embed-statutes.log 2>&1 && break; echo "RETRY $i after failure" >> /opt/nyv/embed-statutes.log; sleep 20; done' > /dev/null 2>&1 < /dev/null &` (Bedrock can drop sockets mid-run; the embedder has a 45s per-call timeout + 4 retries, and the wrapper restarts the resumable job on process exit)
- Ingest monitor: `node ssm-run.mjs 'tail -3 /opt/nyv/ingest.log'`
- Prod statutes reseed: run bundled `seed-statutes.mjs` on worker (self-provisioning DDL)
- Dev: `pnpm --filter @workspace/api-server run dev`; seeds: `run seed`, `run seed:caselaw`, `run seed:statutes`, `run seed:templates`; `run embed:corpus`
- Statutes seed integrity: `pnpm --filter @workspace/api-server run check:statutes` — validates counts, placeholder/repeal text, key sections before any reseed
- Statutes seeder pre-flight: `seed:statutes` (dev and bundled prod seeder) runs the same integrity checks automatically and refuses to touch the DB (exit 1, offenders listed) if the seed file is corrupted — shared logic in `src/lib/statutesIntegrity.ts`
- Task & template seed integrity: `pnpm --filter @workspace/api-server run check:seeds` — validates seed-tasks.json (count, unique slugs, category slugs, instructions/deliverables/criteria) and seed-templates.json (unique keys, non-empty names/bodies); `seed` and `seed:templates` run the same pre-flight (shared `src/lib/seedIntegrity.ts`) and abort without touching the DB on failure; also enforces practice-area sync — every `CATEGORY_NAMES` slug must be used by ≥1 seed task, so orphaned categories fail loudly with names listed
- Dev DB data-state check: `pnpm --filter @workspace/api-server run check:devdata` — verification-only guard against dev-DB drift (task jurisdiction distribution vs seed file, seeded template distribution, core statute per-code counts, 100% statutes embedding coverage); prints a one-line fix command per drifted check and exits 1; the vitest pre-flight runs the same checks (shared `src/lib/devDataIntegrity.ts`) and self-heals before suites
- SSM gotchas: background jobs need `setsid`; use `node --env-file` (worker .env has CRLF + `&`)
