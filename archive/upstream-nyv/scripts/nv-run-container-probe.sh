#!/usr/bin/env bash
# Generate an SSM-runnable script that ships a local .cjs probe into nyv-gateway:/app
# and runs it there. Usage:
#   bash scripts/jrx-run-container-probe.sh scripts/_nv-foo-probe.cjs "label"
#
# Why: /app is ESM (so .cjs for require), curl is absent inside nyv-gateway, and a
# script under /tmp cannot resolve node modules — copying into /app avoids all three.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROBE="${1:?usage: nv-run-container-probe.sh <local .cjs probe> [label]}"
LABEL="${2:-container-probe}"
[[ -f "$PROBE" ]] || { echo "missing probe: $PROBE" >&2; exit 1; }

if printf '' | base64 -w0 >/dev/null 2>&1; then
  B64=$(base64 -w0 < "$PROBE")
else
  B64=$(base64 < "$PROBE" | tr -d '\n')
fi

GEN=".local/_ec2-run-${LABEL//[^a-zA-Z0-9_-]/_}.sh"
mkdir -p .local
cat > "$GEN" <<EOF
#!/usr/bin/env bash
set -uo pipefail
OUT=/tmp/probe-${LABEL//[^a-zA-Z0-9_-]/_}.txt
echo "$B64" | base64 -d > /tmp/_probe.cjs
echo "probe_bytes=\$(wc -c < /tmp/_probe.cjs)"
docker cp /tmp/_probe.cjs nyv-gateway:/app/_nv-probe.cjs
docker exec nyv-gateway node /app/_nv-probe.cjs > "\$OUT" 2>&1
rc=\$?
docker exec nyv-gateway rm -f /app/_nv-probe.cjs
rm -f /tmp/_probe.cjs
echo "probe_exit=\$rc out_bytes=\$(wc -c < "\$OUT")"
cat "\$OUT"
EOF

bash scripts/jrx-ec2-ssm-run.sh "$GEN" "$LABEL"
