# EC2 Clean Deployment Plan — Nyayavigya Platform 5.0.0

> **Authored:** 2026-05-06 · **Target:** EC2 instance `i-0df71e5ea1df8f588` (`api.nyayasiddhi.online`, ap-south-1) · **Source of truth:** this document supersedes earlier drafts in `docs/v3.1.2/RDS-ELASTICACHE-CUTOVER-RUNBOOK.md` and `docs/v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md`.

This is the **clean-room redeploy** of v5.0.0 to EC2 after:
1. Console UI cleanup (17 legacy NSP/NYM productivity pages removed, 2026-05-06).
2. Billing module DESCOPED.
3. The all-platforms SDK smoke (`scripts/nv-smoke-all-platforms.ts`) passes locally with all 7 SDK keys.

---

## 0. Pre-flight gates (block deploy if any RED)

| Gate | Command | Expected |
|---|---|---|
| G1 | `bash scripts/nv-smoke-bash.sh http://localhost:5000` | exit 0, **101/101 PASS** (currently 93/101 — see §0.1 deploy-blockers below) |
| G2 | `cd nyayavigya-platform-312 && npm run build` (server) | tsc + Vite client build succeed |
| G3 | `cd nyayavigya-platform-312 && npm run typecheck` | zero errors |
| G4 | `bash scripts/nv-smoke-ec2.sh` (public-only against current EC2) | baseline reference for the live target |
| G5 | `psql "$NYV_DATABASE_URL" -c "SELECT version();"` | RDS reachable from build host |
| G6 | All 7 `NYV_SDK_KEY_*` present in EC2 env (Replit Secrets parity) | enumerate secrets in §3 |

If G1 or G2 fails, **do not proceed**. Roll back the offending commit and re-gate.

### 0.1. Current deploy-blockers (must fix before promoting to EC2)

End-to-end smoke against `http://localhost:5000` on **2026-05-06T03:21:54Z** —
audit ledger: `audit/smoke-bash-2026-05-06T032154Z.json`.

**Result:** 93 PASS / 8 FAIL across 101 probes covering all 7 platforms
(NSP, NSPM, NSI, NSM, NSA, NYM, JRX) × 6 endpoint families. The 8 failures
collapse into **2 root causes**:

| # | Severity | Failing tests | Root cause | Fix scope |
|---|---|---|---|---|
| **B1** | **deploy-blocker** | `LLM.{NSI,NSM,NSPM,NSP,JRX}.ent/research` → 500 instead of 200/400, plus the 2 negative tests for NSPM/NSP that should have been 403 also got 500 | `src/routes/nv-sdk-enterprise-routes.ts:166` calls `domainResearchAPIService.searchLegal()` but the imported service from `src/services/enterprise-platform/domain-research-api-service.js` does not export that method. Response body confirms: `{"success":false,"error":"domainResearchAPIService.searchLegal is not a function"}`. Crash happens **before** the scope-gate runs, masking the 403 cases too. | Add `searchLegal()` to `domainResearchAPIService` (delegate to existing `domainResearch.search({ domain: 'legal', … })`) **OR** refactor the route to call the right method. |
| **B2** | **deploy-blocker** | `LLM.NYM.research/query` → 403, `LLM.NYM.translate` → 403, `LLM.NSA.translate` → 403 | The `/api/nv/gateway/*` middleware uniformly requires `documents:read` scope for POSTs, but per the canonical doc `gateway/translate` should require **no** scope and `gateway/research/query` should require **`research:read`**. Response body: `{"success":false,"error":"Insufficient scope. Required: documents:read"}`. NYM and NSA carry neither scope by design. | In `src/middleware/nv-sdk-gateway.ts` (or wherever scope rules are declared per-route), either (a) drop the scope requirement on `/translate` + `/translate/batch`, or (b) add `translate:read` (preferred — keeps audit logging) and grant it to all 7 keys. For `/research/query`, change required scope from `documents:read` → `research:read`. |

**Both must be fixed and the smoke re-run to 101/101 GREEN before §4 deploy.**

Re-run command after fixes:
```bash
bash nyayavigya-platform-312/scripts/nv-smoke-bash.sh http://localhost:5000
# expect: "Result: 101 PASS / 0 FAIL  (total 101)"
```

### 0.2. Other observations (non-blocking)

- `sdk-usage-metering-service` logs `Aggregation flush error` repeatedly during
  the smoke run with no detail. Likely a Redis pipeline issue under burst.
  Track for v3.2 — does not affect request correctness, only async metering.
- All 7 LLM-backed `gateway/research/query` calls succeed in **13–22s** via
  the free `nvidia/nemotron-3-nano-30b-a3b` model on OpenRouter. Set
  `NYV_LLM_TIMEOUT_MS=30000` on EC2 to avoid premature 504s under load.
- Audit ledger schema (per probe row): `{name, method, url, expected, actual, status, ms}`. Aggregate to `s3://nyayavigya-audit/smoke/` per §7.

---

## 1. Pre-deploy hardening checklist (one-time)

These are the items the previous live audit (`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`) flagged. All have been fixed in code; this checklist verifies they are deployed.

- [x] **F6** — `publicRateLimit` skipped when `X-API-Key` present (`src/middleware/nv-rate-limit-middleware.ts:254`)
- [x] **F7/F10** — drizzle `eq(undefined, …)` removed from `sdk-document-pipeline-service.ts`
- [x] **F8** — `multimodal/capabilities` no longer scope-gated
- [x] **F9** — `provision/validate` queries canonical `sdk_app_api_keys` + `sdk_applications`
- [x] **F11** — `is_active::int = 1` cast workaround for `@neondatabase/serverless` boolean coercion (see `replit.md` "Drizzle ORM & Postgres Booleans" gotcha)
- [x] **F12** — `getAppUsageAnalytics` uses real `tokensIn + tokensOut` columns
- [x] **F13** — `/api/nv/voice/transcribe` requires `X-API-Key` OR JWT (was unauthenticated)
- [x] **Console scope** — law-firm productivity pages removed from `client/`; SDK consumers (NSP/NYM/NSI) hold those surfaces (2026-05-06)
- [x] **Federated-privacy ε-budget** — SERIALIZABLE UPDATE-RETURNING enforced (`replit.md` gotcha)
- [x] **Bot service hydration** — `_hydrate()` lazy-trigger on first read for ClaWdBot/OpenBot/AutomateAI/TwinDesk

---

## 2. Build artifacts

```bash
# From repo root
cd nyayavigya-platform-312

# Server (TypeScript → dist/server.js)
npm ci --include=dev
npm run build:server     # produces dist/

# Client (Vite → dist/public/)
npm run build:client     # produces dist/public/

# Verify
ls -lah dist/server.js dist/public/index.html

# Docker image (pinned digest, not :latest)
docker build -f Dockerfile -t nyayavigya/gateway:5.0.0-$(git rev-parse --short HEAD) .
docker build -f Dockerfile.console -t nyayavigya/console:5.0.0-$(git rev-parse --short HEAD) .
```

Tag and push to ECR (`<account>.dkr.ecr.ap-south-1.amazonaws.com/nyayavigya/gateway`).

---

## 3. EC2 environment parity — secrets

The Replit dev env carries these secrets; the EC2 instance must mirror them via AWS SSM Parameter Store (path `/nyv/prod/`). **NEVER bake secrets into the Docker image or `docker-compose.yml`.**

| Secret | Source | EC2 destination |
|---|---|---|
| `NYV_DATABASE_URL` | RDS (PostgreSQL 16.6) | `/nyv/prod/database_url` (SecureString) |
| `NYV_REDIS_URL` / `NYV_REDIS_TCP_URL` | ElastiCache (Redis 7.1) | `/nyv/prod/redis_url` |
| `NYV_JWT_SECRET`, `NYV_JWT_REFRESH_SECRET` | rotated quarterly | `/nyv/prod/jwt_secret`, `/nyv/prod/jwt_refresh_secret` |
| `ENCRYPTION_KEY` | KMS-derived | `/nyv/prod/encryption_key` |
| `NYV_SDK_KEY_NSP`, `_NSPM`, `_NSI`, `_NSM`, `_NSA`, `_NYM`, `_JRX` | `nv-mint-sdk-bundle.ts` output | `/nyv/prod/sdk_key_<platform>` |
| `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `SARVAM_API_KEY` | provider portals | `/nyv/prod/llm_<provider>_key` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM role on EC2 (preferred) | use **instance role**, not static keys |

The container reads these via `aws ssm get-parameters-by-path --recursive --with-decryption` at startup (already implemented in `scripts/nv-load-ssm-env.sh`).

---

## 4. Deploy sequence

### 4.1. Database migrations (idempotent)
```bash
ssh ec2-user@api.nyayasiddhi.online \
  'cd /opt/Nyayavigya && bash scripts/nv-run-migrations.sh'
```
This runs the `CREATE TABLE IF NOT EXISTS` migrations under `scripts/migrations/` (already idempotent per the `drizzle-kit push needs TTY` gotcha in `replit.md`).

### 4.2. SSM rolling restart (zero downtime via gateway pair)
```bash
# From your operator workstation
INSTANCE_ID=i-0df71e5ea1df8f588
GATEWAY_TAG=5.0.0-$(git rev-parse --short HEAD)
b64=$(base64 -w0 <<EOF
set -euo pipefail
cd /opt/Nyayavigya
aws ecr get-login-password --region ap-south-1 | docker login --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com
docker pull <account>.dkr.ecr.ap-south-1.amazonaws.com/nyayavigya/gateway:${GATEWAY_TAG}
docker pull <account>.dkr.ecr.ap-south-1.amazonaws.com/nyayavigya/console:${GATEWAY_TAG}
docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway console
sleep 8
curl -fsS http://localhost:5000/health | jq .status
EOF
)
aws ssm send-command --region ap-south-1 \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $b64 | base64 -d | bash\"]"
```
> **Gotcha:** SSM uses `/bin/sh`; explicit `bash` invocation required (see `replit.md`).

### 4.3. Post-deploy smoke (against live EC2)
```bash
# From operator workstation (Replit dev container is fine — it has the secrets)
tsx nyayavigya-platform-312/scripts/nv-smoke-all-platforms.ts https://api.nyayasiddhi.online
bash nyayavigya-platform-312/scripts/nv-smoke-ec2.sh full https://api.nyayasiddhi.online
```
Both must exit 0. Audit ledgers land in `audit/smoke-all-platforms-*.json` and `audit/smoke-*.json`.

### 4.4. RAG audit + ε-budget sanity (post-cutover)
```bash
curl -fsS https://api.nyayasiddhi.online/api/nv/admin/rag/audit/coverage \
  -H "Authorization: Bearer $ADMIN_JWT" | jq '.coverage_pct >= 0.95'

curl -fsS https://api.nyayasiddhi.online/api/nv/admin/federated-privacy/budget \
  -H "Authorization: Bearer $ADMIN_JWT" | jq '.epsilon_remaining > 0'
```

---

## 5. Rollback plan

| Symptom | Action |
|---|---|
| `/health` 5xx for >60s after deploy | Re-run §4.2 with previous `GATEWAY_TAG` (kept in `audit/last-known-good-tag`) |
| Specific platform smoke RED but others GREEN | Investigate per-key scope in `sdk_app_api_keys`; do NOT redeploy — patch the row via `nv-mirror-sdk-keys-to-canonical.ts` |
| `audit_chain` tampering detected after deploy | Per `replit.md` Audit Chain gotcha: temp `NYV_AUDIT_CHAIN_TOLERATE=1`, repair `record_hash` via psql, revert |
| ε-budget overflow on federated-privacy | SERIALIZABLE retry path is already in `nv-federated-privacy-service.ts`; if symptom persists, inspect for non-SERIALIZABLE callers per the gotcha |

---

## 6. Acceptance criteria (sign-off)

- [ ] G1–G6 pre-flight all green
- [ ] §4.3 smoke exits 0 against `https://api.nyayasiddhi.online`
- [ ] All 7 platforms (NSP, NSPM, NSI, NSM, NSA, NYM, JRX) report ≥1 successful 200 in audit ledger
- [ ] Scope-gate negatives (NSA/NYM → 403 on docs-pipeline) verified in audit ledger
- [ ] `/api/nv/health/full` reports `services.database.status="healthy"`, `services.redis.status="healthy"`, `platform.agents=148`
- [ ] Console UI loads at `https://console.nyayasiddhi.online` with the cleaned 5-section sidebar (no legacy NSP/NYM productivity items)
- [ ] `audit/last-known-good-tag` updated with the new tag

---

## 7. Post-deploy (within 24h)

- Update `projecttracker.md` §8 with the deploy timestamp + `GATEWAY_TAG`.
- Tag the commit: `git tag -a v5.0.0-ec2-$(date +%Y%m%d) -m "EC2 clean deploy"`.
- Archive the audit ledgers from §4.3 to `s3://nyayavigya-audit/smoke/$(date +%Y/%m)/`.
- Rotate `NYV_SDK_KEY_*` if any key has been live > 90 days (use `scripts/nv-issue-extra-sdk-keys.ts`).
