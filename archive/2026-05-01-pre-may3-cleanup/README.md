---
status: archived
archived_at: 2026-05-01T16:00Z
archived_by: pre-May-3 GA cleanup
---

# Pre-May-3 cleanup archive (2026-05-01)

These files were moved out of the live tree on 2026-05-01 because they were
stale, buggy, or had been superseded by the actual deploy path used in the
SDK-RELEASE-2026-05-03 ship. Nothing here is loaded or referenced by the
running platform.

## Contents

### `scripts/deploy-replit-direct.sh`
SSH-based Replit→EC2 deploy wrapper. Replit has no SSH key for EC2 in this
container, so the documented `pnpm deploy` path that this script implements
never actually worked from Replit. The path used today is
`scripts/deploy-replit-ssm.sh` (S3 + SSM/base64). Kept for reference because
the script's preflight, lockfile, and rollback logic is sound and worth
porting once the SSH key is added.

### `scripts/build-all-sdks.sh`
Bitbucket-CI-era SDK builder. Two known issues that surfaced during the
May-3 ship:

1. Hard-codes a 4-package list (`types client-sdk react-hooks enterprise-sdk`)
   that misses `nyayamitra-sdk` and `client-sdk-react-native` — the two
   packages we had to build manually on May 1.
2. Uses `npm install --silent` which masks ERESOLVE failures. The
   `react-hooks` package has a real peer-dep conflict
   (`@testing-library/react@^14` peer requires React 18, devDep is React 19)
   that this script silently swallows.

Replaced by per-package `pnpm --filter @nyayavigya/<pkg> build && pnpm pack`
which fails loudly. The peer-dep fix itself is still pending — see
the pre-May-3 status doc, "Replit pending" item (b).

### `scripts/nv-publish-sdk-tarballs.ts`
S3 publisher that hard-codes the same wrong package list as
`build-all-sdks.sh` (only 3 packages) and points at a default bucket name
(`nyv-sdk-distribution`) that does not match the actual bucket
(`nyayavigya-sdk-devapp`). The May-3 ship used direct `aws s3 cp` instead.
Kept here as the seed for a proper rewrite once the package list is
single-sourced from `pnpm -r ls --depth -1`.

### `docs/Project-Tracker-Nyayavigya-SDK-312.md`
Self-marked as SUPERSEDED on its very first line — the canonical project
tracker is `Project-Tracker.md` at the repo root. Kept here as the
April-13 sprint snapshot.

## Restore

```bash
mv archive/2026-05-01-pre-may3-cleanup/scripts/<file> scripts/
mv archive/2026-05-01-pre-may3-cleanup/docs/<file> ./
```
