---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Secrets management

## Single source of truth

All production secrets live in **AWS Secrets Manager** under
`nyayavigya/<env>/<service>/<key>`.

| Prefix | Owner |
|---|---|
| `nyayavigya/prod/gateway/*` | gateway container |
| `nyayavigya/prod/<partner>/*` | partner container (e.g. `nym/sdk_api_key`) |
| `nyayavigya/staging/*` | staging mirror |

The Terraform `secrets` module pre-creates each expected key with the
sentinel value `PLACEHOLDER_NOT_YET_SET`. The container entrypoint
(`scripts/secrets-entrypoint.sh`) refuses to start if a key it needs is
still that sentinel — fail loud, never serve traffic with broken auth.

## Local `.env` is dev-only

`.env` and `.env.staging` are read by Replit and developer machines but are
**stripped from the production deploy tarball** (see
`scripts/deploy-replit-direct.sh`'s `tar --exclude` list).

Replit secrets are never copied to EC2 — secret material flows
Replit → AWS Secrets Manager (via `secrets-sync.sh`) → container env (via
`secrets-entrypoint.sh`).

## Workflow: add a new secret

```bash
# 1. Add the key to .env.example so it shows up in env-coverage checks.
echo "FOO_API_KEY=" >> .env.example

# 2. Add the key name to local.gateway_keys in infra/terraform/modules/secrets/main.tf
#    and `terraform apply` (creates the SM entry with placeholder value).

# 3. Set the actual value (the secret value never touches stdout):
aws secretsmanager put-secret-value \
  --region ap-south-1 \
  --secret-id nyayavigya/prod/gateway/foo_api_key \
  --secret-string "$(your-secret-source)"

# 4. Restart the gateway containers so they pick up the new value:
ssh ubuntu@13.232.165.242 \
  "cd /opt/nyayavigya/repo/nyayavigya-platform-312 \
   && docker compose -f docker-compose.ecosystem.yml restart gateway-a gateway-b"
```

## Workflow: rotate a key

```bash
# Put a new version (Secrets Manager keeps the previous one)
aws secretsmanager put-secret-value \
  --region ap-south-1 \
  --secret-id nyayavigya/prod/gateway/<key> \
  --secret-string "$NEW_VALUE"

# Restart gateway-b first (zero-downtime path)
ssh ubuntu@13.232.165.242 \
  "cd /opt/... && docker compose restart gateway-b && sleep 15 && docker compose restart gateway-a"
```

If you need to roll back, the previous version is still there:

```bash
aws secretsmanager list-secret-version-ids --secret-id nyayavigya/prod/gateway/<key>
aws secretsmanager update-secret-version-stage \
  --secret-id nyayavigya/prod/gateway/<key> \
  --version-stage AWSCURRENT \
  --move-to-version-id <previous-version-id> \
  --remove-from-version-id <current-version-id>
```

## Bulk migration: existing `.env` → Secrets Manager

```bash
bash scripts/secrets-sync.sh prod    .env.prod
bash scripts/secrets-sync.sh staging .env.staging
```

This script creates / updates every `KEY=value` line in the source `.env` as
a SM secret under the appropriate prefix. After verifying with the gateway,
delete the local `.env.prod` (move it to a sealed offline backup; never
commit it). See `NYV-SECRETS-CLEANUP.md` for the cleanup checklist.

## Audit + compliance

- Every Secrets Manager call is logged in CloudTrail.
- Secrets are tagged with `Project=Nyayavigya`, `Env=<env>`, `Owner`.
- The instance role on the EC2 host is scoped to read only the secrets under
  `nyayavigya/<env>/*`. Staging EC2 cannot read prod secrets and vice versa
  (separate EC2 host + separate IAM role).
- Partner deploy roles (`nyv-prod-<partner>-deploy`) can read only their own
  partner's secret prefix — see `NYV-PLATFORM-GOVERNANCE.md`.

## Disaster recovery

Secrets Manager replicates within the region automatically. For region
failover, use AWS-managed cross-region replication:

```bash
aws secretsmanager replicate-secret-to-regions \
  --secret-id nyayavigya/prod/gateway/jwt_secret \
  --add-replica-regions Region=ap-south-2
```

The `recovery_window_in_days = 7` setting in the Terraform module means a
deleted secret can be restored within a week:

```bash
aws secretsmanager restore-secret --secret-id nyayavigya/prod/gateway/<key>
```
