#!/usr/bin/env bash
# Suggested dedicated RDS for JRX (separate instance from NYV). Dry-run only.
set -euo pipefail
REGION="${JRX_AWS_REGION:-ap-south-1}"
echo "== JRX RDS plan region=${REGION} =="
echo "Smoke alternative: Postgres in docker-compose.jurexio-aws.yml (no managed RDS cost)."
echo ""
echo "Managed RDS example (requires db subnet group + SG):"
echo "  aws rds create-db-instance --region ${REGION} \\"
echo "    --db-instance-identifier jrx-enterprise-pg \\"
echo "    --engine postgres --engine-version 16 \\"
echo "    --db-instance-class db.t4g.medium \\"
echo "    --master-username jrxadmin \\"
echo "    --manage-master-user-password \\"
echo "    --allocated-storage 50 --storage-type gp3 \\"
echo "    --db-name jurexio"
echo "Then: JRX_RDS_ADMIN_URL=... bash scripts/jrx-provision-rds-database.sh"
