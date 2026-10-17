# Platform Ops SOP — NYV + NYS (2026-09)

> **Audience:** Cursor agents, platform ops, partner integration engineers.  
> **Scope:** Dev-edge production (`*.nyayasiddhi.online`) — **not** greenfield `*.nyayasiddhi.com` (requires explicit **GO**).  
> **Secrets rule (NV-SECRETS-001):** Never echo secret **values** in chat, logs, or commits. Paths and key **names** only; probe with key **length** and HTTP codes.

---

## 0. Topology (locked)

| Product | Code root | EC2 | Instance ID | Primary URL |
|---|---|---|---|---|
| **NYV** — gateway, Console, partner SDKs | `nyayavigya-platform-312/` | **nysdev** | `i-0df71e5ea1df8f588` (`13.232.165.242`) | `https://api.nyayasiddhi.online` · `https://console.nyayasiddhi.online` |
| **NYS** — caselaw API, dashboard | `NYS-Agentic-AI/` | **nyv-caselaw-worker** | `i-000115b19219bb766` (`13.233.102.83`) | `https://nyayasearch.nyayasiddhi.online` |

Classify every change **NYV / NYS / BOTH** before editing. Full dual-project contract: [`DUAL-PROJECT-OPS-NYV-NYS-2026-07.md`](./DUAL-PROJECT-OPS-NYV-NYS-2026-07.md).

---

## 1. NYV (nysdev) — deploy

### 1.1 Pre-deploy (mandatory)

```bash
cd nyayavigya-platform-312
npm run session:preflight          # read guardrails + headline numbers
npm run guardrail                  # before declaring any code change done
```

Load AWS deploy creds (SSM + S3 only — **not** SDK keys):

```bash
cd nyayavigya-platform-312
source scripts/nv-source-dev-deploy-env.sh   # reads product Documents/env.production
```

### 1.2 Canonical deploy command

```bash
cd nyayavigya-platform-312
source scripts/nv-source-dev-deploy-env.sh
bash scripts/deploy-aws-ssm.sh --note "reason for deploy"
```

**What it does:** tarball → S3 → SSM on nysdev → `docker compose build gateway` → `docker compose up -d --force-recreate gateway` → health poll → updates `CURRENT_DEPLOY` + `LAST_GOOD_DEPLOY` on EC2.

**Deploy ID format:** `YYYY-MM-DDTHHMMZ-aws-ssm-<git-short-sha>` (e.g. `2026-09-08T1629Z-aws-ssm-b2433b41`).

**Audit trail on EC2:**
- `/opt/Nyayavigya/CURRENT_DEPLOY` — live release pointer
- `/opt/Nyayavigya/LAST_GOOD_DEPLOY` — rollback target (only advances on successful gateway recreate)
- `/opt/Nyayavigya/deploys.log` — append-only history
- Live tree: `/opt/Nyayavigya/repo/<deploy-id>/`

**Local audit:** `.local/deploys.log` (workstation mirror after deploy).

### 1.3 Rollback

Previous gateway/console images are tagged `:rollback-YYYYMMDD` and kept **7 days**. Roll forward preferred; rollback requires explicit user **GO** naming the target deploy ID.

To roll back: redeploy from a known-good git SHA using `deploy-aws-ssm.sh`, or on EC2 point `CURRENT_DEPLOY` at the prior `/opt/Nyayavigya/repo/<id>/` tree and recreate containers (see LAST_GOOD_DEPLOY).

### 1.4 When explicit **GO** is required (NYV)

- Any production deploy to nysdev (standard SOP — user must say **GO** with reason)
- Edit `/opt/Nyayavigya/secrets/.env.production` on EC2
- Rotate `NYV_SDK_KEY_*`, JWT secrets, LLM provider keys, or DB URLs
- `docker volume prune` or delete `/opt/Nyayavigya/secrets/` (run `npm run protect:secrets:ec2` before any manual prune)
- Fetch SDK keys from SSM Parameter Store during demo session (NV-DEMO-SESSION-001)

---

## 2. NYV — configuration & secrets (paths only)

### 2.0 Deploy creds vs runtime secrets — never confuse these

| Purpose | Path / source | Contains | Used for |
|---|---|---|---|
| **Workstation deploy creds** | `product Documents/env.production` → `source scripts/nv-source-dev-deploy-env.sh` | `AWS_ACCESS_KEY_ID`, `NYV_EC2_INSTANCE_ID`, S3 deploy bucket, SSM send-command | `deploy-aws-ssm.sh`, probe scripts, `npm run demo:probe:ec2` |
| **EC2 runtime secrets** | `/opt/Nyayavigya/secrets/.env.production` | All `NYV_SDK_KEY_*`, LLM provider keys, `NYV_DATABASE_URL`, `NYV_REDIS_TCP_URL` | Gateway/console containers at boot |
| **EC2 restore snapshot** | `/opt/Nyayavigya/secrets/LAST_GOOD.env` | Same keys as `.env.production` — zero-risk restore | Roll back env without rotation |

**Rule:** Workstation deploy creds are **SSM/S3 only** — they are **not** SDK keys and must never be written into EC2 runtime secrets. Conversely, EC2 runtime secrets are **never** fetched from SSM Parameter Store during demo session (NV-DEMO-SESSION-001).

**SSM instance:** `NYV_EC2_INSTANCE_ID` = `i-0df71e5ea1df8f588` (nysdev, `13.232.165.242`).

**Deploy audit paths on EC2:**

| Path | Purpose |
|---|---|
| `/opt/Nyayavigya/CURRENT_DEPLOY` | Live release pointer (deploy ID string) |
| `/opt/Nyayavigya/LAST_GOOD_DEPLOY` | Rollback target — advances only on successful gateway recreate |
| `/opt/Nyayavigya/deploys.log` | Append-only deploy history |
| `/opt/Nyayavigya/repo/<deploy-id>/` | Live code tree per release |

### 2.1 Layer table

| Layer | Path | Notes |
|---|---|---|
| **Production runtime (canonical)** | `/opt/Nyayavigya/secrets/.env.production` on nysdev | All `NYV_SDK_KEY_*`, LLM keys, `NYV_DATABASE_URL`, `NYV_REDIS_TCP_URL` |
| **Restore snapshot** | `/opt/Nyayavigya/secrets/LAST_GOOD.env` | Zero-risk restore — same keys, no rotation |
| **SDK auth primary (runtime)** | Postgres `sdk_applications` + `sdk_app_api_keys` | Hashed keys; env synced on gateway boot (`nv-env-sdk-key-sync.ts`) |
| **Local mirror (optional)** | `.local/secrets/runtime.env` | Pull once: `bash nyayavigya-platform-312/scripts/nv-pull-ec2-sdk-keys.sh` |
| **Deploy AWS creds (SSM only)** | `product Documents/env.production` | `AWS_ACCESS_KEY_ID`, `NYV_EC2_INSTANCE_ID`, etc. — not SDK keys |
| **Key names doc (no values)** | `documents/working/NSP-API-KEYS-HANDOVER.md` | Handover stamps only |

**Partner SDK key env names (values on EC2 only):**
- `NYV_SDK_KEY_NSP` — Nyaya Siddhi Platform (Professional)
- `NYV_SDK_KEY_NSPM` — NSP Mobile
- `NYV_SDK_KEY_NSI` — Nyaya Siddhi Intelligence
- `NYV_SDK_KEY_NSA` — Nyaya Siddhi Academy
- `NYV_SDK_KEY_NSM` — Nyaya Siddhi Marketplace
- `NYV_SDK_KEY_NYM` — Nyaya Mitra
- `NYV_SDK_KEY_JRX` — JurisX

**NYS federation (gateway → caselaw worker):**
- `NYV_F_NYS_KNOWLEDGE_PLANE=1`
- `NYS_KNOWLEDGE_BASE_URL=https://nyayasearch.nyayasiddhi.online/api`
- `NYS_KNOWLEDGE_API_KEY` — must match `NYS_SDK_API_KEYS` on worker

Demo session frozen keys: [`DEMO-SESSION-CREDENTIALS-2026-08.md`](./DEMO-SESSION-CREDENTIALS-2026-08.md).

---

## 3. NYV — logs, restart, monitor

### 3.1 Logs (on nysdev via SSM or SSH)

```bash
docker logs nyv-gateway --tail 200 -f
docker logs nyv-console --tail 200 -f
docker logs nyv-redis --tail 50
docker logs nyv-postgres --tail 50   # detached rollback safety net; request path uses RDS
```

Gateway JSON logs include `service`, `level`, `message`, `timestamp`. Grep errors: `docker logs nyv-gateway 2>&1 | grep '"level":"error"'`.

### 3.2 Restart (on nysdev, from live deploy dir)

```bash
cd /opt/Nyayavigya/repo/$(cat /opt/Nyayavigya/CURRENT_DEPLOY)
docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway
docker compose -f docker-compose.aws-dev.yml up -d --force-recreate console
# Full stack (avoid unless necessary — preserves external nyv-net):
COMPOSE_PROJECT_NAME=nyayavigya-platform-312 \
  docker compose -f docker-compose.aws-dev.yml up -d
```

**Network rule:** Always set `COMPOSE_PROJECT_NAME=nyayavigya-platform-312` when recreating from a release dir (see `docker-compose.aws-dev.yml` NV-DEPLOY-NET-PROJECT-001 comment).

### 3.3 Health & smoke (from workstation)

| Check | Command / URL | Expected |
|---|---|---|
| Public health | `curl -sS -o /dev/null -w '%{http_code}' https://api.nyayasiddhi.online/api/nv/health` | **200** |
| Gateway health (SDK-gated) | `https://api.nyayasiddhi.online/gateway/health` with `X-API-Key` | **200** with key; **401** without |
| Console health | `https://console.nyayasiddhi.online/health` | **200** |
| Full EC2 crosscheck | `cd nyayavigya-platform-312 && npm run demo:probe:ec2` | Keys stay on EC2; SSM probe |
| Partner matrix | `npm run partner:smoke:ec2` | **0 failures** across NSP/NSPM/NSI/NSA/NSM/NYM/JRX |
| Memory recall | `bash scripts/nv-partner-memory-probe-ec2.sh` | `recall_hit=True`, `memoriesUsed>=1` |
| Session preflight | `npm run session:preflight` | Read guardrails before any verdict |

---

## 4. NYS (caselaw worker) — deploy

### 4.1 Build + deploy

From `NYS-Agentic-AI/` (nested git — commit inside that tree separately):

```bash
cd NYS-Agentic-AI
node build.mjs                                    # or project-equivalent build
cd scripts && node upload-deploy.mjs --deploy       # API bundle + restart nyv-api
# Frontend only:
node upload-deploy.mjs --frontend --deploy --no-api
# Scripts only (ingest, embed, audit):
node upload-deploy.mjs --scripts --deploy --no-api
```

**Service:** `nyv-api.service` → `node /opt/nyv/api/index.mjs` on port **8080**.  
**ALB rule:** `nyayasearch.nyayasiddhi.online` → TG `nyv-search-tg` → `:8080`.

### 4.2 NYS configuration (paths only)

| Item | Path on worker |
|---|---|
| Runtime env | `/opt/nyv/api/.env` |
| API bundle | `/opt/nyv/api/index.mjs` (content-addressed via S3 manifest) |
| Static frontend | `/opt/nyv/api/public/` |
| Embed log | `/opt/nyv/embed.log` |
| Ingest log | `/opt/nyv/ingest-dc.log` |
| Coverage report | `/opt/nyv/coverage-report.json` |

**Key env names:** `NYS_SDK_API_KEYS`, `DATABASE_URL` (use `systemd-run --property=EnvironmentFile=` — never bash-source `.env` directly; `$` in URLs breaks shells).

### 4.3 NYS logs & restart

```bash
sudo journalctl -u nyv-api -f --since "1 hour ago"
tail -f /opt/nyv/embed.log
tail -f /opt/nyv/ingest-dc.log

sudo systemctl restart nyv-api
sudo systemctl status nyv-api
curl -sS -o /dev/null -w '%{http_code}' https://nyayasearch.nyayasiddhi.online/api/health
```

Long-running corpus jobs (always via systemd-run + EnvironmentFile):

```bash
sudo systemd-run --unit=nyv-embed --property=EnvironmentFile=/opt/nyv/api/.env \
  --working-directory=/opt/nyv/api \
  /usr/bin/node /opt/nyv/api/embed-corpus.mjs 2000000 100 sc
```

### 4.4 When explicit **GO** is required (NYS)

- Production deploy to nyv-caselaw-worker
- Edit `/opt/nyv/api/.env` on worker
- Full-corpus ingest / embed runs affecting RDS load
- Rotate `NYS_SDK_API_KEYS`

---

## 5. Common ops patterns

### 5.1 SSM run scripts (no SSH)

| Script | Target | Usage |
|---|---|---|
| `scripts/_nys-ssm-run.sh` | NYS worker | `bash scripts/_nys-ssm-run.sh /path/to/probe.sh "label"` |
| `scripts/nv-ec2-ssm-run.sh` | NYV nysdev | Same pattern for gateway host |
| `scripts/nv-demo-probe-ec2.sh` | NYV nysdev | `npm run demo:probe:ec2` |
| `scripts/nv-partner-memory-probe-ec2.sh` | NYV nysdev | Memory userId recall probe |
| `scripts/nv-pull-ec2-sdk-keys.sh` | NYV nysdev | One-time local mirror to `.local/secrets/` |

Requires: `source scripts/nv-source-dev-deploy-env.sh` first.

### 5.2 Guardrails (CI-enforced)

```bash
cd nyayavigya-platform-312
npm run guardrail              # full suite
npm run guardrail:no-new-orphans
npm run guardrail:intent-mesh
npm run eval:quality-trend
```

**NV-EXECUTE-BEFORE-CLAIM-001:** Never report a defect from grep alone — run a probe, test, or live request first.

### 5.3 RDS (shared)

| Item | Value |
|---|---|
| Instance | `nyv-dev-edge-pg` (PostgreSQL 16.6, ap-south-1) |
| Connection | Via `NYV_DATABASE_URL` on gateway env — **never log the URI** |
| RLS | `nv_matter_memory` has **FORCE RLS** on `org_id`; writes require `withTenantTx` + `SET LOCAL app.current_org_id` (NV-MEM-INSERT-FIX-001) |
| Pilot RLS (5 tables) | `drizzle/0016_rls_pilot_five_tables.sql` — clawdbot/openbot/console_layout tables |

Schema changes: `npm run db:push --force` after eyeballing diff; log in Project-Tracker.

### 5.4 Partner integration quick reference

- Integration doc: [`Nyayavigya-platform-Integration-document-5.0.0.md`](./Nyayavigya-platform-Integration-document-5.0.0.md)
- NSP handoff: [`NSP-API-HANDOFF-2026-08-12.md`](./NSP-API-HANDOFF-2026-08-12.md)
- Fast paths: `legal-chat-fast`, `legal-draft-fast`, `doc-draft-fast`
- Memory headers: `X-NYV-User-Id`, `X-Customer-Session-Id`, body `userId`, `enableMemory:true`
- Draft params: `parameters.documentType`, `options.draftLength` (low/medium/comprehensive)

### 5.5 Status & UAT docs

- Live snapshot: [`PLATFORM-STATUS.md`](./PLATFORM-STATUS.md)
- UAT v2: [`UAT-TEST-PLAN-v2-2026-09.md`](./UAT-TEST-PLAN-v2-2026-09.md)
- Deploy verification: [`DEPLOYMENT-VERIFICATION.md`](./DEPLOYMENT-VERIFICATION.md)

---

## 6. Disk space & env preservation

### 6.1 Disk thresholds (nysdev)

| Level | Root `/` use % | Action |
|---|---|---|
| **GREEN** | < 80% | Normal ops |
| **YELLOW** | 80–90% | Archive old `/opt/Nyayavigya/repo/<deploy-id>/` trees (>7 days, not CURRENT/LAST_GOOD); `docker image prune` (dangling only) |
| **RED** | > 90% | **Stop deploys.** Run `npm run protect:secrets:ec2` first, then targeted prune. Health may return **503** (`storage: degraded`) before orchestrate fails. |
| **Prior incident** | 95.6% (2026-09-12) | Recovered to 77% via docker prune + repo archive; **not** current state |

**Audit command (SSM, no secret values):**

```bash
cd nyayavigya-platform-312
bash scripts/nv-ec2-ssm-run.sh scripts/_ec2-disk-env-audit.sh "NV-DISK-ENV-AUDIT-001"
```

Reports: `df -h`, `docker system df`, `CURRENT_DEPLOY`, `LAST_GOOD_DEPLOY`, secrets file count, `NYV_` key count, byte sizes.

**Live probe 2026-09-12:** root **38%** used (36G/96G); docker images 7.7GB (4 active); secrets 2 files present, **114** `NYV_` keys, **25,206** bytes each (`.env.production` = `LAST_GOOD.env`).

### 6.2 Env preservation checklist (pre-prune / pre-deploy)

- [ ] Run `npm run protect:secrets:ec2` before **any** manual `docker volume prune` or aggressive `docker system prune`
- [ ] Verify secrets lens: `grep -c '^NYV_' /opt/Nyayavigya/secrets/.env.production` → expect **>100** (count only)
- [ ] Verify `LAST_GOOD.env` byte size matches `.env.production` (restore snapshot intact)
- [ ] **Never** edit `/opt/Nyayavigya/secrets/.env.production` without explicit user **GO** naming the change
- [ ] **Never** rotate `NYV_SDK_KEY_*` during demo session (NV-DEMO-SESSION-001)
- [ ] Deploy creds stay on workstation (`product Documents/env.production`); runtime secrets stay on EC2
- [ ] After deploy: confirm `CURRENT_DEPLOY` = `LAST_GOOD_DEPLOY` on successful health poll

---

## 7. Incident checklist

1. **Health failing:** `npm run demo:probe:ec2` — check gateway/console container status, `CURRENT_DEPLOY`, last 4h gateway errors; **check disk % first** (503 often = storage degraded).
2. **Partner 401/403:** Key length lens on EC2 (`grep -E '^NYV_SDK_KEY_NSP=' ... | wc -c`); verify Postgres `sdk_applications` sync on gateway boot.
3. **Memory recall miss:** `bash scripts/nv-partner-memory-probe-ec2.sh` — expect `recall_hit=True`; check NV-MEM-CACHE-BYPASS-001 (LM cache skipped when `enableMemory`).
4. **Caselaw empty:** Probe via gateway `/api/nv/knowledge/search` (authenticated), not direct nyayasearch without key. FTS path should return `total=1000` capped for "Section 420 IPC".
5. **502 console → gateway:** Check `COMPOSE_PROJECT_NAME` / `nyv-net` split (NV-DEPLOY-NET-PROJECT-001).
6. **413 payload too large:** nginx `client_max_body_size` — stream/orchestrate with large inline documents.

---

## 8. Change log discipline

Every non-trivial change:
1. Append row to `Project-Tracker.md` (UTC timestamp, status, evidence).
2. Entry under `CHANGELOG.md` `[Unreleased]`.
3. SDK surface → bump package version + package CHANGELOG.
4. Update `PLATFORM-STATUS.md` if live posture changed materially.

Commit message must cite tracker timestamp.

---

*Last probe stamp: 2026-09-12T09:40Z — deploy `2026-09-12T0845Z-aws-ssm-94bececc`, disk 38%, partner smoke 0 failures, roadmap probe 3/3 PASS.*
