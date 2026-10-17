#!/usr/bin/env bash
# =============================================================================
# _ec2-tg5000-security-probe.sh — READ-ONLY.
#
# The :80-vs-:5000 comparison found nginx does routing the gateway does not.
# nginx also enforces a /metrics IP allowlist (deny all + RFC1918 allow). If the
# ALB target group were re-pointed to :5000, every nginx-level control is bypassed.
#
# This probe MEASURES that blast radius instead of asserting it:
#   A. /metrics — is it access-controlled on :80 and open on :5000?
#      (a public ALB pointed at :5000 would expose Prometheus metrics to the
#       internet; on :80 nginx returns 403 for a non-RFC1918 client)
#   B. the canonical console 302 redirects that only exist in nginx
#   C. immutable asset cache headers + gzip that only nginx adds
# =============================================================================
set -uo pipefail

hdr() { # $1=url  $2..=extra args -> print status + selected headers
  local url="$1"; shift
  curl -s -o /dev/null -D /tmp/_h.$$ -m 10 "$@" "$url" 2>/dev/null
  echo "   status: $(head -1 /tmp/_h.$$ 2>/dev/null | tr -d '\r')"
  grep -iE '^(location|cache-control|expires|content-encoding|server|www-authenticate):' /tmp/_h.$$ 2>/dev/null | sed 's/^/   /' | tr -d '\r'
  rm -f /tmp/_h.$$
}

echo "===== A. /metrics access control (nginx allowlist vs gateway direct) ====="
echo "-- :80 /metrics from 127.0.0.1 (nginx ALLOWS 127.0.0.1 explicitly) --"
hdr "http://localhost/metrics"
echo "-- :80 /metrics simulating an EXTERNAL client via X-Forwarded-For (nginx allow/deny uses real IP, so still allowed here) --"
hdr "http://localhost/metrics" -H 'X-Forwarded-For: 8.8.8.8'
echo "-- :5000 /metrics direct (what a re-targeted ALB would expose) --"
hdr "http://localhost:5000/metrics"
echo "-- size of metrics payload on each --"
echo "   :80   bytes=$(curl -s -m 10 http://localhost/metrics 2>/dev/null | wc -c)"
echo "   :5000 bytes=$(curl -s -m 10 http://localhost:5000/metrics 2>/dev/null | wc -c)"
echo "-- PUBLIC /metrics through the ALB today (the real test of exposure) --"
hdr "https://api.nyayasiddhi.online/metrics"

echo
echo "===== B. canonical console 302s — nginx-only routing ====="
for p in /login /dashboard /billing /admin /command-centre; do
  echo "-- $p --"
  echo "  :80:";   hdr "http://localhost${p}"
  echo "  :5000:"; hdr "http://localhost:5000${p}"
done

echo
echo "===== C. static asset caching/compression headers (nginx-only) ====="
ASSET="$(curl -s -m 10 http://localhost/ 2>/dev/null | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)"
echo "asset=$ASSET"
if [ -n "$ASSET" ]; then
  echo "-- :80 --";   hdr "http://localhost${ASSET}" -H 'Accept-Encoding: gzip'
  echo "-- :5000 --"; hdr "http://localhost:5000${ASSET}" -H 'Accept-Encoding: gzip'
fi

echo
echo "===== D. /downloads/ SDK tarball path (nginx proxies with 60s timeout) ====="
echo "  :80:";   hdr "http://localhost/downloads/"
echo "  :5000:"; hdr "http://localhost:5000/downloads/"

echo "===== DONE ====="
