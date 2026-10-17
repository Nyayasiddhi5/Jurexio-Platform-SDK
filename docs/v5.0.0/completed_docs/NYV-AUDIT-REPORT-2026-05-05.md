---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# Nyayavigya Platform — Comprehensive Configuration Audit
**Date:** 2026-05-05  •  **Target version:** v5.0.0  •  **Conducted by:** Replit Agent

This document is the **single source of truth** for the audit of API keys, SDK keys,
config files, database schema, agents registry, health-check configuration, and
storage paths. Every finding below is severity-ranked and has a concrete fix.

---

## 1 · Executive Summary

The platform is **functionally healthy on Replit** (gateway up, all 5 Redis subsystems
active, all 7 SDK keys authenticate end-to-end), but has accumulated **significant
configuration drift** from being mid-migration through 3 architectural transitions
simultaneously:

| Transition | Status | Impact |
|---|---|---|
| `nv_api_keys` → `sdk_app_api_keys` (NYV-NS-016) | Mid-flight | Keys minted in legacy table did not authenticate until manually mirrored |
| `public.*` → `nv_schema.*` (governance schema split) | Partial | 8 tables exist in both schemas; runtime reads inconsistent |
| `v3.1.2` → `v5.0.0` (product version) | Inconsistent | `package.json` says 3.1.2; health endpoint says 5.0.0; multiple mid-versions in code |

**Total findings:** 20 (4 critical • 6 high • 6 medium • 4 low).
The **CRITICAL** findings are tracked individually below and require approval before
remediation. The HIGH/MEDIUM/LOW can be remediated in batch under user direction.

---

## 2 · API Keys & Secrets Audit

### 2.1 Currently configured in Replit Secrets (verified)
| Env var | Service | Status |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI LLM | ✅ Active |
| `OPENROUTER_API_KEY` | OpenRouter LLM gateway | ✅ Active |
| `SARVAM_API_KEY` | Sarvam (Indic LLM/STT) | ✅ Active |
| `NYV_SDK_KEY_NSP` | Nyayasiddhi Professional SDK | ✅ Active (200 OK) |
| `NYV_SDK_KEY_NSI` | Nyayasiddhi Institutional SDK | ✅ Active (200 OK) |
| `NYV_SDK_KEY_NSA` | Nyayasiddhi Academy SDK | ✅ Active (200 OK) |
| `NYV_SDK_KEY_NSM` | Nyayasiddhi Ministry SDK | ✅ Active (200 OK) |
| `NYV_SDK_KEY_NYM` | Nyayamitra Citizen SDK | ✅ Active (200 OK) |
| `NYV_SDK_KEY_NSPM` | Nyayasiddhi Professional Mobile SDK | ✅ Active (200 OK) |
| `NYV_SDK_KEY_JRX` | JurisX SDK | ✅ Active (200 OK) |
| `JWT_SECRET` + `NYV_JWT_SECRET` + `NYV_JWT_REFRESH_SECRET` | Auth tokens | ⚠️ See finding A1 |
| `ENCRYPTION_KEY` | Field encryption | ⚠️ See finding A4 |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `NYV_AWS_REGION` | AWS S3 / SSM | ✅ Active |
| `NYV_S3_BUCKET` + `NYV_DEPLOY_BUCKET` | Document & deploy buckets | ⚠️ See finding A5 |
| `NYV_REDIS_TCP_URL` + `NYV_REDIS_WRITE_URL` + `REDIS_URL` | Upstash Redis | ⚠️ See finding A2 |
| `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | Source mirror | ✅ Active (CI/CD only) |
| `NYV_EC2_INSTANCE_ID` | Deployment target | ✅ Active |
| `DATABASE_URL` | Neon PostgreSQL | ✅ Active |

### 2.2 CRITICAL findings — API keys & secrets

#### A1 · JWT secret triple-naming  ⚠️ **CRITICAL**
- **Issue:** Three env-var names refer to the same logical JWT signing secret:
  - `JWT_SECRET` (read by `src/middleware/nv-auth.ts:17`, `src/middleware/nv-sdk-gateway.ts:245`)
  - `NYV_JWT_SECRET` (read by `src/config/nyv-master-config.ts:820`, `src/config/nyv-scale-config.ts:449`)
  - `NS_JWT_SECRET` (read by `src/startup/nv-jwt-rotation-monitor.ts`)
- **Risk:** A token signed with one secret will fail verification at any code path that reads a different secret. Today it works only because all 3 env vars happen to hold the same value.
- **Fix:** Centralize via `src/config/nyv-master-config.ts` — `secret: env('NYV_JWT_SECRET', env('JWT_SECRET', ''))` — and refactor all callers to import this single constant. Remove `NS_JWT_SECRET` references entirely.

#### A2 · Redis URL chaos  ⚠️ **CRITICAL** (mitigated by multi-URL resolver)
- **Issue:** Three env vars hold a Redis URL:
  - `NYV_REDIS_TCP_URL` is **malformed** in current Replit Secrets (`ediss://` — chopped scheme)
  - `NYV_REDIS_WRITE_URL` is **canonical** (`rediss://default:...@xxx.upstash.io:6379`)
  - `REDIS_URL` is the Upstash REST URL (`https://...`) — NOT a TCP URL
- **Risk mitigated by:** `src/utils/redis-tcp-url.ts` and the multi-URL resolver pattern (`_isValidScheme()` filters out invalid URLs before connecting).
- **Fix:** Repair `NYV_REDIS_TCP_URL` to a valid `rediss://...` value, OR delete it entirely so the resolver picks `NYV_REDIS_WRITE_URL` cleanly. Then standardize all Redis-using code to import a single helper from `src/utils/redis-tcp-url.ts`.

### 2.3 HIGH findings

#### A3 · OpenAI key fallback chain (`OPENAI_API_KEY` vs `AI_INTEGRATIONS_OPENAI_API_KEY`)
- Multiple files attempt both names with fallback; hard to audit. Standardize on `OPENAI_API_KEY`.

#### A4 · Encryption key triple-naming
- `ENCRYPTION_KEY`, `NYV_FIELD_ENCRYPTION_KEY`, `NV_PII_ENCRYPTION_KEY` all read in different places.
- Fix: Standardize on `ENCRYPTION_KEY`; refactor `src/services/field-encryption-service.ts` and `src/packages/security/encryption-service.ts` to import from `src/config/nyv-master-config.ts`.

#### A5 · S3 bucket dual-naming
- `AWS_S3_BUCKET` and `NYV_S3_BUCKET` both read; `nv-service-urls.ts:28` uses `AWS_S3_BUCKET || NYV_S3_BUCKET`.
- Fix: Drop `AWS_S3_BUCKET`. Use `NYV_S3_BUCKET` only.

### 2.4 MEDIUM findings

#### A6 · Missing-from-Replit-Secrets (referenced in code, not configured)
| Env var | Read by | Recommended action |
|---|---|---|
| `XAI_API_KEY` | `xai-provider.ts` | Add or remove provider |
| `GROQ_API_KEY` | `groq-provider.ts` | Add or remove provider |
| `DEEPSEEK_API_KEY` | `deepseek-provider.ts` | Add or remove provider |
| `TOGETHER_API_KEY` | (LLM provider) | Add or remove provider |
| `MISTRAL_API_KEY` | (LLM provider) | Add or remove provider |
| `KLING_AI_API_KEY` | `hd-video-generator.ts` | Add or remove feature |

These create the "10/17 healthy" alarm in the LLM-provider health check. See finding F2.

### 2.5 LOW findings

#### A7 · Dead env vars in `.env.production` (defined, never read)
`META_API_KEY`, `HUGGINGFACE_API_KEY`, `DEEPGRAM_API_KEY`. Remove from `.env.production`.

#### A8 · Hardcoded secrets in `.env.production`
`POSTGRES_PASSWORD`, `NYV_JWT_SECRET`, `SECRET_KEY` are present as plaintext strings.
For production these should be SSM SecureString or environment-injected. The current
`.env.production` file should be `.env.production.example` with placeholder values.

---

## 3 · SDK Keys & Tables Audit

### 3.1 Three tables hold SDK key data
| Table | Schema | Rows | Role | Action |
|---|---|---|---|---|
| `nv_api_keys` | public | 40 | **LEGACY** — still seeded by `nv-seed-sdk-keys.ts` | DROP after v3.2 sunset |
| `nv_sdk_applications` | public | 14 | **LEGACY** — FK target for `nv_api_keys` | DROP after v3.2 sunset |
| `sdk_app_api_keys` | public | 7 | **CANONICAL** (NYV-NS-016) — read by gateway middleware | KEEP |
| `sdk_applications` | public | 8 | **CANONICAL** (NYV-NS-016) — FK target for `sdk_app_api_keys` | KEEP |
| `nv_schema.sdk_app_api_keys` | nv_schema | 0 | **ORPHAN** — third copy, unused | DROP |
| `nv_org_api_keys` | public | ? | Org-tier keys (separate concern from SDK keys) | KEEP |

### 3.2 Bridge applied (2026-05-05)
The `scripts/nv-mirror-sdk-keys-to-canonical.ts` script bridges legacy → canonical
on every key issuance. Until v3.2 sunset, this script MUST run after `nv-seed-sdk-keys.ts`
and after every `nv-db-sync-to-ec2.sh`.

### 3.3 7 Platforms, fully wired (verified 200 OK end-to-end)
| Platform | env var | client_id | tier | rate-limit |
|---|---|---|---|---|
| Nyayasiddhi Professional™ | `NYV_SDK_KEY_NSP` | `nyv_app_nsp_v5` | pro | 60/min |
| Nyayasiddhi Institutional™ | `NYV_SDK_KEY_NSI` | `nyv_app_nsi_v5` | enterprise | 600/min |
| Nyayasiddhi Academy™ | `NYV_SDK_KEY_NSA` | `nyv_app_nsa_v5` | pro | 80/min |
| Nyayasiddhi Ministry™ | `NYV_SDK_KEY_NSM` | `nyv_app_nsm_v5` | government | 200/min |
| Nyayamitra™ Citizen App | `NYV_SDK_KEY_NYM` | `nyv_app_nym_v5` | plus | 100/min |
| Nyayasiddhi Professional Mobile™ | `NYV_SDK_KEY_NSPM` | `nyv_app_nspm_v5` | pro | 60/min |
| JurisX™ | `NYV_SDK_KEY_JRX` | `nyv_app_jrx_v5` | enterprise | 400/min |

---

## 4 · Database / Drizzle Schema Audit

### 4.1 Top-level inventory
- **188 total tables** across 2 schemas: `public` (93) + `nv_schema` (95)
- **6 Drizzle schema files** loaded by `drizzle.config.ts`:
  - `shared/schema.ts` — 1813 lines, 87 pgTable defs (mega-file)
  - `shared/nv-schema-tables.ts` — 567 lines, 0 pgTable defs (helpers/types only)
  - `shared/nv-governance-schema.ts` — 1333 lines, 0 pgTable defs (types only)
  - `shared/nyayamitra-schema.ts` — 32 lines, 2 pgTable defs (single-platform)
  - `shared/nyayasiddhi-academy-schema.ts` — 31 lines, 2 pgTable defs
  - `shared/nyayasiddhi-institutional-schema.ts` — 29 lines, 2 pgTable defs
  - `shared/nyayasiddhi-ministry-schema.ts` — 29 lines, 2 pgTable defs
- **7 Drizzle migrations** in `migrations/` (0000–0006) — version-controlled

### 4.2 Same-name tables in BOTH schemas (split-brain risk)
These tables exist in `public` AND `nv_schema` — runtime reads can pick the wrong one:
| Table | public version | nv_schema version | Recommendation |
|---|---|---|---|
| `nv_agent_personas` | stale | newer (has `system_prompt`) | DROP `public` version |
| `nv_audit_logs` | stale | newer (has `action_hash`) | DROP `public` version |
| `nv_grpo_runs` | ? | ? | Investigate |
| `nv_sdk_usage_metrics` | ? | ? | Investigate |
| `nv_statutes` | ? | ? | Investigate |
| `pii_vault` | ? | ? | Investigate |
| `sdk_api_request_logs` | ? | ? | Investigate |
| `sdk_app_api_keys` | canonical (used) | empty (orphan) | DROP `nv_schema` version |

### 4.3 CRITICAL Drizzle ↔ PG mismatches
| Mismatch | File | SQL fix |
|---|---|---|
| `pii_vault.id` is `uuid` in Drizzle but `varchar` in PG | `shared/schema.ts` | `ALTER TABLE public.nv_pii_vault ALTER COLUMN id TYPE uuid USING id::uuid;` |
| `nyayamitra_users` defined in Drizzle but missing in PG | `shared/nyayamitra-schema.ts` | `npx drizzle-kit push` (after review) |

### 4.4 Index drift
PG has HNSW vector indexes on `nv_pgvector_*` tables that Drizzle doesn't model.
Maintained manually via `scripts/nv-pgvector-init.sql`. Not a runtime risk; just a
documentation gap.

### 4.5 Recommended cleanup (gated on approval)
Severity-ordered SQL — execute in this order, one transaction per item:
```sql
-- 1. Drop FK constraint preventing legacy table removal
ALTER TABLE public.nv_api_keys DROP CONSTRAINT IF EXISTS nv_api_keys_app_id_fkey;

-- 2. Migrate any unique data from legacy tables (none expected — keys are mirrored)
-- Verify: SELECT COUNT(*) FROM public.nv_api_keys WHERE id NOT IN (SELECT 'nvkey-demo-' || ...);

-- 3. Drop legacy SDK tables
DROP TABLE IF EXISTS public.nv_api_keys;
DROP TABLE IF EXISTS public.nv_sdk_applications;

-- 4. Drop orphan nv_schema.sdk_app_api_keys
DROP TABLE IF EXISTS nv_schema.sdk_app_api_keys;

-- 5. Drop stale public-side duplicates
DROP TABLE IF EXISTS public.nv_agent_personas;
DROP TABLE IF EXISTS public.nv_audit_logs;
-- (After confirming no active code reads them)

-- 6. Fix pii_vault id type
ALTER TABLE public.nv_pii_vault ALTER COLUMN id TYPE uuid USING id::uuid;
```

---

## 5 · Config Files & Version Pinning Audit

### 5.1 Version inconsistency (HIGH)
| Location | Value | Should be |
|---|---|---|
| `package.json` line 3 | `"version": "3.1.2"` | `"version": "5.0.0"` |
| `src/index.ts` line 10 | `@version 3.1.2` | `@version 5.0.0` |
| `src/config/nyv-master-config.ts:65` | `version: '3.1.2'` | `version: '5.0.0'` |
| `src/config/nv-product-config.ts:13` | `version: '3.1.2'` | `version: '5.0.0'` |
| `src/config/nyv-sdk-production-config.ts:9` | `version: '3.1.2'` | `version: '5.0.0'` |
| `/api/nv/health` response | `vv5.0.0` (extra `v` prefix) | `5.0.0` |
| `src/config/platform-config.ts:604` | `version: '1.0.0'` | `version: '5.0.0'` |

**Fix:** A single one-line constant in `src/config/nyv-master-config.ts`
(`export const NYV_PLATFORM_VERSION = '5.0.0';`) imported by every other config file.
Update `package.json` to `5.0.0`. Strip the duplicate `v` in `health` route.

### 5.2 Drizzle config — too many schema files
Recommendation: Merge the 4 micro-schema files (32 lines each) into `shared/schema.ts`
under named sections (`// ── Nyayamitra ──`, `// ── Academy ──`, etc.). One source
of truth = one file (or at most one file per logical bounded context).

### 5.3 Master config canonical-ness check
- `src/config/nyv-master-config.ts` ✅ — canonical config consumer (uses `env(...)` helper)
- `src/config/nv-service-urls.ts` ❌ — duplicate consumer (different fallback chains)
- `src/config/nyv-sdk-production-config.ts` ❌ — duplicate consumer (different env vars)
- `src/config/nyv-scale-config.ts` ❌ — duplicate consumer

**Fix:** Make `nyv-master-config.ts` the single config-reader. All other configs import from it.

---

## 6 · Agents Registry Audit

### 6.1 Runtime state (verified healthy)
- 1042 agents loaded across 7 jurisdictions (IN: 149, UK: 149, US: 149, GC: 149, SG: 149, EU: 149, DEFAULT: 148)
- Loaded from JSON registry files at startup, NOT from DB
- DB `legal_agents` table has only 275 rows — **mismatch is intentional** (DB stores executions/metrics, not the registry itself)

### 6.2 Registry file location (VERIFIED)
The 1042 agents are loaded at gateway startup from JSON registry files at:
```
config/agent-registries/Nyayavigya-Legal-registry-{IN,UK,US,GC,SG,EU,Default}.json
```
Each file is ~7 MB and contains ~149 agents per jurisdiction. The loader is
`src/services/jurisdiction-agents/jurisdiction-overlay-service.ts` (referenced
from `src/routes/nv-sdk-gateway-routes.ts:158`).

**Archive note:** The pre-v5 registry files are preserved at
`config/agent-registries/.archive-v3-pre-v5-upgrade/` for rollback.

### 6.3 De-dupe done in 2026-04-29
Per `replit.md`, India's 148 `IN::<x>` duplicates were removed from `legal_agents` table
(see NYV-NS-025). Future India agent inserts should go through `IN.json` registry only.

---

## 7 · Health Check Audit (False Alarms)

### 7.1 Endpoints
| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/nv/health` | GET | none | Basic aggregator |
| `/api/nv/health/full` | GET | none | Detailed diagnostics |
| `/api/nv/admin/health/full` | GET | JWT (admin) | + circuit breakers, queue depths |
| `/api/nv/sdk/provision/health` | POST | SDK key | Client→Server health ping |

### 7.2 False alarm root causes
| Finding | Severity | File | Fix |
|---|---|---|---|
| F1 · Memory threshold 85% too sensitive (container often at 88% normal) | HIGH | `src/services/nv-memory-manager.ts:272` | Raise `pressureElevatedPct` to 90, `pressureCriticalPct` to 98 |
| F2 · LLM "10/17 healthy" reported as degraded; really 7 unconfigured providers | HIGH | `src/services/real-llm-service.ts:2408` | Mark missing-key providers as `unconfigured`, not `failed`; threshold for `degraded` lowered to <50% configured |
| F3 · Redis "degraded" when REST fallback works | MEDIUM | `src/routes/nv-health-full-routes.ts` | Report `healthy` with `transport: "rest"` |
| F4 · Storage health uses HARDCODED 100GB mock | MEDIUM | `src/routes/nv-health-routes.ts:318` | Replace with `fs.statfs('/')` call |
| F5 · `/sdk/provision/health` Zod schema rejects extra fields → false 400s | MEDIUM | `src/routes/nv-sdk-provision-routes.ts:258` | Add `.passthrough()` to schema |
| F6 · Health response shows `vv5.0.0` (double v) | LOW | `src/routes/nv-health-routes.ts` | Strip the prefix `v` |

---

## 8 · Storage Paths Audit

### 8.1 Per-platform path scheme (current)
- All 7 platforms share a single S3 bucket: `${NYV_S3_BUCKET}` (default `nyv-documents`)
- Per-platform separation is by S3 prefix: `s3://nyv-documents/{platform_short}/{tenant_id}/...`
- Document ingestion: `nv-document-intelligence-orchestrator.ts` writes to `storage_path` column in DB
- Output (parsed JSON): separate `parsed_json_path` column

### 8.2 Recommended canonical path scheme (proposal)
```
s3://nyv-documents/v5.0.0/{platform_short}/{tenant_id}/raw/{sha256}.{ext}
s3://nyv-documents/v5.0.0/{platform_short}/{tenant_id}/parsed/{document_id}.json
s3://nyv-documents/v5.0.0/{platform_short}/{tenant_id}/embeddings/{document_id}.bin
```
Where `platform_short` ∈ {`nsp`, `nsi`, `nsa`, `nsm`, `nym`, `nspm`, `jrx`}.

---

## 9 · Recommended Remediation Order

Priority order — execute approval-gated:

### Phase 1 — Configuration cleanup (non-destructive, can do now)
1. Pin all version strings to `5.0.0` (single constant in `nyv-master-config.ts`)
2. Centralize JWT secret read (single helper)
3. Centralize Redis URL resolution (already done in `redis-tcp-url.ts`; refactor remaining callers)
4. Centralize encryption key read
5. Drop duplicate S3 bucket env var
6. Add missing LLM provider keys OR remove unused providers
7. Fix all 6 health-check false alarms

### Phase 2 — Schema cleanup (DESTRUCTIVE — needs approval)
8. Drop `nv_schema.sdk_app_api_keys` (orphan, 0 rows)
9. Drop `public.nv_agent_personas` (stale duplicate)
10. Drop `public.nv_audit_logs` (stale duplicate)
11. Investigate the other 5 cross-schema duplicates
12. Drop `nv_api_keys` + `nv_sdk_applications` legacy tables (after v3.2 sunset)
13. Fix `pii_vault.id` type mismatch
14. Merge 4 micro-schema files into `shared/schema.ts`

### Phase 3 — Production hardening
15. Move `.env.production` plaintext secrets to SSM SecureString
16. Generate proper Drizzle baseline snapshot (`drizzle-kit introspect`)
17. Add CI check that fails if Drizzle ↔ PG diverges

### Phase 4 — EC2 mirror (after Phases 1-3)
18. Wipe EC2; redeploy clean v5.0.0
19. Sync cleaned DB to EC2
20. Push 7 SDK keys to EC2 via SSM
21. Re-run `nv-mirror-sdk-keys-to-canonical.ts` on EC2

---

## 10 · Public API & SDK URL (Replit-side)

See companion document: **`NYV-REPLIT-API-CHEATSHEET.md`** — contains the public URL
of this Replit gateway plus copy-paste curl/JS snippets per platform.
