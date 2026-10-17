#!/usr/bin/env bash
set -uo pipefail
cd /opt/nyv/api
for m in hyparquet pg @aws-sdk/client-s3 @aws-sdk/client-rds @aws-sdk/client-secrets-manager; do
  node -e "import('$m').then(()=>console.log('OK','$m')).catch(e=>console.log('FAIL','$m',e.message))" 2>/dev/null
done
tail -20 /opt/nyv/logs/cnr-standalone-b2.log 2>/dev/null
