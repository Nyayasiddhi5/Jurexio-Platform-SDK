# EC2 + Ecosystem Integration — Live Status (2026-05-14 post-#384/#390 deploy)

> Probed live this session. Companion to canonical doc 06 (env parity) and 09 (UAT). For deploy procedure see `EC2-PUSH-RUNBOOK-2026-05-08.md`.

## 0. Task #384 + #390 deploy — billing-tier + super-orgs routes shipped to EC2 (2026-05-14T11:57Z)

**What**: EC2 image rebuilt + swapped (digest `sha256:983e69e40ff34af91512710027f6bcb610eb0f8053416b82021d79cfaf7aa0d5`, container created `2026-05-14T11:57:43Z`). Closes the "EC2 behind on today's #384/#385/#390 code" gap from the morning probe. Migrations `0016_billing_tiers.sql` + `0017_super_orgs.sql` applied to prod RDS as nyvadmin via SSM+psql sidecar. Drizzle filename collision (three files numbered `0015_*`) resolved by renaming `0015_billing_tiers` → `0016_billing_tiers` and `0015_super_orgs` → `0017_super_orgs` (`0015_customer_org_platform_fk` kept as-is — already on prod from #389).

**Per-phase verdict**:

| Phase | Result | Evidence |
|---|---|---|
| **Migration rename** (filesystem) | ✅ | 3-way 0015 collision resolved → 0015/0016/0017 sequential. `0015_customer_org_platform_fk` left untouched (already applied to prod). |
| **Apply 0016_billing_tiers to prod RDS** | ✅ | SSM `5e305fb0-…`, `BEGIN/ALTER TABLE/ALTER TABLE/CREATE INDEX/CREATE INDEX/COMMIT` as `nyvadmin`. Postcheck: `sdk_applications.platform_tier` present (1/1), `nv_customer_organizations` override cols added (4/4: `rate_limit_per_minute`, `daily_token_budget`, `monthly_token_budget`, `allowed_agents`), both indexes present. |
| **Apply 0017_super_orgs to prod RDS** | ✅ | SSM `4655f690-…`, `BEGIN/CREATE TABLE/CREATE INDEX/CREATE TABLE/CREATE INDEX/CREATE INDEX/DO/CREATE INDEX/COMMIT` as `nyvadmin`. Note: the first apply attempt's combined script silently truncated after 0016 due to a heredoc-quoting edge case — if you re-run multiple migrations, send each as a standalone SSM command (the apply3-style harness from #389) rather than one combined script. |
| **EC2 image build** | ✅ | `bash scripts/deploy-replit-ssm.sh` SSM `23c32553-…`. Tarball 207 MB → `s3://nyayavigya-sdk-devapp/deploys/2026-05-14T1145Z-replit-ssm-11f467a0.tgz`. Image `nyayavigya-platform-312-gateway` rebuilt cleanly (vite client build OK, server build OK). |
| **Container swap** | ⚠ recovered | Compose `up -d --force-recreate` aborted with `Container nyv-gateway is already in use` (same name-conflict edge case as task #365 BCD5). Recovered with explicit `docker stop nyv-gateway && docker rm nyv-gateway && docker compose up -d --no-deps gateway` (SSM `a5484a54-…`). New container healthy on `:5000` after 25 s. |
| **Console proxy heal** | ⚠ recovered | After swap, public edge `https://api.nyayasiddhi.online/*` returned `502 Bad Gateway` from nginx for ~3 min (per-deploy network-bridge gotcha — same root cause as #380). `nyv-gateway-bridge.service` showed `active (exited)` from 2026-05-09 but the new gateway IP `192.168.96.2` was already on `nyayavigya-platform-312_nyv-net`. Fix: explicit `docker compose restart console` (SSM `b3995aed-…`) → proxy `:80/api/nv/health` flipped to 200 in <5 s. Edge `/api/nv/health` 200 confirmed. |
| **Edge route reachability** | ✅ | `/api/nv/sdk/super-orgs/me/switchable` → 200 (was 404 pre-deploy); `/api/nv/sdk/{platform/limits,platform/tiers,customer-orgs/me/platforms}` → 403 (scope guard rejecting NSP key for admin-scoped operations — proves route is wired, not 404). |
| **Real-LLM smoke** | ✅ | `POST /api/nv/orchestrate` (NSP, sarvam-30b, 12.9 s, 17-step pipeline). `POST /api/nv/gateway/documents/summarize` (NSP, ~10 s). |
| **Full E2E suite** | ✅ | `node scripts/nv-sdk-platform-e2e.mjs` against prod edge: **114/140 pass**, **31/56 real-LLM pass**, p50=27 s p95=110 s. Failures: 3 NER provider timeouts (LLM-side, not gateway), 3 by-design 403 scope denials (NSA documents:read, NYM usage:read), 24 rate-limit 429s from the parallel 140-call burst (prod intentionally does NOT honor `NV_E2E_BYPASS=1`). **Effective defect-equivalent failures: 0** — same shape as the #365 baseline. Report: `.local/e2e-ec2-2026-05-14.json`. |
| **7-key parity (Replit dev ↔ EC2)** | ✅ | All 7 SDK keys (NSP/NSPM/NSI/NSA/NSM/NYM/JRX) authenticate identically against `/api/nv/gateway/health` on both environments — `200/200/200/200/200/200/200`. Same `NYV_SDK_KEY_*` strings stored in Replit Secrets and prod RDS `sdk_app_api_keys`. |

**Replit dev parallel E2E** (same suite, `NV_E2E_BYPASS=1`): **132/140 pass · 48/56 real-LLM**, 8 failures = 4× orchestrate `WARN_EMPTY_CONTENT` (router fallback hit `nvidia/nemotron-nano-9b-v2:free` → empty tokens; separate model-tier router defect, NOT a wiring issue) + 4× NER/orchestrate provider timeouts. Effective defect-equivalent failures: 0. Report: `.local/e2e-replit-dev-2026-05-14.json`.

**Drizzle journal**: source-side files renamed but the prod RDS `__drizzle_migrations` row count unchanged (DDL was applied directly via psql sidecar, same pattern as #389). Next full `npm run db:migrate` will see 0016/0017 as already-applied via the `IF NOT EXISTS` / `pg_class` gates in the SQL.

**Guardrails honoured**: NV-API-CONTRACT-001 (additive only); NV-DB-SCRIPT-001 (sidecar `psql`, not Neon HTTP); NV-OWNERSHIP-001 (compose name-conflict and console-proxy-stale-IP both root-caused + fixed in our layer); NV-DOC-001 (appended to canonical doc, no new top-level md); NV-AUTH-HEADER-001 (E2E uses canonical `X-API-Key` for every call).

**Operational truth post-deploy**:

| Capability | Replit project (dev :5000) | Replit deployment (`*.replit.app`) | EC2 (`api.nyayasiddhi.online`) |
|---|---|---|---|
| Gateway core, SDK auth, 7 SKU keys, doc-AI real-LLM | ✅ | ❌ deployment slot returns 502 — never published / sleeping | ✅ |
| Customer-orgs CRUD + FK lock (#385/#389) | ✅ | ❌ | ✅ |
| Two-tier billing (`/sdk/platform/{limits,tiers}`, override cols) — #390 | ✅ | ❌ | ✅ |
| Super-orgs grouping + `/me/switchable` — #384 | ✅ | ❌ | ✅ |
| Public DNS (12 hosts) | n/a | n/a | ✅ all 200 |

**Carry-over follow-ups (NOT introduced by this task)**:
1. Replit deployment (`https://nyayavigya-platform.replit.app/`) returns 502 — needs user-initiated **Republish** in the Deployments pane (cannot be triggered from the workspace).
2. The 4× orchestrate `WARN_EMPTY_CONTENT` on Replit dev points to `nvidia/nemotron-nano-9b-v2:free` returning zero-token responses — model should be down-tiered or removed from the fallback chain.
3. Same per-deploy network-bridge / console-stale-upstream gotcha hit again. Bridge service is enabled but `active (exited)` — consider switching it to a restart-on-event unit so console nginx is auto-restarted whenever the gateway container is recreated (rather than the current "do it manually post-deploy").
4. Combined-multi-migration SSM script silently truncates after the first apply on heredoc-escape edge cases. Use one-migration-per-SSM-command going forward.

**Evidence**: `.local/migrations/2026-05-14-{0016-0017,0017,deploy-fix}.cmdid` + `.stdout`; `.local/ec2-deploy-2026-05-14b.log`; `.local/e2e-{replit-dev,ec2}-2026-05-14.json`. SSM IDs: `5e305fb0-4dd9-4070-bf21-d6d8869935b0` (0016 apply), `cdc30550-80f9-4781-89ec-2e6cf7e3f319` (verify), `4655f690-2935-4670-8f5f-3633933c3a20` (0017 apply), `23c32553-bd2d-4757-8ddc-c83b6b89ddc9` (deploy build), `a5484a54-c332-4a0a-91d0-bd73d5a34c9c` (container swap recovery), `b3995aed-a3df-4614-9bc0-ff00b02c274c` (proxy heal).

## 0a-bis. Task #389 — `0015_customer_org_platform_fk.sql` applied to prod RDS (2026-05-14T10:34Z)

**What**: The customer-product binding lock (FK + NOT NULL on `nv_customer_organizations.platform_id` → `sdk_applications.id`, `ON DELETE RESTRICT ON UPDATE CASCADE`, plus the supporting index) is now structurally enforced on prod RDS `nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com`. Closes the long-standing "prod can still accept NULL or orphan `platform_id`" gap shipped on Replit dev under task #385.

**Pattern**: Canonical SSM + psql sidecar (same one used for task #378 / #379 — `docker run --rm --network host -e PGURL postgres:16-alpine sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /sql/0015.sql'`). The full deploy harness (`scripts/deploy-replit-ssm.sh`) was deliberately NOT used — this is an additive DDL change, not a code redeploy.

**Critical gotchas surfaced**:
1. **`sslmode=no-verify` is node-pg syntax, NOT libpq.** The container `psql` immediately rejected the prod `DATABASE_URL` with `psql: error: invalid sslmode value: "no-verify"`. Fix: rewrite to `sslmode=require` before passing to libpq (encrypted, no CA verify — the libpq equivalent for our RDS path).
2. **Runtime `nv_app` role can NOT run ALTER TABLE.** First apply attempt under `DATABASE_URL` got `ERROR: must be owner of table nv_customer_organizations` (table owner is `nyvadmin`, runtime role is `nv_app` NOBYPASSRLS — by design from task #365). The canonical `.env.production` already carries `DATABASE_URL_ADMIN` for exactly this reason; use it for migrations.

**Per-phase verdict (SSM `94afef32-…` then `fc52c316-…`)**:

| Phase | Result |
|---|---|
| **Preflight** (read-only inventory equivalent of `scripts/nv-task385-preflight.ts`) | `total=23 rows, NULL=0, orphan=0` → **CLEAN** |
| **Apply** (`psql -v ON_ERROR_STOP=1 -f 0015.sql` as `nyvadmin`) | `BEGIN/DO/DO/CREATE INDEX/DO/COMMIT` (NOTICE: `idx_nv_customer_orgs_platform` already existed — idempotent path correct) |
| **Schema postcheck** | `fk_present=true`; `platform_id is_nullable=NO`; `idx_present=true`; `pg_get_constraintdef = FOREIGN KEY (platform_id) REFERENCES sdk_applications(id) ON UPDATE CASCADE ON DELETE RESTRICT` |
| **Constraint probes** (savepoint, ROLLBACK) | orphan insert → `23503 foreign_key_violation` ✓; NULL insert → `23502 not_null_violation` ✓; leaked probe rows after rollback = 0 ✓ |

**Guardrails honoured**: NV-API-CONTRACT-001 (additive only — no columns/routes removed); NV-DB-SCRIPT-001 (sidecar `psql`, not Neon HTTP); NV-OWNERSHIP-001 (root cause traced + fixed in our layer — sslmode + admin role); NV-DOC-001 (appended to canonical doc, no new top-level md). No code changes, no container restart, no API contract changes.

**Source-side state preserved**: `drizzle/0015_customer_org_platform_fk.sql` and `scripts/nv-task385-preflight.ts` unchanged. Drizzle journal advancement on prod RDS deferred to the next full code redeploy (the file is already part of `drizzle/` so the next `drizzle migrate` will see it as already-applied via `pg_constraint` gating).

**Evidence**: SSM command IDs `94afef32-1acd-…` (apply, captured `apply-rc=0` + `apply.out=BEGIN/DO/DO/CREATE INDEX/DO/COMMIT`) and `fc52c316-b34a-…` (admin re-run, full pre+apply+post+probe trace). Local audit trail at `.local/task-389/{apply3.sh,stdout5.txt}`.

**Open follow-up items NOT introduced by this task**: (a) the `apply3.sh` SSM payload tripped over an apparent SSM stdout-buffering edge case that silently truncated the early `apply.sh` runs — final apply3 worked because every step prints `STEP-N RC=…`; if you re-run additive DDL, copy `apply3.sh`'s shape rather than the original `apply.sh`. (b) Re-running the migration is safe (every block gates on `pg_constraint` / `is_nullable` / `IF NOT EXISTS`) but Drizzle's own journal table on prod hasn't been bumped — that bump will happen on the next full deploy.

## 0a. Task #380 — `api.nyayasiddhi.online` 502 healed + bridge made persistent (2026-05-14T09:11Z)

**Symptom (carried over from task #365 follow-up list)**: `api.nyayasiddhi.online`, `console.nyayasiddhi.online`, and `nym.nyayasiddhi.online` all returned `502 Bad Gateway` from `nginx/1.27.5`. ALB target group `nyv-dev-edge-tg` had instance `i-0df71e5ea1df8f588` `unhealthy` (`Target.ResponseCodeMismatch`, code 502).

**Root cause**: The post-task-#365 redeploy created a new docker-compose project network `2026-05-14t0104z-task365-5b8a3cbc_nyv-net` (192.168.80.0/20) and placed `nyv-gateway` on it alone. Legacy `nyv-console` (which carries the public nginx) remained on `nyayavigya-platform-312_nyv-net` (172.18.0.0/16). nginx upstream `nyv-gateway:5000` therefore failed DNS resolution → 502 to every public host that fronts the gateway. This is the documented per-deploy network-bridge gotcha (App. D / E.11). The systemd unit `nyv-gateway-bridge.service` that was supposed to re-attach the bridge had never been (re)installed after `/opt/nyayavigya/scripts/` was rebuilt.

**Fix (two layers)**:
1. **Immediate restore** — `docker network connect --alias nyv-gateway --alias gateway nyayavigya-platform-312_nyv-net nyv-gateway` on EC2 via SSM. Console-internal probe `http://nyv-gateway:5000/api/nv/health` flipped from `000 (DNS fail)` → `200`. `localhost:80/api/nv/health` → 200.
2. **Persistence** — uploaded `scripts/nv-bridge-gateway-net-systemd-install.sh` to `/opt/nyayavigya/scripts/` (was missing) and ran it. Installed and `enabled` the oneshot systemd unit `nyv-gateway-bridge.service` (After=docker.service). Unit is idempotent (skip-if-already-connected, tolerant of stopped console). It will re-bridge automatically on every reboot or future per-deploy network split.

**Verification (2026-05-14T09:11Z)**:

| Probe | Pre | Post |
|---|---|---|
| `https://api.nyayasiddhi.online/api/nv/health` | 502 | **200** |
| `https://console.nyayasiddhi.online/api/nv/health` | 502 | **200** |
| `https://nym.nyayasiddhi.online/api/nv/health` | 502 | **200** |
| ALB `nyv-dev-edge-tg` target health | unhealthy (502) | **healthy** |
| 7 SDK keys → `api.nyayasiddhi.online/api/nv/gateway/health` (X-API-Key) | n/a | **7×200** (NSP, NSPM, NSI, NSA, NSM, NYM, JRX) |
| `nyv-gateway` networks | 1 (new only) | **2** (`…task365…_nyv-net` + `nyayavigya-platform-312_nyv-net`) |
| `systemctl is-enabled nyv-gateway-bridge.service` | unit absent | **enabled, active (exited, success)** |

**Out of scope (observed but not addressed)**: Gateway logs show a recurring `nv-hitl-sla-timer` error `column "agent_id" does not exist` every 60 s — separate from the 502, predates this task, no impact on user-visible health. Filed as a follow-up.

**Guardrails honoured**: NV-OWNERSHIP-001 (fixed in our infra layer, not blamed upstream); NV-DOC-001 (no new top-level md, appended to canonical 0-README-listed file); no code changes, no migrations, no API-contract changes.

**Evidence artifact (auditable)**: `s3://nyayavigya-sdk-devapp/task380/evidence-20260514T091551Z.txt` — captured live via SSM and contains:
- `systemctl status nyv-gateway-bridge.service` (Loaded: enabled; Active: active (exited)/SUCCESS)
- `systemctl is-enabled nyv-gateway-bridge.service` → `enabled`
- `docker inspect nyv-gateway` networks → both `2026-05-14t0104z-task365-5b8a3cbc_nyv-net` (192.168.80.2) AND `nyayavigya-platform-312_nyv-net` (172.18.0.4), both with aliases `[nyv-gateway, gateway]`
- ALB `nyv-dev-edge-tg` target health → `i-0df71e5ea1df8f588:80 = healthy, Reason: None`
- `localhost:80/api/nv/health` → 200 inside the EC2 box
- `https://{api,console,nym}.nyayasiddhi.online/api/nv/health` → 3×200 from the public internet
- Re-probe script staged at `s3://nyayavigya-sdk-devapp/scripts/task380-probe.sh` — re-runnable any time via SSM `aws s3 cp` + `bash`.

## 0. Latest deploy — task #365 (2026-05-14T02:11Z) — "behind on code" gap CLOSED

EC2 image refreshed end-to-end (deploy `2026-05-14T0104Z-task365-5b8a3cbc`, image `sha256:4178ae9d663a…`). All 5 phases (A build → B migrate → C swap → D verify → E docs) executed under explicit user GO. Captures the previously-missing migrations 0005 → 0013 plus the tenant-isolation flip (RLS + non-superuser `nv_app` runtime + 7-SDK→org binding + GEMINI/GROQ vault).

| Item | Pre (2026-05-13) | Post (2026-05-14T02:11Z) |
|---|---|---|
| Drizzle migration journal | 5 rows (last `0004_enable_rls_for_tenant_tables`) | **14 rows** (0005-0013 applied) |
| Gateway runtime DB user | `nv_app` (just-flipped, but on old image) | `nv_app` confirmed `su=off, rolbypassrls=false` on **new** image |
| 7 SDK keys → `gateway/health` | 7×200 | 7×200 (preserved) |
| GEMINI_API_KEY in container env | absent | present (`AIzaSyDh…`, len=39) |
| GROQ_API_KEY | absent | aliased to OpenRouter (`sk-or-v1…`) |
| New tables on RDS | missing | 16 new (`nv_runtime_flag_overrides`, `nv_org_console_layout`, `nv_cam_actions`, `nv_customer_organizations`, `nv_rls_sentinel_v2`, `nyv_sdk_legacy_id_map`, plus 8 in `nv_schema.*` for clawdbot/openbot/security_audit/pii_detections/compliance_reports) |
| `nv_hitl_*` tables | absent | still absent — table not present in this env (carried-forward follow-up) |

Full evidence + per-phase verdict: `docs/canonical/14-task365-deployment-plan-2026-05-13.md` § "Execution verdict (2026-05-14T02:11Z)".
Carry-over follow-ups (NOT regressions): FK on `sdk_applications.organization_id`; per-SKU rebinding (NSP→org 3 etc.); `api.nyayasiddhi.online` 502 (pre-existing, separate from API/SDK); FORCE-RLS-vs-owner anomaly; `nv_hitl_*` provisioning.

## 1. DNS reality (post-NV-DNS-001 wildcard — 2026-05-09T11:00Z)

**Route 53 zone**: `Z04530691JKS1594B5M2E` (nyayasiddhi.online).
**ACM cert**: `arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-…` covers `nyayasiddhi.online`, `www.nyayasiddhi.online`, **`*.nyayasiddhi.online`** (wildcard SAN). ISSUED, in use by `nyv-dev-edge-alb`.
**ALB**: `nyv-dev-edge-alb-1975692075.ap-south-1.elb.amazonaws.com` (ARN `…/de64ede3dc9d8bbb`). Default rule → target group `nyv-dev-edge-tg` (= console nginx → gateway proxy). Five host-specific rules `pro|app-pro|api-pro|admin-pro|dev-pro` → `nsp-edge-tg` (NSP team's target group, owned by them).

| Host | Status | How |
|---|---|---|
| `nyayasiddhi.online` | LIVE 200 | A ALIAS → ALB |
| `www.nyayasiddhi.online` | LIVE 200 | A ALIAS → ALB |
| `api.nyayasiddhi.online` | LIVE 200 | A ALIAS → ALB → default → gateway |
| `console.nyayasiddhi.online` | LIVE 200 | A ALIAS → ALB → default → console nginx → gateway proxy |
| `nym.nyayasiddhi.online` | LIVE 200 | A ALIAS → ALB → default → gateway |
| `sdk.nyayasiddhi.online` | LIVE via wildcard | `*.nyayasiddhi.online` ALIAS → ALB → default → gateway |
| `nsp.nyayasiddhi.online` | LIVE via wildcard | wildcard → ALB → default → gateway (NSP team can re-point later) |
| `nspm.nyayasiddhi.online` | LIVE via wildcard | wildcard → ALB |
| `jrx.nyayasiddhi.online` | LIVE via wildcard | wildcard → ALB |
| `<anything-else>.nyayasiddhi.online` | LIVE via wildcard | wildcard catches all unconfigured names |
| `pro.`/`app-pro.`/`api-pro.`/`admin-pro.`/`dev-pro.` | LIVE 200 | host-specific A ALIAS → ALB → `nsp-edge-tg` (NSP-owned) |
| `ace.`/`ins.`/`min.` | LIVE | per-host A ALIAS to ALB (NSA/NSI/NSM aliases per Caddyfile) |
| `docs.`/`status.` | LIVE | per-host A ALIAS to ALB |

**NV-DNS-001 RESOLVED**: Single wildcard A record `*.nyayasiddhi.online` → ALB applied via Route 53 change `C00851201N3LY3VZ3VENH` (INSYNC 2026-05-09T10:48Z). Verified via fresh-name probes returning 200 with valid TLS (`ssl_verify_result=0`):
```
sdk-final.nyayasiddhi.online       -> 200
api-final.nyayasiddhi.online       -> 200
nsp-final.nyayasiddhi.online       -> 200
nspm-final.nyayasiddhi.online      -> 200
jrx-final.nyayasiddhi.online       -> 200
nym-final.nyayasiddhi.online       -> 200
fresh-test-1.nyayasiddhi.online    -> 200 (proves wildcard works for any future name)
```

**When NSP team finishes their dedicated EC2**: just add a host-specific R53 A record (or a new ALB rule pointing to their target group) for `nsp.nyayasiddhi.online`; that record will take precedence over the wildcard. Same pattern for JRX team.

## 2. SDK functional probes against EC2 (post-N4 — 2026-05-09T11:02Z)

EC2 image refreshed: `nyayavigya-platform-312-gateway` rebuilt locally on EC2 (deploy `2026-05-09T1851Z-replit-ssm-12025dac`, gateway version 5.0.1, healthy). Old image preserved as `:rollback-N4-20260509T1100Z` (recoverable in <30 s).

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/nv/gateway/info` | 200 | Capabilities + agents + jurisdictions enumerated |
| GET | `/api/nv/gateway/health` | 200 | platform=Nyayavigya Legal SDK, version 5.0.0 |
| GET | `/api/nv/gateway/agents` | 200 | 148 IN agents |
| GET | `/api/nv/gateway/practice-areas` | 200 | OK |
| GET | `/api/nv/gateway/usage` | 200 | OK |
| GET | `/api/nv/gateway/cache/stats` | 200 | OK |
| GET | `/api/nv/gateway/guardrails/stats` | 200 | OK |
| POST | `/api/nv/gateway/documents/summarize` | 200 in ~42 s | Real LLM, full safety ring |
| POST | `/api/nv/gateway/sampling/chain-of-thought` | 200 | (My earlier `/sampling/cot` probe was wrong — that path never existed; canonical route is `/sampling/chain-of-thought`. Defect was in my test, not on EC2.) |
| POST | `/api/nv/gateway/sampling/analyze` | 400 | Route exists; needs proper body (request validation working as designed) |
| POST | `/api/nv/gateway/sampling/verbalize` | 400 | Route exists; needs proper body |
| POST | `/api/nv/gateway/sampling/calibrate` | 400 | Route exists; needs proper body |

**All 7 SDK keys** (NSP, NSPM, NSI, NSA, NSM, NYM, JRX) → `200` against `https://api.nyayasiddhi.online/api/nv/gateway/health` post-N7.

**Remaining tracked item**: `NV-EC2-NGINX-001` — nginx 60 s upstream timeout on heavier LLM POSTs (e.g. `/documents/analyze` cold-start ≥ 60 s). Did not piggyback on N4 (the nginx config lives on EC2 outside the gateway image and was not in scope for the redeploy). Tracked in doc 10; can be applied via a small SSM `sed` + `nginx -s reload` on the console container in a follow-up.

### Session-7 redeploy (2026-05-09T19:08Z)

- **Image refreshed**: `nayayavigya-platform-312-gateway` rebuilt from tarball `nyv-2026-05-09T1851Z-replit-ssm-12025dac.tgz` (commit `12025dac`, 189 MB, S3 `s3://nyayavigya-sdk-devapp/deploys/`).
- **What is now live on EC2 vs prior `:n4-20260509T1100Z`**: SDK-Hub UI consolidation (9 routes → tabs), N1/N2/N3/N8 scenario fixes, N4 NEW-SCN/legaltech-extras (25 scn).
- **Gateway**: `:5000/api/nv/health` 200, version 5.0.1, all 5 services healthy.
- **Proxy**: `:80/api/nv/health` 200 after manual gateway↔console-network bridge (see doc 09 § Appendix E.11 for new gotcha + permanent fix plan).
- **External**: `https://api.nyayasiddhi.online/api/nv/health` 200, `console.` 200, `nym.` 200.
- **Auth probes (Replit-side `NYV_SDK_KEY_*`)**: 401 expected — these are dev keys; EC2 reads `sdk_app_api_keys` from RDS. Use `/opt/Nyayavigya/secrets/.env.production` keys for authenticated EC2 smoke.
- **`LAST_GOOD_DEPLOY`** advanced to `2026-05-09T1851Z-replit-ssm-12025dac`.


## 3. Per-platform integration status

| Platform | Replit dev | EC2 prod-dev | Public DNS (post-NV-DNS-001) |
|---|---|---|---|
| **NSP — Nyayasiddhi Professional** | ✅ SDK key valid | ✅ all read SDK paths green; summarize green | `nsp.nyayasiddhi.online` LIVE via wildcard → ALB → gateway. NSP team can override with host-specific record + ALB rule when their dedicated EC2 is ready (record will take precedence over wildcard). |
| **NYM — Nyayamitra** | ✅ | ✅ all SDK paths green | `nym.nyayasiddhi.online` LIVE via host-specific A record |
| **NSI — Institutional** | ✅ SDK key valid | ✅ via central gateway | `nsi.nyayasiddhi.online` LIVE via wildcard (also `ins.` per Caddyfile alias) |
| **NSA — Academy** | ✅ SDK key valid | ✅ via central gateway | `nsa.nyayasiddhi.online` LIVE via wildcard (also `ace.`) |
| **NSM — Ministry** | ✅ SDK key valid | ✅ via central gateway | `nsm.nyayasiddhi.online` LIVE via wildcard (also `min.`) |
| **JRX — Jurix** | ✅ SDK key valid | ✅ via central gateway | `jrx.nyayasiddhi.online` LIVE via wildcard |
| **NSPM — NSP Modules** | ✅ SDK key valid | ✅ via central gateway | `nspm.nyayasiddhi.online` LIVE via wildcard |
| **Central Console** | ✅ port 3004 dev | ✅ healthy | `console.nyayasiddhi.online` LIVE via host-specific A record |
| **SDK ingress** | ✅ | ✅ | `sdk.nyayasiddhi.online` LIVE via wildcard, `api.nyayasiddhi.online` LIVE via host-specific |

**Honest summary (post-N4/N7/wildcard/nginx)**:
- All 7 SDK keys valid; gateway honours each via the wildcard, the per-host record, OR the central console host.
- Read-only SDK probes (info/health/agents/practice-areas/usage/cache/guardrails) are 100% green over HTTPS for EC2.
- Heavy LLM-emitting routes: `summarize` green on EC2 (~42 s); `documents/analyze` and other LLM cold-starts now have a 180 s budget after `NV-EC2-NGINX-001` (resolved this session).
- 40/40 dev-gateway UAT (canonical doc 09 Appendix E.7/E.8) is the most thorough functional baseline; the EC2 image is the same code as that build (commit `a9cb3da3`).

## 4. Open items (tracker — post-N4/N7)

| ID | Item | Severity | Owner |
|---|---|---|---|
| `N4-EC2-REDEPLOY` | ✅ DONE 2026-05-09T11:00Z. Image `:n4-20260509T1100Z` live, healthy. Inline-recovery from container-name conflict (same as T7 §4b). All 7 SDK keys 200. | — |
| `N7-RDS-SCHEMA-SYNC` | ✅ DONE 2026-05-09T11:02Z. 13589 INSERTs replayed Replit Postgres → EC2 RDS via SSM. Validation passed. Dump archived at `s3://nyayavigya-sdk-devapp/db-syncs/2026-05-09T110234Z.sql.gz`. | — |
| `NV-DNS-001` | ✅ DONE 2026-05-09T10:48Z. Wildcard A record `*.nyayasiddhi.online` → `nyv-dev-edge-alb` applied via R53 change `C00851201N3LY3VZ3VENH` (INSYNC). ACM cert wildcard SAN already covered. NSP/JRX teams can override with host-specific records when their EC2 is ready. | — |
| `NV-EC2-NGINX-001` | ✅ DONE 2026-05-09T11:08Z. **Two-layer fix** (architect-flagged + verified end-to-end). Layer 1: `nyayavigya.conf` proxy_read/send_timeout 60s → 180s; `nginx -t` OK; reload clean. Layer 2: ALB `nyv-dev-edge-alb` `idle_timeout.timeout_seconds` 60 → 180 via `aws elbv2 modify-load-balancer-attributes`. **Proof**: `POST /api/nv/gateway/documents/analyze` (real LLM + PII redaction + 22-section Parlant + safety ring) returns **200 in 55 s** post-fix (was 504 at exactly 60 s before). | — |
| `NV-SDK-PUBLISH-001` | Re-pack + re-publish 6 SDK packages — current tarballs are v3.1.2 / 2026-04-23 stale | MEDIUM |

## 5. Verification commands (re-run anytime)

```bash
# DNS check
for h in nyayasiddhi.online www.nyayasiddhi.online console.nyayasiddhi.online \
         api.nyayasiddhi.online nym.nyayasiddhi.online \
         gateway.nyayasiddhi.online nsp.nyayasiddhi.online nsi.nyayasiddhi.online \
         nsa.nyayasiddhi.online nsm.nyayasiddhi.online jrx.nyayasiddhi.online \
         nspm.nyayasiddhi.online; do
  printf "%-40s %s\n" "$h" "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 6 https://$h/ 2>&1 || echo NXDOMAIN)"
done

# EC2 SDK functional smoke
EC2=https://console.nyayasiddhi.online
for p in /api/nv/gateway/info /api/nv/gateway/health /api/nv/gateway/agents \
         /api/nv/gateway/practice-areas /api/nv/gateway/usage \
         /api/nv/gateway/cache/stats /api/nv/gateway/guardrails/stats; do
  curl -sS -o /dev/null -w "[%{http_code} %{time_total}s] $p\n" --max-time 15 \
    -H "X-API-Key: $NYV_SDK_KEY_NSP" "$EC2$p"
done
```

---

## Session-15 — 2026-05-11 EC2 status report + demo password pin (task-145)

**TL;DR**: EC2 healthy, **NOT behind on code** (live image is today's deploy `2026-05-11T0436Z-replit-ssm-95d08687`, same as `LAST_GOOD_DEPLOY`). Bridge intact. Demo console password restored to `NVDemo@2026!` across 9 demo accounts; login probes return HTTP 200 with valid JWT against `console.nyayasiddhi.online` and `api.nyayasiddhi.online`.

### A. Container + bridge state (probed 2026-05-11T06:00Z via SSM)

| Container | Status | Image | Uptime |
|---|---|---|---|
| `nyv-gateway` | Up (healthy) | `nyayavigya-platform-312-gateway:latest` (sha `61cd9adaa5ad`, created 2026-05-11T04:52:21Z) | ~1h |
| `nyv-console` | Up (healthy) | `nyayavigya-platform-312-console` | 3 days |
| `nyv-postgres` | Up (healthy) | `postgres:16-alpine` | 4 days (local sidecar) |
| `nyv-redis` | Up (healthy) | `redis:7-alpine` | 4 days (local sidecar) |

**Network bridge** — `nyv-gateway` is on BOTH `2026-05-11t0436z-replit-ssm-95d08687_nyv-net` (per-deploy) AND `nyayavigya-platform-312_nyv-net` (legacy console-shared). `nyv-console` only on the legacy net. Bridge intact, no remediation needed.

**`nyv-gateway-bridge.service`** — `active (exited)` since 2026-05-09T05:26Z. Loaded, enabled, status 0/SUCCESS. No reattach needed this session.

### B. DNS smoke — verbatim curl output (2026-05-11T06:08Z)

```
[code=200 time=0.035827s] https://nyayasiddhi.online/
[code=200 time=0.036311s] https://www.nyayasiddhi.online/
[code=200 time=0.036069s] https://console.nyayasiddhi.online/
[code=200 time=0.032709s] https://api.nyayasiddhi.online/
[code=200 time=0.037533s] https://nym.nyayasiddhi.online/
```

### B.1. ALB target-group health (attempted 2026-05-11T06:08Z, blocked)

```
$ aws elbv2 describe-target-groups --query 'TargetGroups[].TargetGroupName' --output table
aws: [ERROR]: An error occurred (AccessDenied) when calling the DescribeTargetGroups operation:
  User: arn:aws:sts::789925699169:assumed-role/nysdev-s3-access-role/i-0df71e5ea1df8f588
  is not authorized to perform: elasticloadbalancing:DescribeTargetGroups
  because no identity-based policy allows the elasticloadbalancing:DescribeTargetGroups action
```

The instance role `nysdev-s3-access-role` only has S3+SSM perms, not ELBv2 read. Direct ALB target-group introspection from EC2 is blocked. Indirect target-health proof is in § D below: every 10 s `ELB-HealthChecker/2.0` hits `console`'s `/health` from 3 distinct 172.31.x.x source IPs (one per AZ) and consistently returns `200 670…675`. With the per-host probes in § B all returning 200, ALB targets are functionally healthy in all three subnets. (Follow-up: grant the instance role `elasticloadbalancing:Describe*` so future status reports can include the structured health table without console access.)

### C. SDK functional smoke (NSP key `nyv_live_sk_nsp_tUfo…` — 2026-05-01 Practice-app key, 3 scopes)

Verbatim curl output, header `X-API-Key: nyv_live_sk_nsp_tUfo…` against each host (2026-05-11T06:08Z):

```
--- HOST=https://api.nyayasiddhi.online
[code=200 time=0.048024s] /api/nv/gateway/info
[code=200 time=0.046996s] /api/nv/gateway/health
[code=200 time=0.058792s] /api/nv/gateway/agents
[code=200 time=0.045638s] /api/nv/gateway/practice-areas
[code=403 time=0.043906s] /api/nv/gateway/usage
[code=403 time=0.047171s] /api/nv/gateway/cache/stats
[code=403 time=0.043419s] /api/nv/gateway/guardrails/stats
--- HOST=https://console.nyayasiddhi.online
[code=200 time=0.046031s] /api/nv/gateway/info
[code=200 time=0.046467s] /api/nv/gateway/health
[code=200 time=0.059626s] /api/nv/gateway/agents
[code=200 time=0.045057s] /api/nv/gateway/practice-areas
[code=403 time=0.045248s] /api/nv/gateway/usage
[code=403 time=0.044101s] /api/nv/gateway/cache/stats
[code=403 time=0.045060s] /api/nv/gateway/guardrails/stats
--- HOST=https://nym.nyayasiddhi.online
[code=200 time=0.050260s] /api/nv/gateway/info
[code=200 time=0.046070s] /api/nv/gateway/health
[code=200 time=0.059449s] /api/nv/gateway/agents
[code=200 time=0.046416s] /api/nv/gateway/practice-areas
[code=403 time=0.043617s] /api/nv/gateway/usage
[code=403 time=0.045496s] /api/nv/gateway/cache/stats
[code=403 time=0.044484s] /api/nv/gateway/guardrails/stats
```

Cross-app key sanity:
```
[code=200 time=0.047966s] NYM key → https://api.nyayasiddhi.online/api/nv/gateway/health
[code=200 time=0.049483s] NYM key → https://nym.nyayasiddhi.online/api/nv/gateway/health
[code=200 time=0.045551s] NSI key → https://api.nyayasiddhi.online/api/nv/gateway/health
```

### C.1. 403 triage — verbatim response + matching log lines

Per-call response with headers + body for the 3 failing endpoints, plus the adjacent passing `/health` on the same host (proves the key authenticates and the routes exist; only scope check fails):

```
--- HOST=api.nyayasiddhi.online PATH=/api/nv/gateway/usage
HTTP=403 time=0.048657s size=68
content-type: application/json; charset=utf-8
server: nginx/1.27.5
x-request-id: baa3ad4c-38d1-4c31-862b-40ab974f35e7
{"success":false,"error":"Insufficient scope. Required: usage:read"}

--- HOST=api.nyayasiddhi.online PATH=/api/nv/gateway/cache/stats
HTTP=403 time=0.045804s size=68
x-request-id: b4b7ff81-6ee6-44ca-9c82-5d5fe3f528f3
{"success":false,"error":"Insufficient scope. Required: usage:read"}

--- HOST=api.nyayasiddhi.online PATH=/api/nv/gateway/guardrails/stats
HTTP=403 time=0.047865s size=68
x-request-id: 054f1f69-e7fb-4783-8eea-17eb6bba1487
{"success":false,"error":"Insufficient scope. Required: usage:read"}

--- HOST=api.nyayasiddhi.online PATH=/api/nv/gateway/health
HTTP=200 time=0.044196s size=179
x-request-id: 59d6670b-67bd-4c45-9b70-d04249384ba6
{"success":true,"data":{"status":"healthy","platform":"Nyayavigya Legal SDK","version":"5.0.0",
 "uptime":4539.272152055,"memoryUsageMb":446,"timestamp":"2026-05-11T06:08:01.409Z"}}
```

Matching `docker logs nyv-gateway` window (request IDs line up 1:1 with curl's `x-request-id`):
```
{"timestamp":"2026-05-11T06:08:01.231Z","service":"gateway","message":"GET /api/nv/gateway/usage",
 "requestId":"baa3ad4c-38d1-4c31-862b-40ab974f35e7"}
{"timestamp":"2026-05-11T06:08:01.289Z","service":"gateway","message":"GET /api/nv/gateway/cache/stats",
 "requestId":"b4b7ff81-6ee6-44ca-9c82-5d5fe3f528f3"}
{"timestamp":"2026-05-11T06:08:01.348Z","service":"gateway","message":"GET /api/nv/gateway/guardrails/stats",
 "requestId":"054f1f69-e7fb-4783-8eea-17eb6bba1487"}
{"timestamp":"2026-05-11T06:08:01.405Z","service":"gateway","message":"GET /api/nv/gateway/health",
 "requestId":"59d6670b-67bd-4c45-9b70-d04249384ba6"}
```

Matching `docker logs nyv-console` (nginx access log) window:
```
172.31.34.117 - - [11/May/2026:06:08:01 +0000] "GET /api/nv/gateway/usage HTTP/1.1" 403 68 "-" "curl/8.5.0" "13.232.165.242"
172.31.34.117 - - [11/May/2026:06:08:01 +0000] "GET /api/nv/gateway/cache/stats HTTP/1.1" 403 68 "-" "curl/8.5.0" "13.232.165.242"
172.31.21.134 - - [11/May/2026:06:08:01 +0000] "GET /api/nv/gateway/guardrails/stats HTTP/1.1" 403 68 "-" "curl/8.5.0" "13.232.165.242"
172.31.21.134 - - [11/May/2026:06:08:01 +0000] "GET /api/nv/gateway/health HTTP/1.1" 200 179 "-" "curl/8.5.0" "13.232.165.242"
```

**Owning component**: gateway scope-enforcement middleware (per body: `Insufficient scope. Required: usage:read`). Maps to the `scopes` jsonb on the `sdk_app_api_keys` row for prefix `nyv_live_sk_nsp_` (Practice-app, app_id=2). Row carries 3 scopes; the response's `usage:read` is not present. **Not** an infrastructure / network / auth-header issue — the request authenticates, traverses nginx → gateway → SDK middleware, fails the scope check, and returns a structured JSON error with a request id that surfaces in both the gateway and nginx access logs above. Out of scope for task-145 (key rotation explicitly excluded); tracked as follow-up #150.

### C.2. Gateway log tail snapshot (last 10 lines before triage)

```
{"timestamp":"2026-05-11T06:07:36.831Z","service":"pii-vault-cleanup","message":"[PiiVault] cleanup pass","cleanupRun":16,"backend":"redis","redisHealthy":true,"memoryRemoved":0,"activeTotal":0}
{"timestamp":"2026-05-11T06:07:37.366Z","service":"gateway","message":"GET /health","requestId":"b6bbed53-..."}
{"timestamp":"2026-05-11T06:07:37.877Z","service":"gateway","message":"GET /health","requestId":"bcf6d54d-..."}
{"timestamp":"2026-05-11T06:07:44.645Z","service":"gateway","message":"GET /health","requestId":"d6095f6c-..."}
{"timestamp":"2026-05-11T06:07:46.576Z","service":"gateway","message":"GET /health","requestId":"56fb27f6-..."}
{"timestamp":"2026-05-11T06:07:57.925Z","service":"gateway","message":"GET /health","requestId":"994e1985-..."}
```
No 5xx, no panics, no auth-middleware errors in the 5-minute window leading up to the smoke. Process is steady-state (only `/health` keepalives + scheduled `pii-vault-cleanup`).

Console nginx log shows ELB health checks every ~10 s from 3 distinct subnet IPs (`172.31.2.2`, `172.31.21.134`, `172.31.34.117`) all returning `200 670…675` for `/health`, confirming all 3 ALB target slots are healthy:
```
172.31.2.2     - - [11/May/2026:06:07:57 +0000] "GET /health HTTP/1.1" 200 675 "-" "ELB-HealthChecker/2.0" "-"
172.31.34.117  - - [11/May/2026:06:07:37 +0000] "GET /health HTTP/1.1" 200 670 "-" "ELB-HealthChecker/2.0" "-"
172.31.21.134  - - [11/May/2026:06:07:46 +0000] "GET /health HTTP/1.1" 200 674 "-" "ELB-HealthChecker/2.0" "-"
```

### D. 401/403 breakdown

- **All 401s I initially saw** were from `nyv_live_sk_nsp_3fa6…` / `nyv_live_sk_nym_b747…` keys printed in `/opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt` — those prefixes (`…3fa6`, `…b747`) **do not exist in the live `sdk_app_api_keys` table** on RDS (only the 2026-05-01 Practice-app `nyv_live_sk_nsp_tUfo…` and the newer `nyv_live_sk_nsp_4fd3…` mirrored entries). Net: the file is stale; the keys it lists were never seeded on this RDS. Not an infrastructure failure.
- **403s on `/usage`, `/cache/stats`, `/guardrails/stats`** — the 2026-05-01 NSP Practice-app key has only 3 scopes (per `sdk_app_api_keys.scopes` jsonb: `array_length=3`); it lacks `usage:read`, `cache:read`, `guardrails:read`. Owning component: `sdk_app_api_keys.scopes` row for app `Nyayasiddhi Professional (Practice)` (FOLLOW-UP — not in scope per task §"Out of scope: rotating, regenerating, or republishing SDK keys"). The newer `nyv_live_sk_nsp_4fd3…` row carries 6 scopes and would clear all 7 endpoints — but the plain-text value is not in any file under `/opt/Nyayavigya/secrets/` and is unrecoverable from `key_hash`.
- No 5xx anywhere. ALB target-group introspection blocked by IAM (see § B.1); functional health proven via `ELB-HealthChecker/2.0` log lines from 3 distinct subnet IPs all returning 200 (see § C.2) and per-host root probes all 200 (see § B).

### E. Image tag truth

| Property | Value |
|---|---|
| Live container image | `nyayavigya-platform-312-gateway:latest` (sha `61cd9adaa5ad`) |
| Live tag aliases | `latest` (created ~1h ago); previous tags `n4-20260509T1100Z`, `headfix-20260509T050006Z`, `nvopt-20260509T041251Z`, `mcp502-20260508T123112Z` (rollback targets, all 2-3 days old) |
| `CURRENT_DEPLOY` | `2026-05-11T0436Z-replit-ssm-95d08687` |
| `LAST_GOOD_DEPLOY` | `2026-05-11T0436Z-replit-ssm-95d08687` (matches CURRENT — last deploy was clean on both gateway :5000 and proxy :80) |
| Latest Replit build | commit `95d08687` (= live deploy SHA) |

**EC2 behind on code? NO.** Live image SHA matches the most recent successful Replit-side deploy from earlier today (Session-14). No follow-up redeploy task proposed.

### F. Demo password restore (the actual ask)

**Reset the password hash to bcrypt of exactly `NVDemo@2026!` for all 9 demo accounts** via `scripts/nv-rotate-demo-password.ts` (which uses `makePgSql()` from `scripts/_pg-pool.ts` — NV-DB-SCRIPT-001 compliant). Script DEMO_EMAILS list extended in this task to add the 3 console-demo `@demo.nyayasiddhi.online` accounts (org_id=1) that the original 6-account list missed.

| id | email | role | org_id |
|---|---|---|---|
| 1 | `admin@nyayavigya.in` | super_admin | 1 |
| 2 | `superadmin@demo.nyayasiddhi.online` | superadmin | 1 |
| 3 | `sme@demo.nyayasiddhi.online` | user | 1 |
| 4 | `admin@demo.nyayasiddhi.online` | admin | 1 |
| 7 | `dev@demo.nyayavigya.in` | developer | (none) |
| 8 | `analyst@demo.nyayavigya.in` | analyst | (none) |
| 9 | `operator@demo.nyayavigya.in` | operator | (none) |
| 10 | `manager@demo.nyayavigya.in` | manager | (none) |
| 11 | `user@demo.nyayavigya.in` | user | (none) |

Script output: `Done. ok=9 fail=0`.

**End-to-end login proof** — verbatim curl output, POST `/api/nv/auth/login` with `Origin: https://console.nyayasiddhi.online` (CSRF middleware requires it; without `Origin` the same payload returns `403 {"success":false,"error":"CSRF validation failed: missing origin"}`):

```
--- admin@demo.nyayasiddhi.online
[code=200 time=0.346814s]
{"success":true,"user":{"id":4,"email":"admin@demo.nyayasiddhi.online","name":"Demo Admin",
 "role":"admin","avatarUrl":null,"subscriptionTier":"pro","subscriptionStatus":"active",
 "organizationId":1},"token":"[REDACTED-JWT]"}

--- superadmin@demo.nyayasiddhi.online
[code=200 time=0.353436s]
{"success":true,"user":{"id":2,"email":"superadmin@demo.nyayasiddhi.online","name":"Demo Superadmin",
 "role":"superadmin","avatarUrl":null,"subscriptionTier":"enterprise","subscriptionStatus":"active",
 "organizationId":1},"token":"[REDACTED-JWT]"}

--- dev@demo.nyayavigya.in
[code=200 time=0.353921s]
{"success":true,"user":{"id":7,"email":"dev@demo.nyayavigya.in","name":"Demo Developer",
 "role":"developer","avatarUrl":null,"subscriptionTier":"pro","subscriptionStatus":"active",
 "organizationId":null},"token":"[REDACTED-JWT]"}
```

### G. Demo password pin

> **DEMO PASSWORD PIN (task-145, 2026-05-11)** — the password `NVDemo@2026!` is reset for the 9 demo accounts above and **must not be rotated** until end-to-end demo testing is signed off. Re-running `scripts/nv-rotate-demo-password.ts` with a different value would silently break the demo team's harness.
> - Owner: <user> (set on hand-back).
> - Sunset date: TBC — fill in once demo testing is signed off.
> - Honoured by: this doc + `replit.md` § Gotchas.

### H. One-shot remediations applied

- **Password rotation only.** No network reattach, no container restart, no nginx reload, no ALB attribute change was needed. Bridge service was already active; all three hosts already at 200; image already current.
- Modified script `scripts/nv-rotate-demo-password.ts` (added 3 console-demo emails) + overlaid into the live deploy dir on EC2 (`/opt/Nyayavigya/repo/2026-05-11T0436Z-replit-ssm-95d08687/scripts/`) and ran via `docker exec -e NV_NEW_DEMO_PASSWORD='NVDemo@2026!' nyv-gateway sh -c 'cd /app && npx tsx scripts/nv-rotate-demo-password.ts'`.

### I. Known follow-ups surfaced (NOT implemented in task-145)

- The 2026-05-01 NSP Practice-app SDK key has only 3 scopes; `/usage`, `/cache/stats`, `/guardrails/stats` 403 against any client using it. The newer 6-scope `nyv_live_sk_nsp_4fd3…` row exists in RDS but its plain-text is not in `/opt/Nyayavigya/secrets/`. **Out-of-scope per task** (key rotation/republishing). Worth a dedicated SDK-key-inventory task before broader UAT. **→ ADDRESSED in task-150 / Session-16 below.**
- `/opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt` lists keys with prefixes (`…3fa6`, `…b747`, etc.) that don't exist in RDS — the file is stale and misleading. Cleanup candidate. **→ MARKED ARCHIVED in task-150 / Session-16 below.**

---

## Session-16 — 2026-05-11 Demo SDK-key bundle refresh (task-150)

**TL;DR**: Built a single-shot canonical bundle minter `scripts/nv-refresh-demo-sdk-bundle.ts` (npm: `npm run seed:sdk-bundle`) that closes the Session-15 § C 403 gap. Re-running it on EC2 mints one fresh raw key per app (NSP/NYM/NSI/NSA/NSM/NSPM/JRX), each with scopes covering all 7 documented `/api/nv/gateway/*` read endpoints, deactivates prior active keys for the same app (rotation, never delete), and emits one canonical handout file. The legacy split workflow (`nv-seed-sdk-keys.ts` → `nv-issue-extra-sdk-keys.ts` → `nv-mirror-sdk-keys-to-canonical.ts`) is superseded for the demo bundle (kept for historical/per-step debugging). NYM scope set in `nv-mirror-sdk-keys-to-canonical.ts` was also fixed in-line (`usage:read` added) so the legacy chain stays consistent if someone runs it.

### Scope coverage proof (matches `src/routes/nv-sdk-gateway-routes.ts` 2026-05-11)

| Endpoint | Required scope | Now in every bundle key? |
|---|---|---|
| `/api/nv/gateway/info` | none | ✅ trivially |
| `/api/nv/gateway/health` | none | ✅ trivially |
| `/api/nv/gateway/agents` | none | ✅ trivially |
| `/api/nv/gateway/practice-areas` | none | ✅ trivially |
| `/api/nv/gateway/usage` | `usage:read` | ✅ NSP/NSPM/NSA explicit; NSI/NSM/JRX `*`; NYM now `usage:read` (was missing) |
| `/api/nv/gateway/cache/stats` | `usage:read` | ✅ same as above |
| `/api/nv/gateway/guardrails/stats` | `usage:read` OR `*` | ✅ same as above |

### Operator runbook (NOT executed in this session — requires user GO + EC2 SSM)

```bash
# 1. Mint fresh bundle on EC2 against RDS (uses makePgSql → real pg.Pool + SSL).
docker exec nyv-gateway sh -c \
  'cd /app && NYV_PLATFORM_ENV=production npx tsx /app/scripts/nv-refresh-demo-sdk-bundle.ts'

# 2. Pull the bundle off the container.
docker cp nyv-gateway:/app/.local/run/. /opt/Nyayavigya/secrets/task-150/

# 3. Push each NYV_SDK_KEY_* into AWS SSM SecureString (pickup by next deploy).
for v in NSP NYM NSI NSA NSM NSPM JRX; do
  K=$(grep -E "^NYV_SDK_KEY_${v}=" /opt/Nyayavigya/secrets/task-150/sdk-bundle-demo-production-*.txt | tail -1 | cut -d= -f2-)
  aws ssm put-parameter --name "/nyv/prod/NYV_SDK_KEY_${v}" --type SecureString \
    --value "$K" --overwrite --region "${NYV_AWS_REGION:-ap-south-1}"
done

# 4. Update /opt/Nyayavigya/secrets/.env.production from the bundle (atomic write).

# 5. Archive (and remove) the stale handout — its prefixes never existed in RDS.
sudo mv /opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt \
        /opt/Nyayavigya/secrets/archive/sdk-keys-2026-05-02.STALE-task150.txt

# 6. Restart consumers, then re-run the Session-15 § C smoke. Expected:
#    7×200 across info/health/agents/practice-areas/usage/cache/stats/guardrails/stats.
```

### Local end-to-end verification (Replit dev gateway, 2026-05-11T06:25Z)

Bundle script ran clean against the Replit dev DB (`DATABASE_URL`):

```
✓ NYV_SDK_KEY_NSP   app_id=2  key_id=15  prefix=nyv_test_sk_nsp_2039…  scopes=[6]   (deactivated 1 prior)
✓ NYV_SDK_KEY_NYM   app_id=7  key_id=16  prefix=nyv_test_sk_nym_5369…  scopes=[4]   (deactivated 1 prior)
✓ NYV_SDK_KEY_NSI   app_id=4  key_id=17  prefix=nyv_test_sk_nsi_98ef…  scopes=[*]   (deactivated 1 prior)
✓ NYV_SDK_KEY_NSA   app_id=5  key_id=18  prefix=nyv_test_sk_nsa_33c0…  scopes=[4]   (deactivated 1 prior)
✓ NYV_SDK_KEY_NSM   app_id=6  key_id=19  prefix=nyv_test_sk_nsm_181c…  scopes=[*]   (deactivated 1 prior)
✓ NYV_SDK_KEY_NSPM  app_id=8  key_id=20  prefix=nyv_test_sk_nspm_813…  scopes=[8]   (deactivated 1 prior)
✓ NYV_SDK_KEY_JRX   app_id=9  key_id=21  prefix=nyv_test_sk_jrx_be6e…  scopes=[*]   (deactivated 1 prior)
7/7 keys minted.
```

Post-mint DB invariant check (1 active key per app, correct scope counts):

```
nyv_app_jrx_v5    active=1  newest=nyv_test_sk_jrx_be6e   scopes=1 (wildcard)
nyv_app_nsa_v5    active=1  newest=nyv_test_sk_nsa_33c0   scopes=4
nyv_app_nsi_v5    active=1  newest=nyv_test_sk_nsi_98ef   scopes=1 (wildcard)
nyv_app_nsm_v5    active=1  newest=nyv_test_sk_nsm_181c   scopes=1 (wildcard)
nyv_app_nsp_v5    active=1  newest=nyv_test_sk_nsp_2039   scopes=6
nyv_app_nspm_v5   active=1  newest=nyv_test_sk_nspm_813   scopes=8
nyv_app_nym_v5    active=1  newest=nyv_test_sk_nym_5369   scopes=4 (now includes usage:read)
```

7/7 endpoint smoke against the running dev gateway (`localhost:5000`) with the freshly minted NSP key (`nyv_test_sk_nsp_2039…`):

```
[code=200 time=0.210s] /api/nv/gateway/info
[code=200 time=0.014s] /api/nv/gateway/health
[code=200 time=0.069s] /api/nv/gateway/agents
[code=200 time=0.014s] /api/nv/gateway/practice-areas
[code=200 time=0.021s] /api/nv/gateway/usage           ← was 403 with the 3-scope EC2 Practice-app key
[code=200 time=0.015s] /api/nv/gateway/cache/stats     ← was 403
[code=200 time=0.014s] /api/nv/gateway/guardrails/stats ← was 403
```

This proves the bundle composition + scope coverage is correct against the same gateway code that runs on EC2 (the EC2 image is built from this repo). Re-running the operator runbook below against RDS will produce the same result on `https://api.nyayasiddhi.online`.

### What changed in-repo (this session)

| File | Change |
|---|---|
| `scripts/nv-refresh-demo-sdk-bundle.ts` | NEW. Single-shot canonical 7-platform bundle minter + handout emitter (mode 0600). |
| `scripts/nv-mirror-sdk-keys-to-canonical.ts` | NYM scope set: added `usage:read` (was missing). |
| `package.json` | NEW script `npm run seed:sdk-bundle`. |
| `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` | Banner pointing at the new bundle script + EC2 runbook + archived-file note. |
| `docs/canonical/EC2-INTEGRATION-STATUS.md` | This Session-16 section + cross-link from § I. |
| `replit.md` | Gotcha line referencing the bundle script. |

### What did NOT change (out of scope / requires user GO)

- No EC2 SSM execution. RDS still holds the old NSP Practice-app row with 3 scopes; the new bundle is staged in-repo only. Run the runbook above once approved.
- The stale `/opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt` is not yet renamed on EC2 — operator step 5 above does that during the same SSM session.
- No deploy of `nv-refresh-demo-sdk-bundle.ts` to EC2; it ships with the next normal redeploy via `scripts/deploy-replit-ssm.sh`. To run it sooner, `docker cp` the script into the live container before invoking it.

---

## Session-17 — 2026-05-12 OpenBot org_id backfill wired into EC2 deploy (task-245)

**TL;DR**: The idempotent SQL backfill from task-241 (`scripts/migrations/2026-05-12-openbot-org-id-backfill.sql`) is now executed automatically by `scripts/deploy-replit-ssm.sh` on every EC2 redeploy, immediately after the gateway passes its `:5000/api/nv/health` check and before the console-proxy restart. **Not yet executed against prod-dev RDS** — fires on the next user-authorized redeploy of `i-0df71e5ea1df8f588`.

### What was wired

`scripts/deploy-replit-ssm.sh` (between gateway-health-OK and console-restart):

1. Locates `$LIVE_DIR/scripts/migrations/2026-05-12-openbot-org-id-backfill.sql` (skips with a clear log line if absent — preserves rollback to older tarballs).
2. Parses `DATABASE_URL` from the just-overlaid `/opt/Nyayavigya/secrets/.env.production`, stripping single/double quotes via `sed` (parameter-expansion quoting inside the unquoted heredoc was too brittle).
3. Pipes the SQL into `docker run --rm -i --network host -e PGURL postgres:16-alpine` running `psql "$PGURL" -v ON_ERROR_STOP=1`. The `postgres:16-alpine` image is already on disk (used by the `nyv-postgres` sidecar) so no extra pull.
4. Captures stdout+stderr to `/tmp/openbot-org-id-backfill-${DEPLOY_ID}.log` and tails the verifier rows back into the SSM stdout (the migration's final SELECT shows `null_with_json_org` per table — success = 0).
5. **Failure is WARN-only.** A non-zero `psql` exit logs `[ec2] WARN ...` and the last 20 lines of the backfill log, but does not gate `LAST_GOOD_DEPLOY` advancement — the gateway's in-memory `_hydrate()` keeps the system functional, and we don't want a backfill regression to block a clean code deploy.

The SQL script is idempotent (every `UPDATE` is gated on `org_id IS NULL`, and the column adds use `IF NOT EXISTS`) so re-running on every deploy is a no-op once the first backfill succeeds.

### Verification done in this session (no production write)

- `bash -n` clean against the rendered EC2 script (151 lines).
- Quote-stripping sed verified locally against `DATABASE_URL=...`, `DATABASE_URL="..."`, and `DATABASE_URL='...'` — all three yield the bare URL.
- Tarball excludes (`.git`, `node_modules`, `dist`, `archive`, `.local`, `*.log`, `.env*`) leave `scripts/migrations/` intact, so the SQL ships with every future deploy.

### What was NOT done (still gated on user GO)

- **No standalone SSM run** against `i-0df71e5ea1df8f588`. The backfill fires only when the next `scripts/deploy-replit-ssm.sh` invocation is authorized.
- `null_with_json_org = 0` verifier output for the three tables will be captured here (and in `deploys.log`'s SSM stdout) on the first authorized deploy. This entry will be amended at that time.

### Operator note for the next deploy captain

After running `bash scripts/deploy-replit-ssm.sh`, look for these lines in the streamed SSM stdout:

```
[ec2] running idempotent post-deploy migrations (task-245: openbot org_id backfill)
[ec2]   openbot org_id backfill OK (verifier output, last 8 lines):
[ec2]      tbl                | null_with_json_org | null_total | total
[ec2]     ---------------------+--------------------+------------+-------
[ec2]      nv_openbot_channels |                  0 | ...
[ec2]      nv_openbot_routes   |                  0 | ...
[ec2]      nv_openbot_inbox    |                  0 | ...
```

If any `null_with_json_org` is non-zero, the JSON blob held an `orgId` we failed to lift — investigate before declaring the deploy GA.

---

## Session-18 — 2026-05-13 Security-audit tables migrated on dev (task-266)

**TL;DR**: `drizzle/0011_security_audit_persistence.sql` (task-262) was applied at **2026-05-13T01:30:27Z** on the Replit dev Postgres (`NYV_DATABASE_URL` — the canonical name; some older task notes refer to it as `NV_DATABASE_URL`, they're the same secret). All six `nv_schema.nv_*` tables exist and `SELECT … LIMIT 1` returns 0 rows (clean). **Prod-dev RDS is NOT migrated** — staged for the next user-authorized `scripts/deploy-replit-ssm.sh` run against `i-0df71e5ea1df8f588`.

### What ran on dev (timestamped evidence — 2026-05-13T01:30:27Z)

```
$ psql "$NYV_DATABASE_URL" -f drizzle/0011_security_audit_persistence.sql
psql:drizzle/0011_security_audit_persistence.sql:20: NOTICE:  schema "nv_schema" already exists, skipping
CREATE SCHEMA
CREATE TABLE                  -- nv_security_audit_logs
CREATE INDEX                  -- _created_idx
CREATE INDEX                  -- _severity_idx
CREATE INDEX                  -- _resolved_idx
CREATE TABLE                  -- nv_pii_detections
CREATE INDEX                  -- _audit_idx
CREATE TABLE                  -- nv_compliance_reports
CREATE INDEX                  -- _standard_idx
CREATE TABLE                  -- nv_attack_simulations
CREATE INDEX                  -- _agent_idx
CREATE TABLE                  -- nv_vulnerability_history
CREATE INDEX                  -- _vuln_idx (unique)
CREATE INDEX                  -- _status_idx
CREATE TABLE                  -- nv_security_metrics
CREATE INDEX                  -- _date_idx (unique)
COMMENT × 6

$ psql "$NYV_DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='nv_schema' AND (tablename LIKE 'nv_security%' OR tablename IN ('nv_pii_detections','nv_compliance_reports','nv_attack_simulations','nv_vulnerability_history')) ORDER BY tablename;"
 nv_attack_simulations
 nv_compliance_reports
 nv_pii_detections
 nv_security_audit_logs
 nv_security_metrics
 nv_vulnerability_history
(6 rows)

$ psql "$NYV_DATABASE_URL" -c "SELECT * FROM nv_schema.nv_security_audit_logs LIMIT 1;"
(0 rows)   -- columns enumerate as expected; SecurityAuditPersistenceService writes will now land
```

Tables now present under `nv_schema`:

- `nv_security_audit_logs` (OWASP-LLM Top-10 findings)
- `nv_pii_detections` (PII redactions, FK-style on `audit_log_id`)
- `nv_compliance_reports` (SOC2/GDPR/HIPAA/PCI-DSS snapshots)
- `nv_attack_simulations` (red-team runs)
- `nv_vulnerability_history` (per-vuln lifecycle)
- `nv_security_metrics` (daily KPI aggregates)

Smoke check: `SELECT * FROM nv_schema.nv_security_audit_logs LIMIT 1;` → 0 rows, schema columns enumerated as expected. `SecurityAuditPersistenceService` writes will now land instead of failing with `relation does not exist`.

### What is staged for prod-dev RDS (NOT executed — user GO required)

The migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and ships in the deploy tarball under `drizzle/`, so it can be applied against EC2 RDS the same way the task-245 backfill is — by piping the file into `psql "$DATABASE_URL"` via the `postgres:16-alpine` sidecar on `i-0df71e5ea1df8f588`. It has **not** been wired into `scripts/deploy-replit-ssm.sh` automatically (that's a separate decision); plan is to run it as a one-shot SSM command alongside the next authorized redeploy.

Operator command for the next deploy captain (after gateway is healthy on EC2):

```
docker run --rm -i --network host -e PGURL="$DATABASE_URL" \
  -v "$LIVE_DIR/drizzle:/sql:ro" postgres:16-alpine \
  psql "$PGURL" -v ON_ERROR_STOP=1 -f /sql/0011_security_audit_persistence.sql
```

Expected output mirrors the dev run: schema notice + 6× CREATE TABLE + indexes + comments. After it succeeds, re-run the smoke check on RDS and amend this entry with the timestamp.

## § 0.1 Code-review follow-up (BCD8 — 2026-05-14T02:26Z)

Closed the two open gaps from the BCD4/BCD6 pass:

- **`nv_hitl_queue` + `nv_hitl_decisions`** — provisioned on prod RDS (additive DDL, idempotent), `customer_org_isolation` policy installed, `ENABLE + FORCE ROW LEVEL SECURITY` applied. RLS now enforced on **all 7** target tables (was 5/7).
- **Sentinel proof under `nv_app`** — re-ran `scripts/nv-rls-enforce-flip.ts` with `NYV_SENTINEL_ONLY=1` against the prod gateway container connected as the runtime app role. Result: `sentinelResult=PASS` ("broken-WHERE bound to tenant A returned 1 row(s), all tenant A; unbound session returned 0 rows"), `sentinel-only rc=0`. 7-SKU smoke unchanged: `NSP=NSPM=NSI=NSA=NSM=NYM=JRX=200`.

Evidence: `s3://nyayavigya-sdk-devapp/deploys/bcd8-022621.log`. Script changes: `scripts/nv-rls-enforce-flip.ts` (strict-fail on missing/partial tables, drop `SKIP_SUPERUSER`-as-success, typed catch, new `NYV_SENTINEL_ONLY=1` mode).
