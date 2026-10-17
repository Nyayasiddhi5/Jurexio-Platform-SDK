
---

## NV-PLATFORM-UAT-BYPASS-001 — production-safe targeted UAT bypass (2026-05-14)

**Symptom that triggered this guardrail**: User asked to disable rate limits + scope checks across the entire Nyayasiddhi ecosystem so end-to-end UAT could run cleanly on prod. The pre-existing `NV_E2E_BYPASS=1` flag is dev-only (gated `NODE_ENV !== 'production'`) and disables ALL limits for ALL keys, which is unacceptable in prod.

**Solution**: Added `NV_PLATFORM_UAT_BYPASS=1` flag (NOT gated on NODE_ENV). At gateway boot, `src/middleware/nv-platform-uat-bypass.ts` sha256-fingerprints the 7 `NYV_SDK_KEY_*` env values into an in-memory set. Per request, `isPlatformUatRequest(req)` matches the inbound key fingerprint against this set. Three patch points:

1. `src/middleware/nv-sdk-gateway.ts:557` — short-circuits the application + per-key rate-limit check.
2. `src/middleware/nv-sdk-gateway.ts:675` — pushes `'*'` into `req.sdkContext.scopes` so all 76 `checkScope()` call sites pass without per-site edits.
3. `src/middleware/nv-rate-limit-middleware.ts` + `nv-per-platform-rate-limiter.ts` — bypass in the `skip` callback / middleware head.

**Still enforced**: API-key validation, request audit log writes, RLS / `customer_org_isolation` policy, PII redaction, guardrail input/output filters, daily token budgets, fail-closed missing-org-binding (NV-UAT-DEFAULT-ORG-001).

**Audit trail**: every bypass-eligible response carries `X-Platform-UAT-Bypass: 1` and `X-Platform-UAT-Label: <NSP|NSPM|…>` headers.

**Rollback**: `unset NV_PLATFORM_UAT_BYPASS` and restart the gateway. The fingerprint set drains.

**MUST be unset before public launch.** This is a UAT scaffold, not a production posture.

---

## NV-DEPLOY-COMPOSE-RECREATE-001 — never `--force-recreate` for the gateway (2026-05-14)

**Symptom**: `docker compose -f docker-compose.aws-dev.yml up -d --force-recreate --no-deps gateway` aborts with `Container nyv-gateway is already in use by container <hash>`. Hit by task #365 BCD5 and again by task #390 deploy this session.

**Root cause**: Each deploy creates a new compose project (project name = `${DEPLOY_ID}` derived from the timestamped tarball dir), so compose sees the existing `nyv-gateway` as belonging to a "different" project and refuses to recreate it. `--force-recreate` does not solve this because the conflict is at the docker-engine level (container name uniqueness), not at the compose level.

**Fix (canonical, wired into `scripts/deploy-replit-ssm.sh:182-186`)**:
```bash
docker stop nyv-gateway 2>/dev/null || true
docker rm   nyv-gateway 2>/dev/null || true
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
```

**Detection**: SSM `StandardErrorContent` will show `Container nyv-gateway Error response from daemon: Conflict.`. The image build itself succeeds — only the swap aborts.

---

## NV-DEPLOY-CONSOLE-RELOAD-001 — always restart console post-swap (2026-05-14)

**Symptom**: Gateway `:5000/api/nv/health` returns 200 but `https://api.nyayasiddhi.online/api/nv/health` returns 502 from `nginx/1.27.5` for 1–3 minutes after the gateway container is recreated.

**Root cause**: Console nginx caches the upstream `nyv-gateway` docker DNS resolution at worker start. When the gateway container is recreated it gets a new docker network IP (e.g. `192.168.96.2` this session), but nginx workers still hold the old IP. The `nyv-gateway-bridge.service` (#380) only re-attaches the bridge on boot, not on container recreate.

**Fix**:
```bash
docker compose -f docker-compose.aws-dev.yml restart console
# then poll :80/api/nv/health for at least 30s
```

`scripts/deploy-replit-ssm.sh:247-248` already does this restart. The remaining gap (still hit this session) was that the post-restart poll sometimes declares success on the first 200 from `:5000` without re-verifying `:80`. Future deploys should poll BOTH and not exit until the proxy returns 200 too.

---

## NV-MIGRATE-SSM-ATOMIC-001 — one migration per SSM command (2026-05-14)

**Symptom**: Combined SSM script intended to apply `0016_billing_tiers.sql` AND `0017_super_orgs.sql` truncated silently after step 1 — `0017` never ran. Discovered post-deploy when `nv_super_orgs` table was missing.

**Root cause**: SSM `commands` parameter encoding edge case with nested heredocs + `$$ … $$` PL/pgSQL DO blocks. The base64 round-trip handles outer quoting, but a heredoc inside the script that contains another heredoc (psql `<<SQL`) can lose its terminating delimiter.

**Fix**: Send each migration as a SEPARATE `aws ssm send-command` invocation. Use the apply3-style harness from task #389 that prints `STEP-N RC=$?` after every block so truncation is loud.

**Also**: `sslmode=no-verify` is node-pg syntax; libpq rejects it with `psql: error: invalid sslmode value: "no-verify"`. Always rewrite to `sslmode=require` before piping into a `postgres:16-alpine` sidecar. And use `DATABASE_URL_ADMIN` (nyvadmin) — `DATABASE_URL` is the runtime `nv_app` role which is NOBYPASSRLS and cannot ALTER TABLE.

