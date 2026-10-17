#!/usr/bin/env bash
# NSP blockers recon (NYV-6..11): env/flag presence + route inventory.
# Positive control: PC=5150 must print, and NODE_ENV line must be non-empty.
set -uo pipefail
echo "PC=5150"
echo "=== container ==="
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'nyv-' || echo "NO_NYV_CONTAINERS"
echo "=== env presence (names + lengths only, never values) ==="
docker exec nyv-gateway sh -lc '
for v in NODE_ENV NYV_F_NYS_KNOWLEDGE_PLANE NYS_KNOWLEDGE_BASE_URL NYV_SDK_KEY_NSP NYV_JWT_SECRET JWT_SECRET NYV_DATABASE_URL NYV_F_MATTER_VAULT NYV_F_COMPLIANCE_EVIDENCE; do
  eval "val=\${$v-__UNSET__}"
  if [ "$val" = "__UNSET__" ]; then echo "$v=UNSET"; else echo "$v=SET len=${#val}"; fi
done
echo "NODE_ENV_VALUE=${NODE_ENV-__UNSET__}"
echo "NYV_F_NYS_KNOWLEDGE_PLANE_VALUE=${NYV_F_NYS_KNOWLEDGE_PLANE-__UNSET__}"
echo "NYS_KNOWLEDGE_BASE_URL_HOST=$(printf %s "${NYS_KNOWLEDGE_BASE_URL-}" | sed -E "s#^(https?://[^/]+).*#\1#")"
'
echo "=== all NYV_F_ env names present in container ==="
docker exec nyv-gateway sh -lc 'env | grep -oE "^NYV_F_[A-Z0-9_]+" | sort'
echo "=== app source markers (proves deployed tsx source, not dist) ==="
docker exec nyv-gateway sh -lc 'ls -d /app/dist 2>/dev/null || echo "NO_DIST(expected)"; ls /app/src/routes/jrx-matter-vault-routes.ts /app/src/routes/jrx-legal-work-routes.ts /app/src/routes/jrx-compliance-routes.ts /app/src/services/jrx-court-document-fields.ts 2>&1'
echo "=== git sha inside container ==="
docker exec nyv-gateway sh -lc 'cat /app/.nv-build-sha 2>/dev/null || echo NO_SHA_FILE'
echo "DONE=5150"
