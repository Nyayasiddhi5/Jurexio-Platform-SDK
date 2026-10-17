# Nyayavigya Platform 3.1.2 — Master Integration & Operations Guide

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Date:** 2026-05-04 | **Platform:** v3.1.2 | **SDK:** v5.0.0 | **Status:** Dev-edge LIVE  
**Gateway:** `https://api.nyayasiddhi.online` (ALB → EC2 `i-0df71e5ea1df8f588` / `13.232.165.242`)  
**Deploy ID:** `2026-05-02T0946Z-replit-ssm-a558dbab`

> This is the single operator-facing document that answers the 6 questions:
> 1. Where to download SDK v5.0.0
> 2. How to integrate per platform
> 3. Keys and auth requirements per platform
> 4. S3 storage allocation per platform
> 5. How Replit changes reach AWS (and current Replit vs AWS status)
> 6. Full technical specification — code structure, where to edit what

---

## Table of Contents

1. [SDK v5.0.0 Download Paths](#1-sdk-v500-download-paths)
2. [Per-Platform Integration Summary](#2-per-platform-integration-summary)
3. [Keys, Auth & Requirements per Platform](#3-keys-auth--requirements-per-platform)
4. [S3 Storage Allocation per Platform](#4-s3-storage-allocation-per-platform)
5. [Replit → AWS Deployment Flow & Current Status](#5-replit--aws-deployment-flow--current-status)
6. [Technical Specification — Code Structure & Edit Guide](#6-technical-specification--code-structure--edit-guide)

---

## 1. SDK v5.0.0 Download Paths

### 1.1 Where are the SDK packages?

All 6 SDK packages are published as `.tgz` tarballs on S3:

| Package | S3 Path | Size | Purpose |
|---|---|---|---|
| `client-sdk` | `s3://nyayavigya-sdk-devapp/sdk/client-sdk/5.0.0.tgz` | 43 KB | Core TypeScript client — browser + Node.js |
| `client-sdk-react-native` | `s3://nyayavigya-sdk-devapp/sdk/client-sdk-react-native/5.0.0.tgz` | 20 KB | React Native wrapper for mobile apps |
| `nyayamitra-sdk` | `s3://nyayavigya-sdk-devapp/sdk/nyayamitra-sdk/5.0.0.tgz` | 22 KB | Nyayamitra citizen-tier client |
| `enterprise-sdk` | `s3://nyayavigya-sdk-devapp/sdk/enterprise-sdk/5.0.0.tgz` | 7 KB | Enterprise-tier client (NSI/JRX) |
| `react-hooks` | `s3://nyayavigya-sdk-devapp/sdk/react-hooks/5.0.0.tgz` | 18 KB | React hooks (`useNyv`, `useAgent`, etc.) |
| `types` | `s3://nyayavigya-sdk-devapp/sdk/types/5.0.0.tgz` | 13 KB | Shared TypeScript type definitions |

**Manifest:** `s3://nyayavigya-sdk-devapp/sdk/manifest.json`

### 1.2 How to download

**Option A — Direct S3 (operator, with AWS credentials):**
```bash
aws s3 cp s3://nyayavigya-sdk-devapp/sdk/client-sdk/5.0.0.tgz ./client-sdk-5.0.0.tgz --region ap-south-1
```

**Option B — Gateway download endpoint (consumer, SDK-key authed):**
```
GET https://api.nyayasiddhi.online/downloads/sdk/client-sdk/5.0.0.tgz
Header: X-API-Key: <your_sdk_api_key>
```
The gateway generates a short-lived S3 presigned URL and redirects.
Auth is required — this endpoint validates the SDK key against `sdk_app_api_keys` in the database.

**Option C — For npm-style installs (workspace-linked, Replit only):**
```bash
npm install ./packages/client-sdk
```
The `packages/` directory in the Replit workspace has the source + built `dist/` for all 6 packages.

### 1.3 Which package for which platform?

| Platform | Package to install |
|---|---|
| NSP-WEB | `client-sdk` + `react-hooks` + `types` |
| NSP-MOBILE | `client-sdk-react-native` + `types` |
| Nyayamitra (NYM) | `nyayamitra-sdk` + `types` |
| NSI (Institutional) | `enterprise-sdk` + `types` |
| JRX (US Institutional) | `enterprise-sdk` + `types` |

---

## 2. Per-Platform Integration Summary

### 2.1 Quick reference

| Platform | Code | App ID in DB | Short | Tier | Jurisdiction | Org ID |
|---|---|---|---|---|---|---|
| NSP-WEB | `nsp-web` | `nvsdkapp-demo-nsp-001` | `nsw` | pro | IN | 3 |
| NSP-MOBILE | `nsp-mobile` | `nvsdkapp-demo-nsp-mobile-001` | `nsb` | pro | IN | 3 |
| Nyayamitra | `nayamitra` | `nvsdkapp-demo-nm-001` | `nym` | citizen | IN | 1 |
| NSI | `nsi` | `nvsdkapp-demo-nyi-001` | `nsi` | enterprise | IN | 2 |
| JRX | `jrx` | `nvsdkapp-demo-jrx-001` | `jrx` | enterprise | US | 2 |

### 2.2 Detailed per-platform docs

Each platform has a detailed integration guide with code samples, S3 doc pipeline, webhook receiver, and a 10-point testing matrix:

| Platform | Doc | Focus |
|---|---|---|
| NSP-WEB | [`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) | Web frontend, React hooks, Next.js quickstart |
| NSP-MOBILE | [`SDK-PLATFORM-NSP-MOBILE.md`](./SDK-PLATFORM-NSP-MOBILE.md) | React Native, BFF pattern, cert pinning, 25 MB upload cap |
| Nyayamitra | [`SDK-PLATFORM-NYAYAMITRA.md`](./SDK-PLATFORM-NYAYAMITRA.md) | Citizen-tier, limited agent scope, community chatbot |
| NSI | [`SDK-PLATFORM-NSI.md`](./SDK-PLATFORM-NSI.md) | Indian institutional, full 10-module set, matter-level S3 grouping |
| JRX | [`SDK-PLATFORM-JRX.md`](./SDK-PLATFORM-JRX.md) | US institutional, `jurisdiction=US` forced, Bluebook citations |

**IMPORTANT:** All 5 guides have a "Reality Check" banner at the top.
The canonical truth about which endpoints actually work is in
[`SDK-ENDPOINTS-CANONICAL-2026-05-02.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-02.md).
Always cross-reference before building.

### 2.3 Integration quickstart (same for all platforms)

```typescript
import { NyayvigyaClient } from '@nyayavigya/client-sdk';

const nyv = new NyayvigyaClient({
  baseUrl: 'https://api.nyayasiddhi.online',
  apiKey: process.env.NYV_SDK_API_KEY,  // your sdk_api_key (nyv_test_sk_…)
});

// Health check
const health = await nyv.health();

// List agents available to your tier
const agents = await nyv.agents.list();

// Execute an agent
const result = await nyv.agents.execute('indian-contracts-specialist', {
  prompt: 'What is the limitation period for breach of contract under Indian law?',
  jurisdiction: 'IN',
});
```

---

## 3. Keys, Auth & Requirements per Platform

### 3.1 The 4-key bundle

Each platform was minted a bundle of 4 keys on 2026-05-02. These are stored in a JSON file on EC2 and S3 — never in Replit or git.

| Key type | Prefix pattern | Purpose | Where to use |
|---|---|---|---|
| `sdk_api_key` | `nyv_test_sk_<short>_…` | **Primary API auth** — include as `X-API-Key` header in every request | All `/api/nv/sdk/*` and `/api/nv/gateway/*` calls |
| `publishable_key` | `nyv_test_pk_<short>_…` | **Frontend-safe key** — limited permissions, safe to embed in client-side code | Browser/mobile apps where you cannot hide the key |
| `signing_key` | `nyv_ss_<short>_…` | **HMAC signing** — sign outbound requests for extra integrity | Provisioned for v3.2 ingress signing; not enforced today |
| `webhook_secret` | `nyv_wh_<short>_…` | **Webhook verification** — verify inbound webhook payloads from Nyayavigya | Your webhook receiver endpoint |

### 3.2 How to retrieve your keys (operator only)

Run this in the AWS Console → Systems Manager → Run Command:

```bash
sudo cat /opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json | jq '.platforms[] | select(.code=="nsp-web")'
```

Replace `nsp-web` with: `nsp-mobile`, `nayamitra`, `nsi`, or `jrx`.

**Target instance:** `i-0df71e5ea1df8f588` (nysdev)  
**IMPORTANT:** Uncheck "S3 output" and "CloudWatch output" so keys don't land in logs.  
**Deliver keys** to platform teams via a secure channel (1Password, Signal). Never paste in Replit/email.

### 3.3 Auth model — which key for which endpoint

| Endpoint prefix | Auth header | Which key to use |
|---|---|---|
| `/health`, `/api/nv/health/full`, `/api/nv/voice/info` | None | Public — no key needed |
| `/api/nv/sdk/*` | `X-API-Key: nyv_test_sk_…` | `sdk_api_key` |
| `/api/nv/gateway/*` | `X-API-Key: nyv_test_sk_…` | `sdk_api_key` |
| `/downloads/sdk/*` | `X-API-Key: nyv_test_sk_…` | `sdk_api_key` |
| `/api/nv/orchestrate`, `/api/nv/documents/*`, `/api/nv/hitl/*`, `/api/nv/twindesk/*`, `/api/nv/automateai/*`, `/api/nv/skillshop/*` | `Authorization: Bearer <jwt>` | **JWT** — your platform's BFF must authenticate the user, then call Nyayavigya with the user's JWT. SDK keys don't work here. |
| `/api/nv/admin/*` | `Authorization: Bearer <admin-jwt>` | Admin JWT only |

### 3.4 How to get a JWT (for end-user routes)

```bash
# 1. Login to get a JWT
curl -X POST https://api.nyayasiddhi.online/api/nv/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@demo.nyayavigya.in","password":"<the password you set in SSM>"}'

# Response: { "token": "eyJ…", "refreshToken": "…" }

# 2. Use the JWT
curl -H "Authorization: Bearer eyJ…" \
  https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is Section 420 IPC?","jurisdiction":"IN"}'
```

### 3.5 Demo user accounts (seeded 2026-05-04)

| Email | Role | Tier |
|---|---|---|
| `admin@nyayavigya.in` | super_admin | enterprise |
| `dev@demo.nyayavigya.in` | developer | pro |
| `analyst@demo.nyayavigya.in` | analyst | plus |
| `operator@demo.nyayavigya.in` | operator | pro |
| `manager@demo.nyayavigya.in` | manager | enterprise |
| `user@demo.nyayavigya.in` | user | solo |

All share the password you set in SSM Parameter Store
(`/nyayavigya/dev/demo-user-password`).

### 3.6 Per-platform key capabilities

| Platform | SDK key → what can it call | JWT user role for end-user routes |
|---|---|---|
| **NSP-WEB** | `/api/nv/gateway/agents`, `/research/query`, `/translate`, `/sdk/docs-pipeline/*`, `/sdk/multimodal/voice/*` | developer/pro |
| **NSP-MOBILE** | Same as NSP-WEB; upload cap 25 MB | developer/pro |
| **Nyayamitra** | `/api/nv/gateway/agents` (citizen-tier subset), `/translate` | user/solo |
| **NSI** | All above + `/sdk/enterprise/research/domain/*`, `/sdk/enterprise/analytics/*`, `/sdk/enterprise/search/*` | manager/enterprise |
| **JRX** | Same as NSI; `jurisdiction=US` enforced | manager/enterprise |

### 3.7 HMAC webhook verification

When Nyayavigya sends a webhook to your platform (e.g. `documents.analysis.completed`),
the payload carries an `X-Nyv-Signature` header:

```typescript
import crypto from 'crypto';

function verifyWebhook(rawBody: Buffer, headerSig: string, webhookSecret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSig || ''));
}
```

---

## 4. S3 Storage Allocation per Platform

### 4.1 Bucket: `nyayavigya-sdk-devapp` (ap-south-1)

All platforms share one S3 bucket. Data isolation is via prefix paths scoped by `orgId`.

### 4.2 Prefix mapping

| Org ID | Platforms | S3 prefix | Purpose |
|---|---|---|---|
| 1 | Nyayamitra (NYM) | `orgs/1/nv/users/{userId}/documents/` | Citizen document uploads + AI outputs |
| 2 | NSI + JRX | `orgs/2/nv/users/{userId}/documents/` | Institutional document management |
| 3 | NSP-WEB + NSP-MOBILE | `orgs/3/nv/users/{userId}/documents/` | Professional document management |

### 4.3 Document path convention

```
s3://nyayavigya-sdk-devapp/orgs/{orgId}/nv/users/{userId}/documents/doc_{epochMs}_{12hex}/{filename}
```

Example:
```
s3://nyayavigya-sdk-devapp/orgs/3/nv/users/42/documents/doc_1714680000000_a1b2c3d4e5f6/contract.pdf
```

### 4.4 Processing pipeline paths

When a document is uploaded and analyzed, it flows through:

| Stage | S3 prefix | Who writes |
|---|---|---|
| Upload | `orgs/{orgId}/nv/users/{userId}/documents/` | Your platform |
| Processing | `processing/{orgId}/{docId}/` | Nyayavigya gateway |
| AI outputs | `ai-outputs/{orgId}/{docId}/` | Nyayavigya gateway |
| System data | `system/` | Nyayavigya internal only |

### 4.5 Other top-level prefixes (not per-platform)

| Prefix | Purpose |
|---|---|
| `sdk/` | SDK tarball packages (read-only for consumers) |
| `_dba/secrets/` | Operator-only: key bundles, backups |
| `_archive/` | Archived NSP volumes, old tarballs |
| `deploys/` | Deploy tarballs pushed by `deploy-replit-ssm.sh` |
| `models/` | ML model artifacts |
| `test/` | Test fixtures |

### 4.6 Access control

Currently the gateway uses application-level Row-Level Security (RLS) via `nv-org-rls-middleware.ts` to enforce that orgId=3 users can only read/write `orgs/3/*`. There is NO S3 bucket policy enforcing this at the AWS level yet — that is tracked for a future infra-change window (Option A decision from 2026-05-04). For now the RLS middleware is the enforcement boundary.

---

## 5. Replit → AWS Deployment Flow & Current Status

### 5.1 How code flows from Replit to AWS

```
┌──────────────────┐    tar + s3 cp     ┌──────────────────┐
│   Replit Agent    │ ─────────────────> │   S3 bucket      │
│  (this workspace) │                    │ deploys/<id>.tgz │
└──────┬───────────┘                    └────────┬─────────┘
       │                                         │
       │  aws ssm send-command                   │ s3 cp download
       │                                         │
       ▼                                         ▼
┌──────────────────────────────────────────────────────────┐
│   EC2 instance  (i-0df71e5ea1df8f588 / 13.232.165.242)  │
│                                                          │
│   1. Extract tarball → /opt/Nyayavigya/repo/<id>/        │
│   2. Overlay .env.production from /opt/Nyayavigya/secrets│
│   3. docker compose build gateway                        │
│   4. docker compose up -d --force-recreate gateway       │
│   5. Health check: curl :5000/health → 200               │
│   6. Update CURRENT_DEPLOY + LAST_GOOD_DEPLOY            │
│   7. Restart console (nginx re-resolves gateway IP)      │
└──────────────────────────────────────────────────────────┘
```

### 5.2 The deploy command

From Replit, run:
```bash
bash scripts/deploy-replit-ssm.sh --note "what changed"
```

What it does:
1. Creates a tarball of the workspace (excludes `.git`, `node_modules`, `dist`, `.env`)
2. Uploads to `s3://nyayavigya-sdk-devapp/deploys/<timestamp>-<sha>.tgz`
3. Sends an SSM command to EC2 that:
   - Downloads and extracts the tarball
   - Overlays the production `.env` (which has RDS, ElastiCache, all API keys — 350+ vars)
   - Validates critical env vars exist (DATABASE_URL, REDIS_URL, JWT_SECRET, NV_PII_ENCRYPTION_KEY)
   - Builds the Docker gateway image
   - Force-recreates the container
   - Waits for health check (90s timeout)
   - Updates deploy tracking files

**Security hardening (2026-05-02):**
- The Replit `.env` is NEVER shipped (it has only 33 local-dev flags, no DB/Redis URLs)
- The `--note` value is base64-encoded to prevent command injection
- Gateway crashes with `[NYV-NS-005]` if DATABASE_URL is missing

### 5.3 Current Replit vs AWS status

| Aspect | Replit (this workspace) | AWS EC2 (nysdev) |
|---|---|---|
| **Code version** | HEAD of workspace (latest edits) | `a558dba` (deployed 2026-05-02T09:46Z) |
| **Database** | Replit Neon (dev/sandbox, limited data) | RDS PostgreSQL (full data, 148 agents, 502 MCP tools, 20 SDK keys) |
| **Redis** | In-memory fallback | ElastiCache Redis (production) |
| **Domain** | `*.replit.dev` (preview pane) | `api.nyayasiddhi.online` (Route53 → ALB → EC2) |
| **SSL** | Replit-managed | ACM certificate on ALB |
| **Docker** | No Docker — runs directly via `tsx` | `docker-compose.aws-dev.yml` → `nyv-gateway` container |
| **Users seeded** | Not seeded | 6 demo users (seeded 2026-05-04) |
| **SDK keys** | Not in Replit DB | 20 keys across 5 platforms in `nv_api_keys` |
| **Env vars** | `.env` (33 feature flags) | `/opt/Nyayavigya/secrets/.env.production` (350+ vars) |

### 5.4 When you make changes in Replit and want them on AWS

1. Make your code change in this Replit workspace
2. Test locally in Replit (the gateway runs at localhost:5000 via the workflow)
3. When satisfied, deploy:
   ```bash
   bash scripts/deploy-replit-ssm.sh --note "description of what changed"
   ```
4. Monitor the SSM command output for success/failure
5. Verify on the live gateway: `curl https://api.nyayasiddhi.online/health`

### 5.5 What does NOT flow from Replit to AWS

- `.env` file (the production .env is maintained separately on EC2)
- `node_modules/` (rebuilt during `docker compose build`)
- Database schema changes (must be applied separately via SSM SQL commands)
- SDK key changes (minted via `nv-mint-sdk-bundle.ts` on EC2)
- S3 bucket policies / IAM changes (separate infra-change process)

### 5.6 End-to-end testing flow

To test a feature end-to-end:

1. **Replit-side:** code + run locally, test in preview pane
2. **Deploy:** `bash scripts/deploy-replit-ssm.sh --note "testing feature X"`
3. **AWS-side smoke:** hit `https://api.nyayasiddhi.online/api/nv/health/full` to verify deployment
4. **Auth test:** login with demo user → get JWT → call the feature endpoint
5. **SDK key test:** call `/api/nv/sdk/*` endpoints with the platform SDK key

---

## 6. Technical Specification — Code Structure & Edit Guide

### 6.1 Repository structure overview

```
nyayavigya-platform-312/
├── src/                        ← ALL backend source code
│   ├── index.ts                ← EXPRESS APP — all route mounts (913 lines, THE entry point)
│   ├── routes/                 ← 79 route files (REST endpoints)
│   ├── services/               ← 70+ service files (business logic)
│   ├── middleware/              ← 31 middleware files (auth, RLS, rate limiting, etc.)
│   ├── db/                     ← Database connection + migrations
│   │   └── index.ts            ← Drizzle ORM connection (DATABASE_URL → RDS)
│   ├── config/                 ← 16 config files (feature flags, SDK variants, master config)
│   ├── data/                   ← Static registries (agents JSON, MCP tools, statutes)
│   └── utils/                  ← Utility functions (logger, error sanitizer, etc.)
├── shared/                     ← Shared Drizzle schema (7 files, 95+ tables)
│   ├── schema.ts               ← Main schema (users, orgs, API keys, etc.)
│   ├── nv-schema-tables.ts     ← Extended tables (SDK apps, agent analytics)
│   └── nv-governance-schema.ts ← Governance tables (audit, compliance)
├── packages/                   ← 6 SDK packages (client libraries)
│   ├── client-sdk/             ← Core TypeScript SDK
│   ├── client-sdk-react-native/← React Native SDK
│   ├── nyayamitra-sdk/         ← Citizen-tier SDK
│   ├── enterprise-sdk/         ← Enterprise-tier SDK
│   ├── react-hooks/            ← React hooks for the SDK
│   └── types/                  ← Shared TypeScript types
├── examples/                   ← Example apps
│   ├── nsp-web-quickstart/     ← Next.js example consuming the SDK
│   └── nsp-mobile/             ← React Native example
├── scripts/                    ← Operations scripts
│   ├── deploy-replit-ssm.sh    ← CANONICAL deploy script (Replit → EC2)
│   ├── nv-mint-sdk-bundle.ts   ← CANONICAL key-mint script
│   ├── nv-seed-users.ts        ← Demo user seeder
│   └── nv-smoke-ec2.sh         ← EC2 smoke test runner
├── drizzle/                    ← Database migration SQL files
│   └── 0000–0006_*.sql         ← Applied migrations
├── docs/                       ← All documentation
│   └── v3.1.2/                 ← Current version docs
├── config/                     ← Agent registry JSON files
│   └── agent-registries/       ← 1042 agent definitions (6 jurisdictions)
├── docker-compose.aws-dev.yml  ← Docker compose for EC2 (SINGLE gateway service)
├── Dockerfile                  ← Gateway Docker image definition
├── Project-Tracker.md          ← CANONICAL project state + changelog
└── replit.md                   ← Agent memory file
```

### 6.2 The entry point: `src/index.ts`

This is the single most important file. It is an Express.js application
that mounts ALL routes, middleware, and services. When you want to
understand "where does endpoint X live?", search this file.

**Structure of index.ts (913 lines):**
- Lines 1-200: imports (every route, middleware, service)
- Lines 200-340: Express app setup, CORS, body parsers
- Lines 340-400: middleware stack (auth, rate limiting, tenant isolation, RLS, security)
- Lines 400-650: route mounting (all `/api/nv/*` paths)
- Lines 650-800: error handlers, 404 catch-all
- Lines 800-913: server startup, graceful shutdown

### 6.3 Where to edit: common scenarios

#### "I need to add a new API endpoint"

1. Create a new route file in `src/routes/nv-<feature>-routes.ts`
2. Export `default router` (Express Router)
3. Add the import in `src/index.ts` (top section)
4. Add `app.use('/api/nv/<feature>', myRouter)` in the route mounting section
5. If it needs auth: add `authenticateToken` middleware
6. If it needs SDK-key auth: mount under `/api/nv/sdk/<feature>` with the SDK rate limiter

#### "I need to fix a bug in the orchestration logic"

Look in:
- `src/routes/nv-orchestration-routes.ts` — the REST endpoint handler
- `src/services/orchestration/` — the orchestration engine
- `src/nv-orchestration-engine.ts` — the Queen/agent selection logic

#### "I need to change how agents are selected"

Look in:
- `src/services/agent-orchestration.ts` — agent scoring + selection
- `src/services/bm25-agent-selector.ts` — BM25 text-similarity fallback
- `config/agent-registries/` — the JSON files defining all 1042 agents

#### "I need to add a new database table"

1. Define the table in `shared/schema.ts` (or `shared/nv-schema-tables.ts`)
2. Create a migration: `npx drizzle-kit generate`
3. The SQL file lands in `drizzle/` (e.g. `0007_my_new_table.sql`)
4. Apply on EC2 via SSM:
   ```bash
   aws ssm send-command ... --parameters '{"commands":["docker exec nyv-gateway sh -c \"cd /app && npx drizzle-kit push\""]}'
   ```
5. Or run the raw SQL via SSM against the gateway's `DATABASE_URL`

#### "I need to change the SDK client"

Edit files in `packages/client-sdk/src/`. After editing:
```bash
cd packages/client-sdk && npm run build
npm pack  # creates the .tgz
# Upload to S3:
aws s3 cp *.tgz s3://nyayavigya-sdk-devapp/sdk/client-sdk/5.0.0.tgz --region ap-south-1
```

#### "The gateway is crashing on EC2"

1. Check container logs:
   ```bash
   aws ssm send-command ... '{"commands":["docker logs nyv-gateway --tail 100"]}'
   ```
2. Common causes:
   - `[NYV-NS-005]` — DATABASE_URL missing or wrong in `.env`
   - `ECONNREFUSED` on Redis — ElastiCache endpoint wrong
   - Memory: container OOMKilled — check `docker stats`

3. Quick recovery:
   ```bash
   # Restart with last known good deploy
   aws ssm send-command ... '{"commands":["cd /opt/Nyayavigya/repo/$(cat /opt/Nyayavigya/LAST_GOOD_DEPLOY) && docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway"]}'
   ```

#### "I need to add or change an environment variable on EC2"

Edit the production .env:
```bash
aws ssm send-command ... '{"commands":["echo \"MY_NEW_VAR=value\" >> /opt/Nyayavigya/secrets/.env.production && cp /opt/Nyayavigya/secrets/.env.production /opt/Nyayavigya/repo/$(cat /opt/Nyayavigya/CURRENT_DEPLOY)/.env && cd /opt/Nyayavigya/repo/$(cat /opt/Nyayavigya/CURRENT_DEPLOY) && docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway"]}'
```

### 6.4 Key files quick reference

| What you want | File(s) |
|---|---|
| All route mounts | `src/index.ts` (lines 400-650) |
| Auth middleware (JWT verification) | `src/middleware/auth.ts` |
| SDK key verification | `src/middleware/nv-auth.ts`, `src/config/nv-sdk-variants.ts` |
| Rate limiting | `src/middleware/nv-rate-limit-middleware.ts`, `nv-redis-platform-rate-limiter.ts` |
| Row-level security | `src/middleware/nv-org-rls-middleware.ts` |
| Tenant isolation | `src/middleware/nv-inter-service-auth.ts` |
| Database connection | `src/db/index.ts` |
| Database schema | `shared/schema.ts`, `shared/nv-schema-tables.ts` |
| Agent registry (1042 agents) | `config/agent-registries/` (JSON files per jurisdiction) |
| MCP tools registry (502 tools) | `src/data/nv-mcp-tools-registry.ts` |
| Master config (S3, Redis, feature flags) | `src/config/nyv-master-config.ts` |
| Feature flags | `src/config/nv-feature-flags.ts` |
| LLM provider config | `src/config/llm-config.ts`, `src/config/nyv-allowed-providers.ts` |
| Orchestration engine | `src/nv-orchestration-engine.ts` |
| Document pipeline | `src/services/document-pipeline/` |
| Voice service | `src/services/nyv-voice-service-enhanced.ts` |
| Translation (Sarvam) | `src/services/sarvam-translation-service.ts` |
| Deploy script | `scripts/deploy-replit-ssm.sh` |
| Key mint script | `scripts/nv-mint-sdk-bundle.ts` |
| User seed script | `scripts/nv-seed-users.ts` |
| Docker compose (EC2) | `docker-compose.aws-dev.yml` |
| Docker image | `Dockerfile` |
| Production .env (EC2 only) | `/opt/Nyayavigya/secrets/.env.production` |
| SDK key bundle (EC2 only) | `/opt/Nyayavigya/secrets/sdk-bundle-sandbox-*.json` |
| Deploy log (EC2 only) | `/opt/Nyayavigya/deploys.log` |
| Current deploy ID (EC2 only) | `/opt/Nyayavigya/CURRENT_DEPLOY` |

### 6.5 Docker architecture on EC2

```
docker-compose.aws-dev.yml
└── nyv-gateway (single container)
    ├── Port 5000 → Express server
    ├── Connects to: RDS PostgreSQL (DATABASE_URL)
    ├── Connects to: ElastiCache Redis (REDIS_URL)
    ├── Connects to: S3 (nyayavigya-sdk-devapp bucket)
    └── Connects to: OpenAI, Anthropic, Google, OpenRouter, Sarvam APIs

nyv-console (separate container, not in this compose)
└── Nginx reverse proxy
    ├── Port 80 → proxies to nyv-gateway:5000
    └── Serves the admin dashboard
```

### 6.6 Technology stack summary

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript (via `tsx`) |
| Framework | Express.js 4.x |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 (RDS) |
| Cache | Redis 7 (ElastiCache) |
| Container | Docker + docker-compose |
| Cloud | AWS (EC2, RDS, ElastiCache, S3, ALB, Route53, ACM, WAF, SSM) |
| LLM providers | Anthropic (Claude), OpenAI (GPT), Google (Gemini), OpenRouter, Sarvam AI |
| Auth | JWT (RS256) + bcrypt + CSRF |
| SDK auth | SHA-256 hashed API keys in `nv_api_keys` |

### 6.7 Middleware pipeline (order matters)

When a request hits `/api/nv/*`, it flows through this middleware stack
in order (configured in `src/index.ts` lines 320-400):

```
1. publicRateLimit          → basic rate limit for all /api/nv/* (anonymous)
2. optionalAuth             → attempt JWT decode (sets req.user if valid)
3. authenticatedRateLimit   → stricter rate limit if auth present
4. nvResponseSigningMiddleware → sign all responses for integrity
5. tenantIsolation          → enforce org boundaries
6. orgRlsMiddleware         → PostgreSQL row-level security
7. securityMonitorMiddleware → log suspicious patterns
8. [route handler]          → your endpoint logic
```

For SDK-key-authed routes (`/api/nv/sdk/*`, `/api/nv/gateway/*`), the
sub-routers have their own auth middleware that validates `X-API-Key`
against the `nv_api_keys` or `sdk_app_api_keys` table.

### 6.8 Database tables (key ones)

| Table | Purpose |
|---|---|
| `users` | User accounts (6 demo users seeded) |
| `nv_sdk_applications` | Registered SDK platforms (5 active) |
| `nv_api_keys` | SDK API keys (20 keys — 5 platforms × 4 types) |
| `sdk_app_api_keys` | Canonical key table (v3.2 consolidation target) |
| `nv_agents` | Agent registry metadata |
| `nv_mcp_tools` | MCP tool definitions (502 rows) |
| `nv_organizations` | Org definitions (orgId 1, 2, 3) |
| `nv_statutes` | Indian statute corpus |
| `nv_rag_documents` | RAG document index |
| `nv_rag_chunks` | RAG chunks + embeddings |
| `nv_audit_log` | Audit trail |
| `nv_feature_flags` | Runtime feature flags |

---

## 7. Appendices

### A. Runbook

Full operations runbook: [`NYV-OPS-RUNBOOK.md`](./NYV-OPS-RUNBOOK.md)

### B. Open items (from runbook §8.2)

| ID | Item | Status |
|---|---|---|
| C1 | NSM (Ministry) key deferred | Deferred |
| C2 | Drizzle journal backfill for migrations 0005/0006 | Open |
| C3 | `nv_rag_documents`/`nv_rag_chunks` tables not in migration | Open |
| C4 | 7 broken seed scripts targeting undefined tables | Open |
| C5 | Demo password SSM rotation | Done (seeded 2026-05-04) |
| C9 | Integration guide path mismatches for TwinDesk/AutomateAI | Tracked |
| C10 | Apply canonical test-matrix patch from endpoints doc | Tracked |

### C. Product documentation

- Full product note: `Full-Final-Nyayavigya-ProductNote-312-April2026.md` (206K, 34 sections)
- Architecture: `docs/v3.1.2/completed_docs/NYV-ARCHITECTURE-v6.md`
- CI/CD: `docs/v3.1.2/completed_docs/NYV-CICD-REPLIT.md`
- Secrets management: `docs/v3.1.2/completed_docs/NYV-SECRETS-MANAGEMENT.md`
- Observability: `docs/v3.1.2/completed_docs/NYV-OBSERVABILITY.md`
- Incident runbook: `docs/v3.1.2/completed_docs/NYV-INCIDENT-RUNBOOK.md`

### D. Version history

| Date | Event |
|---|---|
| 2026-04-25 | DNS cutover to Route53, `nyayasiddhi.online` live |
| 2026-04-30 | v5.0.0 SDK frozen, dev-edge live |
| 2026-05-01 | SDK tarballs published to S3, download endpoint live |
| 2026-05-02 | Clean v3.1.2 deploy (T010-T016), 20 SDK keys minted |
| 2026-05-04 | Demo users seeded, master integration guide published |
| 2026-05-15 | Production GA target |
