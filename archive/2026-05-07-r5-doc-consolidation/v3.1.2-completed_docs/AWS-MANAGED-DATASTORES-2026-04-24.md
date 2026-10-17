---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# AWS Managed Datastores — Handoff (Task #17, 2026-04-24)

Move the dev environment off the container-local `nyv-postgres` and `nyv-redis`
that ride along on the single nysdev EC2 box, and onto AWS-managed Postgres
(RDS) and Redis (ElastiCache). Result: nightly backups, point-in-time recovery,
crash isolation from the application host. Estimated added cost ~USD 37/month
(db.t4g.small ≈ $25, cache.t4g.micro ≈ $12).

This is a sibling document to `AWS-DNS-HANDOFF-2026-04-24.md`. The Terraform
state lives in the same `dev-edge` workspace.

---

## 1. What changed in code

| File | Change |
|---|---|
| `infra/terraform/envs/dev-edge/variables.tf` | Added `enable_managed_datastores` (default `false`) and tuning variables `rds_instance_class`, `rds_allocated_storage_gb`, `rds_max_storage_gb`, `rds_backup_retention_days`, `redis_node_type`. |
| `infra/terraform/envs/dev-edge/main.tf` | Added `module.rds[0]` and `module.elasticache[0]` (count-gated on the new var). Added `output "datastores"` (sensitive) carrying endpoints + Secrets Manager ARNs. |
| `scripts/migrate-to-managed-datastores.sh` | One-shot, idempotent cutover runbook (preflight → pg_dump → psql restore → .env rewrite → gateway restart → stop legacy containers → optional `--rollback`). |

The two-phase apply contract from Task #11 is preserved: `terraform apply`
remains a no-op on the existing dev-edge stack until an operator passes
`-var enable_managed_datastores=true`.

The new SGs only allow ingress from the existing nysdev SG
(`sg-0ba15ba2b74a651fb`) — nothing else in the VPC, and nothing from the
internet, can reach Postgres on 5432 or Redis on 6379. RDS is created with
`publicly_accessible = false` (module default). Redis uses `transit_encryption`
and `at_rest_encryption` (module default), so the URL the cutover script writes
into `.env` is `rediss://` (TLS).

---

## 2. Apply order

```bash
export PATH=$HOME/.local/bin:$PATH
cd nyayavigya-platform-312/infra/terraform/envs/dev-edge

# Plan first — expect ~15 resources to add (RDS, subnet group, parameter group,
# SG + ingress rule, secret + version, random_password, plus the same set for
# ElastiCache, plus the Redis replication group itself).
terraform plan -var enable_managed_datastores=true

# Apply (RDS provisioning takes 8–12 minutes; ElastiCache 5–7 minutes).
terraform apply -input=false -auto-approve -var enable_managed_datastores=true

# Read endpoints + secret ARNs (sensitive output, requires -json).
terraform output -json datastores | jq
```

Expected output shape:

```json
{
  "enabled": true,
  "rds": {
    "address":     "nyv-dev-edge-pg.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com",
    "endpoint":    "nyv-dev-edge-pg.xxxxxxxxxxxx.ap-south-1.rds.amazonaws.com:5432",
    "instance_id": "nyv-dev-edge-pg",
    "secret_arn":  "arn:aws:secretsmanager:ap-south-1:789925699169:secret:nyv-dev-edge-pg/rds/master-XXXXXX",
    "sg_id":       "sg-...redacted..."
  },
  "redis": {
    "primary_endpoint": "master.nyv-dev-edge-redis.xxxxx.aps1.cache.amazonaws.com",
    "reader_endpoint":  "replica.nyv-dev-edge-redis.xxxxx.aps1.cache.amazonaws.com",
    "secret_arn":       "arn:aws:secretsmanager:ap-south-1:789925699169:secret:nyv-dev-edge-redis/redis/auth-XXXXXX",
    "sg_id":            "sg-...redacted..."
  }
}
```

---

## 3. Cutover on nysdev EC2 (the maintenance window)

Picks a quiet window, ~15 minutes wall-clock from start to gateway-back-up.

```bash
# From the Replit shell or your laptop:
ssh -i .local/keys/nysdev.pem ubuntu@13.232.165.242 \
  'bash -s' < nyayavigya-platform-312/scripts/migrate-to-managed-datastores.sh -- --all

# Or, copy the script onto the box once and run phases manually:
scp -i .local/keys/nysdev.pem \
  nyayavigya-platform-312/scripts/migrate-to-managed-datastores.sh \
  ubuntu@13.232.165.242:/tmp/

ssh -i .local/keys/nysdev.pem ubuntu@13.232.165.242
sudo install -m 0755 /tmp/migrate-to-managed-datastores.sh /usr/local/bin/
sudo migrate-to-managed-datastores.sh --preflight    # IAM + SG + container check
sudo migrate-to-managed-datastores.sh --dump         # pg_dump -> /opt/nyayavigya/migration/<ts>.sql.gz
sudo migrate-to-managed-datastores.sh --restore      # psql restore into RDS
sudo migrate-to-managed-datastores.sh --cutover      # rewrite .env, recreate gateway, stop legacy containers
```

Each phase records a marker in `/opt/nyayavigya/migration/state/`, so re-running
is safe — phases that already completed are skipped. To re-run a phase, delete
its marker file first.

What `--cutover` does, in order:
1. Backs up `.env` → `.env.pre-rds.<utc-timestamp>` and a stable `.env.pre-rds`
   pointer for `--rollback`.
2. Rewrites the three keys in `.env`:
   - `DATABASE_URL=postgres://nyvadmin:<pw>@<rds-host>:5432/nyayavigya?sslmode=require`
   - `NYV_REDIS_TCP_URL=rediss://:<auth>@<redis-host>:6379/0`
   - `REDIS_URL=rediss://:<auth>@<redis-host>:6379/0`
3. `docker compose -f docker-compose.ecosystem.yml up -d --force-recreate gateway-a gateway-b`.
4. Polls `http://127.0.0.1/health` for up to 120 s.
5. On success: `docker stop nyv-postgres nyv-redis` (volumes preserved).
   On failure: leaves the legacy containers running and exits non-zero —
   operator runs `--rollback` to put the old `.env` back and recreate gateways.

Once you've verified RDS retains data correctly for 24 h, you can permanently
remove the legacy containers:

```bash
docker rm nyv-postgres nyv-redis
docker volume rm $(docker volume ls -q --filter name=pgdata)
docker volume rm $(docker volume ls -q --filter name=redisdata)
```

---

## 4. Backups + PITR

RDS daily snapshot retention is set to **7 days** (the task's "at least 7"
floor) via `var.rds_backup_retention_days`. Verify after apply:

```bash
aws rds describe-db-instances --region ap-south-1 \
  --db-instance-identifier nyv-dev-edge-pg \
  --query 'DBInstances[0].{backup:BackupRetentionPeriod,window:PreferredBackupWindow,status:DBInstanceStatus}'
# expect: {"backup": 7, "window": "18:00-18:30", "status": "available"}
```

The first automated snapshot lands at the next 18:00 UTC (23:30 IST) backup
window. Manual snapshot any time:

```bash
aws rds create-db-snapshot --region ap-south-1 \
  --db-instance-identifier nyv-dev-edge-pg \
  --db-snapshot-identifier nyv-dev-edge-pg-manual-$(date -u +%Y%m%d%H%M)
```

ElastiCache Redis snapshot retention is **7 days** (module default,
`snapshot_retention_limit = 7`); window 18:30–19:30 UTC.

---

## 5. Rollback

If something is wrong **inside the cutover window** (gateway won't pass health,
schema mismatch, etc.):

```bash
sudo migrate-to-managed-datastores.sh --rollback
# - restores .env from .env.pre-rds
# - docker start nyv-postgres nyv-redis
# - force-recreates gateway-a and gateway-b
```

If something is wrong **after** you've removed the legacy containers + volumes,
recovery is from the RDS PITR window or from the `/opt/nyayavigya/migration/<ts>.sql.gz`
dump file:

```bash
# Re-bring up a temporary container Postgres to receive the dump.
docker run -d --name nyv-postgres-recovery -p 5433:5432 \
  -e POSTGRES_USER=nyv -e POSTGRES_PASSWORD=temp -e POSTGRES_DB=nyayavigya \
  postgres:16-alpine
gunzip -c /opt/nyayavigya/migration/latest.sql.gz | \
  PGPASSWORD=temp psql -h 127.0.0.1 -p 5433 -U nyv -d nyayavigya -1
```

---

## 6. Teardown

To remove the managed datastores (and stop paying for them) without disturbing
the rest of the dev-edge stack:

```bash
cd nyayavigya-platform-312/infra/terraform/envs/dev-edge
terraform apply -var enable_managed_datastores=false
```

Terraform will destroy the RDS instance, ElastiCache replication group, both
SGs, both Secrets Manager entries, the parameter group, and the subnet group.
Because `deletion_protection = false` and `skip_final_snapshot = false`, RDS
takes a final snapshot first (named `nyv-dev-edge-pg-final-<utc-ts>`); recover
later by restoring that snapshot into a new instance.
