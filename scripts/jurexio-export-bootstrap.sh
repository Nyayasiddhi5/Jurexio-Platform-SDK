#!/usr/bin/env bash
# Jurexio-Platform-SDK — curated export from Jurexio (JRX + NYS in-tree).
# Usage: bash scripts/jurexio-export-bootstrap.sh [DEST_DIR]
# Default DEST: sibling ../Jurexio-Platform-SDK of Jurexio-Platform-SDK parent workspace.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$APP_ROOT/.." && pwd)"
DEST="${1:-$WORKSPACE_ROOT/../Jurexio-Platform-SDK}"
DEST="$(cd "$(dirname "$DEST")" && pwd)/$(basename "$DEST")"

JRX_SHA=""
if git -C "$APP_ROOT" rev-parse HEAD >/dev/null 2>&1; then
  JRX_SHA="$(git -C "$APP_ROOT" rev-parse HEAD)"
fi
JRX_ECOSYSTEM_SHA=""
if git -C "$APP_ROOT/jrx-search" rev-parse HEAD >/dev/null 2>&1; then
  JRX_ECOSYSTEM_SHA="$(git -C "$APP_ROOT/jrx-search" rev-parse HEAD)"
fi

echo "== Jurexio export =="
echo "source_nyv=$APP_ROOT"
echo "dest=$DEST"
echo "nyv_sha=${JRX_SHA:-unknown}"
echo "nys_sha=${JRX_ECOSYSTEM_SHA:-unknown}"

mkdir -p "$DEST"

RSYNC_EXCLUDES=(
  --exclude '.git'
  --exclude '.local'
  --exclude 'node_modules'
  --exclude 'dist'
  --exclude 'client/dist'
  --exclude 'dist-sdk'
  --exclude 'packages/_dist-*'
  --exclude 'uat-reports'
  --exclude 'test-results'
  --exclude 'playwright-report'
  --exclude 'playwright/.cache'
  --exclude '.cache'
  --exclude 'tmp'
  --exclude 'graphify-out'
  --exclude 'dumps'
  --include '.env.local.example'
  --exclude '.env'
  --exclude '.env.*'
  --exclude '*.pem'
  --exclude '*.key'
  --exclude '.DS_Store'
  --exclude 'audit/smoke-*.json'
  --exclude 'docs/audit/dashboard-audit-*'
  --exclude 'jrx-search/node_modules'
  --exclude 'jrx-search/artifacts/api-server/dist'
  --exclude 'jrx-search/artifacts/nys-agentic-ai/dist/public'
  --exclude 'jrx-search/.git'
)

rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$APP_ROOT/" "$DEST/"

EXPORT_STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
mkdir -p "$DEST/documents/working"

cat > "$DEST/documents/working/JUREXIO-FORK-LINEAGE.md" <<EOF
# Jurexio Platform SDK — fork lineage

| Field | Value |
|---|---|
| Export UTC | $EXPORT_STAMP |
| Source tree | \`Jurexio-Platform-SDK/\` (Jurexio workspace) |
| JRX git SHA | \`${JRX_SHA:-unknown}\` |
| NYS nested SHA | \`${JRX_ECOSYSTEM_SHA:-unknown}\` |
| Scope | **JRX + NYS** (gateway + knowledge worker in one product repo) |
| API prefix target | \`/api/jrx/\` (replace Jurexio \`/api/jrx/\` in Phase 2) |
| SDK scope | All Jurexio Platform AI tasks (orchestration, legal intel, knowledge plane) |
| Enterprise UI | Jurexio-branded console (NSP-analog partners later) — Phase 3+ |

Jurexio production remains in the original repo; this tree diverges independently.
Secrets were **not** copied — provision new \`.env\` / deploy keys for Jurexio only.
EOF

cat > "$DEST/documents/working/JUREXIO-PLATFORM-ARCHITECTURE-2026-10.md" <<'EOF'
# Jurexio Platform SDK — architecture (v1)

## Product map (from Jurexio dual-project)

| Tag | Tree | Role |
|---|---|---|
| **JRX-CORE** | Repo root (former `Jurexio-Platform-SDK`) | Gateway, `@jurexio/*` SDKs (rename pending), orchestration, partner API |
| **JRX-KNOWLEDGE** | `jrx-search/` | Caselaw/statutes retrieve, NyayaSearch-class dashboard (rebrand to Jurexio Knowledge) |

Federation pattern unchanged: gateway knowledge routes call worker `/api/*` over HTTPS with machine API key.

## API surface

- **Target prefix:** `/api/jrx/v1/...` (SDK, orchestrate, CNR, legal-work, knowledge adapters).
- **Phase 2 work:** alias or migrate from `/api/jrx/v1/` — do not break JRX production; Jurexio deploys on separate hosts/domains.

## SDK consumers

- Jurexio Platform apps (future enterprise dashboard) call gateway with server-side API key — same trust model as NSP BFF.
- Package rename: `@nyayavigya/*` → `@jurexio/*` (semver reset 1.0.0).

## Roadmap

1. **Now:** Curated export, clean install, preflight smoke.
2. **Phase 2:** `/api/jrx/` routing + SDK scope rename + env/domain (`jurexio.*`).
3. **Phase 3:** Jurexio Enterprise Console (fork of JRX Console UX, Jurexio brand).
4. **Phase 4:** Partner handoff docs (Jurexio-analog of NSP integration pack).

See `JUREXIO-FORK-LINEAGE.md` for export stamp.
EOF

if [ ! -f "$DEST/AGENTS.md" ]; then
  cp "$WORKSPACE_ROOT/AGENTS.md" "$DEST/AGENTS.md" 2>/dev/null || cp "$APP_ROOT/../AGENTS.md" "$DEST/AGENTS.md" 2>/dev/null || true
fi

cat > "$DEST/Project-Tracker.md" <<EOF
# Jurexio Platform SDK — Project Tracker

> Forked from Jurexio — see \`documents/working/JUREXIO-FORK-LINEAGE.md\`.

## Change log (newest first)

| $EXPORT_STAMP | DONE | Cursor Agent | JRX-EXPORT-001 | Initial curated export (JRX+NYS, no node_modules/secrets/git). | \`scripts/jurexio-export-bootstrap.sh\` |
EOF

cat > "$DEST/CHANGELOG.md" <<EOF
# Jurexio Platform SDK — Changelog

## [Unreleased]

### Added — JRX-EXPORT-001 ($EXPORT_STAMP)

- Curated export from Jurexio \`Jurexio-Platform-SDK\` + in-tree \`jrx-search\`.
- Architecture + lineage docs under \`documents/working/\`.
EOF

if [ ! -d "$DEST/.git" ]; then
  git -C "$DEST" init -b main
  echo "git_init=main"
fi

FILE_COUNT="$(find "$DEST" -type f | wc -l | tr -d ' ')"
DEST_SIZE="$(du -sh "$DEST" | awk '{print $1}')"
echo "export_done files=$FILE_COUNT size=$DEST_SIZE"
echo "next: cd \"$DEST\" && pnpm install (root) && cd jrx-search && pnpm install"
