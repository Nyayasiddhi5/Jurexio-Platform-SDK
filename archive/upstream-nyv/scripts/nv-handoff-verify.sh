#!/usr/bin/env bash
# nv-handoff-verify.sh — structure check for team handoff (no secrets)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MONO="$ROOT/nyayavigya-platform-312"
FAIL=0

ok()  { echo "  OK   $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }

echo "=== Nyayavigya handoff structure verify ==="
echo "Repo root: $ROOT"

# Required root docs
for f in AGENTS.md CHANGELOG.md Project-Tracker.md README.md guardrails.md; do
  [[ -f "$ROOT/$f" ]] && ok "$f" || bad "missing $f"
done

# Active docs
for f in DOCUMENT-INDEX.md TEAM-HANDOFF-PACKAGE.md DEVELOPER-ONBOARDING.md SECRETS-SETUP.md ENV-VARIABLES-REFERENCE.md PLATFORM-STATUS.md; do
  [[ -f "$ROOT/documents/working/$f" ]] && ok "documents/working/$f" || bad "missing documents/working/$f"
done

# Monorepo runtime
for d in src client packages shared scripts tests migrations config; do
  [[ -d "$MONO/$d" ]] && ok "nyayavigya-platform-312/$d/" || bad "missing nyayavigya-platform-312/$d/"
done

# Env templates (no secrets)
for f in .env.example .env.local.example deploy/.env.aws-dev.example; do
  [[ -f "$MONO/$f" ]] && ok "nyayavigya-platform-312/$f" || bad "missing $f"
done

# Should NOT exist in active tree
for p in attached_assets WIP docstotrack all_files.txt all_services.txt artifacts exports docs sdk; do
  [[ ! -e "$ROOT/$p" ]] && ok "archived/missing root $p" || bad "clutter still at root: $p"
done

# SDK dist layout
[[ -d "$MONO/sdk-dist/v5.0.0" ]] && ok "sdk-dist/v5.0.0/" || bad "missing sdk-dist/v5.0.0 (run npm run publish:sdk:dist)"
[[ -L "$MONO/sdk-dist/current" || -d "$MONO/sdk-dist/current" ]] && ok "sdk-dist/current" || bad "missing sdk-dist/current symlink"

# GitHub remote
if git -C "$ROOT" remote get-url origin 2>/dev/null | grep -q 'github.com'; then
  ok "git remote origin → GitHub"
else
  bad "origin is not GitHub (expected github.com/nyayavigya/platform-312)"
fi

[[ ! -d "$MONO/documents/working" ]] && ok "no duplicate inner documents/working" || bad "duplicate nyayavigya-platform-312/documents/working still exists"
[[ ! -d "$MONO/dumps" ]] && ok "no inner dumps/" || bad "inner dumps/ still present"
[[ ! -d "$MONO/audit" ]] && ok "no inner audit/" || bad "inner audit/ still present"

# Archive present
[[ -d "$ROOT/archive/2026-07-handoff-cleanup" ]] && ok "archive/2026-07-handoff-cleanup" || bad "missing handoff archive"

# Secrets must stay gitignored
if git -C "$ROOT" check-ignore -q .local/secrets 2>/dev/null || [[ ! -d "$ROOT/.local/secrets" ]]; then
  ok ".local/secrets gitignored or absent"
else
  bad ".local/secrets exists and is NOT gitignored"
fi

echo "---"
if [[ $FAIL -eq 0 ]]; then
  echo "PASS — structure ready for handoff"
  exit 0
else
  echo "FAIL — fix items above before sharing"
  exit 1
fi
