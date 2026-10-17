# Jurexio Platform

Jurexio is a Standalone Legal AI SDK powering five legal products across six jurisdictions, utilizing a two-tier AI architecture with jurisdiction-specific Small Legal Models (SLMs) orchestrated by the Nyayasiddhi Legal Reasoning Model (NS LRM).

## ⚠ MANDATORY SESSION-START PROTOCOL (read first, every session)

**Orchestration map (agentic request path):** [`docs/orchestration-map.md`](docs/orchestration-map.md) — Queen pipeline, capability manifest, patterns, multitenant storage.

**Before any plan, code change, project task, or "is feature X wired?" verdict, you MUST:**

1. Read **`guardrails.md`** in full — the permanent session contract (mandatory pre-session reads, triple-pass audit checklist, per-family rules, all 13 NV-* CI-enforced guardrails).
2. Read **`FEATURES-REGISTRY.md`** in full — the master named-feature list with status (the single source of truth for what's built/wired/live; corrects the shallow-audit failure mode that produced false "missing" verdicts in Session-15).
3. Run **`npm run session:preflight`** (or `bash scripts/jrx-session-preflight.sh`) — prints a consolidated brief: file-presence check on the 7 mandatory docs, headline numbers (routes / pages / DB tables / agents / providers / models), wiring audit summary, recent CHANGELOG, gateway/console workflow tails, all 13 NV-* guardrail names.
4. Triple-pass audit (per `guardrails.md` § 2) — source tree (15 subtrees) + DB/config/registries + wiring/docs — BEFORE any "missing/not-wired" verdict.

This protocol is non-negotiable. Skipping it is treated as a code-review-blocking defect equivalent to violating any NV-* guardrail. The Session-15 lesson: shallow audits produce false negatives that waste cycles and erode trust.

---

## User preferences (set 2026-05-10 — applies until 2026-06-30)

**Until 2026-06-30, the entire focus is development + UAT testing on Replit dev
plus the EC2 dev-tier (`api.jurexio.com`) used as a partner integration
sandbox.** Production planning is a separate, detailed phase that begins AFTER
2026-06-30 — not before.

Concrete rules every agent (main + task agents + helpers) must follow:

1. **No production push pressure.** Never propose, schedule, or execute a
   production cutover during this window. EC2 redeploys to
   `api.jurexio.com` are explicitly dev-tier, not production.
2. **No premature restrictions.** Do NOT flip safety knobs to fail-CLOSED,
   tighten session lifetimes (24h/90d → 4h/30d), tighten SDK key scopes,
   or add new gating before the underlying feature is fully built, fully
   wired into the safety ring, and end-to-end tested from at least one
   downstream Nyayasiddhi platform key.
3. **Wiring without E2E proof does not count as done.** Every newly-wired
   service or `/api/nv5/*` mount must have a reproducible end-to-end smoke
   driven from at least one ecosystem platform (NSP, NSPM, NSI, NSA, NSM,
   NYM, JRX) before the task is considered complete.
4. **Core agenda: full ecosystem AI support.** The seven downstream
   Nyayasiddhi platforms must be able to drive every newly-wired AI flow
   end-to-end. Gaps surfaced by E2E testing are top-priority fixes.
5. **Defer-list (revisit AFTER 2026-06-30 in a dedicated production-planning
   task):** cost-optimizer fail-CLOSED flip, session-lifetime tightening,
   SDK key scope drift remediation, 1 GB upload streaming refactor,
   any other change that fails-closed dev/UAT clients before features
   are fully built.
6. **Communication discipline.** Do not push the user toward production,
   do not add gates "for safety" without explicit user approval, and
   always ask before adding any new restriction that would fail-closed
   an existing dev/UAT flow.

> **One folder to follow → `Jurexio-Platform-SDK/docs/canonical/`. Start with `00-README.md` (the index).** Everything else is archive or long-form reference.

## ⚠️ MANDATORY pre-task ritual (added 2026-04-29 — R-SCHEMA-B)

## Run & Operate

- **Gateway (dev)**: `bash scripts/jrx-start-dev.sh` (tsx, port 5000)
- **Console UI (dev)**: `bash scripts/jrx-start-console.sh` (Vite, port 3004)
- **Required env**: `JRX_DATABASE_URL`, `JRX_REDIS_TCP_URL` (canonical), `JRX_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}`, `NV_PII_ENCRYPTION_KEY` (64-hex)
- **EC2 redeploy**: `bash scripts/deploy-replit-ssm.sh` — see `docs/canonical/09-uat-and-compliance-2026-05-08.md` Appendix D for the per-deploy network-bridge gotcha

## Stack

Node.js 22 · Express 5 · React 19 · Vite · PostgreSQL 16.6 (RDS / Neon) · Drizzle ORM · Redis 7.1 (ElastiCache) · Zod · OpenAI · Anthropic · Google · Groq · OpenRouter · Sarvam · Bedrock

## Where things live

| Concern | Path |
|---|---|
| API entry | `src/index.ts` |
| DB schema | `src/db/schema.ts` (Drizzle, tables prefixed `nv_`) |
| Agent registries | `Jurexio-Legal-registry-{IN,UK,US,GC,EU,SG,Default}.json` |
| Master config | `src/config/jrx-master-config.ts` |
| **Canonical doc index** | `docs/canonical/00-README.md` |
| **API + route table** | `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` |
| **EC2 + integration status** | `docs/canonical/EC2-INTEGRATION-STATUS.md` |
| **Tracker + changelog** | `docs/canonical/10-tracker-changelog-2026-05-07.md` |
| **UAT evidence** | `docs/canonical/09-uat-and-compliance-2026-05-08.md` |

## Architecture decisions

- **Two-tier AI**: jurisdiction-specific SLMs orchestrated by NS LRM with PII-redacted LLM fallback.
- **Microservices-oriented**: decoupled services for scale.
- **Agent registry**: 1,042 Legal AI Agents (`v5-governed-execution-network-nyayasiddhi-comprehensive`).
- **22 agentic patterns** (ROMA L5).
- **Dual-schema DB**: `nv_schema.*` for governance/audit, `public.*` for application data.

## Product

| SKU | Audience |
|---|---|
| Nyayasiddhi Professional™ | Law firms |
| Jurexio Citizen | Citizens |
| Nyayasiddhi Institutional™ | Enterprise legal |
| Nyayasiddhi Ministry™ | Government |
| Nyayasiddhi Academy™ | Legal education |
| Central Console UI | Ecosystem control plane (RBAC, SDK keys, agents, governance) |

## User preferences

The user prefers clear, concise communication; iterative development with confirmation before major architectural changes; thorough documentation; and review of proposed solutions before implementation of new features or significant refactors.

## Hard architectural guardrails

**Non-negotiable. Violations fail architect review automatically.** Full text + history in `docs/canonical/00-README.md` § Guardrails.

- **NV-ARCH-001** — No-bypass safety ring. Every LLM-emitting request must traverse: tenant isolation → guardrails → Queen orchestration / `callJurexio` → agent allocation → 22-section Parlant prompt → 5-tier memory + multi-tier RAG + GraphRAG → CoT/ReAct/ToT → `intelligent-router/orchestrateLLM` → response engineering → hallucination + citation + safety + HITL gate → audit hash chain → streaming. **No direct LLM calls. Ever.**
- **NV-LLM-001** — Single-router rule (CI-enforced). `realLLMService.executeRequest|new RealLLMService(` may resolve only to the 7 whitelisted files in `docs/canonical/00-README.md` § NV-LLM-001 whitelist. Inside `realLLMService.executeRequest`, the LAST step must be `return orchestrateLLM(req)`.
- **NV-NAMING-001** — Before creating any new file under `src/{services,orchestration,routes,middleware,config}/`: `rg -l '<concept>' src/` first; edit existing if found; new files prefix `jrx-`; verify scope (platform vs downstream client).
- **NV-WIRING-001** — A service is NOT complete until imported by `src/routes/`, `src/index.ts`, `jrx-queen-orchestrator.ts`, `jrx-client.ts`, or another wired service. "Built and exported" ≠ live.
- **NV-DOC-001** — Active markdown restricted to `replit.md` + `README.md` + `docs/canonical/{01..15}-*.md`. All other docs go to `archive/`. No new top-level audit/status/session docs — append to canonical or audit appendix.
- **NV-SECRETS-001** — One canonical name per secret. Redis TCP write = `JRX_REDIS_TCP_URL`; Redis TCP read = `JRX_REDIS_READ_URL`. All consumers go through `resolveRedisTcpUrl()` / `resolveRedisReadUrl()` in `src/utils/redis-tcp-url.ts`. Full whitelist + legacy aliases in `docs/canonical/00-README.md` § NV-SECRETS-001.
- **NV-CONTRACT-001** (2026-05-09) — Method/route/schema/env/vendor/network names require pre-flight grep before adding/renaming/calling. No `(svc as any).method` shortcuts. Vendor 404 = probe vendor base URL with `curl`, fix wrapper, comment with date. Single API+schema map kept in sync in docs `04-` (routes) + `02-` (schema). Trigger cases: `validatePrompt` vs `validateSystemPrompt`, Sarvam `text/input`, memory `value/content`, Sarvam `script/script_code`, `nayayavigya` typo.
- **NV-OWNERSHIP-001** (2026-05-09) — Every test failure must be reproduced with `curl`/`psql`/`redis-cli`, traced to ONE owning component, fixed in the layer we own (vendor wrappers count as ours), documented + regression-tested. "Upstream/out-of-session" are not acceptable terminations.
- **NV-AUTH-HEADER-001** (2026-05-10, CI-enforced) — One canonical SDK auth header: `X-API-Key` (with `Authorization: Bearer <key>` fallback). Every middleware/route that authenticates an external SDK caller MUST import `extractSdkApiKey` from `src/middleware/jrx-sdk-auth-header.ts`. Inventing new accepted headers (`X-NV-SDK-Key`, `X-SDK-Key`, `X-JRX-Key`, `X-Platform-Key`) or rolling a local `function extractApiKey()` outside the canonical file fails `bash scripts/jrx-check-auth-header-discipline.sh`. The east-west header `X-NV-API-Key` is reserved exclusively for `src/middleware/jrx-inter-service-auth.ts`. Run: `npm run guardrail:auth-header`.
- **NV-DB-SCRIPT-001** (2026-05-10, CI-enforced) — Standalone scripts under `scripts/` MUST use `makePgSql()` from `scripts/_pg-pool.ts` (real `pg.Pool` with SSL + connection pooling). The `@neondatabase/serverless` HTTP driver SILENTLY DROPS WRITES on the helium dev DB and on RDS, returning `rowCount=0` even when the row exists. This bit Session-7 unified-keys for ~30 minutes before being root-caused. Whitelisted runtime files are driver-aware (pick `pg` vs neon-serverless by hostname `*.neon.tech`). Run: `npm run guardrail:script-db`.
- **NV-API-CONTRACT-001** (2026-05-10, CI-enforced) — The published HTTP API surface is **frozen** by the OpenAPI snapshot at `docs/openapi/jurexio-v5.openapi.json` (1,206 operations across 84 mounts, regenerated by `scripts/generate-openapi-spec.ts` — a static walker, no runtime side effects). `scripts/jrx-check-api-contract.sh` regenerates the live snapshot and diffs against the committed baseline: **additions are allowed** (backward compatible), **removals or method changes fail CI** (would break SDK clients pinned to v5.0.0). To intentionally remove a route past sunset, regenerate the baseline AND ship a CHANGELOG entry referencing the version bump in the same PR. Combined with the `apiVersion` middleware (mounted globally on `/api/nv/*` since 2026-05-10 Phase 0 — defaults to `v1`, honors `X-API-Version` header) and `deprecationWarning` factory in `src/middleware/jrx-api-versioning.ts`, plus the `API_VERSIONS` matrix in `src/config/api-versions.ts` (v5.0.0 current, v3.1/v3.0 supported, v2 deprecated → 2026-06-01 sunset). **Per user policy 2026-05-10: no major version bumps until first production deploy** — new features ship as additive routes (e.g. `/api/nv/v6/...`) under the same package version `5.0.1`. Run: `npm run guardrail:api-contract`.
- **NV-WIRING-BUDGET-001** (2026-05-10) — Programmatic auditor `scripts/jrx-wiring-audit.ts` BFS-classifies every TS file in `src/{packages,services,orchestration,middleware,integrations}` as WIRED / USED-INTERNAL / ORPHAN by reachability from `src/index.ts`. **Current snapshot: 309 wired / 79 used-internal / 24 raw orphan / 0 effective orphan**. Budget at `docs/audit/jrx-orphan-budget.json = 1`; CI fails if effective orphans grow. Per-orphan disposition matrix at `docs/audit/jrx-orphan-disposition.md`. Allowlist at `docs/audit/jrx-orphan-allowlist.json` (24 intentional: 15 KEEP-BARREL + 3 KEEP-CLI + 3 KEEP-CONTRACT + 3 KEEP-DYNAMIC-IMPORT). Run: `npm run guardrail:no-new-orphans` and `npm run audit:wiring`. **Full Session-9/10/11 history (wire-chain composition, maker-checker injection, doc-ai disk-spill refactor, 13-orphan sweep) → `docs/canonical/00-README.md` § "Gotchas archive — NV-WIRING-BUDGET-001 history".**
- **NV-DOC-ACCESS-DEV** — `JRX_DOC_ACCESS_MODE=permissive` (dev default) logs+allows; `strict` (prod default) enforces full Session-7 share-grant.
- **NV-NEVER-BREAK-001** (2026-05-11, CI-enforced) — User mandate Session-15 v3: every feature shipped from now on is locked by a static regression assertion in `scripts/jrx-check-shipped-features.sh` (run: `npm run guardrail:never-break`, included in combined `npm run guardrail` chain). The script asserts presence of every shipped file PLUS the wiring patterns that make it work end-to-end (route handler → router mount → middleware registration → frontend call). Adding a new feature? Append a `sec`/`require_*` block to the script — never remove an existing one. Session-15 v3 locked: (A) Postman generator `scripts/jrx-build-postman-collection.ts` + OpenAPI snapshot, (B) ecosystem smoke `scripts/jrx-smoke-bash.sh` honors `PLATFORMS_FILTER`, (C) Audit-Chain UI `client/src/pages/hash-chain-audit.tsx` ↔ `jrx-completions-routes.ts` `/lineage/{audit,export}`, (D) Live Activity Feed `src/services/jrx-activity-event-bus.ts` + `src/middleware/jrx-activity-publisher.ts` + `src/routes/jrx-activity-stream-routes.ts` + `client/src/pages/live-activity-feed.tsx` (real EventSource consumer, not the PhaseC stub), (E) SDK Key revocation `client/src/pages/sdk-key-management.tsx` ↔ `jrx-sdk-keylife-routes.ts` `/revoke/:keyId` & `/revoke-all`. PLUS the unified-SDK assertion: no per-platform route mount under `/api/(jrx-)?(nsp|nspm|nym|nsi|nsa|nsm|jrx)` is allowed.
- **NV-SDK-UNIFIED-001** (2026-05-11) — User mandate Session-15 v3: there is **ONE** Jurexio SDK + API surface for every ecosystem platform (NSP-Web, NSP-Mobile, NYM, NSI, NSA, NSM, JRX). Differentiation is by **SDK key + rate-limit tier** stored in `sdk_app_api_keys.scopes` / `rate_tier`, never by URL prefix. Postman collection, smoke harness, frontend SDK clients all use the same `/api/nv/*` + `/api/nv5/*` endpoints. Per-platform route mounts (`/api/nv/nsp/...` etc.) are blocked by the NV-NEVER-BREAK-001 grep. Initial scope = NSP-Web + NSP-Mobile + NYM (use `npm run smoke:nsp-nspm-nym` for the targeted smoke). **Per user clarification 2026-05-11 (Session-15 v6)**: NSP Web, NSP Mobile, NYM Mobile are SEPARATE PRODUCT projects. The Jurexio platform's responsibility is to make the Jurexio API + Jurexio SDK (consumed via API keys) bulletproof across every AI task — those product apps are downstream consumers and out of scope for this repo. Cross-platform "tested" = the SDK + API exercises every documented AI flow under each SDK key's scope, not "we tested the NSP Web product".
- **NV-TRACKER-FRESH-001** (2026-05-11, CI-enforced, Session-15 v6) — User mandate: "never stop managing trackers and guardrails". Every session that touches any of `src/`, `client/src/`, `drizzle/`, `examples/`, `scripts/`, `packages/` MUST append a `## Session-NN (YYYY-MM-DD) — <title>` block to the canonical session tracker `docs/canonical/10-tracker-changelog-2026-05-07.md` BEFORE merge. Sub-sections: Goal / Outcome / Files / Guardrails / Smoke / Followups / Commit. The guardrail compares the latest source-touching git commit timestamp against the tracker file's last commit timestamp; if source is newer, fails CI with a list of source commits the tracker is missing. Doc-only edits can override with `JRX_TRACKER_FRESH_TOLERATE=1` (NEVER use this for code shipping). This guardrail was created because Sessions 15 v1-v5 (the entire 24h of work that triggered it) all skipped the tracker silently. Run: `npm run guardrail:tracker-fresh`. Wired into the combined `npm run guardrail` chain.
- **NV-STUDY-FIRST-001** (2026-05-11, doctrine, Session-15 v6) — User mandate: "always study what is already there and the flows" before any change. Every BUILD-mode task starts with: (1) read the relevant canonical doc(s) under `docs/canonical/` AND any matching audit doc under `docs/audit/`, (2) live-probe the affected endpoint(s) with `curl`, (3) grep the existing source for the concept (NV-NAMING-001), (4) read the existing service/page in full, (5) THEN edit. Skipping any of (1)-(4) is the failure mode that produced Sessions 15 v1-v4 rework (cost-optimizer wired against a route I had not probed; bulk-doc-upload built before checking if doc-ai had its own jobs page; integration guides written before reading the existing client SDK README). Not auto-enforceable by a script; enforced by code-review check that the architect verifies "did the agent show evidence of study before code?".
- **NV-WARN-NEW-TASKS-001** (2026-05-11, doctrine, Session-15 v6) — User mandate: "warn me if new tasks given without you completing the old unless it is bugs and need immediate sorting". When the user's message introduces a new task while a numbered phase from the active plan (`docs/audit/feature-matrix-and-status-2026-05-11.md` §7 or any `.local/session_plan.md`) is still open, the agent MUST: (1) acknowledge the active backlog item that is about to be skipped, (2) state explicitly whether the new task is a bug (immediate handle) or a new feature (warn + ask), (3) only proceed if the user confirms the reordering OR if the new task is a bug. Bugs = anything broken in production, security issue, data corruption, blocking guardrail failure. Everything else is a feature and triggers the warn. This guardrail's purpose is to prevent silent backlog drift — every session should close MORE backlog than it adds.

## Current operational truth (2026-05-09)

- **Replit dev** (this workspace): gateway on port 5000 (Upstash Redis); 40/40 real-legaltech UAT PASS with strict verifier. See `docs/canonical/09-uat-…` Appendix E.7/E.8.
- **EC2 prod-dev** `i-0df71e5ea1df8f588`: live behind `console.jurexio.com` + `api.jurexio.com` + `nym.jurexio.com`. Image at `:proxyfix-20260507T042014Z`. ElastiCache `jrx-dev-edge-redis`. **Behind on code** (missing routes that exist on Replit dev — see `docs/canonical/EC2-INTEGRATION-STATUS.md`). N4 redeploy + N7 RDS schema-sync staged but NOT executed (require explicit user GO).
- **Six active LLM providers**: anthropic, openai, google, openrouter, sarvam, bedrock. Activate a 7th via the recipe in `docs/canonical/00-README.md` § Provider lockdown.
- **DNS reality**: Only `jurexio.com`, `www.`, `api.`, `console.`, `nym.` resolve. `gateway.`, `nsp.`, `nsi.`, `nsa.`, `nsm.`, `jrx.`, `nspm.` subdomains **do not exist**. Downstream platforms are reached via console proxy or share the gateway directly.

## Gotchas — quick reference

(Long-form historical detail moved to `docs/canonical/00-README.md` § Gotchas Archive.)

- **DEMO PASSWORD PIN (task-145, 2026-05-11)** — Demo console/SDK password is `NVDemo@2026!` for the 9 demo accounts (`admin@jurexio.com`, `superadmin|admin|sme@demo.jurexio.com`, `dev|analyst|operator|manager|user@demo.jurexio.com`). **Do not rotate** until end-to-end demo testing is signed off (owner: <user>; sunset: TBC). Rotation script: `scripts/jrx-rotate-demo-password.ts` (uses `makePgSql()` per NV-DB-SCRIPT-001). Login proof + full account list in `docs/canonical/EC2-INTEGRATION-STATUS.md` § Session-15.
- **Demo SDK-key bundle (NV-SDK-DEMO-BUNDLE-001, task-150, 2026-05-11)** — refresh all 7 demo SDK keys (NSP/NYM/NSI/NSA/NSM/NSPM/JRX) with one command: `npm run seed:sdk-bundle` (= `npx tsx scripts/jrx-refresh-demo-sdk-bundle.ts`). Mints fresh raw keys, upserts `public.sdk_app_api_keys` with scopes covering all 7 documented `/api/nv/gateway/*` read endpoints (info/health/agents/practice-areas/usage/cache/stats/guardrails/stats — `usage:read` is the gating scope on the last 3), deactivates prior active keys for the same app (rotation, never delete), and writes one canonical handout to `.local/run/sdk-bundle-demo-<env>-<ts>.{json,txt}` mode 0600. Closes Session-15 § C where the 2026-05-01 NSP Practice-app key (3 scopes) 403'd on the last 3 endpoints. The legacy `/opt/Jurexio/secrets/sdk-keys-2026-05-02.txt` lists prefixes (`…3fa6`, `…b747`) that were never seeded on RDS — treat as ARCHIVED. EC2: `docker exec jrx-gateway sh -c 'cd /app && JRX_PLATFORM_ENV=production npx tsx /app/scripts/jrx-refresh-demo-sdk-bundle.ts'`, then push to SSM/`.env.production`. Full runbook in `docs/canonical/EC2-INTEGRATION-STATUS.md` § Session-16.
- **Canonical SDK auth header** — `X-API-Key` only, with `Authorization: Bearer <key>` fallback. Use `extractSdkApiKey` from `src/middleware/jrx-sdk-auth-header.ts`. East-west traffic uses a separate `X-NV-API-Key` (inter-service-auth only). NV-AUTH-HEADER-001 enforces this.
- **Refresh-token rotation (NV-AUTH-FIX-2026-05-10)** — `rotateRefreshToken` in `src/middleware/jrx-auth.ts` had two latent bugs that 401'd every legit refresh: (1) `stored.user_id !== userId` was strict-eq between pg-number `1` and JSON-string `"1"` — fix: `String(...) !== String(...)`; (2) `SELECT … FROM users` referenced a non-existent table — fix: `FROM nv_users` with `org_id AS organization_id` (canonical column is `org_id`, not `organization_id`). Verified end-to-end with the 8-step NS-3 curl harness on Replit dev (8/8 PASS).
- **Session lifetimes (NV-AUTH-LIFETIME-2026-05-10)** — `SECURITY_CONFIG.session.jwtExpiryHours = 24` (was 4) and `refreshTokenExpiryDays = 90` (was 30) for dev/UAT. `expiresIn` in auth routes now derives from config (no more hard-coded 14400). Tighten back to 4h/30d before broader prod rollout.
- **Neon HTTP write bug on helium / RDS** — `@neondatabase/serverless` HTTP driver returns `rowCount=0` on UPDATE/INSERT against non-Neon hosts even when the row exists. Standalone scripts must use `makePgSql()` from `scripts/_pg-pool.ts`. Runtime is already driver-aware. NV-DB-SCRIPT-001 enforces this.
- **No duplicate files** — update/merge, don't create new.
- **Audit-chain repair** — `JRX_AUDIT_CHAIN_TOLERATE=1` → `psql` repair → revert.
- **SSM shell** — uses `/bin/sh`; bash scripts need explicit `bash` invocation.
- **Drizzle Postgres booleans** — `BOOLEAN` from `@neondatabase/serverless` may need `::int` cast + `=== 1` check.
- **SDK key scopes** — source of truth is `sdk_app_api_keys.scopes` in DB, NOT `src/config/jrx-sdk-variants.ts`.
- **1 GB uploads** — currently serial-only (Multer buffers to RAM).
- **Console scope discipline** — central Console is for ecosystem/AI-ops/governance/SDK only; productivity pages belong in downstream clients.
- **Per-deploy network bridge** — every `docker compose up` from a per-deploy dir creates a NEW project-scoped network; legacy `jrx-console` (nginx) lives on `nayayavigya-platform-312_jrx-net`. Persistence: systemd unit `jrx-gateway-bridge.service` at `/etc/systemd/system/`. Re-installer: `sudo bash /opt/nyayavigya/scripts/jrx-bridge-systemd-install.sh`. Full timeline in canonical doc 09 Appendix D.
- **Canonical agent endpoint** — `/api/nv/gateway/agents` (not `/agents/list`). Auth: any valid SDK key.
- **Canonical V9 orchestrator** (JRX-DEAD-STUB-CLEANUP-2026-05-10) — The real V9 unified orchestration is `src/orchestration/jurexio-orchestration-core-v9.ts` (592 lines, "Stub mode removed", consumed by 9 files including `jrx-orchestration-engine.ts`, `jrx-sdk-auto-initialization.ts`, `context-engineering-service.ts`, `jrx-runtime-agent-factory.ts`). The similarly-named 21-line stub `jurexio-unified-orchestrator-v9.ts` was archived to `archive/2026-05-10-dead-stubs/` along with two other zero-consumer stubs (`unified-multimodal-orchestrator.ts` 12 lines, `jrx-voice-service-contract.ts` 112 lines) that risked being mistaken for real components and bypassing the safety ring. Real multimodal pipeline lives at `src/routes/jrx-sdk-multimodal-voice-routes.ts` (12 endpoints, mounted `/api/nv/sdk/multimodal/*`); real voice pipeline at `src/routes/jrx-voice-ws-routes.ts` (Deepgram + Sarvam 22-Indic + Whisper, ws at `/api/nv/voice/stream`).
- **Provider lockdown 2026-05-07** — see `docs/canonical/00-README.md` § Provider lockdown for the activation recipe (env-var → `is_active` → re-seed).
- **Dev demo creds + org-pinned test users (task-140, 2026-05-11)** — All 6 demo accounts in `nv_users` share a single dev/UAT password held only in the Replit Secret `NV_DEMO_PASSWORD` (operator-managed; never hard-code into seeds, tests, docs, or `.replit` per JRX-NS-003 — fetch the value from the Secrets UI or 1Password). Org-pinning on Replit dev DB only: `dev@demo.jurexio.com` → org_id `2` (Demo Law Firm, pro), `analyst@demo.jurexio.com` → org_id `3` (Demo Legal Department, plus), `manager@demo.jurexio.com` → org_id `4` (Demo Bar Association, enterprise). `admin@jurexio.com` stays cross-org `super_admin` with `org_id = NULL`; `operator@` and `user@` also remain NULL (single-tenant smoke). Verified via `POST /api/nv/auth/login` (6/6 HTTP 200 + JWT) and `GET /api/nv/auth/me` (org_id 2/3/4 echoed back). **MUST be rotated and unpinned before any prod cutover** — this is a dev/UAT convenience, not a prod posture.

## Pointers

OpenTelemetry · Zod · Drizzle ORM · ReAct/CoT/GraphRAG/Digital Twin/RRF fusion reranking · OpenAI / Anthropic / Google / Groq / OpenRouter / Perplexity / Sarvam / Bedrock.
