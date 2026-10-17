#!/bin/bash
# nv-check-api-contract.sh — NYV-API-CONTRACT-001 (2026-05-10)
# Bash wrapper around scripts/jrx-check-api-contract.ts so it joins the
# existing nv-check guardrail family (auth-header, script-db).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec npx tsx "$DIR/scripts/jrx-check-api-contract.ts"
