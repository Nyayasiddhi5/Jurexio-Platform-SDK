---
status: live
version: 5.0.1
audience: operators, SREs, downstream-platform engineers
last_updated: 2026-05-07
---

# Nyayavigya — Config Directories (Replit dev + EC2 prod)

> Single source of truth for **where every config file lives**, in both
> environments. Use this when you need to change a feature flag, route
> table, jurisdiction config, LLM provider list, env var, or secret.
>
> **Hard rule (NV-NAMING-001 + NV-SECRETS-001):** before adding any new
> config file or env-var name, `rg -l '<concept>'` first. Edit existing
> files; do not create duplicates.

---

## 1. Replit dev (this workspace)

Repo root: `/home/runner/workspace/nyayavigya-platform-312/`

### 1.1 TypeScript config (compile-time, ships in container)

| Path | What |
|---|---|
| `src/config/agent-config.ts` | Per-jurisdiction agent registry tunables |
| `src/config/api-versions.ts` | API version pin + SDK header version |
| `src/config/cors-config.ts` | CORS allowlist (Replit dev + EC2 + console) |
| `src/config/jurisdiction-configs.ts` | 6 jurisdictions × statute / case / template paths |
| `src/config/llm-config.ts` | Per-route default model + max tokens |
| `src/config/nv-feature-flags.ts` | Boolean feature flags |
| `src/config/nv-product-config.ts` | Per-platform tier matrix (NSP/NSPM/NSI/NSA/NSM/NYM/JRX) |
| `src/config/nv-scraper-allowlist.ts` | Outbound HTTP allowlist for the scraper service |
| `src/config/nv-sdk-variants.ts` | SDK variant defaults (DB `sdk_app_api_keys.scopes` is the runtime truth — see gotcha) |
| `src/config/nv-service-urls.ts` | Internal service URL resolution (Redis REST, etc) |
| `src/config/nyv-allowed-providers.ts` | **The 6-provider lockdown** (NV-LLM-001): `anthropic, openai, google, openrouter, sarvam, bedrock` + `PROVIDER_MODEL_CATALOG` synced with `nv_model_catalog` via `scripts/nv-seed-models.ts` |
| `src/config/nyv-master-config.ts` | Top-level wiring map (orchestrator → routes) |

### 1.2 Resolvers (runtime env-var → config)

| Path | What | Canonical name |
|---|---|---|
| `src/utils/redis-tcp-url.ts` | `resolveRedisTcpUrl()` (writes/primary) + `resolveRedisReadUrl()` (reads/replica, falls back to primary) | `NYV_REDIS_TCP_URL` + `NYV_REDIS_READ_URL` |
| `src/utils/db-url.ts` | DB URL resolver with neon/RDS detection | `NYV_DATABASE_URL` (preferred) → `DATABASE_URL` |
| `src/utils/encryption-key.ts` | PII vault key resolver | `NV_PII_ENCRYPTION_KEY` |

### 1.3 Replit Secrets (vault — `Tools → Secrets`)

| Secret name | Purpose | Required on Replit dev? | Required on EC2? |
|---|---|---|---|
| `NYV_SDK_KEY_NSP` | NSP platform SDK key | yes | yes (overlaid into `.env.production`) |
| `NYV_SDK_KEY_NSPM` | NSP-Mobile | yes | yes |
| `NYV_SDK_KEY_NSI` | Institutional | yes | yes |
| `NYV_SDK_KEY_NSA` | Academy | yes | yes |
| `NYV_SDK_KEY_NSM` | Ministry | yes | yes |
| `NYV_SDK_KEY_NYM` | Nyayamitra | yes | yes |
| `NYV_SDK_KEY_JRX` | Judicial Review Exchange | yes | yes |
| `NYV_REDIS_TCP_URL` | ElastiCache primary (`rediss://…`) | optional (TEMP-degrade in `nv-start-dev.sh`) | yes |
| `NYV_REDIS_READ_URL` | ElastiCache read replica | optional (resolver falls back) | optional (resolver falls back) |
| `REDIS_URL` | Upstash REST URL (Replit dev only) | yes (Replit dev) | n/a |
| `DATABASE_URL` | Neon Postgres (Replit) / RDS (EC2) | yes | yes |
| `JWT_SECRET` / `NYV_JWT_SECRET` | Operator JWT | yes | yes |
| `NYV_JWT_REFRESH_SECRET` | Operator JWT refresh | yes | yes |
| `ENCRYPTION_KEY` / `NV_PII_ENCRYPTION_KEY` | PII vault | optional dev | yes (gateway refuses to boot without it) |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `SARVAM_API_KEY` | Provider keys | yes | yes |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 + SSM + Bedrock | yes | yes |
| `NYV_EC2_INSTANCE_ID` | Deploy target | yes | n/a |
| `BITBUCKET_USERNAME` / `BITBUCKET_APP_PASSWORD` | Repo mirror | yes | n/a |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` / `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR` | Replit Object Storage adapter | yes | n/a (EC2 uses S3) |

> **Never write secret values into files.** All access goes through `process.env.*` or a resolver in `src/utils/`.

### 1.4 Workflow + start scripts (what binds to what port)

| Path | Workflow name | Port |
|---|---|---|
| `scripts/nv-start-dev.sh` | NYV Gateway | 5000 |
| `scripts/nv-start-console.sh` | NYV Console | 3004 |
| `examples/nsp-web-quickstart/` | NSP Web Example | 3000 |
| `scripts/deploy-replit-ssm.sh` | (manual) | — |
| `scripts/nv-verify-env-parity.ts` | (manual) | — |
| `scripts/nv-smoke-all-platforms.ts` | (manual) | — |

### 1.5 Replit-side runtime artefacts

| Path | What |
|---|---|
| `.local/replit-deploys.log` | One line per Replit→EC2 deploy |
| `.local/T7-ec2-secrets.note` | EC2 secrets parity notes (no values) |
| `.local/session_plan.md` | Active task decomposition |
| `audit/smoke-all-platforms-*.json` | Smoke ledgers (envelope capture) |

---

## 2. EC2 prod (`i-0df71e5ea1df8f588`, ap-south-1)

Host paths use `/opt/nyayavigya/` (lowercase). Some legacy scripts reference `/opt/Nyayavigya/` (capital N) — there is a symlink between the two; never depend on case.

### 2.1 Canonical directories on host

| Path | What | Owner / mode |
|---|---|---|
| `/opt/nyayavigya/repo/<deploy-id>/nyayavigya-platform-312/` | Each deploy is extracted into its own dir keyed by deploy id | `ubuntu:ubuntu` 0755 |
| `/opt/nyayavigya/repo.prev/`, `repo.prev2/` | Previous deploys (auto-rotated) — used for fast manual rollback | `ubuntu:ubuntu` |
| `/opt/nyayavigya/secrets/.env.production` | **Canonical production env file** (350+ keys) — overlaid onto each deploy as `.env` | `root:root` 0600 |
| `/opt/nyayavigya/secrets/.env.production.<reason>-<ts>.bak` | Auto-backups before every edit | `root:root` 0600 |
| `/opt/nyayavigya/secrets/sdk-bundle-sandbox-*.json` | Raw SDK key bundles (one file per mint) | `root:root` 0600 |
| `/opt/nyayavigya/secrets/platform-keys-*.txt` | Platform → SDK-key id mapping | `root:root` 0600 |
| `/opt/nyayavigya/CURRENT_DEPLOY` | Pointer to the live deploy id | `ubuntu:ubuntu` |
| `/opt/nyayavigya/LAST_GOOD_DEPLOY` | Rollback target (advances only when both gateway:5000 AND proxy:80 green) | `ubuntu:ubuntu` |
| `/opt/nyayavigya/deploys.log` | One line per SSM deploy with status + note | `ubuntu:ubuntu` |

### 2.2 Compose files inside the deploy dir

| Path (relative) | When used |
|---|---|
| `docker-compose.aws-dev.yml` | Default — what the deploy script uses |
| `docker-compose.staging.yml` | Staging EC2 (not currently running) |
| `docker-compose.yml` | Local-dev compose (not used on EC2) |
| `docker-compose.ecosystem.yml` | Multi-container ecosystem topology (not used in current deploy) |

### 2.3 Container-internal paths

| Path inside `nyv-gateway` container | What |
|---|---|
| `/app/src/config/*.ts` | Same TS configs as Replit (1.1 above) — TS runs directly via `tsx`, no `dist/` |
| `/app/.env` | Materialised from `/opt/nyayavigya/secrets/.env.production` at deploy time |
| `/app/scripts/nv-mint-sdk-bundle.ts` | Re-mint SDK keys (run via `docker exec`) |
| `/app/scripts/nv-seed-models.ts` | Re-seed `nv_model_catalog` (93 latest models May-2026) |

### 2.4 External managed services

| Service | Endpoint | Auth |
|---|---|---|
| RDS PostgreSQL 16.6 | (in `DATABASE_URL` — see `.env.production`) | password in env |
| ElastiCache `nyv-dev-edge-redis` (LIVE) | `master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` | TLS + AUTH (in env) |
| ElastiCache `nyscluster` (PROVISIONED, not yet cut over) | `master.nyscluster.4iynom…:6379` (writes), `replica.nyscluster.4iynom…:6379` (reads) | TLS + AUTH (in vault) |
| S3 `nyayavigya-sdk-devapp` | `ap-south-1` | IAM role on EC2 |
| ALB `nyv-dev-edge-alb` | `api.nyayasiddhi.online` (443) | ACM cert valid through 2026-11-07 |
| Console origin | `console.nyayasiddhi.online` (443) | Same ALB |

### 2.5 Where to edit what (operator quick-ref)

| To change… | Edit… | Then… |
|---|---|---|
| A feature flag | `src/config/nv-feature-flags.ts` (Replit) | `bash scripts/deploy-replit-ssm.sh --note "flag X"` |
| LLM provider list | `src/config/nyv-allowed-providers.ts` + Replit Secret + `UPDATE nv_llm_providers` + re-run `scripts/nv-seed-models.ts` | Deploy |
| A jurisdiction config | `src/config/jurisdiction-configs.ts` | Deploy |
| An env-var on EC2 only | SSM into EC2 → `sudo vi /opt/nyayavigya/secrets/.env.production` (always backup first), then `cd /opt/nyayavigya/repo/$(cat /opt/nyayavigya/CURRENT_DEPLOY) && docker compose -f docker-compose.aws-dev.yml restart gateway` | Verify `/api/nv/health/full` |
| A Redis URL | Use canonical name (`NYV_REDIS_TCP_URL` / `NYV_REDIS_READ_URL`) only. Add to BOTH Replit Secrets vault AND EC2 `.env.production` | Restart gateway |
| An SDK key | Re-mint via `scripts/nv-mint-sdk-bundle.ts`, then SQL `UPDATE nv_api_keys SET …` | No deploy needed |

---

## 3. Cross-env parity invariants (NV-PARITY-001)

| Invariant | Replit dev | Replit publish | EC2 prod |
|---|---|---|---|
| Same code commit | ✓ (the workspace) | ✓ (publish snapshot) | ✓ (deployed via SSM) |
| Same SDK key set | ✓ (Replit Secrets) | ✓ (Replit Secrets) | ✓ (overlaid `.env.production`) |
| Same canonical env-var names | ✓ | ✓ | ✓ |
| Same flow path through safety ring | ✓ | ✓ | ✓ |
| Same response envelope | ✓ | ✓ | ✓ |
| Storage backend | Replit Object Storage | Replit Object Storage | S3 (`ap-south-1`) |
| Redis | Upstash REST (TEMP-degrade) | Upstash REST | ElastiCache TCP+TLS |
| DB | Neon | Neon | RDS PostgreSQL 16.6 |
| Domain | `localhost:5000` | `<repl>.replit.app` | `api.nyayasiddhi.online` |

Verifier: `bash -c "cd nyayavigya-platform-312 && npx tsx scripts/nv-verify-env-parity.ts"`.

---

## 4. Quick verification commands

```bash
# Replit dev
cd nyayavigya-platform-312
curl -fsS http://localhost:5000/health | jq
BASE_URL=http://localhost:5000 npx tsx scripts/nv-smoke-all-platforms.ts | tail -20

# EC2 prod (via SSM, no SSH needed)
export AWS_DEFAULT_REGION=ap-south-1
aws ssm send-command --instance-ids "$NYV_EC2_INSTANCE_ID" --document-name AWS-RunShellScript \
  --parameters 'commands=["bash -lc \"curl -fsS http://localhost:5000/api/nv/health/full | head -c 800\""]' --output text

# Public surface (no SSM needed)
curl -fsS https://api.nyayasiddhi.online/health
curl -fsSI https://console.nyayasiddhi.online/
```
