# Nyayavigya Canonical Docs — START HERE

> **This is the ONLY folder to follow.** Everything else under `docs/v5.0.0/`, `docs/v3.1.2/`, `docstotrack/`, `archive/` is reference, history or superseded.
> Per `replit.md` NV-DOC-001, active markdown is restricted to `replit.md` + `README.md` + `docs/canonical/{01..NN}-*.md` + the support files in this folder. The active set as of Session-12 is `01..11` (canonical doc 11 added 2026-05-10 — per-batch agentic-architecture trace).

Last verified: **2026-05-10** (Session-12 doc refresh — Batch A–J product / SDK / agentic architecture sections added; see doc 01 § 11–12, doc 04 §§ 11–17, new doc 11).

---

## The 11-doc index (current state)

| # | Subject | File | Status | Last reviewed |
|---|---|---|---|---|
| **00a** | **Agent operating map — hosts, DBs, ports, paths, verification discipline, baselines.** Read BEFORE probing anything live: NYS is part of NYV on its own EC2 box (systemd, :8080, `/api/` prefix) and there are TWO databases (`nyv-dev-edge-pg` via env vs `nyv-caselaw-pg` via Secrets Manager). | `AGENT-OPERATING-MAP-2026-08-18.md` | **LIVE — 2026-08-18** | 2026-08-18 |
| **00b** | **NYS caselaw corpus + embedding map** — measured per-court coverage (SC **100%** done 1950-2026; HC 2025/2026 **0%**), S3 source buckets + Parquet layout, Athena, the `ORDER BY id` oldest-first cause, shard-2 half-open-socket RCA, and the optimisation plan. | `NYS-CORPUS-AND-EMBEDDING-MAP-2026-08-18.md` | **LIVE — 2026-08-18** | 2026-08-18 |
| **00c** | **NYS embedding + Gemini plan** — corrected coverage (**69.4%**, the 5.56% gauge is BROKEN), the one-index/one-vector-space constraint that forbids mixing Titan+Gemini in `embedding`, what already exists (cascade, multi-key rotation, configurable dims), and a 4-phase plan with a pilot gate. | `NYS-EMBED-GEMINI-PLAN-2026-08-18.md` | **LIVE — 2026-08-18** | 2026-08-18 |
| **00d** | **Phase 3 Gemini rollout plan (measured)** — answers "do more Bedrock keys help?" (**no** — instance role, account-scoped quota), corrects **Gemini is 1.8x FASTER than Titan** (570ms vs 1018ms p50) and that the real bottleneck was the **per-row UPDATE** (462ms/row at conc=8 vs 64ms at conc=20), with the `embedding_g` decision and a pilot gate. | `NYS-PHASE3-GEMINI-ROLLOUT-2026-08-18.md` | **LIVE — 2026-08-18** | 2026-08-18 |
| **00e** | **NYV pending status (re-verified against source)** — the 8 open items with evidence, corrected paths, and a 6-step order; records that the cost benchmark PREDATES the changes it was meant to measure. | `NYV-PENDING-STATUS-2026-08-18.md` | **LIVE — 2026-08-18** | 2026-08-18 |
| 01 | Product (business + technical update) | `01-product-comprehensive-2026-05-07.md` | LIVE | 2026-05-07 |
| 02 | Technical | **`02-technical-slim-2026-05-11.md`** (slim canonical, Session-15 v13) + `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` (1,211-line long-form companion) | LIVE | 2026-05-11 |
| 03 | Architecture | **`03-architecture-slim-2026-05-11.md`** (slim canonical, Session-15 v13) + `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md` (442-line 6-phase long-form) | LIVE | 2026-05-11 |
| 04 | SDK + API + Routes (the API+schema map) | `04-sdk-and-api-canonical-2026-05-07.md` + `04b-sdk-endpoint-probe-2026-05-07.md` + `04c-sdk-troubleshooting-2026-05-11.md` | SUPERSEDED by 13 | 2026-05-11 |
| 13 | SDK + API canonical (EC2-ready, integrator-facing) — superseded by 14 | `13-api-and-sdk-2026-05-13.md` | SUPERSEDED | 2026-05-13 |
| 14 | **Comprehensive API + SDK Integration Guide (final pre-publish)** — request/response payloads for every endpoint family, parsing rules, SSE format, OCR/CoT/agentic, per-platform code samples, error taxonomy, go/no-go checklist | `14-integration-guide-2026-05-13.md` | **LIVE — authoritative for ALL developers** | 2026-05-13 |
| 05 | LLM (routing + providers) | **`05-llm-dedicated-2026-05-11.md`** (dedicated, Session-15 v13) + `05-config-directories-2026-05-07.md` (env-var matrix companion) + `00-README.md § Provider lockdown` | LIVE | 2026-05-11 |
| 06 | AWS Deployment (3-env parity matrix) | `06-environment-parity-2026-05-07.md` + `EC2-INTEGRATION-STATUS.md` (live status) + `EC2-PUSH-RUNBOOK-2026-05-08.md` | LIVE | 2026-05-09 |
| 07 | Security + Compliance | **`07-security-dedicated-2026-05-11.md`** (dedicated, Session-15 v13) + `07-pre-deploy-plan-2026-05-07.md` (operational pre-deploy runbook) + canonical-09 §G hash-chain audit | LIVE | 2026-05-11 |
| 08 | Optimization | `08-optimization-pass-2026-05-08.md` | LIVE | 2026-05-08 |
| 09 | UAT + Compliance Evidence | `09-uat-and-compliance-2026-05-08.md` (537 lines, Appendix E.1–E.8) | **LIVE — 40/40 PASS** | 2026-05-09 |
| 10 | Tracker + Changelog | `10-tracker-changelog-2026-05-07.md` | LIVE | 2026-05-09 |
| 11 | Agentic architecture walkthrough (Batch A–J safety-ring traces) | `11-agentic-architecture-2026-05-10.md` | **LIVE — Session-12** | 2026-05-10 |
| 12 | Platform status & readiness (Console + rate-limit + doc-AI + readiness gates) | `12-platform-status-and-readiness-2026-05-11.md` | **LIVE — Session-15 v19** | 2026-05-11 |
| 13a | Production cutover plan (10-item pre-prod checklist with owners + ETAs) | `13-prod-cutover-plan-2026-05-12.md` | **LIVE — Session-15 v19, Task #155** | 2026-05-12 |
| 13b | SDK + API canonical (EC2-ready, integrator-facing) — superseded by 14 | `13-api-and-sdk-2026-05-13.md` | SUPERSEDED | 2026-05-13 |
| 13c | US compliance status crosscheck (HIPAA/CCPA/SOX/GLBA/FedRAMP/NIST/FTC/VCDPA/CPA/state-breach) | `13-us-compliance-status-2026-05-13.md` | **LIVE — Task #335** | 2026-05-13 |
| 14a | SME Legal Chat E2E tool (issuance, /sme shell, GRPO loop, runbook) | `14-sme-legal-chat-runbook-2026-05-12.md` | **LIVE — Task #156** | 2026-05-12 |
| 14b | **Comprehensive API + SDK Integration Guide (final pre-publish)** | `14-integration-guide-2026-05-13.md` | **LIVE — authoritative for ALL developers** | 2026-05-13 |
| 15  | **US Compliance Matrix (customer-facing)** — federal / state-privacy / breach / financial / civil / procedural / IP / ethics / security framework rows with citation, scope, enforcement surface, and evidence path. | `15-us-compliance-matrix-2026-05-14.md` | **LIVE — Task #396** | 2026-05-14 |
| 16  | **US Compliance Gap Analysis (engineering-internal)** — candidate framework list (GLBA/COPPA/FERPA/ITAR/EAR/CMMC/FedRAMP-High/StateRAMP/state privacy quintet/NIST CSF 2.0/PCI-DSS/HITRUST/IRS Pub 1075/CJIS/NYDFS-500) classified covered/partial/gap/out-of-scope with effort tier + SKU demand + top-5 prioritized shortlist. | `16-us-compliance-gap-analysis-2026-05-14.md` | **LIVE — Task #397** | 2026-05-14 |

**NSP team release package** — single entry-point at `docs/integration-guides/nsp-handoff-2026-05-12.md`. Per-platform integration guides (7): `nsp-web.md`, `nsp-mobile.md`, `nym.md`, `nsi.md`, `nsa.md`, `nsm.md`, `jrx.md`.

**Companion long-form (read-only references)** — see `docs/v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md` (880 lines), `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` (1211 lines), `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md`, `docs/v5.0.0/ELASTICACHE-CUTOVER-2026-05-07.md`.

---

## Where to look for X

| If you want… | Open this |
|---|---|
| Current platform status + DNS + EC2 health | `EC2-INTEGRATION-STATUS.md` (this folder) |
| Latest UAT evidence (40/40 pass) | `09-uat-and-compliance-2026-05-08.md` Appendix E.7/E.8 |
| API route catalogue + auth model + parsing rules | **`14-integration-guide-2026-05-13.md`** (canonical for ALL developers); `04-sdk-and-api-canonical-2026-05-07.md` (deeper per-batch nv5 surface) |
| SDK package layout + npm names | This file § SDK packages below |
| What's WIP / planned next | `10-tracker-changelog-2026-05-07.md` § 4–5 |
| Deploy/redeploy procedure | `EC2-PUSH-RUNBOOK-2026-05-08.md` + canonical-09 Appendix D |
| LLM routing + provider activation | This file § Provider lockdown |
| Guardrails (full text) | This file § Guardrails (below) |
| Per-batch product capability (Batch A–J `/api/nv5/*`) | `01-product-comprehensive-2026-05-07.md` § 11 |
| Per-batch endpoint tables + auth/scope/flag matrix | `04-sdk-and-api-canonical-2026-05-07.md` §§ 11–17 |
| Per-batch end-to-end safety-ring traces | `11-agentic-architecture-2026-05-10.md` |
| 1,042-agent registry summary (counts per jurisdiction) | `01-product-comprehensive-2026-05-07.md` § 12 |
| Canonical secret names + Redis | This file § NV-SECRETS-001 (below) + `replit.md` summary |

---

## SDK packages (npm)

| Package | Path | Purpose | Latest published tarball |
|---|---|---|---|
| `@nyayavigya/types` | `packages/types/` | TypeScript types shared by all SDKs | `sdk-dist/nyayavigya-types-3.1.2.tgz` (2026-04-23) |
| `@nyayavigya/client-sdk` | `packages/client-sdk/` | Universal browser/Node SDK | `sdk-dist/nyayavigya-client-sdk-3.1.2.tgz` (2026-04-23) |
| `@nyayavigya/react-hooks` | `packages/react-hooks/` | React hooks layer (`useNyayavigya`, `useAgent`, `useChat`, etc.) | `sdk-dist/nyayavigya-react-hooks-3.1.2.tgz` (2026-04-23) |
| `@nyayavigya/enterprise-sdk` | `packages/enterprise-sdk/` | Enterprise additions (audit, RBAC) | `sdk-dist/nyayavigya-enterprise-sdk-3.1.2.tgz` (2026-04-23) |
| `@nyayavigya/client-sdk-react-native` | `packages/client-sdk-react-native/` | React Native variant | source-only |
| `@nyayavigya/nyayamitra-sdk` | `packages/nyayamitra-sdk/` | Citizen-app SDK | source-only |

**STATUS** (2026-05-09): Source files current with v5.0.1 backend. **Published tarballs in `sdk-dist/` are STALE (v3.1.2, dated 2026-04-23)** and predate the N-track / strict-verifier work. Re-publishing is a one-shot `pnpm -r build && pnpm -r pack` plus tarball move; deferred to next session. Hooks docs live with each package's `README.md`; consolidated reference will be added to canonical doc 04 in the next pass.

---

## Guardrails (full text)

### NV-ARCH-001 — No-bypass safety ring
Every AI/SDK/API request that emits an LLM call MUST traverse, in order:
tenant isolation → guardrails → Queen orchestration (multi-agent) OR `callNyayavigya` (single-agent) → agent allocation (BM25 over 1042 agents × 6 jur × 22 patterns × 107 swarm topologies) → 22-section Parlant prompt → 5-tier memory + multi-tier RAG (statute/case/template/private) + GraphRAG → CoT/ReAct/ToT reasoning → **NV-ROUTER-001** (`intelligent-router/orchestrateLLM`) for cost-optimal LLM pick → response engineering → hallucination + citation + safety + HITL gate → audit hash chain → streaming.

### NV-LLM-001 whitelist
Repo-wide grep `realLLMService\.executeRequest|new RealLLMService\(` must resolve to ONLY:
- `src/services/nv-client.ts`
- `src/orchestration/nv-queen-orchestrator.ts`
- `src/orchestration/nv-sdk-orchestration-wrapper.ts`
- `src/services/real-llm-service.ts` (the facade itself)
- `src/services/intelligent-router/llm-orchestrator.ts`
- `src/services/chain-of-thought-service.ts` (CoT is a reasoning step inside the safety ring; re-wrapping causes infinite recursion)
- `src/services/llm-providers.ts` (low-level provider abstraction RealLLMService sits on top of)
- `src/utils/ai-orchestration-validator.ts` (self-validation; only string literals, not actual calls)

Inside `realLLMService.executeRequest` the LAST step MUST be `return orchestrateLLM(req)`. AgentZero (priority 99 always-on backup) auto-fires as the 7th cascade step inside `orchestrateLLM`.

### NV-NAMING-001 — File-creation guardrail
Before creating any new file under `src/{services,orchestration,routes,middleware,config}/`:
1. `rg -l '<concept-keyword>' src/` for both `nv-*` and unprefixed candidates.
2. If any file implements the same concept, EDIT it. Do NOT create a new one.
3. New file genuinely needed → prefix `nv-`, document rationale in commit message, ensure no overlap.
4. If you find an existing duplicate cluster, FLAG for consolidation; do NOT add a third.
5. Verify scope: platform's responsibility (orchestration, agents, LLM routing, audit, governance) vs downstream client's (case management, billing, e-filing UI).

### NV-WIRING-001 — Wired-or-not-done
A service is NOT complete until imported by `src/routes/`, `src/index.ts`, `nv-queen-orchestrator.ts`, `nv-client.ts`, or another already-wired service.

### NV-DOC-001 — 10 canonical docs only
Active markdown restricted to `replit.md` + `README.md` + `docs/canonical/{01..NN}-*.md` (Session-12 active set: `01..11`). All other docs to `archive/`. No new top-level audit/status/session docs.

### NV-SECRETS-001 — Single canonical name per secret
Every secret env-var has ONE canonical name; legacy aliases honoured for back-compat with one-shot DEPRECATED warning.

**Canonical names (locked 2026-05-07):**
- Redis TCP URL writes/primary → `NYV_REDIS_TCP_URL` (legacy: `NYV_REDIS_WRITE_URL`, `REDIS_URL`, `NYV_REDIS_URL`).
- Redis TCP URL reads/replica → `NYV_REDIS_READ_URL` (added 2026-05-07; falls back to primary when absent).

**Resolver whitelist** for `process.env.(NYV_)?REDIS_(TCP_|READ_|WRITE_)?URL`:
- `src/utils/redis-tcp-url.ts` (the resolver itself)
- `src/routes/nv-health-full-routes.ts`
- `src/middleware/nv-rate-limit-middleware.ts`
- `src/config/nv-service-urls.ts`
- `scripts/nv-start-dev.sh`
- `scripts/migrate-to-managed-datastores.sh`
- `scripts/one-click-deploy.sh`

### NV-CONTRACT-001 (2026-05-09) — Method/route/schema-name pre-flight
Before adding, renaming, or calling any of the following you MUST run a pre-flight grep AND record the answer in the commit message:
1. **Method on a service** — `rg -n 'class\s+<ServiceName>' src/` then `rg -n '\.<methodName>\b' src/`. No `(svc as any).method` shortcuts.
2. **HTTP route** — `rg -n "router\\.(get|post|put|patch|delete)\\(.*['\"]<path>" src/routes/`. Cross-check `04-sdk-and-api-…` route table; if adding new, append the row in the same commit.
3. **DB column / table** — `psql "$NYV_DATABASE_URL" -c "\d <table>"`. Drizzle: `rg -n "pgTable\\(['\"]<table>" src/db/schema.ts`. Naming: `nv_<domain>_<entity>` for governance, unprefixed snake_case for application tables.
4. **Env-var / secret name** — see NV-SECRETS-001.
5. **External-vendor endpoint** — never assume a 404 is "their bug". Probe with `curl` against vendor base; if path is gone, find new one, normalize the response shape inside the wrapper, comment with date + verification command. Canonical example: `src/services/sarvam-translation-service.ts:668-679` (`/detect-language` → `/text-lid`).
6. **Container/network/host name** — copy-paste from `docker network ls`; never hand-type. The 2026-05-09 `nayayavigya` typo class wasted hours.

### NV-OWNERSHIP-001 (2026-05-09) — End-to-end ownership of every test failure
1. **Reproduce** the failure with `curl`/`psql`/`redis-cli` against the live system.
2. **Trace** to a SINGLE owning component (route, service, DB query, LLM call, vendor wrapper). "Upstream vendor", "not our scope", "out-of-session" are NOT acceptable terminations.
3. **Fix in the layer we own** — even if the root cause is a vendor change, we own the wrapper. Sarvam `/text-lid` rename (2026-05-09) is the canonical example.
4. **Document + regression test** that would have caught the failure earlier.

Session does not close until every red is green OR has an explicit, time-boxed entry in the Tracker (doc 10) with an owner + date.

### NV-DOC-ACCESS-DEV
`NYV_DOC_ACCESS_MODE=permissive` (dev default) makes `nv-doc-access-guard` log + allow. `strict` (prod default) enforces full Session-7 share-grant.

---

## Provider lockdown (2026-05-07)

`src/config/nyv-allowed-providers.ts` defines 6 ACTIVE LLM providers: **anthropic, openai, google, openrouter, sarvam, bedrock**. The other 17 in `nv_llm_providers` are platform-supported but NOT routable.

**To activate a 7th provider:**
1. Add to `ALLOWED_PROVIDERS` + `PROVIDER_MODEL_CATALOG` in `src/config/nyv-allowed-providers.ts`.
2. Supply provider env-var key on Replit Secrets + EC2 `.env.production`.
3. `UPDATE nv_llm_providers SET is_active=true WHERE provider_id='<id>'`.
4. Re-run `npx tsx scripts/nv-seed-models.ts` to seed model rows.

`PROVIDER_MODEL_CATALOG` (code) and `nv_model_catalog` (DB, 93 latest models May-2026) are kept in sync via that one seed script — never edit DB rows directly. OpenRouter is mandatory (free-tier fallback + multi-provider routing). Bedrock uses `@aws-sdk/client-bedrock-runtime` via `src/services/intelligent-router/llm-orchestrator.ts`; needs `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` + `bedrock:InvokeModel` IAM perm.

---

## Gotchas archive (long-form historical context)

The full 2026-05-07 → 2026-05-09 incident timeline (EC2 clean-rebuild rollback, ElastiCache password drift, NYV-NS-022 Proxy fix, Upstash exhaustion + ElastiCache cutover, per-deploy network split, NV-HEALTH-002 not_configured state) used to live inline in `replit.md`. Trimmed there for readability — full text retained in `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md` and `09-uat-and-compliance-2026-05-08.md` Appendix D.

---

## Quick verification checklist (every PR)

```bash
# 1. Doc discipline
ls docs/canonical/ | grep -E '^(00|0[1-9]|10)-'
# 2. NV-LLM-001 single router
rg -n 'realLLMService\.executeRequest|new RealLLMService\(' src/ | wc -l   # expect 8 lines (whitelisted)
# 3. NV-SECRETS-001 Redis grep
rg -n 'process\.env\.(NYV_)?REDIS_(TCP_|READ_|WRITE_)?URL|process\.env\.NYV_REDIS_URL' src/ scripts/ | wc -l   # expect ≤ 7 (whitelisted)
# 4. UAT smoke
node scripts/nv-uat-curl-direct.mjs --files=tests/uat/scenarios/IN/legaltech-extras.json --concurrency=5
# 5. Verifier regression test
node scripts/nv-uat-verifier-regression-test.mjs
```

---

## Gotchas archive — NV-WIRING-BUDGET-001 history (Session-9/10/11, archived 2026-05-11)

Long-form historical context that lived in `replit.md` until Session-15 v17 trim. Active rule + budget remain in `replit.md`; this section is the audit trail.

### Session-11 snapshot (2026-05-10)
- 309 wired / 79 used-internal / 24 raw orphan / 0 effective orphan (out of 412 files).
- Budget tightened to 0 at end of Session-11; any new effective orphan now fails CI.

### Session-11 batches E–K — 26 WIRE-INTERNAL services + 12 LLM provider files
Wired via single side-effect-free static-import edge file `src/orchestration/nv-internal-wire-chain.ts`. Covered:
- Routing/cost: `cost-aware-router`, `llm-routing-engine`, `nv-routing-decision-engine`
- Orchestration internals: `mcp-server-engine`, `nv-context-engineering-service`, `nv-error-recovery-service`, `nv-event-replay-service`, `nv-jurisdiction-mapper`, `nv-prompt-cache`, `nv-prompt-engineering-pipeline`, `nv-readability-scorer-service`, `nv-real-time-collaboration-service`, `nv-self-improvement-orchestrator`, `nv-streaming-orchestrator`, `nv-translation-service`, `nv-validation-pipeline`
- Storage: `nv-vector-store`, `nv-graph-store`, `nv-multi-tier-cache`, `nv-llm-cache-key`
- Backups/services: `agentzero-adapter`, `azentzero-service`, `feature-flags-service`, `case-update-service`, `event-sourcing-adapter`, `escalation-service`
- Provider-registry as edge-holder for: openai, anthropic, cohere, groq, mistral, perplexity, replicate, xai, meta, deepseek, together-ai, openrouter, agentzero

### Session-11 maker-checker injection (queen orchestrator)
- Helper `maybeRunMakerCheckerLoop()` added to `src/orchestration/nv-queen-orchestrator.ts`.
- Flag-gated `NYV_F_GOV_MAKER_CHECKER` (default OFF, identity-fn when off → byte-for-byte v5 preserved).
- When ON: wraps `synthesizeWithLLM` in `MakerCheckerService.runLoop` with deterministic legal-quality checker scoring length/citation/jurisdiction-token. Fail-safe falls back to original synthesis.

### Session-11 doc-ai disk-spill refactor
- `src/routes/nv5/doc-ai/convert-routes.ts`: `multer.memoryStorage` → `multer.diskStorage` at `os.tmpdir()/nyv-doc-ai-uploads`.
- `uploadErrorHandler` middleware + tmp-file `finally` cleanup on every code path.
- Resolves the "1 GB uploads buffer to RAM" gotcha for this route.

### Phase-1 wire-chain (2026-05-10) — 7 previously-orphan middleware wired
- Always-on no-op: `orchestration-guardrails`
- Feature-flag gated (default OFF): `request-logger` (`NYV_F_CANONICAL_REQUEST_LOGGER`), `tracing` (`NYV_F_TRACING`), `ns-response-mapper` (`NYV_F_NS_RESPONSE_MAP`), in-mem platform-rate-limiter (`NYV_F_PLATFORM_RATE_LIMITER_INMEM`)
- Reachability imports: `credit-gate`, `inter-service-auth`

### Session-9 sweep (2026-05-10) — 13 orphans archived
Three buckets:
- **MERGE-DUPLICATE (4)** → `archive/2026-05-10-merge-duplicate/`: older variants of `queen-orchestrator`, `prompt-enhancement-pipeline`, `response-engineering-pipeline`, `nv-orchestration-core-v9`.
- **REVIEW-DELETE (4)** → `archive/2026-05-10-review-delete-video/`: video/voiceover utilities (user GO).
- **DEAD-STUBS (5)** → `archive/2026-05-10-dead-stubs/`: 1-30 LOC placeholder classes returning empty data — `context-engineering`, `llm-routing-engine`, `real-llm-service-v9`, `enterprise-platform/index`, `multi-org/index`.

### Slice-6 (2026-05-10) — allowlist + disposition matrix
- `docs/audit/nv-orphan-allowlist.json` lists 18 intentional orphans (KEEP-BARREL ×12, KEEP-CLI ×3, KEEP-CONTRACT ×3) with reasons; the budget guardrail subtracts allowlisted files from the count.
- Per-orphan disposition matrix at `docs/audit/nv-orphan-disposition.md` (heuristic-classified into WIRE-ROUTE / WIRE-CHAIN / WIRE-INTERNAL / MERGE-DUPLICATE / KEEP-BARREL / KEEP-CLI / KEEP-CONTRACT / REVIEW-DELETE / REVIEW-MANUAL — proposes, never deletes).
- Budget at `docs/audit/nv-orphan-budget.json = 62` (effective) enforced by `scripts/nv-check-no-new-orphans.sh` — fails if effective orphans grow. Subsequently tightened to 1 in Session-11.

### Deferred (still open)
- WIRE-INTERNAL ×45 — large 700-1300 LOC services to be wired per-family behind feature flags.
- REVIEW-MANUAL ×16 — need per-file judgment.
