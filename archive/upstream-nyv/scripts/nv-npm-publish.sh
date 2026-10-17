#!/usr/bin/env bash
# nv-npm-publish.sh — publish all 6 @nyayavigya/* SDK packages to npmjs.org
#
# Requires: NPM_TOKEN env var with publish rights on the @nyayavigya org.
# Optional: DRY_RUN=1 to add `--dry-run` (validates tarball + auth without uploading).
#
# Order matters: types first (others depend on it), then leaf packages.
set -euo pipefail

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "ERROR: NPM_TOKEN is not set. Add it to Replit Secrets and re-run." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_ROOT/packages/_dist-2026-05-09"
NPMRC="$REPO_ROOT/.npmrc.publish"

cleanup() { rm -f "$NPMRC"; }
trap cleanup EXIT

cat > "$NPMRC" <<EOF
//registry.npmjs.org/:_authToken=$NPM_TOKEN
registry=https://registry.npmjs.org/
always-auth=true
EOF
chmod 600 "$NPMRC"

DRY_FLAG=""
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  DRY_FLAG="--dry-run"
  echo "── DRY RUN mode (no upload) ──"
fi

# Order: types is depended on by client-sdk + react-hooks + enterprise-sdk.
TARBALLS=(
  "nyayavigya-types-5.0.0.tgz"
  "nyayavigya-client-sdk-5.0.0.tgz"
  "nyayavigya-enterprise-sdk-5.0.0.tgz"
  "nyayavigya-react-hooks-5.0.0.tgz"
  "nyayavigya-client-sdk-react-native-5.0.0.tgz"
  "nyayavigya-nyayamitra-sdk-5.0.0.tgz"
)

WHO=$(npm --userconfig "$NPMRC" whoami 2>&1 || true)
echo "── npm whoami: $WHO ──"

FAILED=()
for tarball in "${TARBALLS[@]}"; do
  path="$DIST/$tarball"
  if [[ ! -f "$path" ]]; then
    echo "SKIP missing: $path"
    FAILED+=("$tarball:missing")
    continue
  fi
  echo ""
  echo "── publishing $tarball ──"
  if npm --userconfig "$NPMRC" publish "$path" --access public $DRY_FLAG 2>&1; then
    echo "  ✓ ok"
  else
    echo "  ✗ FAILED"
    FAILED+=("$tarball:publish-failed")
  fi
done

echo ""
echo "──────────── publish summary ────────────"
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "ALL ${#TARBALLS[@]} PACKAGES PUBLISHED OK"
  exit 0
else
  echo "FAILED:"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
  exit 1
fi
