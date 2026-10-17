# JRX AWS infrastructure — options and runbook

**Goal:** Jurexio Enterprise Platform on **separate** AWS resources from nysdev / Nyayavigya.  
**Temporary:** Reuse **Bedrock** configuration from NYV until JRX smoke passes (copy into `/jurexio/prod/*`, do not edit nysdev `/opt/Nyayavigya/secrets`).

---

## What this agent environment can and cannot do

| Action | Status |
|--------|--------|
| Author deploy + SSM bootstrap scripts in this repo | **Done** (see `scripts/jrx-*.sh`) |
| Create RDS / EC2 / OpenSearch from Cursor cloud shell | **Blocked** — `aws sts get-caller-identity` → `NoCredentials` here |
| You run provisioning on a machine with `aws login` or `product Documents/env.production` | **Required** for live infra |

---

## Architecture options (pick one for smoke vs production)

### Option A — **Smoke stack (recommended first)** — one new EC2

| Component | Implementation | Isolation |
|-----------|----------------|-----------|
| **EC2** | New instance (e.g. `t3.xlarge`), new SG | Not nysdev |
| **App DB** | Postgres + Redis **on same EC2** via `docker-compose.jurexio-aws.yml` | Not NYV RDS |
| **RAG** | pgvector in same Postgres (`jurexio` DB) | Logical separation |
| **Search** | `jrx-search` container on same host (US fixture corpus) | No India Athena |
| **Bedrock** | Env copied from NYV SSM → `/jurexio/prod/*` | Same keys, different SSM prefix |

**Pros:** Fast, cheap, full smoke. **Cons:** Not production HA.

### Option B — **Split data plane** — EC2 + managed RDS + Redis

| Component | Implementation |
|-----------|----------------|
| **RDS** | **New** `db.t4g.medium` Postgres 15 **or** logical DB `jurexio` on a **new** RDS instance (not `nyayavigya` DB) |
| **Redis** | New ElastiCache cluster **or** dedicated Redis on EC2 |
| **RAG** | pgvector on JRX RDS; optional **OpenSearch Serverless** later for JRX Search scale |
| **EC2** | Gateway + Console + worker only |

**Pros:** Closer to prod. **Cons:** VPC/subnet group/SG setup, cost.

### Option C — **Full production** (post-smoke)

- Multi-AZ RDS, ElastiCache, OpenSearch Serverless `jrx-search-vectors`, separate EC2 for `jrx-search`, ALB + `api.<jurexio-domain>`.

---

## SSM layout (never overwrite NYV paths)

Create only under **`/jurexio/prod/`**:

| Parameter | Purpose |
|-----------|---------|
| `DATABASE_URL` | JRX Postgres |
| `JRX_REDIS_TCP_URL` | Redis |
| `JRX_JWT_SECRET` / `JRX_JWT_REFRESH_SECRET` | Auth |
| `JRX_PII_ENCRYPTION_KEY` | Vault |
| `JRX_SDK_KEY_ENTERPRISE` | SDK smoke |
| `JRX_BEDROCK_ENABLED`, `JRX_ROUTER_BEDROCK_FIRST`, `AWS_BEDROCK_REGION` | Copied from NYV for smoke |
| `JRX_SEARCH_BASE_URL` / `JRX_SEARCH_API_KEY` | Worker federation |

**Forbidden:** Writing to `/nyv/*`, `/nyayavigya/*`, or editing nysdev `/opt/Nyayavigya/secrets/.env.production`.

---

## Runbook (operator with AWS creds)

### 1. Bootstrap SSM (Bedrock + LLM smoke — copy, no rotation)

```bash
cd Jurexio-Platform-SDK
# Loads AWS from product Documents/env.production or env
bash scripts/jrx-ssm-bootstrap-bedrock-smoke.sh --dry-run   # lists actions only
bash scripts/jrx-ssm-bootstrap-bedrock-smoke.sh             # copies SecureString params
```

### 2. EC2 (new instance)

```bash
bash scripts/jrx-infra-plan-ec2.sh --dry-run    # prints suggested CLI (no create)
# After GO: launch instance, attach IAM role (SSM + Bedrock), open 443/5000/22 as needed
# Set in env.production.jurexio (local, gitignored):
#   JRX_EC2_INSTANCE_ID=i-xxxxxxxx
#   JRX_AWS_REGION=ap-south-1
#   JRX_DEPLOY_BUCKET=jurexio-deploy-artifacts   # new bucket or prefix
```

### 3. RDS (if Option B)

```bash
# New instance: see jrx-infra-plan-rds.sh --dry-run
# OR logical DB on NEW RDS only:
export JRX_RDS_ADMIN_URL='postgres://...'   # from SSM, do not commit
bash scripts/jrx-provision-rds-database.sh
```

### 4. Deploy application

```bash
source /path/to/env.production.jurexio   # AWS keys + JRX_EC2_INSTANCE_ID
bash scripts/jrx-deploy-aws-ssm.sh --note "JRX initial smoke"
bash scripts/jrx-smoke-ec2.sh
```

### 5. Cursor workspace

Open **`Jurexio-Platform-SDK.code-workspace`** (repo root) — not the Nyayavigya monorepo parent.

---

## RAG instance clarification

| Name in request | Jurexio mapping |
|-----------------|-----------------|
| **RAG instance** | Phase 1: **Postgres pgvector** on JRX DB (gateway RAG routes). Phase 2: OpenSearch Serverless for JRX Search US corpus. |
| **Not used for JRX** | NYV India caselaw RDS/Athena, nysdev NYS corpus |

---

## Evidence after smoke

Log in `Project-Tracker.md`: deploy id, instance id, `/api/jrx/health` HTTP code, `guardrail:jrx-brands` PASS. No secret values in tracker.
