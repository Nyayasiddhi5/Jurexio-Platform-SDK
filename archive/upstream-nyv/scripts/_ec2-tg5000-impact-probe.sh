#!/usr/bin/env bash
# =============================================================================
# _ec2-tg5000-impact-probe.sh — READ-ONLY.
#
# NSP ask #1 is "re-target nyv-dev-edge-tg from :80 to :5000". That would remove
# nginx (nyv-console) from the public path entirely. This probe measures what
# would ACTUALLY be lost, rather than asserting it:
#
#   for each path the public edge serves, compare :80 (nginx, today's path)
#   against :5000 (gateway direct, the proposed path).
#
# Any path where :80 works and :5000 does not is a concrete regression that
# re-targeting would cause. Also re-runs the ALB health-check request exactly as
# the ALB issues it (GET /health on the traffic port, matcher 200,404).
# =============================================================================
set -uo pipefail

cmp_path() { # $1=path  $2=label
  local p="$1" lbl="$2" a b
  a="$(curl -s -o /tmp/_a.$$ -w '%{http_code}:%{content_type}:%{size_download}' -m 15 "http://localhost${p}" 2>/dev/null)"
  b="$(curl -s -o /tmp/_b.$$ -w '%{http_code}:%{content_type}:%{size_download}' -m 15 "http://localhost:5000${p}" 2>/dev/null)"
  case "$a" in [0-9][0-9][0-9]:*) ;; *) a="INSTRUMENT_FAIL[$a]";; esac
  case "$b" in [0-9][0-9][0-9]:*) ;; *) b="INSTRUMENT_FAIL[$b]";; esac
  printf '%-34s :80=%-46s :5000=%s\n' "$lbl $p" "$a" "$b"
  printf '%-34s   80body: %s\n' "" "$(head -c 90 /tmp/_a.$$ 2>/dev/null | tr -d '\n')"
  printf '%-34s   5000body: %s\n' "" "$(head -c 90 /tmp/_b.$$ 2>/dev/null | tr -d '\n')"
  rm -f /tmp/_a.$$ /tmp/_b.$$
}

echo "===== :80 (nginx, current ALB path) vs :5000 (gateway, NSP's proposal) ====="
echo "fmt: http_code:content_type:size"
cmp_path "/"                      "SPA root"
cmp_path "/login"                 "console route"
cmp_path "/dashboard"             "console route"
cmp_path "/health"                "ALB health-check path"
cmp_path "/api/jrx/health"         "api health"

echo
echo "===== static asset served by console (nginx-level routing) ====="
ASSET="$(curl -s -m 10 http://localhost/ 2>/dev/null | grep -oE '/assets/[A-Za-z0-9._-]+\.(js|css)' | head -1)"
echo "discovered asset: ${ASSET:-<none found>}"
if [ -n "$ASSET" ]; then cmp_path "$ASSET" "static asset"; fi

echo
echo "===== ALB health-check request, byte-for-byte as the ALB issues it ====="
echo "TG nyv-dev-edge-tg: HTTP GET /health on traffic-port 80, matcher 200,404"
curl -s -o /dev/null -D - -m 10 -H 'User-Agent: ELB-HealthChecker/2.0' http://localhost:80/health 2>/dev/null | head -4

echo
echo "===== nginx conf: full location list with proxy targets (evidence for ask #2) ====="
docker exec nyv-console sh -c 'cat -n /etc/nginx/conf.d/nyayavigya.conf' 2>/dev/null | sed -n '1,90p'

echo "===== DONE ====="
