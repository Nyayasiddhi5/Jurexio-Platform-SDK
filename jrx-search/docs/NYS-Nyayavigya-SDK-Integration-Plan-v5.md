# NYS Knowledgesearch × Nyayavigya SDK v5 — Integration Plan

> Status: planning document (2026-07-08). Supersedes `NYS-AgenticAI-Nyayavigya-Integration-Blueprint.md` (which targeted platform 3.1.2). Grounded in the attached v5.0.0/v5.1.0 material: Product Note v5.0.0 Part 2 (Technical), Platform Product Note v5.0.0 (truthful snapshot), Status Report 2026-06, Roadmap 2026–2036, and the IN agent registry (v5.1.0 format-b, 164 agents).
>
> Trigger: once all NYS Knowledgesearch roadmap features reach 100%, this module merges into the Nyayavigya SDK as its **legal-intelligence / legal-knowledge layer**. NYV agents will then call our APIs for all legal knowledge questions across jurisdictions, while NYV supplies orchestration, CoT/reasoning, memory, governance, and LLM routing.

---

## 1. What the Nyayavigya v5 backbone is (study summary)

**Runtime truth (v5.1.0, locked):**

| Fact | Value |
|---|---|
| Runtime agents | 164 governed Default registry (+ per-jurisdiction overlays IN/UK/US/EU/GC/SG); 1,042-agent flat set is forensic backup only |
| Agentic patterns | 22 (P01–P22), all streamable |
| Swarm topologies | 107, each mapped to a real Queen execution mode |
| MCP tools | 502 catalogued / **67 executable** (rest return honest `not_implemented`) across 26 categories |
| LLM providers | 13 wired (4 keyed on EC2: OpenAI, Anthropic, Google, Sarvam); single-router rule NV-LLM-001 |
| DB | PostgreSQL, 199 tables (app + governance schemas), RLS tenant isolation, pgvector + HNSW in-database |
| Memory | 5-tier (working/episodic/semantic/procedural/governance) over mem0 + relational; 4-way fan-in recall, async writes |
| RAG | Multi-tier (statute/caselaw/template/private), hybrid BM25+vector, RRF fusion, GraphRAG, adaptive/corrective retrieval, retrieval pre-gate + semantic cache |
| Governance | 12-stage no-bypass safety ring (NV-ARCH-001); Gate 8 bar-council enforcement; hash-chained audit; HITL queue; GRPO feedback |
| API surface | Contract-driven, OpenAPI-frozen additive-only; canonical `X-API-Key` auth; SSE (AG-UI) streaming; per-tenant rate limits |

**Architecture invariants we must respect:**
- **NV-ARCH-001 (no-bypass safety ring):** every LLM-bearing request traverses the full 12-stage ring. Our module must either (a) be LLM-free on the hot path (retrieval/lookup — most of our surface), or (b) route any generation through the NYV router, never our own Anthropic/Bedrock client.
- **NV-LLM-001 (single router):** provider selection, circuit breakers, and the sovereign backup are NYV's job. Post-merge, our `AI_PROVIDER=bedrock` shim and Anthropic proxy become dev-only artifacts; production generation goes through the NYV intelligent router.
- **Contract freeze:** the HTTP surface is additive-only; our endpoints ship as new additive route mounts under NYV conventions (`/api/nv/...`, `{error:{code,message}}`, `X-API-Key`).
- **Registry-driven extensibility:** we integrate as registry definitions + MCP tools + RAG corpora, not by re-architecting the gateway.

**Registry mechanics (from the IN registry JSON):** agents are format-b records with ROMA levels (L1–L5), delta-prompt architecture (~800-token cached base + ~3,800-token role delta, 23 sections §0–§22), `mcpToolsAllowed`, `ragNamespaces`, SLM bindings, HITL config, Gate 8 bar-council metadata, and IronLedger audit event contracts. Tool access is declarative — an agent can only call MCP tools listed in `mcpToolsAllowed`.

---

## 2. What NYS Knowledgesearch brings (the module NYV lacks)

NYV's registry declares tools like `statute-verification`, `citation-formatter`, `legal-research`, `case-law-search` — but most of the 502 MCP tools are catalogued, not executable (67 live). **We are the deterministic, corpus-backed execute handlers for the legal-knowledge tool family**, plus the knowledge corpora themselves:

1. **Caselaw plane** — full Indian corpus (SC 1950–2025 + 25 High Courts) in RDS with weighted FTS + pgvector semantic search; live US CourtListener v4 proxy; Athena document search over the full PDF buckets (cost-capped workgroup).
2. **Statutes plane** — 1,588-row corpus: full BNS/BNSS/BSA text, official IPC→BNS mapping (with real historical IPC text), CrPC→BNSS and IEA→BSA comparators, USC provisions.
3. **Deterministic citation intelligence** — regex citation extraction (IN + US formats, zero LLM), citation checking against real sources.
4. **Retrieval-first router** (`POST /retrieve`) — deterministic answer planner: citation → statute lookup → old↔new comparison → caselaw FTS; flags `llmRequired` only for generative asks. This is exactly NYV's "RAG pre-gate: skip LLM if retrieval confidence is high."
5. **Similar-cases** — pgvector KNN (Titan v2 embeddings, 1024-dim, HNSW) with explicit labeled FTS fallback.
6. **Agentic legal work + AI-judge grading** — benchmark task library (144 tasks, 24 practice areas), rubric-based evaluation. Post-merge this becomes NYV's legal-work quality-evaluation capability (feeds GRPO reward signals).
7. **Platform surface already NYV-shaped** — MCP server (JSON-RPC 2.0, 8 tools), SSE streaming, typed SDK (`@workspace/nyv-sdk`), OpenAPI contract, usage analytics.

---

## 3. Integration architecture

### 3.1 Positioning: the Knowledge Plane

```
NYV safety ring stage 6 (memory recall + RAG assembly)
        │
        ├── nv-auto-rag-router ──► NYS retrieval plane (/retrieve, caselaw, statutes)
        │                          = grounded context, RRF-fused with NYV tiers
        │
NYV agent execution (stage 7–8, CoT/ReAct/ToT via NYV router)
        │
        └── MCP tool calls ──► NYS MCP tools (search_caselaw, get_statute,
                               check_citations, compare_old_new, similar_cases,
                               athena_search, get_judgment_pdf, agentic_work…)
```

Two integration channels, both LLM-free on our side:

- **Channel A — RAG tier:** our retrieval endpoints register as NYV RAG retrievers (`global:statutes:IN`, `global:caselaw:IN`, `global:caselaw:US` namespaces — matching the `ragNamespaces` already declared in the registry). Results fuse via NYV's RRF alongside its other tiers. Our deterministic retrieval router doubles as the pre-gate scorer.
- **Channel B — MCP tools:** our MCP server's tools are registered in the NYV MCP registry as *executable* handlers (moving `statute-verification`, `legal-research`, `citation-formatter`, `case-law-search` etc. from the 435 catalogued into the executable set). Agents gain access declaratively via `mcpToolsAllowed`.

### 3.2 Division of responsibilities after merge

| Concern | Owner |
|---|---|
| Orchestration (Queen, patterns, topologies), CoT/ReAct/ToT | NYV |
| LLM routing, providers, circuit breakers, cost ceilings | NYV (NV-LLM-001) — we delete our provider shims from the prod path |
| Memory (5-tier, mem0), session state | NYV — we stay stateless per-request |
| Tenant isolation, RLS, RBAC, audit hash chain, Gate 8, HITL | NYV — our routes mount behind the ring; our superadmin auth retires |
| Legal corpora (caselaw, statutes, mappings), FTS + vector indexes | **NYS** |
| Deterministic retrieval, citation extraction/verification, comparators | **NYS** |
| Athena full-PDF document search, judgment PDF access | **NYS** |
| Benchmark tasks + rubric grading (as evaluation service; judge LLM call goes through NYV router) | **NYS** logic, NYV model calls |
| Embeddings for our corpus | NYS batch jobs, using NYV's embedding provider config (Titan v2 / Sarvam per content language) |

### 3.3 API surface mapping (additive, NYV conventions)

| Today (NYS) | Post-merge (NYV mount) |
|---|---|
| `GET /api/caselaw/search` | `GET /api/nv/knowledge/caselaw/search` |
| `GET /api/statutes/*`, `/statutes/compare/*` | `GET /api/nv/knowledge/statutes/*` |
| `POST /api/citations/extract`, `/citations/check` | `POST /api/nv/knowledge/citations/*` |
| `POST /api/retrieve` | `POST /api/nv/knowledge/retrieve` (also wired as RAG tier + pre-gate) |
| `GET /api/caselaw/documents/:id/similar` | `GET /api/nv/knowledge/caselaw/:id/similar` |
| `POST /api/athena/search` | `POST /api/nv/knowledge/documents/search` |
| `POST /api/runs` (+ stream), `/runs/:id/evaluate` | `POST /api/nv/legal-work/*` — re-expressed as Queen jobs (EDJ pattern) instead of 20–90 s synchronous requests |
| `POST /api/mcp` (our 8 tools) | Handlers registered in NYV MCP registry (`executeMcpTool` SSoT) |

Auth: `X-API-Key` scoped tenant keys (NYV standard) replace our session-cookie superadmin gate. Errors: `{error:{code,message}}`. Streaming: AG-UI SSE event vocabulary.

### 3.4 Data-plane integration

- Our RDS caselaw DB (`nyv-caselaw-pg`) already lives in the same AWS account/region family as NYV prod — it becomes the **knowledge datastore** of the mesh. Options at merge time: (a) keep as separate DB reached only by the knowledge service (recommended: preserves our tuned FTS/HNSW indexes and ingestion pipeline, honors NYV's "microservices, no hidden coupling"), or (b) fold into the 199-table gateway DB. Recommend (a); NYV treats us as a service in the request graph.
- Tenant private corpora stay in NYV; we serve only global/public law. This keeps our plane RLS-simple (global read) and audit-light.
- Embedding models: keep English → Titan v2 (current), adopt Sarvam embeddings for Indic-language judgments when we ingest regional text (matches NYV's split).

### 3.5 Governance fit

- Our tools are deterministic and citation-grounded — ideal inputs for NYV's stage-9 citation/grounding verification: hallucination checks can verify agent-cited authorities **against our corpus via `check_citations`** (we become the verification oracle, not just a search box).
- Gate 8 (IN) prohibits IPC/CrPC/IEA references for post-July-2024 matters — our old↔new comparators (`IPC→BNS`, `CrPC→BNSS`, `IEA→BSA`) are the exact remediation tool: a blocked citation can be auto-suggested its BNS/BNSS/BSA equivalent.
- Every call we serve returns source metadata (court, date, citation, s3 path) so IronLedger audit rows can carry evidence pointers.

---

## 4. Gap list — what NYS must finish/change before merge

| # | Gap | Why |
|---|---|---|
| G1 | Complete all roadmap features to 100% (current queue #7–#37+) | User-set precondition |
| G2 | Hybrid retrieval upgrade: BM25/FTS + vector + **RRF fusion + reranking** on our own plane | Parity with NYV RAG contract; already planned in PROJECT-TRACKER §6.1 |
| G3 | Externalize LLM calls: agent drafting + AI judge must accept an injected model-call function so NYV's router can be plugged in (dev keeps Anthropic proxy) | NV-LLM-001 / NV-ARCH-001 |
| G4 | Async job mode for `POST /runs` (job-id + SSE progress) | NYV is job/stream oriented; 20–90 s sync requests don't fit the ring |
| G5 | Multi-tenant readiness: accept tenant/org context headers, per-key usage metering (our `api_usage` table already close) | NYV zero-trust hierarchy |
| G6 | MCP tool schemas: align our 8 tools' names/JSON schemas with the NYV MCP registry taxonomy (26 categories) | Channel B registration |
| G7 | Jurisdiction hard-filter parameter on every retrieval endpoint (IN/US today; UK/EU/GC/SG later) | NYV hard-filters RAG by jurisdiction |
| G8 | Contract snapshot: freeze our OpenAPI at merge, additive-only thereafter | NYV CI guardrail |
| G9 | Indic-language corpus + Sarvam embeddings (regional judgments already in owned buckets) | NYV supports 9+ Indic languages; phase 2 |

None of these block current roadmap work; G2 is already the planned post-100% program, G3–G7 are merge-shaping tasks to schedule after 100%.

---

## 5. Phased merge plan (post-100%)

- **Phase M0 — contract alignment (1–2 weeks):** OpenAPI snapshot, NYV route-naming/error/auth conventions on a compatibility mount, MCP schema alignment (G6, G8).
- **Phase M1 — knowledge plane live (Channel A+B):** register RAG namespaces + executable MCP tools in NYV dev; NYV agents answer statute/caselaw/citation questions through us; verify via NYV's UAT pack (RAG category: "citation accuracy verified against India Code" — our statutes corpus is the oracle).
- **Phase M2 — governance wiring:** citation-verification oracle in stage 9; Gate 8 old-law remediation suggestions; audit evidence pointers.
- **Phase M3 — legal-work module:** runs/evaluation as Queen jobs through the NYV router (G3, G4); rubric grades emitted as GRPO reward signals.
- **Phase M4 — scale & languages:** Indic embeddings (G9), UK/EU/SG corpora per NYV jurisdiction phases, read replicas per PROJECT-TRACKER §6.2.

Each phase passes the EC2 ship gate (PROJECT-TRACKER §4) plus NYV's own CI guardrails (frozen contract, auth header, no-bypass).

---

## 6. Risks & cautions

- **Catalog vs executable honesty:** NYV explicitly refuses fabricated tool results; our handlers must fail loud (we already do — e.g. CourtListener 502 passthrough, no silent fallbacks). Keep that discipline.
- **Version skew:** NYV docs span 3.1.2 → 5.0.0/5.1.0 with big registry changes (1,042 → 164 agents). Integrate only against the **governed v5.1.0 registry and the frozen OpenAPI snapshot**, not older material.
- **Cost ceilings:** ROMA L1/L2 agents have $0.05–$0.2 ceilings — perfect fit for our LLM-free tools; but our `agentic_work` tool is L4/L5-class and must respect NYV per-task cost ceilings via the router.
- **RLS cutover pending on NYV side (R5/P-blockers):** don't assume tenant isolation semantics are final; keep our plane global-read-only until NYV's RLS cutover lands.
- **Dual maintenance window:** until merge, our own MCP/SDK surface keeps evolving — every new endpoint should be born NYV-compatible (jurisdiction param, additive, fail-loud) to shrink M0.

---

## 7. Standing design rules (apply to all NYS work from now on)

1. Every new retrieval/knowledge endpoint takes an explicit `jurisdiction` filter.
2. No new LLM call sites without an injectable provider seam.
3. All tools deterministic-first; LLM only when `llmRequired`.
4. Fail loud, never fabricate; return source metadata on every result.
5. OpenAPI additive-only mindset starting now.
6. MCP tool design follows NYV registry taxonomy naming.
