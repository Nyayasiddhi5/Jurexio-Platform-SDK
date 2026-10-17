#!/bin/sh
# Why did the A/B override not reach the container? The run printed
# `containerEnv=<unset>` for BOTH arms and `health=200 after 0s`, meaning the
# recreate almost certainly failed and the loop just re-observed the already
# healthy old container. Compose stderr was suppressed, which hid the cause —
# so surface it here instead of guessing.

LIVE=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' nyv-gateway 2>/dev/null)
echo "live=$LIVE"
cd "$LIVE" || { echo "FATAL cd"; exit 1; }

echo
echo "== does compose config even parse here? (env interpolation may fail) =="
docker compose -f docker-compose.aws-dev.yml config --quiet 2>&1 | head -15
echo "config-exit=$?"

echo
echo "== is there an .env compose needs for interpolation? =="
ls -la .env 2>/dev/null || echo "no .env in working dir"
grep -c . .env 2>/dev/null || true

echo
echo "== how was the gateway ACTUALLY started (env_file vs environment)? =="
grep -n 'env_file' -A 3 docker-compose.aws-dev.yml | head -12

echo
echo "== dry-run the override recreate, WITH stderr shown =="
printf 'services:\n  gateway:\n    environment:\n      - NYV_AGENT_PROMPT_DEPTH=core\n' > /tmp/ab-ovr.yml
docker compose -f docker-compose.aws-dev.yml -f /tmp/ab-ovr.yml config 2>&1 \
  | grep -i -A 2 'NYV_AGENT_PROMPT_DEPTH' | head -10
echo "merged-config-exit=$?"
rm -f /tmp/ab-ovr.yml
