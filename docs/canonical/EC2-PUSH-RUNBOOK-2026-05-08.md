# EC2 Push Runbook — v5.0.1 patch (3 deltas)
**Date:** 2026-05-08
**Source commit:** Replit dev (NYV Gateway green, smoke 102/102 PASS, deep AI flows verified)
**Target:** EC2 `i-0df71e5ea1df8f588`, container `nyv-gateway`, image base `nyayavigya-platform-312-gateway:latest`
**Estimated downtime:** ≤ 30s (single-container restart with pre-tagged rollback)

## Deltas being shipped

| # | File | Symptom on EC2 | Fix |
|---|------|----------------|-----|
| 1 | `.local/keysync-payload/mirror-pg.ts` (lines 42, 44) | NSA missing `documents:read`+`translate:write`; NYM missing 4 scopes — gateway 403 on translate/docs | Scope arrays brought in line with Neon ground truth |
| 2 | `src/services/sdk/sdk-application-service.ts` (lines 589-609) | `/api/nv/gateway/usage` HTTP 500 "Application not found" for all 7 mirrored apps | Dropped redundant `eq(organizationId, orgId)` join clause |
| 3 | `src/startup/nv-pii-vault-cleanup.ts` (lines 88-176) | PII vault permanently degraded to in-memory after cold-start TLS race | Added 30s retry-with-backoff (env-tunable `NYV_PII_VAULT_REDIS_RETRY_MS`) |

## Pre-flight gates (PASS = proceed)
1. ✅ Replit gateway healthy v5.0.1 (db/redis/llm/agents/jwt all healthy)
2. ✅ `nv-smoke-all-platforms.ts` 102 PASS / 0 FAIL / 0 SKIP
3. ✅ `/api/nv/gateway/usage` HTTP 200 on all 7 platforms (was the 500 bug)
4. ✅ Indian-legal CoT real-LLM trace shows full 12-step safety ring on research, drafting, doc-intel, precedent, translate
5. ⏳ Architect code-review APPROVED (running in parallel; gate before push)

## Push sequence (operator must execute on bastion / SSM)

```bash
# 0. Pre-tag current EC2 prod image (lesson from 2026-05-07 rollback loss)
ssh ec2 docker tag nyayavigya-platform-312-gateway:latest \
                   nyayavigya-platform-312-gateway:rollback-$(date -u +%Y%m%dT%H%M%SZ)

# 1. Build tarball locally (28 MB; same exclusion list as 2026-05-07)
cd nyayavigya-platform-312
tar --exclude='node_modules' --exclude='.git' --exclude='attached_assets' \
    --exclude='sdk-downloads' --exclude='audit/*.json' --exclude='dist' \
    -czf /tmp/nyv-v501-patch-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .

# 2. Upload to S3
aws s3 cp /tmp/nyv-v501-patch-*.tar.gz \
    s3://nyv-deploy-bucket/releases/nyv-v501-patch-$(date -u +%Y%m%dT%H%M%SZ).tar.gz

# 3. SSM extract on EC2
aws ssm send-command --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=[
    "cd /opt/nyayavigya",
    "aws s3 cp s3://nyv-deploy-bucket/releases/nyv-v501-patch-LATEST.tar.gz /tmp/patch.tgz",
    "tar -xzf /tmp/patch.tgz -C nyayavigya-platform-312/ --overwrite",
    "cd nyayavigya-platform-312 && docker compose build gateway",
    "docker tag nyayavigya-platform-312-gateway:latest nyayavigya-platform-312-gateway:v501-patch-NYV-USAGE-PIIVAULT",
    "docker compose up -d --force-recreate gateway"
  ]'

# 4. EC2 RDS scope re-mirror (one-shot, idempotent)
aws ssm send-command --instance-ids i-0df71e5ea1df8f588 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=[
    "cd /opt/nyayavigya/nyayavigya-platform-312",
    "DATABASE_URL=$(grep ^NYV_DATABASE_URL /opt/nyayavigya/secrets/.env.production | cut -d= -f2-) npx tsx .local/keysync-payload/mirror-pg.ts"
  ]'
```

## Post-deploy verification (must all PASS)

```bash
# Health
curl -fsS https://api.nyayasiddhi.online/api/nv/health | jq '.status'
# Expect: "healthy"

# /usage (was the 500 bug)
for k in NSP NSPM NSI NSM NSA NYM JRX; do
  KEY=$(aws ssm get-parameter --name /nyv/sdk-keys/$k --with-decryption --query Parameter.Value --output text)
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" -H "X-API-Key: $KEY" https://api.nyayasiddhi.online/api/nv/gateway/usage)
  echo "$k → $CODE"
done
# Expect: all 200

# NSA + NYM scope verification (fix #1)
psql "$NYV_RDS_URL" -t -c "SELECT a.app_name, k.scopes::text FROM sdk_app_api_keys k JOIN sdk_applications a ON a.id=k.application_id WHERE a.app_name ILIKE '%academy%' OR a.app_name ILIKE '%nyayamitra%';"
# Expect: NSA = 6 scopes incl translate:write; NYM = 7 scopes incl usage:read

# PII vault (fix #3) — should re-attempt Redis after cold-start
aws ssm start-session --target i-0df71e5ea1df8f588 --document-name AWS-StartInteractiveCommand --parameters 'command=["docker logs nyv-gateway 2>&1 | grep -i \"pii.*vault\" | tail -5"]'
# Expect: "Redis backend ACTIVE" OR (after a transient flap) "Redis retry window elapsed — re-probing"
```

## Rollback (≤ 30s if any post-deploy gate fails)

```bash
ssh ec2 docker tag nyayavigya-platform-312-gateway:rollback-<TIMESTAMP> \
                   nyayavigya-platform-312-gateway:latest
ssh ec2 docker compose up -d --force-recreate gateway
```

## Risk assessment

- **Delta 1 (mirror-pg.ts SCOPES)**: ZERO risk to existing apps — scopes only EXPAND; no removal. Idempotent ON CONFLICT update.
- **Delta 2 (/usage orgId drop)**: LOW risk — query becomes wider, not narrower. Org isolation preserved via SDK key auth (`req.sdkContext.applicationId` always tied to the auth'd app's org).
- **Delta 3 (PII vault retry)**: LOW risk — failure mode unchanged (in-memory fallback), only the recovery path is new. `NYV_PII_VAULT_REDIS_RETRY_MS=999999999` reverts to old sticky behavior.

## Post-push followups (separate tasks)
- CI assertion: lock `mirror-pg.ts` SCOPES against live RDS schema to prevent future drift
- PII vault: add Prom counter `nyv_pii_vault_redis_reprobe_total` for ops visibility
- /usage org-isolation: explicit assertion in middleware that `req.sdkContext.organizationId` matches `sdkApplications.organizationId` (defense-in-depth)
