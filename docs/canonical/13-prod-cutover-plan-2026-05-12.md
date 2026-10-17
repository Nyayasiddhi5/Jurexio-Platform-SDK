# 13 — Production Cutover Plan — 2026-05-12 (Session-15 v19, Task #155)

> Single canonical pre-prod checklist. Each item carries an owner, ETA, and verification command.
> Per **NV-DOC-001** this is the last numbered canonical doc; further status updates append here.
> Per **user policy 2026-05-10**: NO major version bumps until first production deploy. New features ship as additive routes under package version `5.0.1`.

This list MUST be cleared (or each item explicitly waived in writing) before the gateway is promoted from EC2 prod-dev sandbox to a customer-facing production deployment.

## 0. Snapshot at plan time

| Item | Value |
|---|---|
| Live EC2 deploy | `2026-05-11T0436Z-replit-ssm-95d08687` |
| Replit gateway | port 5000, healthy |
| Replit console | port 3004, healthy |
| Last UAT verdict | **NO-GO** (46/55 pre-fix; INDIC_LEGAL routing patched in Task #154; re-run pending) |
| Rate-limit posture | dev-lifted to `internal` for the 5 platform overrides in `config/rate-limits/rate-limits.json` (NSP, NSPM, NYM, NSI, NSA, NSM); JRX inherits default partner tier (§ 1) |
| Auth lifetime posture | dev (24h JWT / 90d refresh) — must tighten (§ 2) |
| EC2 vs Replit drift | EC2 missing Task #154 `default-sequences.ts` change — needs redeploy (§ 3) |
| Maker-checker flag | `NYV_F_GOV_MAKER_CHECKER` OFF (default) (§ 7) |

---

## 1. Revert rate-limit lift to production tiers

| Field | Value |
|---|---|
| **Owner** | Platform on-call |
| **ETA** | 30 min |
| **Why** | `config/rate-limits/rate-limits.json` was lifted to `internal` (effectively unlimited) for NSP/NSPM/NYM/NSI/NSA/NSM during dev/UAT (Session-15 v17). Production must reapply the original tiers. |
| **Action** | For each row in `overrides`: copy `_prod_tier` → `tier`. The `_prod_tier` field carries the original value as a one-line revert. |
| **Verify** | `jq '.overrides[] \| {key, tier, _prod_tier}' config/rate-limits/rate-limits.json` — every row's `tier == _prod_tier`. |
| **Smoke** | `curl -i -H "X-API-Key: $NYV_SDK_KEY_NSP" https://api.nyayasiddhi.online/api/nv/sdk/keys/<keyId>/usage` should reflect production rpm in headers. |

## 2. Tighten auth-token lifetimes (24h/90d → 4h/30d)

| Field | Value |
|---|---|
| **Owner** | Platform on-call |
| **ETA** | 1 h (code edit + redeploy) |
| **Why** | NV-AUTH-LIFETIME-2026-05-10 — current dev/UAT lifetimes (`SECURITY_CONFIG.session.jwtExpiryHours = 24`, `refreshTokenExpiryDays = 90`) exceed prod posture. |
| **Action** | In `src/middleware/nv-auth.ts` (or `src/config/security.ts`) set `jwtExpiryHours = 4` and `refreshTokenExpiryDays = 30`. Verify `expiresIn` in auth routes still derives from config. |
| **Verify** | `rg -n 'jwtExpiryHours|refreshTokenExpiryDays' src/` returns `4` and `30`. Login round-trip + 4h+ token TTL on `/api/nv/auth/me`. |

## 3. EC2 catch-up redeploy (Task #154 INDIC_LEGAL fix) — ✅ DONE 2026-05-12T03:53Z

| Field | Value |
|---|---|
| **Owner** | Platform on-call |
| **Status** | ✅ **DONE** 2026-05-12T03:53Z |
| **Deploy ID** | `2026-05-12T0342Z-replit-ssm-6fd272f8` (commit `6fd272f8`, post Tasks #154 + #155) |
| **SSM commands** | initial=`14b466d3-e38b-4f00-a9b9-9073aa5f725a` (Failed: stale-container collision); fix2=`46135b3d-7253-49c0-94e0-35478397985a` (Success after RDS-cert bind-mount) |
| **S3 artifact** | `s3://nyayavigya-sdk-devapp/deploys/2026-05-12T0342Z-replit-ssm-6fd272f8.tgz` (205 MB) |
| **Live verification** | `api/health` 200 · `/api/nv/health` 200 · `/api/nv/gateway/health` 200 · `/api/nv/gateway/agents` 200 · `console.nyayasiddhi.online` 200 · `nym.nyayasiddhi.online` 200 (all sub-200ms) |
| **Replit-side log** | `.local/replit-deploys.log` |

### 3.1 Findings to fold into §9 (TS errors → make this §3.1 a sibling cleanup)

Two latent gotchas surfaced during the deploy and required in-place SSM fix-ups; both need permanent code fixes before next cutover:

| # | Finding | Permanent fix |
|---|---|---|
| **3.1.a** | Old `nyv-gateway` container blocks rename when compose project name changes per deploy → `Conflict. The container name "/nyv-gateway" is already in use`. | Add `docker rm -f nyv-gateway 2>/dev/null \|\| true` immediately before `docker compose up` in `scripts/deploy-replit-ssm.sh` EC2_SCRIPT (line ~171), OR drop the hard-coded `container_name: nyv-gateway` from `docker-compose.aws-dev.yml` and let compose pick `<project>-gateway-1`. |
| **3.1.b** | `nv-pg-ssl.ts:82` requires `/app/certs/rds-global-bundle.pem` but the **Dockerfile does not `COPY certs/`** (the cert exists in `nyayavigya-platform-312/certs/rds-global-bundle.pem`). Workaround applied: bind-mount via `docker-compose.aws-dev.cert-override.yml` on EC2 + canonical cert at `/opt/Nyayavigya/certs/rds-global-bundle.pem`. | Add `COPY certs ./certs` to the `builder` stage of `nyayavigya-platform-312/Dockerfile` and re-deploy (next time will be one-shot). |

Both should ship as a small follow-up PR before Replit production publish; until then the bind-mount + the 3.1.a `docker rm -f` line keep dev unblocked. |
| **Per-deploy network bridge gotcha** | If the proxy `/health` returns 502 after deploy: `sudo bash /opt/nyayavigya/scripts/nv-bridge-systemd-install.sh` OR manually `docker network connect nyayavigya-platform-312_nyv-net nyv-gateway`. (Verified working in this deploy via the fix-up script.) |

## 4. Deep-AI 70/70 — full UAT must turn green

| Field | Value |
|---|---|
| **Owner** | QA |
| **ETA** | 4–6 h wall-clock (concurrency=4 to avoid the rate-limit confound observed in canonical 09 § B.2) |
| **Why** | Last UAT run (2026-05-12, baseline before Task #154 fix) was 46/55. Item §3 above is the routing fix; remaining ~9 fails were content-quality drift. Re-run is needed to confirm the fix took. |
| **Action** | After §3: `npx tsx scripts/nv-uat-real-world.ts --jurisdiction=all --providers=anthropic,agentzero,sarvam,openai --cot=zero_shot --inject=none --concurrency=4 --out=audit/uat-prod-cutover-$(date -u +%FT%TZ).json` |
| **Verify** | Pass-rate ≥ 95% (66/70 minimum); per-jurisdiction PASS for IN+UK+US+EU+GCC+SG. Append result as canonical 09 Appendix G. |
| **Gate** | NO production cutover unless this is GREEN. |

## 5. OCR adapter — `POST /api/nv5/doc-ai/ocr` first-class route

| Field | Value |
|---|---|
| **Owner** | Platform |
| **ETA** | 1 working day |
| **Why** | Canonical 12 § 4.2 — `/ocr-extraction` is currently a `PhaseCScaffold` stub. Customers uploading scanned PDFs / images today flow through the pdf-parse path which returns empty text for image-only PDFs. |
| **Action** | Wire AWS Textract (existing IAM keys) at `src/services/ocr/textract-adapter.ts`. Mount `POST /api/nv5/doc-ai/ocr` (multipart, `X-API-Key`). Hook into `convert-routes.ts` so any `image/*` or scanned-PDF input flows through OCR transparently. |
| **Verify** | Upload a scanned PDF → expect non-empty `data.text` + `data.blocks[]`. |

## 6. Jurisdictional templates — UK/US/EU/GCC/SG (catch up to IN)

| Field | Value |
|---|---|
| **Owner** | Legal Content |
| **ETA** | ~3 working days (½ day per jurisdiction) |
| **Why** | Canonical 12 § 4.3 — only IN has the explicit 22-template library in `src/services/nyayavigya-document-templates-service.ts`. Other 5 jurisdictions fall through to LLM-only generation (works, but no curated template provenance). |
| **Action** | Per jurisdiction, add 15–20 highest-frequency document types (sourced from country bar association / govt legal-aid sites) to the templates service. |
| **Verify** | `POST /api/nv/sdk/legal/draft` with `jurisdiction:"UK"` returns a templated response (not LLM-only) for the new template types. |

## 7. Maker-checker flag flip — turn ON for governed surfaces

| Field | Value |
|---|---|
| **Owner** | Platform |
| **ETA** | 30 min (env-var flip + smoke) |
| **Why** | `NYV_F_GOV_MAKER_CHECKER` ships OFF by default (Session-11). For NSM (government) and NSI (enterprise) surfaces, the maker-checker quality loop should be ON in production. |
| **Action** | Set `NYV_F_GOV_MAKER_CHECKER=true` in `/opt/Nyayavigya/secrets/.env.production`. Restart gateway via `docker compose restart gateway`. |
| **Verify** | NSM orchestrate call response carries `orchestration.makerCheckerScore` (a number, not undefined). |

## 8. SDK key scope expansion — fill `usage:read`, `cache:read`, `guardrails:read`

| Field | Value |
|---|---|
| **Owner** | Platform on-call |
| **ETA** | 30 min |
| **Why** | Canonical EC2-INTEGRATION-STATUS § C.1 — the live `nyv_live_sk_nsp_tUfo…` Practice-app key carries only 3 scopes; `/usage`, `/cache/stats`, `/guardrails/stats` return 403 with `Insufficient scope. Required: usage:read`. NSP integration team will need these for live observability. |
| **Action** | Update `sdk_app_api_keys.scopes` jsonb for the production NSP/NSPM/NSI/NSA/NSM/JRX/NYM rows to include `usage:read`, `cache:read`, `guardrails:read`. Use the canonical script (NV-DB-SCRIPT-001 — `makePgSql()` from `scripts/_pg-pool.ts`, NOT the neon-serverless HTTP driver). |
| **Verify** | Re-run the EC2-INTEGRATION-STATUS § C smoke; expect 200 on all 7 endpoints for all 7 keys. |

## 9. Pre-existing TS errors cleanup

| Field | Value |
|---|---|
| **Owner** | Platform |
| **ETA** | ½ day |
| **Why** | Canonical 12 § 1.4 item 3. Does not block runtime, but blocks `npm run guardrail` (combined chain). |
| **Action** | `npx tsc --noEmit` → fix the residual errors in `src/routes/nv-sdk-cam-routes.ts` and any siblings. |
| **Verify** | `npm run guardrail` exits 0. |

## 10. Postman + OpenAPI re-export and tag a release

| Field | Value |
|---|---|
| **Owner** | Platform |
| **ETA** | 30 min |
| **Why** | OpenAPI must be the single source of truth at the cutover SHA (NV-API-CONTRACT-001). Postman collection is currently in sync (1242 ops post-Task-154); re-confirm. |
| **Action** | `npx tsx scripts/generate-openapi-spec.ts && npm run guardrail:api-contract && bash scripts/regenerate-postman-from-openapi.sh` (whichever exists in the repo at cutover time). Tag the release in CHANGELOG.md (additive only; no major bump per user policy). |
| **Verify** | `npm run guardrail:api-contract` exits 0. Postman op count matches OpenAPI op count. |

---

## Summary table (sorted by gate criticality)

| # | Item | Owner | ETA | Gate? |
|---|---|---|---|---|
| 1 | Rate-limit revert | Platform on-call | 30 min | **YES** |
| 2 | Auth-lifetime tighten | Platform on-call | 1 h | **YES** |
| 3 | EC2 catch-up redeploy | Platform on-call | 15 min | **YES** |
| 4 | Deep-AI 70/70 | QA | 4–6 h | **YES — hard gate** |
| 5 | OCR adapter | Platform | 1 day | NO (deferable post-cutover) |
| 6 | Jurisdictional templates UK/US/EU/GCC/SG | Legal Content | 3 days | NO (LLM fallback works) |
| 7 | Maker-checker ON | Platform | 30 min | YES (NSM/NSI surfaces) |
| 8 | SDK scope expansion | Platform on-call | 30 min | YES (NSP observability) |
| 9 | TS errors cleanup | Platform | ½ day | NO (runtime not blocked) |
| 10 | Postman+OpenAPI re-export | Platform | 30 min | YES (NV-API-CONTRACT-001) |

**Realistic earliest cutover window**: 4 working days from explicit user GO, assuming items 5/6/9 are deferred to a post-cutover sprint.

---

## Rollback recipe (≤30 s)

```bash
# On EC2 (via SSM or local shell)
docker tag nyayavigya-platform-312-gateway:rollback-pre-cutover-<TS> nyayavigya-platform-312-gateway:latest
docker stop nyv-gateway && docker rm nyv-gateway
docker compose -f docker-compose.aws-dev.yml up -d --no-deps gateway
docker network connect --alias gateway nyayavigya-platform-312_nyv-net nyv-gateway   # if needed
docker exec nyv-console nginx -s reload
```

Tag the rollback target BEFORE step 3 above:
```bash
docker tag nyayavigya-platform-312-gateway:latest \
  nyayavigya-platform-312-gateway:rollback-pre-cutover-$(date -u +%Y%m%dT%H%M%SZ)
```
