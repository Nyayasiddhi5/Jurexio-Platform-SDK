---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# V5.0.0 Readiness — Deferred Workstreams Plan
**Date:** 2026-05-06
**Owner:** Platform / EC2 readiness sprint
**Status:** Inventoried + scoped. Implementation tracked separately per workstream below.

This doc captures the four deferred workstreams from the v5.0.0 cleanup sprint and
the concrete files / contracts each one needs to touch. It is the source of truth
for what was scoped vs. shipped in the 2026-05-06 fix pass.

---

## 0. Context

After the 2026-05-05 audit pass + JWT split-brain + CommandCentre KPI fix
(2026-05-06), the gateway is healthy but five readiness items remained:

1. In-memory → DB persistence audit (5 services)
2. RAG cross-cutting verification across 29 legal categories
3. Web scraper toolkit integration plan
4. Tool dashboard wiring (MCP / Digital Twin / multilingual / multimodal / social toggles)
5. `/console/feature-test-dashboard` 404 (route alias) — **FIXED in this pass**

Items 1–4 below are scoped here; their implementation is multi-day work tracked
in `projecttracker.md §5`.

Reference (registry truth, verified 2026-05-06):
- 1042 agents = 149 IN + 149 UK + 149 US + 149 GC + 149 EU + 149 SG + 148 DEFAULT
- All 7 registries live at `src/data/Nyayavigya-Legal-registry-{IN,UK,US,GC,EU,SG,Default}.json`
- v5 format: `v5-governed-execution-network-nyayasiddhi-comprehensive`

---

## 1. In-memory → DB persistence audit (5 services)

### Affected services (live, all use `Map<string, ...>` as primary store):

| # | Service file | In-memory store(s) | Loss-on-restart impact |
|---|-------------|--------------------|------------------------|
| 1 | `src/services/clawdbot/clawdbot-service.ts` | `conversations: Map`, `intents: Map`, `entityCache: Map` | WhatsApp conversations + extracted entities |
| 2 | `src/services/openbot/openbot-service.ts` | `bots: Map`, `flows: Map`, `executions: Map` | Bot definitions + run history |
| 3 | `src/services/automateai/automateai-service.ts` | `workflows: Map`, `runs: Map`, `triggers: Map` | Workflow definitions + audit trail |
| 4 | `src/services/twindesk/twindesk-service.ts` | `cases: Map`, `entities: Map`, `decisions: Map` | Digital Twin case state |
| 5 | `src/services/security/nv-federated-privacy-service.ts` | `enclaves: Map`, `epsilonBudgets: Map`, `secureAggregations: Map` | Privacy budget consumption (CRITICAL — silent overspend on restart) |

### Required DB tables (drizzle schemas to add in `src/db/schema/`):

```
nv_clawdbot_conversations  (id, org_id, channel, user_phone, intent_id, last_message_at, state JSONB, created_at)
nv_clawdbot_messages       (id, conversation_id, role, content, entities JSONB, created_at)
nv_openbot_bots            (id, org_id, name, jurisdiction, flow_id, status, config JSONB, ...)
nv_openbot_flows           (id, bot_id, version, definition JSONB, ...)
nv_openbot_executions      (id, bot_id, started_at, completed_at, status, trace JSONB)
nv_automateai_workflows    (id, org_id, name, definition JSONB, status, ...)
nv_automateai_runs         (id, workflow_id, started_at, status, output JSONB, ...)
nv_twindesk_cases          (id, org_id, case_number, jurisdiction, state JSONB, ...)
nv_twindesk_entities       (id, case_id, type, value, source JSONB, ...)
nv_twindesk_decisions      (id, case_id, decided_by, rationale, snapshot JSONB, ...)
nv_federated_enclaves      (id, org_id, name, public_key, status, ...)
nv_federated_epsilon       (id, enclave_id, query_id, epsilon_used NUMERIC, recorded_at)  ← MUST PERSIST OR PRIVACY GUARANTEE BREAKS
```

### Migration strategy (per service):
1. Add drizzle schema + `npm run db:push`.
2. Wrap existing Map writes with DB writes (write-through cache).
3. On boot, hydrate the Map from DB in `init()`.
4. Add a feature flag `NYV_${SERVICE}_PERSIST=1` to gate the rollout.
5. Remove the Map after one week of clean runs (keep as L1 cache).

### Priority order:
1. **federated-privacy** (P0 — privacy budgets cannot be lost)
2. **twindesk** (P1 — case state is user data)
3. **clawdbot** (P1 — conversation history)
4. **openbot** + **automateai** (P2 — workflow definitions; runs ok to lose)

### Acceptance:
- Restart gateway with NYV_*_PERSIST=1; all 5 services repopulate from DB.
- Federated privacy: write 100 epsilon entries, restart, sum matches pre-restart.

---

## 2. RAG cross-cutting verification across 29 legal categories

### Source-of-truth list:
`src/services/rag/legal-categories.ts` — 29 entries (Constitutional, Criminal, Civil,
Corporate, Tax, Labour, Family, Property, Contract, IP, Banking, Insurance, M&A,
Securities, Privacy/Data Protection, Cyber, Environmental, Maritime, Aviation,
Energy, Healthcare, Real Estate, Immigration, Arbitration, Competition, Telecom,
International Trade, Human Rights, Administrative).

### Verification matrix (29 × 7 jurisdictions = 203 cells):
For each `(category, jurisdiction)` pair, verify:
- [ ] At least one statute embedded in pgvector with `category=` and `jurisdiction=`
- [ ] At least one case-law document embedded
- [ ] GraphRAG entity count ≥ 5 (statutes have references)
- [ ] `/api/nv/research/query` returns ≥3 results with citations when filtered by
      `(category, jurisdiction)`
- [ ] BM25+vector RRF reranker scores top-3 with score > 0.7

### Tooling needed:
1. New script `scripts/v5/rag-coverage-audit.ts` — iterates 203 cells, hits the
   research endpoint, writes CSV `docs/v5.0.0/rag-coverage-2026-05-06.csv`.
2. Dashboard at `/console/admin/rag-coverage` showing red/yellow/green per cell.
3. Backfill jobs for any red cells (target Q3 2026).

### Acceptance:
- ≥80% green, no reds in: Constitutional, Criminal, Corporate, Privacy (the
  categories all 7 SDK products depend on).

---

## 3. Web scraper toolkit integration plan

### Existing toolkit:
`src/packages/tools/web-scraping/` — 9 scrapers (Crawl4AI, Firecrawl, Playwright,
Cheerio, Puppeteer, Scrapy-py, BeautifulSoup-py, ScrapingBee adapter, generic-fetch).

### Integration gaps (from 2026-05-05 audit):
1. **No agent-callable adapter** — scrapers exist as utilities but agents cannot
   invoke them via the standard tool-call protocol. Need a wrapper at
   `src/services/tools/web-scraper-tool-adapter.ts` exposing 9 tools with JSON
   schemas, registered in `tool-registry.ts`.
2. **No rate limiting per-domain** — risk of getting our IP banned. Add a
   `domain-rate-limiter.ts` with default 1 req/sec per domain, configurable.
3. **No PII redaction on scraped content** — scraped pages may contain PII
   (court records, party names). Pipe scraped content through the existing PII
   redactor (`src/services/security/pii-redaction-service.ts`) before persisting.
4. **No legal-source allowlist** — agents could scrape arbitrary URLs. Add
   `config/legal-sources-allowlist.json` covering: indiankanoon.org, scconline.com,
   bailii.org (UK), courtlistener.com (US), eur-lex.europa.eu (EU), supremecourt.gov.sg,
   austlii.edu.au, etc.
5. **No GraphRAG ingestion hook** — scraped statutes/cases should auto-flow into
   the GraphRAG pipeline. Add a callback: scraper → PII redact → embed → pgvector → GraphRAG.

### Implementation order:
1. Adapter + tool registry (1 day)
2. Allowlist + rate limiter (0.5 day)
3. PII redaction wiring (0.5 day)
4. GraphRAG ingestion pipeline hook (1 day)
5. UI panel at `/console/admin/scraper-jobs` to monitor job queue (1 day)

### Acceptance:
- Agent invokes "scrape latest SC judgment from indiankanoon.org" → URL is
  allow-listed → fetched at ≤1 req/s → PII redacted → embedded → GraphRAG entities
  extracted → searchable from `/api/nv/research/query` within 2 minutes.

---

## 4. Tool dashboard wiring (MCP / Digital Twin / multilingual / multimodal / social toggles)

### Current state:
- Toggles exist in code as feature flags scattered across `src/config/*.ts` and
  individual service files. No central UI.
- `/console/admin` shows a "tools" KPI but no per-tool enable/disable.

### Target dashboard: `/console/admin/tool-dashboard`

| Toggle | Default | Backing config | Effect |
|--------|---------|----------------|--------|
| MCP server enabled | ON | `NYV_MCP_ENABLED` + `tool-registry.ts:mcpEnabled` | Exposes `/mcp/*` endpoints to external MCP clients |
| Digital Twin sync | ON | `NYV_DIGITAL_TWIN_SYNC` | Enables real-time entity propagation from cases to twins |
| Multilingual (12 langs) | ON | `NYV_MULTILINGUAL` + `sarvam-adapter.ts` | Enables Sarvam translation pipeline |
| Multimodal (voice/OCR) | ON | `NYV_MULTIMODAL` | Enables `/api/nv/sdk/multimodal/*` |
| Social adapters (WhatsApp/Telegram) | OFF | `NYV_SOCIAL_ADAPTERS` | Routes ClaWdBot to social channels |
| GraphRAG ingestion | ON | `NYV_GRAPHRAG_INGEST` | Auto-extract entities on doc upload |
| GRPO feedback collection | ON | `NYV_GRPO_ENABLED` | Records pattern outcomes for training |
| Cost cascade router | ON | `NYV_COST_CASCADE` | Routes cheap → expensive models |
| Web scraper allowlist enforcement | ON | `NYV_SCRAPER_ALLOWLIST_STRICT` | Blocks non-allowlisted scrape targets |

### Required deliverables:
1. New page `client/src/pages/tool-dashboard.tsx`
2. Route in `App.tsx`: `/tool-dashboard` (developer+ role)
3. New endpoints:
   - `GET /api/nv/admin/feature-flags` — read all toggles + their current sources
   - `POST /api/nv/admin/feature-flags/:flag` — toggle (admin role; writes to a
     new `nv_feature_flags` DB table so changes survive restart)
4. Hot-reload mechanism: services subscribe to flag changes via the existing
   `event-bus.ts` rather than reading `process.env` on each call.
5. Audit log entry per toggle change (writes to `nv_audit_log`).

### Acceptance:
- Admin flips "Multimodal" OFF in UI → `/api/nv/sdk/multimodal/capabilities`
  returns 503 within 5 seconds → flips back ON → 200 within 5 seconds.

---

## 5. /console/feature-test-dashboard 404 — FIXED 2026-05-06

Route was registered as `/feature-test`. Added alias `/feature-test-dashboard`
in `client/src/App.tsx:429` mapping to the same `FeatureTestDashboard`
component. Bundle rebuilt; no further work required.

---

## 6. Workstream status update — 2026-05-06 (post-session)

| Workstream | Status | Notes |
|---|---|---|
| #1 In-memory→DB persistence (5 services) | 🔴 NOT STARTED | Multi-day; needs 12 new drizzle tables + write-through caches + hydration. P0 = federated-privacy. |
| #2 RAG cross-cutting verification (29×7 cells) | 🔴 NOT STARTED | Multi-day; audit script + dashboard + backfill jobs. |
| #3 Web scraper integration (5 gaps) | ✅ DONE 2026-05-06 | All 5 gaps closed: (a) `WebScrapingService.scrape()` is the agent-callable adapter, (b) per-domain token-bucket rate limiter (RPM from allowlist), (c) PII redaction wired via `jurisdiction-pii-patterns.json`, (d) `nv-scraper-allowlist.ts` is single source of truth (26 tier-1/2 legal sources across 6 jurisdictions), (e) opt-in `indexInGraphRAG` calls `NyvGraphRAGLegalService.indexDocument`. Mounted at `POST /api/nv/tools/scrape`. Status endpoints `GET /allowlist`, `GET /rate-limiter`. |
| #4 Tool dashboard wiring (9 toggles) | 🟢 BACKEND DONE, UI SURFACED | Backend (`feature-flags-service.ts`, `nyv-feature-flag-manager.ts`, routes at `/api/nv/flags`) was already implemented. UI surfacing now lives in the Enterprise Console "Tool Dashboard & Feature Flags" section. Per-toggle hot-reload via event-bus is the remaining gap (currently flags are read on each call). |
| #5 /feature-test-dashboard 404 | ✅ FIXED | Route alias added 2026-05-06. |

### 6a. New work shipped this session
- **Enterprise Console Hub** at `/enterprise-dashboard` — 100+ existing
  pages consolidated into 12 logical sections (was a 16-line "Coming
  soon" stub before this session).
- **IA cleanup planning**: 21 confirmed duplicate route pairs
  (e.g. `/admin` + `/admin-console`, `/sdlc` + `/sdlc-dashboard`,
  `/openbot` + `/openbot-studio`) — kept as aliases for backward compat;
  consolidation tracked separately. New code should reference the
  canonical (shorter) path.

### 6b. Honest scoping note
Workstreams #1 and #2 are each multi-day refactors with correctness
implications (privacy ε-budget for #1; "did the agent actually run with
real evidence?" for #2). Half-implementations are worse than none, so
they remain scoped + tracked here. Detailed executable plans for both
are in `docs/v5.0.0/V5-PLAN-WORKSTREAMS-1-2.md` (file lists, drizzle
schemas, audit pseudocode, acceptance criteria).

### 6c. EC2 release readiness — verdict 2026-05-06

**NOT YET READY for prod EC2 push to all SDK customers.** Reasons:

1. **P0 federated-privacy persistence (#1)** — until `nv-federated-privacy-service`
   stops storing ε-budgets in a `Map<>`, any deploy/restart silently
   breaks the differential-privacy guarantee. This is a contract violation
   that customers paying for "DP-on" SLM training would notice.
2. **RAG coverage unknown (#2)** — without the 203-cell audit, we cannot
   honestly tell SDK customers "your jurisdiction is supported". The
   1042-agent registry is mounted, but routing into an empty index leads
   to hallucinated answers.
3. **Billing aggregation P0** (carried over from QA report 2026-05-05) —
   `sdk_usage_metering` writer schema drift still open.

**WHAT IS READY** for a controlled internal/staging push:
- Enterprise Console hub at `/console/enterprise-dashboard`
- 1042-agent registry with correct jurisdiction split (149×6 + 148)
- JWT split-brain fixed
- Web scraper integration end-to-end (#3)
- Feature flags backend live at `/api/nv/flags`
- All v3.1.2 / v4.0.0 stale labels swept to v5.0.0

**Recommended sequence:**
1. Land Workstream #1 (federated-privacy persistence is the long pole — 3 days)
2. Land Workstream #2 (RAG audit — 2 days)
3. Fix the carried-over billing P0
4. Re-run the QA suite end-to-end (`scripts/qa/run-full-suite.sh`)
5. Tag `v5.0.0-rc1` → push to staging EC2 → 72-hour soak
6. Tag `v5.0.0` → push to prod EC2 → SDK customer announcement

**Expected total**: ~7-8 working days from 2026-05-06 to safe public push.

---

## Tracking

- Each workstream above gets its own row in `projecttracker.md §5`.
- This doc is referenced from `replit.md` as the canonical scope for the
  deferred v5.0.0 work.
- Implementation PRs should link back to the relevant section here.
