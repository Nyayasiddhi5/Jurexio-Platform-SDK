#!/usr/bin/env bash
# Patch canonical EC2 env flags for Bedrock-default cascade. Never prints secret values.
# No gateway restart — caller (deploy) recreates the container.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
[ -f "$CANON" ] || { echo "missing $CANON"; exit 1; }
chmod 600 "$CANON" 2>/dev/null || true

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$CANON" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$CANON"
  else
    echo "${k}=${v}" >> "$CANON"
  fi
  echo "  set ${k}"
}

set_kv NYV_PARTNER_LEGAL_PREMIUM_FIRST 0
set_kv NYV_BEDROCK_REGION_ORDER "us-east-1,ap-south-1"
set_kv AWS_BEDROCK_REGION us-east-1
set_kv NYV_BEDROCK_ENABLED on
set_kv NYV_LEGAL_STRUCTURE_ATTACH 1
set_kv NYV_NSP_COUNSEL_QUEEN 1
set_kv NYV_LEGAL_COMPREHENSIVE 1
set_kv NYV_PARTNER_MAX_TOKENS_CHAT 8192
set_kv NYV_PARTNER_MAX_TOKENS_FAST 2048
set_kv NYV_PARTNER_MAX_TOKENS_FLOOR 16384

echo "CANON_FLAGS_OK"
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/Nyayavigya/secrets/.env.production")
want = {
  "NYV_PARTNER_LEGAL_PREMIUM_FIRST": "0",
  "AWS_BEDROCK_REGION": "us-east-1",
  "NYV_LEGAL_STRUCTURE_ATTACH": "1",
  "NYV_NSP_COUNSEL_QUEEN": "1",
}
vals = {}
for line in p.read_text().splitlines():
    if "=" not in line or line.startswith("#"):
        continue
    k, v = line.split("=", 1)
    if k in want:
        vals[k] = v.strip().strip('"').strip("'")
for k, v in want.items():
    got = vals.get(k, "(missing)")
    print(f"{k}={got} {'OK' if got == v else 'FAIL'}")
PY
