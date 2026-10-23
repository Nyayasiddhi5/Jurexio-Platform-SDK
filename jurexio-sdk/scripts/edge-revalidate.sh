#!/usr/bin/env bash
# =============================================================================
# edge-revalidate.sh — periodic spot-check for the AWS edge fronting
# jurexio.com (the "dev-edge" Terraform env, set up by Task #11/#16
# and documented in docs/v3.1.2/completed_docs/AWS-DNS-HANDOFF-2026-04-24.md).
#
# Verifies, in order:
#   1. The four AWS nameservers are still authoritative for jurexio.com
#      on public DNS (i.e. the BigRock NS delegation has not been clobbered).
#   2. The ACM cert is still ISSUED and has more than 30 days until expiry.
#   3. Apex + www + api + console all return HTTP 200 over a valid TLS chain.
#
# Exit code:
#   0  — every check passed.
#   1  — at least one check failed; the failing line is printed.
#
# Usage:
#   bash scripts/edge-revalidate.sh
#
# Suggested cadence: weekly (cron / scheduled CI), and any time after a
# registrar / Route 53 / ALB change. See Section 8 of the handoff doc for
# context.
#
# Requirements: bash, curl, python3, awscli (with read access to ACM in
# ap-south-1). No state is modified.
# =============================================================================
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

DOMAIN=jurexio.com
EXPECTED_NS="ns-1111.awsdns-10.org ns-1846.awsdns-38.co.uk ns-457.awsdns-57.com ns-831.awsdns-39.net"
CERT_ARN=arn:aws:acm:ap-south-1:789925699169:certificate/4fec415f-2049-49cb-b6a7-e2199aeb27e8

# 1. Public NS still pointed at AWS?
#    Query Google DoH first; if Google is unreachable or returns no Answer
#    section (e.g. 5xx, network issue), fall back to Cloudflare DoH so the
#    check does not become a single-provider dependency.
resolve_ns() {
  local resolver_url=$1
  local accept_hdr=$2
  curl -sS --max-time 8 -H "accept: ${accept_hdr}" \
    "${resolver_url}?name=${DOMAIN}&type=NS" 2>/dev/null \
    | python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
except Exception:
  sys.exit(2)
ans=d.get('Answer') or []
if not ans:
  sys.exit(3)
print(' '.join(sorted(a['data'].rstrip('.') for a in ans)))" 2>/dev/null \
    || return 1
}

ACTUAL_NS=""
RESOLVER_USED=""
for src in "google https://dns.google/resolve application/json" \
           "cloudflare https://cloudflare-dns.com/dns-query application/dns-json"; do
  read -r name url accept <<< "$src"
  if out=$(resolve_ns "$url" "$accept") && [[ -n "$out" ]]; then
    ACTUAL_NS="$out"
    RESOLVER_USED="$name"
    break
  fi
done
[[ -n "$ACTUAL_NS" ]] || { echo "FAIL: could not resolve NS for ${DOMAIN} via Google or Cloudflare DoH"; exit 1; }

EXPECTED_NS_SORTED=$(echo "$EXPECTED_NS" | tr ' ' '\n' | sort | tr '\n' ' ')
[[ "$EXPECTED_NS_SORTED" == "${ACTUAL_NS} " ]] \
  || { echo "FAIL: NS drift (via $RESOLVER_USED DoH). expected=[$EXPECTED_NS] actual=[$ACTUAL_NS]"; exit 1; }
echo "OK  NS delegation intact (via $RESOLVER_USED DoH)"

# 2. ACM still ISSUED and not within 30 days of expiry?
#    Robust to both AWS CLI return formats for Certificate.NotAfter:
#      - Unix epoch (e.g. "1794095999.0")  — default for awscli v1 / text output
#      - ISO 8601    (e.g. "2026-11-07T23:59:59+00:00") — awscli v2 default
STATUS=$(aws acm describe-certificate --region ap-south-1 \
  --certificate-arn "$CERT_ARN" --query "Certificate.Status" --output text)
[[ "$STATUS" == "ISSUED" ]] || { echo "FAIL: cert status=$STATUS"; exit 1; }
DAYS_LEFT=$(aws acm describe-certificate --region ap-south-1 \
  --certificate-arn "$CERT_ARN" --query "Certificate.NotAfter" --output text \
  | python3 -c '
import sys, datetime
v = sys.stdin.read().strip()
try:
    end = datetime.datetime.fromtimestamp(float(v), tz=datetime.timezone.utc)
except ValueError:
    end = datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
print((end - now).days)')
(( DAYS_LEFT > 30 )) || { echo "FAIL: cert expires in $DAYS_LEFT day(s)"; exit 1; }
echo "OK  ACM cert ISSUED, $DAYS_LEFT day(s) until expiry"

# 3. Public HTTPS health for apex + www + api + console
for h in "$DOMAIN" "www.$DOMAIN" "api.$DOMAIN" "console.$DOMAIN"; do
  CODE=$(curl -sS -o /dev/null --max-time 12 \
    -w "%{http_code} verify=%{ssl_verify_result}" "https://$h/health")
  [[ "$CODE" == "200 verify=0" ]] || { echo "FAIL: $h => $CODE"; exit 1; }
  echo "OK  $h => 200 with valid TLS"
done

echo "All edge checks passed."
