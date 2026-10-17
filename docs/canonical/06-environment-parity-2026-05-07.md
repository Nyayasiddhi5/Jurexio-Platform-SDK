# 06 — Environment Parity Matrix

**Status**: ✅ T6 deliverable (Option-A hardening pass, 2026-05-07)
**Verifier script**: `scripts/nv-verify-env-parity.ts` — narrowed scope (per architect review 2026-05-07T16:30Z): in-process required-key attestation for **Replit dev**, liveness annotation for **Replit publish**, and `/api/nv/health` (no auth) + 7-SDK-key `X-API-Key → /api/nv/gateway/health` round-trip for **EC2 prod**. It does **NOT** enumerate the full env-var set of the publish or EC2 environments — for that, use `scripts/nv-deep-env-diff.sh` (SSM-driven, requires AWS creds). Endpoint-surface comparison across envs is intentionally OUT of scope here; it's exercised by `scripts/nv-smoke-all-platforms.ts` against each env's domain.

---

## 1. Three target environments — what differs, what doesn't

| Aspect | Replit dev | Replit publish | EC2 prod |
|---|---|---|---|
| **Code** | this branch (live edits) | last `suggest_deploy` snapshot | last SSM tarball deploy (commit `c82426b`) |
| **Domain** | `${REPLIT_DEV_DOMAIN}` (workflow proxy) | `<repl>.replit.app` | `api.nyayasiddhi.online` + `console.nyayasiddhi.online` |
| **Database** | Neon (HTTP, `NYV_DATABASE_URL`) | same Neon | RDS PostgreSQL (`nyv-dev-edge-pg.cls0ugsyu4yr.ap-south-1.rds.amazonaws.com:5432`) |
| **Redis (TCP)** | bastion-fronted ElastiCache via `NYV_REDIS_TCP_URL` | same | direct ElastiCache (`master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379`) |
| **Object storage** | Replit Object Storage (`@replit/object-storage`, bucket `replit-objstore-…`) | same | S3 (`nyayavigya-sdk-devapp`, region `ap-south-1`) |
| **Storage adapter selection** | `NYV_STORAGE_BACKEND=replit` (recommended) or `s3` | `NYV_STORAGE_BACKEND=replit` | `NYV_STORAGE_BACKEND=s3` |
| **Storage key path** | `orgs/{orgId}/{platform}/users/{userId}/...` (identical) | identical | identical |
| **SDK keys (7)** | NYV_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX} from Secrets vault | same | mirrored to RDS via `mirror-pg.ts` 2026-05-07 (5→12 active rows) |
| **LLM providers** | 6 active (anthropic, openai, google, openrouter, sarvam, bedrock) | same | same |
| **JWT secrets** | `NYV_JWT_SECRET` + `NYV_JWT_REFRESH_SECRET` (vault) | same | same (in `/opt/nyayavigya/secrets/.env.production`) |

**Parity invariant**: same SDK keys, same code, same flows. **Only domain/DNS, datastore endpoints, and storage backend differ.**

---

## 2. Storage adapter parity — what guarantees identical paths

`src/services/nyv-document-storage-service.ts` defines 4 adapters under one `StorageAdapter` interface:

| Backend | Class | Selected when |
|---|---|---|
| `s3` | `S3StorageAdapter` (lines 512–636) | EC2 prod (default `NYV_STORAGE_BACKEND=s3`) |
| `replit` | `ReplitObjectStorageAdapter` (lines 414–506) | Replit dev + Replit publish (recommended) |
| `local` | `LocalStorageAdapter` (lines 329–408) | filesystem fallback |
| `gcs` | `LocalStorageAdapter` (placeholder) | not yet implemented |

`StoragePathBuilder` (lines 180–306) is **shared by all backends** — it produces:
- `orgs/{orgId}/{platform}/users/{userId}/documents/{docId}/{filename}`
- `orgs/{orgId}/{platform}/users/{userId}/parsed/{docId}/content.json`
- `orgs/{orgId}/{platform}/users/{userId}/embeddings/{docId}/chunks.json`
- `orgs/{orgId}/{platform}/users/{userId}/statutes/{jurisdiction}/{filename}`
- `orgs/{orgId}/{platform}/users/{userId}/compliance/{framework}/{filename}`
- `orgs/{orgId}/{platform}/shared/templates/{filename}`
- `global/statutes/{jurisdiction}/{statuteCode}/{filename}`
- `global/compliance/{framework}/{filename}`
- `temp/{orgId}/{jobId}/{filename}`

**Verified 2026-05-07T16:16Z**: same `docId=t3-XXX` produced identical key on both adapters; SHA-256 round-trip OK on both.

---

## 3. Redis var consolidation — NV-SECRETS-001

`src/utils/redis-tcp-url.ts` is the single resolver. **Resolution priority**:

1. `NYV_REDIS_TCP_URL` (canonical, no warning)
2. `NYV_REDIS_WRITE_URL` (legacy, **emits one-shot DEPRECATED warn**)
3. `REDIS_URL` (legacy, **emits one-shot DEPRECATED warn**)
4. `NYV_REDIS_URL` (legacy, **emits one-shot DEPRECATED warn**)

Read replica: `NYV_REDIS_READ_URL` (falls back to primary if absent).

**Verified 2026-05-07T16:14Z** on Replit dev: resolver returned `resolvedFrom=NYV_REDIS_TCP_URL` (canonical hit), no deprecation warn fired.

Wired into 7 consumers (CI grep guard in NV-SECRETS-001):
- `src/utils/env-validator.ts`
- `src/services/redis.ts`
- `src/services/lm-cache-backend.ts`
- `src/services/audit-chain-lock.ts`
- `src/startup/nv-pii-vault-cleanup.ts`
- `src/routes/nv-health-full-routes.ts`
- `src/middleware/nv-rate-limit-middleware.ts`

3 additional sites read `process.env.REDIS_URL` directly (whitelisted in NV-SECRETS-001 because they are Upstash REST-fallback paths, not TCP).

---

## 4. SDK key parity — vault → all 3 envs

The 7 platform keys live in **Replit Secrets** as the canonical source. Mirroring path:

```
Replit Secrets  ─────►  process.env  ─────►  Replit dev (live)
       │
       └──► suggest_deploy snapshot  ─────►  Replit publish (same vault)
       │
       └──► .local/keysync-payload/mirror-pg.ts (sha256 → key_hash)
                       │
                       ▼
              EC2 RDS sdk_app_api_keys  ─────►  EC2 prod
```

**Verified 2026-05-07T13:00Z**: NSP X-API-Key + NSI Bearer both 200 against `api.nyayasiddhi.online/api/nv/gateway/health`. EC2 RDS row count went from 5→12 active.

---

## 5. Drift checks — what to run before any deploy

```bash
tsx scripts/nv-verify-env-parity.ts
# Exits 0 on PASS, 1 on drift; --json for CI consumption.
```

Output includes:
- Required key presence per env (sha256-prefixed for byte-equality compare without leaking secret)
- EC2 health probe (`/api/nv/health`)
- EC2 SDK key probe per-platform (`/api/nv/gateway/health` with X-API-Key)
- Drift list with actionable failures

---

## 6. Cross-env smoke matrix (2026-05-07)

| Target | Total | Pass | Fail | Notes |
|---|---|---|---|---|
| Replit dev `localhost:5000` | 102 | 101 | 1 | Flaky NSI `research/query` LLM timeout (non-deterministic) |
| Replit publish `<repl>.replit.app` | — | — | — | Re-probe after `suggest_deploy` cycles |
| EC2 prod `api.nyayasiddhi.online` | 102 | 87 | 15 | 8 NSA/NYM scope-drift (DB lag), 7 `/api/nv/gateway/usage` 500 (separate platform bug) |

**Pre-T7 actions to close EC2 drift**:
1. Re-run `mirror-pg.ts` with NSA scopes `agents:read,agents:execute,documents:read,research:read,translate:write,usage:read` and NYM scopes `agents:read,agents:execute,documents:read,documents:write,translate:write,consumer_intake:write,usage:read`.
2. Diagnose `/api/nv/gateway/usage` 500 "Application not found" — check `sdkApplicationService.getAppUsageAnalytics` against EC2 row IDs (mirror used distinct app_id range 10–16 vs Replit's 2–9; the cross-env app_id mismatch is the likely cause).
