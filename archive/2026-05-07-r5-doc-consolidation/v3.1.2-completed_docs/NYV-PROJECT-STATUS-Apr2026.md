---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27T13:30Z
prior_last_verified: 2026-04-25
remediation_closeout: 2026-04-27
---
# Nyayavigya Platform 3.1.2 — Project Status Snapshot

**Date:** April 25, 2026 (reaffirmed 2026-04-27 post live-audit closeout)
**Platform version:** 3.1.2 (FROZEN)
**SDK version:** v6.0.0 (packages built; npm publish pending — see SDK release fixes below)
**Production GA:** May 15, 2026 (locked, T-20 days)

> **2026-04-27 closeout addendum.** A live audit + remediation against `nv-dev-edge` (EC2 `13.232.165.242` + RDS `nv-dev-edge-pg` + ElastiCache) ran on 2026-04-27. Two NSP launch blockers shipped to the running gateway: **NV-NSP-FIX-002 rev2** (content-filter rewrite — HARD list = 14 strict-prescriptive terms; SOFT list = `[legal advice]` exempted by 6 disclaimer regex; word-boundary matching) and **NV-NSP-FIX-003** (`outbound:llm` circuit-breaker `60 s → 120 s`). Live re-validation: positive `legal_research` (BNS s318, IN) → 200 OK / 2476 ms / `compliancePassed:true`; negative test (prompt forcing `guaranteed win`) → blocked with violation surfaced. RDS schema reconciled (no destructive `db:push` required), 12-script seed run completed, RAG namespaces + chunks populated, audit-chain genesis row written. Open follow-ups: bake the rev2 fixes into the canonical Docker image (FU-T010), grow IN statute corpus 305 → 500+ (FU-T004), wire orchestrate auto-write to `nv_audit_logs` (FU-T006a). Detail: [`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`](../NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md), [`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](../NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md) §7.

> **Deployment policy until GA (May 15):** the Replit→single-EC2 path
> (`pnpm deploy` → `scripts/deploy-replit-direct.sh`) is the **sole**
> CI/CD route. Bitbucket Pipelines remain archived in
> `archive/2026-04-cleanup/bitbucket/` and will not be reactivated
> pre-GA. Terraform is intentionally scoped to the **existing
> `dev-edge` single-server stack only** — no `envs/prod` apply, no
> ECS/EKS migration — until every pending item below is closed.

---

## 1. Where we are

| Track | Status | Owner | Notes |
|---|---|---|---|
| Core gateway (Node 22 + Express 5, port 5000) | ✅ Online | Platform | `bullmq-queue: redis connected for queues` + `NYV-SVC-GATEWAY online` |
| Console (React 19 + Vite 7, port 3004) | ✅ Online | Frontend | Pre-existing `@/lib/*` resolve warnings tracked, non-blocking |
| Drizzle / Postgres schema (83 tables) | ✅ Migrated | DB | Bootstrapped via `scripts/nyayavigya-one-click-bootstrap.sql` |
| Master seed (305 statutes, 23 LLMs, 502 MCP tools, **1042 agents** = 149/jurisdiction × 6 + 148 DEFAULT, v3-full-22section schema) | ✅ Loaded | Data | `scripts/nv-seed-all.ts` |
| 5 ecosystem SDK apps (NYM, NYS-PRO, NYS-INS, NYS-ACE, NYS-MIN) | ✅ Provisioned | Platform | `scripts/nv-provision-ecosystem.ts` |
| **Section 6 audit risks 5/6/7** | ✅ **Closed** | Platform-Sec | See §2 below |
| AWS dev one-click (single EC2) | ✅ Shipped | DevOps | `scripts/aws-ec2-oneclick-dev.sh` |
| Replit→EC2 deploy (`pnpm deploy`) | ✅ Sole CI/CD until GA | DevOps | `scripts/deploy-replit-direct.sh` — blue/green, health-gated, auto-rollback |
| Bitbucket CI/CD | 🗄️ Archived pre-GA | DevOps | `archive/2026-04-cleanup/bitbucket/` — reactivate post-GA only |
| **DNS / Edge (BigRock → Route53)** | ✅ **LIVE 2026-04-25** | DevOps | 11 hostnames smoke-tested green: apex, www, api, console, docs, status, pro, nym, ins, ace, min — all `/health` → 200 with valid TLS. Apex `200 from nginx/1.27.5` is the **intended AWS WAF / firewall front layer** (kept by operator decision). Existing EC2 host + IP retained. |
| AWS prod EKS (10M MAU) plan | 🟡 Deferred post-GA | DevOps | Terraform scope frozen at single-server until v3.1.2 GA |
| SDK packages (types, client-sdk, react-hooks, enterprise-sdk) | ✅ Built + packed | SDK | `dist-sdk/*.tgz` via `scripts/build-all-sdks.sh` |
| Comprehensive UAT pass | 🟡 In progress | QA | `docs/v3.1.2/superseded/NYV-SDK-UAT-COMPREHENSIVE.md` |
| Production audit (Apr 2026) | ✅ All blockers closed | Sec | `docs/v3.1.2/completed_docs/NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md` |

---

## 2. Section 6 audit closeout

Three pre-GA risks raised in the April 2026 production audit are now resolved:

### Risk 5 — Durable queues (RESOLVED)

In-process job execution replaced with **BullMQ-backed durable queues** over Redis. Five queue pairs (each with a DLQ twin) cover the production hot paths:

| Queue | Purpose | Worker | DLQ behaviour |
|---|---|---|---|
| `nyv-webhook-delivery` | Outbound webhooks | Per-attempt HMAC sign + retry | Last attempt → `nyv-webhook-delivery-dlq` |
| `nyv-doc-parse` → `nyv-doc-summarize` | Long-document chain | 30s heartbeats, soft-import pipeline | Either step's last attempt → `*-dlq` |
| `nyv-platform-relay` | Cross-platform calls | correlationId-keyed idempotency | 4xx-permanent, 429/5xx-retry |
| `nyv-pqc-sign` | PQC artefact signing | Per-platform TTL-scoped keypair cache | Last attempt → `nyv-pqc-sign-dlq` |

Files: `src/services/queue/*`. Worker boot wired in `src/index.ts` with SIGTERM drain.

### Risk 6 — `platform_id` rate-limit axis (RESOLVED)

New Redis sliding-window limiter keyed by `platform_id × tier × endpoint × identity`, configured from `config/rate-limits/rate-limits.json`. Fail-open on Redis error. Emits `X-RateLimit-{Limit,Remaining,Reset,Platform}` + `Retry-After`.

File: `src/middleware/nv-redis-platform-rate-limiter.ts`. Mounted under `/api/nv/`.

### Risk 7 — Real PQC (RESOLVED)

Auto-detect of `@open-quantum-safe/oqs-node` at boot:

* If installed → real **ML-KEM-768** (KEM), **ML-DSA-65** + **SLH-DSA** (signatures)
* If absent → deterministic simulation fallback (development only)

Adds `signArtifact` / `verifyArtifact` worker helpers, per-platform TTL-scoped keypair cache (default 24h, `NYV_PQC_KEY_TTL_MS`), and `rotatePqcKeys(scope?)` for emergency rotation.

File: `src/services/security/nv-pqc-service.ts`.

### Post-review hardening (also shipped)

* SSRF guard + `redirect: manual` + HMAC replay protection via `X-NYV-Timestamp` in webhook dispatcher
* ioredis `keepAlive: 30s` to suppress Upstash cold-flap
* Per-platform PQC keypair scoping (fixes BLOCKER raised in code review)

---

## 3. Deployment surface (this drop)

| Artefact | Path |
|---|---|
| AWS dev one-click (laptop entry) | `scripts/aws-ec2-oneclick-dev.sh` |
| In-instance bootstrap | `scripts/aws-ec2-bootstrap.sh` |
| CloudFormation IaC | `infra/aws/cloudformation-dev-ec2.yml` |
| Compose stack | `docker-compose.aws-dev.yml` |
| .env template | `deploy/.env.aws-dev.example` |
| SDK build pipeline | `scripts/build-all-sdks.sh` |
| Bitbucket CI/CD | `bitbucket-pipelines.yml` |
| Step-by-step deploy guide | `docs/NYV-AWS-DEV-EC2-DEPLOYMENT-GUIDE.md` |
| Production EKS plan (10M MAU) | `docs/NYV-AWS-ONE-CLICK-DEPLOYMENT-v5.md` |

---

## 4. Open / deferred items

| # | Item | Severity | Plan |
|---|---|---|---|
| D1 | Migrate parse → summarize chain to BullMQ Flows for parent/child durability | Medium | Post-GA |
| D2 | Consolidate 3 rate-limit middlewares into a single Lua script | Medium | Post-GA |
| D3 | Move `POSTGRES_PASSWORD` + JWT secrets to AWS Secrets Manager (dev-EC2) | Low | Operator hardening, not blocker |
| D4 | Pre-existing `client/src/pages/*` `@/lib/*` resolve warnings | Low | Frontend backlog |
| D5 | Production EKS IaC (`infra/aws/eks/`) | Medium | Pre-GA, separate task |

---

## 5. Quick links

* Audit report: `docs/v3.1.2/completed_docs/NYV-SDK-PRODUCTION-AUDIT-REPORT-Apr2026.md`
* SDK API reference: `docs/v3.1.2/superseded/NYV-SDK-v5-API-REFERENCE.md`
* SDK integration guide: `docs/v3.1.2/superseded/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md`
* UAT: `docs/v3.1.2/superseded/NYV-SDK-UAT-COMPREHENSIVE.md`
* Pending config checklist: `docs/NYV-PENDING-CONFIG-CHECKLIST.md`
* AWS dev guide (this drop): `docs/NYV-AWS-DEV-EC2-DEPLOYMENT-GUIDE.md`
