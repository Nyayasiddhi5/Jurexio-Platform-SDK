#!/usr/bin/env bash
# NV-NYS-OPS-STOP-001 — gracefully stop delta-dc ingest on caselaw-worker.
# Does NOT touch nysapi, embed units, or secrets.
set -uo pipefail

TARGET_PID="${1:-}"
echo "=== STOP delta-dc $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "--- all ingest-rds processes ---"
pgrep -af "ingest-rds" || echo "ingest-rds: none"

echo "--- delta-dc processes ---"
DELTA_PIDS=$(pgrep -f "ingest-rds.*delta-dc" || true)
if [[ -z "$DELTA_PIDS" ]]; then
  echo "delta-dc: not running (already stopped)"
else
  for pid in $DELTA_PIDS; do
    echo "SIGTERM pid=$pid"
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 10
  STILL=$(pgrep -f "ingest-rds.*delta-dc" || true)
  if [[ -n "$STILL" ]]; then
    for pid in $STILL; do
      echo "SIGKILL pid=$pid (still alive after 10s)"
      kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 2
  fi
fi

if [[ -n "$TARGET_PID" ]]; then
  if kill -0 "$TARGET_PID" 2>/dev/null; then
    echo "target pid $TARGET_PID still alive — SIGKILL"
    kill -KILL "$TARGET_PID" 2>/dev/null || true
    sleep 1
  fi
  if kill -0 "$TARGET_PID" 2>/dev/null; then
    echo "target pid $TARGET_PID: STILL ALIVE"
  else
    echo "target pid $TARGET_PID: gone"
  fi
fi

echo "--- post-stop verify ---"
pgrep -af "ingest-rds.*delta-dc" || echo "delta-dc: confirmed stopped"
pgrep -af "ingest-rds" || echo "ingest-rds (all): none"

echo "--- nysapi health ---"
curl -sS -m 10 -w " local_8080 http=%{http_code} ms=%{time_total}\n" http://127.0.0.1:8080/health 2>/dev/null | head -c 200 || echo "local health FAIL"
curl -sS -m 10 -w " public_nysapi http=%{http_code} ms=%{time_total}\n" https://nysapi.nyayasiddhi.online/health 2>/dev/null | head -c 200 || echo "public health FAIL"

echo "--- nyv-api service ---"
systemctl is-active nyv-api 2>/dev/null || echo "nyv-api systemctl N/A"

echo "=== STOP DONE ==="
