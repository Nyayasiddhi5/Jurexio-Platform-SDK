#!/bin/sh
# REVERT step 2. Concurrency 20 measurably made throughput WORSE, disproving my own
# "the host is idle so the knob is the limiter" hypothesis.
#
# Evidence (per-batch gap, 200 rows each, same fetch cost of 0.1s):
#   concurrency 8  workers: 47-48s/batch  => ~14,900 rows/h/worker
#   concurrency 20 workers: 88-112s/batch => ~6,500-7,900 rows/h/worker
# Host was 96.8% idle, load 0.19, RDS 39/1713 conns, ZERO ThrottlingException — so
# Bedrock is shedding load by ADDING LATENCY per invoke rather than returning an error.
# More parallel invokes therefore buys nothing and costs per-request latency.
#
# 8 was already the tuned value. Reverting to it; keeping ONLY the India-only pins
# (EMBED_ALL_MAX_ROWS=0 / EMBED_SKIP_SC=1), which are correct and unrelated to throughput.
set -u
echo "=== revert concurrency to the measured-optimal 8 / 6 ==="
cat > /etc/systemd/system/nyv-caselaw-embed-loop@.service.d/zz-throughput.conf <<'UNIT'
# NYS-EMBED-THROUGHPUT-001 (2026-08-18) — REVERTED to 8 after measurement.
# Raising EMBED_CONCURRENCY 8 -> 20 REDUCED throughput: per-batch time went 47-48s
# (~14,900 rows/h/worker) to 88-112s (~6,500-7,900 rows/h/worker), while the host stayed
# 96.8% idle and Bedrock returned ZERO ThrottlingException. Bedrock sheds load as added
# per-invoke LATENCY, not as an error, so extra parallelism is counter-productive here.
# 8 is the empirical optimum for this host+model. Do not raise it without re-measuring
# per-batch gaps in /opt/nyv/embed.log.
#
# EMBED_ALL_MAX_ROWS=0 is an INDIA-ONLY guarantee, not a perf setting: `scope=all` is the
# only scope with no court_type filter and would embed us-fed/us-ny rows.
[Service]
Environment=EMBED_CONCURRENCY=8
Environment=EMBED_ALL_MAX_ROWS=0
Environment=EMBED_SKIP_SC=1
UNIT

cat > /etc/systemd/system/nyv-caselaw-embed-dc.service.d/zz-throughput.conf <<'UNIT'
# NYS-EMBED-THROUGHPUT-001 (2026-08-18) — DC reverted to 6 (see loop drop-in for evidence).
# EMBED_ALL_MAX_ROWS=0 pinned for the India-only guarantee.
[Service]
Environment=EMBED_CONCURRENCY=6
Environment=EMBED_ALL_MAX_ROWS=0
Environment=EMBED_SKIP_SC=1
UNIT

systemctl daemon-reload
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  systemctl restart "$u" && echo "  restarted $u"
done
sleep 20
echo ""
echo "=== VERIFY: back to 8/6, India-only pins retained, all 4 shards live ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  E=`systemctl show $u -p Environment --value`
  C=`printf '%s' "$E" | tr ' ' '\n' | grep '^EMBED_CONCURRENCY=' | tail -1 | cut -d= -f2`
  A=`printf '%s' "$E" | tr ' ' '\n' | grep '^EMBED_ALL_MAX_ROWS=' | tail -1 | cut -d= -f2`
  S=`printf '%s' "$E" | tr ' ' '\n' | grep '^EMBED_SKIP_SC=' | tail -1 | cut -d= -f2`
  printf '  %-30s active=%-8s CONC=%-3s ALL_MAX=%-3s SKIP_SC=%s\n' "$u" "`systemctl is-active $u`" "$C" "$A" "$S"
done
echo ""
pgrep -af 'embed-corpus.mjs' | sed 's/^/    /'
echo ""
echo "  scopes running (must be hc/dc only — never 'all'): `pgrep -af embed-corpus.mjs | grep -oE '[0-9]+ (hc|dc|sc|all)$' | awk '{print $2}' | sort -u | tr '\n' ' '`"
