#!/bin/sh
# Step 1+2 pre-flight (READ-ONLY): confirm what the DEPLOYED loop does before changing it.
# India-only matters here: `scope=all` applies NO court_type filter, so an `all` pass would
# embed us-fed (59,781) + us-ny (26,755). Must confirm those passes are disabled.
set -u
L=/opt/nyv/api/jrx-caselaw-embed-loop.sh
echo "=== deployed loop script: which scopes can it run? ==="
grep -nE 'run_embed|EMBED_[A-Z_]*MAX_ROWS|EMBED_SKIP_SC|SKIP' "$L" | sed 's/^/  /'
echo ""
echo "  mtime: `stat -c '%y' $L | cut -c1-19`"
echo ""
echo "=== EMBED_ALL / SKIP_SC as ACTUALLY APPLIED per unit (unset => script default!) ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  E=`systemctl show $u -p Environment --value 2>/dev/null`
  printf '  %-30s\n' "$u"
  for k in EMBED_SCOPE EMBED_CONCURRENCY EMBED_ALL_MAX_ROWS EMBED_SKIP_SC EMBED_SHARDS EMBED_SHARD; do
    V=`printf '%s' "$E" | tr ' ' '\n' | grep "^$k=" | cut -d= -f2-`
    printf '      %-22s %s\n' "$k" "${V:-<UNSET -> script default>}"
  done
done
echo ""
echo "=== does the loop's ExecStart differ per unit? ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-dc; do
  echo "  $u -> `systemctl show $u -p ExecStart --value | grep -oE 'path=[^ ]+' | head -1`"
done
echo ""
echo "=== the hung worker (step 1 target) — confirm STILL hung before killing ==="
P=1836874
if [ -d /proc/$P ]; then
  echo "  PID $P elapsed=`ps -o etime= -p $P|tr -d ' '` cpu=`ps -o time= -p $P|tr -d ' '` state=`awk '{print $3}' /proc/$P/stat`"
  echo "  its scope args: `tr '\0' ' ' < /proc/$P/cmdline | cut -c1-90`"
  echo "  bedrock conns: `ss -tnp 2>/dev/null | grep -c \"pid=$P,\" || echo '?'` (expect only the :5432 one)"
else
  echo "  PID $P already gone — shard 2 may have self-recovered; re-check checkpoint before acting."
fi
echo ""
echo "=== existing drop-in overrides (so I do not clobber something) ==="
ls -1 /etc/systemd/system/nyv-caselaw-embed-*.d/ 2>/dev/null | sed 's/^/  /' || echo "  none"
