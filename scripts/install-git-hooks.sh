#!/usr/bin/env bash
# NYV-OPS-PRECOMMIT-001 (2026-05-01)
# One-shot installer for repo git hooks. Idempotent.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
HOOK_DIR="$ROOT/.git/hooks"
SRC_DIR="$(dirname "$0")/git-hooks"

if [ ! -d "$HOOK_DIR" ]; then
  echo "Not a git checkout (no .git/hooks). Aborting."
  exit 1
fi

for src in "$SRC_DIR"/*; do
  name="$(basename "$src")"
  dst="$HOOK_DIR/$name"
  install -m 0755 "$src" "$dst"
  echo "Installed: $dst"
done

echo ""
echo "Pre-commit hook is live. To bypass for an emergency:"
echo "  git commit --no-verify"
echo ""
echo "To make TS errors a hard gate (after NYV-NS-005 lands):"
echo "  export NYV_PRECOMMIT_TSC_BLOCKER=1"
