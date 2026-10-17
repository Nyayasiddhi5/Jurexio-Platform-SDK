---
status: active
version: 3.1.2
audience: Platform engineers, SDK consumers, devops
last_verified: 2026-04-25
---

# Signed-URL SDK Download Endpoint

The gateway exposes a small route group at `/downloads/sdk/*` that serves
SDK tarballs from S3 via short-lived presigned URLs. It is mounted **outside**
`/api/nv/*` so the existing SDK API key rate limiter does not apply.

## Endpoints

| Method | Path | Auth | Returns |
|---|---|---|---|
| `GET`  | `/downloads/sdk/health`                       | none | JSON config (bucket, prefix, TTL, auth modes, allowed packages) |
| `GET`  | `/downloads/sdk/manifest.json`                | none | JSON list of `{ package, versions[], latest }` for every allowed package |
| `HEAD` | `/downloads/sdk/<package>/<version>.tgz`      | optional | `200` + size/etag if exists, `404` otherwise |
| `GET`  | `/downloads/sdk/<package>/<version>.tgz`      | configurable | `302` redirect to a presigned S3 URL valid for `NYV_SDK_DOWNLOAD_TTL_SECONDS` (default 300) |

### Allowed packages
- `client-sdk`              → `@nyayavigya/client-sdk` (browser)
- `client-sdk-react-native` → `@nyayavigya/client-sdk-react-native`
- `nyayamitra-sdk`          → `@nyayavigya/nyayamitra-sdk`

The package allowlist is hard-coded in `src/routes/nv-sdk-downloads-routes.ts`
(`ALLOWED_PACKAGES`); add a new package there before publishing it.

### Version format
Strict semver-ish: `MAJOR.MINOR.PATCH` with optional `-prerelease` or
`+build` suffix. Anything else is rejected with `400 invalid_version`.

## Auth modes

Configured by env vars on the gateway. Multiple modes can be enabled at once;
the first that matches lets the request through.

| Env | Default | Behavior |
|---|---|---|
| `NYV_SDK_DOWNLOADS_PUBLIC` | `true` | If `true`, no auth required (anyone can pull tarballs). Set to `false` for private distribution. |
| `NYV_SDK_DOWNLOAD_TOKEN` | _unset_ | If set, accept `?token=<value>` as a static download token. |
| `NYV_SDK_DOWNLOAD_HMAC_SECRET` (or falls back to `JWT_SECRET`) | falls back to `JWT_SECRET` | If set, accept `?exp=<unix-ts>&sig=<hex>` HMAC-signed URLs. Compute as `HMAC-SHA256(secret, "<package>\n<version>\n<exp>")`. |
| (always) | — | An `Authorization: Bearer nyv_*` header (or `X-Api-Key: nyv_*`, or `?api_key=nyv_*`) is treated as an authenticated request. |

For initial rollout `NYV_SDK_DOWNLOADS_PUBLIC=true` is the simplest. Lock it
down later by setting it to `false` and either distributing
`NYV_SDK_DOWNLOAD_TOKEN` to client teams or signing per-link URLs with the
HMAC secret.

## S3 layout

```
s3://<NYV_SDK_BUCKET>/<NYV_SDK_BUCKET_PREFIX>
  manifest.json
  client-sdk/3.1.2.tgz
  client-sdk/6.0.0.tgz
  client-sdk-react-native/1.0.0.tgz
  nyayamitra-sdk/1.0.0.tgz
```

Defaults: bucket `nyv-sdk-distribution`, prefix `sdk/`, region `ap-south-1`.

The bucket should have:
- Default SSE-AES256 enabled (the route + uploader request it explicitly too).
- No public read ACLs — the only way to fetch a tarball is the gateway-issued
  presigned URL (or, if you flip the bucket policy, direct S3 GetObject with
  IAM credentials).
- Lifecycle: optional, expire pre-release versions after N days.

## Publishing tarballs

```
# all three packages, version from each package.json
npx tsx scripts/nv-publish-sdk-tarballs.ts

# one package, explicit version
npx tsx scripts/nv-publish-sdk-tarballs.ts --package client-sdk --version 3.1.2

# rebuild even if a matching .tgz already exists locally
npx tsx scripts/nv-publish-sdk-tarballs.ts --rebuild

# show what would happen without uploading
npx tsx scripts/nv-publish-sdk-tarballs.ts --dry-run
```

The script:
1. Looks for an existing `*-<version>.tgz` in `packages/<pkg>/`.
2. If not found (or `--rebuild`), runs `npm pack` in the package directory.
3. Uploads to `s3://<bucket>/<prefix><pkg>/<version>.tgz` with SSE-AES256 and
   a `Content-Disposition: attachment` header.
4. Re-walks the bucket and rewrites `<prefix>manifest.json`.

AWS creds are read from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` if
present, otherwise the SDK falls through to the EC2 instance role.

## Consumer install

```
# Newest version (resolve via manifest)
LATEST=$(curl -s https://api.nyayasiddhi.online/downloads/sdk/manifest.json \
  | jq -r '.packages[] | select(.package=="client-sdk") | .latest')

curl -L -o nv-sdk.tgz \
  https://api.nyayasiddhi.online/downloads/sdk/client-sdk/${LATEST}.tgz

npm install ./nv-sdk.tgz
```

For private distribution, add `?token=…` (static) or `?exp=…&sig=…` (HMAC) to
the URL.

## Operations

- 502 `s3_unavailable` / `presign_failed` ⇒ either the bucket doesn't exist,
  the gateway has no IAM access, or `NYV_S3_REGION` is wrong.
- 404 `version_not_found` ⇒ run the publish script for that version.
- HEAD results are cached in-memory for 60s to keep the hot path off S3.
- The `manifest.json` route is cached the same way and includes a
  `Cache-Control: public, max-age=60`.
- All `GET` redirects emit a structured `sdk_download_redirect` log line with
  `pkg`, `version`, `bytes`, `via` (auth mode), `ip`, `user_agent`, and
  `ttl_seconds` for audit.
