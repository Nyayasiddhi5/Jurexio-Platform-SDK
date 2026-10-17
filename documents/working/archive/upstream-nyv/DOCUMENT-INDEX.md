# Nyayavigya — Production Document Index

> **Last updated:** 2026-09-18 (UTC)  
> Single navigation page for humans, partners, and new developers.  
> Rule: **active docs live here** (`documents/working/`). **Historical docs** are in `documents/completed/` (read-only).  
> **Product scope:** **Legal / Nyayasiddhi ecosystem only.**  
> **Release line:** **v5.0.0** — hub [`v5.0.0/README.md`](./v5.0.0/README.md) · ops [`SOP/README.md`](./SOP/README.md)  
> **Share-ready pack (canonical for external handoff):** [`Nyayavigya Documents 5.0.0-ShareReady-2026-08/00-README-INDEX.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/00-README-INDEX.md)

---

## Start here (everyone)

| Document | Purpose |
|---|---|
| [`Nyayavigya Documents 5.0.0-ShareReady-2026-08/00-README-INDEX.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/00-README-INDEX.md) | **Share-ready pack (2026-08-12)** — product, tech, architecture, algorithms, config, AWS deploy, DB architecture, capacity, GTM, governance, 10-year Legal moat, day-2 SOP |
| [`Nyayavigya Documents 5.0.0-August2026/00-README-INDEX.md`](./Nyayavigya%20Documents%205.0.0-August2026/00-README-INDEX.md) | Earlier August-4 handoff pack (superseded for share; keep for history) |
| [`CURSOR-WORKSPACE-BACKUP-AND-CLOUD-5.0.0.md`](./CURSOR-WORKSPACE-BACKUP-AND-CLOUD-5.0.0.md) | Portable Cursor workspace + Cloud zip / restore |
| [`WORKSPACE-CLEANUP-INVENTORY-5.0.0-2026-07.md`](./WORKSPACE-CLEANUP-INVENTORY-5.0.0-2026-07.md) | Cleanup inventory (sizes, secrets names, archive map) |
| [`SECRETS-BACKUP-HANDOFF-5.0.0.md`](./SECRETS-BACKUP-HANDOFF-5.0.0.md) | Secrets backup key names + restore (no values) |
| [`v5.0.0/README.md`](./v5.0.0/README.md) | **5.0.0 hub** — product notes, architecture, deploy map, version clarity |
| [`SOP/README.md`](./SOP/README.md) | **SOP pack** — EC2, RDS, RAG, agents, NYS jobs, UAT, SOC2, troubleshooting |
| [`PLATFORM-STATUS.md`](./PLATFORM-STATUS.md) | What is live, pilot-ready, and pending — **ops snapshot** |
| [`NYV-COMPREHENSIVE-PRODUCT-NOTES-2026-09.md`](./NYV-COMPREHENSIVE-PRODUCT-NOTES-2026-09.md) | **Product-only notes** — personas, journeys, NSP/NSPM/JRX flows, advantages vs global legal players (no endpoints, dates or status language) |
| [`NYV-COMPREHENSIVE-TECHNICAL-PRODUCT-NOTES-2026-09.md`](./NYV-COMPREHENSIVE-TECHNICAL-PRODUCT-NOTES-2026-09.md) | **Technical notes** — architecture, resolve cascade, docparse, NyayaWatch, **signing maturity matrix** |
| [`NYV-DEPLOYMENT-COST-PLAN-20K-USERS-2026-09.md`](./NYV-DEPLOYMENT-COST-PLAN-20K-USERS-2026-09.md) | **Deployment & cost plan (~20K users)** — OPEX/CAPEX model, baseline vs optimized (≈85–90% LLM cut), topology, phased rollout, risks |
| [`PHASED-GO-LIVE-PLAN-2026-07.md`](./PHASED-GO-LIVE-PLAN-2026-07.md) | **Phased plan** — local → dev EC2 (secrets frozen) → enhanced → staging 10K → production HA + rotation |
| [`PHASE-1-LOCAL-CLOSEOUT-2026-07-21.md`](./PHASE-1-LOCAL-CLOSEOUT-2026-07-21.md) | **Phase 1 local close-out** — safetyVerdict + orchestrate/stream SDK; tests green; EC2 GO-gated |
| [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md) | **SDK/API + Knowledge Plane integration (5.0.0)** — combined ecosystem handoff (updated 2026-08-20 deploy · SDK 5.0.10) |
| [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md) | **NSP partner API pack** — orchestrate trust · Patra · CNR · Instant Search · templates |
| [`NSP-NYV-AI-TASK-SURFACE-2026-09.md`](./NSP-NYV-AI-TASK-SURFACE-2026-09.md) | **NSP AI task surface one-pager (2026-09)** — feature → taskType → endpoint matrix; chat, drafts, research, tools, prompt improve; deploy `0540Z` |
| [`NSP-NYV-AI-HANDSHAKE-2026-09.md`](./NSP-NYV-AI-HANDSHAKE-2026-09.md) | **NSP↔NYV AI handshake superset** — draft tiers, async contract, documentType inference, §11 polish gaps |
| [`NSP-NYV-HANDOFF-README-2026-09-16.md`](./NSP-NYV-HANDOFF-README-2026-09-16.md) | **NSP integration bundle index** — what to read first, migration checklist, verification probes |
| [`NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md`](./NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md) | **NSP + NYM AI task endpoints** — which endpoint per surface, per-class timeouts, tracking fields, error mapping; **§4e/§4f deployed 2026-08-20** (`analysisStatus`, breaker partition, `paras[]`, filters, latency) |
| [`NYV-TO-NSP-CONSOLIDATED-REPLY-2026-08-20.md`](./NYV-TO-NSP-CONSOLIDATED-REPLY-2026-08-20.md) | **Consolidated reply to NSP blockers NYV-1 … NYV-11 (2026-08-20)** — §0 deployment gate updated post-GO deploy **`8c6852aa` / `712e35ea…`**; points to §4a–§4f of the endpoints doc |
| [`NYV-1-ALB-ROUTING-VERIFICATION-2026-08.md`](./NYV-1-ALB-ROUTING-VERIFICATION-2026-08.md) | **NYV-1 ALB routing verification** — prior/after listener-rule tables, `:80` vs `:5000` regression measurement, four disproofs of the port diagnosis, reversal commands |
| [`NYV-NSP-WAVE-B-RESPONSE-2026-08-17.md`](./NYV-NSP-WAVE-B-RESPONSE-2026-08-17.md) | **Reply to NSP Wave-B asks** — 502 verdict, state enum, disconnect≠fail evidence, `orchestrationId`, session continuity |
| [`NSP-NYM-SESSION-IDENTITY-CONTRACT-2026-08-17.md`](./NSP-NYM-SESSION-IDENTITY-CONTRACT-2026-08-17.md) | **Session + identity contract** — `x-customer-user-id`, session precedence, the three ids, what auth actually is |
| [`NYV-NSP-SIX-ITEM-VERIFICATION-2026-08-17.md`](./NYV-NSP-SIX-ITEM-VERIFICATION-2026-08-17.md) | **Six-item verification for NSP** — advocate ids, session header, leak re-test, 502 verdict, analyze fields on all 3 paths, enum |
| [`NYV-OPEN-ITEMS-ACTION-PLAN-2026-08-17.md`](./NYV-OPEN-ITEMS-ACTION-PLAN-2026-08-17.md) | **Action plan for 4 open items** — memory recall index, step0 observability, PERSON NER options, v2 benchmark probe fix |
| [`NYV-NSP-TASK387-AND-FIELDS-2026-08-17.md`](./NYV-NSP-TASK387-AND-FIELDS-2026-08-17.md) | **Task 387 attribution + field-shape answer** — deploy-window 502, which operation returns fields, flat aliases, doc-type fix |
| [`NYV-RDS-STATUS-AND-ADMIN-ASSESSMENT-2026-08-17.md`](./NYV-RDS-STATUS-AND-ADMIN-ASSESSMENT-2026-08-17.md) | **RDS status + admin credential assessment** — instance inventory, 100% cache hit, DDL-only blast radius, reset repercussions |
| [`NYV-ARCHITECTURE-AUDIT-SIX-COMPONENTS-2026-08-17.md`](./NYV-ARCHITECTURE-AUDIT-SIX-COMPONENTS-2026-08-17.md) | **Six-component architecture audit** — LLM ladder+pricing, RAG layers, memory tiers, caching, RDS optimisation, document storage; WIRED vs DEAD with file:line |
| [`NYV-NSP-CHANGES-2026-08-16-TO-18.md`](./NYV-NSP-CHANGES-2026-08-16-TO-18.md) | **Partner-facing changelog (2 days)** — required NSP actions, new response fields, analyze fields, task 387, perf gains, 2 corrections |
| [`NYV-P0-P1-ACTION-PLAN-2026-08-18.md`](./NYV-P0-P1-ACTION-PLAN-2026-08-18.md) | **P0/P1 action plan (NYV+NYS as one platform)** — 6 P0 + 6 P1 with fix/verify/effort/risk, 4-wave sequence; withdraws the caselaw-10.5s claim, surfaces 5.56% embedding coverage |
| [`NYV-NYS-PENDING-WORK-2026-08-18.md`](./NYV-NYS-PENDING-WORK-2026-08-18.md) | **Pending work across NYV + NYS integration** — measured NYS latency, memory-tier gaps, MMR dead, ordered plan |
| [`NYV-COUNSEL-GRADE-QUALITY-PLAN-2026-08-19.md`](./NYV-COUNSEL-GRADE-QUALITY-PLAN-2026-08-19.md) | **Counsel-grade quality action plan** — measured drafting 8/8, the citation-grounding defect, P0–P3 plan; **§5 = clause-level-diff ownership verdict (NSP's; NYV adds nothing)** |
| [`Nyayavigya-platform-Integration-document-5.0.0.pdf`](./Nyayavigya-platform-Integration-document-5.0.0.pdf) | PDF of the integration document |
| [`Nyayavigya-Platform-5.0.0-Business.md`](./Nyayavigya-Platform-5.0.0-Business.md) | **Comprehensive Business product note 5.0.0** (updated 2026-07-29) |
| [`Nyayavigya-Platform-5.0.0-Technical.md`](./Nyayavigya-Platform-5.0.0-Technical.md) | **Comprehensive Technical product note 5.0.0** (updated 2026-07-29) |
| [`Nyayavigya-Platform-5.0.0-PRODUCTION.md`](./Nyayavigya-Platform-5.0.0-PRODUCTION.md) | Short production snapshot |
| [`NYV-PLATFORM-INTEGRATION-GUIDE-NSP-NYM-JRX-2026-07.md`](./NYV-PLATFORM-INTEGRATION-GUIDE-NSP-NYM-JRX-2026-07.md) | **Canonical** NSP/NYM/JRX integration — API + SDK + MCP + Word plugin + payloads + Gemini/LLM |
| [`PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md`](./PATRA-MITRA-API-NSP-NYM-NYS-2026-08.md) | **Patra Mitra** — parse/OCR/fields/summary/document Q&A for NSP/NYM/NYS |
| [`NSP-CNR-RESOLVE-CORPUS-PLAN-2026-08.md`](./NSP-CNR-RESOLVE-CORPUS-PLAN-2026-08.md) | **CNR resolve** — corpus/Open Data API + E2E plan (no live eCourts) for NSP autofill |
| [`NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md`](./NSP-CNR-RESOLVE-API-CONTRACT-2026-08.md) | **NSP integration contract** — CNR resolve request/response/errors/timeouts (LIVE) |
| [`NSP-CNR-DIARY-ONE-PAGER-2026-09.md`](./NSP-CNR-DIARY-ONE-PAGER-2026-09.md) | **NSP CNR/diary/documents one-pager** — printable integration quick ref (live deploy **`30ae45d6`**) |
| [`NSP-CNR-DIARY-MATTER-CREATION-2026-09.md`](./NSP-CNR-DIARY-MATTER-CREATION-2026-09.md) | **NSP matter creation (full)** — CNR vs diary, matter schema, SC/HC/DC workflows; Appendices C–F (gaps, coverage, routing, infra E2E) |
| [`NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md`](./NSP-NYV-WORD-DMS-API-CONTRACT-2026-07.md) | NSP Word/DMS ↔ NYV API contract + depth tiers |
| [`MATTER-VAULT-POSTGRES-PLAN-2026-07.md`](./MATTER-VAULT-POSTGRES-PLAN-2026-07.md) | Matter Vault Postgres persistence |
| [`PRODUCTION-PARTIALS-FULL-COVERAGE-2026-07.md`](./PRODUCTION-PARTIALS-FULL-COVERAGE-2026-07.md) | Pre-prod partials → full coverage checklist |
| [`Nyayavigya-Platform-5.0.0-PRODUCTION.md`](./Nyayavigya-Platform-5.0.0-PRODUCTION.md) | Canonical product note (production release line v5.0.0) |
| [`PRODUCTION-READINESS-DEV-PENDING.md`](./PRODUCTION-READINESS-DEV-PENDING.md) | Development-only gaps before paid GA (not infra/deploy) |
| [`PRODUCTION-CODEBASE-LAYOUT.md`](./PRODUCTION-CODEBASE-LAYOUT.md) | Runtime vs tooling vs docs — where code belongs |
| [`DEVELOPER-ONBOARDING.md`](./DEVELOPER-ONBOARDING.md) | New developer setup and contribution path |
| [`TEAM-HANDOFF-PACKAGE.md`](./TEAM-HANDOFF-PACKAGE.md) | Zip/clone handoff — folder map, Cursor setup |
| [`NSP-EXECUTION-PLAN-2026.md`](./NSP-EXECUTION-PLAN-2026.md) | NSP 48-feature build spec + SDK wiring |
| [`NSP-ENHANCEMENT-ROADMAP-2026.md`](./NSP-ENHANCEMENT-ROADMAP-2026.md) | NSP capability gaps + phased roadmap |
| [`SECRETS-SETUP.md`](./SECRETS-SETUP.md) | Local secrets layout (no values in git) |
| [`ENV-VARIABLES-REFERENCE.md`](./ENV-VARIABLES-REFERENCE.md) | Consolidated env var catalog |

---

## Audit & change control (root)

| Document | Purpose |
|---|---|
| [`../../Project-Tracker.md`](../../Project-Tracker.md) | Audit ledger — every change gets a row |
| [`../../CHANGELOG.md`](../../CHANGELOG.md) | Detailed narrative changelog |
| [`../../AGENTS.md`](../../AGENTS.md) | Mandatory guardrails for all contributors |
| [`../../deployment-status.md`](../../deployment-status.md) | Live infra snapshot |

---

## Technical depth (v5.0.0)

| Document | Purpose |
|---|---|
| [`v5.0.0/NYAYASIDDHI-ECOSYSTEM-ARCHITECTURE-5.0.0.md`](./v5.0.0/NYAYASIDDHI-ECOSYSTEM-ARCHITECTURE-5.0.0.md) | **Ecosystem architecture** — NYV + NYS + RDS + agents + RAG + jobs |
| [`v5.0.0/SOURCE-AND-DEPLOY-MAP-5.0.0.md`](./v5.0.0/SOURCE-AND-DEPLOY-MAP-5.0.0.md) | Source tree, builds, dual-EC2 deploys |
| [`Nyayavigya-Platform-5.0.0-Technical.md`](./Nyayavigya-Platform-5.0.0-Technical.md) | **Canonical** architecture, orchestration, RAG, agents, CAM/GRPO |
| [`Nyayavigya-Platform-5.0.0-Business.md`](./Nyayavigya-Platform-5.0.0-Business.md) | **Canonical** business / GTM companion |
| [`Nyayavigya-Platform-5.1.0-Technical.md`](./Nyayavigya-Platform-5.1.0-Technical.md) | Prior draft (superseded by 5.0.0-Technical for product line) |
| [`Nyayavigya-Platform-5.1.0-Business.md`](./Nyayavigya-Platform-5.1.0-Business.md) | Prior draft (superseded by 5.0.0-Business) |
| [`FEATURE-INVENTORY.md`](./FEATURE-INVENTORY.md) | Feature wiring inventory |
| [`LLM-STACK.md`](./LLM-STACK.md) | Provider matrix and routing |

---

## UAT & quality

| Document | Purpose |
|---|---|
| [`UAT-TEST-PLAN.md`](./UAT-TEST-PLAN.md) | Master UAT plan |
| [`PRODUCT-READINESS-UAT-10K.md`](./PRODUCT-READINESS-UAT-10K.md) | ~10K user executable gate (`npm run product:readiness:10k`) |
| [`NYAYAVIGYA-UAT-TESTCASES-2026-06.md`](./NYAYAVIGYA-UAT-TESTCASES-2026-06.md) | Platform UAT cases |
| [`LEGALCHAT-UAT-TESTCASES-2026-06.md`](./LEGALCHAT-UAT-TESTCASES-2026-06.md) | Legal Chat UAT cases |
| [`NYAYAVIGYA-UAT-TEST-USERS-2026-06.md`](./NYAYAVIGYA-UAT-TEST-USERS-2026-06.md) | Test user roles and URLs |

---

## Partner / SDK / deployment

| Document | Purpose |
|---|---|
| [`NYV-PLATFORM-INTEGRATION-GUIDE-NSP-NYM-JRX-2026-07.md`](./NYV-PLATFORM-INTEGRATION-GUIDE-NSP-NYM-JRX-2026-07.md) | NSP/NYM/JRX full modes (API/SDK/MCP/plugin) + request/response payloads |
| [`ECOSYSTEM-SDK-INTEGRATION-GUIDE-2026-07.md`](./ECOSYSTEM-SDK-INTEGRATION-GUIDE-2026-07.md) | **All 7 platforms** — SDK download, per-SKU playbooks, status |
| [`NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md`](./NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md) | NYS→NYV federated knowledge plane (caselaw/statutes/RAG/SDK) |
| [`NYS-KNOWLEDGE-PLANE-EC2-CHECKLIST-2026-07.md`](./NYS-KNOWLEDGE-PLANE-EC2-CHECKLIST-2026-07.md) | GO-gated EC2 enablement checklist for Knowledge Plane |
| [`DUAL-PROJECT-OPS-NYV-NYS-2026-07.md`](./DUAL-PROJECT-OPS-NYV-NYS-2026-07.md) | Manage NYV + NYS from one workspace; two EC2 targets |
| [`NYS-RAG-RDS-READINESS-2026-07.md`](./NYS-RAG-RDS-READINESS-2026-07.md) | NYS hybrid RAG + RDS index/embedding audit + upgrade path |
| [`NYS-INDIA-CORPUS-GAPS-2026-07.md`](./NYS-INDIA-CORPUS-GAPS-2026-07.md) | India-first completeness: statutes/caselaw/S3 freshness vs SCC/eCourts; P0 status |
| [`NYS-INDIA-COURT-TIER-TEMPLATES-2026-07.md`](./NYS-INDIA-COURT-TIER-TEMPLATES-2026-07.md) | India templates: SC/HC/District + Tier 1–3 final instruments |
| [`NYS-INDIA-P1-P2-SCAFFOLD-2026-07.md`](./NYS-INDIA-P1-P2-SCAFFOLD-2026-07.md) | P1/P2 backlog scaffolding after P0 |
| [`NYV-NYS-ECOSYSTEM-E2E-ASSESSMENT-2026-07.md`](./NYV-NYS-ECOSYSTEM-E2E-ASSESSMENT-2026-07.md) | Ecosystem SDK→NYV→NYS readiness, gaps, 10K honesty |
| [`PARTNER-SDK-RELEASE-2026-05.md`](./PARTNER-SDK-RELEASE-2026-05.md) | Partner SDK release and smoke |
| [`NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md`](./NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md) | NSP integration guide (deep) |
| [`NSP-INTEGRATION-CHEATSHEET-2026-06.md`](./NSP-INTEGRATION-CHEATSHEET-2026-06.md) | Quick integration reference |
| [`NSP-TEAM-HANDOFF-PACKAGE-INDEX-2026-06.md`](./NSP-TEAM-HANDOFF-PACKAGE-INDEX-2026-06.md) | Handoff index |
| [`NSP-API-KEYS-HANDOVER.md`](./NSP-API-KEYS-HANDOVER.md) | Key rotation stamps (no values) |
| [`SOP/README.md`](./SOP/README.md) | **Canonical SOP index** (01–13) |
| [`SOP/10-SOC2-PREPARATION-PLAN.md`](./SOP/10-SOC2-PREPARATION-PLAN.md) | SOC 2 preparation across ecosystem |
| [`EC2-OPERATIONS-SOP.md`](./EC2-OPERATIONS-SOP.md) | Legacy EC2 runbook → prefer `SOP/01` |
| [`CURSOR-DEV-DEPLOY.md`](./CURSOR-DEV-DEPLOY.md) | Local Cursor dev + deploy |
| [`DEPLOYMENT-VERIFICATION.md`](./DEPLOYMENT-VERIFICATION.md) | Deployment verification log |

---

## Roadmap (future)

| Document | Purpose |
|---|---|
| [`Nyayavigya Documents 5.0.0-ShareReady-2026-08/11-MOAT-ROADMAP-2026-2036.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/11-MOAT-ROADMAP-2026-2036.md) | **Canonical 10-year Legal moat** (share-ready) |
| [`../roadmap-pending/PLATFORM-ROADMAP-v3.1.2.md`](../roadmap-pending/PLATFORM-ROADMAP-v3.1.2.md) | Near-term shipped/pending items (Legal items for share) |
| [`../roadmap-pending/PLATFORM-ROADMAP-2036-QUANTUM-BIO.md`](../roadmap-pending/PLATFORM-ROADMAP-2036-QUANTUM-BIO.md) | Internal speculative horizon — **not** external sell surface |
| [`../roadmap-pending/ROADMAP.md`](../roadmap-pending/ROADMAP.md) | Roadmap index |

---

## Version map (production baseline)

| Component | Version | Location |
|---|---|---|
| **Product release line** | **v5.0.0 Production** | This index + `Nyayavigya-Platform-5.0.0-PRODUCTION.md` |
| Gateway runtime | 5.0.0 | `nyayavigya-platform-312/package.json` |
| Client SDK | 5.0.0 | `packages/client-sdk/` |
| Agent registry | v5.1.0 format-b | `config/agent-registries/` |
| Console | Vite/Next hybrid | `nyayavigya-platform-312/client/` |

---

## What not to use

- **`documents/completed/`** — historical only; do not edit.
- **`attached_assets/`**, **`archive/`**, **`WIP/`**, root `all_*.txt` audit dumps — not production docs.
- **Nested `nyayavigya-platform-312/documents/working/` duplicates** — superseded; canonical copies are under root `documents/working/`.
