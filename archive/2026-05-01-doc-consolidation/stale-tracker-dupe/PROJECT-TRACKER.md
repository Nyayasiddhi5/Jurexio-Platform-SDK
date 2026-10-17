---
status: pending
version: 3.1.2
superseded_by: null
last_verified: 2026-04-30
---

# Nyayavigya Platform — Canonical Roadmap & State Tracker

> **This file is the single source of truth for "what's done, what's next,
> what's broken."** Read it before starting any task.
>
> **Three-file ritual** (mandatory before AND after every task):
>
> 1. `CHANGELOG.md` (root) — narrative history, Keep-a-Changelog format.
> 2. `Project-Tracker.md` (root) — audit-grade timestamped row log.
> 3. `docs/PROJECT-TRACKER.md` (this file) — planning view, current state,
>    pending roadmap, architecture map.
>
> Before a task: read all three to understand context.
> After a task: append to all three (one row + one narrative + one
> roadmap-status update).

---

## 0. Latest Documentation Drop — 2026-04-29 (WIP/ v5.0.0 deliverables)

A fresh root-level `WIP/` folder now holds five canonical v5.0.0
documents authored from the v7.1 ProductNote source (3,641 lines):

| Doc | File |
|---|---|
| 1 — Product / Business | `WIP/Nyayavigya-Product-v5.0.0.md` |
| 2 — Detailed Technical | `WIP/Nyayavigya-Technical-Detailed-v5.0.0.md` |
| 3 — Pending Tasks (DLR) | `WIP/Nyayavigya-Pending-Tasks-DevLiveReady-v5.0.0.md` |
| 4 — EC2 Dev-Live SDK Availability | `WIP/Nyayavigya-EC2-DevLive-SDK-Availability-v5.0.0.md` |
| 5 — v5.0.0 Roadmap | `WIP/Nyayavigya-v5.0.0-Roadmap.md` |

Posture: **DEV-LIVE-READY** (NOT consumer production). SDK robustness
for the five-product Nyayasiddhi ecosystem is the priority. Track-X
(managed-datastores cutover) remains operator-gated. ECS/EKS, GitHub
Actions, Bitbucket Pipelines reactivation, WAF Count→Block, SSL Labs
A+ run, DR drills, and ISO 42001 certification are explicitly deferred
post-GA.

DLR critical path (17 tasks T-DLR-01 → T-DLR-17) is enumerated in
deliverable #3. Phasing (P1 → P6) is in deliverable #5.

**Supersedes earlier rows in §1 below** for the same three points
called out in `replit.md` and `CHANGELOG.md`: (a) RN + Nyayamitra
SDKs are PENDING build (no `dist/`); (b) datastore cutover is
operator-gated Track-X (no managed cutover yet); (c) agent count
is 1,042 target with a 1,046 live drift (T-DLR-09).

---

## 0.1 Latest Documentation Drop — 2026-04-29 (WIP/ v5.0.0 SDK execution plan)

A second `WIP/` doc batch landed: the **Nyayavigya SDK v5.0.0
Execution Plan**, awaiting written approval before any code/schema/
infra/secret change.

| Doc | File |
|---|---|
| 6 — SDK Master Execution Plan | `WIP/Nyayavigya-SDK-v5.0.0-Execution-Plan.md` |
| 7 — Security, Governance & PII | `WIP/Nyayavigya-SDK-v5.0.0-Security-Governance-PII.md` |
| 8 — AI Intelligence Wiring Spec | `WIP/Nyayavigya-SDK-v5.0.0-AI-Wiring-Spec.md` |
| 9 — End-to-End Test Plan | `WIP/Nyayavigya-SDK-v5.0.0-E2E-Test-Plan.md` |
| 10 — EC2 Dev-Live Cutover Runbook | `WIP/Nyayavigya-SDK-v5.0.0-EC2-DevLive-Cutover.md` |

10 phases A→J with hard gates at H (E2E test) + I (cutover). §6 of
master plan: consolidated 23-gap list bundled into the phases. §7:
10-risk register with mitigations. §8: 13-item release criteria. §11:
written approval gate.

Coverage: security architecture hardening (NSS v1.0 + OWASP LLM Top
10 2025 + OWASP AI Exchange); PII for all 6 jurisdictions (IN preserved,
UK/US/GCC/SG from `nyv-impl-plan-v5.ts` T-06, EU regex-only added,
NER deferred Q3 2026); HITL flows (registry-driven thresholds,
reviewer routing via `escalationPath`, auto-approve audit, refuse
path); custom-agent immutable-vs-overridable section enforcement;
jurisdiction activation matrix (IN live; UK/EU/US/GCC/SG registered
but not activated); AI intelligence wiring (7 RAG variants selector
with pre-LLM gate, 5-tier memory + graph + project + social, 3 CoT
modes, context-engineering 12,288-tok budget, 107 A2A swarm topologies
via collaboration bus, 504 MCP tools batch-enable plan); token
frugality (cache strategy + ≥40% cache-hit-rate release gate);
per-feature E2E test matrix + 13-step UAT smoke (hard-gate, one-shot)
+ load (200 RPS / p95 cached < 1.5 s) + chaos drills + 36 PII drill
cases + 12 security drills; EC2 dev-live cutover runbook (9 steps,
rollback at every step, ≤15-min full-rollback SLA, 24-h observation).

Net assets planned (NOT yet executed):
- ONE new code file: `src/services/nv-security-monitor.ts` (~200 LOC,
  deterministic, no LLM, no new tables, no new routes — single
  marker-anchored insertion into `src/index.ts`).
- ONE new schema table: `nv_pii_vault` (gap #P0; AES-256-GCM; TTL 30 min).
- ONE new env-secret: `A2A_HMAC_SECRET`.
- 6 default-OFF feature flags: `NYV_F_AUDIT_WIRE`, `NYV_F_CITATION_WIRE`,
  `NYV_F_HITL_REGISTRY`, `NYV_F_PII_JCN`, `NYV_F_SECURITY_MONITOR`,
  `NYV_F_TOKEN_OPT`.

Path-drift documented (Phase A): spec assumes `src/routes/orchestrate.ts`;
real file is `src/routes/nv-orchestration-routes.ts`. Mandatory
path-remap before any T-01/T-02 patch.

Out of scope (deferred): consumer-prod cutover; Track-X managed
datastore cutover; ECS/EKS; CI/CD reactivation; WAF Count→Block;
SSL Labs A+; DR drill; ISO 42001; SLM/LRM training; reasoning
pattern changes; NER-based PII for EU/GCC.

---

## 1. Current State (as of 2026-04-29)

### 1.1 Gateway

| Aspect | Status | Evidence |
|---|---|---|
| Live host | `https://api.nyayasiddhi.online` | `docker ps` on 13.232.165.242 → `nyv-gateway` container healthy |
| Runtime | Node 22 LTS via `tsx` (no compile step) | `Dockerfile.gateway` |
| ROMA L5 prompts | 1 042 system prompts (6 jurisdictions × 149 agents + DEFAULT × 148) | `src/prompts/` |
| Orchestration patterns | 22 (P1–P22) wired into `nv-orchestration-routes.ts` | live `/api/nv/orchestrate` smoke 2026-04-27 |
| LLM providers | 7 live (Anthropic / OpenAI / Google / OpenRouter / DeepSeek / Together / AgentZero) | `GET /api/nv/observability/router-stats` → `catalogSize:28` |
| Auth | JWT + refresh tokens; NSP integration via HMAC response signing | live curl returns `X-NYV-Signature: sha256=…` |
| RBAC | superadmin / super_admin / admin / user; matrix verified | curl evidence in `Project-Tracker.md` (2026-04-26 06:38Z) |

### 1.2 Database (RDS Postgres 16)

| Aspect | Status |
|---|---|
| Cluster | `db.t4g.small`, single-AZ, gp3, 7-day PITR |
| Schemas | `public`, `nv_schema` |
| `nv_schema` relations (prod) | **95** = 94 base tables + 1 view (`sdk_app_api_keys`) + 1 enum (`case_update_type`) — Drift-A + Drift-B + R-SCHEMA-B-DEPLOY all resolved 2026-04-29 |
| `nv_schema` table count (local helium) | **95** (Drift-A + Drift-B both resolved) |
| Drizzle parity | 95 decls = 95 helium tables = 95 prod relations = ✓ |
| Drift state | **Prod RDS now in sync with local helium and Drizzle.** Zero outstanding `nv_schema` parity work. The `sdk_app_api_keys` identifier on prod is a deliberate **view** aliasing `public.sdk_app_api_keys` with column renames (`hashed_key←key_hash`, `app_id←application_id`); helium represents it as a base table. Either form satisfies the source-code reads. |

### 1.3 Console (Next.js 14)

8/8 admin pages verified live 2026-04-26.

### 1.4 SDKs (5 packages)

All published to S3 `s3://nyayavigya-sdk-devapp/sdk/` with manifest:

| Package | Version | Status |
|---|---|---|
| `@nyayavigya/client-sdk` | 6.0.0 GA | ✓ live |
| `@nyayavigya/client-sdk` | 3.1.2 (legacy) | ✓ live for back-compat |
| `@nyayavigya/client-sdk-react-native` | 1.0.0 GA | ✓ live |
| `@nyayavigya/nyayamitra-sdk` | 1.0.0 GA | ✓ live |
| `@nyayavigya/enterprise-sdk` | 3.1.2 | local only (not yet published) |

### 1.5 Infrastructure (AWS ap-south-1)

| Resource | Status |
|---|---|
| EC2 (`nysdev`, 13.232.165.242) | t3.medium, gateway + console containers |
| RDS Postgres 16 | `db.t4g.small`, see 1.2 |
| ElastiCache Redis 7.1 | `cache.t4g.micro`, TLS in transit |
| ALB + Route 53 + ACM | `dev-edge` Terraform env |
| S3 | `nyayavigya-sdk-devapp` (SDK), `nyv-sdk-distribution` (downloads) |
| CloudWatch alarms | 6 alarms → SNS `nyv-platform-alerts` → vamsi@nyayasiddhi.com |

---

## 2. Completed Work (cumulative milestones)

| Date | Item | Where to read |
|---|---|---|
| 2026-04-22 | v3.1.0 — initial monorepo, gateway+console+SDKs | CHANGELOG `[3.1.0]` |
| 2026-04-24 | v3.1.1 — Bitbucket→EC2 CI/CD, AWS managed datastores | CHANGELOG `[3.1.1]` |
| 2026-04-25 | Doc reorg into `docs/v3.1.2/{completed,pending,superseded}` (Task #87) | replit.md §"Documentation layout" |
| 2026-04-25 | Prompt cache survives restarts via Redis backend (Task #67) | replit.md §"Prompt Cache" |
| 2026-04-26 | LLM stack: 7 providers, 28-model catalog confirmed live | `docs/v3.1.2/.../LLM-STACK.md` |
| 2026-04-26 | Feature inventory: 78 routes, 110 pages, 12 RAG services | `docs/v3.1.2/.../FEATURE-INVENTORY.md` |
| 2026-04-26 | EC2 ops SOP + 8 ops scripts | `scripts/nyv-ops/` |
| 2026-04-26 | CloudWatch alerts → email | `aws cloudwatch describe-alarms` |
| 2026-04-26 | NSP integration: HMAC response signing | `src/middleware/nv-response-signing-middleware.ts` |
| 2026-04-26 | SDK distribution: 4 tarballs published to S3 | `s3://nyayavigya-sdk-devapp/sdk/` |
| 2026-04-27 | NSP `/api/nv/orchestrate` 500 fixed (soft-fail rag/memory) | Project-Tracker 2026-04-27 |
| 2026-04-27 | Optimization audit landed (hot-path fixes F1/F2/F3) | `docs/NYV-OPTIMIZATION-AUDIT-2026-04-27.md` |
| 2026-04-29 | Drift-A: Drizzle parity for the 26 untracked prod nv_schema tables | CHANGELOG `[Unreleased] 2026-04-29 Drift-A` |
| 2026-04-29 | Drift-B: Drizzle parity for the 67 referenced-but-untracked nv_schema tables | CHANGELOG `[Unreleased] 2026-04-29 R-SCHEMA-B` |
| 2026-04-29 | **R-SCHEMA-B-DEPLOY: prod RDS reaches 95-relation parity (28 → 94 base tables + 1 view + 1 enum) (THIS SESSION)** | CHANGELOG `[Unreleased] 2026-04-29 R-SCHEMA-B-DEPLOY` |
| 2026-04-29 | **R-RAG-EMBEDDINGS-BACKFILL: prod confirmed `18 / 18` chunks embedded (no-op — backfilled by earlier boot-time path)** | CHANGELOG `[Unreleased] 2026-04-29 R-SCHEMA-B-DEPLOY` |
| 2026-04-30 | **DEV-LIVE-READY sprints 1-4 closeout** — T-DLR-01/02/06/08/10/11/12/16/17 + NV-NSP-FIX-006. Local UAT 5/5 PASS; protocol-registry reseed clean (102/102); ecosystem demos 15/15 PASS. | CHANGELOG `[Unreleased] DEV-LIVE-READY (2026-04-30)` |
| 2026-04-30 | **EC2-DEV push (S4.2)** — image `49b8fd0ef478` rebuilt and recreated under `docker-compose.aws-dev.yml`; `/api/nv/health` reports **1042 agents, registryFormat=v3-full-23section, section23Coverage=1042**; ecosystem 15/15 PASS on EC2 after `NYV_F_AUDIT_WIRE=1` added to EC2 `.env`. | CHANGELOG `[Unreleased] Deployed to EC2 dev (S4.2 — 2026-04-30T07:00Z)` |

---

## 3. Pending Roadmap

### 3.1 P0 — must do next

| ID | Item | Owner | Notes |
|---|---|---|---|
| **R-CITATION-CHAIN-PINNING** | Gateway uses `sslmode=no-verify` for RDS — pin CA chain. | Platform Engineering | Tracked in CHANGELOG `[Unreleased]` 2026-04-26 §Security. Now the largest open P0 since R-SCHEMA-B-DEPLOY closed. |

> **Closed 2026-04-29:** `R-SCHEMA-B-DEPLOY` and
> `R-RAG-EMBEDDINGS-BACKFILL` both moved to §2 Completed Work after
> the prod rollout brought RDS `nv_schema` to **95 relations = exact
> parity with local helium** (94 base tables + 1 view +
> 1 enum). Three-phase rollout details + safety properties live in
> `CHANGELOG.md › [Unreleased] 2026-04-29 R-SCHEMA-B-DEPLOY`.

### 3.2 P1 — important next month

| ID | Item | Source |
|---|---|---|
| `R-LLM-DEDUPE` | LLM router stubs + dormant orchestrator engines need `DEPRECATE` sign-off + removal. | `NYV-OPTIMIZATION-AUDIT-2026-04-27.md` Class B |
| `R-SARVAM-PROVIDER` | Add Sarvam provider class for India-localised inference (env secret already present: `SARVAM_API_KEY`). | Class C, `NYV-OPTIMIZATION-AUDIT-2026-04-27.md` |
| `R-INDIA-AGENT-GEN` | India agent generator (no India-specific agent set today; using DEFAULT). | Class C, audit |
| `R-OPENROUTER-FREE` | Wire OpenRouter free tier models for cost optimisation. | Class C, audit |
| `R-NSP-WEB-DASHBOARD` | Nyayasiddhi ecosystem console go-live (pro/institutional/ministry/academy). | Class D, audit |
| `R-NV-ENTERPRISE-ADMIN` | Nyayavigya enterprise admin UI go-live. | Class D, audit |
| `R-IAM-GAPS` | IAM permission gaps review. | `pending_implementation_docs/NYV-IAM-GAPS.md` |
| `R-PROD-READINESS` | Production readiness checklist completion. | `pending_implementation_docs/NYV-PRODUCTION-READINESS-CHECKLIST.md` |
| `R-UAT-V3.2` | UAT v3.2 deferred to AWS environment. | `pending_implementation_docs/uat/` |

### 3.3 P2 — Q3/Q4 2026

See `docs/v3.1.2/pending_implementation_docs/NYV-ROADMAP-Q2-Q4-2026.md` and
`NYV-NEXT-PROJECT-PLAN-2026-Q3-Q4.md`.

---

## 4. Architecture Map (one-screen overview)

```
Internet
   │
   ▼
ALB (api.nyayasiddhi.online, ACM TLS) ─── Route 53
   │
   ├─► EC2 nysdev (13.232.165.242)
   │      ├─ nyv-console (Next.js 14, port 80, nginx)
   │      └─ nyv-gateway (Node 22 + tsx, port 5000)
   │             │
   │             ├─► RDS Postgres 16  (public + nv_schema, 95 relations prod = 95 helium ✓)
   │             ├─► ElastiCache Redis 7.1  (LM-cache, sessions)
   │             ├─► OpenAI / Anthropic / Google / OpenRouter / Sarvam (NEW) /
   │             │    DeepSeek / Together / AgentZero  (7 LLM providers)
   │             ├─► S3 nyayavigya-sdk-devapp  (SDK tarballs via /downloads/sdk/)
   │             └─► CloudWatch  (6 alarms → SNS → email)
   │
   └─► EC2 (gateway also serves NSP origin via HMAC response-signing middleware)
```

### Key code regions
- **Routes** — `src/routes/nv-*-routes.ts` (78 routes, 110 console pages)
- **Orchestration** — `src/services/nv-orchestration-services.ts` (P1–P22)
- **RAG** — `src/services/rag-service.ts` + `src/services/nv-orchestration-services.ts > NvRagService`
- **Memory** — `src/services/memory-service.ts` + `org_memory_entries` / `memory_entries`
- **LLM router** — `src/services/llm-router-service.ts`
- **Schema** — `shared/schema.ts` + `shared/nv-schema-tables.ts` + `shared/nv-governance-schema.ts` (NEW 2026-04-29) + 4× `nyayasiddhi-*-schema.ts`
- **Migration runner** — `src/startup/nv-migration-safety-runner.ts` (idempotent ALTERs at boot)

---

## 5.0 Master Sprint Closeout — 2026-05-01 (NYV-NS-001 → NYV-NS-014)

One-line: **End-to-end P0 + P1 + P2 + LHF sprint executed; SDK v5.0.0
lockdown preserved; ready for code review.**

| Phase | Item | Status | Where |
|---|---|---|---|
| A | Demo-password sweep + rotation script | ✅ | `scripts/nv-rotate-demo-password.sh`, repo grep clean |
| A | LHF: lm-cache TTL 5m → 60m | ✅ | `src/services/lm-cache-backend.ts` |
| A | LHF: helmet `crossOriginResourcePolicy: 'cross-origin'` | ✅ | `src/index.ts` |
| A | LHF: `"sideEffects": false` in 6 packages | ✅ | `packages/*/package.json` |
| A | LHF: drizzle index on `sdk_app_api_keys.key_hash` | ✅ | `drizzle/0005_*.sql` |
| A | LHF: `console.log` → `createLogger()` (top 10 hot sites) | ✅ | `src/...` |
| B | `deploy-replit-direct.sh --dev/--prod` + thin wrappers | ✅ | `scripts/deploy-{dev,prod}.sh` |
| B | tsc preflight (warning mode, blocker via `NYV_DEPLOY_TSC_BLOCKER=1`) | ✅ | `scripts/deploy-replit-direct.sh` |
| B | Pre-commit hook + installer + `npm run hooks:install` | ✅ | `scripts/git-hooks/pre-commit`, `scripts/install-git-hooks.sh` |
| C | Migration `0006_unify_sdk_key_tables.sql` (idempotent) | ✅ | `drizzle/0006_*.sql` |
| C | Provision + keylife dual-write to `sdk_app_api_keys` | ✅ | `src/routes/nv-sdk-{provision,keylife}-routes.ts` |
| C | Seed script (rag namespaces/docs/chunks + audit genesis) | ✅ | `scripts/nv-seed-rag-and-audit.ts` |
| C | Boot-time audit hash-chain self-test | ✅ | `src/startup/nv-audit-chain-self-test.ts` (Step 5b) |
| D | Architecture canonical merge + redirect stubs | ✅ | `docs/.../NYV-ARCHITECTURE-CANONICAL.md` |
| D | `NyvLegalStatuteResponse` envelope + guard | ✅ | `packages/types/src/index.ts` |
| E | `requireDb` rebind across 5 hot files | ✅ | `src/utils/nv-type-helpers.ts` |
| E | TS error count: **2,104 → 1,746 (−358, −17%)** | ✅ | re-baseline |
| F | Canonical OpenAPI alias `/api/nv/openapi.{json,yaml}` | ✅ | `src/routes/nv-swagger-routes.ts` (full zod-derived spec deferred — lockfile risk during lockdown) |
| F | `src/services/job-queue.ts` `@deprecated` + warn-on-load | ✅ | physical delete blocked on consumer migration |
| F | Orchestration split barrel + per-class plan | ✅ scaffold | `src/services/orchestration/index.ts`; physical split queued |
| G | `/api/nv/admin/heap` super_admin-gated, rate-limited | ✅ | `src/routes/nv-admin-heap-routes.ts` |
| G | Vector-store eviction job (age + size, batched, audited) | ✅ | `src/services/nv-vector-eviction-job.ts` (Step 5c) |
| H | Tech-spec §14.0 sprint-status table | ✅ | `docs/v3.1.2/.../NYV-TECH-SPEC-MASTER.md` |
| H | This Project-Tracker §5.0 entry | ✅ | here |
| H | CHANGELOG entry | ✅ | `CHANGELOG.md › [Unreleased] 2026-05-01` |

**Operator-gated artifacts — executed 2026-05-01 (evening) on RDS dev:**

| # | Artifact | Status | Result |
|---|---|---|---|
| 1 | Apply `drizzle/0006_unify_sdk_key_tables.sql` on `nyv-dev-edge-pg` | ✅ DONE | 1 legacy app + 1 legacy key backfilled; `nyv_sdk_legacy_id_map` created (2 rows); deprecation comments live |
| 2 | Run `scripts/nv-seed-rag-and-audit.ts` on EC2 (target = RDS dev) | ⚠ PARTIAL | rag_namespaces 6→13 (+7 new); audit head already present (skipped); docs+chunks SKIPPED — see NYV-NS-004-FOLLOWUP |
| 3 | Live RDS password rotation (`nv-rotate-demo-password.sh`) | 🟡 PENDING | Now urgent: `nyvadmin` was incidentally exposed in conversation transcript during `docker exec env` discovery. Rotate via AWS Secrets Manager `nyv-dev-edge-pg/rds/master`, then restart `nyv-gateway` container so it picks up new DATABASE_URL |

Execution path: AWS SSM Session Manager (instance `i-0df71e5ea1df8f588`,
SSM agent online) — no SSH PEM was available, but EC2 was discoverable via
`aws ec2 describe-instances` and `aws ssm describe-instance-information`.
**Production RDS `nsp-prod-pg` was not touched** (freeze policy).

**NYV-NS-004-FOLLOWUP — schema gap discovered:** `nv_rag_documents` and
`nv_rag_chunks` are referenced by the seed script but are not created by
any drizzle migration (verified against live RDS dev — neither table
exists). The seed now short-circuits with a clear notice (commit on
2026-05-01); a follow-up migration is needed to create them. Suggested
schema is sketched in the seed (`scripts/nv-seed-rag-and-audit.ts`) —
operator/architect decision needed on FK behaviour, embedding column
type (vector vs text), and chunk-index uniqueness before finalising.

**NYV-OPS-IAM-001 — instance role missing Secrets Manager read:**
`nysdev-s3-access-role` cannot `GetSecretValue` on
`nyv-dev-edge-pg/rds/master`. Workable today (gateway container has
DATABASE_URL baked in), but post-rotation either the IAM policy must be
amended OR the rotation flow must redeploy the container with the new
URL. Suggest amending the IAM policy.

**Deferred (with reason):**

- Automated SDK publish pipeline → BLOCKED by v5.0.0 lockdown (§1).
- `src/packages/` → `packages/` consolidation → 1-2d refactor, post-GA.
- Config-driven jurisdiction-agent factory → 1-2d refactor, post-GA.
- Console as own pnpm workspace → 1d refactor, post-GA.
- Full physical split of `nv-orchestration-services.ts` → barrel landed; 1-2d follow-up post-GA.
- `zod-to-openapi` dependency install → post-GA (lockfile + lockdown).
- `job-queue.ts` deletion → 2 consumers must move to BullMQ first.

**Workflows green at sprint close:** NYV Gateway · NYV Console · NSP Web Example.

---

## 5. Drift-B Resolution (R-SCHEMA-B) Summary

(Full narrative in `CHANGELOG.md › [Unreleased] 2026-04-29 R-SCHEMA-B`.)

- **93 unique source-code refs** in `src/` for `nv_schema.<table>` (after
  stripping the `case_update_type` enum and the `nv_skillshop_` regex
  false-positive).
- **95 tables** now exist in local helium `nv_schema`: 26 prod-mirror
  (Drift-A) + 38 newly-created via `r-schema-b-missed-inline.sql` and
  `r-schema-b-reverse-engineered.sql` + 2 legacy declared in `shared/schema.ts`
  (`model_governance`, `nv_audit_logs`) + 28 prod-mirror that overlap, plus
  the difference accounts for tables in helium not yet in prod (29 tables
  exclusive to helium awaiting `R-SCHEMA-B-DEPLOY`).
- **95 Drizzle decls**: `shared/schema.ts` (2) + `shared/nv-schema-tables.ts`
  (26) + `shared/nv-governance-schema.ts` (67) — wired into
  `drizzle.config.ts`.
- Generator: `scripts/gen-drizzle-from-helium.cjs` introspects helium and
  emits Drizzle TypeScript with correct `serial` / `uuid` / `varchar` /
  `numeric(P,S)` / `timestamp({withTimezone, precision})` / `vector(1536)` /
  `tsvector` (custom) / `pgEnum` declarations and full index set.

---

## 6. Pre-task ritual (MANDATORY)

Before starting ANY task, Replit Agent must:

1. `cat CHANGELOG.md | head -100` (or read [Unreleased] + most recent
   release section).
2. `cat Project-Tracker.md | head -60` (last 3–5 dated entries).
3. `cat docs/PROJECT-TRACKER.md` (this file).
4. Check the relevant skill SKILL.md if the task touches:
   - DB → `package-management`, `database` (production), and re-read
     `<important_database_safety_rules>`.
   - Workflows → `workflows`.
   - Secrets → `environment-secrets`.

After completing the task, before `mark_task_complete`:

1. Append a narrative block to `CHANGELOG.md` `[Unreleased]`.
2. Append a row to `Project-Tracker.md` under the right date heading.
3. Update §1 / §2 / §3 of THIS file as needed (move items between Pending
   and Completed; refresh State row counts; record any new architecture
   files).
4. Write a one-paragraph commit message at `.local/.commit_message`.
