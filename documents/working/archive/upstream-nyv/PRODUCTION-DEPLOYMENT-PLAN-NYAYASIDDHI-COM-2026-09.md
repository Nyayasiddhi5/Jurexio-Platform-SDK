# Production Deployment Plan — NYV + NYS on nyayasiddhi.com

> **Created:** 2026-09-03 UTC  
> **Status:** Planning reference — **no deploy execution without explicit user GO**  
> **Scope:** Full Nyayavigya Legal ecosystem (NYV gateway + Console + NYS Knowledge Plane) on a **new production environment** with root domain **`nyayasiddhi.com`**  
> **Target tier:** Medium (~10K registered users) per [`13-Cloud-Cost-Reference.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/13-Cloud-Cost-Reference.md)  
> **Companion docs:** [`06-AWS-PRODUCTION-DEPLOYMENT.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/06-AWS-PRODUCTION-DEPLOYMENT.md) · [`DUAL-PROJECT-OPS-NYV-NYS-2026-07.md`](./DUAL-PROJECT-OPS-NYV-NYS-2026-07.md) · [`PLATFORM-PERFORMANCE-DB-SEARCH-AUDIT-2026-09-02.md`](./PLATFORM-PERFORMANCE-DB-SEARCH-AUDIT-2026-09-02.md) · [`NYV-NSP-PRODUCTION-DEPLOYMENT-CAPACITY-2026-08.md`](./NYV-NSP-PRODUCTION-DEPLOYMENT-CAPACITY-2026-08.md) · [`PHASED-GO-LIVE-PLAN-2026-07.md`](./PHASED-GO-LIVE-PLAN-2026-07.md)

**Classification:** NO SECRET VALUES — structure and names only (NV-SECRETS-001).

---

## 1. Executive summary

This plan defines requirements and a phased action path to deploy the **complete NYV + NYS platform** on a **greenfield production AWS environment** in **ap-south-1**, migrating public URLs from the current **`*.nyayasiddhi.online`** development edge to **`*.nyayasiddhi.com`**.

| Dimension | Decision |
|---|---|
| **Products** | **NYV** (`nyayavigya-platform-312/`) + **NYS** (`NYS-Agentic-AI/`) — separate deploy trees, separate hosts/RDS |
| **Domain** | Root **`nyayasiddhi.com`**; subdomains `api`, `console`, `nyayasearch`, `pro`, `nym` |
| **Tier** | Medium — ~10K registered users, Multi-AZ RDS + Redis, 2–4 NYV gateway replicas |
| **LLM posture** | Same cascade as nysdev: **Bedrock primary** (`NYV_BEDROCK_ENABLED=on`, `NYV_ROUTER_BEDROCK_FIRST=on`), **Gemini 3.7 Flash** fallback, **Sarvam** for Indic/NYM — **new prod keys required (explicit GO)** |
| **Knowledge plane** | NYS caselaw worker remains SoT for corpus; NYV federates via `NYV_F_NYS_KNOWLEDGE_PLANE=1` — **no corpus copy into NYV OLTP** |
| **Secrets** | **Do not copy nysdev keys** — generate fresh prod SDK keys (NSP/NYM), LLM keys, JWT, DB credentials |
| **Deploy method (initial)** | Proven **EC2 + Docker Compose + SSM** (`deploy-aws-ssm.sh`, NYS `upload-deploy.mjs`); scale-out via ASG or ECS Fargate in Phase 5+ |
| **Timeline** | ~7 weeks phased (Phase 0–5); cutover only after UAT GREEN + explicit cutover GO |
| **Cost reference** | ~**$61,500/month** optimised Medium AWS (infra + LLM); up to ~$95K without cache/fast-path optimisation |

**Current dev edge (frozen — do not treat as prod):**

| Host | Role | Instance |
|---|---|---|
| nysdev | NYV gateway + Console | `i-0df71e5ea1df8f588` |
| nyv-caselaw-worker | NYS API + embed workers | `i-000115b19219bb766` |

Production is a **new environment** — not an in-place rename of nysdev.

---

## 2. Prerequisites & requirements checklist

### 2.1 AWS account & IAM

| # | Requirement | Notes |
|---|---|---|
| 1 | Dedicated **production AWS account** or clearly tagged prod OU | Separate billing alarm from dev |
| 2 | Region **ap-south-1** (Mumbai) primary | Bedrock also uses **us-east-1** for model availability (`AWS_BEDROCK_REGION` / `NYV_BEDROCK_REGION_ORDER`) |
| 3 | IAM roles: EC2 instance profile with **Bedrock InvokeModel**, **S3**, **SSM**, **CloudWatch**, **Athena** (NYS), **Secrets Manager** read | No long-lived access keys on hosts where possible |
| 4 | Deploy operator IAM user (SSM `SendCommand`, S3 deploy bucket write) | Same pattern as `product Documents/env.production` — deploy creds only |
| 5 | Service quotas raised: EC2, RDS, ElastiCache, ALB, Bedrock TPM | Medium tier: 4× m7g.xlarge + 2× db.r7g.large Multi-AZ |
| 6 | VPC: **2 AZ**, public subnets (ALB), private subnets (RDS, Redis, EC2 optional) | SG rules: ALB→gateway:5000/console:80; gateway→RDS:5432, Redis:6379; gateway→NYS:443 |
| 7 | CloudWatch log groups + SNS topic (`nyv-platform-alerts-prod`) | Email confirmed before cutover |

### 2.2 Domain, DNS, TLS

| # | Requirement | Notes |
|---|---|---|
| 1 | Register / transfer **`nyayasiddhi.com`** to Route 53 | Apex + wildcard cert or per-host ACM |
| 2 | ACM certificates (ap-south-1 + us-east-1 if CloudFront) | SANs: `api`, `console`, `nyayasearch`, `pro`, `nym`, apex |
| 3 | Route 53 hosted zone + health checks | Failover optional Phase 5 |
| 4 | Partner callback URL updates | NSP/NYM OAuth redirect URIs, webhook endpoints |
| 5 | CORS allowlist update | Console origin `https://console.nyayasiddhi.com` |

### 2.3 RDS sizing (10K users)

| Database | Engine | Production class | Storage | HA |
|---|---|---|---|---|
| **NYV OLTP** | PostgreSQL 16 + pgvector | `db.r7g.large` Multi-AZ → scale to `db.r7g.xlarge` at load | 500 GB gp3, 12K IOPS | PITR 7d; optional read replica |
| **NYS caselaw** | PostgreSQL 16 + pgvector | `db.r6g.large` → `db.r6g.xlarge` for 26M+ rows | 1–2 TB gp3 | Separate instance; embed worker contention isolated |
| **NSP partner DB** (if separate product) | PostgreSQL | Own instance — **never merge into NYV OLTP** | Per NSP BOM | Multi-AZ |

**Roles (both NYV RDS):**

- `nyvadmin` — DDL, migrations (`npm run db:push`, `src/db/create-indexes.ts`)
- `nv_app` — runtime DML only (gateway pool `NYV_DB_POOL_MAX=40` per replica)

**Admin migrations required before prod boot** (per perf audit 2026-09-02):

- NYV hot-path indexes (`sdk_app_api_keys`, orchestration jobs, legal chat, audit logs)
- Phase5 + knowledge-module tables via Drizzle — **not** lazy boot DDL on `nv_app`
- NYS: GIN FTS, CNR, HNSW embedding indexes (`rds-ddl.ts`)

### 2.4 S3 buckets

| Bucket | Purpose | Encryption | Lifecycle |
|---|---|---|---|
| `nyayavigya-prod-documents` | Matter vault, EDJ uploads, tenant docs | SSE-S3 or SSE-KMS | IA after 90d; Glacier for closed matters (policy) |
| `nyayavigya-prod-deploys` | NYV SSM deploy tarballs | SSE-S3 | Delete after 90d |
| `nyv-sdk-distribution` (prod prefix) | NYS API releases + manifest | SSE-S3 | Immutable content-addressed releases |
| `nyv-caselaw-parquet` (or existing pattern) | Athena CTAS, HC case-details parquet | SSE-S3 | Partition by court/year |
| `nyayavigya-prod-logs` | ALB/access logs, audit exports | SSE-KMS | 2555d retention align DPDPA |

### 2.5 Redis / ElastiCache

| Attribute | 10K production |
|---|---|
| Engine | Redis 7 |
| Node | `cache.r7g.large` × 2 (Multi-AZ replication group) |
| AUTH + TLS | Required |
| Use | Sessions, ROMA L5, semantic cache, BullMQ, rate limits |
| Canonical env | `NYV_REDIS_TCP_URL` (NV-SECRETS-001) |

### 2.6 Bedrock & LLM access

| Provider | Prod requirement |
|---|---|
| **AWS Bedrock** | IAM on gateway role; models: Haiku 4.5, Sonnet 5, Opus 5, Titan embed |
| **Gemini** | `GOOGLE_AI_API_KEY` / `GEMINI_API_KEY` — new prod key (GO) |
| **Sarvam** | `SARVAM_API_KEY` — Indic/NYM routing |
| **OpenRouter** | Optional cascade; STT path uses Gemini fallback on nysdev |

Mirror nysdev flags: `NYV_BEDROCK_ENABLED=on`, `NYV_ROUTER_BEDROCK_FIRST=on`, `NYV_BEDROCK_REGION_ORDER=us-east-1,ap-south-1`.

### 2.7 Secrets management

| Layer | Store | Contents |
|---|---|---|
| Runtime overlay | `/opt/Nyayavigya/secrets/.env.production` on NYV host | Full 350+ key prod env (same pattern as nysdev) |
| NYS runtime | `/opt/nyv/api/.env` on caselaw worker | `DATABASE_URL`, `NYS_SDK_API_KEYS`, Bedrock, Athena |
| SSM Parameter Store | Non-rotating infra refs, deploy instance IDs | **Not** primary SDK key store for prod |
| Secrets Manager | RDS master rotation (optional), JWT signing secret | Enable after cutover with runbook |
| Local mirror | `.local/secrets/` (gitignored) | Pull-once for operator smoke — never commit |

### 2.8 EC2 vs ECS/EKS recommendation

| Option | Verdict | Rationale |
|---|---|---|
| **EC2 + Docker Compose + ASG (recommended Phase 1–2)** | ✅ **Primary** | Matches proven `deploy-aws-ssm.sh`; lowest ops surprise; 2–4 gateway instances behind ALB |
| **ECS Fargate (Phase 4+ scale)** | ✅ Optional | When gateway replica count >4 or team wants managed rolling deploy |
| **EKS** | ⚠ Defer | Higher ops burden; justify only at Large (100K) tier |
| **Console** | S3 + CloudFront static | nginx-in-docker acceptable for Phase 2; CDN for prod GA |

**Production NYV host profile (per Medium tier):** 2–4× **m7g.xlarge** (4 vCPU, 16 GiB), gateway mem limit 2 GB, `NODE_OPTIONS=--max-old-space-size=1536`.

**Production NYS host profile:** 2× **m7g.xlarge** (API + embed worker isolation) or dedicated embed worker on second instance.

---

## 3. Domain & DNS migration table

| Service | Current (`*.nyayasiddhi.online`) | New (`*.nyayasiddhi.com`) | ALB / target |
|---|---|---|---|
| Platform apex | `https://nyayasiddhi.online/` | `https://nyayasiddhi.com/` | Marketing / redirect → console |
| NYV API | `https://api.nyayasiddhi.online` | `https://api.nyayasiddhi.com` | ALB → gateway :5000 (via console nginx :80 or direct TG) |
| NYV Console | `https://console.nyayasiddhi.online` | `https://console.nyayasiddhi.com` | ALB → console :80 |
| NYS Knowledge Plane | `https://nyayasearch.nyayasiddhi.online` | `https://nyayasearch.nyayasiddhi.com` | ALB → NYS `nyv-api` :8080 |
| NSP partner UI | `https://pro.nyayasiddhi.online` | `https://pro.nyayasiddhi.com` | NSP-owned (points at NYV API) |
| NYM citizen UI | `https://nym.nyayasiddhi.online` | `https://nym.nyayasiddhi.com` | NYM-owned (points at NYV API) |
| OpenAPI / Swagger | `https://api.nyayasiddhi.online/api/nv/docs` | `https://api.nyayasiddhi.com/api/nv/docs` | Gateway |
| Health (partner) | `GET /api/nv/health` | Same path on new API host | Gateway |
| SDK base URL (NSP/NYM) | `https://api.nyayasiddhi.online` | `https://api.nyayasiddhi.com` | Document in partner handoff |
| NYS federation (NYV env) | `NYS_KNOWLEDGE_BASE_URL=https://nyayasearch.nyayasiddhi.online/api` | `NYS_KNOWLEDGE_BASE_URL=https://nyayasearch.nyayasiddhi.com/api` | Gateway → NYS |
| NYS SSO launchpad | `NYS_UI_BASE_URL=https://nyayasearch.nyayasiddhi.online` | `NYS_UI_BASE_URL=https://nyayasearch.nyayasiddhi.com` | Console → NYS session |
| CORS origins | `console.nyayasiddhi.online`, `pro.*`, `nym.*` | `*.nyayasiddhi.com` equivalents | Gateway CORS config |
| Partner webhooks / OAuth | All registered on `.online` | Re-register on `.com` before cutover | NSP/NYM ops |
| Email / DPDPA | `privacy@nyayasiddhi.com` (already in `.env.production.example`) | No change | — |

**Migration strategy:** Stand up `.com` in parallel; run smoke on `.com`; lower TTL on `.online`; cutover DNS with rollback CNAME to dev edge if needed.

---

## 4. Infrastructure topology

```mermaid
flowchart TB
  subgraph Internet
    Partners[NSP_NYM_Partners]
    Users[Console_Users]
  end

  subgraph Route53_TLS["Route53 + ACM (.com)"]
    DNS[nyayasiddhi.com_zone]
  end

  subgraph Edge["ap-south-1 Edge"]
    ALB_NYV[ALB_nyv_prod]
    ALB_NYS[ALB_nys_prod]
  end

  subgraph NYV_Compute["NYV Compute (EC2 ASG or 2-4 hosts)"]
    GW1[nyv_gateway_5000]
    GW2[nyv_gateway_replica]
    CON[nyv_console_nginx_80]
  end

  subgraph NYV_Data["NYV Data Plane"]
    RDS_NYV[(RDS_NYV_OLTP_pgvector)]
    REDIS[(ElastiCache_Redis_HA)]
    S3_DOC[S3_documents_vault]
    S3_DEP[S3_deploy_artifacts]
  end

  subgraph NYS_Compute["NYS Compute (caselaw worker)"]
    NYS_API[nyv_api_systemd_8080]
    EMB1[embed_worker_1]
    EMB2[embed_worker_2]
  end

  subgraph NYS_Data["NYS Data Plane"]
    RDS_NYS[(RDS_NYS_caselaw_26M)]
    S3_PQ[S3_parquet_Athena]
    ATH[Athena_Glue]
  end

  subgraph LLM["LLM Providers"]
    BR[Bedrock_us_east_1]
    GEM[Gemini_Flash]
    SAR[Sarvam_Indic]
  end

  Partners --> DNS
  Users --> DNS
  DNS --> ALB_NYV
  DNS --> ALB_NYS
  ALB_NYV --> CON
  ALB_NYV --> GW1
  ALB_NYV --> GW2
  CON --> GW1
  GW1 --> RDS_NYV
  GW2 --> RDS_NYV
  GW1 --> REDIS
  GW1 --> S3_DOC
  GW1 --> NYS_API
  GW1 --> BR
  GW1 --> GEM
  GW1 --> SAR
  ALB_NYS --> NYS_API
  NYS_API --> RDS_NYS
  NYS_API --> BR
  EMB1 --> RDS_NYS
  EMB2 --> RDS_NYS
  NYS_API --> ATH
  ATH --> S3_PQ
  GW1 -.->|SSM deploy| S3_DEP
```

**Cross-VPC / peering:** Default: **public HTTPS federation** (NYV → NYS via ALB) — same as dev (`DUAL-PROJECT-OPS`). Optional VPC peering for private NYS path if latency SLO requires; not required for initial cutover.

---

## 5. Database plan

### 5.1 NYV Postgres (OLTP + tenant RAG)

| Step | Action | Owner | GO required |
|---|---|---|---|
| 5.1.1 | Provision RDS Multi-AZ PostgreSQL 16 + pgvector extension | Infra | Infra GO |
| 5.1.2 | Create roles `nyvadmin`, `nv_app`; grant least privilege | DBA | — |
| 5.1.3 | `npm run db:push` from CI or admin bastion with `DATABASE_URL_ADMIN` | Platform | Schema GO |
| 5.1.4 | Run `src/db/create-indexes.ts` + NYV hot-path migration SQL (perf audit §B1) | Platform | — |
| 5.1.5 | Seed: platform admin, demo tenants, UAT users via existing seed scripts | Platform | Seed GO |
| 5.1.6 | Enable RLS pilot: `NYV_RLS_ENFORCE=1` after `rls:verify` | Security | RLS GO |
| 5.1.7 | Register 164 agents via `config/agent-registries/` (see §6.4) | Platform | — |

**Do not** lazy-create Phase5 / knowledge-module tables at boot on `nv_app` — pre-provision via migration.

### 5.2 NYS caselaw RDS

| Step | Action | Notes |
|---|---|---|
| 5.2.1 | Provision separate RDS (1 TB+ gp3) | ~26.26M judgments, ~281 GB table |
| 5.2.2 | Apply `rds-ddl.ts` canonical schema + perf indexes (GIN FTS, CNR, HNSW) | `CREATE INDEX CONCURRENTLY` in maintenance window |
| 5.2.3 | CNR tables + `cnr_case_details` index | Athena write-through target |
| 5.2.4 | Statutes embeddings + FTS indexes | Hybrid search parity |

### 5.3 Seed vs migrate from nysdev

| Data class | Recommendation | GO gate |
|---|---|---|
| **Schema** | Fresh `db:push` on prod RDS | Schema GO |
| **Agent registry JSON** | Ship from repo (`config/agent-registries/Nyayavigya-Legal-registry-*.json`) | No data copy |
| **Platform config / feature flags** | Export flag snapshot from staging; import via admin API | Config GO |
| **Tenant / user data** | **Fresh prod seeds** — do not copy dev UAT passwords | Seed GO |
| **SDK applications (NSP/NYM)** | **Generate new prod keys** — hash in `sdk_app_api_keys` | **Key generation GO** |
| **Caselaw corpus (26M rows)** | **Explicit decision:** (A) logical replication / snapshot from caselaw-worker RDS, or (B) re-ingest from S3/parquet + embed backfill | **Corpus copy GO** — weeks of work |
| **CNR cache (796K+ rows)** | Migrate with corpus or rebuild via ingest scripts | Corpus GO |
| **Matter memory / tenant RAG** | Empty at cutover; customer migration per tenant | Per-tenant GO |

**NV-NO-KEY-ROTATION-DEV-001:** Copying nysdev **secrets** to prod is forbidden without explicit GO naming each secret.

### 5.4 10K tier connection & pool sizing

| Parameter | Value |
|---|---|
| Gateway replicas | 2–4 |
| `NYV_DB_POOL_MAX` | 40 per replica |
| Total app connections | ≤160 → use **PgBouncer transaction mode** if >3 replicas |
| Redis | 5–10 GB working set; monitor `used_memory` |
| Orchestrate wall clock | `NYV_ORCH_WALL_CLOCK_MS=540000` (ALB idle 600s) |

---

## 6. Secrets & configuration

### 6.1 SSM vs host env file

| Secret class | Primary store | Notes |
|---|---|---|
| `DATABASE_URL`, `NYV_DATABASE_URL` | Host `.env.production` + Secrets Manager backup | `sslmode=verify-full` + RDS CA bundle |
| `NYV_REDIS_TCP_URL` | Host env | TLS rediss:// for ElastiCache |
| `JWT_SECRET`, `NV_PII_ENCRYPTION_KEY` | Secrets Manager → synced to host overlay | **New values for prod** |
| `NYV_SDK_KEY_NSP`, `NYV_SDK_KEY_NYM`, partner SKUs | Generated prod keys → `sdk_applications` + host env | **Do not copy nysdev keys** |
| `NYS_KNOWLEDGE_API_KEY` | NYV host env | Must match `NYS_SDK_API_KEYS` on NYS worker |
| `NYS_SSO_LAUNCH_SECRET` | Both NYV + NYS host env | Same value both sides |
| LLM provider keys | Host env | Bedrock via IAM; Gemini/Sarvam/OpenRouter as keys |
| Deploy AWS creds | Operator workstation `product Documents/env.production` | SSM send-command only |
| SSM parameters | Instance IDs, bucket names, non-secret infra refs | Optional |

### 6.2 LLM configuration (mirror nysdev behaviour)

Production `.env.production` should match the **routing posture** of `docker-compose.aws-dev.yml`:

```bash
NYV_BEDROCK_ENABLED=on
NYV_ROUTER_BEDROCK_FIRST=on
AWS_BEDROCK_REGION=us-east-1
NYV_BEDROCK_REGION_ORDER=us-east-1,ap-south-1
NYV_ECOSYSTEM_BEST_OUTCOME=1
NYV_AUTO_RAG_EXTRAS_DEADLINE_MS=8000
NYV_F_NYS_KNOWLEDGE_PLANE=1
NYS_KNOWLEDGE_CB_FAILURES=12
NYS_KNOWLEDGE_CB_COOLDOWN_MS=10000
NYV_CASELAW_HYBRID_BUDGET_MS=12000
NYV_CASELAW_FTS_FALLBACK_BUDGET_MS=3000
NYV_ATHENA_QUERY_BUDGET_MS=15000
```

**Key rotation:** All LLM and SDK keys are **new for prod** — requires explicit user **GO** per [`DEMO-SESSION-CREDENTIALS-2026-08.md`](./DEMO-SESSION-CREDENTIALS-2026-08.md) policy (structure only).

### 6.3 SDK keys — NSP / NYM (prod generation)

| Step | Action |
|---|---|
| 1 | User **GO: generate prod NSP key** |
| 2 | User **GO: generate prod NYM key** |
| 3 | Insert into `sdk_applications` + `sdk_app_api_keys` (hashed) via admin script |
| 4 | Sync env names to `/opt/Nyayavigya/secrets/.env.production` |
| 5 | Gateway boot runs `nv-env-sdk-key-sync.ts` (NV-ENV-KEY-SYNC-001) |
| 6 | Deliver keys to partners via secure channel (Bitwarden / 1Password) — document in `NSP-API-KEYS-HANDOVER.md` (stamps only) |

### 6.4 Agent registry deployment

| Asset | Path in repo | Runtime path on gateway |
|---|---|---|
| Default registry (164 agents) | `config/agent-registries/Nyayavigya-Legal-registry-Default.json` | Bundled in gateway image / deploy tarball |
| Jurisdiction overlays | `Nyayavigya-Legal-registry-{IN,UK,US,EU,GC,SG}.json` | Merged per `NV_PRIMARY_JURISDICTION` |
| Alias map | `config/agent-registries/agent-id-aliases-v5.1.0.json` | Loaded at boot |
| Forensic archive (1,042) | `config/agent-registries/archive/v5.0.0/` | **Not loaded** unless `NV_REGISTRY_FORENSIC_MODE=1` |

**Verify post-deploy:** `GET /api/nv/health` → `totalAgents=164`, `registryVersion=5.1.0`.

### 6.5 NYV env vars — 10K rate limits, concurrency, RAG budgets

| Variable | Dev / demo | **Prod 10K target** |
|---|---|---|
| `NYV_DB_POOL_MAX` | 40 | 40 per replica; PgBouncer if >3 replicas |
| `NYV_ORCH_WALL_CLOCK_MS` | 540000 | 540000 (ALB 600s) |
| `NYV_PARTNER_MAX_TOKENS_FLOOR` | 16384 | 16384 |
| `NYV_NSP_UNLIMITED` | 1 (demo) | **0 or org-scoped** for paid GA — revisit billing |
| `NYV_RATE_LIMIT_PRO` | 1000 | 1000 RPM per org tier |
| `NYV_RATE_LIMIT_ENTERPRISE` | 0 (unlimited) | 0 or high cap with billing |
| `AI_MAX_CONCURRENT` | 10 | **40** non-stream; **60** stream per region |
| `NYV_PROMPT_BUDGET_*` / `NYV_OUTPUT_BUDGET_*` | defaults in `nv-prompt-budget.ts` | Keep; tune per tier |
| `NYV_PG_JOB_WORKER` | on | on |
| `NYV_QUEUE_WORKERS` | on | on; alert queue depth >500 |
| `NYV_STORAGE_BACKEND` | s3 | s3 |
| `AWS_S3_BUCKET` | dev bucket | `nyayavigya-prod-documents` |
| `NYV_F_MEM0_DURABLE` | 1 | 1 (matter memory durable) |
| `NYV_RLS_ENFORCE` | 0 on dev | **1** on prod after verify |

Full template: `nyayavigya-platform-312/.env.production.example`.

---

## 7. NYS integration

### 7.1 Caselaw worker deploy

| Step | Command / artefact | Target |
|---|---|---|
| Build API | `node build.mjs` in `NYS-Agentic-AI/` | `artifacts/api-server/dist/index.mjs` |
| Upload + deploy | `node scripts/upload-deploy.mjs --deploy` | S3 `nyv-sdk-distribution` → SSM → `/opt/nyv/api/` |
| Service | `nyv-api.service` systemd | `:8080` behind ALB |
| Env file | `/opt/nyv/api/.env` via `EnvironmentFile` | Never bash-source ( `$` in URLs) |
| Frontend (optional) | `upload-deploy.mjs --frontend --deploy` | NYS dashboard at `/patra-mitra` etc. |

### 7.2 NYV → NYS knowledge client URLs

Gateway env (prod):

```bash
NYV_F_NYS_KNOWLEDGE_PLANE=1
NYS_KNOWLEDGE_BASE_URL=https://nyayasearch.nyayasiddhi.com/api
NYS_KNOWLEDGE_API_KEY=<matches NYS_SDK_API_KEYS>
NYS_KNOWLEDGE_TIMEOUT_MS=15000
NYS_UI_BASE_URL=https://nyayasearch.nyayasiddhi.com
NYS_SSO_LAUNCH_SECRET=<shared secret>
```

**Proxy routes (unchanged paths):**

| NYV mount | NYS upstream |
|---|---|
| `/api/nv/knowledge/caselaw/*` | `/caselaw/*` |
| `/api/nv/knowledge/statutes/*` | `/statutes/*` |
| `/api/nv/knowledge/retrieve` | `/retrieve` |
| `/api/nv/v1/sdk/cnr/resolve` | NYS `resolveCnr` |

Smoke: `npx tsx scripts/nv-nys-knowledge-matrix.ts` with prod URLs.

### 7.3 CNR / Athena / parquet

| Component | Purpose |
|---|---|
| **Athena + Glue** | HC case-details CTAS; CNR enrichment |
| **S3 parquet** | Partitioned judgment metadata for batch analytics |
| **CNR RDS index** | Hot path `cnr_case_details` + `judgments_cnr_idx` |
| **NYV timeout policy** | `NYV_ATHENA_QUERY_BUDGET_MS=15000`; CNR tiered timeout |

Scripts on worker: `athena-hc-case-details-ctas.mjs`, `nys-cnr-index-sync.mjs`, `ingest-cnr-case-details.mjs`.

### 7.4 Embed backfill strategy (prod corpus)

| Phase | Action |
|---|---|
| **Pre-cutover** | Apply DDL + GIN/HNSW indexes on prod NYS RDS |
| **Corpus load** | Snapshot restore or ingest from existing parquet/S3 (requires **Corpus GO**) |
| **Embed workers** | `systemd-run embed-corpus.mjs` — 4 workers max; throttle during API peak |
| **Coverage target** | Match or exceed dev (~76%+ vector coverage); FTS live immediately |
| **Ongoing** | Cron: peak throttle 09:00 IST, full resume 21:00 IST (`NYS-EMBED-CNR-SCHEDULE.md`) |
| **Weekly delta** | `weekly-india-refresh.mjs` |

**Demo-safe CNR for prod smoke:** warm `TSWL000000742024` — avoid RJHC caseCreate in automated probes.

---

## 8. Storage (S3)

### 8.1 Document uploads & matter vault

| Flow | S3 layout | Gateway config |
|---|---|---|
| Legal Chat upload | `s3://nyayavigya-prod-documents/tenants/{orgId}/...` | `NYV_STORAGE_BACKEND=s3` |
| EDJ / shared docs | Partner-scoped prefixes | IAM policy per prefix |
| Matter vault | Encrypted at rest SSE-KMS | Pre-signed URL pattern |

### 8.2 Deploy bundles

| Bucket | Pattern |
|---|---|
| NYV | `s3://nyayavigya-prod-deploys/deploys/{deploy-id}-{sha}.tgz` |
| NYS | `s3://nyv-sdk-distribution/caselaw-worker/api/releases/*` |

### 8.3 Lifecycle, encryption, CORS

| Policy | Setting |
|---|---|
| Encryption | SSE-KMS for documents; bucket keys enabled |
| Versioning | ON for documents bucket |
| Lifecycle | Abort incomplete MPU 7d; IA transition 90d |
| CORS | Allow `https://console.nyayasiddhi.com`, `https://pro.nyayasiddhi.com`, `https://nym.nyayasiddhi.com` — PUT/GET for uploads |
| Public access | Block all public; CloudFront OAI for console static only |

---

## 9. Phased deployment plan

### Phase 0 — DNS, TLS, accounts (Week 1)

| Task | Owner | Acceptance criteria | Rollback |
|---|---|---|---|
| Register Route 53 zone `nyayasiddhi.com` | Infra | NS delegated | Revert NS |
| Issue ACM certs (api, console, nyayasearch, apex) | Infra | ISSUED status | — |
| Create prod AWS account/OU + billing alarms | Finance/Infra | Alarms active | — |
| Document subdomain map (§3) | Platform | Signed-off table | — |
| IAM roles + service quotas | Infra | Bedrock + SSM smoke | — |

### Phase 1 — RDS, Redis, S3 infra (Week 2)

| Task | Owner | Acceptance criteria | Rollback |
|---|---|---|---|
| VPC + subnets + SGs | Infra | Peering test optional | Tear down stack |
| RDS NYV Multi-AZ + NYS instance | DBA | Connect from bastion; pgvector ON | Snapshot delete |
| ElastiCache Redis HA | Infra | `PING` with AUTH/TLS | — |
| S3 buckets + policies | Infra | Test PUT/GET from role | — |
| Secrets Manager scaffolding | Security | Empty secrets created | — |

### Phase 2 — NYV gateway + console (Week 3)

| Task | Owner | Acceptance criteria | Rollback |
|---|---|---|---|
| Provision 2× NYV EC2 + ALB | Infra | ALB health checks pass | Previous TG |
| Install Docker; clone deploy pattern | Platform | Compose up gateway+console | Retag `:rollback-*` |
| Overlay `/opt/Nyayavigya/secrets/.env.production` | Security | **New prod secrets only** | LAST_GOOD.env pattern |
| `db:push` + indexes + seeds | Platform | Health 200, 164 agents | RDS restore |
| Route53 `api` + `console` → ALB | Infra | HTTPS 200 smoke | CNAME to dev |

### Phase 3 — NYS caselaw worker + data (Weeks 4–5)

| Task | Owner | Acceptance criteria | Rollback |
|---|---|---|---|
| NYS EC2 + ALB `nyayasearch` | Infra/NYS | `:8080/healthz` 200 | — |
| `upload-deploy.mjs --deploy` | NYS | index.mjs md5 logged | Prior manifest |
| Corpus load / snapshot (**GO**) | NYS ops | Row count ~26M | Re-snapshot |
| Apply NYS perf indexes | DBA | FTS <1s warm; hybrid <15s p95 target | Drop index |
| CNR + Athena parquet setup | NYS | CNR warm probe <2s | — |

### Phase 4 — RAG, memory, registry, SDK keys (Week 6)

| Task | Owner | Acceptance criteria | Rollback |
|---|---|---|---|
| Agent registries verified | Platform | health registry=5.1.0 | — |
| mem0 / matter memory durable | Platform | L2 write/read smoke | — |
| Tenant RAG pgvector indexes | Platform | Upload + grounded Q&A | — |
| Generate NSP/NYM prod SDK keys (**GO**) | Security | partner smoke 200 | Revoke keys |
| Embed backfill to target coverage | NYS | audit-coverage.mjs report | Pause workers |
| `product:readiness:10k` on prod URL | QA | ≥47/47 PASS | Fix + retest |

### Phase 5 — Cutover, smoke, monitoring (Week 7)

| Task | Owner | Acceptance criteria | Rollback |
|---|---|---|---|
| Lower TTL; switch partner URLs | Platform | Partners on `.com` | Revert DNS |
| Full UAT P0+P1 (`UAT-TEST-PLAN.md`) | QA | GREEN | Rollback DNS |
| CloudWatch alarms + SNS | SRE | Test alarm fires | — |
| WAF (optional) | Security | OWASP top 10 rules | Disable WAF |
| Post-cutover 72h watch | SRE | Error budget OK | Rollback deploy |

**Each phase requires explicit user GO before mutating production infrastructure.**

---

## 10. Post-deploy verification

### 10.1 UAT smoke (from `UAT-TEST-PLAN.md`)

Adapt hostnames to `.com`:

| Priority | Cases | Expected |
|---|---|---|
| P0 | S1–S5 health, login, swagger | All 200 |
| P1 | A1–A9 auth, RBAC, NSP/NYM API keys | JWT + SDK auth pass |
| P1 | LC1–LC9 Legal Chat happy path | SSE + RAG grounded |
| P2 | RQ1–RQ4 RAG quality | Adaptive/corrective/rerank visible |
| P2 | SDK1–SDK4 package smoke | Partner SDKs connect |

### 10.2 Prod probe adaptation

Extend `scripts/_ec2-demo-crosscheck-probe.sh` pattern:

```bash
NYV_BASE=https://api.nyayasiddhi.com \
NYS_BASE=https://nyayasearch.nyayasiddhi.com/api \
npm run partner:smoke:ec2   # with prod key mirror in .local/secrets/
```

Or SSM-side probe reading prod host canonical env (never print key values).

**Minimum live checks:**

| Probe | Pass criteria |
|---|---|
| `GET /api/nv/health` | 200; `totalAgents=164`; registry `5.1.0` |
| `POST /api/nv/orchestrate` (`legal-chat-fast`) | 200; <20s p95 |
| `GET /api/nv/knowledge/caselaw/search?mode=fts` | 200; <1s warm |
| `GET /api/nv/knowledge/caselaw/search` (default) | 200 or FTS fallback metadata |
| CNR `TSWL000000742024` | `found` / `nys_rds` |
| NYS `GET /api/healthz` | 200 |

### 10.3 10K load assumptions

| Metric | Target |
|---|---|
| Registered users | ~10,000 |
| Peak concurrent sessions | 300–800 |
| Orchestrate calls / month | 0.5M–2M |
| Burst orchestrate | 50–100 RPS for 15 min |
| Gateway replicas | 2–4 behind ALB |
| Caselaw queries / month | 200K–1M (mostly FTS at prod default) |

Run `nv-product-readiness-10k.ts` + break/soak on prod staging before cutover.

---

## 11. Cost estimate (Medium tier)

From [`13-Cloud-Cost-Reference.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/13-Cloud-Cost-Reference.md) — **AWS ap-south-1**, 10K users, optimised LLM mix:

| # | Line | USD/month |
|---|---|---|
| 1 | LLM (Bedrock/Gemini/Sarvam, optimised) | ~$52,000 |
| 2 | RDS NYV + NYS Multi-AZ | ~$2,800 |
| 3 | ElastiCache Redis HA | ~$520 |
| 4 | EC2 NYV 4 + NYS 2 + embed 1 | ~$3,600 |
| 5 | ALB + Route53 + WAF | ~$320 |
| 6 | S3 + data transfer | ~$550 |
| 7 | Embeddings (ongoing ingest) | ~$1,400 |
| 8 | CloudWatch + secrets | ~$280 |
| | **Total reference** | **~$61,500** |

**Without optimisation** (full Queen, no cache): **~$85,000–$95,000/month**.

**First-month CapEx-style provisioning (infra only):** **$4,500–$8,500** (Medium AWS).

**Corpus snapshot / cross-region copy (one-time):** budget separately — storage egress can add **$500–$5,000** depending on path.

---

## 12. Risks & explicit GO gates

| ID | Risk / gate | Mitigation |
|---|---|---|
| **NV-NO-KEY-ROTATION-DEV-001** | Accidental copy of nysdev secrets to prod | **New keys only**; separate `/opt/Nyayavigya/secrets/` on prod hosts |
| **NV-DEMO-SESSION-001** | Agent re-fetches dev keys from SSM | Prod uses new vault; handover doc stamps only |
| **GO: prod infrastructure** | Any RDS/EC2/ALB create | Named GO per phase |
| **GO: schema migrate** | `db:push` on prod | Eyeball diff; admin role only |
| **GO: corpus copy** | 26M row caselaw migrate | Maintenance window; verify row counts |
| **GO: SDK key generation** | NSP/NYM prod keys | Secure delivery; update partner handoff |
| **GO: LLM key generation** | Gemini/Sarvam/OpenRouter prod | Bedrock via IAM — no key |
| **GO: DNS cutover** | `.online` → `.com` | Parallel run + rollback CNAME |
| **GO: RLS enforce** | `NYV_RLS_ENFORCE=1` | Staging verify first |
| Hybrid search latency | 25s+ under embed load | Default FTS at gateway; hybrid budget 12s + fallback |
| Phase5 boot DDL errors | Permission denied noise | Pre-migrate tables; gate runtime DDL |
| Single-AZ dev habits | Prod outage | Multi-AZ mandatory Medium+ |
| Partner contract freeze | URL/key change breaks NSP/NYM | Freeze window + coordinated cutover |

---

## Appendix A — Deploy command reference

### NYV (prod host)

```bash
# From nyayavigya-platform-312/ — after prod instance ID + bucket configured
bash scripts/deploy-aws-ssm.sh --note "prod initial deploy"
```

Requires: `NYV_EC2_INSTANCE_ID`, `NYV_DEPLOY_BUCKET`, AWS creds in operator env.

### NYS (prod caselaw worker)

```bash
# From NYS-Agentic-AI/
node build.mjs
cd scripts && node upload-deploy.mjs --deploy
```

### Schema (admin bastion)

```bash
cd nyayavigya-platform-312
DATABASE_URL_ADMIN=postgres://nyvadmin:***@prod-rds:5432/nyayavigya?sslmode=verify-full \
  npm run db:push
npx tsx src/db/create-indexes.ts
```

---

## Appendix B — Related documents

| Document | Purpose |
|---|---|
| [`06-AWS-PRODUCTION-DEPLOYMENT.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/06-AWS-PRODUCTION-DEPLOYMENT.md) | ShareReady deploy topology |
| [`13-Cloud-Cost-Reference.md`](./Nyayavigya%20Documents%205.0.0-ShareReady-2026-08/13-Cloud-Cost-Reference.md) | Cost tiers |
| [`FEATURES-REGISTRY.md`](../nyayavigya-platform-312/FEATURES-REGISTRY.md) | Wired feature audit |
| [`UAT-TEST-PLAN.md`](./UAT-TEST-PLAN.md) | Go-live UAT |
| [`PRODUCT-READINESS-UAT-10K.md`](./PRODUCT-READINESS-UAT-10K.md) | Executable 10K gate |
| [`NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md`](./NYS-KNOWLEDGE-PLANE-INTEGRATION-2026-07.md) | Federation contract |

---

## Revision history

| Date | Change |
|---|---|
| 2026-09-03 | Initial production deployment plan for nyayasiddhi.com |
