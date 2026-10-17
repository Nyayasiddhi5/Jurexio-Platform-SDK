#!/bin/sh
# What is ACTUALLY deployed + running for embedding, and is HC shard 2 stalled?
# Local source `embed-corpus.ts` accepts only all|sc|hc and REJECTS 'dc', yet a
# nyv-caselaw-embed-dc.service is running with scope dc -> the deployed .mjs must differ
# from the local tree (the submodule checkout may lag). Confirm against the host.
set -u
echo "=== 1. deployed embed-corpus.mjs: which scopes does it accept? ==="
grep -oE '"all", *"sc", *"hc"[^)]*|\[.?"all".{0,40}\]' /opt/nyv/api/embed-corpus.mjs 2>/dev/null | head -3
echo -n "  mentions 'dc': "; grep -c '"dc"' /opt/nyv/api/embed-corpus.mjs 2>/dev/null
echo -n "  mentions EMBED_SHARD: "; grep -c 'EMBED_SHARD' /opt/nyv/api/embed-corpus.mjs 2>/dev/null
echo "  ORDER BY used when selecting rows to embed:"
grep -oE 'ORDER BY [a-z_ ,.]+' /opt/nyv/api/embed-corpus.mjs 2>/dev/null | sort -u | sed 's/^/    /'
echo "  the row-selection WHERE clause:"
grep -oE 'WHERE embedding IS NULL[^`"]{0,120}' /opt/nyv/api/embed-corpus.mjs 2>/dev/null | head -3 | sed 's/^/    /'
echo "  deployed file mtime: `stat -c '%y' /opt/nyv/api/embed-corpus.mjs 2>/dev/null | cut -c1-19`"

echo ""
echo "=== 2. shard/service state — is shard 2 stalled? ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  A=`systemctl is-active $u 2>/dev/null`
  T=`systemctl show $u -p ActiveEnterTimestamp --value 2>/dev/null | cut -c1-24`
  N=`systemctl show $u -p NRestarts --value 2>/dev/null`
  printf '  %-30s active=%-8s restarts=%-4s since=%s\n' "$u" "$A" "$N" "$T"
done
echo ""
echo "  live embed processes (scope is the 3rd arg):"
ps -eo etime,args | grep 'embed-corpus.mjs' | grep -v grep | sed 's/^/    /'
echo ""
echo "  EMBED_* env actually applied per unit:"
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  echo "    [$u]"
  systemctl show $u -p Environment --value 2>/dev/null | tr ' ' '\n' | grep -E '^(EMBED|BEDROCK)' | sed 's/^/      /'
done

echo ""
echo "=== 3. throughput + throttling ==="
echo "  embed.log size: `du -h /opt/nyv/embed.log 2>/dev/null | cut -f1`"
echo -n "  ThrottlingException in last 3000 lines: "
tail -3000 /opt/nyv/embed.log 2>/dev/null | grep -ciE 'throttl' || echo 0
echo "  last 8 embed log lines:"
tail -8 /opt/nyv/embed.log 2>/dev/null | cut -c1-200 | sed 's/^/    /'
echo "  last 6 loop log lines (shows scope + maxRows per pass):"
tail -6 /opt/nyv/embed-loop.log 2>/dev/null | cut -c1-200 | sed 's/^/    /'

echo ""
echo "=== 4. host load (how much headroom for more concurrency?) ==="
echo "  vCPU=`nproc` loadavg=`cut -d' ' -f1-3 /proc/loadavg`"
free -m | awk '/Mem:/{printf "  mem: total=%sMB used=%sMB avail=%sMB\n",$2,$3,$7}'
echo "  disk: `df -h /opt | tail -1 | awk '{print $3" used of "$2" ("$5")"}'`"
