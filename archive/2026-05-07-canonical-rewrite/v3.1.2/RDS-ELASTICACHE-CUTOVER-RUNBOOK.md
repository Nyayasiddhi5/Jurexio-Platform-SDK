# RDS + ElastiCache Cutover Runbook — dev-edge

**Created:** 2026-04-25
**Operator-authorised:** yes (~$37/mo footprint acknowledged)
**Scope:** `infra/terraform/envs/dev-edge` — dev-edge environment only
**Pre-conditions:** `enable_managed_datastores = true` written to `infra/terraform/envs/dev-edge/terraform.tfvars` (already done)

This runbook is the safe, audited path from "edge-only dev-edge" → "dev-edge with managed RDS Postgres + ElastiCache Redis." Every step is reversible until the cutover script is run.

---

## When to run from Replit (this workspace) vs from EC2

| Scenario | Where to run |
|---|---|
| You have AWS credentials in Replit secrets AND the Terraform state is local-file or S3-backed and reachable from Replit | **Replit** (this workspace) |
| Terraform state lives in an S3 bucket only the EC2 box can reach (typical for hardened envs) | **From the EC2 box** (`13.232.165.242`) |
| State backend uses an SSO profile or assume-role chain that isn't replicated in Replit | **From your workstation or EC2** |

Look at `infra/terraform/envs/dev-edge/backend.tf` to see which applies. This dev-edge env's backend is configured for the EC2 box, so the recommended path is **from the EC2 instance**.

---

## Path A — Run from the EC2 instance (recommended for dev-edge)

### 1. SSH into the box

```bash
ssh -i .local/keys/nysdev.pem ubuntu@13.232.165.242
cd /opt/nyayavigya/repo/nyayavigya-platform-312/infra/terraform/envs/dev-edge
```

### 2. Pull the latest code (so the new tfvars file is on the box)

```bash
git -C /opt/nyayavigya/repo/nyayavigya-platform-312 fetch origin
git -C /opt/nyayavigya/repo/nyayavigya-platform-312 reset --hard origin/main
```

Or if deploys land via tarball (the default `pnpm deploy` mode), the new tfvars will arrive with the next deploy.

### 3. Initialise + plan

```bash
terraform init -upgrade
terraform plan -out=enable-datastores.tfplan
```

Expected diff (high level):
- `+ module.rds[0].aws_db_subnet_group.this`
- `+ module.rds[0].aws_security_group.rds`
- `+ module.rds[0].aws_db_instance.this` — `db.t4g.small`, 20GB gp3, 7-day PITR
- `+ module.rds[0].aws_secretsmanager_secret.password`
- `+ module.elasticache[0].aws_elasticache_subnet_group.this`
- `+ module.elasticache[0].aws_security_group.redis`
- `+ module.elasticache[0].aws_elasticache_replication_group.this` — `cache.t4g.micro`, 0 replicas
- `+ module.elasticache[0].aws_secretsmanager_secret.auth_token`

Total: **~14 resources to add, 0 to change, 0 to destroy.** Provisioning takes ~10-12min (RDS dominates).

### 4. Apply

```bash
terraform apply enable-datastores.tfplan
```

Watch for: `Apply complete! Resources: 14 added, 0 changed, 0 destroyed.`

### 5. Capture endpoints + secret ARNs

```bash
terraform output -json datastores | jq
```

Outputs are marked `sensitive = true`, so you must use `-json` to read them. Capture:
- `rds.address` and `rds.secret_arn`
- `redis.primary_endpoint` and `redis.secret_arn`

### 6. Run the cutover migration

```bash
cd /opt/nyayavigya/repo/nyayavigya-platform-312
bash scripts/migrate-to-managed-datastores.sh --env dev-edge
```

What this does:
1. Pulls `DATABASE_URL` from the new RDS secret ARN, `NYV_REDIS_TCP_URL` from the ElastiCache auth-token ARN.
2. Writes both to `/opt/nyayavigya/.env` on the EC2 box (atomically).
3. Runs a one-shot `pg_dump` from the existing in-container Postgres → `psql` into the new RDS instance (10–60s for dev data volumes).
4. Bounces the gateway containers via `docker compose up -d gateway worker`.
5. Stops the old `nyv-postgres` and `nyv-redis` containers (data is preserved on disk for ~7 days; safe rollback).
6. Polls `http://127.0.0.1:5000/api/nv/health/full` until `db.status = healthy` AND `redis.status = healthy` AND `redis.details.mode = "ioredis_tcp"`.

### 7. Verify

```bash
curl -s http://127.0.0.1:5000/api/nv/admin/health/full | jq '{
  db: .checks.database,
  redis: .checks.redis,
  queues: .checks.queues
}'
```

Expected:
- `db.status = "healthy"`, `db.details.mode contains "rds"`
- `redis.status = "healthy"`, `redis.details.mode = "ioredis_tcp"`
- `queues.enabled = true`, `queues.live = true`

Also check WRONGPASS noise is gone:
```bash
docker compose logs gateway --tail=200 | grep -ci wrongpass
# expected: 0
```

### 8. Rollback (if needed within 7 days)

```bash
bash scripts/migrate-to-managed-datastores.sh --env dev-edge --rollback
```

Restores the previous `.env`, restarts `nyv-postgres` + `nyv-redis` containers from their preserved volumes, bounces the gateway. To also tear down the AWS resources:

```bash
cd infra/terraform/envs/dev-edge
echo 'enable_managed_datastores = false' > terraform.tfvars
terraform apply -auto-approve
```

---

## Path B — Run from this Replit workspace (only if state backend is reachable)

### Prerequisites

- AWS credentials in Replit secrets — confirmed: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are set.
- Terraform CLI installed in workspace — `terraform version` should print `>= 1.5`.
- State backend reachable — try `terraform init` first; if it errors with `Error loading state`, fall back to Path A.

### Steps

```bash
cd nyayavigya-platform-312/infra/terraform/envs/dev-edge
terraform init -upgrade
terraform plan -out=enable-datastores.tfplan
# Review the plan. Expect ~14 adds, 0 changes, 0 destroys.
terraform apply enable-datastores.tfplan
terraform output -json datastores | jq
```

Then SSH to the EC2 box for the cutover migration step (step 6 above) — that step has to run on the box where the gateway containers are.

---

## Decision matrix — which path?

```
Question 1: Is the Terraform state backend in S3 with role-restricted access?
  YES → Path A (EC2)
  NO  → continue

Question 2: Does `terraform init` from Replit succeed without errors?
  YES → Path B is fine
  NO  → Path A
```

---

## Cost summary (for the audit log)

| Resource | Spec | Monthly (Mumbai) |
|---|---|---|
| RDS Postgres | db.t4g.small, 20GB gp3, 7d PITR, single-AZ | ~$25 |
| ElastiCache Redis | cache.t4g.micro, 0 replicas | ~$12 |
| Secrets Manager | 2 secrets | ~$0.80 |
| **Total** | | **~$38/mo** |

Multi-AZ adds ~$25/mo. Read-replica adds ~$25/mo. Both off by default for dev-edge.

---

## Audit trail entry

After successful cutover, append to `Project-Tracker.md` §5:

```
### YYYY-MM-DDThh:mmZ — RDS+ElastiCache cutover complete (dev-edge)
- enable_managed_datastores = true (terraform apply)
- Cutover migration: pg_dump → RDS in <duration>s
- Gateway bounced, /admin/health/full reports db=healthy, redis=healthy(ioredis_tcp), queues=live
- Old nyv-postgres + nyv-redis containers stopped (volumes preserved for 7d)
```
