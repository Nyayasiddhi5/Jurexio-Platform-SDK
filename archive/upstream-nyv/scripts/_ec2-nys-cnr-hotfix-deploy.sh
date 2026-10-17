#!/usr/bin/env bash
# Patch-deploy NYS CNR fixes to caselaw-worker when local esbuild is unavailable.
# Uploads modified sources + rebuilds index.mjs on-worker, restarts nyv-api.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

CNR_RESOLVE="$ROOT/jrx-search/artifacts/api-server/src/lib/cnrResolve.ts"
RDS_POOL="$ROOT/jrx-search/artifacts/api-server/src/lib/rdsPool.ts"
CNR_ROUTES="$ROOT/jrx-search/artifacts/api-server/src/routes/cnr.ts"
INDEX_TS="$ROOT/jrx-search/artifacts/api-server/src/index.ts"
BUILD_MJS="$ROOT/jrx-search/artifacts/api-server/build.mjs"

for f in "$CNR_RESOLVE" "$RDS_POOL" "$CNR_ROUTES" "$INDEX_TS" "$BUILD_MJS"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done

b64file() {
  if base64 -w0 "$1" >/dev/null 2>&1; then base64 -w0 "$1"; else base64 < "$1" | tr -d '\n'; fi
}

B64_CNR=$(b64file "$CNR_RESOLVE")
B64_POOL=$(b64file "$RDS_POOL")
B64_CNRRT=$(b64file "$CNR_ROUTES")
B64_IDX=$(b64file "$INDEX_TS")
B64_BUILD=$(b64file "$BUILD_MJS")

REMOTE=$(cat <<REMOTE_EOF
set -euo pipefail
PATCH_DIR=/opt/nyv/api/_cnr-patch-$(date +%s)
mkdir -p "\$PATCH_DIR/src/lib" "\$PATCH_DIR/src/routes"
echo "$B64_CNR" | base64 -d > "\$PATCH_DIR/src/lib/cnrResolve.ts"
echo "$B64_POOL" | base64 -d > "\$PATCH_DIR/src/lib/rdsPool.ts"
echo "$B64_CNRRT" | base64 -d > "\$PATCH_DIR/src/routes/cnr.ts"
echo "$B64_IDX" | base64 -d > "\$PATCH_DIR/src/index.ts"
echo "$B64_BUILD" | base64 -d > "\$PATCH_DIR/build.mjs"
cd "\$PATCH_DIR"
# Worker may have monorepo checkout or only dist — try esbuild bundle from uploaded sources
if [ -d /opt/nyv/api/node_modules/esbuild ]; then
  node build.mjs 2>&1 | tail -5
  if [ -f dist/index.mjs ]; then
    cp dist/index.mjs /opt/nyv/api/index.mjs
    echo "PATCHED index.mjs md5=\$(md5sum /opt/nyv/api/index.mjs | awk '{print \$1}')"
    systemctl restart nyv-api.service
    sleep 3
    curl -sS -m 10 -o /dev/null -w "healthz http=%{http_code}\n" http://127.0.0.1:8080/healthz
  else
    echo "BUILD FAILED — no dist/index.mjs"
    exit 1
  fi
else
  echo "NO esbuild on worker — manual deploy required"
  exit 2
fi
REMOTE_EOF
)

if base64 -w0 <<< "$REMOTE" >/dev/null 2>&1; then
  RB64=$(printf '%s' "$REMOTE" | base64 -w0)
else
  RB64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
fi

CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "i-000115b19219bb766" \
  --document-name AWS-RunShellScript \
  --comment "nys-cnr-hotfix-deploy" \
  --parameters "commands=[\"echo $RB64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "NYS SSM=$CMD_ID"
for _ in $(seq 1 120); do
  st=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "i-000115b19219bb766" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 5 ;; esac
done

aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "i-000115b19219bb766" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text
