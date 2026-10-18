# JRX AWS infrastructure — options and runbook

**Goal:** Jurexio Enterprise Platform on **separate** AWS resources from jrx-prod / Jurexio.  
**Temporary (optional):** Reuse **Bedrock** configuration from JRX until JRX smoke passes — only when `JRX_SSM_COPY_FROM_JRX=1` on `jrx-ssm-bootstrap-bedrock-smoke.sh`. Greenfield US should populate **JRX-native** `/jurexio/prod/*` names directly (see SSM table below).

### Pre-deploy platform closeout (before any `--apply` or `jrx-deploy-aws-ssm.sh`)

Complete repo-side **naming, console IA, legacy script archive, and SSM param documentation** on `main` (or the pre-deploy closeout branch) **before** operator **GO** for live AWS. This runbook assumes that closeout is merged; do not populate live SSM or deploy to EC2 until then.

---

## What this agent environment can and cannot do

| Action | Status |
|--------|--------|
| Author deploy + SSM bootstrap + Option B apply scripts in this repo | **Done** (see `scripts/jrx-*.sh`, `jrx-infra-apply-option-b.sh`) |
| Create RDS / EC2 / OpenSearch from Cursor cloud shell | **Blocked** — `aws sts get-caller-identity` → `NoCredentials` here |
| You run provisioning on a machine with `aws login` or `product Documents/env.production` | **Required** for live infra |

---

## Architecture options (pick one for smoke vs production)

### Option A — **Smoke stack (recommended first)** — one new EC2

| Component | Implementation | Isolation |
|-----------|----------------|-----------|
| **EC2** | New instance (e.g. `t3.xlarge`), new SG | Not jrx-prod |
| **App DB** | Postgres + Redis **on same EC2** via `docker-compose.jurexio-aws.yml` | Not JRX RDS |
| **RAG** | pgvector in same Postgres (`jurexio` DB) | Logical separation |
| **Search** | `jrx-search` container on same host (US fixture corpus) | No India Athena |
| **Bedrock** | JRX-native SSM under `/jurexio/prod/*` (optional JRX copy) | Isolated prefix |

**Pros:** Fast, cheap, full smoke. **Cons:** Not production HA.

### Option B — **Split data plane** — EC2 + managed RDS + Redis

| Component | Implementation |
|-----------|----------------|
| **RDS** | **New** `db.t4g.medium` Postgres 15 **or** logical DB `jurexio` on a **new** RDS instance (not `jurexio` DB) |
| **Redis** | New ElastiCache cluster **or** dedicated Redis on EC2 |
| **RAG** | pgvector on JRX RDS; optional **OpenSearch Serverless** later for JRX Search scale |
| **EC2** | Gateway + Console + worker only |

**Pros:** Closer to prod. **Cons:** VPC/subnet group/SG setup, cost.

### Option C — **Full production** (post-smoke)

- Multi-AZ RDS, ElastiCache, OpenSearch Serverless `jrx-search-vectors`, separate EC2 for `jrx-search`, ALB + `api.<jurexio-domain>`.

---

## SSM layout (never overwrite JRX paths)

Create only under **`/jurexio/prod/`**:

| Parameter | Purpose |
|-----------|---------|
| `DATABASE_URL` | JRX Postgres |
| `JRX_REDIS_TCP_URL` | Redis |
| `JRX_JWT_SECRET` / `JRX_JWT_REFRESH_SECRET` | Auth |
| `JRX_PII_ENCRYPTION_KEY` | Vault |
| `JRX_SDK_KEY_ENTERPRISE` | SDK smoke |
| `JRX_BEDROCK_ENABLED`, `JRX_ROUTER_BEDROCK_FIRST`, `AWS_BEDROCK_REGION`, `JRX_BEDROCK_REGION_ORDER`, `BEDROCK_MODEL_ID` | Bedrock smoke (set directly or via optional JRX copy) |
| `JRX_SEARCH_BASE_URL` / `JRX_SEARCH_API_KEY` | Worker federation |

**Forbidden:** Writing to `/nyv/*`, `/jurexio/*`, or editing jrx-prod `/opt/Jurexio/secrets/.env.production`.

---

## Runbook (operator with AWS creds)

### 1. Bootstrap SSM (Bedrock + LLM smoke — no rotation)

```bash
cd Jurexio-Platform-SDK
# Greenfield: export JRX_* bedrock vars locally, then:
bash scripts/jrx-ssm-bootstrap-bedrock-smoke.sh --dry-run
bash scripts/jrx-ssm-bootstrap-bedrock-smoke.sh
# Legacy JRX account only:
# JRX_SSM_COPY_FROM_JRX=1 JRX_SSM_SOURCE_PREFIX=/jurexio/dev bash scripts/jrx-ssm-bootstrap-bedrock-smoke.sh
```

### 2. EC2 (new instance)

```bash
bash scripts/jrx-infra-plan-ec2.sh --dry-run    # prints suggested CLI (no create)
# After GO: launch instance, attach IAM role (SSM + Bedrock), open 443/5000/22 as needed
#
# EC2 instance profile (inline policy name suggestion: `JrxProdEc2DeployRolePolicy`) should allow at minimum:
#   - ssm:SendCommand, ssm:GetCommandInvocation, ssm:ListCommandInvocations (deploy + jrx-smoke-ec2.sh)
#   - secretsmanager:GetSecretValue on the JRX RDS secret ARN (bootstrap DATABASE_URL on host)
#   - s3:GetObject on `JRX_DEPLOY_BUCKET` artifact prefix (deploy tarball pull)
#   - ssm:PutParameter on `/jurexio/prod/*` — optional; only if deploy script writes SSM from the host
# Set in env.production.jurexio (local, gitignored):
#   JRX_EC2_INSTANCE_ID=i-xxxxxxxx
#   JRX_AWS_REGION=ap-south-1
#   JRX_DEPLOY_BUCKET=jurexio-deploy-artifacts   # new bucket or prefix
```

### 3. Option B — full split stack (RDS + Redis + EC2 + S3)

Idempotent provisioner (default **dry-run**; live create requires `--apply`):

```bash
cd Jurexio-Platform-SDK
bash scripts/jrx-infra-apply-option-b.sh              # plan only
bash scripts/jrx-infra-apply-option-b.sh --apply        # after explicit GO
# Optional Bedrock SSM copy ( /jurexio/prod/* only ):
JRX_BOOTSTRAP_SSM=1 bash scripts/jrx-infra-apply-option-b.sh --apply
```

Writes resource IDs (no secrets) to **`env.production.jurexio.generated`** (gitignored).  
Env knobs: `JRX_AWS_REGION`, `JRX_DEPLOY_BUCKET`, `JRX_VPC_ID`, `JRX_IAM_INSTANCE_PROFILE`.

Post-RDS: pgvector + app role — same pattern as `jrx-provision-rds-database.sh` (script prints steps; set `JRX_RDS_ADMIN_URL` to run automatically on `--apply`). After first boot with `JRX_AUDIT_CHAIN_TOLERATE=1`, run `npm run seed:audit-greenfield` (or `bash scripts/jrx-seed-audit-greenfield.sh`) then remove `JRX_AUDIT_CHAIN_TOLERATE=1` from host secrets and recreate gateway.

Legacy plan-only helpers: `jrx-infra-plan-rds.sh`, `jrx-infra-plan-ec2.sh`.

### 4. RDS logical DB only (existing instance)

```bash
export JRX_RDS_ADMIN_URL='postgres://...'   # from SSM, do not commit
bash scripts/jrx-provision-rds-database.sh
```

### 5. Deploy application

```bash
source /path/to/env.production.jurexio   # AWS keys + JRX_EC2_INSTANCE_ID
bash scripts/jrx-deploy-aws-ssm.sh --note "JRX initial smoke"
bash scripts/jrx-smoke-ec2.sh
```

**Deploy SSM timing:** `jrx-deploy-aws-ssm.sh` runs two SSM phases (build, then compose+health) with default `JRX_SSM_TIMEOUT_SECONDS=7200` so slow `docker compose build` does not false-fail before `/api/jrx/health` is 200.

**RDS TLS:** Gateway images ship `certs/rds-global-bundle.pem` (refresh via `bash scripts/jrx-download-rds-ca-bundle.sh`); override path with `JRX_RDS_CA_BUNDLE_PATH` if needed.

### 6. Cursor workspace

Open **`Jurexio-Platform-SDK.code-workspace`** (repo root) — not the Jurexio monorepo parent.

---

## RAG instance clarification

| Name in request | Jurexio mapping |
|-----------------|-----------------|
| **RAG instance** | Phase 1: **Postgres pgvector** on JRX DB (gateway RAG routes). Phase 2: OpenSearch Serverless for JRX Search US corpus. |
| **Not used for JRX** | JRX India caselaw RDS/Athena, jrx-prod NYS corpus |

---

## Evidence after smoke

Log in `Project-Tracker.md`: deploy id, instance id, `/api/jrx/health` HTTP code, `guardrail:jrx-brands` PASS. No secret values in tracker.
