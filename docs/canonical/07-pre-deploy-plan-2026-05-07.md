# 07 — Pre-Deploy Plan (Option A hardening → push)

**Status**: ⏸️ **AWAITING USER GO** — no `suggest_deploy` and no EC2 push will run until explicitly approved.
**Hardening baseline**: T1–T6 ✅ (Replit dev 101/102 PASS, T2 + T3 acceptance OK, NV-SECRETS-001 verified, storage adapter dual-backend round-trip OK).

---

## 0. What is included in the next deploy

| Change | Files | Risk |
|---|---|---|
| `mirror-pg.ts` script for SDK-key vault → EC2 RDS | `.local/keysync-payload/mirror-pg.ts` (gitignored — staging artefact only) | LOW — already executed, EC2 RDS already mirrored |
| Doc reorganization | `archive/2026-05-07-canonical-rewrite/` (31 files moved); 4 new `docs/canonical/*` | NONE — docs only |
| `scripts/nv-verify-env-parity.ts` | NEW | NONE — read-only verifier |

**No source-code changes are pending for this deploy.** All previously deployed fixes (NYV-NS-022 lazy-Proxy, NYV-PROV-VAL-DEFENSIVE-001, F7-EXT scope filter) are already on EC2 commit `c82426b`.

---

## 1. Pre-flight gates (must all be GREEN before deploy)

### Gate 1.1 — Replit dev smoke

```bash
NYV_GATEWAY=http://localhost:5000 npx tsx scripts/nv-smoke-all-platforms.ts
# Required: ≥ 100/102 PASS (1 flaky LLM timeout tolerated)
```

### Gate 1.2 — Env parity verifier

```bash
tsx scripts/nv-verify-env-parity.ts
# Required: PARITY=PASS (exit 0)
```

### Gate 1.3 — Storage adapter round-trip

```bash
# S3 (current default backend)
npx tsx -e '...'  # see T3 acceptance in T1-discovery.md
# Replit Object Storage
NYV_STORAGE_BACKEND=replit npx tsx -e '...'
# Required: both produce identical key path + SHA-256 round-trip OK
```

### Gate 1.4 — NV-SECRETS-001 grep guard

```bash
rg -n 'process\.env\.(NYV_)?REDIS_(TCP_|READ_|WRITE_)?URL|process\.env\.NYV_REDIS_URL' src/ scripts/
# Required: only the 7 whitelisted call sites (NV-SECRETS-001 in replit.md)
```

### Gate 1.5 — NV-LLM-001 single-router rule

```bash
rg -n 'realLLMService\.executeRequest|new RealLLMService\(' src/
# Required: only the 7 whitelisted call sites (NV-LLM-001 in replit.md)
```

---

## 2. Replit Publish — step-by-step

1. **Confirm Replit Secrets vault has all 17 required env-vars** (see `nv-verify-env-parity.ts` REQUIRED_KEYS).
2. **Run gate 1.1 → 1.5** — abort if any gate fails.
3. **Trigger `suggest_deploy`** — this is the ONLY agent action that publishes. The user will manually click "Deploy" in the panel.
4. **Post-deploy probe** (manual, after deploy goes live):
   ```bash
   REPLIT_PUBLISH_DOMAIN=<your-replit-domain>.replit.app tsx scripts/nv-verify-env-parity.ts
   ```
5. **Smoke against publish domain** with all 7 SDK keys (replace `<host>`):
   ```bash
   NYV_GATEWAY=https://<host>.replit.app npx tsx scripts/nv-smoke-all-platforms.ts
   # Expected: 100+/102 PASS
   ```

**Rollback**: Replit deploy panel → "Rollback" → previous snapshot. Auto-reverts in <30 s. No agent action required.

---

## 3. EC2 — step-by-step

> **Skip this section if no source-code changes are pending.** Currently EC2 is on commit `c82426b` with 19/19 functional E2E pass. Re-deploy is unnecessary unless a new fix lands.

If a code push is needed:

1. **Build tarball locally**:
   ```bash
   cd nyayavigya-platform-312
   tar --exclude=node_modules --exclude=.git --exclude=.local --exclude=audit -czf /tmp/nyv-$(date -u +%Y%m%dT%H%M%SZ).tgz .
   ```
2. **Upload to S3 staging**:
   ```bash
   aws s3 cp /tmp/nyv-*.tgz s3://nyayavigya-sdk-devapp/deploys/ --sse AES256
   ```
3. **SSM-extract on EC2**:
   ```bash
   aws ssm send-command --instance-ids "$NYV_EC2_INSTANCE_ID" \
     --document-name AWS-RunShellScript \
     --parameters 'commands=["set -e; cd /opt/Nyayavigya/repo; aws s3 cp s3://nyayavigya-sdk-devapp/deploys/<latest>.tgz .; mkdir <ts>-replit-ssm; tar -xzf <latest>.tgz -C <ts>-replit-ssm; ln -snf <ts>-replit-ssm current; cd current; docker compose up -d --force-recreate gateway"]' \
     --comment "deploy <commit>"
   ```
4. **Tag the new image immediately** (lesson from 2026-05-07):
   ```bash
   docker tag nyayavigya-platform-312-gateway:latest nyayavigya-platform-312-gateway:deploy-<ts>
   ```
   so a future auto-rollback doesn't lose the working image.
5. **Health probe**:
   ```bash
   curl -fsS https://api.nyayasiddhi.online/api/nv/health
   curl -fsS -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/gateway/health
   ```
6. **Smoke against EC2** with all 7 SDK keys:
   ```bash
   NYV_GATEWAY=https://api.nyayasiddhi.online npx tsx scripts/nv-smoke-all-platforms.ts
   # Expected: ≥ 95/102 (some EC2-only assertions vary)
   ```

**Rollback** (≤30 s):
```bash
docker tag nyayavigya-platform-312-gateway:rollback-<previous-ts> latest
docker compose up -d --force-recreate gateway
curl -fsS https://api.nyayasiddhi.online/api/nv/health  # confirm green
```

---

## 4. Post-deploy verification — must all PASS

| # | Check | Command |
|---|---|---|
| 4.1 | EC2 gateway health | `curl https://api.nyayasiddhi.online/api/nv/health` |
| 4.2 | EC2 + Replit publish + Replit dev all reachable | `tsx scripts/nv-verify-env-parity.ts` |
| 4.3 | All 7 SDK keys validate against EC2 | `for p in NSP NSPM NSI NSA NSM NYM JRX; do curl -sS -H "X-API-Key: ${!NYV_SDK_KEY_$p}" https://api.nyayasiddhi.online/api/nv/gateway/health -w "$p %{http_code}\n" -o /dev/null; done` |
| 4.4 | SDK key sha256 byte-identical across envs | `tsx scripts/nv-verify-env-parity.ts --json \| jq '.environments\|to_entries\|map({env:.key, sdkSha:(.value.requiredKeysSet // [] \| map(select(.key\|startswith("NYV_SDK_KEY_"))))})'` |
| 4.5 | Storage adapter operational | upload+download a test doc via `/api/nv/sdk/docs-pipeline/...` |

---

## 5. Known EC2 deltas to fix BEFORE next push

These are NOT blockers for "no-code-change" deploys but MUST land before next code push:

1. **NSA + NYM scopes** on EC2 RDS need re-mirror with corrected scope arrays (8 of the 15 EC2 smoke fails). Fix in `mirror-pg.ts` SCOPES map, re-run.
2. **`/api/nv/gateway/usage` 500 "Application not found"** — investigate `sdkApplicationService.getAppUsageAnalytics()` against EC2 app_id range (10–16 vs Replit's 2–9).
3. **PII-vault Redis init race on cold-start** (gotcha in replit.md) — needs `await client.ping()` gate in `src/startup/nv-pii-vault-cleanup.ts`.

---

## 6. WAIT FOR EXPLICIT GO

Per the Option A plan, **no `suggest_deploy` and no EC2 push will execute until you say**:
- "GO Replit publish" → I trigger `suggest_deploy`.
- "GO EC2 push" → I run the SSM deploy sequence.
- "GO both" → publish first, verify, then EC2.

Post-deploy verification (section 4) runs automatically after each gate.
