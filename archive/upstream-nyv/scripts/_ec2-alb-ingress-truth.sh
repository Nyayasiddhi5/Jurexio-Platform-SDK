#!/usr/bin/env bash
# =============================================================================
# _ec2-alb-ingress-truth.sh — READ-ONLY on-host evidence for the NSP "NYV-1"
# ALB routing claim (2026-08-20).
#
# Answers, by execution only:
#   - what is actually bound on :80 and :5000
#   - whether nginx in nyv-console proxies /api/jrx/* to gateway:5000 (config line)
#   - local probe codes/latencies through nginx (:80) and direct (:5000)
#   - docker network topology + in-console DNS for 'gateway' (the 2026-08-19 mode)
#   - one real partner-shaped call through the PUBLIC hostname
#
# NEVER mutates anything. No docker compose, no restarts, no reloads.
# NEVER echoes a secret value — key length only (NV-SECRETS-001).
# Output is kept compact: SSM truncates stdout at 24 KB.
# =============================================================================
set -uo pipefail

hr() { echo "===== $* ====="; }

# curl helper that can only ever emit a 3-digit code (NV-VALIDATE-THE-PROBE-001).
# A naive `|| echo 000` yields "000\n000" on connection failure.
probe() { # $1=url  $2=timeout  $3..=extra curl args
  local url="$1" tmo="$2"; shift 2
  local out
  out="$(curl -s -o /tmp/_nvp.$$ -w '%{http_code} %{time_total} %{size_download}' -m "$tmo" "$@" "$url" 2>/dev/null)"
  case "$out" in
    [0-9][0-9][0-9]\ *) echo "$url -> $out" ;;
    *)                  echo "$url -> INSTRUMENT_FAILURE out=[$out]" ;;
  esac
  echo "   body: $(head -c 160 /tmp/_nvp.$$ 2>/dev/null | tr -d '\n')"
  rm -f /tmp/_nvp.$$
}

hr "0. host identity"
echo "instance: $(curl -s -m 3 -H "X-aws-ec2-metadata-token: $(curl -s -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null)"
echo "uptime: $(uptime | tr -s ' ')"

hr "1. containers"
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "docker unavailable"

hr "2. what is bound on :80 and :5000"
if command -v ss >/dev/null 2>&1; then
  sudo ss -ltnp 2>/dev/null | grep -E ':80\s|:5000\s' || ss -ltnp 2>/dev/null | grep -E ':80\s|:5000\s' || echo "no ss match"
else
  sudo netstat -ltnp 2>/dev/null | grep -E ':80\s|:5000\s' || echo "netstat unavailable"
fi
echo "-- docker port mappings --"
for c in nyv-console nyv-gateway; do
  echo "$c: $(docker port "$c" 2>/dev/null | tr '\n' ' ')"
done

hr "3. docker network topology (2026-08-19 partition check)"
for c in nyv-gateway nyv-console; do
  echo "$c nets: $(docker inspect "$c" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}' 2>/dev/null)"
done
echo -n "console resolves 'gateway': "
docker exec nyv-console getent hosts gateway 2>/dev/null | head -1 || echo "NXDOMAIN"

hr "4. console healthcheck"
docker inspect nyv-console --format 'status={{if .State.Health}}{{.State.Health.Status}} failingStreak={{.State.Health.FailingStreak}}{{else}}none{{end}}' 2>/dev/null

hr "5. nginx config in nyv-console — does it proxy /api/jrx/* to gateway:5000?"
docker exec nyv-console sh -c 'ls -1 /etc/nginx/conf.d/ 2>/dev/null; echo "--- grep proxy_pass / api locations ---"; grep -rnE "location|proxy_pass|upstream" /etc/nginx/conf.d/ /etc/nginx/nginx.conf 2>/dev/null | grep -vE "^\s*#" | head -60'

hr "5b. nginx -t (validate config, does NOT reload)"
docker exec nyv-console nginx -t 2>&1 | head -5

hr "6. local probes"
probe "http://localhost/health" 10
probe "http://localhost/api/jrx/health" 10
probe "http://localhost:5000/api/jrx/health" 10
probe "http://localhost:5000/health" 10

hr "7. partner-shaped call through the PUBLIC hostname (real NSP key, value never printed)"
KEY="$(docker exec nyv-gateway printenv NYV_SDK_KEY_NSP 2>/dev/null | tr -d '\r\n')"
echo "NYV_SDK_KEY_NSP key_len=${#KEY}"
if [ "${#KEY}" -ge 32 ]; then
  probe "https://api.nyayasiddhi.online/api/jrx/knowledge/statutes/search?q=BNS%20103" 30 \
    -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted"
  echo "-- same call on-host through nginx :80 --"
  probe "http://localhost/api/jrx/knowledge/statutes/search?q=BNS%20103" 30 \
    -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted"
  echo "-- same call direct to gateway :5000 --"
  probe "http://localhost:5000/api/jrx/knowledge/statutes/search?q=BNS%20103" 30 \
    -H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted"
else
  echo "SKIP partner call — key not readable (len=${#KEY}); this is an INSTRUMENT problem, not a platform verdict"
fi

hr "8. nginx access log — recent 502s (evidence of outage window vs now)"
docker exec nyv-console sh -c 'if [ -f /var/log/nginx/access.log ]; then echo "total_lines=$(wc -l < /var/log/nginx/access.log)"; echo "502_count=$(grep -c " 502 " /var/log/nginx/access.log)"; echo "-- last 3 502 lines --"; grep " 502 " /var/log/nginx/access.log | tail -3; else echo "no access.log at /var/log/nginx/access.log"; fi' 2>/dev/null

echo "===== DONE ====="
