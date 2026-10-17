# Nyayavigya Platform 3.1.2 — Developer Audit Report

**Date:** 2026-05-04 | **Auditor:** Platform Architect | **Scope:** Full codebase  
**Commit:** `2e5b6b5` | **Deploy:** `2026-05-02T0946Z-replit-ssm-a558dbab`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Code Quality Findings](#3-code-quality-findings)
4. [Database Schema Audit](#4-database-schema-audit)
5. [Feature Completeness Matrix](#5-feature-completeness-matrix)
6. [Security Posture](#6-security-posture)
7. [Performance Considerations](#7-performance-considerations)
8. [Developer Onboarding Guide](#8-developer-onboarding-guide)
9. [Module-Level Edit Guide](#9-module-level-edit-guide)
10. [Recommendations & Roadmap](#10-recommendations--roadmap)

---

## 1. Executive Summary

The Nyayavigya Platform 3.1.2 is a production-grade Legal AI SDK gateway serving 7 Nyayasiddhi ecosystem platforms (NSP-WEB, NSP-MOBILE, Nyayamitra, NSI, NSA, NSM, JRX) — verified live on 2026-05-05 with all 7 SDK keys returning HTTP 200 across the 8-endpoint probe matrix (51/56 = 200, 5/56 = expected scope-deny 403, 0 × 5xx). The codebase is **functional and deployable** with 913 lines in the main entry point (`src/index.ts`), 79 route files, 150+ service files, and 3,774 lines of Drizzle ORM schema across 5 schema files. The platform supports 1,042 AI agents across 7 jurisdictions, 15 LLM models from 23 providers, 6 RAG pipeline variants, and a 5-tier memory system with field-level encryption.

### Strengths
- Well-structured middleware pipeline with clear ordering (security → rate-limit → auth → tenant → RLS → routes)
- Comprehensive agent registry (1,042 agents, jurisdiction-specific)
- Enterprise-grade RAG pipeline with hybrid search, reranking, and citation grounding
- Proper multi-tenant isolation (RLS + middleware + app-level)
- Consistent logging via `createLogger()` factory across all modules
- Idempotent seed scripts for reproducible deployments
- 9 startup validators that prevent misconfigured boots

### Areas Requiring Attention
- 5 "god files" exceeding 1,500 lines that should be decomposed
- 6 empty catch blocks that silently swallow errors
- Missing database indexes on ~20 foreign key columns
- Only 1 foreign key with `CASCADE` delete in the entire schema
- Inconsistent file naming prefix (`nv-` vs `nyv-` vs unprefixed)
- `jurisdiction` varchar length inconsistency (10 vs 50 across tables)

---

## 2. Architecture Overview

### 2.1 Project Structure

```
nyayavigya-platform-312/
├── src/                          # Backend (Express.js + TypeScript)
│   ├── index.ts                  # Main entry — 913 lines, all route mounts
│   ├── middleware/               # 31 middleware files
│   ├── routes/                   # 79 route files
│   ├── services/                 # 150+ service files (business logic)
│   ├── orchestration/            # 26 orchestration files (Queen, Smart Thinking, etc.)
│   ├── core/                     # Agent coordination, memory persistence, MCP hub
│   ├── startup/                  # 9 boot-time validators
│   ├── db/                       # Database initialization, pool management
│   ├── config/                   # Platform, CORS, rate-limit, LLM config
│   ├── guardrails/               # Input validation, injection prevention
│   ├── india-first/              # Indic languages, WhatsApp, UPI
│   ├── system-prompts/           # System prompt engine v10.0
│   └── utils/                    # Logger, env-validator, crypto helpers
├── client/                       # React frontend (Vite-powered)
│   └── src/                      # Components, features, hooks
├── packages/                     # SDK packages (6 total)
│   ├── client-sdk/               # NyvClient — 14 API classes
│   ├── client-sdk-react-native/  # NyvClientRN — mobile
│   ├── nyayamitra-sdk/           # NyayamitraClient — citizen tier
│   ├── enterprise-sdk/           # NyayavignyaEnterpriseClient
│   ├── react-hooks/              # 17 React hooks
│   └── types/                    # Shared TypeScript definitions
├── shared/                       # Drizzle ORM schemas (3,774 lines total)
│   ├── schema.ts                 # 1,813 lines — core tables
│   ├── nv-schema-tables.ts       # 567 lines — nv_schema namespace
│   ├── nv-governance-schema.ts   # 1,333 lines — 67+ governance tables
│   ├── nyayamitra-schema.ts      # 32 lines
│   └── nyayasiddhi-institutional-schema.ts  # 29 lines
├── config/                       # External config (agents, LLM, platforms)
│   ├── agents/                   # agents-master.json (267 agent definitions)
│   ├── agent-registries/         # 7 jurisdiction registries
│   ├── llm/                      # LLM provider config
│   ├── platforms/                # 5 platform definitions
│   └── rate-limits/              # Per-tier rate limit config
├── drizzle/                      # 7 migration SQL files (0000-0006)
├── scripts/                      # Deploy, seed, SDK bundle scripts
├── docs/                         # Documentation
├── infra/                        # Terraform, Caddy proxy
└── k8s/                          # Kubernetes manifests, Helm charts
```

### 2.2 Request Lifecycle

```
Client Request
  → Helmet (security headers)
  → Request ID (UUID tracing)
  → HTTP Compression
  → CORS (allowlist + Replit/Nyayasiddhi regex)
  → JSON/URL parsing (50MB limit)
  → Request Metrics (histogram)
  → Rate Limiting (public 30/min → auth 120/min → AI 20/min → enterprise 500/min → SDK 200/min)
  → Redis Platform Rate Limiter (sliding window)
  → Response Signing (NSP X-NYV-Signature)
  → Structured Request Logger
  → Tenant Isolation (cross-tenant 403)
  → Org RLS Middleware (SET LOCAL app.current_org_id)
  → Route Handler (auth within handler: JWT or SDK key)
  → Error Handler (global catch)
```

### 2.3 Middleware Pipeline (Order-Sensitive)

| Order | Middleware | File | Purpose |
|---|---|---|---|
| 1 | `helmet` | built-in | Security headers, HSTS, CSP |
| 2 | Request ID | inline | UUID per request |
| 3 | `compression` | built-in | gzip level 6, >1KB |
| 4 | CORS | `src/index.ts` | Origin allowlist |
| 5 | Body parsers | express built-in | JSON + URL 50MB |
| 6 | `nyvRequestMetricsMiddleware` | `nyv-request-metrics.ts` | Histogram for admin dashboard |
| 7 | `publicRateLimit` | `nv-rate-limit-middleware.ts` | 30/min all public |
| 8 | `authLoginRateLimit` | `nv-rate-limit-middleware.ts` | 10/15min login |
| 9 | `authenticatedRateLimit` | `nv-rate-limit-middleware.ts` | 120/min with JWT |
| 10 | `aiPatternRateLimit` | `nv-rate-limit-middleware.ts` | 20/min AI patterns |
| 11 | `enterpriseRateLimit` | `nv-rate-limit-middleware.ts` | 500/min enterprise |
| 12 | `sdkApiKeyRateLimit` | `nv-rate-limit-middleware.ts` | 200/min SDK keys |
| 13 | `createRedisPlatformRateLimiter` | `nv-redis-platform-rate-limiter.ts` | Per-platform sliding window |
| 14 | `nvResponseSigningMiddleware` | `nv-response-signing-middleware.ts` | HMAC sign for NSP |
| 15 | `tenantIsolation` | `nv-tenant-isolation.ts` | Cross-tenant 403 |
| 16 | `orgRlsMiddleware` | `nv-org-rls-middleware.ts` | Postgres RLS binding |

### 2.4 Database Architecture

- **ORM:** Drizzle ORM with PostgreSQL
- **Driver:** Auto-detects Neon serverless (Replit) vs pg (AWS/Docker)
- **Multi-DB:** Supports isolated pools for NV, NS, NM products
- **RLS:** Row Level Security via `SET LOCAL app.current_org_id` in transactions
- **Encryption:** Field-level PGP encryption via `pgp_sym_encrypt`/`pgp_sym_decrypt`
- **Migrations:** 7 SQL migrations (0000-0006) with safety checks at boot

---

## 3. Code Quality Findings

### 3.1 God Files (>1,500 lines) — MUST DECOMPOSE

| File | Lines | Issue | Recommended Split |
|---|---|---|---|
| `src/services/real-llm-service.ts` | 2,753 | All LLM ops in one file: provider health, routing, context engineering, request orchestration | Split into `llm-health-monitor.ts`, `llm-intelligent-router.ts`, `llm-context-engine.ts`, `llm-request-executor.ts` |
| `src/routes/nv-sdk-gateway-routes.ts` | 2,467 | 30+ endpoints across agents, documents, research, payments, OCR, cache | Split by domain: `sdk-agent-routes.ts`, `sdk-document-routes.ts`, `sdk-research-routes.ts`, `sdk-payment-routes.ts` |
| `src/routes/nv-orchestration-routes.ts` | 2,095 | Complex orchestration logic embedded in route handlers | Extract orchestration logic to service layer; keep routes thin |
| `src/services/nv-orchestration-services.ts` | 1,799 | 20+ service classes in one file (Hallucination, HITL, Citation, etc.) | Each class → own file in `src/services/orchestration/` |
| `src/services/nyayavigya-document-templates-service.ts` | 1,747 | Template definitions + processing logic | Split templates data → config file; processing → service |

**Impact:** These files are difficult to navigate, review, and test. When multiple developers edit them simultaneously, merge conflicts are frequent. Splitting them improves maintainability without changing any API surface.

### 3.2 Empty Catch Blocks (Silent Error Swallowing)

| File | Line | Context | Fix |
|---|---|---|---|
| `src/routes/nv-orchestration-routes.ts` | 1551 | Orchestration error silently dropped | Add `logger.warn('orchestration fallback', { err })` |
| `src/routes/nv-enterprise-admin-routes.ts` | 563 | Admin operation failure hidden | Add `logger.error('admin op failed', { err })` |
| `src/routes/nv-sdk-gateway-routes.ts` | 85 | SDK request logging failure | Add `logger.warn('sdk log write failed', { err })` |
| `src/routes/nv-sdk-gateway-routes.ts` | 108 | SDK metrics failure | Add `logger.warn('sdk metrics failed', { err })` |
| `src/services/nv-phase4-services.ts` | 1490 | Phase 4 operation failure | Add `logger.warn('phase4 fallback', { err })` |
| `src/services/nv-phase4-services.ts` | 1505 | Phase 4 operation failure | Add `logger.warn('phase4 fallback', { err })` |

**Impact:** Silent failures make debugging production issues extremely difficult. Errors are lost without any trace in logs. These should all log at minimum `warn` level.

### 3.3 Naming Inconsistency

The codebase uses three different file prefixes inconsistently:

| Prefix | Count | Examples | Convention |
|---|---|---|---|
| `nv-` | ~60 files | `nv-auth.ts`, `nv-error-handler.ts` | Original Nyayavigya naming |
| `nyv-` | ~15 files | `nyv-rag-pipeline-enhanced.ts`, `nyv-feature-flag-manager.ts` | Newer Nyayavigya naming |
| No prefix | ~10 files | `auth.ts`, `case-management-service.ts` | Legacy/external |

**Recommendation:** Standardize on `nv-` prefix (existing majority). Do not rename existing files in a single commit — instead, adopt `nv-` for all new files and gradually rename during module work.

### 3.4 Code Organization — Positive Findings

- **Layered architecture** is broadly maintained: Routes → Services → DB. Some route files (14 of 79) import `sql` from `drizzle-orm` for inline queries — this is an acceptable pragmatic pattern for simple SQL but should be refactored to service calls for complex business logic.
- **Consistent logger factory:** All 150+ service files use `createLogger('module-name')` — no stray `console.log` statements in production code.
- **Structured error handling** via `nv-error-handler.ts` with request ID correlation.
- **Config externalization:** Agent definitions, LLM configs, platform definitions are in `config/` JSON files, not hardcoded in services.
- **Startup validators** (9 files in `src/startup/`) prevent boot with invalid config — JWT strength, migration safety, audit chain integrity, jurisdiction prompt invariants.

---

## 4. Database Schema Audit

### 4.1 Schema Overview

| Schema File | Lines | Tables | Purpose |
|---|---|---|---|
| `shared/schema.ts` | 1,813 | ~50 | Core: users, orgs, sessions, SDK apps, documents, agents, HITL |
| `shared/nv-schema-tables.ts` | 567 | ~15 | nv_schema namespace: AI credits, audit, marketplace, AGUI |
| `shared/nv-governance-schema.ts` | 1,333 | 67+ | Governance: bias audits, case updates, adversarial tests |
| `shared/nyayamitra-schema.ts` | 32 | 2 | Nyayamitra-specific tables |
| `shared/nyayasiddhi-institutional-schema.ts` | 29 | 2 | Institutional onboarding |
| **Total** | **3,774** | **~136** | |

### 4.2 Missing Indexes (Performance-Critical)

The following foreign key columns lack indexes, which will cause slow JOINs and lookups as data grows:

| Table | Column | Why Needed |
|---|---|---|
| `sdk_applications` | `organization_id` | Filter apps by org |
| `sdk_app_api_keys` | `application_id` | Join keys to apps |
| `sdk_app_agent_allocations` | `application_id` | Agent allocation lookups |
| `sdk_usage_metering` | `application_id`, `agent_id` | Usage dashboards |
| `sdk_workflows` | `application_id` | Workflow lookups |
| `sdk_workflow_executions` | `workflow_id`, `application_id` | Execution history |
| `document_parsing` | `user_id`, `status` | Document pipeline queries |
| `document_pages` | `document_id` | Page retrieval |
| `document_extracted_content` | `document_id` | Content retrieval |
| `document_processing_jobs` | `document_id`, `status` | Job queue queries |
| `wai_email_accounts` | `user_id`, `organization_id` | Email account lookups |
| `wai_emails` | `account_id` | Email retrieval |

**Fix:** Add a migration `0007_add_missing_indexes.sql` with `CREATE INDEX CONCURRENTLY` statements. Use `CONCURRENTLY` to avoid table locks in production.

### 4.3 Missing NOT NULL Constraints

Several columns that logically should never be null are nullable:

| Table | Column | Should Be |
|---|---|---|
| `sdk_applications` | `organization_id` | `NOT NULL` — every app belongs to an org |
| `sdk_app_api_keys` | `application_id` | `NOT NULL` — every key belongs to an app |
| `document_parsing` | `user_id` | `NOT NULL` — every document has an uploader |
| `document_pages` | `document_id` | `NOT NULL` — every page belongs to a document |
| `document_extracted_content` | `document_id` | `NOT NULL` — every extraction has a source |
| `document_processing_jobs` | `document_id` | `NOT NULL` — every job processes a document |

**Impact:** Nullable foreign keys prevent Postgres from enforcing referential integrity, allowing orphaned rows. Fix in a new migration with `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` after backfilling any NULL values.

### 4.4 Missing CASCADE Deletes

Only 1 table in the entire schema uses `CASCADE` delete (`nv_template_clauses.template_id`). This means deleting a parent record (e.g., an organization, a document, an SDK application) will either fail with a foreign key violation or leave orphaned child rows.

**Priority tables needing CASCADE:**
- `sdk_app_api_keys` → `sdk_applications` (delete app → delete all keys)
- `sdk_app_agent_allocations` → `sdk_applications` (delete app → delete allocations)
- `document_pages` → `document_parsing` (delete document → delete pages)
- `document_extracted_content` → `document_parsing` (delete document → delete content)
- `document_processing_jobs` → `document_parsing` (delete document → delete jobs)
- `sdk_workflow_executions` → `sdk_workflows` (delete workflow → delete executions)

### 4.5 RLS Coverage Gaps

Migration `0004` applies RLS to tables matching `nv_*`, `ns_*`, `ni_*`, `nm_*` prefixes with an `org_id` column. The following tables have `org_id` but use a different prefix, so they are **NOT covered by RLS**:

| Table | Has `org_id` | RLS Applied | Risk |
|---|---|---|---|
| `sdk_applications` | Yes (`organization_id`) | No | SDK apps readable across tenants |
| `wai_email_accounts` | Yes (`organization_id`) | No | Email accounts readable across tenants |
| `pii_vault` | Yes (implicit) | No | PII data potentially cross-tenant |
| `rag_namespaces` | Yes (implicit) | No | RAG namespace isolation gap |

**Fix:** Add explicit RLS policies for these tables in a new migration `0007`, or rename columns to match the `org_id` convention used by the RLS loop.

### 4.6 Varchar Length Inconsistencies

The `jurisdiction` column uses different lengths across tables:

| Table | Column | Length |
|---|---|---|
| `sdk_applications` | `jurisdiction` | `varchar(10)` |
| `template_library` | `jurisdiction` | `varchar(10)` |
| `jurisdiction_profiles` | `jurisdiction_code` | `varchar(10)` |
| `sdk_compliance_controls` | `jurisdiction` | `varchar(50)` |
| `sdk_document_templates` | `jurisdiction` | `varchar(50)` |

**Recommendation:** Standardize to `varchar(10)` since jurisdiction codes are 2-letter ISO codes (IN, UK, EU, US, GC, SG). Tables with `varchar(50)` waste storage and create confusion about what values are valid.

### 4.7 Migration Integrity

| Migration | Purpose | Status |
|---|---|---|
| `0000_even_red_skull.sql` | Initial schema | Applied |
| `0001_fine_gravity.sql` | Schema additions | Applied |
| `0002_cold_marvel_zombies.sql` | Schema additions | Applied |
| `0003_premium_black_tom.sql` | Schema additions | Applied |
| `0004_enable_rls_for_tenant_tables.sql` | RLS + field encryption | Applied |
| `0005_sdk_key_hash_index.sql` | SDK key performance | Applied |
| `0006_unify_sdk_key_tables.sql` | SDK key table cleanup | Applied |

All 7 migrations are tracked in `drizzle/__drizzle_migrations` with hashes. Migration safety checks run at boot via `nv-migration-safety-runner.ts`.

---

## 5. Feature Completeness Matrix

### 5.1 Core Platform Features

| Feature | Status | Implementation | Notes |
|---|---|---|---|
| **Session Management** | COMPLETE | `nv-auth.ts` (352 lines) | JWT (4h) + Refresh (7d) + rotation + 6h cleanup |
| **Memory Management (5-Tier)** | COMPLETE | `nv-5tier-memory-service.ts` (447 lines) | L1 in-memory → L2-L5 Postgres with encryption |
| **Organization Management** | COMPLETE | `nv-org-rls-middleware.ts` + schema | Multi-tenant with RLS |
| **Document Storage** | COMPLETE | `document-processor.ts` + pipeline | PDF/DOCX/TXT/MD/HTML/JSON/CSV ingestion |
| **Document Automation** | COMPLETE | `nv-document-intelligence-orchestrator.ts` | Full pipeline: ingest → parse → embed → search |
| **Summarization** | COMPLETE | `nv-legal-summarizer-service.ts` | Legal-specific summarization with citation |
| **Drafting** | COMPLETE | `nyayavigya-document-templates-service.ts` (1,747 lines) | Template library with jurisdiction variants |

### 5.2 AI & Intelligence Features

| Feature | Status | Implementation | Notes |
|---|---|---|---|
| **AI Intelligence** | COMPLETE | `src/services/intelligence/` | Conflict detection, amendment impact, regulatory monitoring |
| **AI Embedding** | COMPLETE | `nv-legal-embedding-service.ts` | OpenAI + pgvector, namespace-isolated |
| **Agent Orchestration** | COMPLETE | `nv-queen-orchestrator.ts` + 26 orchestration files | Meta-orchestrator with ACONIC/ADaPT algorithms |
| **Chain of Thought** | COMPLETE | `chain-of-thought-service.ts` | Multi-step reasoning with Smart Thinking Engine |
| **LLM Orchestration** | COMPLETE | `real-llm-service.ts` (2,753 lines) + `unified-llm-adapter.ts` | 23 providers, 15 models, circuit breaking, cost tracking |
| **Prompt Engineering** | COMPLETE | `nyayavigya-system-prompts-engine-v10.ts` | Universal Agent Framework v10, ROMA-level overrides |
| **Context Engineering** | COMPLETE | `context-engineering-service.ts` + `nv-prompt-enhancement-pipeline.ts` | High-signal context assembly with citations |

### 5.3 RAG Pipeline Variants

| RAG Type | Status | File | Description |
|---|---|---|---|
| **Hybrid RAG** | COMPLETE | `nyv-rag-pipeline-enhanced.ts` (753 lines) | Vector (pgvector) + BM25, alpha=0.65 |
| **Adaptive RAG** | COMPLETE | `adaptive-rag-service.ts` | Complexity-based routing (vector/web/LLM) |
| **Corrective RAG** | COMPLETE | `corrective-rag-service.ts` | Self-correction on retrieval quality |
| **Self-RAG** | COMPLETE | `self-rag-service.ts` | Hallucination detection in retrieval |
| **GraphRAG** | COMPLETE | `nyv-graphrag-legal-service.ts` | Multi-hop traversal over legal entity graphs |
| **LightRAG** | COMPLETE | `nyv-lightrag-pipeline.ts` | Entity/relationship graph extraction |

### 5.4 Platform Services

| Feature | Status | Implementation | Notes |
|---|---|---|---|
| **22 Agentic Patterns** | COMPLETE | `nv-patterns-routes.ts` | ReAct, CoT, ToT, Reflect, Plan+Exec, etc. |
| **Digital Twins** | COMPLETE | `digital-twin-service.ts` | Monte Carlo simulation, benchmarking |
| **Skills Marketplace** | COMPLETE | `nv-skills-routes.ts` | Composable capability marketplace |
| **WhatsApp Channel** | COMPLETE | `nv-whatsapp-service.ts` | Business API integration |
| **Voice/STT** | COMPLETE | `nvv-voice-service-enhanced.ts` | 47 languages, WebSocket streaming |
| **Payments (Razorpay)** | COMPLETE | `razorpay-payment-service.ts` | UPI, cards, subscriptions, invoices |
| **GST Engine** | COMPLETE | `nv-gst-engine.ts` | 18% GST, GSTIN validation, PDF invoices |
| **Compliance** | COMPLETE | `eu-ai-act-compliance-service.ts` + `compliance/` | ISO 42001, SOC 2, EU AI Act, bias detection |
| **eCourts Integration** | COMPLETE | `nv-ecourts-client.ts` | India NIC eCourts API |
| **Feature Flags** | COMPLETE | `nyv-feature-flag-manager.ts` | Per-tenant, kill-switch, DB-synced |
| **Model Registry** | COMPLETE | `nv-model-catalog-seeding-service.ts` | Dynamic LLM/SLM registration |

---

## 6. Security Posture

### 6.1 Authentication

| Layer | Implementation | Strength |
|---|---|---|
| JWT Access Tokens | 4-hour expiry, HS256, forced secret validation at boot | Strong |
| Refresh Tokens | 64-byte random, SHA-256 hashed, one-time rotation | Strong |
| SDK API Keys | SHA-256 hashed, scope-limited, rate-limited per key | Strong |
| Inter-Service Auth | Dedicated `NV_INTER_SERVICE_SECRET` header | Strong |
| CSRF Protection | Origin guard on all auth mutation routes | Strong |
| Brute Force Protection | 10 attempts / 15 min on login/register | Strong |

### 6.2 Data Protection

| Layer | Implementation | Status |
|---|---|---|
| Field Encryption | PGP via pgcrypto extension | Active on voice, identity, memory, embeddings |
| PII Vault | In-memory (Replit) / Redis (AWS) with 5-min cleanup | Active |
| RLS | Postgres Row Level Security with `SET LOCAL` | Active (with gaps noted in §4.5) |
| Response Signing | HMAC SHA-256 on NSP responses | Active |
| Prompt Injection | 16-pattern regex scanner in SDK gateway | Active |

### 6.3 Security Gaps

| Gap | Severity | Recommendation |
|---|---|---|
| SDK app tables not under RLS | Medium | Add explicit RLS policies (see §4.5) |
| Empty catch blocks hide security failures | Medium | Add logging to all 6 empty catches |
| No request body size limit per-route | Low | Add per-route limits for file upload vs JSON |
| Redis connection falls back to in-memory | Low | Acceptable for dev; ensure Redis in production |

---

## 7. Performance Considerations

### 7.1 Current Metrics (from Gateway Logs)

- Startup time: ~8 seconds (DB + 1,042 agents + seeds + cache)
- Heap usage: ~488 MB RSS, 95% heap pressure observed
- Cache: In-memory LRU on Replit (Redis on AWS)
- DB pool: 1 pool, 2 pre-warmed connections, 30s health monitoring

### 7.2 Performance Recommendations

| Area | Issue | Fix |
|---|---|---|
| Heap pressure | 95% heap observed in logs | Increase `--max-old-space-size` to 1024+ in production |
| Missing indexes | 20+ FK columns without indexes | Add migration 0007 (see §4.2) |
| God file imports | Large files increase parse time | Split files (see §3.1) |
| Agent registry | 1,042 agents loaded at boot | Consider lazy loading for non-default jurisdictions |
| Vector eviction | Audit write skipped — missing `event_type` column | Add column to `nv_audit_logs` or disable audit for eviction |

---

## 8. Developer Onboarding Guide

### 8.1 Key Concepts

1. **Every request gets a UUID** — trace via `X-Request-ID` header and `req.requestId` property
2. **Two auth models** — JWT (user sessions) and SDK API Key (platform-to-platform). Never mix them.
3. **Tenant isolation** — RLS is enforced at DB level. Use `req.withTenant(async (tx) => ...)` for tenant-scoped queries.
4. **Logger factory** — Always use `const logger = createLogger('your-module')`. Never use `console.log`.
5. **Config over code** — Agent definitions, LLM configs, platform definitions are JSON in `config/`. Edit config, not services.

### 8.2 How to Add a New API Endpoint

1. Create route file: `src/routes/nv-<domain>-routes.ts`
2. Create service file: `src/services/nv-<domain>-service.ts`
3. Add schema if needed: `shared/schema.ts` or new schema file
4. Mount in `src/index.ts` at the appropriate position (before 404 handler)
5. Add to integration guide: `docs/v3.1.2/NYV-SDK-API-INTEGRATION-GUIDE-2026-05-04.md`

### 8.3 How to Add a New LLM Provider

1. Create provider file: `src/services/llm-providers/<name>-provider.ts`
2. Register in `src/services/llm-providers/provider-registry.ts`
3. Add config in `config/llm/<name>.json`
4. Add to model catalog seed: `src/services/nv-model-catalog-seeding-service.ts`

### 8.4 How to Add a New Agent

1. Add agent definition in `config/agents/agents-master.json`
2. Add jurisdiction-specific variant in `config/agent-registries/<jurisdiction>.json`
3. The agent registry auto-loads at boot — no code changes needed

---

## 9. Module-Level Edit Guide

This section maps every major module to its files, making it safe for developers to edit one module without breaking others.

### 9.1 Module Boundaries

| Module | Route File | Service File(s) | Schema | Safe to Edit Independently |
|---|---|---|---|---|
| **Authentication** | `nv-auth-routes.ts` | `nv-auth.ts` (middleware) | `nvUsers`, `nvSessions`, `nvAuthTokens` | Yes |
| **SDK Gateway** | `nv-sdk-gateway-routes.ts` | `nv-sdk-gateway.ts` (middleware) | `sdkApplications`, `sdkAppApiKeys` | Yes (but file is large) |
| **Orchestration** | `nv-orchestration-routes.ts` | `nv-orchestration-services.ts`, `orchestration/` | `nyayavigyaOrchestrationJobs` | Yes — but test end-to-end |
| **Legal Chat** | `nv-legal-chat-routes.ts` | `legal-chat-event-bus.ts` | `nvChatSessions` | Yes |
| **Documents** | `nv-document-orchestrator-routes.ts` | `document-pipeline/`, `document-processor.ts` | `documentParsing`, `documentPages` | Yes |
| **RAG** | `nv-rag-routes.ts` | `rag/` (6 files) | `nvRagDocuments`, `nvRagChunks` | Yes |
| **Memory** | `nv-memory-manager-routes.ts` | `memory/` (5 files) | `nvMatterMemory` → `nvPrecedentMemory` | Yes |
| **Agents** | `nv-agent-routes.ts` | `agent-registry-service.ts`, `agent-orchestration.ts` | `legalAgents`, `nvCustomAgents` | Yes |
| **Patterns** | `nv-patterns-routes.ts` | `nv-patterns-routes.ts` (inline) | None (stateless) | Yes |
| **Payments** | `nv-razorpay-routes.ts` | `razorpay-payment-service.ts` | None (external Razorpay API) | Yes |
| **Subscriptions** | `nv-subscription-routes.ts` | `nv-credit-service.ts` | `sdkUsageMetering` | Yes |
| **GST** | `nv-gst-routes.ts` | `nv-gst-engine.ts`, `gst-invoice-pdf-service.ts` | None (stateless) | Yes |
| **Compliance** | `nv-compliance-routes.ts` | `compliance/`, `eu-ai-act-compliance-service.ts` | `nvGovernanceSchema` tables | Yes |
| **Feature Flags** | `nv-feature-flags-routes.ts` | `nyv-feature-flag-manager.ts`, `feature-flags-service.ts` | `scopedFeatureFlags` | Yes |
| **WhatsApp** | `nv-whatsapp-routes.ts` | `nv-whatsapp-service.ts` | None | Yes |
| **Voice** | `nv-voice-ws-routes.ts` | `nvv-voice-service-enhanced.ts`, `nv-stt-service.ts` | `nvVoiceSessions` | Yes |

### 9.2 Dependency Graph (Critical Paths)

```
src/index.ts
  ├── src/middleware/* (independent of each other)
  ├── src/routes/* (each route imports its own services)
  │   └── src/services/* (services import from db/ and utils/)
  │       ├── src/db/index.ts (single DB connection)
  │       ├── shared/schema.ts (shared schema — changes here affect all services)
  │       └── src/utils/* (logger, crypto — stable, rarely changed)
  └── src/orchestration/* (depends on services/ and core/)
      └── src/core/* (agent registry, MCP hub — foundational)
```

**Rule of thumb:** Changes to `shared/schema.ts` or `src/db/index.ts` require full regression testing. Changes to a single route/service file are isolated.

---

## 10. Recommendations & Roadmap

### 10.1 Immediate (Next Sprint)

| # | Action | Priority | Effort |
|---|---|---|---|
| 1 | Fix 6 empty catch blocks → add `logger.warn()` | P1 | 30 min |
| 2 | Add missing indexes (migration 0007) | P1 | 2 hours |
| 3 | Add RLS policies for `sdk_applications`, `wai_email_accounts` | P1 | 1 hour |
| 4 | Increase `--max-old-space-size` in Docker/compose | P1 | 15 min |

### 10.2 Short-Term (2 Sprints)

| # | Action | Priority | Effort |
|---|---|---|---|
| 5 | Split `nv-sdk-gateway-routes.ts` into domain-specific routers | P2 | 4 hours |
| 6 | Split `real-llm-service.ts` into 4 focused files | P2 | 4 hours |
| 7 | Split `nv-orchestration-services.ts` into individual service files | P2 | 3 hours |
| 8 | Standardize `jurisdiction` varchar to `varchar(10)` everywhere | P2 | 1 hour |
| 9 | Add `NOT NULL` constraints to FK columns (after NULL backfill) | P2 | 2 hours |
| 10 | Add CASCADE delete on document pipeline + SDK app tables | P2 | 1 hour |

### 10.3 Medium-Term (Quarter)

| # | Action | Priority | Effort |
|---|---|---|---|
| 11 | Standardize file naming to `nv-` prefix | P3 | Gradual |
| 12 | Add automated API contract tests (OpenAPI spec validation) | P3 | 2 days |
| 13 | Add integration test suite for SDK client packages | P3 | 3 days |
| 14 | Implement connection pooling optimization for multi-DB mode | P3 | 1 day |
| 15 | Add database schema documentation (ERD generation) | P3 | 1 day |

---

## Appendix: File Counts

| Directory | Files | Total Lines |
|---|---|---|
| `src/middleware/` | 31 | ~4,500 |
| `src/routes/` | 79 | ~25,000 |
| `src/services/` | 150+ | ~50,000 |
| `src/orchestration/` | 26 | ~8,000 |
| `shared/` | 5 | 3,774 |
| `packages/` | 6 packages | ~5,000 |
| `config/` | ~30 files | ~15,000 |
| `drizzle/` | 7 SQL | ~1,500 |
| **Total backend** | **~330 files** | **~113,000 lines** |
