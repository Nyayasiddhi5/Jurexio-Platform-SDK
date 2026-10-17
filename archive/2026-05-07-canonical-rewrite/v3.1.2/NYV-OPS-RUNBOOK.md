---
status: live
version: 1.0
supersedes: (none — first cut)
last_updated: 2026-05-02T1100Z
audience: SRE / on-call / platform leads
canonical: yes (one of the 8 source-of-truth docs per Project-Tracker.md §1)
---

# NYV-OPS-RUNBOOK — Nyayavigya Dev EC2 Operating Manual

> **Scope:** day-to-day operating procedures for the single dev gateway host
> `i-0df71e5ea1df8f588` / `13.232.165.242` (`/opt/Nyayavigya` canonical)
> running Platform 3.1.2 + SDK v5.0.0. NSP backend was removed from this host
> on 2026-05-02; NSP team redeploys via their own pipeline. Production
> deploys (when GA cuts on 2026-05-15) follow the same SOP against a
> separate ASG/RDS/ElastiCache stack — the procedural shape is identical;
> only the host IDs change.
>
> **Read order:** §1 (host facts) → §2 (deploy SOP) → §3 (rollback) →
> §4 (datastore SOP) → §5 (SDK key mint) → §6 (smoke matrix) →
> §7 (incident playbook) → §8 (escalation + carry-over).
>
> **Companion docs:**
> - `Project-Tracker.md` §1 (canonical facts), §5 (changelog)
> - `docs/v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md` (per-platform SDK access)
> - `docs/v3.1.2/SDK-RELEASE-2026-05-03.md` (current deploy hand-off)
> - `docs/v3.1.2/PRE-GA-STATUS-2026-05-03.md` (open Replit/EC2 items)
> - `scripts/deploy-replit-ssm.sh` (canonical deploy wrapper)

---

## §1. Host facts (canonical — do NOT re-derive)

| Fact | Value |
|------|-------|
| EC2 instance ID | `i-0df71e5ea1df8f588` (region `ap-south-1`, account `789925699169`) |
| Public IP / DNS | `13.232.165.242` ; ALB target via `api.nyayasiddhi.online` |
| OS / runtime | Amazon Linux 2023, Docker 24, Node 22.22.2 in image |
| Canonical repo path | `/opt/Nyayavigya/repo/<DEPLOY_ID>/nyayavigya-platform-312/` |
| Symlink | `/opt/Nyayavigya` → `/opt/nyayavigya` (mixed-case kept for backward compat with older docs) |
| Secrets dir | `/opt/Nyayavigya/secrets/` (root 700) — holds `.env.production`, `sdk-keys-*.txt`, `platform-keys-*.txt` |
| Compose file | `docker-compose.aws-dev.yml` (single-gateway topology — NOT blue-green) |
| Containers running | `nyv-gateway` (Node, port 5000), `nyv-console` (nginx proxy, port 80) |
| Datastore — Postgres | RDS `nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com:5432/nyayavigya` (no in-container PG) |
| Datastore — Redis | ElastiCache `nyv-dev-edge-redis` (managed, no in-container Redis) |
| S3 buckets | `nyayavigya-sdk-devapp` (deploy tarballs, SDK tarballs, RDS snapshots) |
| Deploy markers | `/opt/Nyayavigya/CURRENT_DEPLOY`, `/opt/Nyayavigya/LAST_GOOD_DEPLOY` (text files) |
| Deploy log | `/opt/Nyayavigya/deploys.log` (append-only, one line per deploy) |
| Current deploy (2026-05-02) | `2026-05-02T0946Z-replit-ssm-a558dbab` |
| Access method | **SSM only** — no SSH key in Replit container. Use AWS CLI `ssm send-command`. |

**Infra you must NOT touch from this runbook:** Route53 records, ALB/target
groups, ACM certificates, IAM roles, security groups, WAF rules, S3 bucket
policies. Those are managed via Terraform / IaC; changes go through the
infra repo, not via this host.

---

## §2. Deploy SOP — `scripts/deploy-replit-ssm.sh`

The single canonical path for shipping a new build from Replit to the dev
EC2 host. Replaces the broken `deploy-replit-direct.sh` (SSH-based) and
`deploy-dev.sh` / `deploy-prod.sh` (exec'd a deleted compose file). All
three are archived under `archive/2026-05-01-pre-may3-cleanup/`.

### 2.1 What it does (in order)

1. Builds a tarball of the Replit working tree, **excluding `.env`** so we
   never clobber the EC2-side production env file.
2. Uploads the tarball to `s3://nyayavigya-sdk-devapp/deploys/<DEPLOY_ID>-<SHA>.tgz` (8-char sha + ISO ts).
3. Sends a single `ssm send-command` (base64-encoded payload — see §2.4)
   that on EC2:
   a. Downloads tarball, extracts to `/opt/Nyayavigya/repo/<DEPLOY_ID>/`.
   b. Overlays `/opt/Nyayavigya/secrets/.env.production` onto the deploy
      dir (REQUIRED — extract step deliberately did not include `.env`).
   c. Validates 4 required keys are non-empty:
      `DATABASE_URL`, `REDIS_URL`, `NV_PII_ENCRYPTION_KEY`, `JWT_SECRET`.
      **Fails fast if any are missing** (root cause of the 2026-05-02T1003Z
      crash-loop — stale envs are insufficient on their own).
   d. Builds the gateway container: `docker compose -f
      docker-compose.aws-dev.yml build gateway`.
   e. Recreates the gateway: `docker compose -f docker-compose.aws-dev.yml
      up -d --force-recreate --no-deps gateway`.
   f. Restarts the console container so its nginx re-resolves the new
      gateway IP.
   g. Polls `:5000/api/nv/health` (gateway truth) for up to 120 s; once
      green, polls `:80/api/nv/health` (proxy) for up to 30 s.
   h. Updates `CURRENT_DEPLOY` always-on-gateway-OK; updates
      `LAST_GOOD_DEPLOY` only when both gateway and proxy are green.
   i. Appends one line to `deploys.log`. Exit 0 on full green, exit 2 on
      degraded proxy (gateway green but proxy not).

### 2.2 Pre-flight (Replit side)

- Working tree clean and committed (no untracked work that the tarball
  would silently exclude or include).
- AWS CLI configured with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
  Replit Secrets that have `s3:PutObject` on `nyayavigya-sdk-devapp` and
  `ssm:SendCommand` on `i-0df71e5ea1df8f588`.

### 2.3 Run it

```bash
cd nyayavigya-platform-312
bash scripts/deploy-replit-ssm.sh --note "what changed in 1 line"
```

The `--note` value is base64-encoded on the Replit side and decoded on the
EC2 side before being written to `deploys.log`. **This neutralises command
injection** via `$(...)` / backticks / newlines escaping the heredoc;
verified 2026-05-02 with a malicious-payload round-trip (architect-flagged
SEVERE, fixed same day). Treat this as a non-negotiable invariant — do not
inline the note unencoded if you ever rewrite the script.

### 2.4 Verify post-deploy

```bash
# CURRENT_DEPLOY + LAST_GOOD_DEPLOY should match the new ID; mismatch =
# proxy green but gateway green only — investigate console nginx.
aws ssm send-command --region ap-south-1 \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cat /opt/Nyayavigya/CURRENT_DEPLOY /opt/Nyayavigya/LAST_GOOD_DEPLOY ; tail -3 /opt/Nyayavigya/deploys.log"]'

# Public health (no auth)
curl -fsS https://api.nyayasiddhi.online/api/nv/health
```

Smoke matrix in §6 covers the auth-gated endpoints.

---

## §3. Rollback SOP

If a deploy goes red (gateway healthchecks fail or strict-OK audit chain
trips), roll back to `LAST_GOOD_DEPLOY` in three steps. All three are
fully executable as written.

### Step 1 — read `LAST_GOOD_DEPLOY` (fetch + wait + retrieve)

```bash
INSTANCE=i-0df71e5ea1df8f588
REGION=ap-south-1

CID=$(aws ssm send-command --region $REGION --instance-ids $INSTANCE \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cat /opt/Nyayavigya/LAST_GOOD_DEPLOY"]' \
  --query 'Command.CommandId' --output text)

# Poll until done (Success | Failed | TimedOut)
while :; do
  S=$(aws ssm get-command-invocation --region $REGION \
    --command-id $CID --instance-id $INSTANCE \
    --query 'Status' --output text 2>/dev/null || echo Pending)
  case "$S" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 3
done

LAST_GOOD=$(aws ssm get-command-invocation --region $REGION \
  --command-id $CID --instance-id $INSTANCE \
  --query 'StandardOutputContent' --output text | tr -d '[:space:]')
echo "Rollback target: $LAST_GOOD"
```

### Step 2 — recreate gateway + console from `LAST_GOOD`

```bash
RB_CID=$(aws ssm send-command --region $REGION --instance-ids $INSTANCE \
  --document-name AWS-RunShellScript --timeout-seconds 300 \
  --parameters "commands=[\"set -e; cd /opt/Nyayavigya/repo/${LAST_GOOD}/nyayavigya-platform-312 && cp /opt/Nyayavigya/secrets/.env.production .env && docker compose -f docker-compose.aws-dev.yml up -d --force-recreate --no-deps gateway && docker restart nyv-console && sleep 15 && curl -fsS http://localhost:5000/api/nv/health && curl -fsS http://localhost/api/nv/health && echo OK_ROLLBACK\"]" \
  --query 'Command.CommandId' --output text)

# Same poll loop as step 1, then:
aws ssm get-command-invocation --region $REGION \
  --command-id $RB_CID --instance-id $INSTANCE \
  --query 'StandardOutputContent' --output text
# Expect: trailing line "OK_ROLLBACK"
```

### Step 3 — update markers + append `deploys.log`

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
aws ssm send-command --region $REGION --instance-ids $INSTANCE \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo '${LAST_GOOD}' > /opt/Nyayavigya/CURRENT_DEPLOY && echo '${TS}|ROLLBACK|to=${LAST_GOOD}|by=on-call' >> /opt/Nyayavigya/deploys.log && tail -3 /opt/Nyayavigya/deploys.log\"]"
```

`LAST_GOOD_DEPLOY` is intentionally NOT updated — it must continue to
point at the last validated-green deploy, which is the one we just rolled
back to.

**Do not** delete the failing deploy directory until you have a clean
post-mortem — the source code there is the only forensic artifact for the
red deploy.

---

## §4. Datastore SOP — RDS + ElastiCache

### 4.1 RDS connection (read-only)

```bash
# From within the gateway container (DATABASE_URL already set):
docker exec -w /app nyv-gateway sh -c \
  'node -e "const p=new(require(\"/app/node_modules/pg\").Pool)({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); p.query(\"SELECT 1\").then(r=>{console.log(r.rows);p.end();})"'
```

### 4.2 Schema migrations

Migrations live in `nyayavigya-platform-312/drizzle/` (0000–0006). The
journal at `drizzle/meta/_journal.json` tracks 0000–0004; 0005/0006 exist
as files but were not in the journal until 2026-05-02 (still pending an
authoring update — KNOWN GAP).

The drizzle migration tracking table is `drizzle.__drizzle_migrations`
(schema `drizzle`, table `__drizzle_migrations`, columns
`id SERIAL, hash TEXT, created_at BIGINT`). Backfilled on 2026-05-02T1029Z
with 5 entries (0000–0004) computed from the journal.

To apply a NEW migration after authoring it:

```bash
# 1. Author the SQL file in nyayavigya-platform-312/drizzle/0007_<name>.sql
# 2. Add to drizzle/meta/_journal.json
# 3. Ship via §2 deploy SOP (the build copies drizzle/ into /app)
# 4. From container: docker exec -w /app nyv-gateway npx drizzle-kit migrate
```

`drizzle-kit` v0.31.10 IS available in the container at
`/app/node_modules/.bin/drizzle-kit`.

### 4.3 RDS snapshots

Pre-cut and post-cut snapshots go to S3 under
`s3://nyayavigya-sdk-devapp/_dba/snapshots/<TS>-<label>/dump.sql.gz` via a
one-shot `postgres:16-alpine` container:

```bash
# Replace <TS> with current ISO timestamp (UTC)
TS=$(date -u +%Y-%m-%dT%H%MZ)
docker run --rm --network host \
  -e PGPASSWORD="$(docker exec nyv-gateway sh -c 'echo $DATABASE_URL' | sed -E 's|.*:([^@]+)@.*|\1|')" \
  -v /tmp:/dump postgres:16-alpine \
  pg_dump -h nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com \
  -U nyvadmin -d nyayavigya --no-owner --no-acl --no-privileges \
  -f /dump/dump-$TS.sql
gzip /tmp/dump-$TS.sql
aws s3 cp /tmp/dump-$TS.sql.gz \
  s3://nyayavigya-sdk-devapp/_dba/snapshots/$TS-<label>/dump.sql.gz
rm -f /tmp/dump-$TS.sql.gz
```

Latest snapshot: `s3://nyayavigya-sdk-devapp/_dba/snapshots/2026-05-02T1031Z-post-reseed/dump.sql.gz` (1.5 MB gz / 29 MB raw).

### 4.4 Seed scripts (idempotent)

Under `scripts/`, runnable via `docker exec -w /app nyv-gateway npx tsx scripts/<name>.ts`:

| Seed script | Target table | Status |
|---|---|---|
| `nv-seed-organizations.ts` | `nv_organizations` | runnable; current 7 rows |
| `nv-seed-users.ts` | `nv_users` | needs `NV_DEMO_PASSWORD` env var (>=12 chars); current 5 rows |
| `nv-seed-sdk-apps.ts` | `nv_sdk_applications` | runnable; current 6 rows (NYM/NSP/NSI/NSA + playground + demo); **missing ministry — see §5.4** |
| `nv-seed-statutes.ts` | `nv_statutes` | runnable; idempotent (305 rows already seeded) |
| `nv-seed-rag-and-audit.ts` | `rag_namespaces`, `nv_audit_logs` | runnable; partial-skips `nv_rag_documents`/`nv_rag_chunks` (KNOWN GAP — those tables aren't in any migration) |
| `nv-seed-sdk-keys.ts` | `nv_api_keys` (LEGACY — see §5) | runnable; current 9 rows |

**Broken seeds (target tables undefined anywhere):**
`nv-seed-mcp-tools.ts`, `nv-seed-jurisdictions.ts`,
`nv-seed-feature-flags.ts`, `nv-seed-llm-providers.ts`, `nv-seed-models.ts`,
`nv-seed-agents.ts`, `nv-seed-ecosystem-demos.ts`. These target
`nv_mcp_tools`, `nv_jurisdiction_configs`, `nv_feature_flags`,
`nv_llm_providers`, `nv_model_catalog`, `nv_agents`, etc. — none of which
are in the schema files (`shared/*.ts`) or in any drizzle migration. This
is structural drift; resolution requires schema authoring + a new drizzle
migration. **Do not attempt to "fix" these by mass-creating tables;** the
schema design needs to come from the platform tech-lead.

### 4.5 ElastiCache (Redis) ops

```bash
# Ping from gateway container
docker exec nyv-gateway sh -c 'node -e "const r=require(\"/app/node_modules/ioredis\"); const c=new r(process.env.REDIS_URL); c.ping().then(p=>{console.log(p);c.quit();})"'

# Flush a specific cache namespace if needed (NEVER FLUSHALL in prod)
# Usually handled by edge-revalidate.sh which posts to /api/nv/admin/cache/invalidate
```

---

## §5. SDK key mint procedure

Two paths exist on the running gateway. Pick based on whether the key
needs to authenticate against the v5.0.0 middleware (path B) or just sit
in the legacy table for compatibility (path A).

### 5.1 Path A — legacy `nv_api_keys` (via `nv-seed-sdk-keys.ts`)

Pros: zero auth dependencies (just SSM + DB). Cons: keys are in a
**deprecated** table (per SDK-DEV-EC2-ACCESS §11 #6); the canonical
gateway middleware reads only `sdk_app_api_keys`. Use this path for
hand-off snapshots and emergency mints, NOT for live consumer integration.

```bash
# From SSM:
docker exec -w /app nyv-gateway npx tsx scripts/nv-seed-sdk-keys.ts \
  > /tmp/sdk-keys.tmp 2>&1
mv /tmp/sdk-keys.tmp /opt/Nyayavigya/secrets/sdk-keys-$(date -u +%Y-%m-%d).txt
chmod 600 /opt/Nyayavigya/secrets/sdk-keys-*.txt
chown root:root /opt/Nyayavigya/secrets/sdk-keys-*.txt
```

The script mints 5 platforms × {live, test} = 10 keys with format
`nyv_<live|test>_sk_<platform_short>_<48hex>`. Platform shorts:
`nym`, `nsp`, `nsi`, `nsa`, `nsm`. Keys are written to `nv_api_keys`
with `key_hash = sha256(key)`, `key_prefix = first 16 chars + "..."`,
`permissions` array per platform tier, `rate_limit` per platform.

**Output handling rules:**
- Never print full keys to chat or non-encrypted logs.
- `/opt/Nyayavigya/secrets/` is root 700; key files are root 600.
- For chat / SSM stdout, emit only the first 24 chars of each key
  (`nyv_live_sk_<short>_<8hex>...`). The full hex tail must stay in
  the file on the host.

### 5.2 Path B — canonical `sdk_app_api_keys` (via `/api/nv/sdk/create-app`)

Pros: key authenticates against the v5.0.0 middleware on
`/api/nv/gateway/*` routes. Cons: requires admin JWT (super_admin role).

```bash
# 1. Obtain super_admin JWT (separate auth flow — not in scope of this runbook)
ADMIN_JWT="..."

# 2. POST /api/nv/sdk/create-app
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  https://api.nyayasiddhi.online/api/nv/sdk/create-app \
  -d '{
    "name":"Nyayasiddhi Ministry™",
    "platform_type":"nyayasiddhi_ministry",
    "tier":"government",
    "scopes":["agents:read","agents:execute","research:read"]
  }'

# Response includes raw key — capture and write to
# /opt/Nyayavigya/secrets/<platform>-key-<TS>.txt root 600.
```

`/create-app` defaults scopes to
`["agents:read","agents:execute","research:read"]` if `scopes` is omitted.
Bare `["*"]` is rejected with `403 NYV-CREATE-SCOPE-001` unless
`req.user.role === 'super_admin'` AND body includes
`wildcard_override:true` (per §11 #9 NYV-NS-013, RESOLVED 2026-05-01).

### 5.3 Operator step — populate Replit Secrets

Replit secrets cannot be set programmatically — only via the UI or
`requestEnvVar`. After minting, the operator must:

1. Read `/opt/Nyayavigya/secrets/sdk-keys-<TS>.txt` via SSM (do not pipe
   to chat).
2. Open the Replit Secrets UI → New Secret.
3. Add 5 secrets named exactly:
   - `NYV_SDK_KEY_NYM` = `<live key for nyayamitra>`
   - `NYV_SDK_KEY_NSP` = `<live key for nys-professional>`
   - `NYV_SDK_KEY_NSI` = `<live key for nys-institutional>`
   - `NYV_SDK_KEY_NSA` = `<live key for nys-academy>`
   - `NYV_SDK_KEY_NSM` = `<live key for nys-ministry>`
4. Verify via `viewEnvVars({type:"secret",keys:["NYV_SDK_KEY_NYM",...]})` —
   only existence (`true`) is exposed; values are never readable from the
   skill.

`scripts/nv-smoke-ec2.sh` `full` mode reads these secrets and runs the
positive matrix (see §6.2).

### 5.4 Path C — full 4-key bundle mint (`nv-mint-sdk-bundle.ts`) — RECOMMENDED for new platforms

Use this path when a platform needs the full ecosystem-standard 4-key
bundle (`sdk_api_key`, `publishable_key`, `signing_key`, `webhook_secret`)
rather than just live/test pair keys. This is the path used for the 5
priority platforms (NSP-WEB, NSP-MOBILE, NYM, NSI, JRX) on 2026-05-02.

**Pre-flight:** the platform must have a row in `nv_sdk_applications`.
For new platforms, INSERT first via SSM. Example for JRX (the US
sibling of NSI):

```sql
INSERT INTO nv_sdk_applications
  (id, name, app_type, jurisdiction, owner_id, org_id, tier,
   is_active, settings, created_at, updated_at)
VALUES
  ('nvsdkapp-demo-jrx-001',
   'JuRiX US Institutional Integration',
   'nyayasiddhi_institutional', 'US', 1, 2, 'enterprise', true,
   '{"us_version_of":"nsi"}'::jsonb, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
```

**Mint procedure (run from Replit, executes on EC2):**

```bash
SCRIPT_B64=$(base64 -w 0 < nyayavigya-platform-312/scripts/nv-mint-sdk-bundle.ts)
aws ssm send-command --region ap-south-1 \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript --timeout-seconds 180 \
  --parameters "{\"commands\":[\"set -e; mkdir -p /opt/Nyayavigya/secrets && chmod 700 /opt/Nyayavigya/secrets; echo '$SCRIPT_B64' | base64 -d > /tmp/nv-mint-sdk-bundle.ts; docker cp /tmp/nv-mint-sdk-bundle.ts nyv-gateway:/app/scripts/nv-mint-sdk-bundle.ts; docker exec nyv-gateway sh -c 'mkdir -p /tmp/sdk-bundle-out'; docker exec -e NYV_PLATFORM_ENV=sandbox -e NYV_BUNDLE_OUT_DIR=/tmp/sdk-bundle-out nyv-gateway sh -c 'cd /app && npx tsx /app/scripts/nv-mint-sdk-bundle.ts'; LATEST=\$(docker exec nyv-gateway ls -t /tmp/sdk-bundle-out/ | head -1); docker cp nyv-gateway:/tmp/sdk-bundle-out/\$LATEST /opt/Nyayavigya/secrets/\$LATEST; chmod 600 /opt/Nyayavigya/secrets/\$LATEST; aws s3 cp /opt/Nyayavigya/secrets/\$LATEST s3://nyayavigya-sdk-devapp/_dba/secrets/\$LATEST --region ap-south-1 --sse AES256\"]}"
```

For production cutover, set `NYV_PLATFORM_ENV=production` (changes
`nyv_test_*` → `nyv_live_*` prefixes).

**Output:** `/opt/Nyayavigya/secrets/sdk-bundle-<env>-<TS>.json`
(chmod 600, root-owned) + S3 mirror under
`s3://nyayavigya-sdk-devapp/_dba/secrets/`.

**DB schema constraints to respect** (these caused two failed runs on
2026-05-02 before the script was hardened):
- `nv_api_keys.id` is `varchar(36)` — keep ids short
  (`nvkb-<3char-short>-<2char-type>-<2char-env>-001` = 21 chars).
- `nv_api_keys.key_prefix` is `varchar(20)` — slice raw to first 16 chars
  + `"..."` (= 19 chars).
- `nv_api_keys` has NO `key_type` and NO `scopes` columns — type encoded
  in `key_prefix` (`nyv_test_sk_…`, `nyv_test_pk_…`, `nyv_ss_…`,
  `nyv_wh_…`); permissions stored in `permissions` array.
- `nv_sdk_applications` has NO hash columns
  (`webhook_secret_hash`/`signing_key_hash`/`publishable_key_hash`).
  All key auth is via `nv_api_keys.key_hash`.

**Bundle output handling rules** (same as path A):
- Never print full keys to chat or non-encrypted logs.
- The script's stdout is safe — it prints only the first 16 chars + `"..."`.
- Full hex tail lives in `/opt/Nyayavigya/secrets/sdk-bundle-*.json` only.

### 5.5 Known mint gaps (current as of 2026-05-02)

- **NSM key not minted** — Ministry app row still absent in
  `nv_sdk_applications`. NSM is intentionally DEFERRED per current
  product priority (see `Project-Tracker.md`). When the time comes,
  INSERT the row (similar to JRX example above) then re-run path C with
  PLATFORMS extended to include `nsm`.
- **Legacy `nv_api_keys` / canonical `sdk_app_api_keys` table split** —
  the 4-key bundle currently writes only to `nv_api_keys`. The canonical
  middleware (`/api/nv/gateway/*`) reads `sdk_app_api_keys`. The
  ecosystem currently uses `/api/nv/*` (legacy table) for SDK consumer
  traffic. Consolidation to `sdk_app_api_keys` is tracked for v3.2.
- **All 4 minted demo keys are in legacy `nv_api_keys`** — they
  authenticate against `/provision/*` routes only (with the §11 #6
  divergence caveat). They do NOT authenticate against
  `/api/nv/gateway/*`. Use path B for canonical-table mint that works
  across all routes.

---

## §6. Smoke matrix — `scripts/nv-smoke-ec2.sh`

### 6.1 `public-only` mode (no secrets)

12-probe matrix; all should be 200 (public health) or 401 (auth-gated
probes correctly rejecting un-Bearer'd requests). Last good run:
`audit/smoke-2026-05-02T051946Z.json` — 12/12 PASS.

```bash
cd nyayavigya-platform-312
bash scripts/nv-smoke-ec2.sh   # default mode
```

### 6.2 `full` mode (requires 5 Replit Secrets per §5.3)

5 platforms × {download tarball, list agents, execute agent, provision
health, provision validate} = 25 probes + 1 tier-escalation negative
test (non-admin → enterprise endpoint → expect 403).

```bash
NYV_SDK_KEY_NYM=$NYV_SDK_KEY_NYM ... bash scripts/nv-smoke-ec2.sh full
```

**Full-mode positive matrix is currently blocked** — the 4 minted demo
keys live in legacy `nv_api_keys` and the gateway middleware reads
canonical only (per §5.4). Path B mint will unblock.

---

## §7. Incident playbook

| Symptom | First check | Most likely cause | Fix |
|---|---|---|---|
| Gateway crash-loop with `[NYV-NS-005] db null` | `docker logs nyv-gateway --tail 50` | `.env.production` missing/stale required keys | Re-run §2 deploy (its required-key validator FAILS FAST now) OR `cat /opt/Nyayavigya/secrets/.env.production` and verify 4 keys non-empty |
| Console returns 502 from `:80` | `docker logs nyv-console --tail 30` | nginx cached stale gateway IP after recreate | `docker restart nyv-console` (the deploy script does this automatically as of 2026-05-02) |
| `/api/nv/health` 200 but `/api/nv/gateway/*` 401 with valid SDK key | `psql … SELECT COUNT(*) FROM sdk_app_api_keys` | Key minted in legacy `nv_api_keys` not canonical `sdk_app_api_keys` (§5 path A vs B) | Re-mint via path B (`/create-app`) |
| `LAST_GOOD_DEPLOY ≠ CURRENT_DEPLOY` after deploy | `docker logs nyv-console` | Proxy degraded (deploy script exits 2 in this case) | Restart console, re-poll `:80/api/nv/health`; if green, manually advance `LAST_GOOD_DEPLOY` and append `deploys.log` |
| Audit chain TAMPER lines on startup | `docker logs nyv-gateway 2>&1 \| grep TAMPER` | Hash chain broken (rare; usually means manual DB edit on `nv_audit_logs`) | DO NOT auto-repair. File incident; investigate the manual edit; coordinate with DBA before any chain re-link |
| RDS connection refused | EC2 security group; RDS endpoint reachable from container? | SG drift OR RDS in maintenance window | Check AWS console; if drift, file infra ticket — NEVER edit SG from this runbook |
| Disk full on EC2 | `df -h /opt` | Old release tarballs accumulating | `docker image prune -af && docker builder prune -af && find /opt/Nyayavigya/repo/ -mindepth 1 -maxdepth 1 -type d -mtime +7 -print` (review before delete) |

---

## §9. Password rotation — demo users (SSM Parameter Store flow)

The demo users seeded by `nv-seed-users.ts` need a password ≥12 chars in
`NV_DEMO_PASSWORD`. We never put that value in chat, in git, or in the
agent's context. Flow uses AWS SSM Parameter Store SecureString.

### 9.1 One-time setup (already done 2026-05-02)

```bash
aws ssm put-parameter --region ap-south-1 \
  --name /nyayavigya/dev/demo-user-password \
  --type SecureString \
  --value 'REPLACE_VIA_AWS_CONSOLE' \
  --description 'Bcrypt-hashed by nv-seed-users.ts. Rotate via aws ssm put-parameter --overwrite. Min 12 chars.' \
  --tags Key=managed_by,Value=nyayavigya-ops Key=secret_class,Value=demo-only
```

### 9.2 Operator updates the value (out-of-band, never in chat)

Either the AWS Console (Systems Manager → Parameter Store → edit
`/nyayavigya/dev/demo-user-password`) OR the AWS CLI from a trusted
shell:

```bash
# DO NOT paste into Replit/agent chat. Run from your local terminal.
aws ssm put-parameter --region ap-south-1 \
  --name /nyayavigya/dev/demo-user-password \
  --type SecureString --overwrite \
  --value '<your-new-password-here>'
```

### 9.3 Reseed users on EC2 (agent-driveable, no secret leak)

```bash
aws ssm send-command --region ap-south-1 \
  --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript --timeout-seconds 120 \
  --parameters '{"commands":["set -e; PW=$(aws ssm get-parameter --region ap-south-1 --name /nyayavigya/dev/demo-user-password --with-decryption --query Parameter.Value --output text); test ${#PW} -ge 12 || (echo PW_TOO_SHORT && exit 2); docker exec -e NV_DEMO_PASSWORD=\"$PW\" -w /app nyv-gateway npx tsx scripts/nv-seed-users.ts 2>&1 | grep -viE \"PW=|password|secret|credential\" | tail -30; unset PW"]}'
```

The reseed script's stdout is filtered to drop any line containing `PW=`
or `password` before being returned to the SSM caller, so the secret
never lands in CloudTrail / SSM run-history.

### 9.4 Rotation cadence

- Every **90 days** (aligned with `sdk_api_key` rotation).
- Immediately if a Replit secret containing the password is suspected
  exposed, or if a developer leaves the project.
- After every clean RDS restore from backup.

---

## §8. Escalation + carry-over

### 8.1 Escalation contacts

For incidents during business hours: page the platform on-call via the
internal rotation. After-hours: email `ops@nyayavigya.in`. Include in any
escalation: deploy ID (`cat /opt/Nyayavigya/CURRENT_DEPLOY`), failing
HTTP code + body snippet, the SSM `command-id` you ran, and a link to the
relevant section of this runbook.

### 8.2 Open carry-over (track in `Project-Tracker.md` §5 + `PRE-GA-STATUS-2026-05-03.md` §3)

| ID | Item | Severity | Status |
|---|---|---|---|
| C1 | NSM (Ministry) key — DEFERRED per current product priority. INSERT a `nv_sdk_applications` row when ministry pilot is greenlit, then re-run path C. | Medium | Deferred 2026-05-02 |
| C1a | 5 priority platforms (NSP-WEB, NSP-MOBILE, NYM, NSI, JRX) — full 4-key bundle minted via path C (`nv-mint-sdk-bundle.ts`) on 2026-05-02T14:21Z. 20 keys in `nv_api_keys`, raw bundle at `/opt/Nyayavigya/secrets/sdk-bundle-sandbox-2026-05-02T14-21-56-139Z.json` + S3 mirror. | — | DONE 2026-05-02 |
| C2 | Drizzle journal does not include 0005 / 0006 — backfill the journal entries OR archive 0005/0006 if intentionally never applied (decision needed) | Medium | Open |
| C3 | `nv_rag_documents` / `nv_rag_chunks` tables not in any migration — block remaining seed targets; needs schema authoring | Medium | Open |
| C4 | 7 broken seed scripts target undefined tables (`nv_mcp_tools`, `nv_jurisdiction_configs`, `nv_feature_flags`, `nv_llm_providers`, `nv_model_catalog`, `nv_agents`, `nv_ecosystem_demos`) — either author missing schema OR archive the seeds | Medium | Open |
| C5 | `nv-seed-users.ts` demo user reseed — DONE 2026-05-04. Operator populated SSM param `/nyayavigya/dev/demo-user-password`, agent ran §9.3 reseed via SSM. 6 demo users seeded (admin, dev, analyst, operator, manager, user). Grep filter hardened to case-insensitive (`grep -viE`). | Low | DONE 2026-05-04 |
| C6 | Legacy `nv_api_keys` / `nv_sdk_applications` tables — drop migration staged at `archive/v3.2-prep/0008_drop_legacy_sdk_tables.sql` for v3.2 cut | Low | Tracked for v3.2 |
| C7 | `nv-start-dev.sh` health-poll loop curls `/api/nv/gateway/health` (Bearer-required) instead of `/health` (public) — false-negatives during legitimate green deploys | Low | Tracked |
| C8 | Rollback procedure in §3 is manual SSM construction — automate with a `scripts/rollback-replit-ssm.sh` companion to `deploy-replit-ssm.sh` | Low | Tracked |
| C9 | TwinDesk/AutomateAI/SkillShop routers ARE mounted (lines 614/617/620) and return 401 (JWT required). Integration guides reference wrong sub-paths (`/twindesk/draft` should be `/twindesk/twins/:id/chat`; `/automate/run` should be `/automateai/workflows/:id/execute`). Fix the guides' §6 tables. | Low | Tracked |
| C10 | Per-platform integration guides authored against intended product surface; canonical reality is in `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-02.md`. Consumer teams must apply the §5 "test-matrix patch" from the canonical doc on top of each guide's §9. | Medium | Tracked |

### 8.3 What this runbook explicitly does NOT cover

- Production deploy SOP — production GA cuts on 2026-05-15; the same
  procedural shape applies to the prod ASG / RDS / ElastiCache stack but
  with different host IDs, separate IAM scopes, and a stricter
  approval / change-window gate. A v2.0 of this runbook will land at GA.
- NSP (Nyayasiddhi Platform) backend ops — that workload was removed from
  this host on 2026-05-02. NSP team operates their own pipeline against
  their own infrastructure. NYV remains the ecosystem admin (DNS, ALB,
  S3, IAM, SDK key mint), but NSP runtime is no longer deployable from
  this host's compose file.
- Any AWS infra change (Route53 / ALB / S3 / IAM / SG / WAF / ACM) — those
  go through the infra repo and a separate change-management process.
- SDK package authoring or version bumps — pinned to v5.0.0 stable per
  `Project-Tracker.md` §1 freeze policy (no bumps until next major).
