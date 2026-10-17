---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# Document Management Phase 2 — Architecture Plan

**Date**: 2026-05-06
**Author**: Replit Agent (study phase, awaiting user approval before code)
**Supersedes**: Phase 2 placeholder in `DOCUMENT-MANAGEMENT-AUDIT-AND-PLAN-2026-05-06.md`
**Triggered by**: User mandate "first-time-right + extreme care + study-before-change"

This document answers your 5 architectural queries with diagrams, audits the
dashboard "end-to-end" status you asked about, lists every SDK/API doc that
needs to be refreshed after the Phase 1 changes, and presents a phased
implementation plan with effort estimates per item. **Nothing in here is
implemented yet — this is the gate before code.**

---

## §0 — Dashboard end-to-end status check (your precondition)

You said: *"start implementing [Phase 2] **if** we finished the end to end pending tasks of the dashboard completely"*. Honest answer:

| Phase (from `NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`) | Status |
|---|---|
| Phase A — duplicate file deletions, route dedup | ✅ DONE (last session) |
| Phase B — Sidebar v2 single-source-of-truth + RBAC | ✅ DONE (last session, `NyvSidebar.tsx`) |
| Phase C — 11 NEW functional pages | ⚠ **PARTIAL** — sidebar links exist, but `Document AI Hub`, `OCR & Extraction`, `Summarization`, `RAG/KB`, `Statutes & Citations`, `Jurisdiction Mapping`, `Web Scraping Targets`, `DPDPA Compliance`, `Smoke Harness Console` need verification — at least some are stubs/501 |
| Phase D — Command Centre as Mission Control | ⚠ PARTIAL (page exists, KPI wiring not fully verified) |
| Phase E — Schema docs + 10M-readiness doc | ✅ DONE (last session) |
| Phase F — version bump + CHANGELOG | ✅ DONE |
| Phase G — typecheck, build, smoke 101/101, screenshots, e2e Playwright | ❌ NOT DONE — Phase G verification gate has never run end-to-end |

**Honest recommendation**: do **Phase G verification first** (1 session) before
opening Phase 2. Phase G will surface which Phase C pages are real vs stubs
and give you a real "100% green" baseline. If Phase G uncovers regressions,
those go to top of the queue. Only then start Phase 2 doc-mgmt work. **I will
not silently skip Phase G to look productive.**

If you answer **"do Phase G first"** — I run smoke, typecheck, build, e2e,
screenshots, and report a real pass/fail matrix in one session before
touching Phase 2.

If you answer **"skip Phase G, start Phase 2 now"** — I proceed; Phase G
becomes a follow-up. State your call explicitly.

---

## §1 — SDK / API docs that must update after Phase 1 (independent of Phase 2)

Phase 1 changed live behavior — the docs below are now stale and will
mislead SDK users. This is purely documentation work, no risk, can ship in
parallel with anything else.

| Doc | What's stale | What to add |
|---|---|---|
| `docs/v3.1.2/SDK-PLATFORM-NYAYAMITRA.md` | scope list missing `documents:read/write`, `translate:write` | new B2 scopes + curl examples |
| `docs/v3.1.2/SDK-PLATFORM-NSP-WEB.md` | mentions 100 MB cap | now 1024 MB ceiling, per-tier caps table |
| `docs/v3.1.2/SDK-PLATFORM-NSP-MOBILE.md` | same as NSP-WEB | same |
| `docs/v3.1.2/SDK-PLATFORM-NSI.md` | no documents-write call examples | yes |
| `docs/v3.1.2/SDK-PLATFORM-JRX.md` | no eSign endpoint mentioned | document `nv_esign_sessions` + adapter usage |
| `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-05.md` | scope matrix table is stale for NYM/NSA | regenerate scope matrix; bump filename to `2026-05-06.md`, supersede the 05-05 file via INDEX.md |
| `docs/v3.1.2/NYV-SDK-API-INTEGRATION-GUIDE-2026-05-04.md` | no eSign integration walkthrough; no platform_code mention | add §"E-Signature Integration" + §"Multi-Platform Document Segregation (`platform_code`)" |
| **NEW** `docs/v5.0.0/SDK-PLATFORM-NSA.md` | doesn't exist (NSA is the only platform without a SDK doc) | create from NYM template; document new `translate:write` scope |
| `replit.md` "Where things live" pointers | last-session changes not pointed to | already updated last session ✓ |

**Effort: 0.5 day for all 9 doc updates. Recommend doing these in the same
session as Phase G verification — they'll catch each other's mistakes.**

---

## §2 — Q1: Multi-backend storage configuration (your query 1)

**Status**: 80% already built. The 1011-line `nyv-document-storage-service.ts`
already has 4 adapters: `LocalStorageAdapter`, `ReplitObjectStorageAdapter`,
`S3StorageAdapter`, GCS adapter (stub). What's missing is **deployment-time
configuration discoverability** — operators don't know where the knobs are.

### Proposed: `config/document-storage-deployment.yaml`

A single human-editable YAML file read at boot, with strict precedence:
**env vars > YAML file > built-in defaults.** Operators edit ONE file
during deployment to point the platform at the right vault, regardless of
backend.

```yaml
# config/document-storage-deployment.yaml — v1
backend: s3                         # s3 | gcs | replit | local | hybrid
vault:
  primary:
    backend: s3
    bucket: nyv-documents-prod-aps1
    region: ap-south-1
    endpoint: ~                     # custom endpoint for MinIO/R2 (S3-compat)
    forcePathStyle: false
    sse: AES256                     # at-rest encryption
  archive:                          # optional cold-storage tier
    backend: s3
    bucket: nyv-documents-archive
    storageClass: GLACIER_IR
    moveAfterDays: 90
  fallback:                         # used if primary unreachable mid-request
    backend: local
    rootDir: /var/nyv/documents
limits:
  maxFileSizeMb: 1024
  maxBatchSizeMb: 2048
  perTier:
    nys-academy:    10
    nyayamitra:     25
    nys-professional: 100
    nys-institutional: 500
    nys-ministry: 1024
multipart:
  enabled: true
  partSizeMb: 50
  threshold: 100                    # files > 100 MB use multipart
encryption:
  atRest: true                      # KMS / SSE per backend
  inTransit: true
  customerManagedKey: ~             # optional KMS key ARN
audit:
  logEveryUpload: true
  logEveryDownload: true
  retainAuditDays: 2555             # 7 years (legal default)
```

### Diagram: deployment-time backend selection

```
        ┌──────────────────────────────────────────────────┐
        │  Operator deploys NYV (EC2 / Replit / on-prem)   │
        └────────────────┬─────────────────────────────────┘
                         │ edits ONE file
                         ▼
        ┌──────────────────────────────────────────────────┐
        │  config/document-storage-deployment.yaml         │
        │   backend: s3 | gcs | replit | local | hybrid    │
        └────────────────┬─────────────────────────────────┘
                         │ loaded at boot by
                         ▼
        ┌──────────────────────────────────────────────────┐
        │  src/config/nyv-master-config.ts (NYV_STORAGE)   │
        │   merges YAML + env vars + defaults              │
        └────────────────┬─────────────────────────────────┘
                         │ injected into
                         ▼
        ┌──────────────────────────────────────────────────┐
        │  NyvDocumentStorageService                       │
        │  (selects adapter at runtime — already exists)   │
        └────────────────┬─────────────────────────────────┘
                         │
        ┌────────────────┴────────────────────────────────┐
        │       │              │             │            │
        ▼       ▼              ▼             ▼            ▼
   LocalAdpt  ReplitAdpt    S3Adapter    GCSAdapter   HybridAdpt(NEW)
                                                       primary→s3
                                                       fallback→local
```

**What I will build**:
1. The YAML file + `src/config/nyv-doc-storage-config-loader.ts` (parses YAML, validates with Zod, exports merged config).
2. New `HybridStorageAdapter` (writes to primary, falls back to local on failure, retries primary async).
3. Complete the GCS adapter stub (real `@google-cloud/storage` calls).
4. `scripts/nv-storage-validate.ts` — boot-time sanity check that the configured backend is actually reachable (run this at gateway start, fail-fast if not).
5. Document at `docs/v5.0.0/STORAGE-DEPLOYMENT-GUIDE.md` — one page per backend with the exact env vars + IAM policy + bucket policy needed.

**Effort: 1.5 days. Risk: low (additive, no breaking changes to existing adapter API).**

---

## §3 — Q2: Full DMS configuration file (your query 2)

You want a single config file that mirrors how `agent-config.ts` and
`llm-config.ts` work — defaults + per-org overrides — for every DMS knob.

### Proposed: `src/config/nyv-dms-config.ts` + per-org DB overrides

```ts
// src/config/nyv-dms-config.ts (defaults — code-controlled)
export const NYV_DMS_DEFAULTS = {
  upload: {
    maxFileSizeMb: 1024,
    maxBatchSizeMb: 2048,
    multipartThresholdMb: 100,
    allowedMimeTypes: [...],         // expanded list, includes audio/video for evidence
    blockedMimeTypes: ['application/x-msdownload', ...],
    requireMagicByteValidation: true,
    requireMalwareScan: true,        // off until D4 (ClamAV) ships
  },
  storage: {
    encryption: 'at-rest+in-transit',
    perOrgQuotaGb: 100,              // soft cap
    perOrgHardCapGb: 500,
    archiveAfterDays: 90,            // cold-tier move
    deleteAfterDays: null,           // never auto-delete (G5)
  },
  processing: {
    ocrEnabled: true,
    parsingTimeoutMs: 300_000,
    embeddingsEnabled: true,
    chunkSize: 512,
    chunkOverlap: 64,
    autoExtractEntities: true,
    autoExtractObligations: true,
    autoExtractRisks: true,
    autoSummarize: false,
  },
  retention: {                       // G5 = no enforcement now, but config exists
    enforceRetention: false,
    defaultRetentionDays: 2555,      // 7y legal default
    deletedRetentionDays: 30,        // tombstone window
  },
  access: {
    signedUrlTtlSec: 900,            // 15 min
    enableCrossOrgSharing: false,    // Q4 — false by default
    requireMfaForDownload: false,
  },
  esign: {
    defaultProvider: 'nyv-docusign',
    sessionTtlDays: 7,
    requireDscForContracts: true,
    requireAadhaarForFilings: true,  // jurisdiction=IN
  },
  audit: {
    logUploads: true,
    logDownloads: true,
    logSharing: true,
    logHashChainEvery: 'operation',  // 'operation' | 'batch' | 'daily'
  },
  rateLimits: {
    uploadsPerMinute: 60,
    downloadsPerMinute: 600,
    bulkExportPerHour: 5,
  },
};

// Per-org overrides live in DB: nv_org_dms_overrides (jsonb)
// Resolved order: org override > variant default > NYV_DMS_DEFAULTS
```

### Diagram: config resolution at request time

```
          SDK request hits gateway with X-API-Key
                          │
                          ▼
          ┌────────────────────────────────────┐
          │ Resolve org_id + variant from key   │
          └────────────────┬───────────────────┘
                           │
                           ▼
          ┌────────────────────────────────────┐
          │ Fetch nv_org_dms_overrides[org_id]  │ ◄─── DB
          │ (cached 60s in Redis)               │
          └────────────────┬───────────────────┘
                           │
                           ▼
          ┌────────────────────────────────────┐
          │ Merge: org_override                 │
          │      ▶ variant_defaults             │
          │      ▶ NYV_DMS_DEFAULTS             │
          └────────────────┬───────────────────┘
                           │
                           ▼
                effective DMS config injected
                into the request context
```

**New schema** (single table, no migration drama):
```sql
CREATE TABLE nv_org_dms_overrides (
  org_id      INTEGER PRIMARY KEY,
  overrides   JSONB NOT NULL DEFAULT '{}',
  updated_by  VARCHAR(100),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**What I will build**:
1. `src/config/nyv-dms-config.ts` (defaults + Zod schema for overrides).
2. `nv_org_dms_overrides` table + Drizzle export + migration.
3. `nv-dms-config-resolver.ts` service (Redis-cached merge).
4. Wire into `nv-sdk-gateway` middleware as `req.ctx.dmsConfig`.
5. Console UI page `/admin/dms-config` — read-only first, write later.
6. Doc at `docs/v5.0.0/DMS-CONFIG-REFERENCE.md` — every knob, default,
   override scope, security implication.

**Effort: 1 day. Risk: low (additive table, defaults preserve current behavior).**

---

## §4 — Q3: Background jobs for large file processing (your query 3)

**Current state**: `ns_doc_processing_jobs` table EXISTS already with the
right shape (status, priority, retry_count, worker_id, progress, result
jsonb). What's missing is the **worker daemon** that drains it. Right now
processing is synchronous inside the HTTP request — fails at 30s gateway
timeout for large PDFs.

### Proposed architecture: BullMQ + Redis + dedicated workers

```
┌─────────────────────────────────────────────────────────────────────┐
│                      UPLOAD PATH (large file)                        │
└─────────────────────────────────────────────────────────────────────┘

   SDK Client                Gateway              Storage           Queue            Worker Pool
       │                        │                    │                │                  │
       │  POST /docs/upload     │                    │                │                  │
       │ ─────────────────────► │                    │                │                  │
       │                        │ stream to backend  │                │                  │
       │                        │ ─────────────────► │                │                  │
       │                        │ ◄───────────────── │                │                  │
       │                        │  storage_path      │                │                  │
       │                        │  insert job (status=queued)         │                  │
       │                        │ ──────────────────────────────────► │                  │
       │                        │  enqueue BullMQ job                 │                  │
       │                        │ ──────────────────────────────────► │                  │
       │  202 + job_id          │                                     │                  │
       │ ◄───────────────────── │                                     │                  │
       │                        │                                     │  pull job        │
       │                        │                                     │ ───────────────► │
       │                        │                                     │                  │ process:
       │                        │                                     │                  │  - download
       │                        │                                     │                  │  - parse/OCR
       │                        │                                     │                  │  - extract
       │                        │                                     │                  │  - embed
       │                        │                                     │                  │  - hash chain
       │                        │                                     │  update progress │
       │                        │                                     │ ◄─────────────── │
       │                        │                                     │  completed       │
       │                        │                                     │ ◄─────────────── │
       │  GET /docs/jobs/{id}   │                                     │                  │
       │ ─────────────────────► │ read from ns_doc_processing_jobs    │                  │
       │  {status, progress, result}                                  │                  │
       │ ◄───────────────────── │                                                        │
       │                        │                                                        │
       │  Optional webhook on completion                                                 │
       │ ◄────────────────────────────────────────────────────────────────────────────── │
```

### Why BullMQ
- Already use Redis (`NYV_REDIS_URL`) — no new infra.
- Built-in retries with exponential backoff (matches `retry_count`/`max_retries` columns we already have).
- Job priority (matches `priority` column).
- Progress reporting (matches `progress` column).
- Graceful shutdown / job re-queue on worker crash.
- Battle-tested, MIT-licensed, 5M+ weekly downloads.

### Worker process model

- Workers run in a **separate Node process** (not in gateway) — `pm2 start nv-worker.js -i 2` on EC2 (2 workers per CPU). On Replit dev: `npm run dev:worker`.
- Workers share `db`, `nyvDocumentStorageService`, `nyvDocumentParsingService`, `nyvEmbeddingsService` with the gateway.
- Each worker writes progress to `ns_doc_processing_jobs.progress` so the SDK can poll `GET /docs/jobs/{id}`.
- On completion: optional webhook fires to SDK app's `webhook_url` if configured.
- On failure after `max_retries`: job moves to `failed` status, error captured in `error` text column, optional alert webhook fires.

### Failure modes covered
| Scenario | Behavior |
|---|---|
| Worker crashes mid-job | BullMQ stalled-job detector re-queues after 30s |
| Storage backend unreachable | Hybrid adapter falls back to local; worker retries primary in background |
| OCR/parsing exception | retry_count++; back off 1m / 5m / 30m; move to `failed` after 3 |
| HTTP request fails for SDK upload | SDK's built-in retry (with `Idempotency-Key` header — see §6) — we dedupe on doc_id+sha256 |
| Gateway restarts mid-upload | Streaming upload writes directly to backend before responding 202 — no in-flight RAM state to lose |

**What I will build**:
1. Add `bullmq` + `@bull-board/express` (admin UI) to `package.json`.
2. New file `src/workers/nv-doc-processing-worker.ts` — BullMQ Worker subscriber, processes jobs from `nv:doc-processing` queue.
3. Refactor `nv-sdk-doc-pipeline-routes.ts` upload route to: write to storage, insert `ns_doc_processing_jobs` row, enqueue BullMQ job, return 202 + job_id (current sync path stays available behind feature flag for backward-compat).
4. New script `scripts/nv-start-worker.sh` (mirrors `nv-start-dev.sh`).
5. Admin UI mount at `/admin/queues` (Bull Board) — RBAC: super_admin only.
6. Webhook on completion: reuse existing `sdk_webhooks` table.
7. SDK helper: `nyvSdk.documents.uploadAndWait(file)` polls `/docs/jobs/{id}` with exp backoff.

**Effort: 2 days. Risk: medium (new process, but additive — sync path still works).**

---

## §5 — Q4: Cross-platform shared documents + AI processing at scale (your query 4)

Use case: NSP firm uploads a brief; NSI in-house counsel of the same client
needs to read it; both invoke AI agents on it.

### Proposed: explicit share-grants + document-scoped RBAC

```
┌─────────────────────────────────────────────────────────────────────────┐
│   Document upload flow (NSP)         Document AI access (NSI)            │
└─────────────────────────────────────────────────────────────────────────┘

   NSP Lawyer                    NSI Counsel
       │                              │
       │ uploads brief.pdf            │
       ▼                              │
   ns_parsed_documents                │
   (org_id=42, platform=nsp,          │
    owner_user_id=L7,                 │
    platform_code=nsp)                │
       │                              │
       │ NSP creates share-grant      │
       ▼                              │
   nv_doc_share_grants                │
   (doc_id=D9, granter_org=42,        │
    grantee_org=99, grantee_platform=nsi,
    permissions=[read,annotate,ai-analyze],
    expires_at=...)                   │
                                      │
                                      │ NSI requests AI analysis on D9
                                      ▼
                          ┌─────────────────────────────┐
                          │ Gateway middleware:         │
                          │ 1. Resolve key → org=99,    │
                          │    platform=nsi             │
                          │ 2. Doc D9 owned by org=42   │
                          │ 3. Check nv_doc_share_grants│
                          │    for (D9, grantee=99)     │
                          │ 4. Permission includes      │
                          │    ai-analyze? ✓            │
                          │ 5. Inject ephemeral access  │
                          │    token into agent context │
                          └──────────────┬──────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │ Agent execution (LRM + SLM):│
                          │ - Reads D9 via signed URL   │
                          │ - Tags every artifact with  │
                          │   source=org=42 + caller=99 │
                          │ - PII vault uses owner-org  │
                          │   redaction rules           │
                          │ - Audit chain entry:        │
                          │   {actor:99, owner:42,      │
                          │    doc:D9, action:analyze}  │
                          └─────────────────────────────┘
```

### New table

```sql
CREATE TABLE nv_doc_share_grants (
  id              SERIAL PRIMARY KEY,
  document_id     VARCHAR(36) NOT NULL,
  granter_org_id  INTEGER NOT NULL,
  grantee_org_id  INTEGER NOT NULL,
  grantee_platform_code VARCHAR(20),
  permissions     JSONB NOT NULL DEFAULT '[]',
                  -- ['read','download','annotate','ai-analyze','share','sign']
  granted_by      VARCHAR(100),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  audit_meta      JSONB DEFAULT '{}'
);
CREATE INDEX nv_doc_share_doc_idx ON nv_doc_share_grants (document_id);
CREATE INDEX nv_doc_share_grantee_idx ON nv_doc_share_grants (grantee_org_id, document_id);
```

### Scale considerations (10M users)

- `nv_doc_share_grants` is small relative to documents (~5% of doc count typically).
- Permission check is one indexed lookup per request → adds ~2ms.
- AI agents called on shared docs run **with the grantee's LLM budget**, not the granter's — billed per `nv_org_usage` against `grantee_org_id`.
- PII redaction happens at the **owner org's** policy — protects upstream sensitive data even when downstream org consumes.
- All downstream artifacts (summaries, embeddings) get `derived_from_doc_id` + `derived_for_org_id` columns so revocation cascades on grant revoke.
- Hash chain entry tags actor + owner so audit replay can reconstruct who saw what when.

**What I will build**:
1. `nv_doc_share_grants` table + Drizzle export.
2. `src/services/document-pipeline/nv-doc-share-service.ts` — grant, revoke, list, check.
3. New routes `/api/nv/sdk/v5/documents/{id}/shares` (POST grant, DELETE revoke, GET list).
4. Middleware update: when a doc request's `org_id != document.org_id`, look up share grant; if absent → 403.
5. `derived_from_doc_id` columns on `ns_rag_document_chunks`, summaries table, etc.
6. Console UI: per-document "Shared with" panel + revoke button.
7. Audit chain payload extended with `actor_org_id` (separate from `owner_org_id`).
8. Doc at `docs/v5.0.0/CROSS-PLATFORM-SHARING-DESIGN.md`.

**Effort: 2 days. Risk: medium (cross-cutting RBAC change, needs careful testing).**

---

## §6 — Q5: Replit-deploy → EC2-migrate testing path (your query 5)

You want to deploy on Replit FIRST for full functional testing (UI/UX,
RBAC, document flows, RAG, Redis) — then migrate clean to EC2 with all
data carried over. Here's the plan.

### Replit deployment (Stage 1 — testing)

```
┌────────────────────────────────────────────────────────────────────┐
│           REPLIT DEPLOYMENT — Stage 1 (functional testing)          │
└────────────────────────────────────────────────────────────────────┘

   Replit Reserved-VM Deployment
   ├── Gateway process (port 5000)
   ├── Worker process (BullMQ subscriber)        ← new (Q3)
   ├── Console (Next.js, port 3000)
   │
   ├── PostgreSQL: Replit's managed PG (or Neon)
   │   Schema: nv_schema + public (full prod-shape)
   │
   ├── Redis: Replit-provided or Upstash free tier
   │   Used for: cache, BullMQ queue, rate-limit state
   │
   └── Document Storage: NYV_STORAGE_BACKEND=replit
       (Replit Object Storage — already wired)

   What works identically to EC2:
   ✓ All 7 SDK platforms with their real keys
   ✓ Full RAG pipeline (pgvector via Neon or replit-managed)
   ✓ Background workers for large files
   ✓ E-sign sessions persisted
   ✓ Cross-org sharing
   ✓ Audit hash chain
   ✓ Per-org DMS overrides

   What's LIMITED on Replit (transparent):
   ⚠ Single VM (no horizontal scale) — fine for testing
   ⚠ Disk-backed temp storage (32GB Reserved-VM) — fine for ≤500 MB files
   ⚠ No cold-tier S3 archive — set archiveAfterDays: null
   ⚠ Bandwidth caps — load tests > 1 GB/min should run on EC2
```

### EC2 deployment (Stage 2 — production)

```
┌────────────────────────────────────────────────────────────────────┐
│              EC2 DEPLOYMENT — Stage 2 (production)                  │
└────────────────────────────────────────────────────────────────────┘

   EC2 Auto-Scaling Group (ap-south-1)
   ├── ALB → Gateway tasks (2-10 replicas)
   ├── Worker tasks (2-8 replicas, separate ASG)
   ├── Console behind same ALB
   │
   ├── RDS PostgreSQL 16.6 (Multi-AZ)
   ├── ElastiCache Redis 7.1 (cluster-mode)
   └── S3 buckets:
       - nyv-documents-prod-aps1 (hot)
       - nyv-documents-archive-aps1 (Glacier IR, age > 90d)
```

### Migration path (Replit → EC2, clean fresh deploy)

```
                  REPLIT (test env)                     EC2 (production)
              ┌──────────────────────┐              ┌──────────────────────┐
              │ PostgreSQL (Neon/RPL)│              │ RDS Multi-AZ         │
              │ Redis                │              │ ElastiCache          │
              │ Replit Object Store  │              │ S3 + Glacier         │
              └──────────┬───────────┘              └──────────▲───────────┘
                         │                                     │
                         │  scripts/migrate-to-ec2/            │
                         │  (NEW — we will build)              │
                         │                                     │
              ┌──────────▼───────────┐              ┌──────────┴───────────┐
              │ 1. pg_dump --no-owner│  ───────────►│ psql restore         │
              │    --schema-only     │   (schema)   │                      │
              │ 2. pg_dump --data-only ─────────────►│ psql restore         │
              │    (with --jobs=4)   │   (data)     │                      │
              │ 3. RDB snapshot      │  ───────────►│ ElastiCache restore  │
              │    of Redis          │   (cache)    │ (or skip — warm up)  │
              │ 4. boto3 sync        │  ───────────►│ S3 bucket            │
              │    Replit Obj Store  │  (objects)   │                      │
              │ 5. Smoke test EC2    │              │ Run nv-smoke-bash.sh │
              │ 6. Flip DNS          │              │                      │
              │ 7. Decommission RPL  │              │                      │
              └──────────────────────┘              └──────────────────────┘
```

### Migration tooling we need to build

| Script | Purpose | Effort |
|---|---|---|
| `scripts/migrate-to-ec2/01-dump-pg.sh` | pg_dump schema + data with --jobs parallel | 0.25d |
| `scripts/migrate-to-ec2/02-restore-pg.sh` | restore on RDS, with FK/index re-enable order | 0.25d |
| `scripts/migrate-to-ec2/03-sync-objects.py` | rclone or boto3 sync Replit Object Store → S3 | 0.5d |
| `scripts/migrate-to-ec2/04-validate.sh` | row counts match, SHA-256 of N random objects, smoke 101/101 | 0.25d |
| `scripts/migrate-to-ec2/05-cutover.sh` | DNS flip + Replit decommission | 0.25d |
| `docs/v5.0.0/REPLIT-TO-EC2-MIGRATION-RUNBOOK.md` | full step-by-step playbook | 0.5d |

**Effort: 2 days total for full migration tooling + runbook.**

### Replit deployment config we need

| File | Change |
|---|---|
| `.replit` | Add `[deployment]` section: `run = ["bash", "scripts/nv-start-prod.sh"]`, deploymentTarget = "vm", machinePowerProfile = "performance" |
| **NEW** `scripts/nv-start-prod.sh` | Starts gateway + worker + console concurrently with proper signal handling |
| **NEW** `scripts/nv-start-worker.sh` | Standalone worker process |
| `.replit` workflow | Add `NYV Worker` workflow for dev parity |
| `replit.md` | Document the deployment story |

**Effort: 0.5 day.**

---

## §7 — Phased implementation plan with effort estimates

### Pre-Phase-2: Verification + docs (RECOMMENDED FIRST)

| Step | Effort | Risk |
|---|---|---|
| Phase G dashboard verification (typecheck, build, smoke 101/101, e2e Playwright, screenshots) | 0.75d | Low |
| Update 9 SDK/API docs (§1) | 0.5d | None |
| **Total** | **~1 day** | |

### Phase 2A: Foundations (config + storage + jobs)

| Step | Maps to | Effort | Risk |
|---|---|---|---|
| Multi-backend storage YAML config + loader + hybrid adapter + GCS completion + validate script | Q1 | 1.5d | Low |
| `nyv-dms-config.ts` + `nv_org_dms_overrides` table + resolver + console page | Q2 | 1d | Low |
| BullMQ + worker process + async upload route + Bull Board admin UI | Q3 | 2d | Med |
| **Total** | | **~4.5 days** | |

### Phase 2B: Cross-platform sharing + AI scale

| Step | Maps to | Effort | Risk |
|---|---|---|---|
| `nv_doc_share_grants` table + service + routes + middleware | Q4 | 1d | Med |
| Audit chain extension (actor_org separate from owner_org) | Q4 | 0.5d | Med |
| Console "Shared with" UI panel | Q4 | 0.5d | Low |
| **Total** | | **~2 days** | |

### Phase 2C: Replit deployment + EC2 migration tooling

| Step | Maps to | Effort | Risk |
|---|---|---|---|
| `.replit` deployment config + start-prod.sh + worker workflow | Q5 | 0.5d | Low |
| 5 migration scripts + validate + runbook | Q5 | 2d | Med |
| **Total** | | **~2.5 days** | |

### Phase 2D: Carry-over from Phase 1 deferrals

| Step | Maps to | Effort | Risk |
|---|---|---|---|
| D3 — `@nyayavigya/sdk` npm package + `@nyayavigya/documents-sdk` | original D3 | 1.5d | Med |
| D4 — ClamAV daemon + magic-byte validation middleware | original D4 | 0.5d | Low (infra) |
| D5 — Streamed multipart multer (closes 1 GB RAM risk) | original D5 | 1d | Med |
| D6 — Presigned PUT for direct-to-S3 uploads | original D6 | 0.5d | Low |
| NYVDocuSign provider impl (Aadhaar eSign + DSC) | G2 | 1d | Med |
| **Total** | | **~4.5 days** | |

### **Grand total: ~14 working days** for everything in this doc.

---

## §8 — Suggested execution order (your decision)

Three honest options. Pick one.

### Option A — "Ship safest path to EC2" (recommended)
1. Pre-Phase-2 verification + doc refresh (1 day)
2. Phase 2A foundations (4.5 days)
3. Phase 2C Replit deployment + migration (2.5 days)
4. Deploy to Replit, full functional test
5. Phase 2D deferrals (4.5 days)
6. Phase 2B cross-platform sharing (2 days)
7. Migrate to EC2

**Total ~14 days, lowest risk, deploys to Replit twice (mid + end).**

### Option B — "Big-bang feature complete then deploy"
1. Pre-Phase-2 (1 day)
2. ALL Phase 2A+B+C+D in any order (13 days)
3. Single deployment to Replit, then EC2

**Total ~14 days, more total work in flight at once, harder to roll back single mistakes.**

### Option C — "Quick deploy to Replit, iterate"
1. Pre-Phase-2 (1 day)
2. Phase 2C deployment config only (0.5 day)
3. Deploy current state to Replit immediately
4. Phase 2A foundations (4.5 days), redeploy
5. Phase 2B sharing (2 days), redeploy
6. Phase 2D deferrals (4.5 days), redeploy
7. EC2 migration

**Total ~13 days, fastest to "live test environment" but each redeploy has risk.**

---

## §9 — What I need from you to start

Three explicit yes/no answers:

1. **Phase G first, then Phase 2?** (recommended) → YES / NO
2. **Which option (A / B / C) for execution order?** → A / B / C
3. **Any item in §7 you want me to defer or drop entirely?** (e.g. "skip the Glacier archive tier", "skip Bull Board admin UI") → list them or "none, do everything"

When I have those three answers, I start coding the first item of the
chosen plan. Until then, no code touches the repo.

---

## §10 — Decisions LOCKED (2026-05-06, user mandate)

The 4 open Phase 2A decisions from §9 are now answered and locked:

### D1. Storage backend (Stage 1)
**LOCKED**: Build BOTH adapters (Replit Object Storage + AWS S3) behind a single
`StorageBackend` interface. Selection driven by
`config/document-storage-deployment.yaml → backend.active`.
- **Stage 1 (current, Replit testing)**: `active: replit-object-storage`
- **Stage 2 (EC2 production)**: flip to `active: s3` via config-only change, no code edit
- **Acceptance**: contract tests must pass identically against both adapters
  (put / get / delete / presign / list with same checksum + size assertions)

### D2. OCR queue concurrency
**LOCKED**: Default to 4 workers × 2 jobs/worker = 8 concurrent OCR jobs, but
**make every queue parameter configurable** via env + `nyv-dms-config.ts`:
- `NYV_OCR_WORKER_COUNT` (default 4)
- `NYV_OCR_JOBS_PER_WORKER` (default 2)
- `NYV_OCR_JOB_TIMEOUT_MS` (default 600000 = 10 min)
- `NYV_OCR_RETRY_ATTEMPTS` (default 3)
- Same pattern for `EMBEDDING_*`, `CHUNKING_*`, `AV_SCAN_*` queues

### D3. Cross-platform document sharing
**LOCKED**: Sharing is **platform-mediated by Nyayavigya**, not direct
peer-to-peer between platforms. Specifically:
- Default: documents are owned by the uploading platform (NSP, NYM, NSI, etc.)
  and NOT auto-shared
- When sharing is needed: the document is moved to (or referenced from) a
  central **Nyayavigya-owned storage bucket** (`nyv-shared-documents`), and
  Nyayavigya issues per-platform read grants via `nv_doc_share_grants`
- Large-document case: Nyayavigya orchestration grants ecosystem-wide read
  access (NSP + NSI + NYM + NSM + NSPM + JRX) for documents above a configured
  threshold (e.g. > 50 MB), eliminating per-platform duplication
- Audit chain records the share-grant issuance + every cross-platform read

### D4. EC2 cutover
**LOCKED**: **Defer entirely**. Application is not live. Sequence is:
  1. Complete end-to-end DMS in Replit (this Phase 2A–2B)
  2. Test entire platform: DMS + dashboards + SDK + API + background jobs
  3. ONLY THEN plan Replit-deploy + EC2-deploy (Phase 2C re-scoped)
- No blue/green, no DNS swap, no maintenance page concerns until step 3

---

## §11 — Revised Execution Sequence (post-decisions)

| Step | Item | Effort | Blocker for |
|---|---|---|---|
| **S1** | Storage abstraction: `StorageBackend` interface + Replit Object Storage adapter + S3 adapter + YAML config + contract tests | 2.5d | S2, S3 |
| **S2** | `nyv-dms-config.ts` with all OCR/embedding/AV queue params configurable + env wiring | 0.5d | S3 |
| **S3** | BullMQ + Redis worker process: OCR, chunking, embedding, AV pipeline | 2d | S5 |
| **S4** | D5/D6 streamed multipart upload + presigned PUT (uses S1 adapters) | 1.5d | S5 |
| **S5** | `nv_doc_share_grants` table + Nyayavigya-mediated sharing service + 50 MB threshold rule | 2d | S7 |
| **S6** | D9 webhook subscriptions + D11 retention/TTL policy + D7 endpoint dedup | 2d | S7 |
| **S7** | E2E test: upload via SDK → BullMQ job → OCR → chunk → embed → GraphRAG index → cross-platform share → e-Sign session, run on all 7 platforms | 1.5d | Done |
| **S8** | T001 carry-over: delete `realtime-dashboard.tsx` (rewrite 3 outbound consumers) | 0.5d | parallel |
| **S9** | D3 `@nyayavigya/sdk` npm package | 1.5d | parallel |

**Total**: ~14 working days. Steps S1→S2→S3→S4→S5→S6→S7 are sequential. S8 + S9 run parallel.

EC2/Replit deployment planning (former Phase 2C) is **explicitly out of scope** until S7 is GREEN.
