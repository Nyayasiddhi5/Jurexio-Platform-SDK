#!/usr/bin/env bash
# NV-SDK-PUBLISH-002 — Build + pack all @nyayavigya/* SDKs into sdk-dist/v5.0.0/
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

SDK_VERSION="$(node -p "require('./packages/client-sdk/package.json').version")"
OUT_DIR="$APP_ROOT/sdk-dist/v${SDK_VERSION}"
ARCHIVE_DIR="$APP_ROOT/sdk-dist/_archive"

PACKAGES=(
  types
  client-sdk
  react-hooks
  enterprise-sdk
  client-sdk-react-native
  nyayamitra-sdk
)

mkdir -p "$OUT_DIR" "$ARCHIVE_DIR"

# Move legacy flat tarballs at sdk-dist root into archive once.
if compgen -G "$APP_ROOT/sdk-dist/"'*.tgz' >/dev/null; then
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$ARCHIVE_DIR/pre-v${SDK_VERSION}-flat-${ts}"
  mv "$APP_ROOT/sdk-dist/"*.tgz "$ARCHIVE_DIR/pre-v${SDK_VERSION}-flat-${ts}/" 2>/dev/null || true
  [[ -f "$APP_ROOT/sdk-dist/SHA256SUMS" ]] && mv "$APP_ROOT/sdk-dist/SHA256SUMS" "$ARCHIVE_DIR/pre-v${SDK_VERSION}-flat-${ts}/" || true
fi

echo "[sdk-dist] building ${#PACKAGES[@]} packages @ ${SDK_VERSION} → ${OUT_DIR}"

for pkg in "${PACKAGES[@]}"; do
  dir="packages/${pkg}"
  [[ -d "$dir" ]] || { echo "missing $dir" >&2; exit 1; }
  ver="$(node -p "require('./${dir}/package.json').version")"
  if [[ "$ver" != "$SDK_VERSION" ]]; then
    echo "[sdk-dist] WARN: @nyayavigya/${pkg} is ${ver}, expected ${SDK_VERSION}" >&2
  fi
  echo "[sdk-dist] ── @nyayavigya/${pkg} ──"
  (
    cd "$dir"
    npm run build
    rm -f "$OUT_DIR"/nyayavigya-"${pkg}"-*.tgz 2>/dev/null || true
    npm pack --pack-destination "$OUT_DIR" >/dev/null
  )
done

(
  cd "$OUT_DIR"
  shasum -a 256 ./*.tgz > SHA256SUMS
)

# Convenience symlink at sdk-dist root for partner docs
ln -sf "v${SDK_VERSION}" "$APP_ROOT/sdk-dist/current"

count="$(ls -1 "$OUT_DIR"/*.tgz 2>/dev/null | wc -l | tr -d ' ')"
echo "[sdk-dist] DONE — ${count} tarballs in ${OUT_DIR}"
cat "$OUT_DIR/SHA256SUMS"
