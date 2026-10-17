#!/usr/bin/env bash
# NV-NSP-DOCPARSE-PACK-001 — tarball of full local docparse source for NSP integration.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${ROOT}/.local/nsp-docparse-bundle"
ARCHIVE="${OUT}/nsp-docparse-local-${STAMP}.tar.gz"

mkdir -p "$OUT"
WORK="${OUT}/staging-${STAMP}"
rm -rf "$WORK"
mkdir -p "$WORK/nsp-docparse-local"

copy_tree() {
  local src="$1"
  local dest="$2"
  rsync -a \
    --exclude node_modules \
    --exclude dist \
    --exclude '.vite' \
    "$src/" "$dest/"
}

copy_tree "${ROOT}/packages/docparse-sdk" "${WORK}/nsp-docparse-local/docparse-sdk"
copy_tree "${ROOT}/packages/nsp-docparse" "${WORK}/nsp-docparse-local/nsp-docparse"
mkdir -p "${WORK}/nsp-docparse-local/client-sdk-types"
cp "${ROOT}/packages/client-sdk/src/types/JrxLegalDocparse.ts" \
  "${WORK}/nsp-docparse-local/client-sdk-types/JrxLegalDocparse.ts"
cp "${ROOT}/documents/working/NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md" \
  "${WORK}/nsp-docparse-local/NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md"
cp "${ROOT}/documents/working/NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md" \
  "${WORK}/nsp-docparse-local/NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md" 2>/dev/null || true
cp "${ROOT}/documents/working/NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md" \
  "${WORK}/nsp-docparse-local/NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md"
cp "${ROOT}/documents/working/DOCPARSE-MULTI-DOMAIN-AND-DEPLOYMENT-GUIDE.md" \
  "${WORK}/nsp-docparse-local/DOCPARSE-MULTI-DOMAIN-AND-DEPLOYMENT-GUIDE.md"
cp "${ROOT}/documents/working/DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md" \
  "${WORK}/nsp-docparse-local/DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md"
cp "${ROOT}/documents/working/DOCPARSE-TEXTRACT-BACKUP-ARCHITECTURE-2026-10.md" \
  "${WORK}/nsp-docparse-local/DOCPARSE-TEXTRACT-BACKUP-ARCHITECTURE-2026-10.md"
cp "${ROOT}/../documents/working/NSP-UNIFIED-DOCUMENT-INTELLIGENCE-2026-10.md" \
  "${WORK}/nsp-docparse-local/NSP-UNIFIED-DOCUMENT-INTELLIGENCE-2026-10.md" 2>/dev/null || true
for f in JRX-NSP-DOCPARSE-HANDOFF-TICKETS-2026-10-15.md \
  JRX-NSP-DOCPARSE-OPENAPI-2026-10-15.yaml \
  JRX-NSP-DOCPARSE-SCHEMAS-2026-10-15.json \
  JRX-NSP-DOCPARSE-OPS-RUNBOOK-2026-10-15.md \
  JRX-NSP-DOCPARSE-JOINT-SMOKE-2026-10-15.md \
  NSP-JRX-DOCPARSE-PARTNER-REQUIREMENTS-ONE-PAGER-2026-10-15.md; do
  cp "${ROOT}/documents/working/${f}" "${WORK}/nsp-docparse-local/${f}" 2>/dev/null || true
done

DOCPARSE_SDK_VER="$(node -p "require('${ROOT}/packages/docparse-sdk/package.json').version")"
NSP_VER="$(node -p "require('${ROOT}/packages/nsp-docparse/package.json').version")"

cat > "${WORK}/nsp-docparse-local/BUNDLE-README.md" <<EOF
# NSP DocParse local bundle

Engine: @nyv/docparse-sdk@${DOCPARSE_SDK_VER}
Hybrid: @nyayavigya/nsp-docparse@${NSP_VER}

## Start here (NSP team)

1. Read **NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md** (full feature + UI + bulk jobs).
2. \`cd docparse-sdk && npm install && npm run build && npm test\`
3. \`cd ../nsp-docparse && npm install && npm run build && npm test\`
4. Wire \`NspHybridDocparseClient\` in NSP BFF (see nsp-docparse/README.md).

Optional JRX escalation: \`JRX_SDK_KEY\` + \`nyv.baseUrl\` on hybrid client (BFF only).

Other domains / non-NSP projects: **DOCPARSE-MULTI-DOMAIN-AND-DEPLOYMENT-GUIDE.md**
EOF

tar -czf "$ARCHIVE" -C "$WORK" nsp-docparse-local
rm -rf "$WORK"
echo "Created: $ARCHIVE"
ls -lh "$ARCHIVE"
SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
STAMP_DATE="$(date -u +%Y%m%d)"
MANIFEST="${OUT}/MANIFEST-${STAMP_DATE}.txt"
cat > "$MANIFEST" <<EOF
NSP DocParse local bundle — $(date -u +%Y-%m-%dT%H:%M:%SZ)

File: $(basename "$ARCHIVE")
Also copy as: NSP-DOCPARSE-LOCAL-BUNDLE-${STAMP_DATE}.tar.gz
SHA-256: ${SHA}

Packages:
  docparse-sdk/          @nyv/docparse-sdk@${DOCPARSE_SDK_VER}
  nsp-docparse/          @nyayavigya/nsp-docparse@${NSP_VER}

Docs in tarball:
  NSP-DOCPARSE-TEAM-INTEGRATION-GUIDE.md  ← NSP primary
  NSP-DOCPARSE-LOCAL-FIRST-HANDOFF.md
  NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md
  DOCPARSE-MULTI-DOMAIN-AND-DEPLOYMENT-GUIDE.md
  DOCPARSE-LEGAL-GLOBAL-BEST-STATUS-2026-10.md
  BUNDLE-README.md

Verify: shasum -a 256 $(basename "$ARCHIVE")
EOF
echo "Manifest: $MANIFEST"
echo "SHA-256: $SHA"
cp "$ARCHIVE" "${OUT}/NSP-DOCPARSE-LOCAL-BUNDLE-${STAMP_DATE}.tar.gz"
