#!/usr/bin/env bash
# CH-4 / Chairman: module routes must not implement local RBAC — use CommandCentre evaluateAccess.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ALLOWLIST=(
  'src/routes/jrx-platform-access-routes.ts'
  'src/routes/jrx-my-approvals-routes.ts'
)

violations=0
while IFS= read -r file; do
  skip=0
  for a in "${ALLOWLIST[@]}"; do
    [[ "$file" == *"$a" ]] && skip=1 && break
  done
  [[ "$skip" -eq 1 ]] && continue
  if rg -n 'check(Role|Permission)|hasPermission\(|rbacLevel|L[1-9]_ACCESS|tier_rbac' "$file" >/dev/null 2>&1; then
    echo "[central-access] forbidden local RBAC pattern in $file"
    rg -n 'check(Role|Permission)|hasPermission\(|rbacLevel|L[1-9]_ACCESS|tier_rbac' "$file" | head -5
    violations=$((violations + 1))
  fi
done < <(find src/routes -name 'jrx-*-routes.ts' -type f)

if [[ "$violations" -gt 0 ]]; then
  echo "FAILED: $violations route file(s) with local RBAC patterns (use /api/jrx/platform/access/evaluate)"
  exit 1
fi
echo "OK: no local RBAC patterns in module routes (CH-4 spot check)"
