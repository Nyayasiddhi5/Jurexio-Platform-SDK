#!/bin/sh
# Diagnose why NV-AGENT-PROMPT-DEPTH-001 markers are absent from the running
# gateway even though deploy-aws-ssm.sh reported SUCCESS. Read-only.

CT=nyv-gateway

echo "== container layout =="
echo "workdir=$(docker inspect -f '{{.Config.WorkingDir}}' $CT 2>/dev/null)"
echo "image=$(docker inspect -f '{{.Config.Image}}' $CT 2>/dev/null)"
echo "created=$(docker inspect -f '{{.Created}}' $CT 2>/dev/null)"
echo "started=$(docker inspect -f '{{.State.StartedAt}}' $CT 2>/dev/null)"

echo
echo "== mounts (is source bind-mounted or baked into the image?) =="
docker inspect -f '{{range .Mounts}}{{.Source}} => {{.Destination}}{{"\n"}}{{end}}' $CT 2>/dev/null

echo
echo "== what top-level dirs does the container actually have? =="
docker exec $CT sh -lc 'ls -1' 2>/dev/null | head -20

echo
echo "== newest deploy dirs on host =="
ls -1dt /opt/nyayavigya/repo/*/ 2>/dev/null | head -4

echo
echo "== is my marker in the newest extracted deploy source? =="
NEWEST=$(ls -1dt /opt/nyayavigya/repo/*/ 2>/dev/null | head -1)
echo "newest=$NEWEST"
if [ -n "$NEWEST" ]; then
  echo "marker hits in src/: $(grep -rl 'NV-AGENT-PROMPT-DEPTH-001' "$NEWEST"src 2>/dev/null | wc -l | tr -d ' ')"
  echo "bundle file mtime: $(stat -c '%y' "$NEWEST"src/services/jrx-agent-prompt-bundle.ts 2>/dev/null)"
fi

echo
echo "== where the LIVE compose project resolves to =="
docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' $CT 2>/dev/null

echo
echo "== does the live working dir have the marker? =="
LIVE=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' $CT 2>/dev/null)
echo "live=$LIVE"
[ -n "$LIVE" ] && echo "marker hits: $(grep -rl 'NV-AGENT-PROMPT-DEPTH-001' "$LIVE/src" 2>/dev/null | wc -l | tr -d ' ')"
