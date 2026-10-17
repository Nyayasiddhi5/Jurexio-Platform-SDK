#!/usr/bin/env bash
# Size distribution of the owned SC judgment PDF estate — metadata listing only,
# no object downloads. Used to choose the extraction cap from the real corpus
# rather than a guess.
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/jrx-source-dev-deploy-env.sh >/dev/null 2>&1
aws s3 ls "s3://your-supreme-court-data-bucket/data/tar/" --recursive --region us-east-1 \
  | awk '$4 ~ /\.pdf$/ {print $3}' > /tmp/jrx-sc-sizes.txt
echo "objects=$(wc -l < /tmp/jrx-sc-sizes.txt)"
python3 - <<'PY'
import statistics
sizes = [int(x) for x in open('/tmp/jrx-sc-sizes.txt') if x.strip()]
sizes.sort()
if not sizes:
    print("PROBE FAILED: zero sizes parsed")
    raise SystemExit(1)
mb = lambda b: round(b / 1024 ** 2, 2)
n = len(sizes)
def pct(p):
    return sizes[min(n - 1, int(n * p / 100))]
print(f"n={n} positive_control=5150")
for p in (50, 90, 95, 99, 99.5, 99.9, 100):
    print(f"p{p}={mb(pct(p))} MB")
print(f"max={mb(sizes[-1])} MB  mean={mb(statistics.mean(sizes))} MB")
for cap in (20, 32, 48, 64, 80, 96, 128, 160, 256):
    over = sum(1 for s in sizes if s > cap * 1024 ** 2)
    print(f"cap={cap}MB -> over_cap={over} ({over / n * 100:.3f}%)")
PY
