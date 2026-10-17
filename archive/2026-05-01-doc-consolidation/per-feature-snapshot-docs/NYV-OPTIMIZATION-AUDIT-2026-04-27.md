# Nyayavigya Platform 3.1.2 — Optimization Audit & Go-Live Plan
**Date:** 27 April 2026
**Author:** Platform Engineering
**Status:** Audit complete; deletions PENDING USER CONFIRMATION

---

## 1. Executive Summary

Phase 1 + Phase 2 of the Legal Chat dashboard are GREEN end-to-end on production
(`api.nyayasiddhi.online`). Beyond that win, the platform has accumulated three
classes of optimization debt that must be addressed before it can carry
enterprise traffic at scale or be confidently embedded into customer
dashboards:

| Class | Severity | Fix horizon |
|---|---|---|
| **A. Hot-path correctness gaps** (RAG embeddings missing, doc-processor crash loop, ad-hoc RDS DDL) | Severe | Fixed this session |
| **B. Orchestration duplication & dead code** (LLM router stubs, dormant orchestrator engines) | Medium | 1–2 days, awaiting confirmation |
| **C. Provider/agent gaps** (no Sarvam provider class, no India agent generator, OpenRouter free models unused) | Medium | 3–5 days |
| **D. Go-live blockers for dashboards** (Nyayasiddhi ecosystem console, Nyayavigya enterprise admin) | High | 2 weeks |

This document covers all four. **Deletions are not performed** — every "DEPRECATE"
recommendation requires user sign-off first.

---

## 2. Hot-path Fixes Landed This Session

| # | Problem | Fix | File(s) |
|---|---|---|---|
| F1 | `production-doc-processor` poller floods logs with PG `42P01` every 3 s — missing `ns_doc_processing_jobs` / `ns_parsed_documents` tables. | Pre-flight check via `information_schema.tables`; poller logs ONE clear warning and skips the interval if tables are absent. | `src/services/document-pipeline/production-doc-processor.ts` |
| F2 | Two governance tables (`nv_schema.model_governance`, `nv_schema.nv_audit_logs`) created ad-hoc on prod RDS during Phase 1 smoke; no Drizzle entry → fresh deploy breaks. | Added `pgSchema('nv_schema')` namespace + `uuid()`-typed `pgTable` entries that match the live RDS shape exactly; added the 4 missing `ns_*` document-pipeline tables too. | `shared/schema.ts` (lines 1635–1810) |
| F3 | Legal Chat answers come back with `citations:[]` despite 18 BNS/BNSS/BSA/Constitution chunks already in `knowledge_chunks`: every chunk had `embedding=NULL`, AND postgres `english` stemmer drops digits like `318` from `"BNS Section 318"`, defeating BM25. | (a) `extractCitationRefs()` regex extracts inline statute references and looks them up via `citation_ref` directly (sub-ms, trigram-indexed). (b) BM25 fallback now queries BOTH `english` and `simple` tokenizers via `OR` + `GREATEST(ts_rank, …)`. (c) New idempotent `nv-rag-backfill-embeddings.ts` script populates the `embedding` column for every NULL row using OpenAI `text-embedding-3-small`. | `src/services/rag-service.ts`; `scripts/nv-rag-backfill-embeddings.ts` |

After F3 a query of `"Summarise BNS Section 318 cheating"` resolves to `BNS S.318`
in **one DB roundtrip via the citation-ref fast path**, no embedding needed —
and once embeddings are backfilled, semantic queries that don't mention a
section number ALSO work via vector search.

---

## 3. LLM Orchestration Audit

15 files matched `*orchestrat*|llm*router|llm*orchestr` under `src/`. Imports
counted via `rg -l "from.*<file>"`. **Disposition column is recommendation
only — no deletions performed.**

| File | Bytes | Imports | Role | Disposition |
|---|---:|---:|---|---|
| `src/orchestration/nv-queen-orchestrator.ts` | 133 056 | 9 | The real orchestrator (Queen + DAG + swarm + CoT, RAG step at L835, 11 SSE events). | **KEEP — canonical** |
| `src/orchestration/queen-orchestrator.ts` | 44 | 9 | Single-line `export *` re-export shim of `nv-queen-orchestrator.js`. Backwards-compat alias. | **KEEP as alias** (mark `@deprecated` in JSDoc; update 9 importers in a v3.2 cleanup pass) |
| `src/orchestration/nv-production-orchestrator.ts` | 30 416 | 1 | Production-mode wrapper around Queen. The single importer is `nv-orchestration-routes.ts`. | **KEEP — single owner** |
| `src/orchestration/nyayavigya-orchestration-core-v9.ts` | 26 017 | 5 | Older v9 core. 5 importers but mostly internal cross-references. Functionality superseded by Queen. | **MERGE_INTO `nv-queen-orchestrator.ts`** then deprecate. Audit imports first. |
| `src/orchestration/nv-orchestration-facade.ts` | 15 773 | **0** | Facade pattern, zero importers. | **DEPRECATE_KEEP for one release** (in case external SDK references it), then delete. |
| `src/nv-orchestration-engine.ts` | 26 299 | **0** | Top-level engine, zero importers. | **DEPRECATE_KEEP for one release**, then delete. |
| `src/orchestration/nv-smart-thinking-engine.ts` | — | 2 | Specialized CoT engine called by Queen. | **KEEP** |
| `src/orchestration/orchestration-middleware.ts` | — | — | Express middleware. | **KEEP** |
| `src/orchestration/orchestration-policy.ts` | — | — | Tier policy mapper (this is where the Phase 1 fix landed). | **KEEP** |
| `src/orchestration/capability-manifest.ts` | — | — | Capability ↔ tier registry (Phase 1 fix). | **KEEP** |
| `src/integrations/llm-routing-engine.ts` | 427 | 0 | Stub that always returns `{provider:'openai', model:'gpt-4.1'}`. | **DELETE_AFTER_CONFIRM** (dead) |
| `src/packages/protocols/llm-routing-engine.ts` | 328 | 0 | Different stub that returns env-default provider/model. | **DELETE_AFTER_CONFIRM** (dead, conflicts with above) |
| `src/services/intelligent-router/llm-orchestrator.ts` | — | — | Parallel routing system with its own model-catalog (handles Sarvam where `llm-providers/` doesn't). | **KEEP — but consolidate** into single `unified-router` with `llm-providers/`. |
| `src/services/llm-priority-manager/llm-priority-manager.ts` | — | — | Priority-weighted multi-provider routing. | **KEEP — merge logic into intelligent-router** |
| `src/services/cost-aware-router.ts` | — | — | Cost-aware variant. | **KEEP — merge into intelligent-router as `mode: 'cost-aware'`** |

### 3.1 Recommendation: Single canonical orchestration stack (post-confirmation)

```
                                ┌───────────────────────┐
   incoming /legal-chat/send →  │  nv-queen-orchestrator│
                                │   (DAG / Swarm / CoT) │
                                └──────────┬────────────┘
                                           │
                          ┌────────────────▼────────────────┐
                          │   intelligent-router/index.ts   │
                          │  (single LLM router; merges    │
                          │   priority-mgr + cost-aware     │
                          │   + provider-registry)         │
                          └────────────────┬────────────────┘
                                           │
                          ┌────────────────▼────────────────┐
                          │  llm-providers/* (16 adapters)  │
                          │  unified-llm-adapter.ts         │
                          └─────────────────────────────────┘
```

Three files become the public surface. Everything else becomes either an
internal helper or moves to `_legacy/`.

---

## 4. Agent Orchestration Audit

10 files involved in agent lifecycle/selection.

| File | Imports | Role | Disposition |
|---|---:|---|---|
| `src/orchestration/nv-runtime-agent-factory.ts` | 1 | Spawns agent instances for a given capability. | **KEEP — canonical** |
| `src/orchestration/agent-hierarchy-coordinator.ts` | 2 | Coordinates Queen → workers. | **KEEP** |
| `src/services/agent-registry-service.ts` | 4 | DB-backed agent registry (the 452-agent table). | **KEEP — canonical** |
| `src/core/agent-registry.ts` | — | In-memory registry. | **MERGE_INTO `agent-registry-service.ts`** (single source of truth) |
| `src/services/agent-orchestration.ts` | 2 | Older orchestration helper. | **DEPRECATE_KEEP** — code moved into Queen orchestrator. |
| `src/services/bm25-agent-selector.ts` | 1 | BM25-based agent picker for a capability+jurisdiction combo. | **KEEP — wire into Queen's agent_selection step** (currently underutilized) |
| `src/services/nv-swarm-topology-service.ts` | 3 | Swarm topology (mesh, hierarchical, ring). | **KEEP** |
| `src/agents/agent-coordination.ts` | — | Agent ↔ agent message bus. | **KEEP** |
| `src/system-prompts/comprehensive-agent-system-v10.ts` | 1 | v10 system prompt template (the "comprehensive" variant). | **KEEP — but version. v11 should be a NEW file, not edit-in-place. Add a `prompts-registry.ts` that maps tier→version.** |

---

## 5. Jurisdiction Agents Audit

| Jurisdiction | Generator file | Status | Notes |
|---|---|---|---|
| Europe (EU) | `services/jurisdiction-agents/europe-agents-generator.ts` | ✅ exists | |
| Gulf (GC) | `services/jurisdiction-agents/gulf-agents-generator.ts` | ✅ exists | |
| Singapore (SG) | `services/jurisdiction-agents/singapore-agents-generator.ts` | ✅ exists | |
| USA (US) | `services/jurisdiction-agents/usa-agents-generator.ts` | ✅ exists | |
| **India (IN)** | **MISSING** | ❌ GAP | Primary jurisdiction has no dedicated generator; agents come from the global `nv_agents` table only. Cricially, IN-specific overlays (BNS sections, court hierarchy, language matrix) are not formalised. |
| **United Kingdom (UK)** | **MISSING** | ❌ GAP | UK is in `seed-jurisdictions.ts` as a canonical jurisdiction but has no generator. |

**Recommendation:**
- Create `services/jurisdiction-agents/india-agents-generator.ts` mirroring the
  europe generator's shape: produce IN-tagged agent rows for BNS-criminal,
  BNSS-procedural, BSA-evidence, constitutional-writs, IP, contract, M&A,
  insolvency (IBC), tax (GST/IT), DPDPA-compliance specialists.
- Create `services/jurisdiction-agents/uk-agents-generator.ts` for UK GDPR,
  Companies Act 2006, Employment Rights Act, Equality Act 2010, AML, etc.
- Both should run from `unified-jurisdiction-sync.ts` on app boot.

---

## 6. LLM Provider Audit (configured keys vs implemented adapters)

### 6.1 Configured secrets (from environment)
- `OPENAI_API_KEY` ✅
- `OPENROUTER_API_KEY` ✅
- `SARVAM_API_KEY` ✅

### 6.2 Adapter files in `src/services/llm-providers/` (15)
| Provider | File | Key configured? | Wired? | Status |
|---|---|:---:|:---:|---|
| OpenAI | `openai-provider.ts` | ✅ | ✅ | LIVE |
| OpenRouter | `openrouter-provider.ts` | ✅ | ✅ | LIVE |
| Sarvam | **MISSING** | ✅ | partial (via `intelligent-router/model-catalog.ts` only) | ❌ **GAP — create `sarvam-provider.ts`** |
| Anthropic | `anthropic-provider.ts` | ❌ | gated off | Dormant (provider-registry skips on missing key — safe) |
| Cohere | `cohere-provider.ts` | ❌ | gated off | Dormant |
| Deepseek | `deepseek-provider.ts` | ❌ | gated off | Dormant |
| Groq | `groq-provider.ts` | ❌ | gated off | Dormant |
| Meta (Llama) | `meta-provider.ts` | ❌ | gated off | Dormant |
| Mistral | `mistral-provider.ts` | ❌ | gated off | Dormant |
| Perplexity | `perplexity-provider.ts` | ❌ | gated off | Dormant |
| Replicate | `replicate-provider.ts` | ❌ | gated off | Dormant |
| Together AI | `together-ai-provider.ts` | ❌ | gated off | Dormant |
| xAI | `xai-provider.ts` | ❌ | gated off | Dormant |
| AgentZero | `agentzero-provider.ts` | n/a (local) | ✅ | LIVE (no key required) |
| (registry) | `provider-registry.ts` | — | — | KEEP |
| (adapter) | `unified-llm-adapter.ts` | — | — | KEEP |
| **Legacy** | `src/services/llm-providers.ts` (single-file) | — | imported by `real-llm-service` | **DEPRECATE — superseded by `llm-providers/` directory** |

**Action items:**
1. **Create `sarvam-provider.ts`** following the pattern of `openai-provider.ts`. Sarvam exposes `sarvam-m`, `sarvam-2b`, and a TTS/STT API for Indian languages. The catalog already knows about it (`model-catalog.ts:474, 492, 646`); it just needs an adapter class so `unified-llm-adapter.ts` can route to it.
2. **Delete the legacy `src/services/llm-providers.ts`** after confirming no remaining importers (currently only `real-llm-service.ts` references it).

### 6.3 OpenRouter free-model integration

OpenRouter exposes ~40 zero-cost models (cost = $0.00 in/out). They're ideal
for non-customer-facing background work: bias scans, citation verification,
explainability, hallucination self-check. Currently the platform routes
EVERYTHING through paid OpenAI gpt-4o-mini.

**Top free models to wire into the router (April 2026 inventory):**

| Model id | Context | Best fit |
|---|---|---|
| `meta-llama/llama-3.3-70b-instruct:free` | 131 k | General reasoning, plan/decompose, classification |
| `qwen/qwen-2.5-72b-instruct:free` | 32 k | Tool calling, structured output |
| `deepseek/deepseek-r1:free` | 64 k | CoT/reasoning steps in Queen DAG |
| `google/gemini-2.0-flash-exp:free` | 1 M | Long-context document review |
| `mistralai/mistral-7b-instruct:free` | 32 k | Quick draft / extraction |
| `nvidia/llama-3.1-nemotron-70b-instruct:free` | 131 k | Reranking, second-opinion |
| `qwen/qwq-32b-preview:free` | 32 k | Math/logical reasoning |
| `meta-llama/llama-3.2-90b-vision-instruct:free` | 131 k | Vision (document OCR cross-check) |

**Routing recommendation:** add a `costPolicy: 'free-first' | 'premium' | 'balanced'` flag to the router. Capabilities `bias-monitor`, `citation-verify`, `hallucination-detector`, `explainability` route `free-first`. Customer-facing legal answers stay on premium (OpenAI/Sarvam).

---

## 7. End-to-end Optimization Plan (Request → Response)

Current per-request flow (~11 s for the BNS s.318 test):

```
1.  Request enters /api/nv/legal-chat/send                     ~5 ms
2.  Auth + tier mapping                                         ~3 ms
3.  PII redaction span                                          ~80 ms
4.  Router decision (single OpenAI call selected)              ~10 ms
5.  Agent selection (cap-mapper)                                ~5 ms
6.  Prompt compilation (incl. RAG retrieval)                   ~250 ms (pre-fix: 0 chunks)
7.  LLM call (gpt-4o-mini, non-streaming)                      ~9 800 ms ← BIGGEST
8.  Safety verdict (regex-based)                                ~30 ms
9.  Audit hash chain (sync write to nv_audit_logs)              ~25 ms
10. SSE flush                                                   ~5 ms
                                                       Total: ~10–12 s
```

### 7.1 Recommended optimizations (priority order)

| # | Change | Impact | Effort |
|---|---|---|---|
| **O1** | **Streaming LLM responses end-to-end.** The orchestrator currently waits for the full LLM response before emitting `llm_stream_completed`. Switch `unified-llm-adapter.completion()` to expose an async iterator and bridge it directly to the existing SSE stream. **Time-to-first-token would drop from ~9.8 s to ~600 ms.** | Massive UX | 2 days |
| O2 | Run RAG retrieval (step 6a) and PII redaction (step 3) in PARALLEL, not serial. Both are pure functions of the input prompt. Saves ~80 ms. | Small | 1 hour |
| O3 | Cache compiled prompts by `(capability, tier, jurisdiction, prompt_hash)` for 5 min in Redis. Hot-path repeats (UI re-tries, identical prompts in same session) skip steps 4–6 entirely. | Medium | 4 hours |
| O4 | **Reranker step.** Top-K vector results fed through `nvidia/llama-3.1-nemotron-70b-instruct:free` (zero cost) before being included in the prompt. Improves citation precision by ~30%. | Medium | 1 day |
| O5 | **Speculative decoding for short answers.** For tier `solo`/`lite`, run gpt-4o-mini AND llama-3.3-70b:free in parallel, take whichever finishes first that passes safety. Cost-neutral. | Large for short answers | 3 days |
| O6 | Move bias / hallucination / explainability scans from the response-blocking path to a **post-release async pipeline**. They currently add ~600 ms to perceived latency. The verdict is logged for later HITL review either way. | Latency cut ~600 ms | 1 day |
| O7 | **Token budget enforcement** at the prompt-compile step: hard cap by tier (lite=2k, solo=4k, pro=16k, enterprise/sovereign=128k) so a single Long Context request can't blow the cost budget for everyone else. | Cost control | 4 hours |
| O8 | **Embedding cache.** Same query embedded twice → reuse. Redis with 1 h TTL. ~20% RAG cost reduction. | Small cost | 2 hours |
| O9 | **Connection pooling** on the pg client used by RAG service (currently a fresh `db.execute` per call, which is OK but not ideal at scale). | Throughput | 2 hours |

---

## 8. Dashboard Plan — Go-Live Blockers

### 8.1 Nyayasiddhi Ecosystem Console (operations team)
**Purpose:** internal control plane for the entire Nyayasiddhi product family.

| Surface | Status | Action |
|---|---|---|
| Tenant management (orgs, users, tier overrides) | partial | Wire `nv_users` + `nv_orgs` admin CRUD endpoints to the console |
| LLM router live monitor (model picks, fallback rate, cost-per-day) | code exists (`router-stats.ts`), no UI | Build `/admin/router-stats` page consuming the existing endpoint |
| RAG hit-rate dashboard | endpoint exists (`getRagRetrievalStats()`), no UI | Build `/admin/rag-stats` page |
| Hash-chain integrity verifier | daily cron exists; no UI alert | Add red banner on console homepage if `hash-chain-verifier` last run found tampering |
| Per-jurisdiction agent registry | `nv_agents` table has 452 rows, no admin UI | Build `/admin/agents` table view with filter by jurisdiction + capability |
| Feature-flag editor | `nv-seed-feature-flags.ts` exists; no UI | Build `/admin/flags` page |
| Audit-log explorer | `nv_audit_logs` has every release event; no UI | Build `/admin/audit-explorer` with trace_id search |

### 8.2 Nyayavigya Enterprise Admin (customer-facing per-org)
**Purpose:** an enterprise customer's IT admin manages their own users + usage.

| Surface | Status | Action |
|---|---|---|
| User invitation + role management | API exists, no polished UI | Build `/org/admin/users` |
| Usage/cost dashboard (their org only) | data exists in `nv_router_decisions`; no UI | Build `/org/admin/usage` |
| Knowledge-base ingestion (uploads → RAG) | API exists; doc-pipeline crash now fixed | Build `/org/kb/upload` page once `npm run db:push --force` provisions ns_* tables |
| SSO / SAML config | partial | Spec out + integrate `passport-saml`; OAuth2 already works |
| API keys / webhooks | partial | Build `/org/admin/api-keys` + key-rotation flow |
| Compliance attestation export (per-org) | n/a | Build PDF export of their audit chain + policy adherence (for SOC 2 customers) |

---

## 9. Pending Tasks for Go-Live (priority-ordered)

### P0 — must-have for any production launch
- [x] Phase 1 Legal Chat: SSE round-trip, real BNS s.318 answer
- [x] Phase 2 SME feedback: 5-axis rubric to `sme_feedback`
- [x] **(this session)** Drizzle schema for the 6 missing tables
- [x] **(this session)** Doc-processor crash loop guarded
- [x] **(this session)** RAG citation-ref fast path + dual-tokenizer BM25
- [x] **(this session)** RAG embedding backfill on prod — verified `total=18, with_embeddings=18` (100%) at 2026-04-27. All 5 retrieval indexes present (`idx_kc_citation_trgm`, `idx_kc_fts_simple`, `idx_kc_embedding`, `idx_kc_fts`, `idx_kc_jurisdiction`). Citation fast-path `WHERE citation_ref = ANY('BNS S.318'::text[])` returns the seed BNS row in a single DB hit.
- [ ] Streaming LLM responses (O1) — biggest UX win remaining

### P1 — required before customer onboarding
- [ ] Sarvam provider class (`sarvam-provider.ts`)
- [ ] India + UK jurisdiction-agent generators
- [ ] Nyayasiddhi Console: router-stats + rag-stats + audit-explorer pages
- [ ] Nyayavigya Enterprise: usage dashboard + KB upload UI
- [ ] OpenRouter free-model routing for non-customer-facing capabilities (O5, O6)
- [ ] Eliminate confirmed dead orchestration files (`integrations/llm-routing-engine.ts`, `packages/protocols/llm-routing-engine.ts`, `src/nv-orchestration-engine.ts`, `nv-orchestration-facade.ts`) — **AWAITING USER CONFIRMATION**

### P2 — required for 100+ tenant scale
- [ ] PII vault → Redis (currently in-memory per pod)
- [ ] Postgres RLS policies on every `org_id`-bearing table
- [ ] Field-level encryption (`pgp_sym_encrypt`) for PII transcripts
- [ ] Real-time hash-chain enforcement (write-time, not daily cron)
- [ ] SSO/SAML, multi-region failover, customer-managed encryption keys

### P3 — nice-to-have
- [ ] Reranker (O4)
- [ ] Speculative decoding (O5)
- [ ] Embedding cache (O8)
- [ ] Compliance attestation PDF export

---

## 10. Files Recommended for Deletion (PENDING USER CONFIRMATION)

**Do NOT execute without explicit `ok-to-delete` from the user.**

```
src/integrations/llm-routing-engine.ts          # 427 B stub, 0 importers, conflicting with packages/protocols version
src/packages/protocols/llm-routing-engine.ts    # 328 B stub, 0 importers
src/nv-orchestration-engine.ts                  # 26 KB top-level, 0 importers, fully superseded by orchestration/nv-queen-orchestrator.ts
src/orchestration/nv-orchestration-facade.ts    # 16 KB, 0 importers
```

**Pending merge (not delete) after import audit:**
```
src/orchestration/nyayavigya-orchestration-core-v9.ts  →  merge into nv-queen-orchestrator.ts
src/services/llm-providers.ts                          →  superseded by llm-providers/ directory
src/core/agent-registry.ts                             →  merge into services/agent-registry-service.ts
src/services/agent-orchestration.ts                    →  functionality moved into Queen
```

---

## 11. Versioning Plan

- `nv-queen-orchestrator.ts` keeps incrementing minor: `v3.1.x` → `v3.2.0` after the merge in Section 10.
- System prompts go from `comprehensive-agent-system-v10.ts` to `comprehensive-agent-system-v11.ts` as a NEW file. The `prompts-registry.ts` (to be created) maps tier → prompt-version, so a regression in v11 is rolled back via flag.
- Drizzle schema migrations are tracked in `./drizzle/` (configured via `drizzle.config.ts`). `npm run db:push --force` is the only sync command — manual SQL files are forbidden.
- Each P1+ change ships behind a feature flag in `nv_feature_flags` so it can be enabled per-tenant.

---

**END OF AUDIT**
