#!/usr/bin/env bash
# Probe 2: NYS (nyv-api.service) app layout, env var NAMES, and Athena config.
echo "PC1_ECHO=5150"
echo "--- unit file ---"
systemctl cat nyv-api.service 2>/dev/null | head -50
echo "--- /opt/nyv layout ---"
ls -la /opt/nyv 2>/dev/null | head -30
echo "--- env var NAMES from any EnvironmentFile ---"
for f in $(systemctl show nyv-api.service -p EnvironmentFile 2>/dev/null | sed 's/EnvironmentFile=//' | tr ' ' '\n' | sed 's/^-//' | grep -v '^$'); do
  echo "ENVFILE=$f exists=$([ -f "$f" ] && echo yes || echo no)"
  [ -f "$f" ] && grep -oE "^[A-Za-z0-9_]+=" "$f" | sed 's/=$//' | sort | tr '\n' ' ' && echo
done
echo "--- ATHENA_* / NYS_* names present (from proc env of the running node) ---"
PID=$(systemctl show -p MainPID --value nyv-api.service 2>/dev/null)
echo "MAIN_PID=$PID"
if [ -n "$PID" ] && [ "$PID" != "0" ] && [ -r "/proc/$PID/environ" ]; then
  tr '\0' '\n' < "/proc/$PID/environ" | grep -oE "^[A-Za-z0-9_]+=" | sed 's/=$//' | sort > /tmp/envnames.txt
  echo "ENV_NAME_COUNT=$(wc -l < /tmp/envnames.txt)"
  grep -E "^(ATHENA_|NYS_|AWS_REGION|BEDROCK_REGION|RDS_|DATABASE)" /tmp/envnames.txt | tr '\n' ' '
  echo
  echo "--- ATHENA config VALUES (non-secret: db/table/output/workgroup/region) ---"
  tr '\0' '\n' < "/proc/$PID/environ" | grep -E "^(ATHENA_DATABASE|ATHENA_TABLE|ATHENA_TABLE_HC|ATHENA_OUTPUT_S3|ATHENA_WORKGROUP|ATHENA_REGION|ATHENA_MAX_SCAN_BYTES|AWS_REGION|BEDROCK_REGION)="
  echo "--- key LENGTHS only ---"
  tr '\0' '\n' < "/proc/$PID/environ" | grep -E "^(NYS_SDK_API_KEYS|NYS_KNOWLEDGE_API_KEY|DATABASE_URL|RDS_CASELAW_URL)=" | while IFS='=' read -r k v; do echo "$k len=${#v}"; done
else
  echo "PROC_ENV_UNREADABLE"
fi
echo "--- local health (positive control: expect JSON, not empty) ---"
curl -s -o /tmp/h.txt -w "http=%{http_code} bytes=%{size_download} t=%{time_total}\n" http://127.0.0.1:8080/api/health
head -c 300 /tmp/h.txt; echo
