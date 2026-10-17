# EC2 DevOps SOP — Nyayavigya Platform (2026-05-14)

> Operational runbook for the EC2 prod environment (`i-0df71e5ea1df8f588`, ap-south-1).
> Companion: `INFRA-MAP-2026-05-14.md` (topology), `EC2-INTEGRATION-STATUS.md` (live status & evidence).
> All shell snippets are copy-pasteable. Replace `${VAR}` placeholders only where called out.

---

## 1. Pre-deploy checklist (10 items)

Run **all 10** before invoking `scripts/deploy-replit-ssm.sh`. Any ❌ aborts the deploy.

| # | Check | Pass criterion | Command |
|---|---|---|---|
| 1 | Guardrails preflight | NV-OWNERSHIP-001 + NV-DOC-001 clean | `bash scripts/guardrails-preflight.sh` |
| 2 | Drizzle journal sanity | no duplicate ordinals; last row matches `drizzle/meta/_journal.json` tail | `node scripts/drizzle-journal-check.mjs` |
| 3 | Tarball ready | `dist/`, `client/dist/`, `node_modules/` built; `package.json` version bumped | `npm run build && ls -lh dist client/dist` |
| 4 | `nyvadmin` DDL availability | `\du nyvadmin` shows `Superuser? no, Bypass RLS? yes`; can connect | snippet § 6.4 with `SELECT 1` |
| 5 | Last successful deploy ID noted | recorded in `docs/canonical/EC2-INTEGRATION-STATUS.md § 0` | grep `deploy ` in that file |
| 6 | RDS snapshot age | most recent automated snapshot < 24 h old | `aws rds describe-db-snapshots --db-instance-identifier nyv-dev-edge-pg --snapshot-type automated --query 'reverse(sort_by(DBSnapshots,&SnapshotCreateTime))[0].SnapshotCreateTime'` |
| 7 | Redis replication lag | `master_repl_offset - slave_repl_offset < 1MB` | `redis-cli -u "${NYV_REDIS_TCP_URL}" INFO replication` |
| 8 | Free disk on EC2 | `/var/lib/docker` ≥ 10 GB free | snippet § 6 (custom: `df -h /var/lib/docker`) |
| 9 | All 7 SDK keys reachable pre-deploy | 7×200 from `api.nyayasiddhi.online/api/nv/gateway/health` | for k in NSP NSPM NSI NSA NSM NYM JRX; do curl -s -o/dev/null -w "$k %{http_code}\n" -H "X-API-Key: ${!key_var}" https://api.nyayasiddhi.online/api/nv/gateway/health; done |
| 10 | ALB target healthy | `nyv-dev-edge-tg` shows `healthy` for `i-0df71e5ea1df8f588:80` | `aws elbv2 describe-target-health --target-group-arn $TG_ARN` |

---

## 2. Standard deploy procedure

```bash
# Single canonical entrypoint — runs steps 2-7 below over SSM
bash scripts/deploy-replit-ssm.sh
```

Phase-by-phase (what the script does — read this before re-implementing anything):

| # | Phase | What happens | Failure mode |
|---|---|---|---|
| 1 | **Local build** | `npm run build`, then `tar czf .local/deploy-${TS}.tgz` (excludes `node_modules`, `archive`, `.local`) | tar > 250 MB → investigate `du -sh *` |
| 2 | **S3 upload** | `aws s3 cp .local/deploy-${TS}.tgz s3://nyayavigya-sdk-devapp/deploys/${TS}-replit-ssm-${SHA}.tgz` | IAM: needs `s3:PutObject` |
| 3 | **EC2 fetch + extract + build** | SSM sends: `aws s3 cp ${URL} /tmp && tar xzf /tmp/...` → `cd /opt/Nyayavigya && docker compose build gateway` | image build error → fix locally, re-run |
| 4 | **CRITICAL — container swap** | `bash scripts/nv-deploy-swap.sh` issues `docker stop nyv-gateway && docker rm nyv-gateway` **before** `docker compose up -d --no-deps gateway`. <br> ⚠ DO NOT use plain `docker compose up -d --force-recreate` — it fails with `Container nyv-gateway is already in use` (compose name-conflict edge case, hit task #365 BCD5 + the 2026-05-14T11:57Z #384/#390 deploy, SSM `a5484a54-…`). | If you see the name-conflict error: run § 4 row "name conflict" |
| 5 | **CRITICAL — console proxy heal** | `docker compose restart console` (SSM `b3995aed-…` on 2026-05-14). The new gateway joins the docker net but nginx caches the old upstream IP for ~3 min. **Never trust `nyv-gateway-bridge.service` alone** — that systemd unit is `active (exited)` (oneshot) and only runs at boot. | Skip → 502 at the edge for ~3 min |
| 6 | **Health-poll** | internal `:5000/api/nv/health` for 60 s (1 s poll), then external `:80/api/nv/health` for 60 s | 60 s timeout → snapshot logs (§ 6.1), rollback (§ 8) |
| 7 | **Edge probe per SKU** | one `X-API-Key` GET to `/api/nv/gateway/health` per of the 7 SKUs | <7×200 → snapshot, rollback |

Record the resulting deploy ID + image digest into `docs/canonical/EC2-INTEGRATION-STATUS.md § 0`.

---

## 3. Migration procedure (DDL on prod RDS)

**Rules**:
1. Use **SSM** + `postgres:16-alpine` sidecar container — never connect from outside the VPC.
2. Use `DATABASE_URL_ADMIN` (role `nyvadmin`). The runtime role `nv_app` has `NOBYPASSRLS` and will fail with `must be owner` on most DDL.
3. URL must end with `?sslmode=verify-full` for production RDS (gateway pins AWS CA bundle via `src/utils/nv-pg-ssl.ts`). **Local Docker** uses `sslmode=disable`. For libpq sidecar `psql`, rewrite node-pg-only `sslmode=no-verify` → `sslmode=require` or `verify-full` with `sslrootcert=`.
4. **One migration per SSM command.** Combined heredoc scripts truncate silently mid-stream (observed on 2026-05-14, SSM `4655f690-…` first attempt — second migration was lost). The `apply3` harness from task #389 fixes this by sending each step as its own command and printing `STEP-N RC=<exit>`.
5. Always run **preflight → apply → postcheck → constraint probes**.

### 3.1 Preflight (read-only)

```bash
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "preflight inventory for ${MIG_NAME}" \
  --parameters 'commands=[
    "set -euo pipefail",
    "source /opt/Nyayavigya/secrets/.env.production",
    "docker run --rm -e PGURL=\"${DATABASE_URL_ADMIN}\" postgres:16-alpine \\",
    "  psql \"$PGURL\" -At -c \"SELECT current_user, current_database(), version();\" \\",
    "  -c \"\\\\dt+ public.*\" \\",
    "  -c \"SELECT * FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;\""
  ]' \
  --query 'Command.CommandId' --output text
```

### 3.2 Apply (one migration at a time, apply3-style trace)

```bash
MIG=0017_super_orgs.sql
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "apply ${MIG}" \
  --parameters 'commands=[
    "set -euo pipefail",
    "source /opt/Nyayavigya/secrets/.env.production",
    "aws s3 cp s3://nyayavigya-sdk-devapp/migrations/'"$MIG"' /tmp/m.sql",
    "echo STEP-1 RC=$?",
    "docker run --rm -v /tmp/m.sql:/m.sql:ro -e PGURL=\"${DATABASE_URL_ADMIN}\" postgres:16-alpine \\",
    "  psql \"$PGURL\" -v ON_ERROR_STOP=1 -f /m.sql",
    "echo STEP-2 RC=$?"
  ]'
```

### 3.3 Postcheck + constraint probes

```bash
# postcheck — confirm new objects exist and indexes are VALID
docker run --rm -e PGURL postgres:16-alpine psql "$PGURL" -At \
  -c "SELECT relname, relkind FROM pg_class WHERE relname ~ '^nv_super'" \
  -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename ~ '^nv_super'" \
  -c "SELECT conname, contype FROM pg_constraint WHERE conrelid::regclass::text ~ '^nv_super'"
```

Reference: SSM IDs from canonical 2026-05-14 deploy — `5e305fb0-…` (0016 apply), `4655f690-…` (0017 apply, see truncation note), `23c32553-…` (image build). See `EC2-INTEGRATION-STATUS.md § 0` for the full audit chain.

---

## 4. Troubleshooting decision tree

| Symptom | Detect | Root cause | Fix | Evidence to capture |
|---|---|---|---|---|
| `https://api.nyayasiddhi.online/*` → **502** | `curl -sI https://api.nyayasiddhi.online/api/nv/health` | console nginx cached stale upstream IP after gateway recreate (per-deploy network-bridge gotcha; `nyv-gateway-bridge.service` is oneshot, runs only at boot) | `aws ssm send-command --instance-ids i-0df71e5ea1df8f588 --document-name AWS-RunShellScript --parameters 'commands=["cd /opt/Nyayavigya && docker compose restart console"]'` | edge `curl -I` pre/post + `docker inspect nyv-gateway --format '{{json .NetworkSettings.Networks}}'` |
| `nyv-gateway` container **won't start** — "Container nyv-gateway is already in use" | `docker compose up -d gateway` returns name-conflict error | docker compose name-conflict edge case (task #365 BCD5; 2026-05-14 SSM `a5484a54-…`) | `docker stop nyv-gateway && docker rm nyv-gateway && docker compose up -d --no-deps gateway` | `docker ps -a --filter name=nyv-gateway` before/after + new container ID |
| DDL fails with **"must be owner of relation X"** | psql output | connected as `nv_app` (NOBYPASSRLS) instead of `nyvadmin` | re-export `PGURL="${DATABASE_URL_ADMIN}"` and re-run | `SELECT current_user;` proof |
| psql refuses to connect: **"invalid sslmode value: no-verify"** | libpq error string | `no-verify` is `node-pg` syntax; libpq does not accept it | rewrite URL: `sslmode=require` (or `verify-full` with `sslrootcert=`) | failing URL (redact creds) + fixed URL pattern |
| **429 RATE_LIMIT_EXCEEDED** in UAT/perf tests | response body `{"code":"RATE_LIMIT_EXCEEDED"}` | shared rate-limit bucket per SDK key | set `NV_PLATFORM_UAT_BYPASS=1` (see § 5) — bypasses ONLY the 7 internal platform fingerprints | response header `X-Platform-UAT-Bypass: 1` on subsequent calls |
| **403 "Insufficient scope"** when probing admin routes from a platform key | response body `{"code":"INSUFFICIENT_SCOPE"}` | scope guard rejects platform fingerprint for admin op | same as above — `NV_PLATFORM_UAT_BYPASS=1` lifts the scope check for the 7 fingerprints only | response header marker |
| **Drizzle filename collision** on disk (e.g. three files named `0015_*`) | `ls drizzle/*.sql \| sort \| uniq -c -w4` shows >1 | concurrent feature branches each picked the next ordinal | renumber **only** the non-prod files to the next free slot (e.g. `0015→0016`, `0015→0017`); **never** rename a file that is already in `drizzle.__drizzle_migrations` on prod | `git mv` log + `SELECT * FROM drizzle.__drizzle_migrations` before/after |
| `nyv-gateway-bridge.service` shows **`active (exited)`** but edge is 502 after a gateway recreate | `systemctl status nyv-gateway-bridge.service` | the bridge unit is a oneshot; runs at boot only, not on every gateway recreate | run `bash /opt/Nyayavigya/scripts/nv-bridge-gateway-net-systemd-install.sh` once (idempotent) **or** simply `docker compose restart console` | `docker network inspect nyayavigya-platform-312_nyv-net` showing both containers + edge `curl -I` 200 |

---

## 5. `NV_PLATFORM_UAT_BYPASS` flag (NEW — added 2026-05-14)

| Aspect | Behaviour |
|---|---|
| **What it does** | Bypasses **rate-limit** middleware AND **scope-check** middleware ONLY for requests whose `X-API-Key` SHA-256 fingerprint matches one of the 7 `NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}` env values. |
| **What it does NOT touch** | `auth` (still required), audit logging (still emitted), RLS (still enforced via `nv_app` + `app.customer_org_id`), PII redaction, content guardrails. |
| **Where to set** | **BOTH** Replit Secrets AND EC2 `/opt/Nyayavigya/secrets/.env.production`. Mismatch causes asymmetric behaviour. |
| **Activate** | `NV_PLATFORM_UAT_BYPASS=1`, then restart gateway: `docker compose restart gateway` (then § 2 step 5 — restart console too). |
| **Revoke** | unset (or set to `0`), then restart gateway and console. |
| **Audit marker** | every bypassed response carries header `X-Platform-UAT-Bypass: 1`. Audit log row gets `bypass: "platform_uat"`. |
| **Safety** | Non-platform keys (partner / customer SDKs) are **never** bypassed regardless of this flag. The fingerprint match is constant-time. |

---

## 6. SSM cookbook (5 ready-to-run snippets)

All snippets target `i-0df71e5ea1df8f588`. Replace `${...}` only where indicated.

### 6.1 Tail gateway logs

```bash
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "tail nyv-gateway 200" \
  --parameters 'commands=["docker logs --tail 200 --timestamps nyv-gateway 2>&1"]' \
  --query 'Command.CommandId' --output text
# then:
aws ssm get-command-invocation --instance-id i-0df71e5ea1df8f588 --command-id <ID> --query StandardOutputContent --output text
```

### 6.2 Inspect a container

```bash
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "inspect nyv-gateway" \
  --parameters 'commands=[
    "docker inspect nyv-gateway --format '"'"'{{json .State}} {{json .NetworkSettings.Networks}}'"'"' | jq ."
  ]'
```

### 6.3 Restart console nginx (proxy heal)

```bash
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "console nginx restart (proxy heal)" \
  --parameters 'commands=[
    "cd /opt/Nyayavigya && docker compose restart console",
    "sleep 3",
    "curl -sS -o /dev/null -w \"localhost:80/api/nv/health = %{http_code}\\n\" http://localhost/api/nv/health"
  ]'
```

### 6.4 Apply a migration via psql sidecar

```bash
MIG=0017_super_orgs.sql
aws s3 cp drizzle/${MIG} s3://nyayavigya-sdk-devapp/migrations/${MIG}
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "apply ${MIG} via psql:16-alpine" \
  --parameters 'commands=[
    "set -euo pipefail",
    "source /opt/Nyayavigya/secrets/.env.production",
    "aws s3 cp s3://nyayavigya-sdk-devapp/migrations/'"$MIG"' /tmp/m.sql && echo STEP-1 RC=$?",
    "docker run --rm -v /tmp/m.sql:/m.sql:ro -e PGURL=\"${DATABASE_URL_ADMIN}\" postgres:16-alpine \\",
    "  psql \"$PGURL\" -v ON_ERROR_STOP=1 -f /m.sql && echo STEP-2 RC=$?"
  ]'
```

### 6.5 Re-bridge gateway → console net

```bash
aws ssm send-command \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --comment "re-bridge gateway to nyv-net" \
  --parameters 'commands=[
    "docker network connect --alias nyv-gateway --alias gateway nyayavigya-platform-312_nyv-net nyv-gateway || true",
    "docker network inspect nyayavigya-platform-312_nyv-net --format '"'"'{{range .Containers}}{{.Name}} {{.IPv4Address}}{{\"\\n\"}}{{end}}'"'"'",
    "curl -sS -o /dev/null -w \"console-internal /api/nv/health = %{http_code}\\n\" http://nyv-gateway:5000/api/nv/health"
  ]'
```

(For permanent fix, ensure `/opt/Nyayavigya/scripts/nv-bridge-gateway-net-systemd-install.sh` is installed and `nyv-gateway-bridge.service` is `enabled` — see § 0a-bis evidence in `EC2-INTEGRATION-STATUS.md`.)

---

## 7. SDK key rotation runbook

For any one of `NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}`. Plan to do this **after UAT closes**, never mid-test.

| # | Step | Command / action |
|---|---|---|
| 1 | Generate new key (32 bytes, base64url) | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` |
| 2 | Compute fingerprint (sha256 hex) for audit cross-ref | `printf %s "$NEW_KEY" \| sha256sum \| awk '{print $1}'` |
| 3 | Stage new key in EC2 `.env.production` **alongside** old (allow dual-accept window) | edit `/opt/Nyayavigya/secrets/.env.production`: add `NYV_SDK_KEY_<SKU>_NEXT=<NEW>` |
| 4 | Deploy gateway code that accepts both `NYV_SDK_KEY_<SKU>` AND `NYV_SDK_KEY_<SKU>_NEXT` (dual-accept already in `auth` middleware) | `bash scripts/deploy-replit-ssm.sh` |
| 5 | Verify both keys → 200 | `curl -H "X-API-Key: $OLD" .../gateway/health` and `curl -H "X-API-Key: $NEW" .../gateway/health` |
| 6 | Hand new key to SKU consumer over secure channel; confirm they have rolled their fleet | external coordination (Slack DM + ack) |
| 7 | Promote: rename `NYV_SDK_KEY_<SKU>_NEXT` → `NYV_SDK_KEY_<SKU>`, remove old | edit `.env.production`, `docker compose restart gateway`, then § 2 step 5 |
| 8 | Mirror to Replit Secrets (dev parity) | Replit UI |
| 9 | Verify old key now → 401 | `curl -H "X-API-Key: $OLD" .../gateway/health` → expect `401` |
| 10 | Audit log capture | grep audit log for last `auth_success` of old fingerprint; archive into `docs/canonical/evidence/` |

---

## 8. Rollback procedure

**Code rollback** (image pin):

| # | Step | Command |
|---|---|---|
| 1 | Find prior image digest from S3 deploy log | `aws s3 ls s3://nyayavigya-sdk-devapp/deploys/ \| sort \| tail -5` then read `EC2-INTEGRATION-STATUS.md § 0` for the digest of the last-known-good |
| 2 | Pin compose to that tag | edit `/opt/Nyayavigya/docker-compose.yml` → `image: nyayavigya-platform-312-gateway@sha256:<DIGEST>` |
| 3 | Swap (using § 2 step 4 helper) | `bash scripts/nv-deploy-swap.sh` |
| 4 | Heal console proxy | § 6.3 |
| 5 | Verify | health-poll + 7-SKU edge probe |

**Data rollback** (RDS PITR):

> ⚠ Migrations are **additive / forward-only** by policy. There is no down-migration. To roll back schema, redeploy the prior image (which simply ignores the new columns/tables) — do **not** drop columns.

| # | Step | Command |
|---|---|---|
| 1 | Identify target restore time (UTC, before bad write) | `T=2026-05-14T11:00:00Z` |
| 2 | Restore to a new instance | `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier nyv-dev-edge-pg --target-db-instance-identifier nyv-dev-edge-pg-pitr-${TS} --restore-time ${T}` |
| 3 | Validate on the restored instance with a read-only connection | `psql "${RESTORED_URL}?sslmode=require" -c 'SELECT count(*) FROM <table>;'` |
| 4 | Cutover (only with explicit GO from owner): repoint `NYV_DATABASE_URL` + `DATABASE_URL_ADMIN` to restored endpoint, redeploy gateway | edit `.env.production`, deploy |
| 5 | Decommission old instance after 7-day grace period | `aws rds delete-db-instance --db-instance-identifier nyv-dev-edge-pg-OLD --skip-final-snapshot` (only after sign-off) |

---

*Generated 2026-05-14. Owner: DevOps. SSM IDs cited (`5e305fb0-…`, `4655f690-…`, `23c32553-…`, `a5484a54-…`, `b3995aed-…`) are real and traceable in `docs/canonical/EC2-INTEGRATION-STATUS.md § 0`. Do not invent new IDs in this file.*
