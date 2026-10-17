---
status: living
version: 5.0.0
last_verified: 2026-05-05
supersedes: NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md (partial; see §6)
---

# NYV Platform — Canonical Database Reference (2026-05-05)

> **Audience.** Engineers cutting a fresh EC2 deploy with RDS Postgres, and
> anyone debugging "where is X table?" / "which table is canonical?". This
> doc replaces ad-hoc grepping for `DROP SCHEMA` and `nv_schema.` in source.
>
> **Scope.** Lists every table the gateway actually reads or writes,
> grouped by domain, with the explicit canonical schema choice
> (`public` vs `nv_schema`), the Drizzle export name, and the file:line of
> the primary writer + reader.
>
> **Why this exists.** Two long-running schema forks were resolved on
> 2026-05-05 (B1 nv_statutes; B2 sdk_api_request_logs). Both had a
> Drizzle table on `nv_schema` and a parallel live writer on `public`,
> producing silent data drift. This doc + the parity-guardrail script
> (`scripts/nv-schema-parity-check.ts`) ensure that doesn't recur.

---

## 0. TL;DR — what changed on 2026-05-05

| Table | Before | After 2026-05-05 |
|---|---|---|
| `nv_statutes` | 2 forks: `public` (305 rows, live writer) + `nv_schema` (83 rows, no writer) | **`public.nv_statutes` only** (`nv_schema` dropped — was a perfect subset) |
| `sdk_api_request_logs` | 2 forks: `public` (342+ rows, gateway + analytics) + `nv_schema` (71 rows, pattern-detector noise) | **`public.sdk_api_request_logs` only** — middleware writer at `nv-sdk-tracking-middleware.ts:468` re-pointed with column-shape translation |

Migration scripts: `scripts/consolidate-nv-statutes.sql`,
`scripts/consolidate-sdk-api-request-logs.sql`. Backups (CSV) at
`.local/backups/nv_schema_*_pre_drop_2026-05-05.csv`.

---

## 1. Schema layout (top-level)

The gateway uses ONE Postgres database with TWO logical schemas:

| Schema | Owner / purpose |
|---|---|
| `public` | Default. Holds **all live operational tables** (auth, SDK, billing, agents, RAG-prod, audit, etc.). Drizzle tables defined in `shared/schema.ts` live here. |
| `nv_schema` | Helium-mirror tables for governance/legacy seed data. Drizzle tables defined in `shared/nv-governance-schema.ts` live here unless explicitly marked REMOVED. |

**Rule of thumb.** When in doubt, prefer `public`. Two new tables were
born on `nv_schema` historically because they came from a Helium import
(2026-04-29) — both have since been migrated back to `public` (B1, B2
above). New tables should be added to `public` unless they are part of a
clearly bounded helium-mirror dataset.

---

## 2. AUTH domain

| Table | Schema | Drizzle export | Primary writer | Primary reader |
|---|---|---|---|---|
| `nv_users` | public | `users` (shared/schema.ts) | `src/routes/nv-auth-routes.ts:registerUser` | `src/middleware/nv-auth.ts:nvAuthenticate` |
| `nv_organizations` | public | `organizations` | `src/routes/nv-org-routes.ts` | `src/middleware/nv-org-context.ts` |
| `refresh_tokens` | public | `refreshTokens` | `src/middleware/nv-auth.ts:storeRefreshToken` (L57) | `nv-auth.ts:rotateRefreshToken` (L68) |
| `sme_allocations` | public | `smeAllocations` (manual) | `src/routes/nv-legal-chat-routes.ts:668 (POST /sme-allocations)` | `src/middleware/legal-chat-rbac.ts:60` |

**Notes.** `nv_users.role` is text; valid values include `super_admin`,
`org_admin`, `manager`, `analyst`, `developer`, `operator`, `user`,
`admin`. Legal Chat RBAC additionally requires either `super_admin` OR
an active `sme_allocations` row.

---

## 3. SDK domain

| Table | Schema | Drizzle export | Primary writer | Primary reader |
|---|---|---|---|---|
| `sdk_applications` | public | `sdkApplications` | seed: `nv-seed-master-data.ts` | `nv-sdk-gateway.ts:resolveAppFromKey` |
| `sdk_api_keys` | public | `sdkApiKeys` | `scripts/nv-issue-extra-sdk-keys.ts` | `nv-sdk-gateway.ts:keyFingerprint` |
| `sdk_api_request_logs` | **public** *(B2 canonical, 2026-05-05)* | `sdkApiRequestLogs` (shared/schema.ts:144) | `nv-sdk-gateway.ts:566` (primary) + `nv-sdk-tracking-middleware.ts:488` (secondary, pattern logs) | `src/routes/nv-analytics-routes.ts` (F12) |
| `nv_sdk_usage_metrics` | nv_schema | `nvNvSdkUsageMetrics` | `nv-credits-service.ts` | `nv-credits-service.ts:getOrgUsage` |
| `nv_credit_ledger` | public | `creditLedger` | `nv-credits-service.ts:debit` | `nv-credits-service.ts:getBalance` |

**B2 column-shape translation** (the writer in tracking middleware
translates legacy `nv_schema` shape → public shape):

| Legacy `nv_schema.sdk_api_request_logs` | Canonical `public.sdk_api_request_logs` |
|---|---|
| `app_id text` | `application_id int` (cast if numeric, else `NULL`) |
| `org_id text` | embedded in `metadata.org_id` jsonb |
| `tokens_used int` | `tokens_in int` (and `tokens_out=0` from this writer) |
| `trace_id text` | `request_id varchar` |
| `route text` | `endpoint varchar` |
| `error_message text` | embedded in `metadata.error_message` jsonb |

---

## 4. GOVERNANCE / AUDIT domain

| Table | Schema | Drizzle export | Notes |
|---|---|---|---|
| `nv_audit_logs` | **`nv_schema`** (live writer) **+** `public` (legacy) | `auditLogs` (public) | Hash-chained tamper-evidence log. ⚠ The **live writer** is `src/middleware/nv-sdk-tracking-middleware.ts:399` writing **`nv_schema.nv_audit_logs`** via raw SQL (not Drizzle). The `public.nv_audit_logs` table also exists (1043 rows from older code path) and is what the Drizzle export `auditLogs` refers to. **Pre-EC2 cleanup follow-up:** decide canonical schema + consolidate; for now both exist and the writer-of-record is the nv_schema one. Reader: `src/routes/nv-audit-chain-routes.ts`. |
| `nv_statutes` | **public** *(B1 canonical, 2026-05-05)* | (none — query via raw SQL) | 305 rows of seeded statutes. Writer: `src/services/nv-statute-seeding-service.ts`. Reader: `nv-core-routes.ts`. |
| `nv_grpo_runs` | public | `grpoRuns` | GRPO training metrics. Has DB-only columns (`status`, `metrics`, `started_at`) not in Drizzle — see parity warnings; safe to ignore at runtime. |
| `nv_pattern_audit_log` | public *(MISSING — Drizzle defines but DB does not)* | `patternAuditLog` | Open: parity script flags this; needs DB push or Drizzle removal. Tracked as follow-up. |

---

## 5. AGENTS domain

| Table | Schema | Drizzle export | Notes |
|---|---|---|---|
| `nv_legal_agents` | public | `legalAgents` | 1042 agents loaded from `config/agent-registries/Nyayavigya-Legal-registry-{IN,UK,US,EU,SG,GC,DEFAULT}.json` at boot. Writer: `agent-registry-service.ts:upsertAgents`. |
| `agent_executions` | public | `agentExecutions` | Per-agent run record. |
| `nv_agent_telemetry` | public | `agentTelemetry` | Quality + latency telemetry. |

**Registry files** (file-system, not DB) at
`config/agent-registries/`. The legal-chat `/agents` endpoint reads
these directly (post-2026-05-05 path fix —
`nv-legal-chat-routes.ts:604`).

---

## 6. RAG domain

| Table | Schema | Drizzle export | Status |
|---|---|---|---|
| `nv_rag_documents` | public | `nvRagDocuments` (also mirrored in `nv_schema`) | **EMPTY at 2026-05-05** (0 rows). Used by Legal Chat for RAG retrieval. Seeder pending. |
| `nv_rag_chunks` | public | `nvRagChunks` | Empty; depends on documents. |
| `nv_document_embeddings` | public | `documentEmbeddings` | Empty; vector store backing for citations. |
| `legal_research_results` | public | `legalResearchResults` | Active; reader `intelligence-research-routes.ts`. |

**RAG known-gap.** With all three RAG stores empty, the Legal Chat
`/send` endpoint still returns a high-quality answer but `citations: []`
is empty (the LLM recalls citations inline from training data). To
populate RAG, run the document-ingestion pipeline at
`src/services/rag/nyv-rag-pipeline-enhanced.ts`. Adding a seed corpus is
the next logical step before EC2 redeploy.

---

## 7. LEGAL CHAT domain

| Table | Schema | Drizzle export | Notes |
|---|---|---|---|
| `legal_chat_sessions` | public | `legalChatSessions` | 2 rows (test data). PK = uuid. Writer: `nv-legal-chat-routes.ts:107` (POST /sessions). |
| `legal_chat_messages` | public | `legalChatMessages` | 0 rows — `/send` streams via SSE; persistence is currently best-effort and runs after the SSE close. |
| `sme_allocations` | public | (see Auth) | Required for non-superadmin SME access; gates the entire legal-chat router via `requireLegalChatAccess`. |

**Live e2e probe (2026-05-05).** A Bearer-JWT `POST /api/nv/legal-chat/send`
with `{"prompt":"What is Section 138 of the Negotiable Instruments Act?",
"jurisdictions":["IN"], "tier":"pro"}` produced 9 SSE events
(`request_received` → `pii_redaction` → `router_decision` →
`agent_selection` → `prompt_compiled` → `llm_stream_completed` →
`safety_verdict` → `audit_chain` → `run_complete`) in 7,742 ms with
`model=claude-opus-4-6`, 8,564 tokens in / 473 tokens out, and a
correctly-cited statutory answer.

---

## 8. OPERATIONS / OBS domain

| Table | Schema | Drizzle export | Notes |
|---|---|---|---|
| `nv_voice_sessions` | public | `nvVoiceSessions` | DB has columns (`agent_id`, `transcript`, `audio_url`) NOT in Drizzle; Drizzle declares columns (`duration_ms`, `transcript_text`, etc.) NOT in DB. Drift flagged by parity script — schedule alignment. |
| `nv_matter_memory` | public | `nvMatterMemory` | Has `content_enc bytea` extra column for at-rest encryption. |
| `document_extracted_content` | public | `documentExtractedContent` | Has `content_enc bytea` extra column for at-rest encryption. |

---

## 9. Postgres-vs-neon-serverless quirks (RDS migrators read this)

The current dev gateway uses `@neondatabase/serverless@0.10.4`. When
moving to RDS Postgres (standard `pg` driver), be aware of:

1. **Boolean cast trick.** Some queries use `::int` on boolean columns
   (e.g. `WHERE active = true::int` patterns) because neon-serverless
   returned booleans as 0/1 integers in some edge cases. Standard `pg`
   returns true booleans — the cast is harmless on RDS but verify your
   COUNT/AGGREGATE queries don't rely on numeric-coerced bool.
2. **`db.execute(sql\`...\`)` returns null on empty result.** The neon
   driver throws when destructuring `.rows` on an empty SELECT. The
   parity script uses `pg.Pool` directly to dodge this. Safe to migrate.
3. **No `CREATE EXTENSION` on Neon serverless from dev.** The `pgvector`
   and `tsvector` extensions are pre-enabled. On RDS you must create
   them manually post-deploy: `CREATE EXTENSION vector; CREATE
   EXTENSION pg_trgm;`.
4. **Connection pool size.** Neon serverless multiplexes; RDS does not.
   Set `pg.Pool({ max: 20 })` or use PgBouncer to avoid connection
   exhaustion under SDK load (each org × tier = up to 600 req/min).
5. **`Drizzle eq(undefined, …)` trap.** Drizzle ORM silently produces an
   `IS NULL` clause when a query argument is `undefined`. Always
   validate IDs before passing them. The codebase has a few sites
   guarded by `if (!id) throw …` but a sweep is recommended on RDS
   cutover.

---

## 10. Parity guardrail (run this before every deploy)

```bash
pnpm db:parity              # strict — exit 1 on drift; CI must run this
pnpm db:parity:warn         # warn-only — used by `scripts/nv-start-dev.sh`
```

The script (`scripts/nv-schema-parity-check.ts`) does three things:

1. **Canonical assertions** (B1 + B2): `public.nv_statutes` and
   `public.sdk_api_request_logs` MUST exist; their `nv_schema`
   counterparts MUST NOT.
2. **Drizzle ↔ DB column parity.** For every Drizzle table export found
   in `shared/schema.ts` and `shared/nv-governance-schema.ts`, verifies
   the table exists in Postgres and every Drizzle column has a
   compatible DB type.
3. **Extra DB column report** (warn). Columns that exist in DB but not
   in Drizzle are surfaced as warnings — useful for catching ad-hoc
   migrations that bypassed the schema file.

**As of 2026-05-05** the strict run reports 17 violations and 19
warnings. The violations are pre-existing schema drift unrelated to B1
and B2 (e.g. `nv_voice_sessions`, `openBotAgents`, `payments`); they
should be cleaned up in a follow-up but do not block EC2 deploy
because none of those tables are on the SDK hot-path.

---

## 11. References

- `shared/schema.ts` — public-schema Drizzle definitions.
- `shared/nv-governance-schema.ts` — `nv_schema` Drizzle definitions
  (with REMOVED tombstones for B1 and B2).
- `scripts/consolidate-nv-statutes.sql` — B1 migration.
- `scripts/consolidate-sdk-api-request-logs.sql` — B2 migration.
- `scripts/nv-schema-parity-check.ts` — guardrail script.
- `.local/backups/nv_schema_*_pre_drop_2026-05-05.csv` — pre-drop CSVs
  for B1 and B2.
- Predecessor: `NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`
  (covered the original April migration; this 2026-05-05 doc covers the
  May consolidation passes B1 and B2).
