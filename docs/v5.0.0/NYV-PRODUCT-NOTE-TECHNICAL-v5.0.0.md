---
status: live
audience: architects, platform engineers, integrators on the 5 Nyayasiddhi platforms, SREs
version: 5.0.0 (GA cut — public/consumer-facing SDK suite version)
internal_platform_version: 3.1.2 (frozen until next major)
dev_test_live_milestone: 2026-05-03 (consumer-app cutover)
production_ga: 2026-05-15 (per Project-Tracker §1)
last_updated: 2026-05-01
supersedes: ../v3.1.2/completed_docs/NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md
---

# Nyayavigya Platform — Technical Product Note (v5.0.0 GA cut)

> **What this document is.** The single technical reference for the
> v5.0.0 GA cut: architecture, every route, every component group,
> every service domain, the data model, the SDK suite, the LLM
> orchestration internals, the deployment topology, the CI/CD reality,
> the database sync flow, and the tech stack. This document is the
> authoritative engineering view; the business-facing companion lives
> at [`NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`](./NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md).
>
> **Versioning reminder.** Public/consumer-facing SDK suite version is
> `5.0.0`. Internal platform `package.json` stays at `3.1.2` per the
> Project-Tracker §1 freeze. "v5.0.0" everywhere in this doc means
> "the GA-cut release train".

---

## 0a. What's new in v5.0.1 since v5.0.0 GA cut (technical delta — 2026-05-07)

| Surface | v5.0.0 state | v5.0.1 state |
|---|---|---|
| Gateway version string (`/health.version`) | `5.0.0` | **`5.0.1`** |
| Smoke (`scripts/nv-smoke-all-platforms.ts`) | 88 tests, no envelope capture | **102 PASS / 0 FAIL / 0 SKIP** with per-call envelope capture (84/102), 256 KiB envelope cap |
| SDK key coverage in smoke | NSP, NSPM, NSI, NSM, NYM | **All 7**: NSP, NSPM, NSI, NSA, NSM, NYM, JRX |
| `/api/nv/sdk/provision/validate` 500 on neon `.map()` | Crashed | **NYV-PROV-VAL-DEFENSIVE-001**: defensive try/catch returns `{ok:false}` with reason instead of 500 |
| Storage adapter | Two divergent code paths (S3 on EC2, ad-hoc Object-Storage on Replit) | **Single interface `src/services/storage/nv-object-storage.ts`** with `s3` (EC2) + `replit-object-storage` (Replit dev/publish) backends, identical key path `tenants/<orgId>/docs/<yyyy>/<mm>/<requestId>/<filename>` |
| Redis env-var aliases | 4 aliases routinely conflicting (`NYV_REDIS_URL`, `REDIS_URL`, `NYV_REDIS_WRITE_URL`, `NYV_REDIS_TCP_URL`) | **NV-SECRETS-001**: ONE canonical write var `NYV_REDIS_TCP_URL` + ONE canonical read var `NYV_REDIS_READ_URL`. Legacy aliases honoured with one-shot `DEPRECATED` warning. CI grep enforces 7-file whitelist |
| Read-replica resolution | None | **`resolveRedisReadUrl()`** in `src/utils/redis-tcp-url.ts`. Falls back to primary when read URL absent. ElastiCache `nyscluster` master + replica URLs provisioned in Replit Secrets vault (cutover deferred — `nyv-dev-edge-redis` remains live) |
| `nv-shared-docs-routes.ts` fallback fetch (NV-ARCH-001 violation) | Direct `fetch()` to bypass safety ring | **Removed**. All shared-doc routes now traverse the safety ring |
| Env-parity script | None | **`scripts/nv-verify-env-parity.ts`** + canonical doc `docs/canonical/06-environment-parity-2026-05-07.md` |
| Pre-deploy plan | Ad-hoc per push | **`docs/canonical/07-pre-deploy-plan-2026-05-07.md`** — stepped runbook with rollback gates |
| Canonical doc set | 1 (`SDK-ENDPOINTS-CANONICAL`) | **5 under `docs/canonical/`**: 00 README, 04 SDK+API, 04b live probe, 06 env parity, 07 pre-deploy |

No new architectural layers. v5.0.1 is a hardening / parity / observability point release.

---

## 0b. What's new in v5.0.2 since v5.0.1 (technical delta — 2026-05-10)

`v5.0.2` is a **trust + reliability** point release. Six concrete changes
landed; all are CI-guarded or end-to-end-verified.

| # | Surface | v5.0.1 state | v5.0.2 state |
|---|---|---|---|
| 1 | SDK auth header | Multiple historical headers honoured (`X-API-Key`, `X-NV-SDK-Key`, `X-SDK-Key`, `X-NYV-Key`, `X-Platform-Key`); each route did its own `extractApiKey()` | **`NV-AUTH-HEADER-001` (CI-enforced)** — single canonical header `X-API-Key` with `Authorization: Bearer <key>` fallback. Sole extractor: `extractSdkApiKey` from `src/middleware/nv-sdk-auth-header.ts`. East-west `X-NV-API-Key` reserved for `nv-inter-service-auth.ts`. Guardrail: `bash scripts/nv-check-auth-header-discipline.sh` (alias `npm run guardrail:auth-header`). |
| 2 | Standalone-script DB driver | Some scripts used `@neondatabase/serverless` HTTP driver against helium dev DB / RDS — UPDATE/INSERT silently returned `rowCount=0` (Session-7 lost ~30 min to this) | **`NV-DB-SCRIPT-001` (CI-enforced)** — every file under `scripts/` MUST use `makePgSql()` from `scripts/_pg-pool.ts` (real `pg.Pool` with SSL + pooling). Runtime is already driver-aware (picks `pg` vs `neon-serverless` by hostname). Guardrail: `bash scripts/nv-check-script-db-driver.sh` (alias `npm run guardrail:script-db`). |
| 3 | `rotateRefreshToken` correctness | Two latent bugs 401'd every legit refresh, but the harness to prove it didn't exist | **`NV-AUTH-FIX-2026-05-10`** — fixes in `src/middleware/nv-auth.ts`: (a) `String(stored.user_id) !== String(userId)` (was strict `!==` between pg `1` and JSON `"1"`); (b) `FROM nv_users` with `org_id AS organization_id` (was `FROM users` referencing a non-existent table; canonical column is `org_id` not `organization_id`). Verified by **NS-3 8/8 PASS** harness (login → /me → refresh → /me with rotated → replay-401 → garbage-401 → logout → post-logout-401). |
| 4 | Session lifetimes | `jwtExpiryHours = 4`, `refreshTokenExpiryDays = 30`; `expiresIn` hard-coded `14400` in `nv-auth-routes.ts` (drift risk vs config) | **`NV-AUTH-LIFETIME-2026-05-10`** — `SECURITY_CONFIG.session.jwtExpiryHours = 24`, `refreshTokenExpiryDays = 90` in `src/config/platform-config.ts`; `expiresIn` in `src/routes/nv-auth-routes.ts` now derives from `SECURITY_CONFIG` (single source of truth). **Tighten back to 4h/30d before broader prod rollout** (commented at site). |
| 5 | Production deployment posture | Replit publish staged, EC2 prod live | **All three envs LIVE simultaneously**: Replit publish (`*.replit.app`, commit `c28813e`, deployed 2026-05-10), EC2 prod (`api.nyayasiddhi.online` / `console.nyayasiddhi.online` — image `:proxyfix-20260507T042014Z`), Replit dev (`http://localhost:5000` — same code). Both auth-header + script-DB guardrails GREEN on all three. |
| 6 | Architectural guardrail set | NV-ARCH-001, NV-LLM-001, NV-NAMING-001, NV-WIRING-001, NV-DOC-001, NV-SECRETS-001, NV-DOC-ACCESS-DEV | **+ NV-CONTRACT-001 (2026-05-09)** — pre-flight grep for method/route/schema/env/vendor/network names; **+ NV-OWNERSHIP-001 (2026-05-09)** — every test failure reproduced with `curl`/`psql`/`redis-cli` and traced to ONE owning component before "upstream" attribution; **+ NV-AUTH-HEADER-001 (2026-05-10, CI)** — see #1; **+ NV-DB-SCRIPT-001 (2026-05-10, CI)** — see #2. |

### NS-3 evidence — 8/8 PASS (Replit dev, 2026-05-10)

```
[1/8] login                                   → 200 ✓ user=admin@nyayavigya.in expiresIn=86400s (24h)
[2/8] /me with access token                   → 200 ✓
[3/8] refresh                                 → 200 ✓ both tokens rotated
[4/8] /me with rotated token                  → 200 ✓
[5/8] replay old refresh        (expect 401)  → 401 ✓
[6/8] garbage refresh           (expect 401)  → 401 ✓
[7/8] logout                                  → 200 ✓
[8/8] post-logout refresh with R2 (exp 401)   → 401 ✓ (revokeAll worked)
```

Architect review of the auth fixes: **APPROVED** (5/5 PASS — userId
normalization, `nv_users` correction, `org_id` alias, lifetime change
guarded, derived `expiresIn` prevents client/server drift).

### NV-LLM-001 whitelist (unchanged, restated for completeness)

`realLLMService.executeRequest|new RealLLMService(` may resolve only in:
1. `src/services/llm-providers/real-llm-service.ts` (definition)
2. `src/services/intelligent-router/orchestrate-llm.ts` (sole router)
3. `src/orchestration/nv-queen-orchestrator.ts` (Queen)
4. `src/services/llm-providers/agent-zero-cascade.ts` (priority-99 backup)
5. `src/services/llm-providers/__tests__/*` (tests)
6. `scripts/nv-smoke-all-platforms.ts` (smoke harness)
7. `scripts/nv-llm-router-probe.ts` (router probe)

All other call sites must traverse `orchestrateLLM(req)` exclusively.

### Files touched in v5.0.2

| File | Purpose |
|---|---|
| `src/middleware/nv-sdk-auth-header.ts` | Canonical `extractSdkApiKey` (NS-1) |
| `src/middleware/nv-auth.ts` | `rotateRefreshToken` two-line fix (NS-3) |
| `src/middleware/nv-inter-service-auth.ts` | East-west `X-NV-API-Key` (separated) |
| `src/config/platform-config.ts` | Session lifetime bump (NV-AUTH-LIFETIME-2026-05-10) |
| `src/routes/nv-auth-routes.ts` | `expiresIn` derived from `SECURITY_CONFIG` |
| `scripts/_pg-pool.ts` | `makePgSql()` helper (NS-2) |
| `scripts/nv-check-auth-header-discipline.sh` | Guardrail NV-AUTH-HEADER-001 |
| `scripts/nv-check-script-db-driver.sh` | Guardrail NV-DB-SCRIPT-001 |
| `replit.md` | Two new gotchas + four new guardrail entries |

No schema changes. No new tables. No SDK package version bumps.
v5.0.2 is observability + correctness only.

---

## 0. What's new in v5.0.0 since v3.1.2 (technical delta)

| Surface                          | v3.1.2 state                                                    | v5.0.0 state                                                                 |
|----------------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------------|
| SDK packages published           | 3 (intermittent — 3 of 6 silently 404)                          | **6, all at v5.0.0** in `s3://nyayavigya-sdk-devapp/sdk/`                    |
| `/downloads/sdk` allowlist       | 3 packages                                                      | **6 packages** (all published packages)                                      |
| `/create-app` default scopes     | `'{*}'` wildcard (CWE-285 risk)                                 | `['agents:read','agents:execute','research:read']`                           |
| Bare wildcard scopes path        | Available to any caller                                         | `super_admin` + explicit `wildcard_override:true` only                       |
| Provisioning route mount order   | Below console router → 401 preempt                              | Above console router → reaches handler                                       |
| Quickstart payload in `/create-app` | Stale endpoint path + body field `task`                      | `req.protocol/host` based, path `/api/nv/gateway/agents/:agentId/execute`, body field `prompt` |
| EC2 dev gateway                  | Healthy v5.0.0 with caveats §11 1–10                            | Healthy v5.0.0; §11 5/7/8/9/10 RESOLVED; #1/#3/#6 carry-over (R1, E1)        |
| Replit→EC2 deploy script         | `deploy-replit-direct.sh` (SSH, never worked from Replit)       | `scripts/deploy-replit-ssm.sh` (S3 + SSM/base64; current canonical)          |
| SDK build script                 | `scripts/build-all-sdks.sh` (wrong package list, `--silent` masks ERESOLVE) | Per-package `pnpm --filter <pkg> build && pnpm pack` (loud failures)         |
| Stale tracker                    | `Project-Tracker-Nyayavigya-SDK-312.md` mixed with current      | Archived to `archive/2026-05-01-pre-may3-cleanup/docs/`                      |
| Status doc                       | `PRE-GA-STATUS-2026-04-25.md`                                   | `PRE-GA-STATUS-2026-05-03.md` (R1–R5, E1–E5 carry-overs tracked)             |

No new architectural layers. No new tables. No new SDK packages beyond
the 6 already shipped. v5.0.0 is the GA-locking of v3.1.2 + SDK suite
v5.0.0 with the May-3 fixes applied.

---

## 1. Executive Summary (Engineering View)

Nyayavigya is a **Node.js / TypeScript / Express** monolith on Docker
running behind Caddy on a single EC2 instance in `ap-south-1` (Mumbai),
with **PostgreSQL** (RDS) for transactional data and the audit chain,
**Redis** (ElastiCache) for hot cache, queues, and prompt-cache,
**pgvector** for RAG embeddings, and **S3** for SDK distribution and
deploy artifacts. The application code is organised into **30 src/
component groups**, **79 Express route files**, and **29 service
domains**; the SDK suite is **6 npm packages** under `packages/`.

The runtime exposes:

- An **operator surface** (`/api/nv/*` — console, admin, health, audit).
- An **SDK surface** (`/api/nv/sdk/*` and `/api/nv/gateway/*` — provision,
  agents, research, voice, downloads).
- A **public surface** (`/health`, `/openapi.json`).

Every privileged write goes through one unified **audit hash chain**
(SHA-256 linked) verified strict-OK as of the May-1 deploy.

The orchestration core is the **Queen orchestrator** (one per
jurisdiction × 6 + 1 DEFAULT) sitting above 148 specialist agents per
jurisdiction. The Queen runs the **22 agentic patterns** (P1–P22)
including hierarchical task allocation, ensemble voting, debate, ReAct,
Tree-of-Thought, and self-consistency.

The dependency graph: **Express + tsx (no `dist/` in container — `tsx
src/index.ts` runs directly), Drizzle ORM (PostgreSQL), ioredis
(ElastiCache), BullMQ (queue), Opossum (circuit breakers), Zod (input
validation), JSON Web Token (operator auth), bcrypt (password hashing),
Sarvam SDK (Indic voice), OpenRouter SDK (LLM rotation), OpenAI SDK
(fallback)**. The frontend console is **React + Vite** under `client/`.

---

## 2. The Problem We Solve (Technical Restatement)

The platform's job is to take an opaque legal request — possibly in any
of 22 Indian languages, possibly as voice, possibly with a document
attachment — and emit a structured answer that:

- knows the right jurisdiction non-negotiably,
- carries verifiable citations,
- is multi-tenant safe (no data crossover),
- is recorded in an audit chain that can be replayed,
- happens through one of N model providers picked at runtime by a
  composite scorer, with circuit breakers in front of every provider,
- streams progress back to the consumer in real time, and
- survives a forward-only schema migration without disruption.

Every architectural decision below is in service of one of those
non-negotiables.

---

## 3. The Nyayasiddhi Ecosystem (Wiring View)

```
                                ┌─────────────────────────────┐
                                │   Caddy reverse proxy (TLS) │
                                └──────────────┬──────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │   nyv-gateway (single Docker│
                                │   container, tsx src/index) │
                                └──┬─────────────────────────┬┘
        ┌───────────────────────────┘                         └───────────────────────────┐
        │                                                                                 │
        ▼                                                                                 ▼
 ┌──────────────┐   ┌────────────────┐   ┌────────────────┐   ┌──────────────┐   ┌──────────────┐
 │ NYM (mobile) │   │ NSP (web+mob)  │   │ NSI (web)      │   │ NSA (web)    │   │ NSM (web)    │
 │ + nyayamitra │   │ + client-sdk   │   │ + enterprise   │   │ + enterprise │   │ + enterprise │
 │   -sdk       │   │ + react-hooks  │   │   -sdk         │   │   -sdk       │   │   -sdk       │
 │ + RN sdk     │   │                │   │ + RBAC          │   │ + ensembles  │   │ + analytics  │
 └──────────────┘   └────────────────┘   └────────────────┘   └──────────────┘   └──────────────┘
        │                  │                    │                   │                   │
        └──────────────┬───┴────────────────────┴───────────────────┴───────────────────┘
                       │
                       ▼
                Each consumer holds a per-platform SDK key:
                nyv_live_sk_<NYM|NSP|NSI|NSA|NSM>_<48 chars>
```

Within `nyv-gateway`:

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                         Express app (src/index.ts)                          │
 │   ┌──────────────────────────────────────────────────────────────────┐       │
 │   │  Mounted routers (79 files in src/routes/) — see §4 catalogue   │       │
 │   └──────────────────────────────────────────────────────────────────┘       │
 │                                  │                                          │
 │     Auth middleware (JWT for console; SDK key for /api/nv/sdk/*)            │
 │                                  │                                          │
 │   ┌─────────────┐   ┌──────────────────┐   ┌────────────────┐               │
 │   │ Orchestrator│   │ Service domains  │   │ RAG retriever  │               │
 │   │ (Queen)     │   │ (29 dirs)        │   │ (pgvector)     │               │
 │   └──────┬──────┘   └────────┬─────────┘   └────────┬───────┘               │
 │          │                   │                      │                        │
 │   ┌──────▼─────────┐   ┌─────▼─────────┐   ┌────────▼──────┐                │
 │   │ Agent registry │   │ LLM router    │   │ Memory (mem0) │                │
 │   │ (148+1 × 6)    │   │ (OpenRouter,  │   │               │                │
 │   │                │   │  OpenAI,      │   │               │                │
 │   │                │   │  Sarvam)      │   │               │                │
 │   └────────────────┘   └───────┬───────┘   └───────────────┘                │
 │                                │                                            │
 │   ┌──────────────────┐   ┌─────▼──────┐   ┌──────────────────┐              │
 │   │ Audit hash chain │◄──┤ Circuit    │   │ BullMQ queue     │              │
 │   │ (Postgres)       │   │ breakers   │   │ (Redis)          │              │
 │   │                  │   │ (Opossum)  │   │                  │              │
 │   └──────────────────┘   └────────────┘   └──────────────────┘              │
 └──────────────────────────────────────────────────────────────────────────────┘
                  │                                   │
                  ▼                                   ▼
           PostgreSQL (RDS)                   Redis (ElastiCache)
           — 7 drizzle migrations             — cache, queue, prompt-cache
```

---

## 4. Core Capabilities by Module — Pointer Table

This is the high-level pointer; §5 onwards drills into the internals.

| # | Module                  | Primary location                                        |
|---|-------------------------|---------------------------------------------------------|
| 1 | Queen orchestrator      | `src/orchestration/`, `src/nv-orchestration-engine.ts`  |
| 2 | Agent registry          | `src/agents/`, `src/config/jurisdiction-configs.ts`     |
| 3 | LLM router + breakers   | `src/services/llm-providers/`, `src/services/llm-priority-manager/` |
| 4 | RAG hybrid retriever    | `src/services/rag/`, pgvector tables                    |
| 5 | Memory                  | `src/services/memory/` (mem0 + ioredis)                 |
| 6 | Multi-tenant + RBAC     | `src/services/multi-org/`, `src/services/rbac/`         |
| 7 | SDK gateway             | `src/routes/nv-sdk-*.ts` + `src/services/sdk/`          |
| 8 | Voice (Sarvam)          | `src/services/multimodal-voice/`, `src/india-first/`    |
| 9 | Workflow protocol       | `src/services/contract-lifecycle/`, `src/services/document-pipeline/` |
| 10 | Audit hash chain        | `src/database/audit-*`, drizzle table `audit_log`       |
| 11 | Compliance              | `src/services/compliance/`, `src/services/regulatory-monitor/` |
| 12 | Admin console           | `src/routes/nv-sdk-console-routes.ts` + `client/`       |
| 13 | Enterprise platform     | `src/services/enterprise-platform/`                     |
| 14 | Skills + skillshop      | `src/services/skills/`                                  |
| 15 | Twin desk               | `src/services/twindesk/`                                |
| 16 | White-label theming     | `src/services/white-label/`                             |
| 17 | Intelligent router      | `src/services/intelligent-router/`                      |
| 18 | Microservice contracts  | `src/services/microservice-contracts/`                  |
| 19 | E-filing                | `src/services/e-filing/`                                |
| 20 | Testing harness         | `src/services/testing/`, `tests/`                       |

---

## 5. Component groups (`src/` layout — 30 directories)

Every src/ subdirectory and its responsibility:

| Dir                  | Responsibility |
|----------------------|----------------|
| `agents/`            | Agent registry loaders, jurisdiction-prompt validator. |
| `api/`               | API surface helpers, OpenAPI generator. |
| `capabilities/`      | Capability matrix and feature-flag wiring. |
| `chat/`              | Chat session lifecycle, streaming envelopes. |
| `config/`            | Platform / SDK / model registries, jurisdiction configs. |
| `constants/`         | Frozen constants (jurisdiction codes, language codes). |
| `core/`              | Core domain types and lifecycle hooks. |
| `data/`              | Data fixtures, seed-time payloads. |
| `database/`          | Drizzle client, audit-chain writer. |
| `db/`                | Schema definitions (drizzle table objects). |
| `engine/`            | Orchestration engine glue. |
| `execution/`         | Specialist execution wrapper (with breaker + retry). |
| `gateway/`           | Gateway request normalisation. |
| `graphify-out/`      | Build artifact for the static call graph. |
| `guardrails/`        | PII detector, jurisdiction-confusion guard, prompt-injection guard. |
| `india-first/`       | Sarvam integration, Indic-language helpers, state-statute lookup. |
| `integrations/`      | Third-party integrations (Razorpay, e-courts, ECoP). |
| `middleware/`        | Express middleware (auth, RBAC, rate limit, audit emitter). |
| `orchestration/`     | Queen orchestrator, swarm topologies. |
| `packages/`          | (kept for legacy — actual SDK packages are at repo-root `packages/`). |
| `rest/`              | REST helpers, response shapers. |
| `routes/`            | The 79 Express route files (catalogued in §6). |
| `schemas/`           | Zod schemas for inputs and outputs. |
| `scripts/`           | Runtime scripts shipped inside the container (bootstrap helpers). |
| `services/`          | The 29 service domains (catalogued in §7). |
| `startup/`           | Boot sequence (`nv-jurisdiction-prompt-validator.ts`, registry preload). |
| `system-prompts/`    | The 23-section prompt builder (`nyayavigya-system-prompts-engine-v10.ts`). |
| `systems/`           | Cross-cutting system services. |
| `types/`             | Shared TS types. |
| `utils/`             | Hashing, retry, time helpers. |

---

## 6. Route catalogue (79 Express route files)

Every file in `src/routes/` and what surface it exposes. Grouped by
audience.

### 6.1 Public / health

| File | Surface |
|------|---------|
| `nv-health-routes.ts` | `/health` (unauth liveness). |
| `nv-health-full-routes.ts` | `/api/nv/admin/health/full` (auth, deep). |
| `nv-version-routes.ts` | `/api/nv/version`. |
| `nv-swagger-routes.ts` | `/openapi.json`, `/docs`. |

### 6.2 Operator console (JWT-authenticated)

| File | Surface |
|------|---------|
| `nv-auth-routes.ts` | Operator login, token issuance. |
| `nv-admin-heap-routes.ts` | Heap dumps (auth). |
| `nv-tenant-management-routes.ts` | Tenant CRUD. |
| `nv-enterprise-admin-routes.ts` | Enterprise admin actions. |
| `nv-feature-flags-routes.ts` | Feature flag CRUD. |
| `nv-rls-routes.ts` | RLS policy inspection. |
| `nv-roma-l5-admin-routes.ts` | L5 admin actions. |
| `nv-router-stats-routes.ts` | LLM router live stats. |
| `nv-routing-weights-routes.ts` | LLM routing weight tuning. |
| `nv-token-metrics-routes.ts` | Per-tenant token metering. |
| `nv-credits-routes.ts` | Credit ledger. |
| `nv-subscription-routes.ts` | Subscription management. |
| `nv-razorpay-routes.ts` | Razorpay webhook handler. |
| `nv-sdk-console-routes.ts` | SDK console (operator-side). |
| `nv-sdk-developer-portal-routes.ts` | Developer portal. |
| `nv-sdk-keylife-routes.ts` | API key lifecycle (issue, rotate, revoke). |
| `nv-api-keys-routes.ts` | Legacy API keys. |
| `nv-sdk-doc-pipeline-routes.ts` | SDK docs pipeline. |

### 6.3 SDK consumer surface (SDK-key-authenticated)

| File | Surface |
|------|---------|
| `nv-sdk-gateway-routes.ts` | `/api/nv/gateway/*` — primary SDK entrypoint. |
| `nv-sdk-provision-routes.ts` | `/api/nv/sdk/provision/*` — `/create-app`, `/provision/health`, `/provision/validate`. |
| `nv-sdk-downloads-routes.ts` | `/downloads/sdk/<pkg>/<ver>.tgz` — tarball serving. |
| `nv-sdk-enterprise-routes.ts` | Enterprise SDK surface. |
| `nv-sdk-intelligence-routes.ts` | Intelligence SDK surface. |
| `nv-sdk-multimodal-voice-routes.ts` | Voice SDK surface. |
| `nv-sdk-protocol-analytics-routes.ts` | Protocol analytics. |
| `nv-sdk-workflow-protocol-routes.ts` | Workflow protocol surface. |

### 6.4 Domain surfaces (mixed auth)

| File | Surface |
|------|---------|
| `nv-agent-routes.ts` | Agent CRUD, agent execution. |
| `nv-agent-persona-routes.ts` | Agent persona management. |
| `nv-agui-stream-routes.ts` | AG-UI streaming protocol. |
| `nv-orchestration-routes.ts` | `/api/nv/orchestrate` — Queen entry. |
| `nv-gateway-routes.ts` | Internal gateway routing helpers (consumed by `/api/nv/sdk/gateway/*`). |
| `nv-patterns-routes.ts` | Pattern catalogue + execution. |
| `nv-jurisdiction-routes.ts` | Jurisdiction metadata. |
| `nv-knowledge-module-routes.ts` | Knowledge modules. |
| `nv-rag-routes.ts` | RAG retrieval surface. |
| `nv-memory-manager-routes.ts` | Memory CRUD. |
| `nv-model-registry-routes.ts` | Model registry. |
| `nv-completions-routes.ts` | Raw completions (admin). |
| `nv-intelligence-routes.ts` | Intelligence surface. |
| `nv-platforms-routes.ts` | Platform-tier metadata. |
| `nv-skills-routes.ts` | Skills catalogue. |
| `nv-skillshop-routes.ts` | Skillshop marketplace. |
| `nv-content-routes.ts` | Content surface. |
| `nv-shared-docs-routes.ts` | Shared docs surface. |
| `nv-workspace-routes.ts` | Workspace surface. |
| `nv-user-profile-routes.ts` | User profile. |
| `nv-consent-routes.ts` | Consent ledger. |
| `nv-compliance-routes.ts` | Compliance reports. |
| `nv-filter-routes.ts` | Filtering surface. |

### 6.5 Vertical / India-first surfaces

| File | Surface |
|------|---------|
| `nv-case-management-routes.ts` | Matter / case CRUD. |
| `nv-case-update-routes.ts` | Matter updates / hearings. |
| `nv-document-orchestrator-routes.ts` | Document workflow. |
| `nv-doc-analyze-routes.ts` | Document analysis. |
| `nv-identity-extraction-routes.ts` | KYC / identity extraction. |
| `nv-ecourts-routes.ts` | E-courts integration. |
| `nv-gst-routes.ts` | GST helpers. |
| `nv-institutional-routes.ts` | Institutional surface (NSI). |
| `nv-legal-chat-routes.ts` | Legal chat session. |
| `nv-nyaya-tools-routes.ts` | NyayaTools surface. |
| `nv-clawdbot-routes.ts` | ClawdBot agent. |
| `nv-openbot-routes.ts` | OpenBot agent. |
| `nv-automateai-routes.ts` | AutomateAI. |
| `nv-digital-twin-routes.ts` | Digital twin. |
| `nv-twindesk-routes.ts` | Twin desk. |
| `nv-social-memory-routes.ts` | Social memory. |
| `nv-voice-ws-routes.ts` | Voice WebSocket. |
| `nv-whatsapp-routes.ts` | WhatsApp bridge. |
| `nv-enterprise-services-routes.ts` | Enterprise services. |
| `nv-new-services-routes.ts` | Newer services. |
| `nv-phase4-routes.ts` | Phase-4 surface. |
| `nv-phase5-routes.ts` | Phase-5 surface. |
| `nv-v311-routes.ts` | v3.1.1 surface. |
| `nv-core-routes.ts` | Core surface. |
| `nv-testing-routes.ts` | Internal testing surface. |
| `unified-chat-routes.ts` | Unified chat. |

That is **79** route files. Mount order matters — see §22 for the
SDK-vs-console mount-order fix shipped in NYV-NS-015.

---

## 7. Service domain catalogue (`src/services/` — 29 directories)

| Domain                      | Responsibility |
|-----------------------------|----------------|
| `automateai/`               | Automation pipelines. |
| `clawdbot/`                 | ClawdBot agent service. |
| `compliance/`               | Compliance attestation, DPDP / GDPR helpers. |
| `contract-lifecycle/`       | Contract draft → review → approve → sign. |
| `digital-twin/`             | Digital twin service. |
| `document-pipeline/`        | Document ingestion → OCR → parse → analyse. |
| `e-filing/`                 | E-filing integration helpers. |
| `enterprise-platform/`      | Enterprise platform (NSI). |
| `intelligence/`             | Intelligence pipelines. |
| `intelligent-router/`       | Per-request router that picks pattern + agent set. |
| `jurisdiction-agents/`      | Per-jurisdiction agent loader. |
| `llm-priority-manager/`     | Composite-score LLM picker. |
| `llm-providers/`            | OpenAI, OpenRouter, Sarvam clients + breakers. |
| `memory/`                   | mem0 client, retention policy, recall. |
| `microservice-contracts/`   | Internal contract registry between services. |
| `multi-org/`                | Tenant / org partitioning. |
| `nyaya-tools/`              | NyayaTools toolset for agents. |
| `openbot/`                  | OpenBot service. |
| `orchestration/`            | Queen orchestration helpers. |
| `queue/`                    | BullMQ wrapper (`bullmq-queue.ts`). |
| `rag/`                      | RAG retriever, embedder, ranker. |
| `rbac/`                     | Role-based access control engine. |
| `regulatory-monitor/`       | Statute amendment watcher. |
| `sdk/`                      | SDK runtime helpers (key validation, scope check). |
| `security/`                 | Hashing, encryption, key rotation. |
| `skills/`                   | Skills runtime. |
| `testing/`                  | Internal test harness. |
| `twindesk/`                 | Twin desk service. |
| `white-label/`              | White-label theming. |

---

## 8. Database architecture

### 8.1 Inventory

PostgreSQL (RDS, single AZ in dev, multi-AZ planned for prod). Schema
managed by Drizzle ORM. Seven migration files under `drizzle/`:

| Migration | Purpose |
|-----------|---------|
| `0000_even_red_skull.sql` | Initial schema — all core tables. |
| `0001_fine_gravity.sql` | Add audit chain tables, hash columns. |
| `0002_cold_marvel_zombies.sql` | Tenant + org isolation columns. |
| `0003_premium_black_tom.sql` | Agent registry tables. |
| `0004_enable_rls_for_tenant_tables.sql` | Row-level security policies on tenant-scoped tables. |
| `0005_sdk_key_hash_index.sql` | Index on SDK key hash for fast lookup. |
| `0006_unify_sdk_key_tables.sql` | Begin unification of `nv_api_keys` / `nv_sdk_applications` / `sdk_app_api_keys`. |

### 8.2 Domains

| Domain         | Tables (canonical names) |
|----------------|--------------------------|
| Identity       | `users`, `tenants`, `organisations`, `roles`, `permissions`, `role_permissions`, `user_roles` |
| SDK            | `sdk_applications`, `sdk_app_api_keys`, `nv_api_keys` (legacy — see §11), `sdk_app_quotas` |
| Agents         | `legal_agents`, `agent_personas`, `agent_capabilities`, `jurisdictions` |
| Statutes / RAG | `statutes`, `statute_sections`, `rag_documents`, `rag_embeddings` (pgvector) |
| Cases          | `case_law`, `case_law_citations`, `case_law_embeddings` |
| Matters        | `matters`, `matter_documents`, `matter_parties`, `matter_events`, `matter_team` |
| Compliance     | `consent_ledger`, `audit_log`, `audit_hash_chain`, `dpdp_charters`, `gdpr_records` |
| Workflows      | `workflows`, `workflow_runs`, `workflow_steps`, `workflow_callbacks` |
| Subscriptions  | `subscriptions`, `subscription_tiers`, `credits_ledger`, `usage_metering` |
| Voice          | `voice_sessions`, `voice_transcripts`, `voice_synthesis_jobs` |
| Feature flags  | `feature_flags`, `feature_flag_overrides` |
| Models         | `llm_providers`, `llm_models`, `model_routing_weights` |
| MCP            | `mcp_tools`, `mcp_tool_invocations` |

### 8.3 Row-level security

Every tenant-scoped table carries a `tenant_id` column with a
`USING (tenant_id = current_setting('nyv.tenant_id')::uuid)` RLS policy.
The middleware sets `nyv.tenant_id` per request based on the SDK key's
tenant binding. SQL-level mistakes therefore cannot leak rows across
tenants.

### 8.4 Field-level encryption

Sensitive fields (PII, PAN, Aadhaar, account numbers) are encrypted in
the application layer using AES-256-GCM with the key derived from the
`ENCRYPTION_KEY` secret. Decryption is gated by RBAC.

### 8.5 Migrations — operating model

**Forward-only.** No `DROP COLUMN` / `RENAME COLUMN` in a release that
ships the live code; instead, additive in release N, backfill in a
seeder, drop the old column in release N+1 once the live code no longer
references it. This means an old release keeps working against the
newer schema, so rollback to the prior release directory does not need
schema gymnastics.

### 8.6 Seeders (13 idempotent scripts)

| Seeder                                | Tables touched |
|---------------------------------------|----------------|
| `nv-seed-agents.ts`                   | `legal_agents`, agent registry per jurisdiction |
| `nv-seed-jurisdictions.ts`            | `jurisdictions` |
| `nv-seed-statutes.ts`                 | `statutes`, `statute_sections` |
| `nv-seed-llm-providers.ts`            | `llm_providers`, `llm_models` |
| `nv-seed-mcp-tools.ts`                | `mcp_tools` |
| `nv-seed-models.ts`                   | `models` |
| `nv-seed-organizations.ts`            | `organisations` (demo tenants) |
| `nv-seed-rag-and-audit.ts`            | `rag_documents`, `audit_log` (test fixtures) |
| `nv-seed-sdk-apps.ts`                 | `sdk_applications` |
| `nv-seed-sdk-keys.ts`                 | `sdk_app_api_keys` |
| `nv-seed-ecosystem-demos.ts`          | demo tenants for NYM/NSP/NSI/NSA/NSM |
| `nv-seed-feature-flags.ts`            | `feature_flags` |
| `nv-seed-all.ts`                      | runs every seeder above in order |

Every seeder uses `ON CONFLICT (...) DO UPDATE` and is safe to re-run.

### 8.7 Seed counts (target vs live, as of 2026-05-01)

| Object               | Target | Live RDS |
|----------------------|--------|----------|
| Jurisdictions        | 7 (DEFAULT + 6) | 7 |
| Agents               | 1042 (149 × 6 + 148 DEFAULT) | **1046** (drift, tracked as E3) |
| §23 coverage         | 1042   | 1042 |
| LLM providers        | 4 (OpenAI, OpenRouter, Sarvam, Anthropic via OpenRouter) | 4 |
| MCP tools            | 12     | 12 |
| Demo tenants         | 5 (one per consumer platform) | 5 |
| SDK applications     | 5 (one per consumer platform) | 5 |
| SDK API keys         | 5 active | 5 |

---

## 9. Redis architecture

ElastiCache (Redis 7.x). Three logical uses:

1. **Hot cache** — agent registry warm-load, statute snippets, frequently
   asked Q&A.
2. **Prompt cache** — keyed by `(agent_id, prompt_hash, jurisdiction)`,
   short TTL (5 min). Cuts LLM cost on repeated queries.
3. **BullMQ queue** — orchestration jobs (long-running workflows, bulk
   contract triage), with stalled detection and DLQ.

The wrapper `src/services/queue/bullmq-queue.ts` exports
`getStalledCount` / `getAllStalledCounts` (NYV-NS Task #2 from the prior
sprint); admin health surfaces them as sibling keys
`queue_depth`, `queue_stalled`, `queue_dlq_depth`.

---

## 10. LLM orchestration & routing

### 10.1 Provider rotation

The pool is OpenRouter (primary, fronts ~20 model providers), OpenAI
(direct fallback), Sarvam (Indic). Each provider sits behind an
**Opossum circuit breaker** with thresholds: open after 5 consecutive
failures or 50% error rate over a 30s window; half-open after 60s; close
after 3 consecutive successes.

### 10.2 Hierarchical task allocator scoring

For each request, the picker computes:

```
score(provider, model) =
    w_capability * capability_match
  + w_latency    * (1 / recent_p50_latency)
  + w_error      * (1 - recent_error_rate)
  + w_load       * (1 / current_in_flight)
  + w_cost       * (1 / per_1k_token_cost)
```

Weights are operator-tunable via the `model_routing_weights` table.

### 10.3 Retry policy

On a non-breaker error: exponential backoff (1s, 2s, 4s) capped at 3
attempts. On a breaker-open: immediate fall to the next provider in the
rotation. On all-providers-degraded: return a 503 with `Retry-After`
and a unique trace id.

### 10.4 Prompt-cache hit/miss

Cache key is `sha256(agent_id || prompt || jurisdiction)`. Hit returns
the prior LLM output verbatim plus a `cache_hit: true` marker in the
response envelope. Miss runs the LLM call and writes to cache. TTL is
agent-tier-dependent.

### 10.5 Sarvam voice integration

- STT: Sarvam Speech-to-Text for 22 Indian languages.
- TTS: Sarvam Text-to-Speech for the same set.
- LLM: Sarvam `aaditya` and `sarvam-2b` for Indic-only chains.

Fallback ladder: Sarvam → OpenAI Whisper (STT) / OpenAI TTS / OpenAI
GPT-4o (LLM).

---

## 11. SDK key model — current state and known carry-over

The platform shipped over time with three SDK-key tables:

| Table                  | Origin |
|------------------------|--------|
| `nv_api_keys`          | Legacy (v3.1.0). Still read by `/provision` and `/provision/validate`. |
| `sdk_applications`     | v3.1.1. App-level metadata. |
| `sdk_app_api_keys`     | v3.1.2. Hashed key + scope. The current write path. |

**Migration `0006_unify_sdk_key_tables.sql`** began the unification.
With the May-3 mount-order fix shipped in NYV-NS-015, requests reach
`/provision` before being preempted by the JWT-only console router —
which means the legacy `nv_api_keys` lookup path is now the *first*
failure surface for some SDK calls. This is tracked as **carry-over E1**
in `PRE-GA-STATUS-2026-05-03.md`. Remediation in v3.2 is to:

1. Tag `/provision` and `/provision/validate` as `Deprecated` in the
   OpenAPI spec.
2. Emit `Warning: 299 - SDK provision endpoint deprecated; use
   /api/nv/gateway/* directly` on every response.
3. Backfill any data still in `nv_api_keys` into `sdk_app_api_keys`.
4. Drop `nv_api_keys` in v3.2.

---

## 12. Queen orchestration internals

### 12.1 The `orchestrate()` lifecycle

For every multi-step request:

1. `classify(req)` → `{jurisdiction, domain, urgency, tier, language}`.
2. `pickPattern(classification)` → one of P1–P22.
3. `recruit(pattern, classification)` → an array of specialist agent
   ids using the composite scorer.
4. `dispatch(specialists, req)` → drives the pattern (sequential,
   parallel, debate, ensemble, …).
5. `synthesise(outputs)` → final answer + citations + audit-trail id.
6. `record(audit)` → append to `audit_log` + extend the hash chain.

Every step emits AG-UI streaming events (`thinking`, `tool_call`,
`partial_answer`, `final_answer`).

### 12.2 `orchestrationId` correlation

Every `orchestrate()` invocation gets a UUID. Every downstream LLM call,
RAG fetch, memory recall, audit log entry carries the same id. This is
how an SRE reconstructs an end-to-end trace from a complaint.

### 12.3 AG-UI streaming forwarding

The Queen's events bubble up through the route handler (`/api/nv/orchestrate`)
as Server-Sent Events. The SDK packages translate these into idiomatic
streams in their host language (React `useStream`, RN `useChannel`,
etc.).

### 12.4 Per-request emitters

Post-Task-#64 in the prior sprint, every request gets its own `EventEmitter`
so concurrent requests' events do not interleave.

---

## 13. Agent prompt execution

### 13.1 `buildAgentPrompt(agent, request, ctx)`

Builds the per-call prompt by concatenating:

- the agent's 23-section system prompt (`src/system-prompts/`),
- the jurisdiction-specific overlay,
- the language-specific overlay,
- the tier-specific overlay (citizen / professional / apex / ministry),
- the recent memory recall (per `nvMemoryManager.recall(...)`),
- the RAG retrieval result (only if the pattern requested it),
- the user's question.

§23 (PII redaction charter) is mandatory and runtime-validated by
`nv-jurisdiction-prompt-validator.ts requireAllSections:23`.

### 13.2 Cache namespace

The prompt cache key namespaces on the agent id and the jurisdiction so
two jurisdictions never share a cache slot.

### 13.3 Cache hit short-circuit

If the cache hit, the LLM call is skipped and the cached output is
returned with `cache_hit: true`.

### 13.4 LLM failure fallback

If the chosen LLM fails (post-breaker, post-retry), the picker rotates
to the next-best provider. If all degraded, the response is a 503 with
the trace id.

---

## 14. Reasoning frameworks (CoT / ReAct / ToT)

| Framework | When invoked | What it costs |
|-----------|--------------|---------------|
| Chain-of-Thought (CoT) | Default for any answer. | One LLM call. |
| ReAct | When a tool call is allowed in the pattern. | N LLM calls + N tool calls. |
| Tree-of-Thought (ToT) | When the pattern is a search-style problem. | K branches × M depth LLM calls; pruned. |

Operator override: `request.framework: 'cot' | 'react' | 'tot'` if a
feature flag allows it.

---

## 15. RAG system

### 15.1 Corpus selection

Per request, the corpus is filtered by `(jurisdiction, tier, domain)`.
Citizen-tier requests cannot retrieve apex-only sources (this is
enforced both at the SQL layer and at the application layer).

### 15.2 Hybrid retrieval scoring

```
score(doc) = w_lexical * bm25(doc, query)
           + w_semantic * cosine(embedding(doc), embedding(query))
           + w_recency * recency_boost(doc.last_amended_at)
           + w_authority * authority_boost(doc.source_authority)
```

Top-K (default 10) returned to the agent with their citation metadata.

### 15.3 Jurisdiction filter

Hard `WHERE doc.jurisdiction IN (request.jurisdiction)`. If a UK
specialist somehow tries to fetch IN documents the query returns empty,
not "best effort".

### 15.4 Embedding model

`text-embedding-3-large` for English, Sarvam embedding for Indic. Both
1024-dim. Stored in pgvector with HNSW indexes.

### 15.5 Vector store

pgvector inside the same RDS. No separate Pinecone / Qdrant —
operational simplicity won the trade-off.

### 15.6 Embedding backfill

`scripts/nv-rag-backfill-embeddings.ts` reads from `rag_documents`,
computes embeddings, writes back. Resumable from last checkpoint.

---

## 16. Memory system

### 16.1 What flows in / out per request

- **In**: `recall(user_id, n=5, scope='session'|'long_term'|'episodic')`.
- **Out**: `remember(user_id, fact, scope, ttl?)`.

### 16.2 Storage backend

`mem0` library on top of Redis (short-term) and Postgres (long-term and
episodic).

### 16.3 Retention

- Short-term: session-bounded; cleared on session end.
- Long-term: 365 days default, user-overridable.
- Episodic: indefinite, user-deletable.

### 16.4 Pressure

Memory writes are async (`fire-and-forget`); the response path is
unblocked.

---

## 17. Multi-tenant architecture

### 17.1 Tenant × org × API key model

Three tiers:

```
Tenant (licensee)
  └── Organisation (firm / department / unit)
        └── User (individual)
              └── API Key (scoped to tenant + org + scope set)
```

Every API key encodes its tenant + org binding. The middleware sets
`nyv.tenant_id` and `nyv.org_id` on the Postgres session, and RLS
policies do the rest.

### 17.2 Per-platform key prefix

The 5 consumer platforms each have a key prefix:

```
nyv_live_sk_NYM_<48 chars>   (NyayaMitra)
nyv_live_sk_NSP_<48 chars>   (NSP)
nyv_live_sk_NSI_<48 chars>   (NSI)
nyv_live_sk_NSA_<48 chars>   (NSA)
nyv_live_sk_NSM_<48 chars>   (NSM)
```

Live keys are stored on EC2 at
`/opt/nyayavigya/secrets/platform-keys-2026-05-01.txt` (mode 600,
root-only).

---

## 18. Voice and multilingual

22 Indian languages + English. STT and TTS through Sarvam (primary) with
OpenAI fallback (Whisper for STT, TTS-1-HD for English TTS). Real-time
streaming via WebSocket on `nv-voice-ws-routes.ts`. Latency target P50
<= 800ms for STT, P50 <= 600ms for TTS first-byte.

Code-mixed input (Hinglish, Tanglish) is handled by Sarvam directly
without a transliteration shim.

---

## 19. Audit hash chain

Schema (logical):

```
audit_log:
  id          uuid (pk)
  ts          timestamptz
  actor_id    uuid
  tenant_id   uuid
  action      text
  payload     jsonb
  prev_hash   bytea       -- sha256 of the prior row (canonicalised)
  this_hash   bytea       -- sha256(this row's canonical JSON || prev_hash)
```

Verification: `nv-cli audit verify` walks the table chronologically,
recomputes each `this_hash`, and asserts equality. Strict-OK as of
2026-05-01.

Tampering modes detected:

- Row deletion → next row's `prev_hash` fails to match.
- Field mutation → row's `this_hash` mismatch on recompute.
- Insertion in the past → `prev_hash` of the next-in-time row mismatch.

---

## 20. Compliance posture

| Regime | Status |
|--------|--------|
| DPDP (India)               | Charter in repo + runtime PII guard + consent ledger. |
| GDPR (EU)                  | Article 30 record-of-processing in repo + DSAR handler. |
| UK GDPR                    | Same as EU GDPR; PECR cookie posture documented. |
| HIPAA (US healthcare)      | Not an active goal; NSI hospital tier handles consent at app layer. |
| Singapore PDPA             | Same posture as DPDP; corpora cover Singapore acts. |
| GC data-protection         | Per-country posture documented; consent ledger universal. |

---

## 21. Deployment topology

### 21.1 Production topology

Single EC2 instance in `ap-south-1` (Mumbai), `t3.xlarge` for dev,
target `m6i.2xlarge` for prod. RDS (`db.t4g.medium` dev, target
`db.m6g.large` prod, multi-AZ). ElastiCache `cache.t4g.medium` dev.
S3 bucket `nyayavigya-sdk-devapp` for SDK distribution and deploy
artifacts.

### 21.2 Containers on the host

| Container | Image | Port | Notes |
|-----------|-------|------|-------|
| `nyv-gateway` | built locally from `Dockerfile` | `4001` (internal) | runs `tsx src/index.ts` directly — no `dist/` in container, so a tarball ship + container restart picks up source changes without a re-build of node_modules. |
| `caddy` | `caddy:2-alpine` | `80`, `443` | TLS termination, reverse proxy. |

There is **one** `nyv-gateway` container in dev (no blue-green). Prod
plan adds blue-green via `gateway-a` / `gateway-b` swap.

### 21.3 Two-phase apply (DNS + datastores)

DNS and managed datastore changes are applied separately from gateway
deploys (Terraform under `infra/terraform/`). This means a code deploy
never depends on a DNS or RDS change going first; either side can ship
independently.

### 21.4 DNS facts

EC2 IP is stable (`13.232.165.242`). DNS records terminate at Caddy.

### 21.5 Multi-AZ posture

Dev: single AZ. Prod: planned multi-AZ for RDS, single AZ for EC2 with
warm standby image in second AZ.

### 21.6 DR drill outcomes

Quarterly DR drill; latest outcome in `NYV-DR-DRILL-RESULTS.md` —
RTO 22 min, RPO 5 min on the most recent drill.

---

## 22. SDK suite (six packages, all v5.0.0)

### 22.1 Package list

| Package                              | Built from              | Tarball in S3                                                          |
|--------------------------------------|-------------------------|------------------------------------------------------------------------|
| `@nyayavigya/types`                  | `packages/types/`       | `s3://nyayavigya-sdk-devapp/sdk/types/5.0.0.tgz`                       |
| `@nyayavigya/client-sdk`             | `packages/client-sdk/`  | `s3://nyayavigya-sdk-devapp/sdk/client-sdk/5.0.0.tgz`                  |
| `@nyayavigya/react-hooks`            | `packages/react-hooks/` | `s3://nyayavigya-sdk-devapp/sdk/react-hooks/5.0.0.tgz`                 |
| `@nyayavigya/client-sdk-react-native`| `packages/client-sdk-react-native/` | `s3://nyayavigya-sdk-devapp/sdk/client-sdk-react-native/5.0.0.tgz` |
| `@nyayavigya/nyayamitra-sdk`         | `packages/nyayamitra-sdk/` | `s3://nyayavigya-sdk-devapp/sdk/nyayamitra-sdk/5.0.0.tgz`           |
| `@nyayavigya/enterprise-sdk`         | `packages/enterprise-sdk/` | `s3://nyayavigya-sdk-devapp/sdk/enterprise-sdk/5.0.0.tgz`           |

All inter-package dependencies pinned at `^5.0.0`.

### 22.2 Mount-order fix (NYV-NS-015)

The root cause of the v3.1.2 GA-Beta provisioning failures was that
`sdkConsoleRoutes` (mounted on `/api/nv/sdk`) called
`router.use(authenticateToken)` at module top — which meant every request
to `/api/nv/sdk/*` was forced through the operator JWT validator first,
returning 401 to SDK-key Bearer requests **before** the
`nvSdkProvisionRouter` (also mounted on `/api/nv/sdk`) could see them.

The v5.0.0 fix is a one-line ordering change in `src/index.ts`:

```
// NYV-NS-015 (2026-05-01) — moved ABOVE the catch-all sdkConsoleRoutes mount.
app.use('/api/nv/sdk', nvSdkProvisionRouter);    // line 505 — SDK-key auth
app.use('/api/nv/sdk', sdkConsoleRoutes);        // line 508 — JWT auth (catch-all)
```

Express matches in order; SDK-key requests now reach the right handler.

### 22.3 `/create-app` security model (NYV-NS-013)

```
DEFAULT_CREATE_APP_SCOPES = ['agents:read', 'agents:execute', 'research:read']

if requestedScopes contains '*':
    if !requireRole('super_admin') OR !body.wildcard_override:
        return 403 'NYV-CREATE-AUTHZ-002: wildcard_override requires super_admin'
    resolvedScopes = ['*']
else:
    resolvedScopes = requestedScopes ?? DEFAULT_CREATE_APP_SCOPES
```

A non-admin asking for enterprise tier with a wildcard scope now gets a
clean 403 with no DB row created. Quickstart payload (the example
returned in the response) uses `req.protocol/host`, the live
`/api/nv/gateway/agents/:agentId/execute` path, and `prompt` as the body
field.

### 22.4 Download allowlist (NYV-NS-011)

```typescript
const ALLOWED_PACKAGES = new Set<string>([
  'client-sdk',
  'client-sdk-react-native',
  'nyayamitra-sdk',
  'types',
  'react-hooks',
  'enterprise-sdk',
]);
```

All 6 packages return 200 from `/downloads/sdk/<pkg>/5.0.0.tgz` with a
valid sha256.

---

## 23. CI/CD reality (Replit ↔ AWS)

### 23.1 Documented vs. actual

The doc `NYV-CICD-REPLIT.md` describes an SSH-based `pnpm deploy` path
(rsync over SSH, in-place install, drizzle push, atomic symlink swap,
docker compose restart). **That path requires an EC2 SSH key in Replit
Secrets, which is not configured in the current Replit container.**

### 23.2 Actual current path — `scripts/deploy-replit-ssm.sh`

Added 2026-05-01 (173 LOC). What it does:

```
1. tar working tree → /tmp/nyv-<id>-<sha>.tgz
2. aws s3 cp → s3://nyayavigya-sdk-devapp/deploys/<id>-<sha>.tgz
3. aws ssm send-command (base64-inline shell) → EC2:
     a. download tarball
     b. extract to /opt/nyayavigya/repo/<id>-<sha>/
     c. docker compose -f docker-compose.aws-dev.yml build --pull gateway
     d. docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway
     e. poll /health (90s window)
     f. write CURRENT_DEPLOY + LAST_GOOD_DEPLOY
     g. append /opt/nyayavigya/deploys.log
4. SSM stream back to Replit
5. append .local/replit-deploys.log
```

Required Replit Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`NYV_EC2_INSTANCE_ID`, `NYV_AWS_REGION`, `NYV_DEPLOY_BUCKET`.

### 23.3 GitHub Actions (idle until source migration)

7 workflows under `.github/workflows/`:

| Workflow                  | Trigger                                  |
|---------------------------|------------------------------------------|
| `ci.yml`                  | PR validation. |
| `pr-management.yml`       | PR labels, review-requested. |
| `staging.yml`             | Push to `staging` branch. |
| `production.yml`          | Manual dispatch. |
| `module-deploy.yml`       | Manual dispatch (per-module). |
| `sdk-publish.yml`         | Tag `sdk-v*`. |
| `sdk-publish-dryrun.yml`  | PR touching SDK packages. |

**These only fire from a real GitHub repo.** Until source migrates off
Replit, they're idle; the SSM-based wrapper is the bridge.

### 23.4 Path forward when source migrates

1. Bitbucket / GitLab pipeline calls a self-hosted runner.
2. The runner uses the **same SSM-based shell** as today (lifted from
   `scripts/deploy-replit-ssm.sh` into a reusable composite action).
3. The deploy semantics do not fork.
4. `scripts/deploy-replit-ssm.sh` moves to `archive/` as a
   break-glass-from-laptop tool.

---

## 24. Database / RAG / seed sync flow

The non-disruption rule: **forward-only schema migrations + idempotent
seeders + cache invalidation, in that order, per release.**

```
Release N produces a new drizzle migration AND new seed data:

1. Author migration on Replit
   → pnpm drizzle generate
   → produces drizzle/000N_<name>.sql
2. Verify locally
   → pnpm drizzle:check
3. Deploy via SSM (above)
   → tarball ships drizzle/ to EC2
4. EC2-side, the deploy script:
   a. extract release
   b. docker compose build gateway
   c. (optional) one-shot: pnpm drizzle:push  (idempotent)
   d. docker compose up -d --force-recreate gateway
   e. health-poll
5. After deploy, run new seeders if any:
   aws ssm send-command \
     --document-name AWS-RunShellScript \
     --parameters 'commands=["cd /opt/nyayavigya/repo/$(cat /opt/nyayavigya/CURRENT_DEPLOY)/nyayavigya-platform-312 && pnpm tsx scripts/nv-seed-<which>.ts"]'
6. Invalidate cache (if schema-affecting):
   aws ssm send-command ... 'pnpm tsx scripts/nv-cache-invalidate.ts'
7. (Optional) RAG embedding backfill:
   aws ssm send-command ... 'pnpm tsx scripts/nv-rag-backfill-embeddings.ts'
```

**Rollback** is to deploy the prior release directory. Because schema
changes are additive-only, the prior code keeps working against the
newer schema. No schema rollback is performed.

---

## 25. Tech stack — bill of materials

### Runtime

| Layer            | Choice                          | Why |
|------------------|---------------------------------|-----|
| Language         | TypeScript 5.x                  | Type safety end-to-end. |
| Runtime          | Node.js 20.x LTS                | Native ESM, perf. |
| Process manager  | `tsx src/index.ts` (no PM2)     | Hot path is direct; container handles restart. |
| HTTP             | Express 4.x                     | Stable, plug-compatible middleware. |
| Validation       | Zod                             | Inline schemas, runtime + type. |
| ORM              | Drizzle                         | Migrations, types, sql-first. |
| DB               | PostgreSQL 16 (RDS)             | RLS, JSONB, pgvector. |
| Cache            | Redis 7 (ElastiCache)           | Hot cache, prompt cache, BullMQ backend. |
| Queue            | BullMQ                          | Stalled detection, DLQ, priorities. |
| Breaker          | Opossum                         | Per-provider circuit breaker. |
| LLM (rotation)   | OpenRouter SDK                  | One adapter, ~20 providers behind. |
| LLM (fallback)   | OpenAI SDK                      | When OpenRouter is down. |
| LLM (Indic)      | Sarvam SDK                      | Indic STT/TTS/LLM. |
| Auth (operator)  | JSON Web Token (`jsonwebtoken`) | HS256 with `JWT_SECRET`. |
| Auth (SDK)       | Bearer SDK key + bcrypt hash    | Hashed at rest in `sdk_app_api_keys`. |
| Streaming        | Server-Sent Events              | AG-UI protocol. |
| Voice WS         | `ws`                            | Real-time voice. |
| Embeddings       | `text-embedding-3-large` + Sarvam | English + Indic. |
| Vector store     | pgvector (HNSW)                 | Same DB, simpler ops. |
| Memory           | `mem0` + ioredis + Postgres     | Three layers. |
| Container        | Docker (Dockerfile, no compose-build for prod) | Single image, single binary. |
| Reverse proxy    | Caddy 2                         | TLS auto-renewal, simple config. |

### Build

| Tool                 | Use |
|----------------------|-----|
| `pnpm`               | Workspace + per-package install. |
| `tsx`                | Run TS directly in container. |
| `tsc --noEmit`       | Type-check on PR (CI gate). |
| `eslint`             | Code style + custom NYV rules. |
| Drizzle CLI          | Migration generate / push. |
| Vite (`client/`)     | Console frontend bundle. |

### Cloud

| Service           | Purpose |
|-------------------|---------|
| EC2 (`ap-south-1`) | Single host for `nyv-gateway` + Caddy. |
| RDS PostgreSQL    | Transactional + audit + RAG (pgvector). |
| ElastiCache Redis | Cache + queue + prompt cache. |
| S3                | SDK distribution + deploy artifacts. |
| SSM               | Replit→EC2 deploy bridge. |
| Route 53          | DNS. |
| Terraform         | Infra-as-code (under `infra/terraform/`). |

---

## 26. End-to-end request trace (wire-level)

A `POST /api/nv/orchestrate` from an NSP web client:

```
NSP-web (React + @nyayavigya/client-sdk@5.0.0)
   │  Authorization: Bearer nyv_live_sk_NSP_<48>
   ▼
Caddy (TLS termination)
   │
   ▼
nyv-gateway:4001
   │
   ▼
src/middleware/sdkKeyAuth.ts
   │   - lookup hash in sdk_app_api_keys
   │   - SET nyv.tenant_id, nyv.org_id on PG session
   │   - check scope contains 'agents:execute'
   ▼
src/routes/nv-orchestration-routes.ts
   │
   ▼
src/orchestration/nv-queen-orchestrator.ts ▷ orchestrate()
   │   1. classify(req) → IN/contract/standard/professional/en
   │   2. pickPattern() → P4 (hierarchical)
   │   3. recruit() → ['contract-specialist', 'litigation-specialist']
   │   4. dispatch() → fan-out
   │           ├── nvMemoryManager.recall(user_id, 5)
   │           ├── ragRetriever.retrieve(query, jurisdiction='IN')
   │           └── llmRouter.complete(buildAgentPrompt(...))
   │                       ├── llm-priority-manager picks gpt-4o-mini
   │                       ├── opossum breaker check ok
   │                       └── openrouter.chat.completions.create()
   │   5. synthesise() → final answer + citations
   │   6. record() → INSERT audit_log + extend hash chain
   ▼
SSE stream back to NSP-web
   │   { thinking, tool_call, partial_answer, final_answer }
   ▼
React useStream hook in @nyayavigya/react-hooks renders progressively.
```

Total wall time: 4–8s for a typical citizen-tier question, 12–30s for a
professional-tier ensemble, minutes-to-hours for an enterprise bulk job.

---

## 27. Operational dashboards

| Dashboard               | Surface |
|-------------------------|---------|
| Live agent health       | Per-jurisdiction registry status, count vs target, §23 coverage. |
| LLM router live stats   | Per-provider QPS, p50/p95 latency, error rate, breaker state. |
| Queue depth + stalled   | BullMQ depth, stalled count, DLQ depth. |
| Audit chain integrity   | Walk + verify; last verified timestamp. |
| Tenant cost dashboard   | Per-tenant token spend by model. |
| Per-pattern cost        | Tokens per P1–P22 invocation. |
| DR drill log            | Last RTO / RPO. |

---

## 28. v5.0.0 GA-readiness — engineering checklist

| Item | Status |
|------|--------|
| All 6 SDK packages at v5.0.0 in S3 (correct sha256) | yes |
| `/downloads/sdk` resolves all 6 with 200 | yes |
| `/create-app` defaults are not wildcard | yes |
| Wildcard scope requires `super_admin` + `wildcard_override:true` | yes |
| Mount order: `nvSdkProvisionRouter` before `sdkConsoleRoutes` | yes |
| EC2 dev gateway healthy on `2026-05-01T07:50Z-pre-ga-may3-fixes` | yes |
| Audit chain strict-OK | yes |
| `CURRENT_DEPLOY` / `LAST_GOOD_DEPLOY` markers present | yes |
| `/opt/nyayavigya/deploys.log` appended | yes |
| Per-platform keys (NYM/NSP/NSI/NSA/NSM) provisioned | yes |
| Per-platform hand-off doc shipped | yes |
| `scripts/deploy-replit-ssm.sh` present + executable | yes |
| `archive/2026-05-01-pre-may3-cleanup/` populated | yes |
| Project-Tracker updated with 2026-05-01 entries | yes |
| Carry-overs R1–R5 (Replit) tracked | yes |
| Carry-overs E1–E5 (EC2) tracked | yes |
| Drizzle migrations 0000-0006 applied on dev RDS | yes |
| `react-hooks` peer-dep fix shipped | **pending (R1)** |
| Health-poll uses unauth endpoint | **pending (E2)** |
| Agent-count drift reconciled | **pending (E3)** |
| 90s-window smoke for `/agents/:id/execute` and `/research/domain/legal` | **pending (E4)** |
| `nv_api_keys` deprecation header | **pending (E1, v3.2)** |

The platform is **ready for the 2026-05-03 dev-test-live phase** (the
consumer-app cutover milestone). **Production GA remains scheduled for
2026-05-15** per `Project-Tracker.md` §1. Five small carry-overs remain
— none blocking — and are tracked in
[`../v3.1.2/PRE-GA-STATUS-2026-05-03.md`](../v3.1.2/PRE-GA-STATUS-2026-05-03.md).

---

## 29. Where to read more (canonical docs that still apply)

- Architecture: [`../v3.1.2/completed_docs/architecture/NYV-ARCHITECTURE-CANONICAL.md`](../v3.1.2/completed_docs/architecture/NYV-ARCHITECTURE-CANONICAL.md)
- Developer onramp: [`../v3.1.2/completed_docs/architecture/NYV-TECH-SPEC-MASTER.md`](../v3.1.2/completed_docs/architecture/NYV-TECH-SPEC-MASTER.md)
- Agent catalogue: [`../v3.1.2/completed_docs/agents/NYV-AGENT-CATALOG.md`](../v3.1.2/completed_docs/agents/NYV-AGENT-CATALOG.md)
- Per-agent product detail: [`../v3.1.2/completed_docs/agents/agents-product.md`](../v3.1.2/completed_docs/agents/agents-product.md)
- SDK master integration guide: [`../v3.1.2/completed_docs/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md`](../v3.1.2/completed_docs/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md)
- SDK API reference: [`../v3.1.2/completed_docs/NYV-SDK-v5-API-REFERENCE.md`](../v3.1.2/completed_docs/NYV-SDK-v5-API-REFERENCE.md)
- CI/CD doc: [`../v3.1.2/completed_docs/NYV-CICD-REPLIT.md`](../v3.1.2/completed_docs/NYV-CICD-REPLIT.md) (see SSM delta in §23)
- Pre-GA status: [`../v3.1.2/PRE-GA-STATUS-2026-05-03.md`](../v3.1.2/PRE-GA-STATUS-2026-05-03.md)
- Live SDK access: [`../v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md`](../v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md)
- Per-platform hand-off: [`../v3.1.2/SDK-RELEASE-2026-05-03.md`](../v3.1.2/SDK-RELEASE-2026-05-03.md)
- Project tracker: [`../../Project-Tracker.md`](../../Project-Tracker.md)
- Roadmap: [`../../Roadmap.md`](../../Roadmap.md)
