#!/usr/bin/env bash
# =============================================================================
# _ec2-default-rule-falsify.sh — READ-ONLY.
#
# Two things to falsify rather than assume:
#
#  1. /metrics returned 200 with 2143 bytes on BOTH :80 and :5000 — exactly the
#     SPA index.html size. Before claiming "re-targeting exposes Prometheus
#     metrics" I must check whether /metrics serves metrics AT ALL. Prefer the
#     boring explanation (NV-VALIDATE-THE-PROBE-001).
#
#  2. api.nyayasiddhi.online has no host-header rule on the ALB, so it should be
#     served by the DEFAULT rule. Falsify by sending host headers directly to the
#     ALB: a host with an explicit rule (pro.*) must reach a DIFFERENT backend
#     than an unmatched host (api.*, and a nonsense host). If api.* behaves
#     identically to a nonsense hostname, default-rule dependency is PROVEN.
# =============================================================================
set -uo pipefail

echo "===== 1. is /metrics actually Prometheus metrics? ====="
for u in http://localhost/metrics http://localhost:5000/metrics; do
  echo "-- $u"
  body="$(curl -s -m 10 "$u" 2>/dev/null)"
  echo "   bytes=${#body}"
  echo "   first_line: $(printf '%s' "$body" | head -1 | cut -c1-100)"
  # A real Prometheus exposition starts with '# HELP' / '# TYPE' lines.
  if printf '%s' "$body" | grep -qE '^# (HELP|TYPE) '; then
    echo "   VERDICT: PROMETHEUS_EXPOSITION (metric lines: $(printf '%s' "$body" | grep -cE '^[a-z]' ))"
  elif printf '%s' "$body" | grep -qi '<!DOCTYPE html'; then
    echo "   VERDICT: HTML_SPA_FALLBACK — /metrics serves no metrics"
  else
    echo "   VERDICT: OTHER"
  fi
done
echo "-- compare against SPA root size --"
echo "   SPA root bytes=$(curl -s -m 10 http://localhost/ 2>/dev/null | wc -c)"

echo
echo "===== 2. ALB host-header routing: prove default-rule dependency ====="
ALB="nyv-dev-edge-alb-1975692075.ap-south-1.elb.amazonaws.com"
IP="$(getent hosts "$ALB" 2>/dev/null | head -1 | awk '{print $1}')"
echo "ALB=$ALB resolved_ip=${IP:-<none>}"

# Send an explicit Host header over TLS with SNI pinned to the ALB using
# --resolve, so the ALB rule engine sees the Host we choose.
hostprobe() { # $1=hostname to claim
  local h="$1" out
  out="$(curl -s -o /tmp/_hp.$$ -w '%{http_code}:%{size_download}:%{time_total}' -m 15 -k \
        --resolve "${h}:443:${IP}" "https://${h}/health" 2>/dev/null)"
  case "$out" in [0-9][0-9][0-9]:*) ;; *) out="INSTRUMENT_FAIL[$out]";; esac
  local srv
  srv="$(curl -s -o /dev/null -D - -m 15 -k --resolve "${h}:443:${IP}" "https://${h}/health" 2>/dev/null | grep -i '^server:' | tr -d '\r' | head -1)"
  printf '  %-38s %-28s %s\n' "$h" "$out" "${srv:-<no server hdr>}"
  printf '  %-38s body: %s\n' "" "$(head -c 110 /tmp/_hp.$$ 2>/dev/null | tr -d '\n')"
  rm -f /tmp/_hp.$$
}

if [ -n "$IP" ]; then
  echo "fmt: http_code:size:time_total"
  echo "-- host WITH an explicit ALB rule (priority 100 -> nsp-edge-tg) --"
  hostprobe "pro.nyayasiddhi.online"
  echo "-- host WITH an explicit ALB rule (priority 160 -> nyv-search-tg) --"
  hostprobe "nyayasearch.nyayasiddhi.online"
  echo "-- api.* : NSP says no rule -> should hit DEFAULT (nyv-dev-edge-tg) --"
  hostprobe "api.nyayasiddhi.online"
  echo "-- console.* : also no rule -> should hit DEFAULT too --"
  hostprobe "console.nyayasiddhi.online"
  echo "-- nonsense host, definitely no rule -> DEFAULT. If this matches api.*,"
  echo "   api.* is proven to depend on the default rule. --"
  hostprobe "this-host-has-no-rule.nyayasiddhi.online"
else
  echo "SKIP: could not resolve ALB — instrument problem, not a platform verdict"
fi

echo "===== DONE ====="
