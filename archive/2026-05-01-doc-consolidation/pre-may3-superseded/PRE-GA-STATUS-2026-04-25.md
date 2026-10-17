---
status: active
version: 3.1.2
audience: founders / SRE / release manager
last_verified: 2026-04-25T16:05Z
---

# Nyayavigya v3.1.2 — Pre-GA Status (2026-04-25)

> Single-source-of-truth status report responding to the 2026-04-25T14:17Z
> directive. Captures deploy state, DNS verification, SDK keys, per-platform
> integration links, the RDS+ElastiCache decision, outstanding pre-GA items,
> and recommended next actions.

---

## 0.1 Recovery update (2026-04-25T16:05Z)

The crash loop is **resolved** and the v3.1.2 gateway is back online.
RDS + ElastiCache have been **provisioned** (you pre-approved the ~$37/mo).
The migration *cutover* (dump → restore → switch DATABASE_URL/REDIS_URL → drop
containers) is staged but not yet executed; gateway still talks to the on-EC2
`nyv-postgres` and `nyv-redis` containers.

| Item | State (16:05Z) | Evidence |
|---|---|---|
| `https://api.nyayasiddhi.online/api/nv/health/full` | **HTTP 200** (status: degraded — auth/agents/jwt/db/redis healthy; nsp_api/payment marked degraded as expected without optional creds) | external curl |
| `https://console.nyayasiddhi.online/` | **HTTP 200** | external curl |
| `https://nyayasiddhi.online/`, `www.…`, `pro.…`, `nym.…`, `min.…` | **HTTP 200** | external curl |
| `nyv-gateway` container | **`Up … (healthy)`** | docker ps |
| `nv_sdk_applications`, `nv_api_keys`, `nv_sdk_usage_metrics`, `nv_schema.protocol_registry` | **created** on EC2 prod via `.local/run/nv-emergency-patch-2026-04-25.sql` (DDL lifted from `scripts/nyayavigya-312-db-dump.sql:167-205` for the first three; inferred for `protocol_registry`) | `to_regclass` checks |
| BullMQ queue-name regression | **fixed** — `:` → `-` in `QueueNames` const | `src/services/queue/bullmq-queue.ts` |
| RDS instance `nyv-dev-edge-pg` | **`available`** — postgres 16.6, db.t4g.small, 20 GB gp3, endpoint `nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com:5432`, master creds in Secrets Manager `nyv-dev-edge-pg/rds/master` | `aws rds describe-db-instances` |
| ElastiCache replication group `nyv-dev-edge-redis` | **`available`** — Redis 7, cache.t4g.micro, primary endpoint `master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com`, AUTH token in Secrets Manager `nyv-dev-edge-redis/redis/auth` | `aws elasticache describe-replication-groups` |
| Terraform state | **persisted** to `s3://nyv-tfstate-789925699169-ap-south-1/envs/dev-edge/terraform.tfstate`; 14 RDS+ElastiCache resources tracked | `terraform state list` |
| Engine-version fix | `modules/rds/main.tf:123` bumped `16.3` → `16.6` (16.3 is no longer offered in `ap-south-1`; lowest available 16.x is 16.6) | this commit |
| Cutover script | unchanged — `scripts/migrate-to-managed-datastores.sh --preflight/--dump/--restore/--cutover/--rollback` | runbook |
| Platform SDK keys against EC2 prod | **NOT yet rotated** — see §4 caveat | n/a |

### What I deliberately did NOT do today

1. **Run the cutover.** Provisioning is non-destructive; switching
   `DATABASE_URL` is. Dump → restore → cutover should run once with you on the
   call (~5 min user-facing degradation per the runbook).
2. **Rotate platform keys against EC2 prod.** `rotate-platform-keys.ts`
   expects `nv_sdk_applications` to carry `publishable_key_hash`,
   `signing_key_hash`, `webhook_secret_hash`, plus `nv_sdk_applications.environment`
   and `nv_sdk_applications.organization_id`. The EC2 prod schema (the dump
   that was in the repo) uses `org_id` and lacks the `*_hash` and `environment`
   columns. The runtime `nv_api_keys` shape *does* match. Rotating before
   reconciling the schema would fail mid-run, leaving the table half-populated.
   The keys in `.local/run/platform-keys-rotated-2026-04-25T14-22-29-757Z.json`
   are still **Replit-DB-only** — do not ship them to platform owners until
   the EC2 schema is reconciled and the rotate script runs cleanly there.
3. **Add the new tables to Drizzle.** `nv_sdk_applications`, `nv_api_keys`,
   `nv_sdk_usage_metrics`, and `nv_schema.protocol_registry` were created via
   raw SQL because they have no Drizzle definition anywhere in `src/db/`.
   Long-term they belong in `src/db/schema/sdk-platform.ts` so `drizzle-kit
   push` is the source of truth and the EC2-prod / Replit / RDS shapes never
   drift again.
4. **Apply the broader Terraform plan.** The full `terraform plan` shows
   `aws_lb_listener.https[0]` and `acm_certificate_validation.this[0]` slated
   for **destroy** because the live ALB/ACM resources have drifted from the
   `count`-based config. Destroying them would drop HTTPS for every hostname.
   Today's apply was scoped strictly to `module.rds[0]` + `module.elasticache[0]`
   via `-target`. The ALB/ACM drift is a separate cleanup ticket.

### Follow-ups still open

| Severity | Item |
|---|---|
| P1 | Reconcile EC2 prod `nv_sdk_applications` columns (add `organization_id` alias / `environment`, add `*_hash` columns) **OR** patch `rotate-platform-keys.ts` to match the existing dump shape, then rotate against EC2 prod. |
| P1 | Run `migrate-to-managed-datastores.sh --dump --restore --cutover` to move EC2 prod off container-local PG/Redis onto the new RDS+ElastiCache. |
| P2 | Add the four orphan tables to Drizzle (`src/db/schema/sdk-platform.ts`, `nv_schema/protocol-registry.ts`) so `npm run db:push` is the source of truth. |
| P2 | Heap-pressure follow-up #95 — CI mock-LLM smoke mode still TODO. |
| P3 | Reconcile ALB/ACM Terraform drift so a full `terraform apply` is safe (today: `-target` only). |
| P3 | Restore a `:rollback` image tag convention so future builds don't overwrite the prior `:latest`. |

---

## 0. Honest disclosure (added 2026-04-25T15:10Z) — SUPERSEDED by §0.1

> **HISTORICAL — read §0.1 for current state.** Captured here for the
> post-mortem timeline. At 15:10Z the gateway was crash-looping and
> `api.nyayasiddhi.online/api/nv/*` was returning 502. By 16:05Z (§0.1) the
> gateway is healthy again. The six issues listed below were all addressed
> as part of the recovery.

The deploy attempt today exposed several latent problems that, once the new
gateway image started, took the gateway into a crash loop. At the time of
writing, `api.nyayasiddhi.online/api/nv/*` was returning 502 Bad Gateway.
ALB, DNS, TLS, the console (`https://console.nyayasiddhi.online`), and the
legacy NSP stack were all still healthy — only the v3.1.2 gateway was down.
Concretely:

1. **EC2 prod database has stale schema.** Today's commit `19d52846b0` adds
   `nv_schema.protocol_registry` (and others). Migrations were never applied to
   EC2 prod, and the gateway aborts on bootstrap.
2. **Today's `rotate-platform-keys.ts` actually wrote keys into the *Replit
   local* Postgres, not EC2 prod.** The `nv_api_keys` table doesn't exist in
   EC2 prod and `nv_sdk_applications` has the older shape (no `app_id` column).
   Earlier sections of this report claimed the rotated keys were live in prod —
   that was wrong. They are live only in the Replit DB.
3. **Hard requirement for `NV_PII_ENCRYPTION_KEY` in production.** Today's
   commit added a guard refusing to start with a default key. EC2 `.env` had no
   key. I generated one (`.local/run/nv-pii-encryption-key-2026-04-25.txt`) and
   wrote it to `/opt/nyayavigya/repo/.../.env` so this no longer blocks startup.
4. **`.env` was missing `DATABASE_URL` and `REDIS_URL`.** I added both.
5. **Fresh BullMQ regression.** `Queue name cannot contain :` thrown by
   `registerWorker (bullmq-queue.ts:340)` — a defect in this session's Task #28
   queue work.
6. **There is no longer a “rollback image.”** Today's `docker compose build`
   overwrote the cached `:latest` tag, so the prior 2026-04-24 build is gone
   from disk. To restore service we have to roll forward.

I have stopped before doing anything that touches the prod database (running
migrations) or that requires choices only you can make.

---

## 1. Top-line

| Pillar | State | Note |
|---|---|---|
| Code (commit `19d52846b0` + bullmq queue-name fix + RDS engine_version fix) | image built on EC2; **gateway healthy** | see §0.1 |
| Production gateway | **HEALTHY — HTTP 200** at `api.nyayasiddhi.online/api/nv/*` | `status: degraded` because optional creds (payment, error-tracking, nsp_api) absent — core (db, redis, llm, jwt, agents) healthy |
| Production DNS | **LIVE on `nyayasiddhi.online`** | full table §3 |
| TLS | **LIVE** — Amazon ACM, valid through 2026-11-07 | wildcard at ALB |
| Per-platform SDK keys | **rotated only in Replit DB, NOT in EC2 prod** | see §0.1 follow-up #1; raw values in `.local/run/platform-keys-rotated-2026-04-25T14-22-29-757Z.json` |
| Per-platform docs | **published** | `SDK-PLATFORM-{NSP-WEB,NSP-MOBILE,NYAYAMITRA}.md` |
| Datastores (Postgres + Redis) | **RDS + ElastiCache PROVISIONED**, gateway still on container-local | cutover (`migrate-to-managed-datastores.sh`) staged but not yet executed — see §6 |
| Task #28 (operational hardening) | **closed** | bullmq queue-name regression fixed in this session |
| Heap pressure follow-up (#95) | open | mock-LLM CI smoke mode unfinished |

---

## 2. Deploy status

### What just happened
- Local commit at deploy time: `19d52846b0` (main, dirty=`replit`).
- Tarball: 26 MB, sha256 verified end-to-end.
- Two attempts:
  1. **`20260425T142428Z-19d52846b0-replit`** — partial. Script defaulted to
     `docker-compose.ecosystem.yml`, which references an ECR image
     (`789925699169.dkr.ecr.ap-south-1.amazonaws.com/nyv-gateway:latest`) the
     EC2 box has no creds for. Failed at rolling-restart but containers stayed
     up on the previous build.
  2. **`20260425T142805Z-19d52846b0-replit`** — in progress. Re-run with
     `NYV_DEPLOY_COMPOSE=docker-compose.aws-dev.yml`. The aws-dev compose was
     reconstructed from `docker inspect` of the four running containers
     (the original was hand-crafted on EC2 only and was wiped by `rsync --delete`
     during attempt 1). It now lives in both the source tree and on EC2.
     Currently building the gateway image (`docker build` → `npm install`).

### Layout on EC2 (`13.232.165.242`)

```
/opt/nyayavigya/
├── CURRENT_DEPLOY        # 20260425T142805Z-19d52846b0-replit
├── LAST_GOOD_DEPLOY      # 20260424T091715Z-b1448e7283-dirty
├── repo/nyayavigya-platform-312/   # active deploy root (latest tarball)
│   ├── docker-compose.aws-dev.yml  # ← reconstructed today, source-tree-tracked
│   ├── docker-compose.yml
│   ├── Dockerfile / Dockerfile.console
│   └── .env                         # 152-key prod env, untouched
└── releases/<sha>/...               # historical tarballs
```

### Containers (pre-rebuild snapshot)

```
nyv-gateway   Up 29 hours (healthy)   nyayavigya-platform-312-gateway:latest
nyv-console   Up 2 days (healthy)     nyayavigya-platform-312-console:latest
nyv-postgres  Up 2 days (healthy)     postgres:16-alpine
nyv-redis     Up 3 days (healthy)     redis:7-alpine
```

The (unrelated) `nsp-*` containers — `nsp-api`, `nsp-worker`, `nsp-web`,
`nsp-caddy`, `nsp-redis`, `nsp-postgres` — are all healthy on the same box and
serve the legacy NSP stack on port 80; they are independent from the v3.1.2
gateway rebuild and need no action.

### Once T002 finishes
The smoke-test results (gateway version, `/admin/health/full` snapshot,
breaker count, span p50/p95) will be appended to this file as §2.4 “Post-deploy
verification”. The rotated keys go straight into your secret manager — they
will not appear here.

---

## 3. DNS + TLS verification (all green at 2026-04-25T14:11Z)

All records resolve to ALB `nyv-dev-edge-alb-...elb.ap-south-1.amazonaws.com`,
HTTPS 200, presenting the Amazon-issued ACM cert
(`CN=nyayasiddhi.online`, `notAfter=2026-11-07T23:59:59Z`).

| Hostname | Purpose | DNS | TLS | HTTP |
|---|---|---|---|---|
| `nyayasiddhi.online` | apex / marketing | ✓ A → ALB | ✓ valid | 200 |
| `www.nyayasiddhi.online` | apex alias | ✓ CNAME | ✓ valid | 200 |
| `api.nyayasiddhi.online` | gateway (this is the SDK base URL) | ✓ CNAME | ✓ valid | 200 (`/api/nv/health/full` returns v3.1.2) |
| `console.nyayasiddhi.online` | admin console | ✓ CNAME | ✓ valid | 200 |
| `docs.nyayasiddhi.online` | Swagger / Redoc | ✓ CNAME | ✓ valid | 200 |
| `status.nyayasiddhi.online` | public status | ✓ CNAME | ✓ valid | 200 |
| `pro.nyayasiddhi.online` | NSP pro tenant + mobile deep-link | ✓ CNAME | ✓ valid | 200 |
| `nym.nyayasiddhi.online` | Nyayamitra citizen app | ✓ CNAME | ✓ valid | 200 |
| `min.nyayasiddhi.online` | Nyayamitra mini-app shell | ✓ CNAME | ✓ valid | 200 |
| `ace.nyayasiddhi.online` | partner / ACE | ✓ CNAME | ✓ valid | 200 |
| `ins.nyayasiddhi.online` | inside-counsel surface | ✓ CNAME | ✓ valid | 200 |

Direct ingress to EC2:443 returns 000 by design — port 443 is reachable only
through the ALB. EC2:80 is the ALB target (nginx → console / gateway).

---

## 4. Per-platform SDK summary

Three platforms. Below is the **catalog** (app IDs + tier/modules); the
SDK key *values* in `.local/run/platform-keys-rotated-2026-04-25T14-22-29-757Z.json`
are live in the **Replit local Postgres only** — they are NOT yet valid
against `api.nyayasiddhi.online` because the EC2-prod `nv_sdk_applications`
schema diverges from what `rotate-platform-keys.ts` writes (see §0.1
follow-up #1). Do not distribute these key values to platform owners until
the rotate script runs cleanly against EC2 prod and we re-emit fresh
`nyv_test_sk_*` material.

| Platform | App ID | Type | Tier | Modules |
|---|---|---|---|---|
| nsp-web | `3b420b5a-c1e6-4437-905f-96c6528af71b` | `nyayasiddhi-professional` | enterprise | clawdbot, openbot, twindesk, voice_ai, automateai, doc_intelligence, sdk_intelligence, nyayarag, skillshop, hitl |
| nsp-mobile | `35697b82-72f6-4362-840a-a19630da808a` | `nsp-mobile` | enterprise | clawdbot, openbot, voice_ai, doc_intelligence, sdk_intelligence, nyayarag, hitl |
| nyayamitra | `c7ce080f-ea04-4c44-af8e-7ffb57eb18c5` | `nyayamitra` | enterprise (citizen-scoped agents) | openbot, voice_ai, doc_intelligence, nyayarag |

Per-platform integration guides:
- `docs/v3.1.2/SDK-PLATFORM-NSP-WEB.md`
- `docs/v3.1.2/SDK-PLATFORM-NSP-MOBILE.md`
- `docs/v3.1.2/SDK-PLATFORM-NYAYAMITRA.md`

Each guide carries: endpoints, key types + headers + scopes, expiry windows,
quick-start snippets (Node/RN/PWA), feature list with rate-limit table, webhook
verification, and rotation commands.

---

## 5. Outstanding from Task #28 / pre-GA backlog

| Item | State | Action |
|---|---|---|
| WRONGPASS log flood | **fixed** | `src/utils/redis-tcp-url.ts` + queue / rate-limiter wiring |
| LLM provider breakers | **live** | `runWithRetryAndBreaker` wraps `executeWithProvider` |
| Queen lifecycle spans | **live** | `nyv-tracer` JSONL fallback + Sentry-when-DSN |
| `/api/nv/admin/health/full` | **live** | breakers + queues + provider stats + p50/p95 |
| `docs/NYV-OBSERVABILITY.md` | **updated** | breaker table + span schema + queue health |
| Smoke script `nv-smoke-task28.ts` | **landed** | breaker open verified by deliberately bad key |
| Code review (architect) | **clean** | last run end of prior session |
| **Heap pressure (#95)** | **open** | CI mock-LLM smoke mode still TODO |
| Datastore migration to RDS + ElastiCache | **staged, not applied** | see §6 |

---

## 6. RDS + ElastiCache — provisioned today; cutover pending

`terraform apply -target=module.rds[0] -target=module.elasticache[0]` ran
successfully at 2026-04-25T15:55Z. Both endpoints are reachable from the
nysdev EC2's security group `sg-0ba15ba2b74a651fb` (Terraform created the
ingress rules). Gateway is **still talking to the on-EC2 containers** — the
data cutover (`migrate-to-managed-datastores.sh`) has not yet run.

| Resource | Identifier | Endpoint | Class / Storage | Status |
|---|---|---|---|---|
| RDS Postgres | `nyv-dev-edge-pg` | `nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com:5432` | `db.t4g.small`, 20 GB gp3, single-AZ, 7-day backup | available, postgres 16.6 |
| ElastiCache Redis | `nyv-dev-edge-redis` | `master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` (TLS, AUTH) | `cache.t4g.micro`, single-node | available, Redis 7 |

Master credentials and Redis AUTH token are in **AWS Secrets Manager**
(`nyv-dev-edge-pg/rds/master`, `nyv-dev-edge-redis/redis/auth`). Do not paste
them into chat or commit them.

### Engine-version fix applied this session

`infra/terraform/modules/rds/main.tf:123` was bumped `16.3 → 16.6` because
RDS in `ap-south-1` no longer offers 16.3. Lowest 16.x available today is
16.6; latest is 16.13. 16.6 was chosen as the most conservative bump.

### Cutover (separate operation, not run today)

> **⚠ Do NOT run `migrate-to-managed-datastores.sh` as-is.** Its defaults
> still target the obsolete topology:
> - `COMPOSE_FILE=/opt/nyayavigya/current/docker-compose.ecosystem.yml`
> - services `gateway-a gateway-b`
>
> Today's recovery uses `docker-compose.aws-dev.yml` and a single `nyv-gateway`
> service. Before cutover, either patch the script defaults or pass overrides
> on every invocation:
>
> ```bash
> export COMPOSE_FILE=/opt/nyayavigya/repo/nyayavigya-platform-312/docker-compose.aws-dev.yml
> export GATEWAY_SERVICES=nyv-gateway
> ```

```bash
# from /opt/nyayavigya/repo/nyayavigya-platform-312
bash scripts/migrate-to-managed-datastores.sh --preflight   # dry-run, prints diff
bash scripts/migrate-to-managed-datastores.sh --dump        # pg_dump container PG → /opt/nyayavigya/migration/<ts>/dump.sql.gz
bash scripts/migrate-to-managed-datastores.sh --restore     # restore into RDS
bash scripts/migrate-to-managed-datastores.sh --cutover     # swap DATABASE_URL/REDIS_URL in .env, restart gateway
```

Wall-time ≈ 25 min, user-facing degradation ≈ 5 min during cutover. Roll-back
is `--rollback` (re-points the env back at the containers).

### Why I scoped today's apply with `-target`

A full `terraform apply` would have **destroyed `aws_lb_listener.https[0]`
and `acm_certificate_validation.this[0]`** (drift between the live ALB/ACM and
the `count`-based config). Destroying them would drop HTTPS for every
hostname in §3. The `-target` flag limited blast radius to RDS+ElastiCache
only. Reconciling that drift is a separate ticket (P3 in §0.1).

---

## 7. Recommended sequence to GA

1. **Today** — wait for `20260425T142805Z-...` rebuild to land; record §2.4
   verification; close out follow-up #95 (mock-LLM CI smoke).
2. **Tomorrow (with your go)** — run `migrate-to-managed-datastores.sh`,
   re-verify all three platform smoke flows.
3. **Day +2** — flip `NYV_PLATFORM_ENV=production` and re-run
   `scripts/rotate-platform-keys.ts` to issue `nyv_live_*` keys; redistribute
   to platform owners.
4. **Day +3** — open the GA ALB listener to public DNS for nsp-mobile and
   Nyayamitra; nsp-web is already reachable.

---

## 8. Single-EC2 caveats to call out

- All three platforms + the legacy NSP stack live on the **same** `t3.large`
  (2 vCPU, 8 GiB). Heap pressure has reached 95% under load (open follow-up).
- No autoscaling, no second AZ, no read replica.
- This is acceptable for a *near*-production-ready dev edge but **not** for
  paying-customer GA. The existing Terraform supports an ASG + ALB target
  group swap when you’re ready.
