#!/bin/bash
# nv-check-no-new-orphans.sh — NYV-WIRING-BUDGET-001 (2026-05-10)
# Bash wrapper around scripts/jrx-check-no-new-orphans.ts.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec npx tsx "$DIR/scripts/jrx-check-no-new-orphans.ts"
