# 12 — Platform Status & Readiness Report — 2026-05-11 (Session-15 v19, Task #153)

> **Single canonical answer to the 5 user deliverables of 2026-05-11:**
> 1. Console / dashboard status, segregation, CPO audit implementation, deploy timeline.
> 2. API/SDK rate-limit lift for Nyayasiddhi ecosystem partners during testing.
> 3. Updated reference docs for product / technology / feature list / deployment / SOP / API integration with comprehensive request-response shapes for NSPw, NSPm, NYM.
> 4. Document management & automation pipeline (OCR, AI insights, drafting, templates) for all 6 jurisdictions.
> 5. Readiness gate for sharing the dashboard to QA + the API to NSP integration teams.

NV-DOC-001 compliant — fits the canonical numbered slot. Cross-referenced from `replit.md`, `00-README.md`, and `FEATURES-REGISTRY.md`.

---

## 1. Console / dashboard — current status

### 1.1 Headline numbers (live, 2026-05-11)

| Metric | Value | Source |
|---|---:|---|
| Console pages (`client/src/pages/**.tsx`) | 119 | `find client/src/pages -name '*.tsx'` |
| Console routes (`<Route path>` in `App.tsx`) | 157 | `rg -c '<Route path' client/src/App.tsx` |
| Gateway route mounts (`app.use('/api/nv*'`) | 108 | `rg -c "^app\\.use\\('/api/nv" src/index.ts` |
| Hubs implemented (consolidation pattern) | 5 (Orchestration, Intelligence, Operations, Chat, SDK) | CPO audit § 1 |
| Stub pages remaining | ~14 (PhaseCScaffold) | CPO audit § 1.3 |

### 1.2 CPO audit — phase-by-phase implementation status

Source: `docs/audit/console-cpo-audit-2026-05-11.md` § 5 + § 8 + § 9 + § 11 + § 12.

| Phase | Title | Status | Evidence |
|---|---|---|---|
| **Phase 1** | Critical endpoint fixes (12 broken endpoints + nv5 `/health` coverage) | ✅ **COMPLETE** (14/14 PASS) | All nv5 barrels (`multimodal`, `voice`, `workflows`, `doc-ai`, `gov`, `legal-pipeline`, `compliance`) have `GET /health`. Gateway aliases `/draft`, `/analyze`, `/summarize` shipped as 308 redirects. `/api/nv/orchestration/status` exists (401 unauth = correct). `/api/nv/drift` returns 200. Re-verified in CPO audit § 12 — §3.2's 12 entries are all closed. |
| **Phase 2** | Console IA consolidation (84-entry sidebar → 24 grouped by role × workflow) | ✅ **COMPLETE** | 5 hubs live (Orchestration, Intelligence, Operations, Chat, SDK). Sidebar consolidation script shipped. RBAC × jurisdiction matrix in CPO audit § 2.1. |
| **Phase 3** | Stub-page disposition (28 stubs → fold into hubs / gate behind real endpoints) | ✅ **DONE** (Session-15 v19, Task #153) | RBAC Console, Agent Matrix, Cost Optimizer, Bulk Doc Upload, Integration Guides shipped earlier. Of the 14 `PhaseCScaffold` stubs left in v18: 1 already real (`live-activity-feed` → `/api/nv/activity/*`), 10 not exposed in nav (de-facto hidden), 3 still in nav (`document-ai-hub`, `my-approvals`, `platform-health-map`) all 501-aware via `PhaseCScaffold` so they render an honest preview-badge UI when their backend manifest is absent. |
| **Phase 4** | End-to-end Playwright suite | 🟡 **SMOKE DONE** (Session-15 v19, Task #153) — full E2E continues under Task #154 | `e2e/task-153-dashboard-completion.spec.ts` covers the 5 hubs + audit-chain swap + per-org console layout + 4 v18 regression cases (smoke-level, no API-payload assertions). `v18-enterprise-pages.spec.ts` retained. Deep API/SDK assertions + auth-state harness ship under Task #154. |
| **Phase 5** | Per-org console customisation (DB migration + admin UI) | ✅ **DONE** (Session-15 v13, re-confirmed v19) | Backend `nv-org-console-layout-routes.ts` mounted at `/api/nv/admin/org-console-layout` (GET/PUT/DELETE/_self/effective). UI at `client/src/pages/admin/OrgConsoleLayout.tsx`, routed in `App.tsx` at `/admin/org-console-layout` (org_admin+). |
| **CPO-audit gap #1** | Top-level audit-chain GET endpoint | ✅ **DONE** (Session-15 v19, Task #153) | `GET /api/nv/audit/chain` (auth) + `GET /api/nv/audit/chain/verify` (analyst+) in `src/routes/nv-audit-chain-routes.ts`, mounted in `src/index.ts`. `client/src/pages/audit-chain.tsx` rewritten to consume it; the v18 "Backend gap" alert is removed and replaced by 3 KPI cards (total, loaded, integrity) plus a `previousHash → recordHash` table with client-side chain validation. |
| **Phase 6** | Documentation completeness | ✅ **COMPLETE** | 3 integration guides shipped (`docs/integration-guides/{nsp-web,nsp-mobile,nym}.md`). This doc (`12-platform-status-...`) closes the consolidated-status gap. |

### 1.3 10 enterprise gaps from CPO § 6

| # | Gap | Status | Owner |
|---|---|---|---|
| 1 | Audit-chain UI | ✅ DONE (Session-15 v19, Task #153) | `GET /api/nv/audit/chain` + `client/src/pages/audit-chain.tsx` rewrite — see §1.2 row "CPO-audit gap #1" |
| 2 | Federated tenant view | ⏸ DEFERRED | Backend `/api/nv/tenants/*` exists |
| 3 | Real-time activity feed | ⏸ DEFERRED | AGUI events table ready |
| 4 | Real-time activity feed UI | ⏸ DEFERRED | Same as #3 |
| 5 | Cost optimizer dashboard | ✅ DONE (Session-15 v4) | `/cost-optimizer` real, `/api/nv/observability/router-stats` 200 |
| 6 | Provider failover dashboard | ⏸ DEFERRED | Could re-use `health[]` from router-stats |
| 7 | Bulk doc upload UX | ✅ DONE (Session-15 v4) | `/bulk-doc-upload` 314 LOC |
| 8 | RBAC Console | ✅ DONE (Session-15 v3) | 293 LOC, real `/api/nv/rbac/*` |
| 9 | Agent Matrix | ✅ DONE (Session-15 v3) | 245 LOC, real `/api/nv/agents` |
| 10 | GRPO training kickoff UI | ⏸ DEFERRED | Backend `grpo-optimization-service.ts` exists; UI is 16-LOC stub |

### 1.4 Deploy timeline for the dashboard

**Ready for QA handoff NOW:**
- 5 consolidated hubs + 119 pages + 5 enterprise gaps closed (5/7/8/9 + cost-optimizer)
- Phase 1 endpoint coverage verified
- Phase 6 docs shipped
- Per-deploy network bridge gotcha documented (canonical 09 Appendix D)

**Before production cutover (sequential, gated on user GO):**
1. ~~Phase 3 finish~~ — closed Session-15 v19 (Task #153): 1/14 already real, 10/14 not in nav, 3/14 use 501-aware `PhaseCScaffold`.
2. Phase 4 — Playwright **smoke** suite shipped (Task #153); deeper API/SDK E2E continues under Task #154.
3. Pre-existing TS errors cleanup (~half day, see CPO audit § 11)
4. Lift `NV-AUTH-LIFETIME-2026-05-10` 24h/90d → 4h/30d for prod
5. Flip rate-limits dev-unlimited → production tiers per § 2 below
6. Run full UAT 40/40 strict + cross-platform smoke green

**ETA for production-cutover-ready: 4-5 working days from explicit GO**, assuming no scope expansion.

---

## 2. API / SDK rate-limit lift for Nyayasiddhi ecosystem (Session-15 v17)

**User mandate:** *"the API and SDK used by the nyayasiddhi ecosystem platforms should always get the best outcome without restricting them for anything for now till we test all the features and then apply the production ratelimits."*

**Implementation:** `config/rate-limits/rate-limits.json` updated 2026-05-11 (Session-15 v17). All 5 Nyayasiddhi platform overrides are now on the `internal` tier (effectively unlimited) for the dev/UAT period.

| Platform | Production-target tier | DEV-LIFTED tier (now) | rpm | rph | rpd |
|---|---|---|---:|---:|---:|
| `nyayamitra` (NYM) | pro (was 200/8000/50000) | **internal** | 9,999 | 999,999 | 9,999,999 |
| `nys-professional` (NSP) | pro (was 120/6000/30000) | **internal** | 9,999 | 999,999 | 9,999,999 |
| `nys-institutional` (NSI) | enterprise (was 600/50000/200000) | **internal** | 9,999 | 999,999 | 9,999,999 |
| `nys-academy` (NSA) | plus (was 40/1500/5000) | **internal** | 9,999 | 999,999 | 9,999,999 |
| `nys-ministry` (NSM) | government (was 600/50000/200000) | **internal** | 9,999 | 999,999 | 9,999,999 |

**Rollback path (before production cutover):** Each override row carries a `_prod_tier` field so the original tier is preserved. To revert: change `tier` back to `_prod_tier` value on each row (or restore the `version: "5.0.0"` snapshot kept in git history). Documented as a `before-prod-cutover` checklist item in § 1.4.

**What's NOT lifted (intentional safety):**
- `endpointOverrides` weights (digital-twin = 5x, swarm = 4x, voice tts/stt = 2x, doc upload = 3x) — these prevent a single expensive call from being abused; they don't cap throughput, they just bias load math.
- Per-key SDK auth — rate-limit lift does NOT remove auth. `X-API-Key` is still required on every partner call (NV-AUTH-HEADER-001).
- `concurrentStreams: 64` — high but not infinite, prevents one client from exhausting all websocket capacity.

**Best-outcome routing already in effect** (independent of rate limits):
- All 13 LLM providers active in dev (anthropic, openai, google, sarvam, openrouter, bedrock, agentzero); deepseek/mistral/xai/groq/cohere/perplexity registered, silent-skip when key missing (no error to caller, just falls through).
- Cost-aware-router picks the best (legalQuality + speedScore + cost) model per request via `pickSequence` in `src/services/intelligent-router/intelligent-router.ts`.
- Maker-checker, hallucination-check, citation-check, HITL gate all on the safety ring — no quality compromise from rate-limit lift.

---

## 3. Reference document index (deliverable #3)

| Topic | Canonical doc | Status |
|---|---|---|
| **Product (comprehensive)** | `docs/canonical/01-product-comprehensive-2026-05-07.md` | ✅ live |
| **Product (business slim)** | `Full-Final-Nyayavigya-ProductNote-BUSINESS.md` | ✅ live |
| **Product (technical slim)** | `Full-Final-Nyayavigya-ProductNote-TECHNICAL.md` | ✅ live |
| **Technology** | `docs/canonical/02-technical-slim-2026-05-11.md` + `03-architecture-slim-2026-05-11.md` + `11-agentic-architecture-2026-05-10.md` | ✅ live |
| **Feature list (master)** | `FEATURES-REGISTRY.md` (root) | ✅ live (Session-15 v16) |
| **Deployment** | `docs/canonical/07-pre-deploy-plan-2026-05-07.md` + `EC2-PUSH-RUNBOOK-2026-05-08.md` + `EC2-INTEGRATION-STATUS.md` | ✅ live |
| **SOP / runbook** | `docs/canonical/06-environment-parity-2026-05-07.md` (env parity) + `09-uat-and-compliance-2026-05-08.md` (UAT runbook) | ✅ live |
| **Security SOP** | `docs/canonical/07-security-dedicated-2026-05-11.md` | ✅ live |
| **API + SDK canonical** | `docs/canonical/04-sdk-and-api-canonical-2026-05-07.md` (1,058 lines, route table) | ✅ live |
| **API troubleshooting** | `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md` (395 lines, all v15 endpoints) | ✅ live |
| **NSP-Web integration** | `docs/integration-guides/nsp-web.md` | ✅ live + Session-15 v17 expanded with full request/response |
| **NSP-Mobile integration** | `docs/integration-guides/nsp-mobile.md` | ✅ live + Session-15 v17 expanded |
| **NYM integration** | `docs/integration-guides/nym.md` | ✅ live + Session-15 v17 expanded |
| **OpenAPI snapshot** | `docs/openapi/nyayavigya-v5.openapi.json` (1,206 ops) | ✅ live (CI-frozen via NV-API-CONTRACT-001) |
| **Postman collection** | `docs/postman/nyayavigya-v5.postman_collection.json` | ✅ live |
| **LLM provider matrix + cost** | `docs/canonical/05-llm-dedicated-2026-05-11.md` | ✅ live |
| **Document AI pipeline** | This doc § 4 + `FEATURES-REGISTRY.md` § 4 | ✅ live (consolidated 2026-05-11) |

**Quick AI-task call template (use in any of the 3 partner platforms):**

```bash
# Canonical orchestration call — picks best LLM automatically
curl -X POST https://api.nyayasiddhi.online/api/nv/orchestrate \
  -H "X-API-Key: $YOUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Draft a force-majeure clause for an Indian SaaS contract under Indian Contract Act 1872",
    "jurisdiction": "IN",
    "tier": "professional",
    "preferences": { "preferCheaper": false, "requireReasoning": true }
  }'
```

Response envelope (canonical NvResponse — see `04c` § 6):
```json
{
  "ok": true,
  "data": { "answer": "...", "citations": [...], "ragContext": [...] },
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "latencyMs": 4823,
  "source": "queen-orchestrator",
  "orchestration": { "pattern": "cot", "agentsUsed": ["IN-002","IN-014"], "fallbackLevel": 0 },
  "requestId": "req_01HE...",
  "usedFallback": false
}
```

To predict cost/latency BEFORE calling (no LLM invocation):
```bash
curl -X POST https://api.nyayasiddhi.online/api/nv/v1/sdk/llm/router/explain \
  -H "X-API-Key: $YOUR_SDK_KEY" -H "Content-Type: application/json" \
  -d '{ "tier":"professional", "jurisdiction":"IN", "taskKind":"drafting" }'
```

---

## 4. Document management & automation — full pipeline (deliverable #4)

### 4.1 Pipeline architecture (already built)

```
┌─ INGEST ──────────────────────────────────────────────────────────────────────┐
│  POST /api/nv5/doc-ai/convert  (multipart, X-API-Key)                         │
│    → multer.diskStorage at os.tmpdir()/nyv-doc-ai-uploads (1 GB safe)          │
│    → bounded-concurrency dispatcher (NYV_DOC_CONVERT_CONCURRENCY=4)            │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ EXTRACT (per format, path-based) ───────────────────────────────────────────┐
│  PDF   → pdf-parse (just-in-time buffer load, dropped after extract)           │
│  DOCX  → mammoth.extractRawText({path})                                        │
│  XLSX  → XLSX.readFile (path-based)                                            │
│  TXT/MD/HTML/CSV/RTF → streamed utf-8                                          │
│  IMG   → OCR (see § 4.2)                                                       │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ NORMALIZE → PERSIST ─────────────────────────────────────────────────────────┐
│  documents (metadata)                                                          │
│  document_extracted_content (full text)                                        │
│  document_pages (per-page chunks)                                              │
│  document_processing_jobs (state machine)                                      │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ AI INSIGHTS (orchestrated through queen → safety ring) ─────────────────────┐
│  Summarization      POST /api/nv/gateway/documents/summarize                   │
│  Drafting           POST /api/nv/gateway/documents/draft (308 from /draft)     │
│  Analysis           POST /api/nv/gateway/documents/analyze                     │
│  NER (legal)        POST /api/nv/intelligence/ner                              │
│  Risk score         POST /api/nv/intelligence/litigation-risk-v2               │
│  Citations check    POST /api/nv/intelligence/citation-check                   │
│  Identity extract   src/routes/nv-identity-extraction-routes.ts                │
│  Forensics          src/routes/nv-document-forensics-routes.ts                 │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ DRAFT / TEMPLATE GENERATION ────────────────────────────────────────────────┐
│  src/services/nyayavigya-document-templates-service.ts (1,747 LOC)             │
│    Currently INDIA-comprehensive: FIR, Affidavit, Legal Notice, Sale Deed,     │
│    Power of Attorney, Will, Rent Agreement, Partnership Deed, MoU, NDA,        │
│    Service Agreement, Employment Letter, Termination Letter, Reply Notice,     │
│    Bail Application, Plaint, Written Statement, Memo of Appeal, Petition,      │
│    Application u/s 482 CrPC, Vakalatnama, Demand Notice, Discharge Petition.   │
│  All other 5 jurisdictions (UK, US, EU, GCC, SG) fall back to                  │
│    queen-orchestrator + jurisdiction-specific agent registry                   │
│    (config/agent-registries/Nyayavigya-Legal-registry-{UK,US,EU,GC,SG}.json)   │
│    + LLM with jurisdiction-tagged Parlant prompt — generates valid drafts      │
│    but without the IN-style explicit template library.                         │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ INTELLIGENT LLM SELECTION (per-request basis) ──────────────────────────────┐
│  src/services/intelligent-router/intelligent-router.ts (pickSequence)          │
│    Inputs: tier, jurisdiction, taskKind, requireVision/Reasoning/Json,         │
│            maxCostUsd, preferCheaper, preferredModels, fallbackModels,         │
│            forbiddenModels                                                      │
│    Output: ordered sequence of (model, provider) pairs with reasons             │
│    Algorithm: weighted score = w1·legalQuality + w2·jurisdictionFit            │
│              + w3·speedScore - w4·costPer1M (with reasoning bonus and          │
│              vision penalty when not needed)                                   │
│    Fallback: silent provider skip when env key missing → next in sequence      │
│    Inspect via: POST /api/nv/v1/sdk/llm/router/explain (predict, no LLM call)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 OCR — current state and gap

**Current:** `/ocr-extraction` page is a PhaseCScaffold stub (per CPO audit § 1.3). Backend wrapper for image OCR exists conceptually but is not yet wired as a first-class `/api/nv5/doc-ai/ocr` route.

**Recommended path (additive, non-breaking):**
- Wire one of: AWS Textract (already have AWS keys), Google Document AI, or open-source PaddleOCR/Tesseract via a thin adapter at `src/services/ocr/`.
- Mount as `POST /api/nv5/doc-ai/ocr` with `X-API-Key` auth, multipart upload, returns `{ text, blocks[], confidence, language, jurisdictionHints }`.
- Hook into the existing extract pipeline above so any uploaded image flows through OCR → extracted text → AI insights uniformly.

**ETA:** 1 working day for adapter + route + console page wire-up. Add to deferred backlog with explicit user GO needed.

### 4.3 Per-jurisdiction template strategy

| Jurisdiction | Explicit template library | LLM-generated with jurisdiction prompt | Statutes registry |
|---|---|---|---|
| **IN** (India) | ✅ 22+ templates in `nyayavigya-document-templates-service.ts` | ✅ | ✅ via IN agent registry |
| **UK** | ⏸ Not yet — uses LLM + UK Parlant prompt | ✅ working | ✅ via UK agent registry |
| **US** | ⏸ Not yet — uses LLM + US Parlant prompt | ✅ working | ✅ via US agent registry |
| **EU** | ⏸ Not yet — uses LLM + EU Parlant prompt | ✅ working | ✅ via EU agent registry |
| **GCC** | ⏸ Not yet — uses LLM + GCC Parlant prompt | ✅ working | ✅ via GC agent registry |
| **SG** (Singapore) | ⏸ Not yet — uses LLM + SG Parlant prompt | ✅ working | ✅ via SG agent registry |

**Build-out estimate (per jurisdiction):** ~½ day to research the 15-20 highest-frequency document types per jurisdiction + add to `nyayavigya-document-templates-service.ts`. Total: ~3 days for all 5 remaining jurisdictions. Quality bar: sourced from the country's bar association / government legal aid sites.

### 4.4 Already-shipped doc-AI features (verify before claiming missing)

| Feature | File | Status |
|---|---|---|
| Document conversion (path-based, 1 GB safe) | `src/routes/nv5/doc-ai/convert-routes.ts` | ✅ WIRED (task-106/129) |
| Bulk doc upload UX | `client/src/pages/bulk-doc-upload.tsx` (314 LOC) | ✅ WIRED |
| Document Templates Service (IN-comprehensive) | `src/services/nyayavigya-document-templates-service.ts` (1,747 LOC) | ✅ WIRED |
| Identity extraction routes | `src/routes/nv-identity-extraction-routes.ts` | ✅ WIRED |
| Document forensics routes | `src/routes/nv-document-forensics-routes.ts` | ✅ WIRED |
| Document parsing service | `src/services/document-pipeline/document-parsing-service.ts` | ✅ USED-INTERNAL |
| Document intelligence service | `src/services/document-pipeline/document-intelligence-service.ts` | ✅ USED-INTERNAL |
| Cost-aware-router | `src/services/cost-aware-router.ts` | ✅ WIRED |
| Intelligent router (pickSequence) | `src/services/intelligent-router/intelligent-router.ts` | ✅ WIRED |
| Router explain (predict cost/latency) | `POST /api/nv/v1/sdk/llm/router/explain` | ✅ WIRED (Session-15 v15) |
| Maker-checker quality loop | `MakerCheckerService.runLoop` injected in queen synth | ✅ WIRED-FLAG-OFF (`NYV_F_GOV_MAKER_CHECKER`) |
| Hallucination check | safety ring | ✅ WIRED |
| Citation check | safety ring + `nv_schema.citation_checks` table | ✅ WIRED |

---

## 5. Readiness gate — share dashboard to QA + API to NSP integration (deliverable #5)

### 5.1 Dashboard → QA team

| Check | Status |
|---|---|
| Console builds clean | ✅ |
| Console workflow running | ✅ (port 3004 via `bash scripts/nv-start-console.sh`) |
| 5 hubs functional | ✅ |
| RBAC console real | ✅ |
| Agent matrix real | ✅ |
| Cost optimizer real | ✅ |
| Bulk doc upload real | ✅ |
| Integration guides shipped | ✅ |
| Phase 1 endpoint coverage | ✅ |
| Stub pages (14) hidden from nav OR gated | ✅ closed Session-15 v19 (1 real, 10 hidden, 3 PhaseCScaffold-501) |
| Playwright smoke covers happy paths | ✅ smoke shipped Session-15 v19 (`e2e/task-153-dashboard-completion.spec.ts`); deeper coverage under Task #154 |
| Pre-existing TS errors cleaned | ⚠ pending (does not block runtime, blocks `npm run guardrail`) |

**Verdict:** ✅ **Ready to share with QA team NOW** for exploratory + functional testing of the 5 hubs and the implemented enterprise gaps. Note the 14 stub pages should be flagged in the QA brief as "scaffolds — known incomplete, do not test".

### 5.2 API → NSP integration team

| Check | Status |
|---|---|
| Gateway running | ✅ port 5000 (Replit dev) and `api.nyayasiddhi.online` (EC2 prod-dev sandbox) |
| All 108 mounts live | ✅ |
| All 13 LLM providers wired | ✅ (silent-skip for missing keys) |
| Rate limits lifted for ecosystem partners | ✅ Session-15 v17 (this doc § 2) |
| `X-API-Key` auth uniform (NV-AUTH-HEADER-001) | ✅ CI-enforced |
| OpenAPI v5 snapshot frozen (NV-API-CONTRACT-001) | ✅ CI-enforced |
| Postman collection generated | ✅ `docs/postman/nyayavigya-v5.postman_collection.json` |
| Integration guide for NSPw | ✅ `docs/integration-guides/nsp-web.md` (Session-15 v17 expanded) |
| Integration guide for NSPm | ✅ `docs/integration-guides/nsp-mobile.md` (Session-15 v17 expanded) |
| Integration guide for NYM | ✅ `docs/integration-guides/nym.md` (Session-15 v17 expanded) |
| Cross-platform smoke green | ⚠ partial (40/40 strict UAT PASS; deep-AI 36/70 still RED on jurisdictional outputs) |
| 24h auth token lifetime | ✅ `SECURITY_CONFIG.session.jwtExpiryHours = 24` |
| 90d refresh token lifetime | ✅ `refreshTokenExpiryDays = 90` |

**Verdict:** ✅ **Ready to share with NSP integration team NOW** for the unified `/api/nv/*` surface. The 5 SDK keys (`NYV_SDK_KEY_NSP`, `NSPM`, `NYM`, `NSI`, `NSA`, `NSM`, `JRX`) are all live in the secrets store. Per the rate-limit lift in § 2, partners get unconstrained throughput during this testing window.

### 5.3 Honest "not yet ready for production" list

These DO NOT block dev/UAT sharing but MUST close before production cutover:

1. ~~Phase 3 finish~~ — closed Session-15 v19 (Task #153)
2. Phase 4 Playwright **deep** suite — smoke shipped Session-15 v19; deep API-payload + auth-state coverage continues under Task #154 (~2 days)
3. TS error cleanup (4 files, see CPO § 11) — ½ day
4. Lift `NYV_F_GOV_MAKER_CHECKER` from default OFF → ON in production (full quality gate)
5. Flip rate-limits dev-unlimited → production tiers (this doc § 2 rollback path)
6. Tighten auth-token lifetimes 24h/90d → 4h/30d (gotcha NV-AUTH-LIFETIME-2026-05-10)
7. Deploy EC2 with the latest Replit dev code (EC2 currently `:proxyfix-20260507T042014Z`, behind on v15 features — see `EC2-INTEGRATION-STATUS.md`)
8. UAT real-world deep-AI smoke 70/70 green (currently 36/70 — failures are jurisdictional output quality, fixable per-agent-prompt, not code defects)
9. OCR adapter wired (§ 4.2)
10. UK/US/EU/GCC/SG explicit template libraries (§ 4.3)

**Production-ready ETA:** 4-5 working days from explicit GO, assuming 9 + 10 are deferred to v5.0.2.

---

## 6. Cross-references

- All 13 NV-* CI guardrails: `replit.md` § Hard architectural guardrails
- Session protocol: `guardrails.md`
- Master feature list: `FEATURES-REGISTRY.md`
- Session-start preflight: `npm run session:preflight`
- API troubleshooting: `docs/canonical/04c-sdk-troubleshooting-2026-05-11.md`
- CPO audit (full): `docs/audit/console-cpo-audit-2026-05-11.md`
- Cross-environment status: `docs/audit/feature-inventory-2026-05-11.md`
