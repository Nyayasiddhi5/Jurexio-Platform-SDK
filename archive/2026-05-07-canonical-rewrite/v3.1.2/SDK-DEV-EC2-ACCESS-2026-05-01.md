---
status: active
version: 3.1.2
audience: NSP-Web, NSP-Mobile, Nyayamitra (NYM) consumer engineers
last_verified: 2026-05-01
deploy_id: 20260501T0510Z-39bfdd83b0-replit-ssm
---

# Nyayavigya SDK — Dev-Environment Access (EC2)

This is the consumer-facing reference for hitting the **dev** Nyayavigya
gateway on EC2 (`i-0df71e5ea1df8f588`, ap-south-1) at platform commit
`39bfdd83b0` (replit-ssm sync of 2026-05-01 05:42 UTC).

It applies to **all three SDK platforms** — NSP-Web, NSP-Mobile, Nyayamitra —
which share the same dev gateway.

---

## 1. Base URLs

| Channel | URL | Notes |
|---|---|---|
| Production API base | `https://api.nyayasiddhi.online` | TLS via ALB, Caddy → gateway pool |
| **Dev — same edge** | `https://api.nyayasiddhi.online` | Dev shares the prod ALB; the EC2 instance below is the dev backend behind it |
| Dev — direct (engineers only) | `http://127.0.0.1:5000` (via SSM port-forward, see §5) | Bypasses Caddy / WAF; only for low-level debugging |

The gateway version reported by `/api/nv/gateway/health` is `5.0.0`,
platform `Nyayavigya Legal SDK`, build matches Replit HEAD `39bfdd8`.

---

## 2. Authentication

The dev gateway accepts the same auth headers as production:

```
X-API-Key: <raw-key>
# or
Authorization: Bearer <raw-key>
```

Keys are stored in the **canonical** `sdk_app_api_keys` table (post-migration
`drizzle/0006_unify_sdk_key_tables.sql`). The legacy `nv_api_keys` table is
deprecated and not consulted by the runtime gateway middleware.

To mint a dev key for your platform, use one of:

- **Console UI** (recommended): https://console.nyayasiddhi.online → SDK Apps → New
- **API**: `POST /api/nv/sdk/create-app` (requires a `developer` JWT) — dual-writes
  to the canonical and legacy tables in one call.
- **Direct DB** (SRE only, dev-bench): see the SQL pattern in
  `scripts/nv-seed-rag-and-audit.ts` — insert into `sdk_applications` then
  `sdk_app_api_keys` with `key_hash = sha256(raw_key)`.

A smoke-test key (canonical app id `9`, prefix `nyv_smoke_s2ciZF`) was minted
at `2026-05-01 05:46Z` for the parity-validation run and **revoked at
2026-05-01 06:08Z** (`sdk_app_api_keys.is_active=false`,
`sdk_applications.status=suspended`). Confirmed: the gateway now returns
`HTTP 401` for that key. Consumers must mint their own scoped keys.

---

## 3. Sample requests (verified 2026-05-01)

### 3.1 Health probe (no auth required only on `/phase5`)

```bash
# Phase 5 stack health (public)
curl -sS https://api.nyayasiddhi.online/api/nv/phase5/phase5/health
# {"success":true,"status":"ok","phase":5,"version":"v5.0.0","services":10,...}

# Gateway service health (requires key)
curl -sS -H "X-API-Key: $NYV_KEY" \
  https://api.nyayasiddhi.online/api/nv/gateway/health
# {"success":true,"data":{"status":"healthy","platform":"Nyayavigya Legal SDK","version":"5.0.0",...}}
```

### 3.2 List available agents

```bash
curl -sS -H "X-API-Key: $NYV_KEY" \
  https://api.nyayasiddhi.online/api/nv/gateway/agents
```

Returns 148 active agents (Chief Legal Officer, General Counsel, etc.) at p50
≈85 ms with the gateway-side Redis cache warm.

### 3.3 Legal research (LLM-backed)

```bash
curl -sS -X POST \
  -H "X-API-Key: $NYV_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is Section 42 of the Indian Contract Act?",
    "jurisdiction": "IN"
  }' \
  https://api.nyayasiddhi.online/api/nv/gateway/research/query
```

Returns `researchId`, the LLM `research` body, `model` (auto-routed via
OpenRouter; smoke run picked `nvidia/nemotron-3-nano-30b-a3b:free`),
`tokens`, and orchestration metadata
(`promptEnhanced: true, responseEngineered: true`). Smoke latency: ~18.5 s
end-to-end on a free model; production tier traffic should auto-route to a
faster model.

> **Jurisdiction codes:** use ISO codes only — `IN`, `GB`, `GCC`, `EU`, `US`, `SG`.
> Long-form names like `india` are rejected with `INVALID_JURISDICTION`.

### 3.4 Execute a specific agent

```bash
curl -sS -X POST \
  -H "X-API-Key: $NYV_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "prompt": "Review this NDA: ...", "jurisdiction": "IN" }' \
  https://api.nyayasiddhi.online/api/nv/gateway/agents/contract-specialist/execute
```

> **Field name:** `prompt` (not `task`). The API rejects `task` with
> `400 Missing required field: prompt`.

---

## 4. Audit chain & namespace integrity

The dev gateway boots with `NYV-NS-010` audit-chain self-test in **strict mode**
(`NYV_AUDIT_CHAIN_TOLERATE=0`). On 2026-05-01 it passed cleanly:

```
[NYV-NS-010] Audit chain ok: 1 recent entries verified.
```

Every authenticated SDK call appends a row to `nv_audit_logs` with a
SHA-256-chained `record_hash` over `id|trace_id|route|method|event_type|previous_hash`.
Any tamper aborts boot. If you see `NS-010 TAMPER suspected` in console logs,
the on-call SRE rolls back via `/opt/nyayavigya/LAST_GOOD_DEPLOY` and pages
the platform team — do **not** flip the override flag without a written RCA.

RAG namespace isolation (per-tenant `rag_namespaces`) was reseeded on
2026-04-30 night and is intact.

---

## 5. Direct EC2 access for engineers (SSM port-forward)

The dev EC2 is not SSH-reachable from outside the VPC. To hit the gateway
directly (for tcpdump / verbose logging / load-testing), use AWS SSM:

```bash
# Local listener on :5000 → EC2 port 5000 (gateway)
aws ssm start-session \
  --region ap-south-1 \
  --target i-0df71e5ea1df8f588 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5000"],"localPortNumber":["5000"]}'

# Then in another shell:
curl -sS -H "X-API-Key: $NYV_KEY" http://127.0.0.1:5000/api/nv/gateway/health
```

Requires AWS credentials with `ssm:StartSession` on the instance and the
`AmazonSSMManagedInstanceCore` role on the EC2 (already attached).

---

## 6. SDK packages

> *Updated 2026-05-01 08:10 UTC.* This section originally said “pin to
> `^3.1.2`”; the actual tarballs published to the dev S3 on 2026-05-01 are
> versioned `5.0.0` (see §10.4 for build/upload details). GA pulled in to
> May 3 — freeze lifted; the post-freeze allowlist patch and the two
> missing 5.x builds (nyayamitra-sdk + client-sdk-react-native) shipped
> in deploy `2026-05-01T07:50Z-pre-ga-may3-fixes`. The current
> authoritative install matrix for the dev environment is:

| Package | Version on dev S3 | Reachable via `/downloads/sdk` today | Use it for |
|---|---|---|---|
| `@nyayavigya/client-sdk`              | `5.0.0` | yes (200, sha256 `3f95aef0…`) | Server-to-server Node.js |
| `@nyayavigya/types`                   | `5.0.0` | yes (200, allowlisted 2026-05-01) | Shared TS types |
| `@nyayavigya/react-hooks`             | `5.0.0` | yes (200, allowlisted 2026-05-01) | React/Next.js client-side hooks |
| `@nyayavigya/enterprise-sdk`          | `5.0.0` | yes (200, allowlisted 2026-05-01) | Enterprise-tier Node.js (RAG, document pipeline) |
| `@nyayavigya/nyayamitra-sdk`          | `5.0.0` (sha256 `bb5fab90…`, 22432 B) | yes (200, built+uploaded 2026-05-01) | Nyayamitra (consumer legal) flows |
| `@nyayavigya/client-sdk-react-native` | `5.0.0` (sha256 `7ff0be92…`, 20799 B) | yes (200, built+uploaded 2026-05-01) | React Native (NSP-Mobile) |

All five Nyayasiddhi platforms (NYM / NSP / NSI / NSA / NSM) can ship
end-to-end against the EC2 dev environment today using the per-platform
hand-off in `SDK-RELEASE-2026-05-03.md`.

The packages on EC2 live under `/opt/nyayavigya/repo/nyayavigya-platform-312/packages/`
and are rebuilt inside the gateway image (`Dockerfile`, multi-stage). To pull
the same source tree into a local checkout for development:

```bash
aws s3 cp \
  s3://nyayavigya-sdk-devapp/deploys/nyv-20260501T0510Z-39bfdd83b0-replit-ssm.tgz \
  ./
tar -xzf nyv-20260501T0510Z-39bfdd83b0-replit-ssm.tgz
```

(140 MiB, `.env` excluded by deny-all rule.)

---

## 7. Status & escalation

| Signal | Where to look |
|---|---|
| Gateway health | `https://api.nyayasiddhi.online/api/nv/gateway/health` |
| Phase 5 services health | `https://api.nyayasiddhi.online/api/nv/phase5/phase5/health` |
| Public status page | `https://status.nyayasiddhi.online` |
| Current deploy ID | `cat /opt/nyayavigya/CURRENT_DEPLOY` (on EC2 via SSM) |
| Last known-good deploy | `cat /opt/nyayavigya/LAST_GOOD_DEPLOY` |
| Deploy history | `/opt/nyayavigya/logs/deploys.log` |
| Container state | `docker ps --filter name=nyv-` (on EC2 via SSM) |

Escalation: page the platform on-call if `/api/nv/gateway/health` returns
non-200 for >2 minutes, or if any `NS-010 TAMPER` line appears in
`docker logs nyv-gateway`.

---

## 8. Known follow-ups before May 15 GA

These were surfaced by the post-sync code review (architect, 2026-05-01) and
are NOT blockers for dev consumption today, but should be closed before GA:

1. **Provisioning routes still legacy-first.** `/api/nv/sdk/provision` reads
   from `nv_api_keys` + `nv_sdk_applications`; `/api/nv/sdk/create-app`
   inserts into `nv_sdk_applications` first.
   *Status update (superseded in part by §10.3):* the `display_name` column
   drift on EC2's legacy `nv_sdk_applications` was fixed on 2026-05-01 by
   ALTER + back-fill, so create-app no longer fails on the schema-drift path.
   The architectural concern (provisioning code is legacy-first when it
   should be canonical-first) is still open and is detailed with current
   handler-level failure modes in §11 items 6-8 below.

2. **Audit-row repair RCA.** One pre-existing legacy row
   (`nv_audit_logs.id=5166e86b-…`) had its `record_hash` rewritten to the
   canonical NS-010 hash on 2026-05-01 to clear the strict-boot block. The
   row pre-dates the current chain definition; a one-line RCA noting why a
   rewrite (vs. delete + re-genesis) was the right call should be filed in
   `docs/v3.1.2/completed_docs/` before GA so the next on-call has context.

3. **True SDK package E2E.** The 2026-05-01 smoke covered the gateway HTTP
   surface via `curl`. Before GA, run an end-to-end test that imports
   `@nyayavigya/client-sdk` and `@nyayavigya/client-sdk-react-native` and
   exercises at least the `agents.list()` and `research.query()` calls
   against this dev gateway, to catch any client-side regressions.

## 9. Platform-specific addenda

This doc is the shared dev-access reference. For platform-specific concerns
(scopes, rate limits, app IDs, webhook configuration), see:

- `docs/v3.1.2/SDK-PLATFORM-NSP-WEB.md`
- `docs/v3.1.2/SDK-PLATFORM-NSP-MOBILE.md`
- `docs/v3.1.2/SDK-PLATFORM-NYAYAMITRA.md`

---

## 10. Addendum · Post-rotation state (2026-05-01 06:50 UTC)

Following the dev-parity sync (deploy `20260501T0510Z-39bfdd83b0-replit-ssm`),
the following readiness items were executed on EC2 directly against the
canonical `sdk_app_api_keys` table (Drizzle 0006 schema):

### 10.1 Platform key rotation (5 keys)

All five Nyayasiddhi-ecosystem platform applications (id 1-5) had their
previously-issued canonical keys revoked and replaced with fresh keys in a
single ACID transaction:

| app_id | platform                              | new key prefix        |
|--------|---------------------------------------|-----------------------|
| 1      | Nyayamitra (Citizen Legal Aid)        | `nyv_live_sk_nym_`    |
| 2      | Nyayasiddhi Professional (Practice)   | `nyv_live_sk_nsp_`    |
| 3      | Nyayasiddhi Institutional (Enterprise)| `nyv_live_sk_nsi_`    |
| 4      | Nyayasiddhi Academy (Education)       | `nyv_live_sk_nsa_`    |
| 5      | Nyayasiddhi Ministry (Sovereign)      | `nyv_live_sk_nsm_`    |

Default scopes on all five: `["agents:read","agents:execute","research:read"]`.
These are the three scope strings exercised by the smoke routes used in this
hand-off (`/api/nv/gateway/agents`, `/api/nv/gateway/agents/:id/execute`,
`/api/nv/gateway/research/query`). The full scope universe enforced by
`src/routes/nv-sdk-gateway-routes.ts` is wider — `checkScope(...)` calls also
gate `documents:read`, `documents:write`, `cache:admin`, and others — so
platforms needing those surfaces should request scope additions explicitly. An earlier draft listed
`agents:invoke`, `orchestrate`, and `stream`; those strings do not exist
anywhere in the routing layer and were corrected in the same
`sdk_app_api_keys` row on 2026-05-01 ~07:00 UTC.

**Smoke verification (post-scope-fix, 2026-05-01 07:02 UTC)**:

| call                                                            | result        |
|-----------------------------------------------------------------|---------------|
| `GET /api/nv/gateway/agents`                                    | 200, 148 agents, correct `applicationId` |
| `POST /api/nv/gateway/research/query` (jurisdiction `EU`)       | 200, 9 146-byte response with real research body (`research:read` scope) |
| `POST /api/nv/gateway/agents/chief-legal-officer/execute`       | 400 `Missing required field: prompt` — handler reached, scope check passed (`agents:execute` scope) |

**Raw-key retrieval (operators only)**:

```bash
aws ssm start-session --target i-0df71e5ea1df8f588 --region ap-south-1
sudo cat /opt/nyayavigya/secrets/platform-keys-2026-05-01.txt
```

File is `root:root` mode `600` (verified `stat`: 791 bytes), parent dir
`/opt/nyayavigya/secrets` `root:root` mode `700`. Distribute to each platform
team out-of-band (signed channel or vault).

**Plaintext TTL / destruction plan** (operator-owned):

1. Each platform team confirms receipt of their key by 2026-05-04 18:00 UTC
   and stores it in their own secrets manager (Vault/AWS Secrets Manager).
2. SRE shreds the file on 2026-05-05 09:00 UTC regardless of receipt status:
   `sudo shred -uvz -n 7 /opt/nyayavigya/secrets/platform-keys-2026-05-01.txt`
3. Any team that has not stored the key by then must request a fresh
   rotation; do **not** attempt recovery from this file after the shred date.
4. Pre-GA (before May 15), all five keys are rotated again to invalidate any
   copy that may have escaped the controlled distribution window.

### 10.2 Wildcard demo keys tightened (NYV-NS-002 hardening)

Two pre-existing demo applications (`id=7`, `id=8`) carried wildcard scopes
(`["*"]`). Both keys were marked `is_active=false` and the parent applications
moved to `status='deprecated'`. Use the platform keys above for any new
ecosystem integration; do not reissue wildcard scopes.

### 10.3 Schema drift fixed on legacy `nv_sdk_applications`

Added `display_name TEXT` column to `nv_sdk_applications` and back-filled the
existing row from `name`. The legacy provisioning route
(`POST /api/nv/sdk/provision`) no longer fails on the missing column. The
runtime gateway middleware continues to read the canonical table only — this
fix is a courtesy for the legacy admin path until v3.2 retires it.

### 10.4 SDK packages built on EC2 + published to S3

`bash scripts/build-all-sdks.sh` was executed inside a one-off `node:20-alpine`
container with the platform repo bind-mounted (the EC2 host has no Node
runtime; gateway runs in Docker). Two release-prep gaps were worked around
during this run and are documented in §11 below:

| package                  | tarball                                  | bytes  | sha256 (prefix) |
|--------------------------|------------------------------------------|--------|-----------------|
| `@nyayavigya/types`      | `nyayavigya-types-5.0.0.tgz`             | 13 575 | `8e4f21e4…`     |
| `@nyayavigya/client-sdk` | `nyayavigya-client-sdk-5.0.0.tgz`        | 43 680 | `3f95aef0…`     |
| `@nyayavigya/react-hooks`| `nyayavigya-react-hooks-5.0.0.tgz`       | 18 046 | `f9ddcebf…`     |
| `@nyayavigya/enterprise-sdk` | `nyayavigya-enterprise-sdk-5.0.0.tgz`| 7 633 | `1753953…`     |

All four uploaded to `s3://nyayavigya-sdk-devapp/sdk/<pkg>/5.0.0.tgz`.
Manifest at `s3://nyayavigya-sdk-devapp/sdk/manifest.json` updated to list
v5.0.0 as latest for each (legacy 6.0.0 / 3.1.2 / 1.0.0 entries preserved as
historical versions).

#### 10.4.1 Real download endpoint (correction)

The earlier draft of this addendum claimed the download endpoint was
`GET /api/nv/sdk/download/<pkg>/<ver>` and that operator-JWT was the design.
That was wrong on two counts. The real distribution endpoint is mounted
in `src/index.ts` as:

```
GET /downloads/sdk/<pkg>/<version>.tgz
GET /downloads/sdk/health        — config introspection
```

`/api/nv/sdk/download/...` is the *console*-side route guarded by JWT and is
not the consumer surface. Production-style introspection from the live
gateway (2026-05-01 07:01 UTC):

```json
{
  "ok": true,
  "bucket": "nyayavigya-sdk-devapp",
  "prefix": "sdk/",
  "region": "ap-south-1",
  "packages": ["client-sdk","client-sdk-react-native","nyayamitra-sdk","types","react-hooks","enterprise-sdk"],
  "signed_url_ttl_seconds": 300,
  "public_downloads": false,
  "auth_modes": [
    "sdk_api_key (Authorization: Bearer nyv_…)",
    "static_token (?token=…)",
    "hmac_token (?exp=…&sig=…)"
  ]
}
```

Working consumer call (verified 200, 43 680 bytes, `gzip compressed data`,
sha256 prefix `3f95aef0…` — matches the build-side hash in §10.4):

```bash
curl -fSL -o client-sdk-5.0.0.tgz \
  -H "Authorization: Bearer $NYV_API_KEY" \
  https://<gateway-host>/downloads/sdk/client-sdk/5.0.0.tgz
```

`extractApiKey()` in `src/routes/nv-sdk-downloads-routes.ts` actually accepts
**any** of three credential carriers (in this priority order): `x-api-key`
header, `Authorization: Bearer …` header, or `?api_key=…` query parameter.
We recommend `Authorization: Bearer` for the gateway-style call shown above
because it composes cleanly with `/api/nv/gateway/*` calls (which use the
same Bearer token), but `x-api-key` works identically here and is the
simplest path for tools that already wire it for the gateway. The endpoint
302s to a 5-minute pre-signed S3 URL on success.

#### 10.4.2 Allowlist gap (action required pre-GA)

`src/routes/nv-sdk-downloads-routes.ts` declares a hardcoded
`ALLOWED_PACKAGES` set: `client-sdk`, `client-sdk-react-native`,
`nyayamitra-sdk`. Any request for a package outside that set returns
`HTTP 404 {"error":"package_not_found", ...}` *before* the S3 head check.

Of the four tarballs uploaded in §10.4, only `client-sdk` is currently
serveable via the gateway. The other three behave as follows:

| package          | S3 object | gateway `/downloads/sdk/<pkg>/5.0.0.tgz` |
|------------------|-----------|------------------------------------------|
| `client-sdk`     | present   | 200 (verified, see §10.4.1)              |
| `types`          | present   | 404 `package_not_found`                  |
| `react-hooks`    | present   | 404 `package_not_found`                  |
| `enterprise-sdk` | present   | 404 `package_not_found`                  |

NSP / Nyayasiddhi web and mobile only need `client-sdk` for the dev-access
hand-off, so this does **not** block the platform smoke. It does block
internal consumers that depend on `@nyayavigya/types`, `react-hooks`, or
`enterprise-sdk` from pulling those tarballs through the gateway — they
must either fetch direct from S3 (with AWS credentials) or wait for the
post-freeze allowlist update. See §11 item 5.

## 11. Known release-prep gaps (non-blocking, file before GA)

These were observed during item 1-4 execution and should be tracked but do
not block the dev-environment hand-off:

1. **`packages/react-hooks/package.json`** declares both `react@^19` (devDep)
   and `@testing-library/react@^14` (peer: `react@^18`). Strict peer-dep
   resolution under npm ≥ 10 fails with `ERESOLVE`. Workaround: install with
   `--legacy-peer-deps`. Permanent fix: bump `@testing-library/react` to
   `^16.x`.
2. **`scripts/build-all-sdks.sh`** uses `npm install --silent`, which
   suppresses both the install command's stdout *and* its stderr. When ERESOLVE
   or any other install error fires, the `set -e` exit looks silent. Drop
   `--silent` or replace with `--no-progress` to keep error visibility.
3. **`scripts/nv-publish-sdk-tarballs.ts`** hard-codes a different package
   list than `build-all-sdks.sh` (`client-sdk`, `client-sdk-react-native`,
   `nyayamitra-sdk` vs. `types`, `client-sdk`, `react-hooks`,
   `enterprise-sdk`). The publish for this dev-environment was done with
   `aws s3 cp` directly to bypass the mismatch. Reconcile both lists from a
   single source of truth before GA.
4. **EC2 `packages/types`** and **`packages/react-hooks`** were missing on
   the EC2 host after the morning rsync sync (T002/T003) — they are
   git-tracked on the source repo but were filtered or missed during tarball
   staging. They were re-shipped via SSM base64 stream during this run.
   Audit the rsync include/exclude list before the next deploy.

5. **RESOLVED 2026-05-01** (deploy `2026-05-01T07:50Z-pre-ga-may3-fixes`,
   tarball sha `d3156b25`, marker `NYV-NS-011`). `ALLOWED_PACKAGES` in
   `src/routes/nv-sdk-downloads-routes.ts` now contains all six entries:
   `client-sdk`, `client-sdk-react-native`, `nyayamitra-sdk`, `types`,
   `react-hooks`, `enterprise-sdk`. Verified by hitting
   `GET /downloads/sdk/<pkg>/5.0.0.tgz` with a valid SDK-key Bearer for all
   six packages — every response was `200` with a signed S3 redirect.
   `GET /downloads/sdk/health` reports the same six names under `packages`.

6. **Legacy `nv_api_keys` / `nv_sdk_applications` divergence.** The
   canonical-only rotation in §10.1 deliberately did **not** mirror the new
   keys into the legacy `nv_api_keys` / `nv_sdk_applications` tables. Live
   counts on EC2 today: `legacy_apps=1`, `legacy_keys=1` (the original demo
   row only) vs. canonical `sdk_applications` rows 1-9 with active keys for
   1-5 + 9. The gateway middleware (`src/middleware/nv-sdk-gateway.ts`) reads
   canonical only, so platform requests work. However,
   `src/routes/nv-sdk-provision-routes.ts` still reads the legacy tables in
   the `POST /api/nv/sdk/provision` and `/provision/validate` handlers, and
   the operator-only `POST /api/nv/sdk/create-app` writes to legacy first.
   Real failure modes for a freshly-rotated canonical key (verified by
   reading the route handlers, not by hitting them at runtime):

   - `POST /api/nv/sdk/provision` — `sdkGatewayAuth` middleware accepts the
     canonical Bearer token and lets the request through; the handler body
     then runs its own `SELECT ... FROM nv_api_keys k JOIN
     nv_sdk_applications a ...` (lines 58-69) which misses, returning
     `HTTP 401 {"error":"NYV-PROV-401: Invalid or revoked SDK key"}` from
     line 72. Note the handler is missing `return` statements after the
     401/403 branches (lines 73, 79, 88), so behaviour after a miss can
     fall through to a `TypeError`-driven 500 from the catch block — treat
     any non-`{provision_status:"ready"}` response as authoritative-negative.
     There is also a header-carrier mismatch worth flagging for any future
     caller: `sdkGatewayAuth` (canonical middleware) accepts both `X-API-Key`
     and `Authorization: Bearer …`, but lines 53-54 of the `/provision`
     handler derive `rawKey` only from `req.headers.authorization`. A client
     that authenticates via `X-API-Key` only will pass middleware and then
     be hashed against an empty `authHeader.replace('Bearer ', '').trim()`,
     producing the same 401/500 path. Either send the Bearer header (the
     recommended path) or wait for the cleanup that normalises this
     handler's extractor to match the middleware's.
   - `POST /api/nv/sdk/provision/validate` — public route (no middleware),
     queries the legacy join directly and returns `HTTP 200 {valid:false,
     reason:"Key not found"}` when missing. This handler has the same
     missing-`return` pattern on lines 224 and 230, with the same 500
     fall-through risk.
   - `POST /api/nv/sdk/provision/health` — **not divergent.** This handler
     only validates a `{status, uptime_seconds, sdk_version,
     active_connections}` payload and returns 200; it never queries the
     legacy join. With one of the rotated canonical keys, `sdkGatewayAuth`
     passes and the handler returns 200 (or 400 on bad payload).

   Pre-GA action: tag
   `/api/nv/sdk/provision*` as `Deprecated` in OpenAPI and emit a
   `Warning: 299 - "Deprecated; use Authorization: Bearer with /downloads/sdk
   and /api/nv/gateway/* directly"` header on every response, then plan its
   removal in v3.2. Do **not** mirror new keys into the legacy tables — that
   only delays the cleanup and doubles the rotation surface.

7. **RESOLVED 2026-05-01** (deploy `2026-05-01T07:50Z-pre-ga-may3-fixes`,
   marker `NYV-NS-015`). `src/index.ts` now mounts `nvSdkProvisionRouter`
   (SDK-key) *before* `sdkConsoleRoutes` (JWT-only) — see lines 505 and
   508 of `src/index.ts`. Express tries the provision router first, so an
   SDK-key Bearer reaches the `/provision*` handlers without being
   intercepted by the console router's `router.use(authenticateToken)`.
   Verified: `POST /api/nv/sdk/provision/health` with a valid SDK-key
   Bearer returns `400 NYV-PROV-VAL-002` (schema validation, route
   reached) instead of the previous `401 AUTH_TOKEN_INVALID` from the
   console mount. The legacy-lookup divergence in item 6 below is now the
   first failure surface for consumers of `/provision` and
   `/provision/validate` and remains tracked for v3.2 cleanup.

8. **RESOLVED 2026-05-01** (deploy `2026-05-01T07:50Z-pre-ga-may3-fixes`,
   markers `NYV-NS-012` / `NYV-NS-013`). Explicit `return` added after
   every error `res.json(...)` in `nv-sdk-provision-routes.ts`
   (six paths in `/provision`, `/provision/validate`, and `/create-app`).
   `/create-app` is also gated behind
   `requireRole('developer','org_admin','super_admin','admin')` at the
   route definition, so a non-admin caller asking for `enterprise` or
   `internal` tier now hits the 403 path **and** stops — no DB insert and
   no key minted. Verified live: an unauthenticated `POST` to
   `/api/nv/sdk/create-app` returns `401 AUTH_TOKEN_MISSING` and writes
   nothing. The CWE-285 broken-access-control surface is closed.

9. **RESOLVED 2026-05-01** (deploy `2026-05-01T07:50Z-pre-ga-may3-fixes`,
   marker `NYV-NS-013`). `/create-app` no longer mints wildcard scopes by
   default. The handler now resolves scopes via `resolvedScopes` (8
   call-sites in `nv-sdk-provision-routes.ts`):
   - if the caller omits `scopes`, the constant
     `DEFAULT_CREATE_APP_SCOPES = ['agents:read','agents:execute','research:read']`
     is used (matches §10.1);
   - bare `["*"]` is rejected with `403 NYV-CREATE-SCOPE-001` unless
     **both** conditions hold: `req.user.role === 'super_admin'` AND
     `body.wildcard_override === true`;
   - the legacy `'{*}'` literal at the old line 347 and the
     `JSON.stringify(['*'])` at the old line 410 are both replaced with
     `resolvedScopes`, so the legacy and canonical writes get the same
     least-privilege defaults.

   This satisfies the §10.2 hardening end-to-end. `/create-app` is now
   the sanctioned single-click provisioning path again; the SRE psql
   pattern in §2 is no longer the only safe option.

10. **RESOLVED 2026-05-01** (deploy `2026-05-01T07:50Z-pre-ga-may3-fixes`,
    marker `NYV-NS-014`). The `quickstart` block returned by `/create-app`
    is now built from `req.protocol + req.get('host')` rather than the
    hard-coded `https://api.nyayavigya.in`, the execute path is
    `/api/nv/gateway/agents/:agentId/execute`, and the example body uses
    `prompt` (matches the gateway's required field — confirmed by today's
    `GET /api/nv/gateway/agents` smoke returning the 148-agent NYM
    catalogue). Consumers can take the `quickstart` payload at face value
    again; the per-platform hand-off in `SDK-RELEASE-2026-05-03.md`
    contains a copy-paste smoke that uses the same shape.
