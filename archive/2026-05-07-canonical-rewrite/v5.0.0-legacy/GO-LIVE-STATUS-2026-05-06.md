---
status: live
audience: platform owner, engineering leads, ops, downstream NSP/NYM/NSI/NSA/NSM/JRX/NSPM teams
version: 5.0.1
last_updated: 2026-05-06T19:00Z
supersedes: docs/v5.0.0/completed_docs/V5-READINESS-PLAN-2026-05-06.md
session_history: docs/v5.0.0/completed_docs/SESSION-7-COMPLETION-AUDIT-2026-05-06.md
---

# Nyayavigya Platform v5.0.1 — Go-Live Status (2026-05-06)

> Single read-this-first answer to: **what is built, what works, what's
> left to ship the Nyayasiddhi ecosystem to production.**
>
> Categories: SDK status, API status, Dashboard (Console UI) status,
> AI/Cohesiveness status, and the Pending list to go live to all 7
> downstream platforms (NSP-Web, NSP-Mobile, NYM, NSI, NSA, NSM, JRX).

---

## 1. Headline

| Layer | State | Confidence | Blockers to GA |
|---|---|---|---|
| Gateway (Express 5 / Node 22) | **PROD-READY on dev EC2** | High | Prod cutover (operator-gated) |
| Database (PG 16.6 + Drizzle) | **PROD-READY** | High | RDS migration toggle (terraform flag) |
| Cache (Redis 7.1) | **DEGRADED in dev** (Upstash 500k cap hit) | Medium | ElastiCache cutover (operator-gated) |
| Authentication (JWT + RBAC + tenant isolation) | **PROD-READY** | High | None |
| SDK gateway (key auth, scopes, rate limit, tier) | **PROD-READY** | High | None |
| Document Management (DMS Phase 2A) | **MOUNTED + GUARDED** | High | True end-to-end streaming (adapter overload pending) |
| HITL + SLA escalation | **LIVE** | High | None |
| Webhook delivery | **LIVE** with signing/retry/DLQ | High | DNS-rebinding hardening (P2) |
| Drift monitor + ROMA L5 conformance | **LIVE** | High | None |
| Console UI (React 19 + Vite) | **LIVE** | High | Production build for EC2 |
| Observability (OTel + Sentry) | **LIVE** | High | Sentry org/project provisioning |
| Audit-chain (hash-chained governance log) | **LIVE** + recovery script | High | None |
| Public/consumer SDK packages | **5 of 6 published, 1 publish-ready** | Medium | npm-publish token (FU-T014) |

**Single biggest item left:** operator-driven `pnpm preflight && pnpm deploy`
to the prod EC2 host fronting `api.nyayasiddhi.online`, plus the
ElastiCache + RDS cutover toggle in `infra/terraform/envs/dev-edge/`.

---

## 2. SDK Status (per-platform key, scopes, docs, package)

Source of truth for live key scopes: `sdk_app_api_keys.scopes` in
`nv_schema` (DB). Source of truth for variant defaults:
`src/config/nv-sdk-variants.ts` (only governs NEW keys minted from this
config). Doc reconciled in Session 3 (T005); Session 7 added 3 missing
platform docs (NSA / NSM / RAG-AUDIT).

| Platform | Key var | Variant code | Scopes (live in DB) | Doc | Package | State |
|---|---|---|---|---|---|---|
| **NSP-Web** (law firms) | `NYV_SDK_KEY_NSP` | `nyayasiddhi-pro-web` | `agents:execute`, `research:read`, `documents:read/write`, `enterprise:research`, `enterprise:assets` | `docs/v3.1.2/SDK-PLATFORM-NSP-WEB.md` | `@nyayavigya/client-sdk` (web) | **LIVE** |
| **NSP-Mobile** (law firms) | `NYV_SDK_KEY_NSPM` | `nyayasiddhi-pro-mobile` | NSP-Web scopes + `voice:read/execute` | `docs/v3.1.2/SDK-PLATFORM-NSP-MOBILE.md` | `@nyayavigya/client-sdk-react-native` | **LIVE** |
| **NYM** (consumer aid) | `NYV_SDK_KEY_NYM` | `nyayamitra` | `agents:execute`, `research:read`, `documents:read/write`, `translate:write`, `consumer_intake:write` | `docs/v3.1.2/SDK-PLATFORM-NYAYAMITRA.md` | `@nyayavigya/nyayamitra-sdk` | **LIVE** |
| **NSI** (institutional) | `NYV_SDK_KEY_NSI` | `nys-institutional` | wildcard `*` | `docs/v3.1.2/SDK-PLATFORM-NSI.md` | shared client-sdk | **LIVE** |
| **NSA** (academy) | `NYV_SDK_KEY_NSA` | `nys-academy` | `agents:execute`, `research:read`, `documents:read`, `translate:write` | `docs/v3.1.2/SDK-PLATFORM-NSA.md` (Session 7) | shared client-sdk | **LIVE** |
| **NSM** (ministry) | `NYV_SDK_KEY_NSM` | `nys-ministry` | wildcard `*` (gov tier) | `docs/v3.1.2/SDK-PLATFORM-NSM.md` (Session 7) | shared client-sdk | **LIVE** |
| **JRX** (judicial-research-x) | `NYV_SDK_KEY_JRX` | `judicial-research-x` | wildcard `*` | `docs/v3.1.2/SDK-PLATFORM-JRX.md` | shared client-sdk | **LIVE** |
| **RAG-AUDIT** (cross-cutting) | n/a (key per-org) | n/a | requires `enterprise:research` + `enterprise:assets` | `docs/v3.1.2/SDK-PLATFORM-RAG-AUDIT.md` (Session 7) | n/a | **LIVE** |

### SDK gateway features (all LIVE)

- **Key rotation with grace** — `POST /api/nv/api-keys/:id/rotate`,
  default 7-day grace clamped to [0,30]. Old + new key both work
  during the window. (4-test suite green.)
- **Per-key tier enforcement** — `nv-redis-platform-rate-limiter.ts`
  reads `req.sdkApp?.tier` (free/pro/enterprise/gov).
- **Scope gate** — `enterprise:research` required for
  `/api/nv/sdk/enterprise/research/*` and
  `/api/nv/sdk/enterprise/search/web`; `enterprise:assets` for
  `/api/nv/sdk/enterprise/assets/*`. Not downgraded for any platform.
- **Share-grant enforcement** — `POST /sdk/documents/:docId/share`
  verifies caller is canonical owner from
  `nv_schema.nv_document_ingest_status` (returns 403
  `NOT_DOCUMENT_OWNER`). `DELETE /sdk/grants/:id` verifies caller is
  grant owner (returns 403 `NOT_GRANT_OWNER`). 7-test suite green.

### SDK package publishing — open items

- Inter-package dependency pinning at `^5.0.0` confirmed in all 6
  `packages/*/package.json`.
- **Open**: npm-publish token (FU-T014). Once provided, `npm publish`
  the 6 packages to private registry (PROPRIETARY license).
- **Open**: `examples/*/package.json` flip from `file:` → `^5.0.0`
  after publish.

---

## 3. API Status (Gateway endpoints)

OpenAPI 3.1 spec auto-generated by walking the Express router stack —
**1116 paths, 1199 operations across 84 mount points** (Session 7 T012).

| Surface | Live? | Path prefix | Notes |
|---|---|---|---|
| **OpenAPI machine spec** | ✅ | `GET /api/nv/openapi.json` | 200 OK, 1116 paths |
| **Swagger UI (human)** | ✅ | `GET /api/nv/docs/swagger` | 200 OK |
| Public health | ✅ | `GET /api/nv/health`, `/api/nv/health/full`, `/api/nv/ready` | All green on dev EC2 |
| Auth + RBAC | ✅ | `POST /api/nv/auth/{login,refresh,logout}` | JWT + refresh rotation |
| Org / user admin | ✅ | `/api/nv/admin/{users,orgs,stats}` | requires `admin\|org_admin\|super_admin` |
| **DMS admin** | ✅ | `/api/nv/admin/dms/{config,share-stats,auto-share-test}` | **Now JWT+admin gated (Session 7 fix)** — was anonymous |
| SDK consumer surface | ✅ | `/api/nv/sdk/**` | All key+scope gated |
| Document orchestrator | ✅ | `/api/nv/documents/{upload,list,search,:docId/status}` | 1 GB upload, multer disk-backed, error-path cleanup |
| **Drift monitor** | ✅ | `GET /api/nv/drift/agents` | Real backend (was Phase C stub) |
| HITL queue + SLA timer | ✅ | `/api/nv/hitl/**` | 60s tick, escalates per `agent.escalationPath` |
| Webhook delivery | ✅ | dispatcher in `services/queue/webhook-dispatcher.ts` | HMAC sign, retry, DLQ, SSRF guard |
| 22 agentic patterns | ✅ | `/api/nv/patterns/*` | P01–P22 |
| LLM router (17 providers) | ✅ | wrapped in `real-llm-service.ts` | Opossum breakers + cost-aware |
| Audit-chain log | ✅ | governance writes via `nv-audit-service` | Recovery script `scripts/nv-audit-chain-repair.sh` |

### Known runtime constraints

- 6 LLM research/query smoke endpoints **fail with 25s timeout** in dev
  due to Upstash Redis 500k command-quota cap. **NOT a regression** —
  fixed by ElastiCache cutover (terraform flag) or Upstash plan bump.
- Adapter `createReadStream` overload is pending — orchestrator still
  does one `readFile` into memory before the storage adapter call. RAM
  bound is now `concurrent_uploads × file_size`, not `parser + upload`.

---

## 4. Dashboard (Central Console UI) Status

| Surface | State | Notes |
|---|---|---|
| Login + session | ✅ | Vite alias bug fixed Session 6; login renders correctly |
| Sidebar (`NyvSidebar`) | ✅ | Single source of truth; duplicates deleted Session A |
| **Sidebar regression sweep** | ✅ 133/133 | Vitest dynamic-import every page; no soft-pass on `@/` errors |
| 14 Phase C pages | ✅ | 13 already on disk + `rag-kb.tsx` shipped |
| SDK Hub (`/sdk-hub`) | ✅ | Quick Access + 6-platform tile grid |
| SDK API Playground (`/sdk-playground`) | ✅ | Live key picker + endpoint runner |
| SDK Key Management (`/sdk-key-management`) | ✅ | List + rotate + grace-window display |
| SDK Onboarding (`/sdk/onboarding`) | ✅ | Per-platform welcome + scope explainer |
| SDK Testing Console (`/sdk-testing`) | ✅ | One-click smoke runner |
| SDK API Tester (`/sdk/api-tester`) | ✅ | Per-endpoint try-it |
| Smoke Harness Console (`/smoke-harness-console`) | ✅ | UI for `nv-smoke-bash.sh` |
| Document AI Hub (`/document-ai-hub`) | ✅ | Real backend wiring |
| OCR Extraction (`/ocr-extraction`) | ✅ | 14-language OCR queue UI |
| Summarization (`/summarization`) | ✅ | |
| Prompt Library (`/prompt-library`) | ✅ | |
| Tools / MCP (`/tools-mcp`) | ✅ | 502 in code; 102 live in DB (re-seed pending) |
| Statutes & Citations (`/statutes-citations`) | ✅ | 305 statutes seeded |
| Jurisdiction Mapping (`/jurisdiction-mapping`) | ✅ | 6 jurisdictions + DEFAULT |
| Web Scraping Targets (`/web-scraping-targets`) | ✅ | |
| DPDPA Compliance (`/dpdpa-compliance`) | ✅ | |
| Platform Health Map (`/platform-health-map`) | ✅ | |
| Live Activity Feed (`/live-activity-feed`) | ✅ | |
| My Approvals (`/my-approvals`) | ✅ | HITL inbox |
| RAG KB (`/rag-kb`) | ✅ | Phase C completion (Session 6) |
| Super-admin pages (`/superadmin/*`) | ✅ | agents, compliance, llm-budget, organisations, platforms |
| TwinDesk (`/twindesk`) | ✅ | Digital-twin creator |
| White-label admin (`/white-label`) | ✅ | |
| **ESLint mock-data rule** | ✅ | `eslint-rules/no-mock-data.js` enforced on `client/src/pages/**` |

### Console scope discipline (RECONFIRMED)

Central Console = ecosystem / AI-ops / governance / SDK only. Law-firm
productivity pages belong in downstream NSP/NYM clients.

---

## 5. AI Cohesiveness Status

| Concern | Test | Result |
|---|---|---|
| 1042 ROMA L5 agents loaded | `pnpm vitest run tests/conformance/roma-l5-patterns.test.ts` | ✅ 22 patterns conform to required-fields contract |
| SLM-vs-LLM routing | `tests/integration/slm-vs-llm-routing.test.ts` | ✅ 6/6 jurisdictions route to SLM, not LLM fallback |
| PII redaction before fallback | `tests/integration/pii-redaction-fallback.test.ts` | ✅ 6/6 — PAN + Aadhaar redacted in outbound LLM payload |
| Webhook delivery sign+retry | `tests/integration/webhook-delivery.test.ts` | ✅ HMAC sign, 500→retry path |
| Sidebar route regression | `tests/regression/sidebar-route-render.test.tsx` | ✅ 133/133 |
| Share-grant enforcement | `tests/integration/share-grant-enforcement.test.ts` | ✅ 7/7 |
| Key rotation grace | `tests/integration/key-rotation-grace.test.ts` | ✅ 4/4 |
| k6 load (100 VUs × 60s) | `tests/load/k6-100-concurrent-nsp.js` | Scaffold runnable; no infra to run in CI |

---

## 6. Pending list to make the platform live to the Nyayasiddhi ecosystem

Status legend: **OPS** = operator action, **ENG** = engineering action,
**EXT** = external dep.

| # | Item | Owner | Sev | Effort |
|---|---|---|---|---|
| 1 | `pnpm preflight && pnpm deploy` to **prod EC2** behind `api.nyayasiddhi.online` (dev cutover already DONE) | OPS | P0 | 30 min |
| 2 | Flip `enable_managed_datastores=true` in `infra/terraform/envs/dev-edge/terraform.tfvars` and `terraform apply`, then `bash scripts/migrate-to-managed-datastores.sh` (PG → RDS, Redis → ElastiCache) | OPS | P0 | 2 h |
| 3 | Set `LMCACHE_SHARED_BACKEND=redis` + `LMCACHE_REDIS_URL=$NYV_REDIS_TCP_URL` on prod EC2 `.env.prod` | OPS | P1 | 5 min |
| 4 | npm-publish token (FU-T014); then `npm publish` 6 packages to private registry; flip example deps `file:` → `^5.0.0` | OPS+ENG | P0 | 2 h |
| 5 | SDK license decision (PROPRIETARY vs UNLICENSED) for the 5 packages currently inconsistent | OPS | P0 | decision only |
| 6 | Re-seed `nv_schema.protocol_registry` to 502 MCP tools (currently 102) via `scripts/nv-seed-mcp-tools.ts` | ENG | P1 | 10 min |
| 7 | Adapter `createReadStream` overload in 3 storage backends (Local / Replit / S3) — closes the last in-memory `readFile` for true end-to-end 1 GB streaming | ENG | P1 | ~1.5 d |
| 8 | ClamAV / magic-byte AV daemon (docker-compose) on prod EC2 | OPS+ENG | P1 | ~0.5 d |
| 9 | NYVDocuSign provider impl (NSDL/Protean Aadhaar eSign + DSC) — currently uses the e-sign session table; provider call is the missing piece | ENG | P1 | ~1 d |
| 10 | Webhook DNS-rebinding hardening (resolve, lock IP, verify on retry) | ENG | P2 | ~0.5 d |
| 11 | Sentry org/project provisioning + DSN injection on prod EC2 | OPS | P2 | 30 min |
| 12 | Run SSL Labs on `api.nyayasiddhi.online` (target A or A+) | OPS | P2 | external |
| 13 | DR drills #1, #2, #3 per `NYV-DR-DRILL-RESULTS.md` | OPS | P2 | 1 d |
| 14 | Razorpay flip from mock → live (gateway currently `degraded` only because of this) | OPS | P2 | 2 h |
| 15 | WAF count → block flip (after 1-week soak) | OPS | P3 | DEFERRED post-GA |
| 16 | Legal-SME golden-answer corpus (BAR-grade benchmark set) for the 6 jurisdictions | EXT | P1 | 2 weeks (parallel to GA) |
| 17 | `/v5` API versioning policy and deprecation window for `/v4` callers | ENG | P2 | ~0.5 d |
| 18 | EC2 cutover to `nyayavigya-platform-312` repo root from legacy mounts | OPS | P2 | DEFERRED |

Items 1–5 are the **true blockers**. Everything else can ship in
parallel or post-GA.

---

## 7. Next steps (recommended sequence)

1. Operator confirms SDK license + npm-publish target (item #5 + #4).
2. Engineering ships items #6 (5 min) and #10 (DNS rebinding) before
   prod cutover so the prod build has every Session 7 fix.
3. Operator runs items #1 (deploy), #2 (managed datastores), #3 (LM cache).
4. Engineering ships #7 (streaming adapters) + #9 (NYVDocuSign) in
   parallel while ops works items #11–#14.
5. Re-run full smoke harness against prod (`scripts/nv-smoke-bash.sh`)
   targeting `api.nyayasiddhi.online` — expect 101/101 green once
   ElastiCache replaces Upstash.
6. Operator triggers GA on May 15, 2026.

---

## 8. Pointers

- Session 7 completion audit: `docs/v5.0.0/completed_docs/SESSION-7-COMPLETION-AUDIT-2026-05-06.md`
- Project-Tracker (canonical status): `docstotrack/A-active/12-roadmap-and-tracking/Project-Tracker.md`
- CHANGELOG (top-level): `nyayavigya-platform-312/CHANGELOG.md`
- CHANGELOG (nested): `docstotrack/A-active/12-roadmap-and-tracking/CHANGELOG.md`
- Product note (technical): `docstotrack/A-active/01-product-and-status/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`
- Product note (business): `docstotrack/A-active/01-product-and-status/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`
- SDK platform docs: `docs/v3.1.2/SDK-PLATFORM-{NSP-WEB,NSP-MOBILE,NYAYAMITRA,NSI,NSA,NSM,JRX,RAG-AUDIT}.md`
- SDK API integration guide: `docs/v3.1.2/NYV-SDK-API-INTEGRATION-GUIDE-2026-05-04.md`
- SDK endpoints canonical: `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-06.md`
- DMS audit + plan: `docs/v5.0.0/completed_docs/DOCUMENT-MANAGEMENT-AUDIT-AND-PLAN-2026-05-06.md`
- DMS Phase 2 architecture: `docs/v5.0.0/completed_docs/DOC-MGMT-PHASE2-ARCHITECTURE-PLAN-2026-05-06.md`
- 10M-row scale plan: `docs/v5.0.0/SCALE-10M-READINESS-2026-05-06.md`
- Schema ownership map: `docs/v5.0.0/SCHEMA-OWNERSHIP-2026-05-06.md`
- EC2 deployment plan: `docs/v3.1.2/EC2-CLEAN-DEPLOYMENT-PLAN.md`
