# NYV platform architecture audit — six components (2026-08-17)

> **Method:** every claim below is read from source or measured on the live host. Nothing
> is inferred from documentation. `WIRED` = reachable at runtime with a call site;
> `DEAD` = implemented but no caller.
> **Evidence:** live RDS via master credential (SSM `rds-optimization-audit`, `rds-audit-2`);
> source audits with `file:line` citations.

---

## 2. LLM fallback ladder — best → cheapest

Composition is two-stage: `defaultSequenceFor` builds a curated ladder
(`default-sequences.ts:78`), then `applyRoutingPolicy` **prepends** lead ids
(`nv-llm-routing-policy.ts:404-548`). Bedrock-first is default
(`isBedrockFirstPolicy()`, `:263-268`).

### Effective order for a legal task (enterprise tier)

| # | model | provider | in $/1M | out $/1M | legalQuality | speed |
|---|---|---|---:|---:|---:|---:|
| 1 | `global.anthropic.claude-sonnet-5` | bedrock | 3 | 15 | **100** | 70 |
| 2 | `global.anthropic.claude-sonnet-4-6` | bedrock | 3 | 15 | 96 | 78 |
| 3 | `global.anthropic.claude-haiku-4-5` | bedrock | 1 | 5 | 88 | 92 |
| 4 | `us.anthropic.claude-opus-5` | bedrock | 5 | 25 | **100** | 52 |
| 5–7 | Opus 4.8 / 4.7 / 4.6 | bedrock | 5 | 25 | 99–100 | 54–60 |
| 8 | `deepseek.v3.2` | bedrock | **0.27** | **1.1** | 96 | 82 |
| 12 | `qwen.qwen3-vl-235b` | bedrock | **0.22** | **0.88** | 94 | 76 |
| 16 | `google.gemma-3-27b-it` | bedrock | 0.2 | 0.6 | 84 | 88 |
| 20 | `global.amazon.nova-2-lite` | bedrock | **0.06** | **0.24** | 78 | 96 |
| 21 | `gemini-3-1-pro-preview` | google | 1.5 | 12 | 96 | 62 |
| 22 | `gemini-3.7-flash` | google | 0.3 | 2.5 | 93 | **94** |
| 24 | `gemini-3-1-flash-lite` | google | **0.075** | **0.6** | 82 | **98** |
| 27 | `@preset/nyv` | openrouter | 0 | 0 | 88 | 80 |
| 31–34 | `:free` models | openrouter | 0 | 0 | 70–84 | 68–92 |
| 36 | **`agentzero`** | terminal | 0 | 0 | 55 | 99 |

**Cost-effectiveness sweet spots:** `deepseek.v3.2` (legalQuality **96** at 0.27/1.1 — 11×
cheaper than Sonnet-5 for 4 points of quality) and `gemini-3.7-flash` (93 quality, speed
94, 0.3/2.5). These are *below* seven Opus/Sonnet rungs in the current ladder, which is
why blended cost measured badly.

**Per-tier / per-task variants:** drafting and litigation-strategy put Opus **first**
(`:341-345`); summarisation/classification/extraction lead with Nova-fast (`:325-339`);
`IN` + legal-heavy uses `INDIC_LEGAL` (38 ids, `default-sequences.ts:179-219`); MIN/INS
platforms strip direct anthropic/openai/google (`:528-530`).

**Terminal fallback:** `agentzero` — always forced last (`:541-546`) and explicitly invoked
after full cascade failure (`llm-orchestrator.ts:1486`, `finishReason: 'agentzero_fallback'`).

**Hedging: ON, 2500 ms** (`llm-orchestrator.ts:132-139`), fires with ≥2 eligible models.
**Loser is cancelled** (per-branch `AbortController` :1132, aborted on win :1178) and its
spend is metered as waste (:1214). This was the old NV-HEDGE-WASTE-001 defect — now correct.

### Dead rungs to fix

| id | cited at | issue |
|---|---|---|
| `anthropic/claude-sonnet-4-6` | `default-sequences.ts:210`, `policy:145,174` | **no catalog entry, no alias** — silently dropped |
| `omniroute/auto` | `policy:497` | catalog only has `/auto/{reliable,cheap,free}` |
| `sarvam-105b`, `sarvam-m` | `default-sequences.ts:207-208` | in catalog but dropped without `SARVAM_API_KEY` (availability, not dead) |

A boot validator for exactly this exists — `nv-cascade-validator.ts:100`
`validateCascadeModelIds()` — worth wiring into CI.

---

## 3. RAG orchestration — 5 levels, 7 layers, 3 gated off by default

| layer | queries | default reachable? | gate |
|---|---|---|---|
| `unified-base` | knowledge_chunks + primary/SME namespaces, RRF-fused | **YES** | ungated (`nv-auto-rag-router.ts:601`) |
| `nys_global` | NYS `/retrieve` → statutes → caselaw hybrid | **YES** (non-dev) | flag `nysKnowledgePlane` + NYS base URL |
| `lightrag` | `rag.lightrag` mode `mix` | **NO** | tier ≥ mitra **and** intent ∈ {statute_research, general} |
| `adaptive` | `rag.adaptive` | **NO** | tier ≥ mitra |
| `corrective` | `rag.corrective` | **NO** | only when adaptive returns 0 **and** base < 3 docs |
| `graphrag` | `rag.graph` | **NO** | tier ≥ enterprise **and** precedent/comparative intent |
| `re-retrieval` | one extra base + NYS re-query | **YES** (non-dev) | confidence < 0.55, kept only if confidence improves |
| `rerank` | `nvLegalRerankerService.rerankLegal` | **YES** if neural provider present | flag `ragNeuralRerank` |

Extras race under `NYV_AUTO_RAG_EXTRAS_DEADLINE_MS` = **2500 ms** (`:618-621`).

**Status of the specific features:**

| feature | verdict |
|---|---|
| `rag.corrective` | **WIRED**, very narrow trigger |
| `rag.self` | **leaf DEAD** (no `invoke`), but the **service is WIRED** by direct import — `nv-client.ts:1437` `runSelfRAGLoop`, gated tier ∈ {pro,elite,government} + task ∈ {analysis,research,contract-review} |
| **MMR** | **DEAD** — `applyMMR` (`nv-legal-reranker-service.ts:152`) is only called by `rerankResults`, which has **zero callers**. Auto-RAG calls `rerankLegal`, which never applies MMR |
| neural rerank | **WIRED**, provider-conditional |
| LightRAG | **WIRED**, mitra+ and intent-gated |
| `rag.reranker` leaf | **DEAD as leaf**; service reached directly |

**NYS `llmRequired` IS consumed** (`:669-673`) and its deterministic answer suppresses the
LLM-costing re-retrieval (`:771`) — but the router **never returns early**; the caller must
check `deterministic.answer` (documented at `:118-122`). That is a real cost leak on any
caller that ignores it.

**Budgets** (`nv-context-budgets.ts`): topK 4→10 by complexity, chunk cap 900→1,800 chars,
total 3,600→18,000; **partner floor** raises topK to ≥16 and total to ≥20,000 (`:121-137`).
Caps apply **only if the caller passes them** — omission is unbounded (`:96-99`).

---

## 4. Memory — 5 tiers exist; only 1 runs on a default request

| level | store | verdict |
|---|---|---|
| `memory.tiered.recall/store` | **`nv_schema.memory_entries`** (durable) | **WIRED**, all tiers |
| `memory.mem0.*` | in-process Maps + `nv_schema.mem0_memories` | **WIRED**, mitra+, **only when `memorySources === 'full'`** |
| `memory.5tier.episodic` | in-process `l1EpisodicBuffer` — **not persisted** | **WIRED**, enterprise+, full only |
| 5-tier durable (matter/client/jurisdictional/precedent) | `nvMatterMemory`, `nvClientMemory`, `nvJurisdictionalMemory`, `nvPrecedentMemory` | **WIRED via REST only** — no capability leaf; matter+episodic also written from `nv-client.ts:1687` |
| `memory.social.context` | `nv_schema.nv_social_memory` | **WIRED**, mitra+, full only |
| graph memory | **in-process Maps only, no DB** | service **WIRED** (`nv-client.ts:807,1669`); leaf `memory.graph.add` **DEAD** |
| `memory.mem0.consolidate` | — | **DEAD** (declared, never invoked) |
| `memory.project.store` | in-process | **DEAD** |
| `TieredMemoryStorageService` (hot/warm/cold) | in-process | **DEAD** — barrel re-export only |
| `NvMemoryManager` LRU | in-process | **effectively dead** — only the no-`sources` fallback path, and both real callers always pass `sources` |
| `NyvMemoryCompiler` | mem0 payloads | **WIRED** indirectly via mem0 |

**The critical finding:** `memorySources === 'full'` only occurs for complex/very_complex
or the partner floor (`nv-context-budgets.ts:84,98,134`). **On a simple or moderate
request, the fan-in queries `memory.tiered.recall` alone** — one of five tiers. And three
of the "5 tiers" are in-process only, so they do not survive a restart.

`nv-memory-fan-in.ts` queries nothing itself — it executes whatever `ctx.sources[]` the
caller supplies (`:52,196-198`).

---

## 5. Caching + RDS optimisation

### Caching

| item | value |
|---|---|
| Tiers | hot 1,000 / warm 5,000 / cold 20,000, LRU with demotion (`lm-cache-service.ts:205-207`) |
| TTLs | 5 min / 30 min / 24 h idle; absolute max age 24 h |
| Exact-key cache | **ON by default**, pre-warmed with 8 legal entries |
| **Semantic serve** | **OFF by default** — needs `enableSemanticMatching` + flag `lmcacheSemanticEmbed` + tenant-pinned namespace |
| Semantic threshold | **0.94** to serve; 0.88 counted-but-never-served. (The old 0.85 field is legacy and unused on the serve path — the cross-hit risk that invalidated the v1 benchmark is already mitigated) |
| Key | `<ns>::c=<corpusVersion>::<normalized user turn>` — corpus-versioned, so a corpus bump invalidates cleanly |
| Redis backend | `LMCACHE_SHARED_BACKEND=redis`, prefix `nv:lmcache:` |
| Live call sites | specialist `nv-client.ts:1099/1895`; Queen `nv-queen-orchestrator.ts:4621/4894` |
| **Provider-side prompt caching** | **ABSENT.** No `cache_control`, no `cachedContent` API field, no `anthropic-beta` header anywhere in `src/` |

Provider prompt caching is the single largest untapped cost lever: our system prompts are
1.2k–8.6k tokens and are re-sent in full on every request.

### RDS — live measurements

| setting | value | assessment |
|---|---|---|
| `max_connections` | **1,702** | vs app pool 40 — enormous headroom (13 in use) |
| `shared_buffers` | 495,322 × 8 kB ≈ **3.8 GB** | correct for r7g.large (16 GB) |
| `effective_cache_size` | 990,645 × 8 kB ≈ **7.6 GB** | reasonable |
| `work_mem` | **4 MB** | **low** for our ranking/sort queries |
| `random_page_cost` | **4** | **wrong for gp3 SSD** — should be ~1.1; this biases the planner *away* from index scans |
| `default_statistics_target` | 100 | fine |
| `pg_stat_statements` | loaded | good — query-level analysis available |
| Buffer cache hit ratio | **100.00%** | excellent |
| Dead tuples | **0 rows over threshold** | autovacuum healthy |

**Extensions:** `vector 0.8.0`, `pg_trgm`, `pgcrypto`, `uuid-ossp`.

**pgvector indexing — good:** 3 HNSW indexes on `vector(1536)` columns
(`rag_chunks` with `m=16, ef_construction=200`, `knowledge_graph_entities`,
`org_memory_entries`). But **`nv_legal_graph_entities.embedding` has NO vector index** —
that one will seq-scan.

**Sequential-scan offenders:**

| table | seq_scan | idx_scan | rows | % seq |
|---|---:|---:|---:|---:|
| `memory_entries` | 3,918 | 6,094 | 1,638 | **39.1%** |
| `ai_credit_usage` | 388 | 993 | 1,146 | **28.1%** |
| `nv_audit_logs` | 1,162 | 12,747 | 11,959 | 8.4% |
| `ai_activity` | 3,810 | 43,462 | 42,403 | 8.1% |

`memory_entries` at 39% seq is the tell — it has 10 indexes, so the planner is *choosing*
seq scans, which `random_page_cost=4` on SSD would explain.

**Unused indexes** (write cost, no read benefit): `hallucination_checks` ×2 (896 kB),
`ai_activity` ×2, `agent_metrics` ×3, `usage_logs`, `model_governance`,
`agent_auto_selections`. Note `idx_memory_value_tsv` and `idx_memory_user_evict` also show
0 scans — **but those I created minutes ago**, so that is expected, not a finding.

**Missing FK indexes:** `experiment_outcomes.experiment_id`,
`model_drift_checks.baseline_id`, `subscription_events.subscription_id`.

**RLS: 12 enabled / 99 disabled** of 111 tables. For a multi-tenant legal platform that is
the most significant schema-level gap here.

**Biggest tables:** `hallucination_checks` 39 MB for 7,622 rows (≈5 kB/row — storing full
payloads), `ai_activity` 18 MB, `memory_entries` 16 MB for 1,638 rows.

---

## 6. Document storage & management

**One real abstraction** — `nyv-document-storage-service.ts:311-322` with `LocalStorageAdapter`
and `S3StorageAdapter`. Backend from `NYV_STORAGE_BACKEND`, else auto-`s3` if a bucket env
is present, else `local` (`nyv-master-config.ts:282-293`).

| ingest path | object storage | DB row |
|---|---|---|
| EDJ (`/v1/sdk/ecosystem-documents`) | YES | YES — `async_job_queue` |
| shared-docs | YES | via EDJ only |
| **patra-mitra** | **NO** | **NO — in-memory Map with TTL** |
| matter-vault | YES | YES — `nv_matter_vaults` |
| docs-pipeline parse | NO | NO |
| doc orchestrator upload | YES | YES — `nv_document_ingest_status` |

**S3 hygiene is good:** SSE `AES256` on every PutObject (`:456`), presigned GET/PUT with
1 h expiry, IAM-role fallback when keys are unset, 1 GB size limit + MIME allowlist.

**Embedding:** Gemini, **1536 dims**, batches of 10, into `knowledge_chunks`; chunk size
1,200 for EDJ; falls back to plain-text insert if embeddings fail.

### Real gaps

| gap | impact |
|---|---|
| **Local signed URLs 404** — emits `/api/nv/storage/files/...`, **no such route exists** | `local` is the dev default, so dev signed URLs are unusable |
| **`deleteDocument()` never called** — the API delete removes `knowledge_chunks` rows and marks the row failed, but **never deletes the S3/local object** | storage grows forever; a DPDP erasure request cannot be honoured |
| `retentionDays` accepted but **never enforced** — metadata only, not even copied to the object | no lifecycle |
| `cleanupTempFiles()`, `storeParsedContent()`, `storeEmbeddings()`, `verifyIntegrity()`, `healthCheck()` | **all zero callers** |
| **Two different `rag_documents` tables** — one in `public`, one in `nv_schema` | write/read paths do not overlap; a correctness trap |
| GCS backend | config exists, **no adapter** — silently degrades to local |
| S3 multipart | configured, **not implemented**, despite the header claiming >50 MB multipart |

---

## 1. Final pending tasks (beyond what you already know)

Ordered by user-visible risk. Known items (v2 benchmark re-run, deploy drain) excluded.

### P0 — correctness / compliance

| # | item | why |
|---|---|---|
| 1 | **RLS on 99 of 111 tables** | multi-tenant legal data; the 12 covered are the exception, not the rule |
| 2 | **Document delete never removes the object** | DPDP/GDPR erasure cannot be honoured; storage grows unbounded |
| 3 | **Dual `rag_documents`** in `public` and `nv_schema` | silent divergence between write and read paths |
| 4 | `nv_legal_graph_entities.embedding` has **no HNSW index** | vector seq-scan on the legal graph |

### P1 — cost / performance

| # | item | evidence |
|---|---|---|
| 5 | **`random_page_cost=4` on SSD** | biases planner away from indexes; explains `memory_entries` 39% seq |
| 6 | **No provider-side prompt caching** | 1.2k–8.6k token prompts re-sent every request — largest untapped saving |
| 7 | **Cheap high-quality rungs sit below 7 Opus/Sonnet rungs** | `deepseek.v3.2` = quality 96 at 0.27/1.1 vs Sonnet-5 3/15 |
| 8 | `work_mem` 4 MB | sorts spill for ranking queries |
| 9 | Drop ~10 unused indexes | pure write overhead |
| 10 | 3 missing FK indexes | slow joins/cascades |

### P2 — wiring / dormant capability

| # | item |
|---|---|
| 11 | **MMR is dead** — `rerankResults` has no callers; diversity never applied |
| 12 | **3 of 5 memory tiers are in-process only** — lost on restart, and only `tiered.recall` runs on a simple request |
| 13 | Dead cascade rungs `anthropic/claude-sonnet-4-6`, `omniroute/auto`; wire `validateCascadeModelIds()` into CI |
| 14 | `rag.self` / `rag.reranker` / `memory.graph.add` / `memory.mem0.consolidate` / `memory.project.store` leaves declared but never invoked |
| 15 | NYS `deterministic.answer` returned but callers may ignore it → paying for an LLM we did not need |
| 16 | Local signed-URL route missing; GCS adapter missing; S3 multipart unimplemented |

### What is genuinely healthy

RDS: 100% cache hit, 0 dead-tuple pressure, Multi-AZ, huge connection headroom. Hedging
with proper cancellation and waste metering. HNSW on the three main vector tables. S3 SSE
+ presigned URLs + IAM fallback. Corpus-versioned cache keys. Semantic-serve threshold at
0.94, which already closes the cross-hit hole that invalidated the v1 cost benchmark.
