# NSP + JRX API Key Operations SOP (2026-09-16)

> **NV-SECRETS-001:** This document lists key **names**, storage **paths**, and **process** only. **No secret values.** Hand off values via Bitwarden / 1Password — never chat, email, or git.  
> **NV-DEMO-SESSION-001 / NV-NO-KEY-ROTATION-DEV-001:** Do not fetch keys from SSM, rotate, or overwrite EC2 canonical env without explicit user **GO** naming the key.

---

## 1. Key names (seven ecosystem platforms)

| Env var (canonical) | Platform SKU | Product |
|---------------------|--------------|---------|
| `NYV_SDK_KEY_NSP` | NSP | Nyayasiddhi Professional™ |
| `NYV_SDK_KEY_NSPM` | NSPM | Nyayasiddhi Professional Mobile™ |
| `NYV_SDK_KEY_NSI` | NSI | Nyayasiddhi Institutional™ |
| `NYV_SDK_KEY_NSA` | NSA | Nyayasiddhi Academy™ |
| `NYV_SDK_KEY_NSM` | NSM | Nyayasiddhi Ministry™ |
| `NYV_SDK_KEY_NYM` | NYM | Nyayamitra™ |
| `NYV_SDK_KEY_JRX` | JRX | JurisX™ |

Optional shared alias during integration E2E: `NYV_SDK_KEY_SHARED` (mirrors per-platform keys via `scripts/nv-sync-shared-sdk-keys.sh` — production cutover only).

**Handover stamps (no values):** `documents/working/NSP-API-KEYS-HANDOVER.md`

---

## 2. Canonical storage locations

| Layer | Path | Purpose |
|-------|------|---------|
| **Production runtime** | `/opt/Nyayavigya/secrets/.env.production` on nysdev (`i-0df71e5ea1df8f588`) | Plaintext bootstrap for gateway/console at container boot |
| **Restore snapshot** | `/opt/Nyayavigya/secrets/LAST_GOOD.env` | Zero-risk restore — same keys, no rotation |
| **SDK auth primary (runtime)** | Postgres `public.sdk_applications` + `public.sdk_app_api_keys` | SHA-256 hashed keys; prefix/last4 metadata only in DB |
| **Env → DB sync** | `src/services/nv-env-sdk-key-sync.ts` (NV-ENV-KEY-SYNC-001) | Gateway boot mirrors existing `NYV_SDK_KEY_*` env into DB hashes |
| **Local mirror (optional)** | `.local/secrets/runtime.env` | One-time pull: `bash nyayavigya-platform-312/scripts/nv-pull-ec2-sdk-keys.sh` |
| **Demo bundle (optional)** | `.local/secrets/demo-keys-20260821.env` | Frozen demo session — do not delete |
| **Deploy AWS creds** | `product Documents/env.production` | SSM/S3 deploy only — **not** SDK keys |

---

## 3. How keys authenticate (per request — not rotation)

Partners send the **same long-lived key** on every API call until an operator explicitly rotates it.

**Primary header:**

```http
X-API-Key: nyv_live_sk_<platform>_...
```

**Fallback:**

```http
Authorization: Bearer nyv_live_sk_<platform>_...
```

**Request path:**

1. `extractSdkApiKey()` reads `X-API-Key` or Bearer `nyv_*` (`src/middleware/nv-sdk-auth-header.js`).
2. `sdkGatewayAuth` hashes the presented key and matches against `sdk_app_api_keys.hashed_key` joined to `sdk_applications`.
3. On match: `sdkContext` (partner code, tenant, scopes, rate limits) is bound for the request.
4. On miss: **401** `API_KEY_INVALID` — no partial auth.

**This is per-request validation, not per-request key generation.** Rate limits apply per key/app; rotating keys is a separate admin action.

**Console JWT routes** (`/api/nv/enterprise/*`, RBAC admin) use Bearer JWT — **not** `X-API-Key`. Do not confuse 401 on JWT routes with SDK key failure.

---

## 4. Rotation policy

| Action | Policy |
|--------|--------|
| Rotate any `NYV_SDK_KEY_*` on nysdev | Explicit user **GO** naming the key (NV-NO-KEY-ROTATION-DEV-001) |
| Fetch keys from SSM Parameter Store | **Forbidden** during demo session (NV-DEMO-SESSION-001) |
| Edit `/opt/Nyayavigya/secrets/.env.production` | Explicit **GO** only |
| `docker volume prune` / delete secrets dir | Run `npm run protect:secrets:ec2` first; explicit **GO** |
| Frequency | Keys are **long-lived**; ops adjusts **rate limits**, not key rotation, for traffic control |

After any approved rotation: update `Project-Tracker.md`, `NSP-API-KEYS-HANDOVER.md` stamp (no values), re-sync DB via gateway boot or `nv-refresh-demo-sdk-bundle.ts`, run `npm run partner:smoke:ec2`.

---

## 5. Provision NEW keys — NYV Admin Console

**Console URL:** `https://console.nyayasiddhi.online`

| Step | UI path | API (JWT auth) |
|------|---------|----------------|
| 1. Login | `/console/login` — requires `super_admin`, `admin`, or `platform_admin` | — |
| 2. Open SDK Hub | `/sdk-hub?tab=keys` (canonical; legacy `/sdk-key-management` redirects here) | — |
| 3. Select platform app | Dropdown lists registered `sdk_applications` rows (NSP, JRX, …) | `GET /api/nv/platforms` |
| 4. Generate key | **Generate SDK Key** modal → choose type `sdk_api_key` | `POST /api/nv/sdk/keys/:appId/generate` |
| 5. Copy once | Raw key shown **once** in modal — store in team secret manager | Response includes plaintext key (single display) |
| 6. Verify | SDK Hub status tab | `GET /api/nv/sdk/keys/:appId/status` |
| 7. EC2 env sync | Operator adds `NYV_SDK_KEY_NSP=` (etc.) to canonical env **with GO** | Gateway boot runs `nv-env-sdk-key-sync` |

**Key types per app (4):** `sdk_api_key`, `webhook_secret`, `publishable_key`, `signing_key` — partners use **`sdk_api_key`** for backend orchestrate/CNR/RAG.

**RBAC:** `platform_admin` may manage keys scoped to their platform; `super_admin` / `admin` global. See `src/services/rbac/rbac-service.ts` — `api-keys` resource grants.

**Code references:**

- UI: `client/src/pages/sdk-key-management.tsx`
- Routes: `src/routes/nv-sdk-keylife-routes.ts`
- Auth middleware: `src/middleware/nv-sdk-gateway-routes.ts`

---

## 6. Verification (no values printed)

```bash
cd nyayavigya-platform-312
source scripts/nv-source-dev-deploy-env.sh   # deploy creds only
npm run demo:probe:ec2                        # SSM on nysdev; reports key_len + HTTP codes
npm run partner:smoke:ec2                     # 7-platform matrix; 0 failures = keys OK
```

**Key lens on EC2 (length only):**

```bash
grep -E '^NYV_SDK_KEY_NSP=' /opt/Nyayavigya/secrets/.env.production | wc -c
# length > 20 → key present; fix probe script if absent, do not re-fetch
```

---

## 7. Related docs

- [`DEMO-SESSION-CREDENTIALS-2026-08.md`](./DEMO-SESSION-CREDENTIALS-2026-08.md)
- [`NSP-API-KEYS-HANDOVER.md`](./NSP-API-KEYS-HANDOVER.md)
- [`PLATFORM-OPS-SOP-NYV-NYS-2026-09.md`](./PLATFORM-OPS-SOP-NYV-NYS-2026-09.md) §2
