#!/usr/bin/env bash
# Embed throughput + coverage API diagnostic (no secrets printed).
set -uo pipefail

log() { echo "=== $* ==="; }

log "TIME $(date -Is) TZ=$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"

log "JRX-API STATUS"
systemctl is-active jrx-api.service 2>/dev/null || echo inactive
systemctl show jrx-api.service -p ActiveState,SubState,MainPID --no-pager 2>/dev/null || true
curl -sS -m 5 -o /dev/null -w "healthz http=%{http_code}\n" http://127.0.0.1:8080/healthz 2>/dev/null || echo "healthz FAIL"
curl -sS -m 5 -o /dev/null -w "coverage http=%{http_code} time=%{time_total}s\n" http://127.0.0.1:8080/api/caselaw/embedding/coverage 2>/dev/null || echo "coverage FAIL"
ss -tlnp 2>/dev/null | grep -E ':8080|:3000|:5000' || netstat -tlnp 2>/dev/null | grep -E ':8080' || echo "no 8080 listener"

log "EMBED UNITS"
systemctl is-active jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop 2>/dev/null || true
pgrep -af embed-corpus.mjs | head -15 || echo "no embed pids"

log "SYSTEMD DROP-INS (concurrency knobs)"
for u in jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop; do
  echo "--- $u ---"
  ls -la "/etc/systemd/system/${u}.service.d/" 2>/dev/null || echo "  (no drop-ins)"
  for f in "/etc/systemd/system/${u}.service.d/"*.conf; do
    [ -f "$f" ] && echo "  $(basename "$f"):" && grep -E 'EMBED_|RDS_' "$f" 2>/dev/null | sed 's/^/    /'
  done
  systemctl show "$u" -p Environment --no-pager 2>/dev/null | tr ' ' '\n' | grep -E 'EMBED_|RDS_' | head -10 || true
done

log "EMBED PROCESS ARGS"
for pid in $(pgrep -f embed-corpus.mjs 2>/dev/null | head -8); do
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | head -c 300
  echo
done

log "EMBED LOG THROUGHPUT (last 60 min)"
LOG=/opt/nyv/logs/embed.log
if [ -f "$LOG" ]; then
  # Count "embedded N rows" or batch-complete lines in last hour
  since=$(date -d '60 minutes ago' -Is 2>/dev/null || date -v-60M -Is 2>/dev/null || echo "")
  echo "log_size=$(wc -c < "$LOG") since=$since"
  grep -E 'embedded|batch|57014|Throttl|timeout|rows/h' "$LOG" 2>/dev/null | tail -40
  echo "--- errors last hour ---"
  grep -E '57014|Throttl|timeout|ECONN|error' "$LOG" 2>/dev/null | tail -20
else
  journalctl -u 'jrx-caselaw-embed-loop@*' --since '60 min ago' --no-pager 2>/dev/null | tail -30
fi

log "EMBED_PROGRESS CHECKPOINTS"
python3 - <<'PY'
import os, json
try:
    import psycopg2
except ImportError:
    print("psycopg2 missing")
    raise SystemExit(0)
env = {}
for line in open("/opt/nyv/api/.env"):
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1); env[k.strip()]=v.strip().strip("'\"")
url = env.get("DATABASE_URL") or env.get("JRX_CASELAW_DATABASE_URL") or ""
if not url:
    print("no DATABASE_URL")
    raise SystemExit(0)
conn = psycopg2.connect(url, connect_timeout=15)
cur = conn.cursor()
cur.execute("SELECT scope, last_id, total_embedded, updated_at FROM embed_progress ORDER BY scope")
for r in cur.fetchall():
    print(f"  {r[0]}: last_id={r[1]} total_embedded={r[2]} updated_at={r[3]}")
cur.execute("""
  SELECT court_type,
         count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
         count(*) AS total
    FROM judgments
   WHERE court_type IN ('sc','hc','dc')
   GROUP BY court_type ORDER BY court_type
""")
print("--- counts by court ---")
tot_e=tot_t=0
for ct, e, t in cur.fetchall():
    pct = (e/t*100) if t else 0
    print(f"  {ct}: {e}/{t} = {pct:.2f}%")
    tot_e+=e; tot_t+=t
print(f"  TOTAL: {tot_e}/{tot_t} = {(tot_e/tot_t*100) if tot_t else 0:.2f}% unembedded={tot_t-tot_e}")
conn.close()
PY

log "CRON SCHEDULE"
cat /etc/cron.d/nys-embed-cnr-schedule 2>/dev/null || echo "no cron"
echo "--- cron log tail ---"
tail -20 /var/log/nys-embed-cnr-schedule.log 2>/dev/null || echo "no cron log"

log "IST NOW"
TZ=Asia/Kolkata date -Is
