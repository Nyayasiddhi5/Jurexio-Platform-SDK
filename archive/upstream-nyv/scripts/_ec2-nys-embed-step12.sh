#!/bin/sh
# STEP 1: kill the hung HC shard-2 worker (recovers 1/3 of HC throughput).
# STEP 2: raise Bedrock concurrency — host measured 95% idle (loadavg 0.10 / 2 vCPU),
#         zero ThrottlingException in 3,000 log lines, so throughput is knob-bound.
#
# INDIA-ONLY (confirmed before acting): deployed loop defaults EMBED_ALL_MAX_ROWS=0, so no
# `scope=all` pass runs; `all` is the ONLY scope with no court_type filter and is therefore
# the only way us-fed/us-ny could be embedded. We PIN ALL_MAX_ROWS=0 explicitly on every
# unit so an India-only guarantee no longer depends on a script default.
# Verified: no pre-existing drop-ins to clobber.
set -u
STAMP=`date -u +%Y%m%dT%H%M%SZ`
echo "=== STEP 1: kill the hung shard-2 worker ==="
P=1836874
if [ -d /proc/$P ]; then
  echo "  before: elapsed=`ps -o etime= -p $P|tr -d ' '` cpu=`ps -o time= -p $P|tr -d ' '`"
  # Confirm it is THE hung one: low CPU relative to elapsed and scope hc.
  case "`tr '\0' ' ' < /proc/$P/cmdline`" in
    *embed-corpus.mjs*hc*) ;;
    *) echo "  ABORT: pid $P is not an hc embed worker"; exit 3 ;;
  esac
  kill -TERM $P 2>/dev/null || true
  sleep 8
  if [ -d /proc/$P ]; then echo "  SIGTERM ignored (blocked in syscall) -> SIGKILL"; kill -KILL $P 2>/dev/null || true; sleep 4; fi
  [ -d /proc/$P ] && echo "  STILL ALIVE — investigate" || echo "  killed OK"
else
  echo "  pid $P already gone"
fi

echo ""
echo "=== STEP 2: raise concurrency via systemd drop-ins (survives restart) ==="
# HC shards: 8 -> 20. DC: 6 -> 12. Batch stays 200 (RDS round-trip amortised already).
mkdir -p /etc/systemd/system/nyv-caselaw-embed-loop@.service.d
cat > /etc/systemd/system/nyv-caselaw-embed-loop@.service.d/zz-throughput.conf <<'UNIT'
# NYS-EMBED-THROUGHPUT-001 (2026-08-18)
# Host measured 95% idle (loadavg 0.10 on 2 vCPU, 787MB/7.8GB) with ZERO
# ThrottlingException across 3,000 embed-log lines, so the limiter was this knob and
# not CPU, memory, or Bedrock. 8 -> 20 parallel Titan invokes per batch slice.
# EMBED_ALL_MAX_ROWS is pinned to 0 so no `scope=all` pass can run: `all` is the only
# scope without a court_type filter and would embed us-fed/us-ny. India-only.
# Dial EMBED_CONCURRENCY back to 8 if ThrottlingException appears in /opt/nyv/embed.log.
[Service]
Environment=EMBED_CONCURRENCY=20
Environment=EMBED_ALL_MAX_ROWS=0
Environment=EMBED_SKIP_SC=1
UNIT

mkdir -p /etc/systemd/system/nyv-caselaw-embed-dc.service.d
cat > /etc/systemd/system/nyv-caselaw-embed-dc.service.d/zz-throughput.conf <<'UNIT'
# NYS-EMBED-THROUGHPUT-001 (2026-08-18) — DC 6 -> 12.
# DC ran with EMBED_ALL_MAX_ROWS UNSET, inheriting the script default. The deployed
# script defaults it to 0 so no all-pass ran, but pinning it here makes the India-only
# guarantee explicit instead of dependent on that default.
[Service]
Environment=EMBED_CONCURRENCY=12
Environment=EMBED_ALL_MAX_ROWS=0
Environment=EMBED_SKIP_SC=1
UNIT

systemctl daemon-reload
echo "  drop-ins written + daemon-reload done"

echo ""
echo "=== restart units so the new concurrency is picked up ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  systemctl restart "$u" 2>/dev/null && echo "  restarted $u" || echo "  FAILED $u"
done
sleep 25

echo ""
echo "=== VERIFY ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  C=`systemctl show $u -p Environment --value | tr ' ' '\n' | grep '^EMBED_CONCURRENCY=' | tail -1 | cut -d= -f2`
  A=`systemctl show $u -p Environment --value | tr ' ' '\n' | grep '^EMBED_ALL_MAX_ROWS=' | tail -1 | cut -d= -f2`
  printf '  %-30s active=%-8s CONCURRENCY=%-4s ALL_MAX_ROWS=%s\n' "$u" "`systemctl is-active $u`" "$C" "$A"
done
echo ""
echo "  live workers (all 4 shards should appear, incl. shard 2):"
pgrep -af 'embed-corpus.mjs' | sed 's/^/    /'
echo ""
echo "  host load after restart: loadavg=`cut -d' ' -f1-3 /proc/loadavg`"
free -m | awk '/Mem:/{printf "    mem used=%sMB avail=%sMB\n",$3,$7}'
echo ""
echo "  fresh batches in the last 30s (proof embedding resumed):"
tail -12 /opt/nyv/embed.log 2>/dev/null | grep -oE '"done":[0-9]+,"lastId":"[0-9]+".*"scope":"[a-z]+"' | tail -6 | sed 's/^/    /'
echo -n "  throttle hits since restart: "
tail -400 /opt/nyv/embed.log 2>/dev/null | grep -ciE 'throttl' || echo 0
