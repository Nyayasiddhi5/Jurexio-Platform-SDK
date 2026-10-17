# NYV + NYS Platform Performance, DB & Search Audit

**Date:** 2026-09-02  
**Scope:** nyayavigya-platform-312 (NYV gateway) + NYS-Agentic-AI (caselaw worker submodule)  
**Method:** Live EC2 probes (`npm run demo:probe:ec2`), code audit, schema/index review. No secrets logged (NV-SECRETS-001).

---

## Executive summary

| Area | Status | Headline |
|------|--------|----------|
| GO push `e259f65e8` | **DONE** | `origin/main` confirmed at `e259f65e88ba7d745c69c78aa4b835923c4ed48d` |
| Caselaw hybrid latency | **DEGRADED (not down)** | Live probe: hybrid **200 @ 24.9s**; FTS **200 @ 0.23s**. Prior probe hit **curl 45s client timeout** (000ERR / nginx 499) |
| Post-boot `ensureTables` | **NON-FATAL ERRORS** | Phase5 + knowledge-module log DDL failures on every boot; services continue |
| Partner AI hot path | **Healthy** | health/models/orch/CNR/NYM all **200**; chat-fast ~6.7s, draft-fast ~19.8s |

---

## Part A — Live probe results (executed)

### A1. GO push

- **Before:** local `HEAD=e259f65e8`, `origin/main=5d74198d0` (1 commit ahead)
- **Action:** `git push origin main`
- **After:** `origin/main=e259f65e88ba7d745c69c78aa4b835923c4ed48d` — commit message: `docs(tracker): nysdev deploy 2026-09-02T0902Z-aws-ssm sha 5d74198d`

### A2. Caselaw hybrid vs FTS (SSM `b097fdde`, 2026-09-02 ~09:28 UTC)

| Probe | HTTP | Latency | Notes |
|-------|------|---------|-------|
| `GET /api/nv/knowledge/caselaw/search?q=bail&courtType=sc&limit=2` (hybrid default) | **200** | **24.95s** | success=true, source=nys-knowledge-plane |
| Same route `mode=fts` | **200** | **0.23s** | Same envelope shape |
| Deploy probe (09:14 UTC, `e7e397c1`) | **000ERR** | **45s** | curl `--max-time 45` exhausted |
| nginx console (09:15–09:16 UTC) | **499** | — | client disconnected before upstream finished |

**Root cause (measured, not hypothesized):**

1. **Probe client budget = 45s** — `_ec2-demo-crosscheck-probe.sh` line 51 uses `--max-time 45` for hybrid; when NYS+embed path exceeds 45s, curl reports `000ERR` and nginx logs **499** even if the server would eventually respond (today's run succeeded at ~25s).
2. **Hybrid path is strictly heavier than FTS** — NYS `searchRdsJudgmentsHybrid()` (`NYS-Agentic-AI/artifacts/api-server/src/lib/rdsCaselaw.ts`):
   - Runs **full FTS leg first** (`searchRdsJudgments`, 8s `statement_timeout` per query).
   - Then **`embedText(q)`** (Bedrock/API round-trip for query vector).
   - Then **pgvector KNN** with `SET LOCAL statement_timeout = 8000` and up to 60 candidates (`HYBRID_VEC_CANDIDATES=30`, `candidateLimit = min(max(limit*2, 30), 60)`).
3. **Contention under embed workers** — four embed workers share the caselaw-worker RDS instance; FTS can hit `CorpusBusyError` → **503 retryable** (documented in `CASELAW_SEARCH_SLO`). NYV retries 2× then falls back to FTS on 503/502 only — **not on slow success or AbortError timeout**.
4. **NYV upstream timeouts stack** — caselaw route uses `timeoutMs: 60_000` + `retries: 2` (`nv-knowledge-plane-routes.ts`); default client `NYS_KNOWLEDGE_TIMEOUT_MS=45000` elsewhere. Worst-case wall time can exceed probe budget without triggering FTS fallback.

**Not the primary cause:** missing GIN index — `judgments_search_tsv_idx`, `judgments_cnr_idx`, and optional `judgments_embedding_hnsw` are defined in `NYS-Agentic-AI/artifacts/api-server/src/rds-ddl.ts` and created by embed worker. Warm FTS is sub-second (this probe + prior SLO docs).

### A3. Post-boot gateway logs (Phase5 / knowledge-module)

**Pattern (4h window, gateway container):**

```text
[Phase5] Table creation error:
[NYV-SVC-KM-MODULES] ensureTables error:
[NYV-SVC-KM-MODULES] updateModuleSettings error:   (follow-on)
[NYV-SVC-KM-MODULES] RSS fetch error for https://main.sci.gov.in/rss/...  (non-blocking)
```

**Likely cause:**

| Service | Code | Failure mode |
|---------|------|--------------|
| **Phase5** | `src/services/nv-phase5-services.ts` → `ensurePhase5Tables()` | Runtime `CREATE TABLE` / `CREATE INDEX ... hnsw` on `nv_schema.*` using app `DATABASE_URL`. App role typically **lacks CREATE** on `nv_schema` or **pgvector HNSW** privilege. Outer `catch` logs error; `phase5TablesEnsured` stays false → **re-attempts on every Phase5 API hit**. |
| **Knowledge modules** | `src/services/knowledge-module-service.ts` → `ensureTables()` | Same: `CREATE SCHEMA/TABLE/INDEX` on `nv_schema.nv_km_*` without admin role. Errors swallowed; RSS ingest also fails externally (SCI blocks datacenter IP). |

**Suggested fix (no deploy without GO):**

1. **One-time admin migration** via `DATABASE_URL_ADMIN` / `npm run db:push` + `src/db/create-indexes.ts` for NYV tables already in Drizzle.
2. **Gate runtime DDL:** match `nv-orchestration-services.ts` pattern — log once at `warn`, skip when `err.message` matches `permission denied|must be owner|42501`.
3. **Provision Phase5 + KM tables** in a numbered Drizzle/SQL migration instead of lazy boot DDL.
4. RSS errors: expected for blocked feeds; disable modules or proxy fetch — cosmetic.

---

## Part B — Database optimization audit

### B1. NYV schema (`shared/schema.ts` + `src/db/create-indexes.ts`)

**Hot-path tables:**

| Domain | Tables | PK types | Indexes (Drizzle / script) |
|--------|--------|----------|------------------------------|
| SDK auth | `sdk_applications`, `sdk_app_api_keys`, `sdk_api_request_logs` | `serial` | `key_hash`, `application_id`, `created_at` — in `create-indexes.ts` |
| Orchestrate | `nyayavigya_orchestration_jobs`, `legal_chat_messages` | `serial` / varchar | `orchestration_id`, composite usage indexes |
| RAG | `nv_document_embeddings` | `serial` | `document_id`, `user_id` — **no pgvector index in script** (array column) |
| Audit | `nv_audit_logs` (public + nv_schema variants) | serial | event_type, trace_id, composite |
| Tenant | `nv_users`, `nv_organizations` | serial | email, org_id |

**Gaps / recommendations (NYV Postgres on nysdev):**

```sql
-- SDK key lookup (auth hot path) — verify exists; add if missing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_keys_hashed_active
  ON sdk_app_api_keys (key_hash) WHERE is_active = true AND revoked_at IS NULL;

-- Orchestration job polling
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orch_jobs_status_created
  ON nyayavigya_orchestration_jobs (status, created_at DESC);

-- Legal chat thread fetch
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_chat_session_created
  ON legal_chat_messages (session_id, created_at DESC);

-- SDK request logs — partner dashboards / billing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_app_created
  ON sdk_api_request_logs (application_id, created_at DESC);

-- Audit trace correlation (W3C traceparent)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_trace_created
  ON nv_audit_logs (trace_id, created_at DESC);
```

**PK drift:** Drizzle uses `serial` for SDK tables; no varchar PK drift detected in current schema. Guard: never `serial ↔ varchar` per AGENTS.md.

**N+1 risks:** SDK gateway loads app + keys per request — mitigated by hashed key index; orchestration Queen fan-out is application-level (not DB N+1).

### B2. NYS caselaw RDS (`NYS-Agentic-AI/artifacts/api-server/src/rds-ddl.ts`)

**Corpus scale:** ~26.26M rows, ~281 GB table, ~3.9 GB `shared_buffers` (from NYS-CASELAW-SEARCH-LATENCY-001 comments).

**Existing indexes (canonical DDL):**

| Index | Type | Purpose |
|-------|------|---------|
| `judgments_search_tsv_idx` | GIN | Metadata FTS |
| `judgments_sc_body_search_tsv_idx` | GIN (partial SC) | Body FTS for Supreme Court |
| `judgments_cnr_idx` / `judgments_cnr_upper_idx` | B-tree | CNR resolve |
| `judgments_court_year_idx` | B-tree | Filter pushdown |
| `judgments_title_trgm_idx` | GIN trgm | Fuzzy title |
| `judgments_embedding_hnsw` | HNSW | Hybrid vector leg (embed worker) |
| `statutes_embedding_hnsw`, `statutes_fts_idx` | HNSW / GIN | Statute hybrid |

**Recommendations (NYS RDS — run on caselaw worker during maintenance window):**

```sql
-- Verify HNSW exists (hybrid leg); build CONCURRENTLY if embed worker skipped
CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_embedding_hnsw
  ON judgments USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Partial index for hybrid vector leg (embedding IS NOT NULL reduces scan)
CREATE INDEX CONCURRENTLY IF NOT EXISTS judgments_sc_embedding_partial
  ON judgments (id) WHERE embedding IS NOT NULL AND court_type = 'sc';

-- CNR case details (Athena write-through target)
CREATE INDEX CONCURRENTLY IF NOT EXISTS cnr_case_details_cnr_idx
  ON cnr_case_details (cnr);

-- After large backfill: analyze + consider raising shared_buffers / work_mem on worker only
ANALYZE judgments;
ANALYZE statutes;
```

**Query optimization already shipped:** `RANK_CANDIDATE` cap 400–2000 (was 10,000), `COUNT_CAP=1000` — do not revert.

### B3. Supabase best-practices cross-ref

- **query-missing-indexes:** FK and filter columns indexed — NYV script covers most; gaps listed above.
- **query-partial-indexes:** NYS SC body GIN is correct pattern for large corpus.
- **conn-pooling:** NYV gateway uses pool via Drizzle; NYS worker uses `getRdsPool()` — ensure `max` aligned with embed workers + API (4+4 contention observed).
- **lock-concurrent-index:** All recommendations use `CREATE INDEX CONCURRENTLY`.

---

## Part C — Architecture & route map

### C1. NYS search stack

```
Client → NYV /api/nv/knowledge/caselaw/search
       → nv-nys-knowledge-client (X-API-Key, timeout, per-surface circuit breaker)
       → NYS GET /caselaw/search
       → searchRdsJudgmentsHybrid | searchRdsJudgments (mode=fts)
       → RDS judgments + Bedrock embed + pgvector RRF
```

- **FTS-only:** `mode=fts` — keyword GIN, 8s statement budget, 503 if busy.
- **Hybrid:** FTS + embed + vector RRF; degrades to FTS on vector failure.
- **Embed workers:** `embed-corpus.ts` — backfill + HNSW creation.
- **Dashboard API:** NYS `nyv-api` systemd on caselaw-worker :8080 (not docker).

### C2. NYV → NYS proxy routes

| NYV mount | NYS upstream | Auth |
|-----------|--------------|------|
| `/api/nv/knowledge/caselaw/*` | `/caselaw/*` | Machine `NYS_KNOWLEDGE_API_KEY` |
| `/api/nv/knowledge/statutes/*` | `/statutes/*` | Same |
| `/api/nv/knowledge/retrieve` | `/retrieve` | Same |
| `/api/nv/knowledge/search` | instant search plane | Same |
| `/api/nv/knowledge/templates/*` | templates | Same |

### C3. NSP partner SDK surface

| Route | Purpose |
|-------|---------|
| `/api/nv/v1/sdk/*` | Partner SDK gateway (orchestrate, models, health) |
| `/api/nv/gateway/*` | Alias gateway (models, etc.) |
| `POST /api/nv/orchestrate` | Queen orchestration (600s ALB budget) |
| `POST /api/nv/v1/sdk/cnr/resolve` | CNR corpus resolve → NYS `resolveCnr` |
| `/api/nv/v1/sdk/patra-mitra/*` | Patra Mitra partner API |

### C4. CNR cascade (NYS `cnrResolve.ts`)

1. **RDS** `findRdsByCnr` — `judgments_cnr_idx`, fail-soft timeout + retry  
2. **`cnr_case_details`** table  
3. **Athena** `athenaCaseDetailsByCnr` — HC parquet cold path (`judgments_meta_hc_case_details`)  
4. **Athena archive** `athenaByCnr` + S3 write-through  
5. NYV proxy: `POST /api/nv/v1/sdk/cnr/resolve` — probe **116ms / 78ms**, tier `nys_rds`

### C5. LLM routing (`nv-llm-routing-policy.ts` + `nv-client.ts`)

| Mechanism | Behavior |
|-----------|----------|
| **Haiku fast path** | `-fast` task types → `BEDROCK_SLA_FAST_LEGAL` (Haiku 4.5, Nova lite) |
| **RAG skip** | `withQueenRagSkip` when `ragAlreadyApplied`; chat-fast doc-less skip in client |
| **LM cache** | `NV-LMCACHE-HOTPATH-001` — lookup **before** memory ∥ RAG in `nv-client.ts` |
| **Partner tokens** | `NYV_PARTNER_MAX_TOKENS_FLOOR=16384`; fast/chat/draft sub-floors in `nv-partner-platform.ts` |
| **Cascade** | Bedrock-first → Gemini → OpenRouter/direct → free → AgentZero |
| **Task tiers** | `NV_TASK_TIER_TIMEOUTS`: micro 12s, fast 25s, standard 60s, deep 120s |

---

## Part D — AI speed / no-timeout phased plan

### Phase 0 — Config, timeouts, fallbacks (1–2 days)

| Change | File / env | Rationale |
|--------|------------|-----------|
| **Hybrid time budget → FTS** | `nv-knowledge-plane-routes.ts` | If hybrid no response in **12s**, parallel-start FTS or abort hybrid and return FTS with `fallbackMode: "fts_budget"` |
| **Align probe + client SLO** | `_ec2-demo-crosscheck-probe.sh` | Raise hybrid smoke to **60s** OR document 45s as probe-only; prevents false 000ERR |
| **Timeout fallback on AbortError** | `nv-nys-knowledge-client.ts` | Treat fetch timeout like 503 for caselaw hybrid → FTS retry |
| **`NYV_HYBRID_BUDGET_MS`** | new env, default 12000 | Single knob for gateway hybrid budget |
| **Fix ensureTables noise** | phase5 + knowledge-module | Admin migration + skip DDL on 42501 |
| **Keep** | `NYS_KNOWLEDGE_TIMEOUT_MS=45000` | OK for Queen; partner search should prefer FTS or budgeted hybrid |

**Timeout inventory (live defaults):**

| Layer | Value | Env override |
|-------|-------|--------------|
| ALB/nginx | 600s | — |
| Client SDK orchestrate | 600s | `NYV_ORCHESTRATE_TIMEOUT_MS` |
| LLM provider attempt | 60s | `NYV_LLM_PROVIDER_TIMEOUT_MS` |
| LLM master deadline | 90s | `NYV_LLM_TIMEOUT_MS` |
| NYS knowledge | 45s | `NYS_KNOWLEDGE_TIMEOUT_MS` |
| Caselaw route override | 60s + 2 retries | inline in route |
| NYS FTS statement | 8s | `NYS_CASELAW_SEARCH_TIMEOUT_MS` |
| NYS vector statement | 8s | hardcoded |
| Partner RAG parallel | 45s floor | `NYV_PARTNER_RAG_TIMEOUT_MS` |
| Queen per-node (enterprise) | 120s | `NYV_QUEEN_NODE_TIMEOUT_ENTERPRISE_MS` |
| Orchestration wall | 540s | `NYV_ORCH_WALL_CLOCK_MS` |

### Phase 1 — DB indexes + query optimization (1 week)

- Apply NYV `CREATE INDEX CONCURRENTLY` gaps on nysdev Postgres.
- Verify `judgments_embedding_hnsw` on NYS RDS; `REINDEX`/`ANALYZE` if hybrid p95 > 2s warm.
- Complete SC `body_search_tsv` backfill (`apply-sc-body-fts-ddl.mjs`) for better SC hybrid precision.
- Run `npm run db:indexes` on NYV after migration review.

### Phase 2 — Athena parquet + hybrid architecture (2 weeks)

- **CNR:** expand Athena parquet sync for DC/AP/TS states (existing plan in `NSP-CNR-RESOLVE-CORPUS-PLAN-2026-08.md`).
- **Hybrid architecture:** split read replica for search vs embed workers; or queue hybrid embed with cached query vectors (Redis) for repeat queries.
- **Async pattern:** `POST /caselaw/search/async` + poll for queries expected >15s; sync path capped at 12s with FTS fallback.
- **LM cache:** enable `NYV_F_LMCACHE_SEMANTIC_EMBED` for repeat legal prompts (already wired).

---

## Part E — Evidence pointers

| Item | ID |
|------|-----|
| Live probe | SSM `b097fdde-6a33-4748-b069-99f95aa633e8` |
| Prior deploy probe | SSM `e7e397c1-8a68-43c3-8297-ee801d2906fa` |
| Deploy on nysdev | `2026-09-02T0902Z-aws-ssm-5d74198d` |
| Git push | `e259f65e88ba7d745c69c78aa4b835923c4ed48d` |
| NYS hybrid implementation | `NYS-Agentic-AI/artifacts/api-server/src/lib/rdsCaselaw.ts` |
| NYV caselaw proxy | `src/routes/nv-knowledge-plane-routes.ts` |
| Timeout SSoT | `src/config/nv-timeout-policy.ts` |

---

## Quick wins safe without schema GO

1. Hybrid **12s budget → FTS fallback** in NYV proxy (code-only).
2. **Suppress repeated ensureTables** attempts after permission error.
3. **Probe script** hybrid timeout 60s for accurate smoke.
4. Document partner default: **`mode=fts`** for interactive search; hybrid for offline/batch unless budget header set.

---

## Part F — Phase 0–2 completion (2026-09-02T11:00:00Z)

### Phase 0.1 — Wall-time fix (shipped)

| Change | File | Effect |
|--------|------|--------|
| **Default search mode = FTS** | `nv-knowledge-plane-routes.ts` | NSP/crosscheck probe without `mode=` hits FTS rail (~sub-second) |
| **`NYV_CASELAW_FTS_FALLBACK_BUDGET_MS=3000`** | `nv-timeout-policy.ts` | Hybrid → FTS retry uses 3s timeout, 0 retries (not 45s hybrid upstream) |
| **Wall-time budget guard** | `nv-knowledge-plane-routes.ts` | Slow hybrid success ≥12s triggers `reason=budget_exceeded` → FTS |
| **Probe labels** | `_ec2-demo-crosscheck-probe.sh` | `caselaw_default_fts`, `caselaw_hybrid` (20s budget), `caselaw_fts` |

**Target:** default caselaw **<15s p95**; explicit `mode=fts` **<1s**; explicit `mode=hybrid` **≤~15s** (12s hybrid + 3s FTS fallback).

### Phase 1 — DB indexes (migration files)

**NYV (`migrations/2026-09-02-perf-hotpath-indexes.sql` + `create-indexes.ts`):**

| Index | Table |
|-------|-------|
| `idx_sdk_keys_hashed_active` | `sdk_app_api_keys` (partial active) |
| `idx_orch_jobs_status_created` | `nyayavigya_orchestration_jobs` |
| `idx_legal_chat_session_created` | `legal_chat_messages` |
| `idx_sdk_req_logs_app_created` | `sdk_api_request_logs` |
| `idx_audit_logs_trace_created` | `nv_audit_logs` |

**Apply on nysdev:** `psql "$DATABASE_URL" -f migrations/2026-09-02-perf-hotpath-indexes.sql` or `npm run db:indexes`.

**NYS RDS (`NYS-Agentic-AI/scripts/migrations/2026-09-02-nys-caselaw-indexes.sql`):**

| Index | Purpose |
|-------|---------|
| `judgments_embedding_hnsw` | Hybrid vector leg |
| `judgments_sc_embedding_partial` | SC rows with embeddings |
| `cnr_case_details_cnr_idx` | CNR case-details lookup |

**SSM apply (caselaw-worker admin):** copy SQL to `/opt/nyv/api/migrations/` and run as postgres — see file header. Does not touch RLS.

### Phase 2 — Athena parquet wiring

| Surface | Wiring |
|---------|--------|
| `POST /api/nv/knowledge/documents/search` | Proxies NYS `/athena/search` with `NYV_ATHENA_QUERY_BUDGET_MS` (default 15s) |
| `POST /api/nv/knowledge/judgments/full-text` | Athena search step uses same budget via `nv-nys-judgment-fulltext.ts` |
| `POST /api/nv/v1/sdk/cnr/resolve` | Tiered timeout: 15s default (RDS), 60s `profile=caseCreate` (Athena cold path) |
| NYS `resolveCnr` | Existing cascade: RDS → `cnr_case_details` → Athena HC parquet → archive write-through |

**Infra-only (documented, not auto-run):** refresh `judgments_meta_hc_case_details` Glue table via `NYS-Agentic-AI/scripts/athena-hc-case-details-ctas.mjs` on caselaw-worker when expanding DC/AP/TS parquet.

### Final performance table (post-deploy probe)

Probe SSM `a00bda38` on deploy `2026-09-02T1013Z-aws-ssm-0e7a9b88` (commit `0e7a9b88f`):

| Probe | Before (2026-09-02 audit) | After (post Phase 0.1 deploy) | Target |
|-------|---------------------------|-------------------------------|--------|
| Caselaw default (no mode) | **24.9s** hybrid | **6.08s** FTS (degraded empty under load) | <15s p95 |
| Caselaw `mode=hybrid` | 24.9–29.7s | **8.97s** (FTS fallback) | ≤~15s |
| Caselaw `mode=fts` | **0.23s** | **0.25s** | <1s |
| legal-chat-fast | 6.7s | **6.0s** | <10s |
| legal-draft-fast | 19.8s | **18.8s** | — |
| CNR TSWL | 116ms | **259ms** | fast |
| CNR RJHC | 78ms | **94ms** | fast |
| NYM orchestrate | 200 | **200** | 200 |

### Phase 1 apply evidence (2026-09-02T11:30:00Z)

| Target | SSM command ID | Indexes verified | ANALYZE |
|--------|----------------|------------------|---------|
| **NYV nysdev** | `51546467-8c2e-4546-a805-58f33f728bbd` | all five NYV hot-path indexes | five tables |
| **NYS caselaw-worker** → `nyv_caselaw` | `ef4e8dbb-9379-4b4d-b89f-920060c81b43` (verify `a3fc267b`) | `judgments_embedding_hnsw`, `judgments_sc_embedding_partial`, `cnr_case_details_cnr_idx` | `judgments` + `cnr_case_details` (SSM `fbe4e047`); `statutes` N/A |

**Post-index probe** SSM `119d4853` vs Phase 0.2 (`2026-09-02T11:00:00Z`):

| Probe | Post Phase 1 | Post Phase 0.2 |
|-------|--------------|----------------|
| caselaw_default_fts | **0.41s** | 6.08s |
| caselaw_hybrid | **12.45s** | 8.97s |
| caselaw_fts | **0.26s** | 0.25s |

