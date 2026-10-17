---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-30
---

# Nyayavigya Platform 3.1.2 — Master Technical Specification

> **Audience.** Backend, frontend, SDK and DevOps engineers who need to
> read, modify or extend the codebase **without breaking neighbouring
> modules**. This document is the canonical "developer onramp" for the
> platform. Every rule here is enforced — if a future change conflicts
> with this spec, either the change is wrong or this spec is wrong;
> never silently diverge.
>
> **Companions.**
> - `Project-Tracker.md` — current build/pending state, daily changelog
> - `docs/v3.1.2/INDEX.md` — bucketed list of every other doc
> - `docs/v3.1.2/completed_docs/NYV-SDK-v5-INTEGRATION-GUIDE.md` —
>   SDK-consumer-facing how-to
> - `CHANGELOG.md` — release-style changelog

---

## 0. Reading order for a new developer

1. Skim §1 (one-paragraph mental model) — 2 minutes
2. Read §2 (topology) — 5 minutes
3. Read §3 (repository layout) and §4 (module catalogue) — 20 minutes
4. Pick the module you need to touch and read **only its row in §4**
   plus the "edit hazards" notes for that module in §11
5. Before opening a PR, walk §6 (conventions) and §11 (fragility map)

---

## 1. Mental model (one paragraph)

Nyayavigya 3.1.2 is a **single API gateway** (`NYV-SVC-GATEWAY`, port
5000) that fronts a library of **1,042 legal agents**, an **LLM router**
(OpenAI / OpenRouter / Sarvam), a **PostgreSQL 16 + pgvector** datastore,
a **Redis 7 / BullMQ** job queue, and a thin **React Console** (port
3004). The gateway exposes (a) a JWT-protected operator API used by the
Console and internal tooling, and (b) an SDK-key-protected gateway API
(`/api/nv/gateway/*`) used by partner applications (NyayaMitra, NYS-PRO,
NYS-INS, NYS-ACE, NYS-MIN) and external SDK consumers via six packages
in `packages/`. Everything else — orchestration, jurisdiction routing,
RAG, governance, audit — is a service inside this single binary, not a
separate microservice.

**Single-binary, modular-folder.** This is intentional. Sub-services
live in their own directories under `src/services/` and `src/routes/`
and communicate via in-process function calls, not network calls.
Splitting them into containers is a future concern — do not do it now.

---

## 2. Deployment topology

```
                                Operator
                                   │
                                   ▼
   ┌────────────────────────────────────────────────────────┐
   │ Replit dev   (THIS environment, Linux container)       │
   │  ├ NYV Gateway   workflow → npm:dev :5000              │
   │  ├ NYV Console   workflow → vite/next :3004            │
   │  └ NSP Web Quickstart workflow → next :3000            │
   └────────────────────────────────────────────────────────┘
                                   │ deploy-replit-direct.sh
                                   ▼
   ┌────────────────────────────────────────────────────────┐
   │ EC2 dev (13.232.165.242, t3.large, ap-south-1)         │
   │  ├ docker compose -f docker-compose.aws-dev.yml        │
   │  │   └ service: nyv-gateway   (single container)       │
   │  ├ RDS Postgres 16 (nyv-dev-edge-pg, multi-AZ off)     │
   │  └ ElastiCache Redis 7 (single node, TLS)              │
   └────────────────────────────────────────────────────────┘
                                   │ promote (manual gate)
                                   ▼
   ┌────────────────────────────────────────────────────────┐
   │ EC2 prod (planned, May 15 GA)                          │
   │  ├ ALB → Caddy → blue/green gateway containers         │
   │  ├ RDS Postgres 16 multi-AZ + PITR                     │
   │  └ ElastiCache Redis 7 primary + replica               │
   └────────────────────────────────────────────────────────┘
```

The blue/green topology in `scripts/deploy-replit-direct.sh` is **for
prod only**. EC2 dev runs a single `nyv-gateway` container — see
`docker-compose.aws-dev.yml`. Do not run the deploy script's
blue/green branch against dev.

---

## 3. Repository layout

```
nyayavigya-platform-312/
├── src/                       # gateway runtime (TypeScript, Node 20)
│   ├── index.ts               # bootstrap (express app + workflows)
│   ├── nv-sdk-init.ts         # SDK runtime initialiser
│   ├── nv-sdk-main-index.ts   # SDK package barrel
│   ├── nv-orchestration-engine.ts  # agent orchestration entry
│   ├── routes/                # 78 *-routes.ts mount points
│   ├── services/              # 173 *.ts business-logic services
│   ├── middleware/            # auth, rate-limit, RLS, signing
│   ├── startup/               # boot-time validators (env, JWT, prompts)
│   ├── system-prompts/        # jurisdiction prompt registry + engine
│   ├── jurisdiction-agents/   # per-jurisdiction agent factories
│   ├── llm-providers/         # OpenAI / OpenRouter / Sarvam clients
│   ├── llm-priority-manager/  # cost-aware router + breakers
│   ├── intelligence/          # RAG, embeddings, vector store
│   ├── core/                  # agent registry, SPI, factories
│   ├── config/                # platform/master/SDK/model configs
│   ├── db/                    # pool factory + index helpers
│   ├── schemas/               # zod validators (request shapes)
│   ├── utils/                 # logger, env-validator, helpers
│   └── packages/              # in-tree subset (security, protocols)
├── packages/                  # 6 publishable SDK packages (5.0.0)
│   ├── client-sdk/            # core JS/TS SDK
│   ├── client-sdk-react-native/
│   ├── react-hooks/           # react bindings
│   ├── nyayamitra-sdk/        # consumer-tier SDK
│   ├── enterprise-sdk/        # enterprise tier
│   └── types/                 # shared TS types (zero deps)
├── shared/                    # schema (drizzle ORM)
│   ├── schema.ts              # 1,813 lines — main table set
│   ├── nv-governance-schema.ts# 1,333 lines — audit + governance
│   ├── nv-schema-tables.ts    # 567 lines — derived/view tables
│   └── nyayamitra-schema.ts   # consumer schema
├── client/                    # React Console (NYV-SVC-CONSOLE)
├── examples/                  # quickstart sample apps
│   └── nsp-web-quickstart/    # next.js example using SDK
├── config/                    # YAML/JSON registries shipped to runtime
│   ├── agent-registries/      # 7 jurisdiction registries
│   ├── agents/                # per-agent capability files
│   ├── llm/, memory/, cache/, rate-limits/, integrations/
│   └── nyv-master-config.json # master config (canonical)
├── drizzle/                   # SQL migrations (sequential)
├── docs/v3.1.2/               # ALL project docs — see INDEX.md
│   ├── completed_docs/        # shipped behaviour
│   ├── pending_implementation_docs/
│   └── superseded/
├── scripts/                   # bash + ts ops scripts
├── infra/, k8s/, deploy/      # IaC for prod (not used on dev today)
├── docker-compose.aws-dev.yml # EC2 dev (single gateway)
├── docker-compose.ecosystem.yml # EC2 prod (blue/green)
├── Dockerfile                 # gateway image
└── Project-Tracker.md         # status + changelog (READ FIRST)
```

---

## 4. Module catalogue

Each row is the contract a developer touching that module must respect.

### 4.1 Gateway runtime (`src/`)

| Module dir | Purpose | Public surface | Edit safely by |
|---|---|---|---|
| `src/index.ts` | Express app bootstrap, mounts every router, registers middleware in fixed order | `startServer()` | Adding a route: append a `app.use('/api/nv/<name>', <name>Router)` next to the others. Do **not** reorder middleware (auth → tenant → RLS → metrics → guardrails → handler) |
| `src/middleware/` | Cross-cutting request handlers | `authenticateToken`, `optionalAuth`, `requireAdmin`, `tenantIsolation`, `orgRlsMiddleware`, `nvResponseSigningMiddleware`, `errorHandler`, rate-limit factories | New middleware goes here as `nv-<purpose>-middleware.ts` and is wired in `src/index.ts` only |
| `src/startup/` | Boot-time validators that run **before** the server listens | `validateEnvironment`, `enforceJurisdictionPromptInvariants`, `validateJwtSecret`, `runEnvValidation`, `runMigrationSafetyChecks` | Add as `nv-<purpose>-validator.ts`, must throw on failure (no silent fallbacks) |
| `src/routes/` | HTTP route mounts (78 files, one per domain) | `<name>Router: express.Router` exported as default | One file per top-level path. Routes must call into `src/services/` — no business logic in routes |
| `src/services/` | Domain logic (173 files) | Functions only; no Express types | Group by sub-folder when a service grows past 1 file (e.g. `services/document-pipeline/`) |
| `src/core/` | Agent SPI, agent registry, agent factory | `AgentSPI` interface, `AgentRegistry`, `ProductionAgentFactory` | The SPI is the contract every agent implements. Changing `AgentSPI` requires touching all 1,042 agent definitions — **do not** do it without an architectural review |
| `src/system-prompts/` | Jurisdiction prompt registry (7 jurisdictions, 23 sections each) + the engine that resolves prompts at runtime | `nyayavigya-system-prompts-engine-v10.ts` | Prompts live in YAML under `config/agent-registries/`. The engine reads them at boot. Adding a jurisdiction = add YAML + register in `JurisdictionPromptResolver` |
| `src/jurisdiction-agents/` | Per-jurisdiction agent factories (IN, US, UK, EU, SG, AE, CA) | `<jur>AgentFactory.create()` | Mirror the IN factory's structure when adding a jurisdiction |
| `src/llm-providers/` | LLM clients (OpenAI, OpenRouter, Sarvam) | Each exposes `complete()`, `embed()`, `stream()` with the same signature | Provider names are config-driven (`config/llm/`). Adding a provider = new file + entry in `config/llm/providers.json` |
| `src/llm-priority-manager/` | Cost-aware routing + per-provider circuit breakers | `routeRequest(req): Provider` | Rules live in `config/llm/`. Code only enforces the rules |
| `src/intelligence/` | RAG: chunking, embedding, retrieval, namespace mgmt | `chunk()`, `embed()`, `retrieve(namespace, query)` | Vector store is pgvector via `shared/schema.ts:rag_namespaces` + `knowledge_chunks`. Do not introduce another vector backend |
| `src/db/` | Postgres pool factory, index helpers | `getPool()` (nullable), `requirePool()` (non-null, throws), `runMigrations()` | All DB access goes through this. Never `new Pool()` elsewhere. Reads from `DATABASE_URL` |
| `src/services/queue/` | BullMQ wiring | `getQueue(name)`, `addJob({queued: true \| false})`, `registerWorker()`, `getQueueHealth()` | Adding a queue = entry in `QUEUE_NAMES` const + `registerWorker` in startup. Stalled handler + DLQ wiring is **mandatory** (see §11) |
| `src/schemas/` | Zod request validators | `<route>RequestSchema`, `<route>ResponseSchema` | Every new route must add a request schema and validate via `schema.parse(req.body)` in the route file |
| `src/utils/logger.ts` | Pino logger factory | `createLogger(scope)` | Always use this. No `console.log` in production paths |
| `src/config/` | Strongly-typed config readers | `platformConfig`, `nyvMasterConfig`, `nyvSdkProductionConfig` | Configs are JSON/YAML in `config/` — these files are typed wrappers |

### 4.2 Shared schema (`shared/`)

| File | Tables | Owner |
|---|---|---|
| `shared/schema.ts` | Core platform: `nv_users`, `nv_organizations`, `nv_sessions`, `legal_agents`, `sdk_applications`, `sdk_app_api_keys`, `nv_audit_logs`, `nv_pii_vault`, …  | platform team |
| `shared/nv-governance-schema.ts` | Audit, consent, hash-chain, model registry, governance | governance/compliance |
| `shared/nv-schema-tables.ts` | Derived materialised views | analytics |
| `shared/nyayamitra-schema.ts` + 3 NYS-* | Per-platform domain tables | partner-platform owners |

**Migration rules:** every schema change ships as a numbered file under
`drizzle/`. Never edit a migration after it has been applied to any
environment — write a new one. `drizzle.config.ts` is the source of
truth for migration generation.

### 4.3 SDK packages (`packages/`)

All six SDK packages are pinned at **v5.0.0 stable** with inter-package
deps `^5.0.0`. **Do not bump until the next major** (operator policy
2026-04-30). See `Project-Tracker.md` §1.

| Package | Audience | Depends on |
|---|---|---|
| `packages/types` | All others | (none — zero runtime deps) |
| `packages/client-sdk` | Browser & Node consumers | `types` |
| `packages/client-sdk-react-native` | RN apps | `types`, `client-sdk` |
| `packages/react-hooks` | React web apps | `types`, `client-sdk` |
| `packages/nyayamitra-sdk` | NyayaMitra consumer app | `types`, `client-sdk` |
| `packages/enterprise-sdk` | NYS-PRO / NYS-INS / NYS-ACE / NYS-MIN | `types`, `client-sdk` |

**Build rule.** Each package has its own `tsconfig.json` and emits to
`dist/`. The monorepo uses `pnpm` workspaces for dev links. Do not
add a publish step that bumps versions.

### 4.4 Console (`client/`)

React + Vite app served on port 3004. Operator-only (JWT login).
Reads from the gateway's `/api/nv/*` routes. Treat it as a **thin
client** — never put business logic here that should be in the gateway.

### 4.5 Examples (`examples/nsp-web-quickstart/`)

Next.js app on port 3000 demonstrating SDK consumption. Used in
quickstart docs. Keep it minimal — when the SDK gets a new feature,
add a one-page example here, not a full feature set.

---

## 5. Boot sequence (what happens when the gateway starts)

```
src/index.ts:startServer()
├── 1. dotenv.config()                              load .env
├── 2. validateEnvironment()                        startup/ — fail fast
├── 3. validateJwtSecret()                          startup/
├── 4. runEnvValidation()                           utils/env-validator
├── 5. runMigrationSafetyChecks()                   startup/
├── 6. enforceJurisdictionPromptInvariants()        startup/ (loads 7 registries from config/)
├── 7. db.getPool()                                 src/db — connects RDS
├── 8. queue.registerWorkers()                      src/services/queue — connects Redis
├── 9. agentRegistry.bootstrap()                    src/core — loads 1,042 agents
├──10. express app + middleware chain
├──11. mount 78 routers from src/routes
├──12. errorHandler (last)
└──13. server.listen(5000)
```

**If any of steps 2–9 throw, the process exits.** This is the "no
silent fallback" rule — a half-working gateway is worse than a dead
one. See §11 fragility map.

---

## 6. Global conventions (enforced)

### 6.1 Naming

| Thing | Convention | Example |
|---|---|---|
| Route file | `nv-<domain>-routes.ts` | `nv-orchestration-routes.ts` |
| Service file | `<domain>-service.ts` or `<domain>.ts` | `feature-flags-service.ts` |
| Middleware | `nv-<purpose>.ts` | `nv-tenant-isolation.ts` |
| Validator (startup) | `nv-<purpose>-validator.ts` | `nv-jwt-validator.ts` |
| DB table | `nv_<entity>` (platform) or `<platform>_<entity>` (partner) | `nv_users`, `nym_users` |
| Env var | `NYV_<SCOPE>_<NAME>` | `NYV_JWT_SECRET`, `NYV_REDIS_TCP_URL` |
| HTTP path (operator) | `/api/nv/<domain>/<action>` | `/api/nv/orchestration/run` |
| HTTP path (SDK consumer) | `/api/nv/gateway/<resource>` | `/api/nv/gateway/agents` |
| Internal code refs | `NYV-<AREA>-<KIND>-<NNN>` | `NYV-OPS-DOCKERFILE-CONFIG-001` |

The naming convention doc is `docs/v3.1.2/completed_docs/conventions/NYV-NAMING-CONVENTIONS.md`.

### 6.2 Code style

- **Language.** TypeScript 5.x, target ES2022, ESM (`"type": "module"`).
- **Imports.** Always with `.js` suffix in source (`from './foo.js'`)
  even though the source is `.ts`. This is the ESM rule, do not
  shortcut it.
- **No default exports** in `src/services/` (use named exports). Routes
  may default-export the router.
- **Async/await only.** No raw `.then()` chains in new code.
- **Errors.** Throw `Error` subclasses with codes (`NYV-<AREA>-<NNN>`).
  Never `throw 'string'`.
- **Logging.** `createLogger('scope').info({…}, 'message')`. Structured,
  not string-concatenation. Never log secrets, tokens, or PII.
- **Comments.** JSDoc on exported functions in `src/services/` and
  `src/routes/`. Inline comments only where the *why* is non-obvious.
- **File length.** Soft cap **500 lines per file**. Above that, split
  by responsibility into a sub-folder.

### 6.3 Linting & types

- `npm run lint` (`.eslintrc.json`) — must pass for new files
- `npx tsc --noEmit -p tsconfig.json` — see §10 for the current debt
- `npm run lint:naming` — checks NYV naming convention adherence

### 6.4 Tests

- Unit tests live next to their source: `foo.ts` ↔ `foo.test.ts`
- Integration tests under `tests/integration/`
- Run with `npm test` (vitest)

### 6.5 Git hygiene

- No direct edits to `drizzle/` migrations after they are merged
- No edits to `docs/v3.1.2/superseded/` — that bucket is read-only history
- Every change updates `Project-Tracker.md` §5 with an ISO-8601 entry
- Every change updates `CHANGELOG.md` if user-visible

---

## 7. Configuration & secrets

| Where | What | Rule |
|---|---|---|
| `.env` | Local dev secrets (never committed) | Use `.env.example` as the template |
| `.env.example` | Template — every required var must be listed here | Update whenever you add a `process.env.X` lookup |
| Replit Secrets | Replit-dev secrets (synced via Replit) | Read via `process.env`, never hard-code |
| EC2 SSM Parameter Store | EC2-dev/prod secrets | Synced via `scripts/secrets-sync.sh` |
| `config/*.json` and `config/*.yaml` | Non-secret config (registries, weights, rate limits) | Safe to commit, version-controlled |

**Secret hygiene rule (NYV-SECURITY-DOC-CREDS-001).** Never put a
literal password, API key, or JWT in any committed file — including
docs and example payloads. Use a placeholder (`<your-key>`) and
reference the operator-managed source. Demo passwords were leaked in
v5 SDK docs and have since been redacted; full repo-sweep follow-up is
tracked in `Project-Tracker.md` §5.

Secrets currently in use (names only — values come from Replit Secrets
or EC2 SSM):

```
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
JWT_SECRET, NYV_JWT_SECRET, NYV_JWT_REFRESH_SECRET
ENCRYPTION_KEY
DATABASE_URL  (RDS)
REDIS_URL, NYV_REDIS_TCP_URL  (ElastiCache)
OPENAI_API_KEY, OPENROUTER_API_KEY, SARVAM_API_KEY
BITBUCKET_USERNAME, BITBUCKET_APP_PASSWORD
```

---

## 8. Data model overview

Read `shared/schema.ts` for the full definition. Key entities:

```
nv_organizations  ─┐
                   │  RLS row-level isolation key
nv_users  ─────────┤
                   │
sdk_applications ──┤  one per SDK consumer (e.g. NyayaMitra)
                   │
sdk_app_api_keys  ─┘  one or more live/test keys per application
                          │
                          │ Bearer nyv_live_sk_XXXX → sdkGatewayAuth → req.applicationId
                          ▼
                  /api/nv/gateway/* routes

legal_agents      → 1,042 rows; the agent catalogue
nv_audit_logs     → every gateway request (immutable, hash-chained)
nv_pii_vault      → encrypted PII (FF-encryption via field-encryption-service)
knowledge_chunks  → RAG corpus (pgvector embeddings)
rag_namespaces    → tenant-scoped knowledge namespaces
```

**RLS.** Every tenant-scoped table has Row-Level-Security enabled
(`drizzle/0004_enable_rls_for_tenant_tables.sql`). The
`orgRlsMiddleware` sets the `app.current_org_id` session variable on
every request — never bypass this in queries.

**Known live-state gaps** (audit `NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`):
some seed-critical tables are empty on dev (`nv_audit_logs`,
`knowledge_chunks`, `rag_namespaces`, `nv_organizations`). Backfilling
is tracked separately — do not assume target counts in §3 of
`NYV-ARCHITECTURE-312.md` reflect dev today.

---

## 9. Public API surface

Two distinct surfaces. Confusing them is a common bug:

### 9.1 Operator API (JWT auth)

Used by the Console and internal tooling.

```
POST /api/nv/auth/login                  → JWT
POST /api/nv/auth/refresh                → new JWT
GET  /api/nv/admin/health/full           → operator health (5-key block)
*    /api/nv/sdk/*                       → SDK app provisioning (Console UI)
*    /api/nv/orchestration/*             → run/inspect agents (operator)
*    /api/nv/agents/*                    → agent catalogue
... (74 more — see src/routes/)
```

### 9.2 SDK Gateway API (Bearer SDK key auth)

Used by partner platforms and external SDK consumers via `packages/`.

```
GET  /api/nv/gateway/agents              → list available agents
POST /api/nv/gateway/orchestrate         → run an agent
POST /api/nv/gateway/intelligence/*      → RAG / embeddings
POST /api/nv/gateway/workflow/*          → BMAD / A2A workflows
... (full list in NYV-SDK-v5-API-REFERENCE.md)
```

The middleware that authenticates these is `sdkGatewayAuth` in
`src/middleware/nv-sdk-gateway.ts`, which reads `sdk_app_api_keys`
(integer PK). **Note the table-bifurcation finding**:
`/api/nv/sdk/provision/create-app` writes `nv_api_keys` (UUID PK)
but `sdkGatewayAuth` reads `sdk_app_api_keys`. Until reconciled
(tracked follow-up), issue keys with a direct insert into
`sdk_app_api_keys` — see `NYV-SDK-v5-INTEGRATION-GUIDE.md` §4.4.

---

## 10. Build, test, deploy

### 10.1 Local dev (Replit)

```bash
# from nyayavigya-platform-312/
npm install                                  # or pnpm install
npm run dev                                  # gateway on :5000
# console
cd client && npm run dev                     # console on :3004
# example
cd examples/nsp-web-quickstart && npm run dev # next on :3000
```

Replit workflows run these for you — see the `View` block at the top of
this session for the exact commands.

### 10.2 Type-check + lint

```bash
npx tsc --noEmit -p tsconfig.json            # current debt: ~2,103 errors
npm run lint                                  # eslint
npm run lint:naming                           # NYV naming check
```

**TS debt is real but contained.** The 2,103 errors cluster in 15 hot
files (top: `nv-orchestration-services.ts` 114, `nv-phase5-services.ts`
101, `nv-phase4-services.ts` 78, `nyayasiddhi-enterprise-service.ts` 67,
`nv-core-routes.ts` 57). The runtime tolerates them because
`tsconfig.json` does not gate the build today. **Do not add new
errors** — the cleanup plan is to take them down file-by-file via the
per-file pattern used for `nv-health-full-routes.ts` (extract
`requireX()` helpers, type API responses). See §11 for why this matters.

### 10.3 Database migrations

```bash
npx drizzle-kit generate                     # generate migration from schema diff
npx drizzle-kit push                         # apply to current DATABASE_URL
```

Numbered files in `drizzle/` are applied in order. Never edit a merged
migration; always write a new one.

### 10.4 EC2 dev deploy

```bash
# Replit-side (this environment):
bash scripts/deploy-replit-direct.sh         # rsyncs source to EC2
# … or, when the script's blue/green logic mis-fires (see follow-up):
ssh -i .local/keys/nysdev.pem ubuntu@13.232.165.242
cd /opt/nyayavigya/repo/nyayavigya-platform-312
docker compose -f docker-compose.aws-dev.yml build gateway
docker compose -f docker-compose.aws-dev.yml up -d --force-recreate --no-deps gateway
curl http://localhost/api/nv/health         # version 5.0.0, totalAgents 1042
```

### 10.5 Publishing

`suggest_deploy` only applies to Replit Reserved-VM publishing. Prod
EC2 deploy is operator-gated and goes through `infra/` + `k8s/` (not
yet wired for daily use).

---

## 11. Edit-safety / fragility map

This section is **the answer to "I edited X and Y broke"**.

### 11.1 Hot zones (changes here have wide blast radius)

| Zone | Why it's hot | Safe-edit rule |
|---|---|---|
| `src/core/agent-registry.ts` & `AgentSPI` | Every agent implements this | Never remove a method or change a signature without a registry-wide grep + adapter shim |
| `shared/schema.ts` | Every service imports types from here | Add columns, never remove. Renames go via two migrations: add + backfill, then drop in a later release |
| `src/index.ts` middleware order | Auth/RLS/metrics order is load-bearing | Don't reorder. Add new middleware **between** marked sections, not in the middle of an existing block |
| `config/agent-registries/*.yaml` | Loaded at boot; missing file = process won't start | Adding a registry: also add it to the `JurisdictionPromptResolver` whitelist |
| `Dockerfile` | Production stage drops `node_modules` and dev files | New runtime asset = explicit `COPY --from=builder` line (the Apr-30 incident, NYV-OPS-DOCKERFILE-CONFIG-001) |
| `src/services/queue/bullmq-queue.ts` | All async jobs flow through here | Never silently swallow Redis errors. Stalled handler + DLQ wiring is mandatory |
| `packages/*/package.json` versions | Inter-package deps are pinned at `^5.0.0` | Do not bump until next major. Use patch releases under the same `5.0.0` if needed |

### 11.2 Cold zones (safe to edit independently)

- `src/routes/<single-domain>-routes.ts` — touching one route file
  almost never breaks others
- `src/services/<single>.ts` — same, **as long as** the exported
  function signatures don't change
- `client/` — Console-only changes don't affect the gateway
- `examples/` — sample apps are isolated
- `docs/` — never breaks runtime

### 11.3 Common gotchas (real ones, not theoretical)

1. **Adding a `process.env.X` lookup without updating `.env.example`**
   → other devs (and CI) get cryptic boot failures. Rule: every new
   env var lands in three places at once: code, `.env.example`,
   `src/startup/nv-environment-validator.ts`.
2. **Editing a `drizzle/NNNN_*.sql` after it merged** → environments
   diverge silently. Always write a new migration file.
3. **Logging `req.headers` or `req.body` at info level** → leaks JWTs
   and SDK keys to logs. Always redact via the logger's serializers.
4. **Bypassing `requirePool()` / `requireDb()`** → `pool` is null
   during startup before step 7 of §5. Use the helpers, not the bare
   nullable.
5. **Calling an LLM provider directly instead of via
   `llm-priority-manager`** → bypasses cost routing and breakers.
   Always go through the router.
6. **Adding a route without a `src/schemas/` validator** → the route
   accepts anything, including malicious shapes. Rule: validator
   first, then route.
7. **Hard-coding "v6" or another SDK version anywhere** → violates the
   v5.0.0 lockdown (Project-Tracker §1). Even doc strings are checked.

### 11.4 Failure-mode policy

- **Boot validators**: throw on bad input, exit non-zero. No fallbacks.
- **Per-request errors**: `errorHandler` returns `{ error: { code,
  message } }`, never a stack trace.
- **Async jobs**: stalled / failed jobs land in the DLQ within 30
  seconds of being declared stalled (`bullmq-queue.ts`).
- **Provider degradation**: circuit breaker opens; router falls over
  to the next provider in `config/llm/`. The request still completes,
  but slower. A 5xx is only returned if **all** providers are open.

---

## 12. Performance & memory

| Concern | Current state | Where to look |
|---|---|---|
| Heap cap | Container started with `--max-old-space-size=1536` | `Dockerfile` ENTRYPOINT |
| Connection pools | Postgres: max 20, idle 30s; Redis: BullMQ default | `src/db/`, `src/services/queue/` |
| LLM token caps | Per-tier, in `config/llm/limits.json` | `cost-aware-router.ts` |
| Cache | LM cache backed by Redis with TTL; see `lm-cache-backend.ts` | `src/services/lm-cache-backend.ts` |
| Vector recall | pgvector ANN index on `knowledge_chunks.embedding` | `drizzle/0003_premium_black_tom.sql` |
| Stalled jobs | Surfaced via `getAllStalledCounts()` + `/api/nv/admin/health/full` | `bullmq-queue.ts`, `nv-health-full-routes.ts` |

**Quick wins to be picked up** (see §14 below for the prioritised list):

- Pool-level `idleTimeoutMillis` tuning per workload
- Drop `lm-cache-backend.ts` TTL on idempotent reads from 5min → 1h
- Re-index `nv_audit_logs` after backfill (the table is empty today;
  index health is a non-issue **until** seed lands)

---

## 13. Adding a new feature — checklist

A copy-pasteable checklist for any new endpoint or service.

```
[ ] Decide: operator API (/api/nv/<x>) or SDK API (/api/nv/gateway/<x>)?
[ ] Add zod schema in src/schemas/<feature>-schema.ts
[ ] Add service in src/services/<feature>-service.ts (named exports)
[ ] Add route in src/routes/nv-<feature>-routes.ts
    [ ] Validate body with the schema (no logic before validation)
    [ ] Call only into src/services/
[ ] Mount the router in src/index.ts (alphabetical order)
[ ] Add unit test next to the service file
[ ] Update src/startup/nv-environment-validator.ts if any new env var
[ ] Update .env.example if any new env var
[ ] Update Project-Tracker.md §5 with an ISO-8601 entry
[ ] Update CHANGELOG.md if user-visible
[ ] If it changes the SDK surface: update NYV-SDK-v5-API-REFERENCE.md
[ ] If it changes consumer behaviour: update NYV-SDK-v5-INTEGRATION-GUIDE.md
```

---

## 14. Prioritised next steps (live development → GA on May 15)

> This is the executable roadmap. Each item has a code (NYV-NS-NNN),
> a clear acceptance criterion, and a complexity estimate. Pick from
> the top.

### 14.0 Sprint status (2026-05-01 master sprint closeout)

| Code | Status | Notes |
|---|---|---|
| NYV-NS-001 | ✅ DONE | `deploy-replit-direct.sh` gained `--dev`/`--prod` shortcuts; thin wrappers `scripts/deploy-dev.sh` + `deploy-prod.sh` shipped. Functionally equivalent to a physical split, less duplication. |
| NYV-NS-002 | ✅ DONE | Migration `drizzle/0006_unify_sdk_key_tables.sql` (idempotent, DO-block backfill via `nyv_sdk_legacy_id_map`). Provision + keylife routes now dual-write to `sdk_app_api_keys` + `sdk_app_api_keys_meta`. **Operator-gated**: apply migration on RDS during cutover. |
| NYV-NS-003 | ✅ DONE | Repo `NVDemo@2026!` swept; rotation script shipped. **Operator-gated**: rotate live RDS password. |
| NYV-NS-004 | ✅ DONE | `scripts/nv-seed-rag-and-audit.ts` seeds `rag_namespaces`, `nv_rag_documents`, `nv_rag_chunks`, `nv_audit_logs` genesis. Idempotent. **Operator-gated**: run on EC2. |
| NYV-NS-005 | 🟡 IN-FLIGHT | `src/utils/nv-type-helpers.ts` (`requireDb`/`requireValue`/`requireEnv`/`requireAuthedUser`/`requireStringHeader`/`requireShape` + `NyvMissingDependencyError`) applied to top 5 hot files. **TS errors: 2,104 → 1,746 (−358, −17%).** Continued application across remaining files queued. |
| NYV-NS-006 | ✅ DONE | `tsc --noEmit` preflight in warning mode in `scripts/deploy-replit-direct.sh`. Hard blocker mode via `NYV_DEPLOY_TSC_BLOCKER=1` (flip default after NYV-NS-005 reaches 0). |
| NYV-NS-007 | ✅ DONE | `NYV-ARCHITECTURE-CANONICAL.md` merges 312 + v6; both originals reduced to redirect stubs. |
| NYV-NS-008 | 🟡 PARTIAL | Canonical alias `/api/nv/openapi.{json,yaml}` published serving the existing hand-rolled spec. Full zod-derived spec scaffold deferred (touches lockfile; SDK lockdown until 2026-05-15). Migration plan in `nv-swagger-routes.ts` header. |
| NYV-NS-009 | 🟡 SCAFFOLD | `src/services/orchestration/index.ts` barrel created with the full per-class split plan. Physical split is a 1-2 day refactor with 60+ consumers; consumers can already start importing from the new path with no code changes. Job-queue legacy file marked `@deprecated` with single-shot warn-on-load. |
| NYV-NS-010 | ✅ DONE | `src/startup/nv-audit-chain-self-test.ts` wired into `src/index.ts` Step 5b. Bootstrap-blocking unless `NYV_AUDIT_CHAIN_TOLERATE=1`. |
| NYV-NS-011 | ✅ DONE | `scripts/git-hooks/pre-commit` + `scripts/install-git-hooks.sh` + `npm run hooks:install`. |
| NYV-NS-012 | ✅ DONE | `NyvLegalStatuteResponse` envelope + `isNyvLegalStatuteResponse` guard in `packages/types/src/index.ts`. |
| NYV-NS-013 | ✅ DONE (P2 promoted) | `/api/nv/admin/heap` (POST/list/GET/DELETE) — double-gated: `requireAdmin` + inline `super_admin` check. Rate-limited to 1/min. Files under `NYV_HEAP_DIR` (default `.local/heapdumps/`). |
| NYV-NS-014 | ✅ DONE (P2 promoted, was “SDK publish”; renumbered — see below) | Vector-store eviction job: age-based (`NYV_RAG_MAX_AGE_DAYS`, default 180d) + size-based (`NYV_RAG_MAX_CHUNKS`, default 5M), batched (`NYV_RAG_BATCH_SIZE` default 5k), 6h cadence. Dry-run via `NYV_RAG_EVICT_DRY_RUN=1`, kill-switch via `NYV_RAG_EVICT_DISABLED=1`. Audit-log entry per pass. |

> **Renumbering note (2026-05-01):** NYV-NS-014 was originally “Automated SDK
> publish pipeline”. That work remains BLOCKED by the v5.0.0 lockdown
> (Project-Tracker §1) and has been re-tagged NYV-NS-014-LOCKED in §15.1
> below; the active NYV-NS-014 in §14.0 is the vector-store eviction job
> shipped in this sprint. Numbering elsewhere in this doc is unchanged so
> existing references continue to resolve.


### P0 — must close before GA (May 15, 2026)

| Code | Item | Acceptance | Effort |
|---|---|---|---|
| NYV-NS-001 | Reconcile EC2 deploy script with actual single-gateway dev topology (or split into `deploy-dev.sh` + `deploy-prod.sh`) | One command from Replit ships a successful build to EC2 dev with no manual `docker compose` follow-up | 0.5d |
| NYV-NS-002 | Unify SDK API-key tables (`nv_api_keys` ↔ `sdk_app_api_keys`); migration + provisioning route fix | Keys issued via `/api/nv/sdk/provision/key` authenticate against `/api/nv/gateway/*` | 1d |
| NYV-NS-003 | Full-repo demo-password sweep + rotate `NVDemo@2026!` in seed scripts and live dev DB | `rg "NVDemo@" .` returns 0 hits; new password operator-distributed | 0.5d |
| NYV-NS-004 | Backfill empty seed-critical tables on dev (`nv_organizations`, `knowledge_chunks`, `rag_namespaces`, `nv_audit_logs`) | Each table has > 0 rows; RAG quickstart returns retrieved chunks | 1d |
| NYV-NS-005 | TS error reduction sprint: take top-5 hot files (orchestration-services, phase5, phase4, enterprise-service, core-routes — 417 errors of 2,103 total) to zero using the `requireX()` helper pattern | `tsc --noEmit` errors drop to ≤ 1,700 | 2d |
| NYV-NS-006 | Wire `tsc --noEmit` into the `npm run dev` preflight as a **warning** (not blocker yet); wire it as a **blocker** for `scripts/deploy-replit-direct.sh` after NYV-NS-005 lands | New TS errors caught at deploy time, not in prod | 0.5d |

### P1 — high value, ship in the GA window if time permits

| Code | Item | Acceptance | Effort |
|---|---|---|---|
| NYV-NS-007 | Re-promote real architecture diagrams from `NYV-ARCHITECTURE-v6.md` into `NYV-ARCHITECTURE-312.md` and merge the two files (currently forked) | Single architecture doc exists; `INDEX.md` reflects the merge | 0.5d |
| NYV-NS-008 | Per-route OpenAPI spec generation from zod schemas (`zod-to-openapi`) — auto-publishes `/api/nv/openapi.json` | `curl /api/nv/openapi.json` returns a valid OpenAPI 3.1 doc covering ≥ 80% of routes | 1.5d |
| NYV-NS-009 | Split `src/services/nv-orchestration-services.ts` (114 errors, > 2k lines) into `src/services/orchestration/{run,inspect,plan,replay}.ts` per the file-length rule in §6.2 | One file per responsibility; no file > 500 LOC | 1d |
| NYV-NS-010 | Audit log hash-chain self-test on boot (verify last 100 entries) | Boot validator surfaces tampering within 1 second | 0.5d |
| NYV-NS-011 | Add `pre-commit` hook running `lint:naming` + `tsc --noEmit` (warning) on staged files only | Husky hook installed; runs in < 5s on a typical 3-file change | 0.5d |
| NYV-NS-012 | Standardise legal-statute response envelope: `{ statute, citation, jurisdiction, version, retrieved_at, confidence }` across all 7 jurisdiction agent factories | One envelope type in `packages/types`; every agent returns it | 1d |

### P2 — post-GA, queue for v3.2

| Code | Item | Notes |
|---|---|---|
| NYV-NS-013 | Memory profiling + heap-snapshot endpoint on `/api/nv/admin/heap` (gated behind super_admin) | Helps diagnose long-running gateway leaks |
| NYV-NS-014 | Automated SDK package publish pipeline (npm) — currently manual | Tied to next-major SDK bump (v6.0.0), so blocked until then per Project-Tracker §1 |
| NYV-NS-015 | Move `src/packages/` (in-tree security/protocols) into `packages/` workspace | Keeps "things SDK consumers can use" co-located |
| NYV-NS-016 | Replace per-jurisdiction agent factories with a single config-driven factory + per-jur YAML manifest | Reduces duplication across 7 files |
| NYV-NS-017 | Vector store eviction policy on `knowledge_chunks` for stale corpora | Cost control once usage grows |
| NYV-NS-018 | Promote Console (`client/`) to its own pnpm workspace package | Cleaner separation, independent CI |

### Low-hanging fruit (any developer, < 2h each)

- Replace remaining `console.log` calls in `src/` with `createLogger()` (≈ 40 sites)
- Add `"sideEffects": false` to each `packages/*/package.json` for tree-shaking
- Drop `lm-cache-backend.ts` TTL from 5min → 60min on idempotent reads
- Add `helmet`'s `crossOriginResourcePolicy: { policy: 'cross-origin' }` for SDK consumers behind different origins
- Index `sdk_app_api_keys.key_hash` (currently full-table scan on every SDK request)
- Convert `src/services/job-queue.ts` (legacy) callers to BullMQ then delete the file

---

## 15. Document maintenance

This file is the **canonical developer onramp**. When any of the
following changes, this file must be updated in the same commit:

- A new top-level directory under `src/`
- A new SDK package under `packages/`
- A new schema file under `shared/`
- A change to the boot sequence in §5
- A change to a "hot zone" in §11.1
- A new failure-mode policy in §11.4

Anything else (a new route, a new service file, a bug fix) does **not**
require updating this doc — it's covered by the catalogue rules in §4.

---

**End of NYV Master Technical Specification.**
For day-to-day questions, see `Project-Tracker.md` first.
For SDK consumer questions, see `NYV-SDK-v5-INTEGRATION-GUIDE.md`.
For the full doc index, see `docs/v3.1.2/INDEX.md`.
