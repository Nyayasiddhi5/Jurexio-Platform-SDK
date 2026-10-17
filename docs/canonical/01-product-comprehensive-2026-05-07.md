---
status: live
version: 5.0.2
audience: product owners, business owners, partner CXOs, sales engineers, architects, platform engineers, integrators, SREs
last_updated: 2026-05-10
supersedes: docs/v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md (consolidated, see §0c there), docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md (consolidated, see §0a + §0b there — full detail still lives in that file as appendix)
---

# 01 — Nyayavigya Platform Comprehensive Update — v5.0.2 (2026-05-10)

> **What changed (Session-12, 2026-05-10).** Added § 11 "Batch A–J product
> surface" enumerating each `/api/nv5/*` namespace with the user-facing
> capability, SKU mapping, and ecosystem-platform consumer; and § 12
> "1,042-agent registry catalog summary" with per-jurisdiction and
> per-pattern counts. Companion docs:
> `04-sdk-and-api-canonical-…` §§ 11–17 (endpoint tables, scopes, flags),
> `11-agentic-architecture-2026-05-10.md` (per-batch safety-ring traces).

> Single consolidated update note covering both **business** and
> **technical** dimensions, refreshed to reflect the actual production
> reality on 2026-05-10. The standalone v5.0.0 business + technical
> notes (`docs/v5.0.0/NYV-PRODUCT-NOTE-{BUSINESS,TECHNICAL}-v5.0.0.md`)
> remain valid as the long-form reference and now carry their own
> v5.0.2 delta blocks (Business §0c, Technical §0b). This canonical note
> captures the consolidated v5.0.1 → v5.0.2 hardening delta plus the
> 2026-05-10 production-publish outcome.

---

## 0a. What's new in v5.0.2 since v5.0.1 (consolidated delta — 2026-05-10)

| # | Surface | v5.0.1 state | v5.0.2 state |
|---|---|---|---|
| 1 | SDK auth header | Multiple historical headers honoured; each route did its own extractor | **NV-AUTH-HEADER-001 (CI-enforced)** — one header `X-API-Key` (Bearer fallback); single extractor `extractSdkApiKey` |
| 2 | Standalone-script DB driver | Some scripts used neon-HTTP against RDS → silent `rowCount=0` writes | **NV-DB-SCRIPT-001 (CI-enforced)** — `makePgSql()` from `scripts/_pg-pool.ts` mandatory |
| 3 | `rotateRefreshToken` | Two latent bugs 401'd every legit refresh | **NV-AUTH-FIX-2026-05-10** — `String()` user_id compare + `nv_users` table + `org_id AS organization_id`. Verified **NS-3 8/8 PASS** |
| 4 | Session lifetimes | 4h access / 30d refresh; `expiresIn` hard-coded | **NV-AUTH-LIFETIME-2026-05-10** — 24h / 90d (dev/UAT); `expiresIn` derived from `SECURITY_CONFIG`. Tighten before broader prod |
| 5 | Production publish | Staged | **LIVE** on `*.replit.app` (commit `c28813e`, 2026-05-10). EC2 prod LIVE. Replit dev GREEN. All three envs same code |
| 6 | Architectural guardrails | 7 hard guardrails | **+ NV-CONTRACT-001, NV-OWNERSHIP-001, NV-AUTH-HEADER-001, NV-DB-SCRIPT-001** (latter two CI-enforced) |

No new SKUs, jurisdictions, schema, or SDK package versions. v5.0.2 is
observability + correctness only.

---

## 0. Headline (one paragraph)

Nyayavigya is the agentic legal-AI operating system that powers the
Nyayasiddhi family of consumer products (NSP, NSPM, NSI, NSA, NSM, NYM,
JRX). v5.0.1 is a **hardening + parity** release: 70/70 functional PASS
on the deep AI-flow probe across all 7 SDK platforms × 10 core flows,
two real SQL regressions fixed, single-resolver Redis env-var contract
locked (NV-SECRETS-001), single Object-Storage interface across Replit
+ EC2, env parity verified between Replit dev / Replit publish / EC2
prod, and a stepped pre-deploy runbook awaiting your explicit GO. Both
production EC2 (api.nyayasiddhi.online) and Replit dev are GREEN. No
outstanding blockers for a Replit publish.

---

## 1. Live status snapshot (2026-05-07T11:36Z)

### 1.1 Production EC2 — `i-0df71e5ea1df8f588`

| Surface | URL | Status | Evidence |
|---|---|---|---|
| Gateway API | `https://api.nyayasiddhi.online/api/nv/health` | ✅ healthy v5.0.1, uptime ~3.9h | orchestration/database/llm_providers/agents/storage all healthy |
| Console UI | `https://console.nyayasiddhi.online/` | ✅ HTTP 200, ~59ms | Nyayavigya login renders |
| RDS Postgres | inside VPC | ✅ healthy | DB pool warm, queries <2ms avg |
| ElastiCache Redis | `master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` (TLS+AUTH) | ✅ healthy | Direct PING via redis-cli → PONG; 10 BullMQ queues registered without `evalsha` errors |
| BullMQ workers | inside container | ✅ live | Document job poller running (`production-doc-processor`, 3000ms interval, worker `worker-…`) |
| S3 storage | `s3://nyayavigya-sdk-devapp/` | ✅ live | Used by storage adapter (`backend=s3`) and SDK download surface |
| Provider lockdown | 6 ACTIVE LLM providers | ✅ healthy | anthropic, openai, google, openrouter, sarvam, bedrock |
| 1042 agents | DEFAULT registry section §0–§22 | ✅ loaded | `v5-governed-execution-network-nyayasiddhi-comprehensive` |
| Audit hash chain | `nv_schema.audit_hash_chain` | ✅ unbroken | Strict-OK since the v3.1.2 lockdown |

### 1.2 Replit dev — this workspace

| Surface | URL | Status |
|---|---|---|
| Gateway API | `http://localhost:5000/api/nv/health` | ✅ healthy v5.0.1, 14k+ requests, 0 failed |
| Database | Neon (`NYV_DATABASE_URL`) | ✅ healthy, 12 active conns, avg 1ms |
| Redis | bastion `13.232.165.242:16379` (R5 cutover) | ✅ healthy, PING→PONG, sha12=04548fa31d22 |
| LLM | 6/6 configured providers | ✅ healthy, 0 failed, 0 degraded |
| Agents | 1042 loaded | ✅ healthy |
| Object Storage | `@replit/object-storage` (env vars set) | ✅ wired (adapter at `src/services/nyv-document-storage-service.ts`) |
| Console UI | `http://localhost:3004/` | ✅ Vite dev server up, ready in 151ms |
| NSP Web Example | port 3000 | ✅ running |

### 1.3 What's degraded (not platform-blocking)

`/api/nv/health/full` reports `degraded` for: `payment_gateway`,
`whatsapp_notifications`, `error_tracking`, `nsp_api`, `nsi_api`. These
are **downstream-platform integrations**, not core platform services
— the platform is gateway+console+agents+LLM+DB+Redis+storage, all
green. Per console scope discipline, payment / WhatsApp / per-product
APIs live in their respective downstream clients.

---

## 2. T4 deep AI-flow probe — closing evidence

**70/70 functional PASS** across all 7 SDK platforms × 10 core flows
(F1 doc-parse, F2 doc-intelligence, F3 clauses/suggest, F4 summarize,
F5 compliance-check, F6 documents/compare, F7 embeddings, F8 agentic-
research, F9 enterprise-research, F10 translate). Plus 3 expected
scope-DENYs (NSA `documents:write`, NYM `research:read` × 2) — these
confirm the SDK-key scope gate is wired, not failures.

Two real bugs fixed mid-probe (NYV-AUDIT-F7-EXT, 2026-05-07):
- `suggestClauses` referenced non-existent `sdkClauseLibrary.status`
  column → 500 SQL syntax error.
- `complianceCheck` referenced non-existent `sdkComplianceControls.isActive`
  column → same error.
Both methods now select all rows (no soft-delete on either table),
mirroring the line-282 fix from May-05.

Real-LLM latency profile (synthesis flows): F2 9-20s, F4 22-27s, F5
15-21s — confirms calls traverse the full NV-ARCH-001 ring.

Full evidence: [`04b-sdk-endpoint-probe-2026-05-07.md`](./04b-sdk-endpoint-probe-2026-05-07.md).

---

## 3. v5.0.1 vs v5.0.0 delta (consolidated)

| Surface | v5.0.0 state | v5.0.1 state |
|---|---|---|
| Gateway version (`/health.version`) | `5.0.0` | **`5.0.1`** |
| Smoke baseline | 88 tests, no envelope capture | **102 PASS / 0 FAIL / 0 SKIP** with envelope (84/102) |
| SDK key coverage in smoke | 5 platforms | **All 7** (NSP/NSPM/NSI/NSA/NSM/NYM/JRX) |
| Deep AI-flow probe | None | **70/70 PASS** across 7 platforms × 10 flows |
| `/sdk/provision/validate` 500 on neon | crashed | **NYV-PROV-VAL-DEFENSIVE-001** defensive catch |
| `clauses/suggest` SQL bug | crashed | **NYV-AUDIT-F7-EXT** fixed (this session) |
| `compliance-check` SQL bug | crashed | **NYV-AUDIT-F7-EXT** fixed (this session) |
| Storage adapter | 2 divergent paths | **Single interface** (s3 + replit-object-storage backends) |
| Redis env-var aliases | 4 colliding | **NV-SECRETS-001** — 1 canonical write + 1 canonical read; legacy aliases warn-deprecate; 7-file CI whitelist |
| `nv-shared-docs-routes.ts` direct fetch | NV-ARCH-001 violation | **Removed** — routes now traverse the safety ring |
| Env-parity script | none | **`scripts/nv-verify-env-parity.ts`** + `06-environment-parity-2026-05-07.md` |
| Pre-deploy runbook | ad-hoc | **`07-pre-deploy-plan-2026-05-07.md`** — stepped, with rollback gates |
| Canonical doc set | 1 | **6 live + 4 to-author** (see §6) |

No architectural layer added in v5.0.1. This is a hardening / parity /
observability point release.

---

## 4. Architecture (unchanged from v5.0.0, snapshot for completeness)

- **Two-tier AI**: jurisdiction-specific Small Legal Models (SLMs)
  orchestrated by the Nyayasiddhi Legal Reasoning Model (NS LRM) with a
  global PII-redacted LLM fallback.
- **NV-ARCH-001 safety ring** (every LLM-bearing call):
  tenant isolation → guardrails → Queen orchestration (multi-agent)
  → agent allocation (BM25 over 1042 agents × 6 jur × 22 patterns ×
  107 swarm topologies) → 22-section Parlant prompt → 5-tier memory
  + multi-tier RAG (statute / case / template / private) + GraphRAG
  → CoT/ReAct/ToT reasoning → NV-ROUTER-001 (`orchestrateLLM`)
  cost-optimal LLM pick → response engineering → hallucination +
  citation + safety + HITL gate → audit hash chain → streaming.
- **NV-LLM-001 single-router rule**: 7-file whitelist enforces all LLM
  calls go through `realLLMService.executeRequest` → `orchestrateLLM`.
  AgentZero (priority 99) is the always-on cascade backup.
- **Multi-tenant by construction**: every row carries
  `(organization_id, application_id, api_key_id)`; all queries are
  `WHERE`-filtered by these in middleware before they reach the service
  layer.
- **6 jurisdictions live**: IN, UK, US, EU, GC, SG. Nyayavigya-Legal-
  registry-{IN,UK,US,GC,EU,SG,Default}.json hold the agent metadata.
- **22 agentic patterns** conforming to ROMA L5 standards.
- **107 swarm topologies** for multi-agent orchestration.

---

## 5. Replit publish readiness

**Verdict: GREEN. No remaining hurdles for a Replit publish.**

You explicitly approved Replit Object Storage + production database +
RAG, so the path is clear:

| Concern | Status | Notes |
|---|---|---|
| Object Storage | ✅ ready | `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` all set; adapter wired. Only step: flip `NYV_STORAGE_BACKEND` from `s3` → `replit` for the publish container so docs land in Replit Object Storage instead of S3. (Both backends share the same key path `tenants/<orgId>/docs/<yyyy>/<mm>/<requestId>/<filename>`.) |
| Production database | ✅ ready | Neon Postgres via `NYV_DATABASE_URL` works identically in Replit dev + publish + EC2. Same canonical schema (`shared/schema.ts`); the F7-EXT fix above transfers cleanly. |
| Redis / BullMQ | ✅ ready | Bastion `13.232.165.242:16379` reachable from Replit publish (it's a public TLS endpoint). All 10 BullMQ queues register without `evalsha` errors. |
| RAG / GraphRAG | ✅ ready | Multi-tier RAG (statute / case / template / private) + GraphRAG live and traversed by F2/F4/F5/F8. |
| LLM providers | ✅ ready | 6 providers configured via Replit Secrets vault (anthropic/openai/google/openrouter/sarvam/bedrock). Lockdown enforced via `src/config/nyv-allowed-providers.ts`. |
| SDK keys | ✅ ready | All 7 (`NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}`) in vault and verified against DB scopes. |
| Audit hash chain | ✅ ready | Strict-OK on Replit dev + EC2 prod. |
| HITL / Hallucination / Citation gates | ✅ ready | All firing in F5 compliance-check trace. |
| Custom domain | ⚠️ optional | Replit publish defaults to `*.replit.app`. If you want `app.nyayasiddhi.online` you can map a custom domain post-publish. |
| Cold-start time | ⚠️ note | Gateway boot is ~14s on Replit (DB warmup + agent registry + 17 LLM provider checks + 102 protocol-registry items). Replit publish auto-keeps-warm; this is fine. |

**Recommendation: publish.** See §7 for the exact next step.

---

## 6. Canonical 10-doc set — current status (per NV-DOC-001)

Per `replit.md` NV-DOC-001 the canonical set is:

| # | Subject | Current state | Source |
|---|---|---|---|
| 01 | Product (this) | ✅ **NEW** | `docs/canonical/01-product-comprehensive-2026-05-07.md` |
| 02 | Technical | ⚠️ partial — full long-form lives in `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` (1211 lines, refreshed 2026-05-07); §0a "v5.0.1 delta" is the canonical update. To-do: produce a slim `02-technical-comprehensive-2026-05-07.md` that incorporates the F7-EXT fix and links the long-form note as appendix |
| 03 | Architecture | ❌ **NOT YET AUTHORED**. Source for refresh: archived `archive/2026-05-07-r5-doc-consolidation/v3.1.2-pending_implementation_docs/NYV-ARCHITECTURE-AND-USER-FLOWS-v3.1.2.md` (463 lines, 2026-04-27). Needs v5.0.1 refresh — agent counts unchanged, but safety-ring numbering + 6-provider lockdown + storage adapter + Redis resolver need to land |
| 04 | Agents + Orchestration / SDK + API | ✅ done — `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` + `04b-sdk-endpoint-probe-2026-05-07.md` (70/70 evidence) |
| 05 | LLM | ⚠️ partial — `docs/canonical/05-config-directories-2026-05-07.md` exists but covers config dirs, not LLM specifically. To-do: rename / split — config dirs is a useful ops doc but the canonical "05-LLM" should cover provider lockdown, model catalog, router + AgentZero cascade |
| 06 | AWS Deployment | ⚠️ partial — `docs/canonical/06-environment-parity-2026-05-07.md` exists with the 3-env matrix; should be augmented with the EC2 SOP from `replit.md` "EC2 LATEST-CODE DEPLOY SUCCEEDED 2026-05-07" gotcha + ElastiCache cutover doc (`docs/v5.0.0/ELASTICACHE-CUTOVER-2026-05-07.md`) |
| 07 | Security + Compliance | ⚠️ partial — `docs/canonical/07-pre-deploy-plan-2026-05-07.md` is the deploy runbook, not the security+compliance doc proper. To-do: author `07-security-compliance-2026-05-07.md` covering DPDP / GDPR / audit chain / PII vault / quantum-sim / HITL gate |
| 08 | UAT | ❌ **NOT YET AUTHORED**. The 70/70 deep-probe evidence in `04b-` is the de-facto UAT artifact; needs formal write-up |
| 09 | SOP-AWS | ⚠️ partial — `07-pre-deploy-plan-2026-05-07.md` is the closest. Real SOP-AWS would split the deploy runbook from the per-incident playbook (rollback, ElastiCache cutover, image-tag recovery, etc) |
| 10 | Tracker + Changelog | ✅ **NEW** — `docs/canonical/10-tracker-changelog-2026-05-07.md` (this session). Long-form audit lives in `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md` (442 lines, 2026-05-07) |

**Net: 4 of 10 fully done (01, 04, 04b, 10), 4 partial (02, 05, 06, 09),
2 not yet authored (03, 08).** The partials are functional today; the
full 10-set rewrite is a 1–2 working-day batch task that does NOT
block publish or deploy. Tracked in §10 below.

---

## 7. Cross-check on the 7 docs you named

| Doc | Status | Notes |
|---|---|---|
| `docs/v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md` | ✅ exists, 880 lines, last updated 2026-05-01 | Authoritative business note for v5.0.0; v5.0.1 delta is in §3 above. **Refresh recommended** but not blocking |
| `docs/v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` | ✅ exists, 1211 lines, last updated 2026-05-07 | Already includes a `§0a v5.0.1 delta` block. Authoritative technical note |
| `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md` | ✅ exists, 442 lines | Single source of truth for the 6-phase remediation plan; referenced by `replit.md` |
| `WIP/Nyayavigya-Pending-Tasks-DevLiveReady-v5.0.0.md` | ❌ **NOT FOUND** anywhere in the repo (including archive). Likely never authored, or removed in the R5 doc consolidation on 2026-05-07. |
| `WIP/Nyayavigya-v5.0.0-Roadmap.md` | ❌ **NOT FOUND** anywhere in the repo. Same. |
| `WIP/Phase-D-to-J-Execution-Plan-v5.0.0.md` | ❌ **NOT FOUND**. Closest match in repo: `scripts/nv-phase-c-onflag-validation.ts` (a Phase-C script, not docs). The whole `WIP/` directory is empty / removed |
| `archive/.../NYV-ARCHITECTURE-AND-USER-FLOWS-v3.1.2.md` | ✅ exists, 463 lines, archived 2026-04-27 | Archived per NV-DOC-001 (only canonical 01–10 active). Source material for the to-be-authored canonical 03-Architecture doc |

The 3 missing WIP docs cannot be located. Per NV-DOC-001 they would be
archived anyway; what they covered (pending tasks / roadmap / phase plan)
is now consolidated into:
- This doc (§3 v5.0.1 delta + §6 doc gap + §10 next-actions)
- `docs/canonical/10-tracker-changelog-2026-05-07.md` (changelog + tracker)
- `docs/canonical/07-pre-deploy-plan-2026-05-07.md` (the active deploy plan)
- `docs/v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md` (the 6-phase remediation plan)

---

## 8. T7 status (pre-deploy gate)

**T7 outcome: AWAITING USER GO.** The runbook
[`07-pre-deploy-plan-2026-05-07.md`](./07-pre-deploy-plan-2026-05-07.md)
is complete and validated, with explicit rollback gates. No code work
is pending in T7 — only the explicit "GO" from you. T1–T6 are DONE
(see the table at the top of `07-pre-deploy-plan-2026-05-07.md`).

What that runbook does when you say GO:
1. Re-run smoke 102/0/0 + deep-probe 70/70 sanity gate.
2. Tag the current image as `:rollback-<timestamp>` BEFORE building.
3. Build, push to S3, deploy via SSM/base64 to EC2 (canonical path).
4. Health-gate the new container (5-min watchdog) — auto-rollback to the
   tagged image if any service goes red.
5. Re-run smoke against EC2 to confirm parity.
6. For Replit publish: same code, just press the Publish button after
   flipping `NYV_STORAGE_BACKEND` to `replit` in the publish env.

---

## 9. Known carry-overs (none block publish)

- `nv-pii-vault-cleanup.ts` cold-start Redis race: falls back to
  in-memory; needs `await client.ping()` gate before next prod cutover.
  Tracked in `replit.md` "Upstash dev Redis quota EXHAUSTED" gotcha.
- Replit dev gateway is on the bastion (NOT Upstash REST). EC2 prod is
  on ElastiCache. If you want pure parity, also flip Replit dev to
  ElastiCache via the same bastion.
- `archive/2026-05-07-r5-doc-consolidation/` still holds 4 directories
  worth of old docs. Not a regression — these are correctly archived
  per NV-DOC-001.

---

## 10. Next actions (what I'd do, in order)

| # | Action | Time | Blocker for publish? |
|---|---|---|---|
| 1 | **You: type "GO" for T7** to ship the current image to EC2 (no-op if you only want Replit publish) and/or **press Publish on Replit** to ship to `*.replit.app` | seconds | n/a |
| 2 | Flip `NYV_STORAGE_BACKEND=replit` in the Replit publish env (needed only if you want docs in Replit Object Storage instead of S3) | 1 min | optional |
| 3 | Author the missing 6 canonical docs (02-Technical slim, 03-Architecture, 05-LLM, 06-AWS-Deployment full, 07-Security+Compliance, 08-UAT, 09-SOP-AWS) — see §6 gap matrix | 1–2 working days, batchable | NO |
| 4 | Refresh `NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md` from 2026-05-01 to 2026-05-07 reality | half day | NO |
| 5 | Cold-start Redis-ping race fix in `nv-pii-vault-cleanup.ts` | 1 hour | NO |

Items 1 + 2 are the only ones gating publish. Everything else is
hardening / docs polish.

---

## 11. Batch A–J product surface (`/api/nv5/*`, Session-10/11/12)

The `/api/nv5/*` namespace is the **additive** admin / capability surface
added in Sessions-10 and 11. The frozen v5 SDK surface (`/api/nv/*`) is
unchanged. Every Batch A–J flag defaults OFF; each capability is opt-in
per environment via `NYV_F_*` env-vars (see
`src/config/nv-feature-flags.ts`). End-to-end safety-ring traces per
batch live in `11-agentic-architecture-2026-05-10.md`.

| Batch | Namespace | User-facing capability | SKU(s) served | Ecosystem consumer | Example |
|---|---|---|---|---|---|
| **A** | `/api/nv5/orch/*` | Orchestration primitives — BM25 agent shortlist preview (`/agent-select/{load,select}`), ROMA-L5 outcome tracking, KB / multimodal-RAG / context / plugins / protocols metadata | NSP, NSPM, NSI, NSM, NSA, NYM, JRX (admin) | All 7 platforms via console RBAC | `POST /api/nv5/orch/agent-select/select` with `{query, topK}` returns the top-k agents from the loaded index without spending an LLM call |
| **B** | `/api/nv5/multimodal/*` | Vision analysis, 3D / avatar session creation (Unity, ChatdollKit, custom), advanced multimodal-RAG query — all delegating to canonical `nv-sdk-multimodal-voice-routes`. Sub-mounts: `/avatar-unity`, `/avatar-chatdoll`, `/rag-adv` (advanced multimodal-RAG / vision), `/3d-immersive`, `/avatar-3d`. | NSP, NSPM, NYM, NSI, NSM | NSP web/mobile (vision-grounded contract analysis), NYM (citizen avatar UI), NSI/NSM (multimodal-RAG over private corpus) | `POST /api/nv5/multimodal/rag-adv/vision/analyze` with a scanned PDF page |
| **B** | `/api/nv5/voice/*` | Realtime voice streaming (Deepgram + Sarvam-22-Indic + Whisper), TTS synthesis, voice provider cost reporting | NSPM, NYM | NSPM (lawyer dictation), NYM (citizen voice intake in 22 Indian languages) | `POST /voice/synthesis/synthesize` with `{text, language:"hi"}` |
| **C** | `/api/nv5/workflows/*` | Long-running autonomous + continuous workflow engines (due-diligence sweep, contract-corpus scan, monitoring), per-task fan-out with full safety ring per task | NSI, NSM, NSP-enterprise | NSI (corporate-counsel due-diligence), NSM (gov-grade compliance sweeps), NSP-enterprise (firm-wide audit) | `POST /workflows/start` with `{engine:"autonomous", tasks:[…]}` |
| **C** | `/api/nv5/doc-ai/*` | Pure-deterministic doc conversion (PDF/A, DOCX, image-to-searchable-PDF) — no LLM emission. Single sub-mount: `/convert`. | NSP, NSPM, NSI, NSM, NSA, NYM, JRX | All 7 platforms — universal pre-RAG normalisation | `POST /api/nv5/doc-ai/convert/jobs` with multer file ≤ 1 GB |
| **D** | `/api/nv5/gov/*` | Governance — maker-checker queue, security monitor, cost optimiser, concurrency governor, per-org rate limiter | NSI, NSM (gov + enterprise) | Console super-admin governance UI (`/superadmin/governance`) | `GET /gov/org-ratelimit/check/:orgId/:userId` |
| **E** | `/api/nv5/legal-pipeline/*` | RAG primitives — chunker preview, embedding model catalog, RRF reranker fusion, summariser metadata, Flesch-Kincaid readability scoring | NSP, NSPM, NSI, NSM, NSA, NYM, JRX (admin) | Engineering ops + downstream-platform integrators tuning RAG before expensive index passes | `POST /legal-pipeline/chunker/preview` with raw text |
| **F** | `/api/nv5/compliance/*` | EU AI Act report generation (Article 9 risk-mgmt, Article 15 bias audit), PQC keygen (ML-KEM, ML-DSA), federated-privacy session listings + DP-noise probe | NSI, NSM, JRX (EU jurisdiction) | NSI EU customers, NSM gov regulators, JRX cross-jurisdiction integrators | `GET /compliance/eu-ai-act/agent/:agentId/risk-management` |
| **G** | `/api/nv5/internal/{model-cascade,slm-router,cost-aware-router}/*` | Routing / cascade introspection — SLM availability per jurisdiction, complexity-tier classifier metadata | All (admin) | Ops + SRE before flipping traffic | `GET /internal/slm-router/availability/SG` |
| **H** | `/api/nv5/internal/{esign,ocr,pdfa,watermark}/*` | Document-pipeline adapter introspection (eSign session lookup, GOT-OCR doc types, PDF/A profiles, watermark catalog) | NSP, NSPM, NSI, NSM (admin) | Ops + downstream integrators | `GET /internal/ocr/capabilities` |
| **I** | `/api/nv5/internal/{hallucination,escalation,event-sourcing,jurisdiction-overlay,audit-chain}/*` | Quality / audit / jurisdiction introspection | NSI, NSM (admin) | Ops + compliance auditors | `GET /internal/jurisdiction-overlay/capabilities` |
| **J** | `/api/nv5/internal/{case-update,azentzero,agentzero,feature-flags,orchestration-facade}/*` | Adapters / case-management / platform introspection — circuit-breaker stats, runtime flag-store metadata, orchestration-facade introspection | All (admin) | Ops + SRE | `GET /internal/agentzero/capabilities` |

**Mount discipline.** Every Batch A–J handler is either (a) read-only
metadata, (b) deterministic compute (chunker, RRF fusion, PQC keygen,
DP-noise), or (c) a `delegateTo()` wrapper that re-enters the canonical
`/api/nv/*` chain. **No nv5 endpoint emits an LLM call directly** —
NV-LLM-001 single-router rule preserved (CI-enforced via
`npm run guardrail:no-new-orphans` + grep whitelist).

---

## 12. 1,042-agent registry catalog summary

Source of truth: `config/agent-registries/Nyayavigya-Legal-registry-{IN,UK,US,GC,EU,SG,Default}.json`. Format
`v5-governed-execution-network-nyayasiddhi-comprehensive`, ROMA-L5,
generated 2026-05-05.

### 12.1 Per-jurisdiction counts

| Code | Jurisdiction | Legal system | Total agents | Practice areas | Queen orchestrator |
|---|---|---|---|---|---|
| IN | India          | Common Law (British-derived) with codified statutes | 149 | 27 | 1 |
| UK | United Kingdom | Common Law with statutory overlay | 149 | 27 | 1 |
| US | United States  | Common Law (federal + state) | 149 | 27 | 1 |
| GC | Gulf Cooperation Council | Mixed (Sharia + civil) | 149 | 27 | 1 |
| EU | European Union | Civil Law (harmonised) | 149 | 27 | 1 |
| SG | Singapore      | Common Law (English-derived) | 149 | 27 | 1 |
| Default | Cross-jurisdiction baseline | Hybrid | 148 | 27 | 0 |
| **Total** | | | **1,042** | | **6** |

(149 = 148 specialist agents + 1 Queen orchestrator per jurisdiction; the
DEFAULT registry has no jurisdiction-specific Queen by design — JRX
synthesises across the 6 jurisdiction Queens at runtime.)

### 12.2 Practice-area distribution (identical across the 6 active jurisdictions)

| # | Practice area | Module | Agents |
|---|---|---|---|
| 1 | Arbitration & ADR | timeline | 6 |
| 2 | Banking & Finance | timeline | 6 |
| 3 | Capital Markets | timeline | 6 |
| 4 | Civil litigation | timeline | 6 |
| 5 | Commercial litigation | timeline | 6 |
| 6 | Constitutional | timeline | 6 |
| 7 | Consumer protection | timeline | 6 |
| 8 | Corporate / M&A | timeline | 6 |
| 9 | Criminal | timeline | 6 |
| 10 | Data protection / privacy | timeline | 6 |
| 11 | Employment / labour | timeline | 6 |
| 12 | Environmental | timeline | 6 |
| 13 | Family | timeline | 6 |
| 14 | Healthcare | timeline | 6 |
| 15 | Immigration | timeline | 6 |
| 16 | Insolvency / bankruptcy | timeline | 6 |
| 17 | Insurance | timeline | 6 |
| 18 | Intellectual property | timeline | 6 |
| 19 | Real estate | timeline | 6 |
| 20 | Regulatory / compliance | timeline | 6 |
| 21 | Securities | timeline | 6 |
| 22 | Shipping / maritime | timeline | 6 |
| 23 | Tax | timeline | 6 |
| 24 | Technology / IT | timeline | 6 |
| 25 | Telecommunications | timeline | 6 |
| 26 | White-collar / fraud | timeline | 6 |
| 27 | Cross-cutting (research, drafting, citation) | shared | 4 |
| **Sum** | | | **148 specialists per jurisdiction** |

### 12.3 ROMA-L5 pattern coverage

22 ROMA-L5 pattern IDs (`P1` … `P22`) are referenced from each agent's
`agenticPatterns` array. Counts below are agents-advertising-the-pattern
across all 7 jurisdiction registries combined (an agent with 3 patterns
contributes once to each of those 3 rows; agents may appear in multiple
rows). Generated from
`jq -r '.agents[].agenticPatterns[]?' config/agent-registries/Nyayavigya-Legal-registry-*.json | sort | uniq -c`
on 2026-05-10.

| Pattern ID | Agents advertising (all 7 registries) |
|---|---|
| P1  | 252 |
| P2  | 161 |
| P3  | 0 (reserved; no agent currently advertises) |
| P4  | 140 |
| P5  | 21 |
| P6  | 7 |
| P7  | 7 |
| P8  | 28 |
| P9  | 322 |
| P10 | 28 |
| P11 | 70 |
| P12 | 7 |
| P13 | 14 |
| P14 | 49 |
| P15 | 49 |
| P16 | 42 |
| P17 | 56 |
| P18 | 49 |
| P19 | 98 |
| P20 | 105 |
| P21 | 210 |
| P22 | 203 |
| **Total advertisements** | **1,918** (across 1,042 agents — avg ~1.84 patterns / agent) |

The semantic name catalogue for `P1`…`P22` (CoT, ToT, ReAct, Reflexion,
Plan-and-Solve, Self-Consistency, Self-Refine, RAG, GraphRAG, ReWOO,
MRKL, AutoGPT, Voyager, OpenAGI, ProgPrompt, Multi-Agent-Debate,
Society-of-Mind, Generative-Agents, ChatDev, MetaGPT, AgentVerse,
AgentBench) is registry-internal — the runtime only consumes the IDs.
At request time the Queen orchestrator selects the routed pattern and
`bm25-agent-selector` further filters the shortlist to agents whose
`agenticPatterns` intersects that pattern.

### 12.4 Swarm topologies

107 swarm topologies (registered under
`src/config/nv-protocol-registry-manifest.ts`). Each Queen orchestrator
selects a topology per request from the live menu; the choice is logged
to the audit hash chain alongside the agent shortlist.

### 12.5 Re-verification

```bash
for j in IN UK US EU GC SG Default; do
  jq '{jur: .jurisdictionCode, total: .totalAgents, areas: (.practiceAreas|length)}' \
    config/agent-registries/Nyayavigya-Legal-registry-$j.json
done

# expect: 6 × 149 + 1 × 148 = 1,042
GET /api/nv/agents/registry-version    # served by gateway, hash + counts
```

---

## Appendix A — Deep links

- Live probe evidence: [`04b-sdk-endpoint-probe-2026-05-07.md`](./04b-sdk-endpoint-probe-2026-05-07.md)
- Cross-platform SDK + API: [`04-sdk-and-api-canonical-2026-05-07.md`](./04-sdk-and-api-canonical-2026-05-07.md)
- Config dirs (Replit + EC2): [`05-config-directories-2026-05-07.md`](./05-config-directories-2026-05-07.md)
- Env parity matrix + verifier script: [`06-environment-parity-2026-05-07.md`](./06-environment-parity-2026-05-07.md)
- Pre-deploy runbook: [`07-pre-deploy-plan-2026-05-07.md`](./07-pre-deploy-plan-2026-05-07.md)
- Tracker + changelog: [`10-tracker-changelog-2026-05-07.md`](./10-tracker-changelog-2026-05-07.md)
- Long-form business note (still authoritative for v5.0.0 detail):
  [`../v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`](../v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md)
- Long-form technical note (with v5.0.1 delta block):
  [`../v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`](../v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md)
- 6-phase remediation plan + deep audit:
  [`../v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md`](../v5.0.0/NYV-PLATFORM-DEEP-AUDIT-2026-05-07.md)
