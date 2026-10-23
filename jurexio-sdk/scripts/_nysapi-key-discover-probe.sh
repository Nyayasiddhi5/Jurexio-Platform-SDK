#!/usr/bin/env bash
# Discover case-api auth key names on caselaw-worker (no secret values).
set -uo pipefail

echo "=== case-api systemd drop-ins (key var names only) ==="
grep -rhE 'Environment=|API_KEY|AUTH|SECRET' /etc/systemd/system/case-api-duckdb.service.d/ 2>/dev/null \
  | sed 's/=.*/=***REDACTED***/' || true

echo "=== start_api scripts ==="
for f in /home/ec2-user/scripts/build/start_api*.sh /home/ec2-user/scripts/build/*.env; do
  [ -f "$f" ] || continue
  echo "FILE=$f"
  grep -E 'API_KEY|AUTH|SECRET|BEARER' "$f" 2>/dev/null | sed 's/=.*/=***REDACTED***/' || true
done

echo "=== uvicorn env (names from /proc) ==="
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  tr '\0' '\n' < "/proc/$pid/environ" | grep -iE 'key|auth|secret|api' | sed 's/=.*/=***REDACTED***/' || true
else
  echo "uvicorn_pid=not_found"
fi

echo "=== try secrets manager names (fetch length only) ==="
python3 <<'PY'
import json, subprocess, os
region = "ap-south-1"
for sid in ["nyaya/case_api/public", "nyaya/case_api/api-key", "nyaya/case_api/rds-ro", "nyaya/case_api/integrator"]:
    try:
        out = subprocess.check_output([
            "aws", "secretsmanager", "get-secret-value",
            "--secret-id", sid, "--region", region,
            "--query", "SecretString", "--output", "text"
        ], stderr=subprocess.DEVNULL, timeout=10)
        print(f"SM {sid} len={len(out.strip())} keys={list(json.loads(out).keys()) if out.strip().startswith('{') else ['scalar']}")
    except Exception as e:
        print(f"SM {sid} err={type(e).__name__}")
PY

# If CASE_API_INTEGRATOR_KEY or similar exists in env, test one CNR
for var in CASE_API_INTEGRATOR_KEY CASE_API_PUBLIC_KEY CASE_API_API_KEY NYSAPI_KEY API_AUTH_KEY; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    echo "TRY_VAR=$var len=$(printf %s "$val" | wc -c | tr -d ' ')"
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
      -H "X-API-Key: $val" "http://127.0.0.1:8090/v1/cases/GJHC240256342024" 2>/dev/null || echo ERR)
    echo "TRY_RESULT $var http=$code"
  fi
done
