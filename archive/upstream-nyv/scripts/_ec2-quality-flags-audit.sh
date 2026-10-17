#!/bin/sh
# NV-DORMANT-FLAGS-001 — report which quality/prompt flags are set in the live
# gateway environment. Read-only: prints presence (1/0) and never a secret value.
# Runs under /bin/sh (SSM), so no bashisms.

echo "== locate env file =="
ENVF=""
for C in /opt/Nyayavigya/secrets/.env.production \
         /opt/nyayavigya/secrets/.env.production \
         /opt/nyayavigya/repo/current/.env.production \
         /opt/Nyayavigya/.env.production; do
  [ -f "$C" ] && ENVF="$C" && break
done
if [ -z "$ENVF" ]; then
  echo "no env file at known paths; searching"
  ENVF=$(find /opt -maxdepth 4 -name '.env.production' 2>/dev/null | head -1)
fi
echo "envfile=${ENVF:-NONE}"

echo
echo "== flag presence in env file (1=set, 0=absent) =="
for V in NYV_SPECIALIST_PROMPT_COMPILER NYV_QUEEN_PROMPT_COMPILER \
         NYV_QUALITY_ENVELOPE_FAIL_CLOSED NYV_RAG_RERANK_ALLOW_HEURISTIC \
         NYV_QUEEN_SYNTHESIS_STREAM NYV_COT_AUTO_STRATEGY; do
  N=0
  [ -n "$ENVF" ] && N=$(grep -c "^${V}=" "$ENVF" 2>/dev/null || echo 0)
  echo "$V=$N"
done

echo
echo "== what the RUNNING container actually sees =="
CT=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i -m1 'gateway\|nyaya' )
echo "container=${CT:-NONE}"
if [ -n "$CT" ]; then
  for V in NYV_SPECIALIST_PROMPT_COMPILER NYV_QUEEN_PROMPT_COMPILER NYV_COT_AUTO_STRATEGY; do
    VAL=$(docker exec "$CT" sh -lc "printenv $V" 2>/dev/null)
    echo "$V=${VAL:-<unset>}"
  done
fi
