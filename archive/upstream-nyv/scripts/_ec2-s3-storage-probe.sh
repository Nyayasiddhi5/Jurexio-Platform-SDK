#!/usr/bin/env bash
# Read-only S3 + storage env probe on EC2 gateway container.
set +e
echo "=== storage env (gateway) ==="
docker exec nyv-gateway printenv 2>/dev/null | rg -i '^(NYV_STORAGE|AWS_|S3_|STORAGE)' | rg -v 'SECRET|KEY|PASSWORD|TOKEN' | sort
echo ""
echo "=== S3 list (deploy bucket prefix) ==="
BUCKET="$(docker exec nyv-gateway printenv NYV_S3_BUCKET 2>/dev/null || docker exec nyv-gateway printenv AWS_S3_BUCKET 2>/dev/null)"
BUCKET="${BUCKET%\"}"; BUCKET="${BUCKET#\"}"
if [ -z "$BUCKET" ]; then
  echo "NYV_S3_BUCKET/AWS_S3_BUCKET not set in gateway"
else
  echo "bucket=$BUCKET"
  docker exec nyv-gateway sh -c "command -v aws >/dev/null && aws s3 ls s3://$BUCKET/ 2>&1 | head -10 || echo 'aws cli not in container'"
fi
echo ""
echo "=== gateway storage health endpoint ==="
curl -s -m 20 http://localhost:5000/api/jrx/health/full 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  checks=d.get('checks') or d.get('services') or d
  for k in ('storage','s3','objectStorage','documents'):
    if k in str(checks).lower():
      print(k, checks.get(k) if isinstance(checks,dict) else 'see full')
  print('status', d.get('status', d.get('overall')))
except Exception as e:
  print('parse_err', e)
" 2>&1
