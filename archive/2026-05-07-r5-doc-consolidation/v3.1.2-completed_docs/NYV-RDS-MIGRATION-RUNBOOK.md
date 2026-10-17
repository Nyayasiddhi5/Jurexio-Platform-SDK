---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# RDS migration runbook

How to move from any current Postgres host (local, Replit-managed, or older
single-AZ RDS) to the Terraform-managed multi-AZ RDS Postgres 16 instance.

## Before you start

- [ ] Take a fresh `pg_dumpall` from the source.
      `pg_dumpall -h <src_host> -U <src_user> --clean --if-exists > pre-migration.sql`
- [ ] Note the source schema list. If you have non-default schemas, set
      `NYV_DB_SCHEMAS=public,nyv_mem0,…` in `.env` before booting the gateway
      against the new RDS.
- [ ] Verify staging RDS is healthy: `make plan` in `infra/terraform/envs/staging`
      shows zero diff.

## Step-by-step (production)

### 1. Capture a baseline from prod source

```bash
PG_SRC=postgresql://user:pass@old-host:5432/nyayavigya
mkdir -p archive/2026-04-cleanup/db-audit
pg_dump --format=custom --no-owner --no-privileges --verbose \
        "$PG_SRC" \
        > archive/2026-04-cleanup/db-audit/prod-pre-migration.dump
ls -lh archive/2026-04-cleanup/db-audit/
```

### 2. Apply Terraform to provision the RDS instance

```bash
cd infra/terraform/envs/prod
terraform plan -out tfplan
terraform apply tfplan
```

Note the outputs:
- `rds_endpoint`
- `rds_secret_arn` (the master credentials)

### 3. Pull the master credentials from Secrets Manager

```bash
SECRET=$(aws secretsmanager get-secret-value \
           --region ap-south-1 \
           --secret-id "$(terraform output -raw rds_secret_arn)" \
           --query SecretString --output text)

PGHOST=$(jq -r .host <<<"$SECRET")
PGUSER=$(jq -r .username <<<"$SECRET")
PGPASS=$(jq -r .password <<<"$SECRET")
PGDB=$(jq -r .dbname <<<"$SECRET")
```

### 4. Restore the dump into the new instance

```bash
PGPASSWORD="$PGPASS" pg_restore \
  --host="$PGHOST" --username="$PGUSER" --dbname="$PGDB" \
  --no-owner --no-privileges --verbose --jobs=4 \
  archive/2026-04-cleanup/db-audit/prod-pre-migration.dump
```

This typically takes 5-30 min depending on dataset size.

### 5. Run drizzle migrations (idempotent)

From inside the gateway container on EC2:

```bash
docker exec -e DATABASE_URL="postgresql://$PGUSER:$PGPASS@$PGHOST:5432/$PGDB" \
            nyv-gateway-a pnpm db:push
```

This upgrades the schema to the version expected by the new gateway image
without touching data.

### 6. Cut over

Update `.env` on EC2 (it now reads from Secrets Manager — see
`docs/v3.1.2/completed_docs/NYV-SECRETS-MANAGEMENT.md` — but if you maintain a `.env` for emergency,
update `DATABASE_URL`):

```
DATABASE_URL=postgresql://nyvadmin:<from-sm>@<new-host>:5432/nyayavigya?sslmode=require
```

Then a graceful restart:

```bash
docker compose -f docker-compose.ecosystem.yml restart gateway-b
# wait for /health
docker compose -f docker-compose.ecosystem.yml restart gateway-a
```

### 7. Verify

- [ ] `curl https://api.nyayasiddhi.online/health` → 200 with `db: ok`
- [ ] Login to console, click around for 5 min — no errors in the
      `/aws/nyayavigya/prod/gateway` log group.
- [ ] Compare row counts between source and target for the top 5 tables.
- [ ] Watch the `nyv-prod-rds-cpu` alarm for the next hour.

### 8. Decommission old database

After 24 hours of clean operation:

```bash
# Take a final archival dump
pg_dump --format=custom --no-owner "$PG_SRC" > archive/2026-04-cleanup/db-audit/prod-final-snapshot.dump

# Then in the OLD provider's console, delete the instance.
```

## Rollback

If anything goes wrong before step 6:
- Cut DATABASE_URL back to the old host.
- Restart gateway-a and gateway-b.
- Time to roll back: < 60 seconds.

If something goes wrong AFTER step 6 and you discover data corruption:
- Use RDS PITR: `aws rds restore-db-instance-to-point-in-time …` to a
  timestamp before the incident.
- This creates a NEW instance — point DATABASE_URL at it and restart.

## Mem0 schema

Mem0 lives in the `nyv_mem0` schema on the same RDS instance. It uses
`pgvector`. After step 5 above, verify:

```sql
SELECT extname FROM pg_extension WHERE extname='vector';
SELECT count(*) FROM nyv_mem0.memory;
```

If `vector` is missing, install it:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

(Requires the `rds_superuser` role; the master user has it.)
