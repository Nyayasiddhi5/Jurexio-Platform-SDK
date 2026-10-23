#!/usr/bin/env bash
# Import Chairman rebuilt spec pack into jurexio-specs/ (preserve CTO adoption tooling).
set -euo pipefail
PACK="${1:?Usage: jrx-import-spec-pack.sh /path/to/extracted/jurexio-specs or zip}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/jurexio-specs"
TMP=""
if [[ -f "$PACK" && "$PACK" == *.zip ]]; then
  TMP=$(mktemp -d)
  unzip -q -o "$PACK" -d "$TMP"
  PACK=$(find "$TMP" -type d -name jurexio-specs | head -1)
fi
[[ -d "$PACK/registry" ]] || { echo "No registry in $PACK"; exit 1; }

cp -a "$PACK/specs/." "$DEST/specs/"
cp -a "$PACK/registry/schema/." "$DEST/registry/schema/"
for f in events.json gates.json permissions.json constants.json interface-contracts.json; do
  cp "$PACK/registry/$f" "$DEST/registry/$f"
done
cp "$PACK/README.md" "$DEST/README.md"
mkdir -p "$DEST/.cursor/rules"
cp "$PACK/.cursor/rules/jurexio-specs.mdc" "$DEST/.cursor/rules/jurexio-specs.mdc" 2>/dev/null || true

cd "$ROOT"
python3 jurexio-specs/registry/adopt_registry_v1.py
python3 jurexio-specs/registry/apply_chairman_rulings_2026-10-22.py
python3 jurexio-specs/registry/validate.py
echo "Import + adopt + chairman rulings OK"
