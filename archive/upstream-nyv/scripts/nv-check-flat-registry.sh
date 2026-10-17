#!/usr/bin/env bash
# NV-AGENT-REGISTRY-FRESH-001 (task-143, 2026-05-11)
#
# Guardrail: the merged flat agent registry at
#   src/data/jrx-agents-registry.json
# must be in sync with the seven per-jurisdiction sources at
#   config/agent-registries/Nyayavigya-Legal-registry-{Default,IN,UK,US,GC,EU,SG}.json
#
# The flat file is consumed by `scripts/jrx-seed-agents.ts` to populate the
# `nv_agents` table at deploy time. If a contributor edits a per-jurisdiction
# registry but forgets to re-run `scripts/jrx-build-flat-registry.ts`, the
# seeded table silently drifts from the runtime registry.
#
# This guardrail rebuilds the flat file into a temp location and diffs the
# *agents array* against the committed file. The `metadata.generatedAt`
# field (date-only) is intentionally ignored so a stale committed date does
# not fail CI on its own.
#
# Run locally:  bash scripts/jrx-check-flat-registry.sh
# CI:           npm run guardrail:flat-registry
# Fix:          npx tsx scripts/jrx-build-flat-registry.ts && git add src/data/jrx-agents-registry.json

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMMITTED="src/data/jrx-agents-registry.json"
TMP_OUT="$(mktemp -t nv-flat-registry.XXXXXX.json)"
trap 'rm -f "$TMP_OUT"' EXIT

if [ ! -f "$COMMITTED" ]; then
  echo "  ✗ $COMMITTED is missing. Run: npx tsx scripts/jrx-build-flat-registry.ts"
  exit 1
fi

echo "[guardrail NV-AGENT-REGISTRY-FRESH-001] rebuilding flat registry to compare…"

# Rebuild into a temp file by overriding the output path inside a child node
# process. We re-use the canonical builder so there is exactly one merge
# implementation in the repo.
NV_FLAT_REGISTRY_OUT="$TMP_OUT" npx tsx scripts/jrx-build-flat-registry.ts >/dev/null

# Diff only the canonical content (agents array + source counts/total),
# ignoring the date-only `generatedAt` stamp.
DIFF=$(node -e '
  const fs = require("fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
  const b = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
  const norm = (o) => ({
    sourceCounts: o?.metadata?.sourceCounts ?? null,
    totalAgents: o?.metadata?.totalAgents ?? null,
    sourceFormat: o?.metadata?.sourceFormat ?? null,
    agents: o?.agents ?? [],
  });
  const x = JSON.stringify(norm(a));
  const y = JSON.stringify(norm(b));
  if (x !== y) {
    process.stdout.write("DRIFT");
  }
' "$COMMITTED" "$TMP_OUT")

if [ "$DIFF" = "DRIFT" ]; then
  echo ""
  echo "  ✗ $COMMITTED is out of date relative to config/agent-registries/*.json."
  echo ""
  echo "    The merged flat registry is auto-generated. Re-run the builder and"
  echo "    commit the result:"
  echo ""
  echo "      cd nyayavigya-platform-312"
  echo "      npx tsx scripts/jrx-build-flat-registry.ts"
  echo "      git add src/data/jrx-agents-registry.json"
  echo ""
  echo "    See replit.md § Gotchas (NV-AGENT-REGISTRY-FRESH-001)."
  exit 1
fi

echo "  ✓ flat agent registry is in sync with per-jurisdiction sources"
exit 0
