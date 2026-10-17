# SDK Release Hand-off — 2026-05-03 GA (dev cut)

> _Last reviewed: 2026-05-06 (Phase E doc-refresh sweep — see `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`)._

**Audience:** the five Nyayasiddhi platform leads (NYM, NSP, NSI, NSA, NSM).
**Status:** all SDK-DEV-EC2-ACCESS §11 pre-GA caveats 5, 7, 8, 9, 10 are
RESOLVED in current deploy `2026-05-02T0946Z-replit-ssm-a558dbab` (which
inherits the §11 fixes from `2026-05-01T07:50Z-pre-ga-may3-fixes`).
**NYM/NSP/NSI/NSA can ship end-to-end against EC2 dev today using
canonical-path keys.** **NSM is blocked pending a canonical-path key mint
(see Carry-over §3 below) — NSM lead, hold off integration smoke until
that lands.** The 2026-05-02 demo-key mint to legacy `nv_api_keys` is
available for `/api/nv/sdk/provision/*` smoke only — it does NOT
authenticate against `/api/nv/gateway/*`; for that use the canonical key
issued separately (see your platform's row below).

| Field | Value |
|---|---|
| Deploy ID | `2026-05-02T0946Z-replit-ssm-a558dbab` (supersedes `2026-05-01T07:50Z-pre-ga-may3-fixes`) |
| Tarball sha | `a558dbab` |
| Container restart | `2026-05-02T1011Z` |
| Gateway version | `5.0.0` (verified on `/api/nv/gateway/health` and unauth `/health`) |
| Datastores | RDS `nyv-dev-edge-pg` + ElastiCache `nyv-dev-edge-redis` (canonical, no in-container PG/Redis) |
| Repo path on host | `/opt/Nyayavigya/repo/2026-05-02T0946Z-replit-ssm-a558dbab/` (`/opt/Nyayavigya` is symlink → `/opt/nyayavigya`) |
| All 6 SDK tarballs | `s3://nyayavigya-sdk-devapp/sdk/<pkg>/5.0.0.tgz` (client-sdk, client-sdk-react-native, nyayamitra-sdk, types, react-hooks, enterprise-sdk) |
| Allowlist | 6 packages (see §6 of SDK-DEV-EC2-ACCESS-2026-05-01.md) |
| Audit chain | strict-OK (NS-010), no TAMPER lines |
| RDS post-reseed dump | `s3://nyayavigya-sdk-devapp/_dba/snapshots/2026-05-02T1031Z-post-reseed/dump.sql.gz` (1.5MB gz / 29MB raw) |
| Drizzle journal backfill | `drizzle.__drizzle_migrations` populated with 5 entries (0000–0004) on 2026-05-02T1029Z |
| Demo SDK keys file | `/opt/Nyayavigya/secrets/sdk-keys-2026-05-02.txt` (root 600, 8 keys minted in legacy `nv_api_keys` for NYM/NSP/NSI/NSA — NSM blocked, see Carry-over) |

---

## Common preflight (run once)

```bash
# Pick the right key for your platform from the table below.
export NYV_API_KEY="nyv_live_sk_<your-platform>_<rest>"
export NYV_BASE="https://api.nyayasiddhi.online"   # or your dev tunnel host

# 1. Reach the gateway
curl -fsS -H "Authorization: Bearer $NYV_API_KEY" \
  "$NYV_BASE/api/nv/gateway/health"
# expect: {"success":true,"data":{"status":"healthy","version":"5.0.0",...}}
```

If `/api/nv/gateway/health` returns 401 you sent the wrong key (or no key);
the dev gateway will not respond to that endpoint without an SDK-key Bearer.
The unauthenticated public probe is `/health` (returns 200 plain).

---

## Per-platform hand-off

### NYM — Nyayamitra (consumer legal aid)

| Item | Value |
|---|---|
| Key prefix | `nyv_live_sk_nym_…` |
| Primary SDK | `@nyayavigya/nyayamitra-sdk@5.0.0` |
| Secondary SDK | `@nyayavigya/client-sdk@5.0.0` (server side) |
| Install (Node) | `curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/nyayamitra-sdk/5.0.0.tgz" -o nyayamitra-sdk-5.0.0.tgz && npm i ./nyayamitra-sdk-5.0.0.tgz` |
| Smoke | `curl -fsS -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/api/nv/gateway/agents" \| head -c 200` |

3-line copy-paste smoke:
```bash
curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/nyayamitra-sdk/5.0.0.tgz" -o /tmp/nym.tgz
sha256sum /tmp/nym.tgz   # expect prefix bb5fab90…
curl -fsS -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/api/nv/gateway/agents" | head -c 200
```

### NSP — Nyayasiddhi Platform (web)

| Item | Value |
|---|---|
| Key prefix | `nyv_live_sk_nsp_…` |
| Primary SDK | `@nyayavigya/client-sdk@5.0.0` |
| Hooks | `@nyayavigya/react-hooks@5.0.0` |
| Types | `@nyayavigya/types@5.0.0` |
| Install | three `curl … -o` calls + `npm i ./*.tgz` (or use `aws s3 cp` if you already have AWS creds) |

3-line copy-paste smoke:
```bash
for P in client-sdk react-hooks types; do curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/$P/5.0.0.tgz" -o /tmp/$P.tgz; done
ls -la /tmp/{client-sdk,react-hooks,types}.tgz
curl -fsS -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/api/nv/gateway/health"
```

### NSI — Nyayasiddhi Intelligence (enterprise / RAG)

| Item | Value |
|---|---|
| Key prefix | `nyv_live_sk_nsi_…` |
| Primary SDK | `@nyayavigya/enterprise-sdk@5.0.0` |
| Companion | `@nyayavigya/client-sdk@5.0.0` |
| Notable endpoint | `POST /api/nv/sdk/enterprise/research/domain/legal` |

3-line copy-paste smoke:
```bash
curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/enterprise-sdk/5.0.0.tgz" -o /tmp/ent.tgz
curl -fsS -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/api/nv/gateway/agents" | head -c 200
curl -fsS -X POST -H "Authorization: Bearer $NYV_API_KEY" -H "Content-Type: application/json" \
  "$NYV_BASE/api/nv/sdk/enterprise/research/domain/legal" -d '{"query":"contract law"}' --max-time 60
```

### NSA — Nyayasiddhi Agents (orchestration)

| Item | Value |
|---|---|
| Key prefix | `nyv_live_sk_nsa_…` |
| Primary SDK | `@nyayavigya/client-sdk@5.0.0` |
| Notable endpoint | `POST /api/nv/gateway/agents/:agentId/execute` (body: `{"prompt": "..."}`) |

3-line copy-paste smoke:
```bash
curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/client-sdk/5.0.0.tgz" -o /tmp/cli.tgz
curl -fsS -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/api/nv/gateway/agents" | head -c 200
curl -fsS -X POST -H "Authorization: Bearer $NYV_API_KEY" -H "Content-Type: application/json" \
  "$NYV_BASE/api/nv/gateway/agents/chief-legal-officer/execute" -d '{"prompt":"hello"}' --max-time 90
```

### NSM — Nyayasiddhi Mobile (React Native)

| Item | Value |
|---|---|
| Key prefix | `nyv_live_sk_nsm_…` |
| Primary SDK | `@nyayavigya/client-sdk-react-native@5.0.0` |
| Companion | `@nyayavigya/types@5.0.0` |
| Install (RN project) | `curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/client-sdk-react-native/5.0.0.tgz" -o csrn-5.0.0.tgz && npm i ./csrn-5.0.0.tgz` |

3-line copy-paste smoke:
```bash
curl -fsSL -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/downloads/sdk/client-sdk-react-native/5.0.0.tgz" -o /tmp/csrn.tgz
sha256sum /tmp/csrn.tgz   # expect prefix 7ff0be92…
curl -fsS -H "Authorization: Bearer $NYV_API_KEY" "$NYV_BASE/api/nv/gateway/health"
```

---

## What changed today (one-line per fix)

- §11 #5 **NYV-NS-011** — `ALLOWED_PACKAGES` now lists all 6 SDKs (was 3).
- §11 #7 **NYV-NS-015** — `nvSdkProvisionRouter` mounted before
  `sdkConsoleRoutes`; SDK-key reaches `/provision*`.
- §11 #8 **NYV-NS-012** — explicit `return` after every error
  `res.json(...)` in `nv-sdk-provision-routes.ts`; CWE-285 surface closed.
- §11 #9 **NYV-NS-013** — `/create-app` defaults scopes to
  `["agents:read","agents:execute","research:read"]`; bare `["*"]` only with
  `super_admin` + `wildcard_override:true`.
- §11 #10 **NYV-NS-014** — `/create-app` quickstart uses live request host,
  `/api/nv/gateway/agents/:agentId/execute`, and `prompt` body field.
- v5.0.0 tarballs published for the two missing SDKs:
  `nyayamitra-sdk` (sha `bb5fab90…`, 22432 B) and
  `client-sdk-react-native` (sha `7ff0be92…`, 20799 B).

## Carry-over

- §11 #6 — legacy `nv_api_keys` / `nv_sdk_applications` divergence stays as
  v3.2 cleanup. With #7 fixed it is now the first failure surface for
  `/provision` and `/provision/validate` (returns
  `NYV-PROV-401: Invalid or revoked SDK key` against the legacy join).
  Workaround: use `/api/nv/gateway/*` directly — those routes read the
  canonical tables only.
- The deploy script's wait-for-healthy loop in `nv-start-dev.sh` curls
  `/api/nv/gateway/health` without a Bearer and so reports failure even on
  a healthy gateway. The 2026-05-01 deploy was promoted to
  `CURRENT_DEPLOY` / `LAST_GOOD_DEPLOY` manually after a 6-package
  authenticated probe came back green. Track a fix to either curl
  `/health` (the unauthenticated probe) or pass the SRE Bearer.
- **NSM platform key blocked (2026-05-02).** `nv-seed-sdk-keys.ts` minted
  4/5 demo platform keys (NYM/NSP/NSI/NSA) into legacy `nv_api_keys`.
  NSM failed with PG error `23503` (FK
  `nv_api_keys_app_id_fkey`): the seed hard-codes `app_id =
  'nvsdkapp-demo-ministry-001'` but `nv-seed-sdk-apps.ts` does not insert a
  ministry row into `nv_sdk_applications`. Two fixes available:
  (a) add `Nyayasiddhi Ministry™ Integration` to `scripts/nv-seed-sdk-apps.ts`
      with `app_id = 'nvsdkapp-demo-ministry-001'`, then re-run
      `nv-seed-sdk-keys.ts` (idempotent — only the ministry row will be added);
  (b) hand-mint via canonical path: `POST /api/nv/sdk/create-app` with
      admin JWT (super_admin), then the gateway middleware
      (`src/middleware/nv-sdk-gateway.ts`) will read the new
      `sdk_app_api_keys` row directly. Path (b) is preferred because it
      lands the key in the canonical table that the v5.0.0 middleware
      actually authenticates against (avoids legacy auth-divergence per #6).
- **Smoke against legacy keys returns 401 on auth-gated endpoints — by
  design.** The 2026-05-02 mint targeted `nv_api_keys` (legacy table per
  §11 #6); the running middleware reads only canonical
  `sdk_app_api_keys`. Public probes (`/api/nv/health`, console proxy
  `:80/api/nv/health`) return 200; auth-gated probes
  (`/api/nv/gateway/agents`, `/api/nv/sdk/provision/health`) return 401
  with the legacy keys. Use canonical-path mint (above) for end-to-end
  consumer validation.

## Escalation

If anything in the per-platform smoke fails, page the platform on-call and
include: the platform key prefix you used, the failing curl command, the
HTTP code + body snippet, and the value of `cat /opt/nyayavigya/CURRENT_DEPLOY`
on EC2 (via SSM). Then point them at this file plus
`SDK-DEV-EC2-ACCESS-2026-05-01.md` §11.
