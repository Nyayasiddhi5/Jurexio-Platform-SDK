#!/usr/bin/env bash
# Read-only probe of the NYS caselaw-worker: process memory headroom, node heap
# limits, and the extraction dependency versions. Nothing is restarted.
set -uo pipefail
echo "probe-positive-control 5150"
echo "=== host memory (MB) ==="
free -m || true
echo "=== nproc ==="
nproc || true
echo "=== systemd units matching nyv/nys/api ==="
systemctl list-units --type=service --all --no-pager --plain 2>/dev/null | grep -iE 'nyv|nys|api' || echo "none matched"
echo "=== node processes ==="
ps -eo pid,ppid,rss,vsz,etimes,cmd --sort=-rss 2>/dev/null | grep -i '[n]ode' | head -10 || echo "no node procs"
echo "=== unit files (cat, no restart) ==="
for u in $(systemctl list-units --type=service --all --no-pager --plain 2>/dev/null | awk '{print $1}' | grep -iE 'nyv|nys' ); do
  echo "--- $u ---"
  systemctl cat "$u" --no-pager 2>/dev/null | grep -vE 'PASSWORD|SECRET|KEY|TOKEN|_URL=' || true
  echo "--- runtime limits: $u ---"
  systemctl show "$u" --no-pager -p MemoryMax -p MemoryHigh -p MemoryCurrent -p LimitNOFILE -p Environment 2>/dev/null | sed -E 's/(SECRET|KEY|TOKEN|PASSWORD)[A-Z_]*=[^ ]*/\1=<redacted>/g' || true
done
echo "=== node heap limit as configured for the service user ==="
which node && node -v
node -e 'const v=require("v8").getHeapStatistics();console.log("heap_size_limit_MB="+Math.round(v.heap_size_limit/1048576));console.log("total_available_MB="+Math.round(v.total_available_size/1048576));' 2>/dev/null || echo "node heap probe failed"
echo "=== api dir + deps ==="
for d in /opt/nyv/api /opt/nys/api; do
  [ -d "$d" ] && echo "dir=$d" && ls "$d" | head -20
done
for p in /opt/nyv/api/node_modules/unpdf/package.json /opt/nyv/api/node_modules/pdfjs-dist/package.json /opt/nyv/api/node_modules/tesseract.js/package.json /opt/nyv/api/node_modules/pdf-to-img/package.json; do
  [ -f "$p" ] && echo "$p -> $(grep -m1 '"version"' "$p")"
done
echo "=== disk /tmp ==="
df -h /tmp | tail -1
echo "=== swap ==="
swapon --show || echo "no swap"
echo "probe-done 5150"
