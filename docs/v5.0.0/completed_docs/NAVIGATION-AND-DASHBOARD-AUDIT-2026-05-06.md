---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# Navigation & Dashboard Audit — Nyayavigya Platform v5.0.1

**Version:** 5.0.1 (audit + cleanup sprint)
**Date:** 2026-05-06
**Author:** Replit Agent (study-before-change protocol)

> ⚠️ **READ FIRST — 2026-05-06 Session 4 reconciliation:**
> This document's "Status" tables and Phase C/D effort estimates have
> drifted from on-disk reality. Before relying on any task numbers
> below, read `PLAN-VS-REALITY-DELTA-2026-05-06.md` in this same folder
> — it lists exactly which Phase C pages already exist (13 of 14), why
> the "55 mock-data sites" figure isn't measurable as written, and
> corrects a false "Phase 2A imports broken" claim from Session 3.
> The body of this audit is preserved for historical context only.
**Status:** AUDIT COMPLETE → AWAITING USER GREEN-LIGHT TO EXECUTE

This document is the mandatory pre-change study you asked for. Every finding
is anchored to a real file path you can grep. The execution plan in §6 lists
file-level changes that will be made in one pass and shipped under `v5.0.1`
with a CHANGELOG entry.

---

## 1. The two-sidebar problem (root cause of your screenshot)

Your screenshot shows two completely different sidebars stacked
side-by-side. That is **two real navigation systems rendered at once**, plus
a stale-cache artifact:

| # | Visible in screenshot | Real source | Status now |
|---|---|---|---|
| Outer (dark navy) | Command Center → Overview, **My Cases**, Legal Chat, **Nyayamitra Chat**, AI Workspace, **Contract Lifecycle**, **E-Filing**, Legal Research, **Calendar**, Ecosystem Mgmt → … **Client Management**, **Referral Network** … | `client/src/components/NyvSidebar.tsx` (the canonical sidebar) | The current file content does NOT contain any of those bold labels — `rg "My Cases"` returns zero hits in `client/src/`. The screenshot is a **stale build** (workflows were stopped; bundled JS predates commit `833343e`). After workflow restart + hard browser refresh, the outer sidebar shows the cleaned 5-section layout I documented in our previous turn. |
| Inner (white, orange labels) | Core Platform → Command Overview, User Management, Tenant & Billing, Platform Control … AI Intelligence … Advanced AI → **Phase 4 / Phase 5** | `client/src/pages/command-centre.tsx` lines **105-156** (`SIDEBAR_GROUPS`) | **REAL DUPLICATE.** The Command Centre page renders its own internal sidebar inside the outer one. This is the visible "second sidebar" in your screenshot and exists today. Must be deleted in v5.0.1. |

**Decision:** kill the inner duplicate. The Command Centre page becomes a
**single content surface** that responds to the outer sidebar's `Mission
Control` selection. No nested navigation.

---

## 2. Code-level duplication inventory

### 2.1 Orphan navigation components (delete)
- `client/src/components/navigation.tsx` — old "Dashboard / Demos / Upload / Analytics" nav from a different product. **Zero importers.**
- `client/src/components/EnhancedNavigation.tsx` — old "Code Studio / AI Assistant Builder / Game Builder / Business Studio" nav. **Zero importers** in pages, only self-referential.
- `client/src/components/sidebar.tsx` — generic shadcn sidebar primitive used by exactly one orphan page (`orchestration-dashboard.tsx`). Keep the file (it's a reusable primitive) but the page that uses it is itself orphan (see §2.3).

### 2.2 Duplicate / overlapping dashboards (collapse)

There are **22 files** matching `*dashboard*.tsx` or `*console*.tsx` in
`client/src/pages/`. After triage, the canonical set is **5**, the rest fold
into them:

| Keep (canonical) | Folds in / replaces |
|---|---|
| `command-centre.tsx` (Mission Control) | `nyayavigya-dashboard.tsx`, `admin-console.tsx`, `unified-central-dashboard.tsx`, `unified-enterprise-dashboard.tsx`, `realtime-dashboard.tsx`, `feature-test-dashboard.tsx` |
| `org-admin-dashboard.tsx` (per-org admin view) | — |
| `orchestration-dashboard.tsx` (agent orchestration runtime) | `agent-activity-dashboard.tsx`, `agent-flows-dashboard.tsx`, `automation-dashboard.tsx`, `lrm-router-dashboard.tsx`, `llm-priority-dashboard.tsx` |
| `intelligence-dashboard.tsx` (Central Intelligence) | `sdlc-dashboard.tsx`, `digital-twin-dashboard.tsx` |
| `guardrail-dashboard.tsx` (Governance live view) | `llm-judge-console.tsx`, `clawdbot-console.tsx` (those become tools, not dashboards) |

Net: **17 dashboard files removed**, 5 retained, all wired through the
single outer sidebar with RBAC.

### 2.3 Orphan page files (34 unrouted)
34 page files exist on disk but are not registered in `App.tsx`. Highlights:
`adversarial-testing.tsx`, `agent-creation-wizard.tsx`,
`agent-live-testing.tsx`, `agent-scorecard.tsx`,
`agent-testing-environment.tsx`, `agent-workspace.tsx`,
`architect-workflow-builder.tsx`, `automateai-builder.tsx`,
`p1-ai-quality-test.tsx`, `platform-management.tsx`,
`sdk-api-playground.tsx`, `sdk-api-tester.tsx`,
`sdk-developer-console.tsx`, `sdk-platform-onboarding.tsx`,
`sdk-testing-console.tsx`, `skills-library.tsx`, `Onboarding.tsx`
(case-collision with `onboarding.tsx`).

**Action:** cross-reference each against the new sidebar (§5). Anything not
on the new sidebar AND not deep-linked from a kept page → delete. The
`Onboarding.tsx` / `onboarding.tsx` collision is dangerous on
case-insensitive filesystems (macOS dev → Linux EC2) and must be resolved.

### 2.4 Duplicate route paths
`App.tsx` has 137 `<Route>` declarations. Two duplicates today:
`/home` (×2) and `/agent-testing` (×2). Several aliases route to the same
component (`/admin`, `/admin-console` → `CommandCentre`). Aliases stay
(legacy URLs); duplicates get deduped.

### 2.5 Backend route files that don't belong here
`src/routes/` has 81 files. Two are law-firm productivity that belong in
NSP backend, not the Nyayavigya backbone:
- `nv-case-management-routes.ts`
- `nv-case-update-routes.ts`

**Action:** move to `examples/nsp-web-quickstart/server/` (or delete if NSP
is consuming the SDK and doesn't need them) and unmount from `server.ts`.

---

## 3. Database schema reality check

`shared/schema.ts` — 1,954 lines, **87 tables**, single file. Categorized:

| Category | Count | Examples | Belongs in NV backbone? |
|---|---|---|---|
| `nv*` core | included in OTHER | `nvUsers`, `nvOrganizations`, `nvSessions`, `nvAuthTokens` | ✅ YES |
| `sdk*` | 10 | `sdkApplications`, `sdkAppApiKeys`, `sdkUsageMetering`, `sdkWorkflows`, `sdkClauseLibrary`, `sdkComplianceControls` | ✅ YES |
| `document*` | 5 | `documentParsing`, `documentPages`, `documentExtractedContent`, `documentProcessingJobs` | ✅ YES |
| `hitl*` | 2 | `hitlWorkflows`, `hitlWorkflowExecutions` | ✅ YES |
| `legal*` | 3 | `legalAgents`, … | ✅ YES |
| `nyaya*` | 3 | `nyayavigyaFounderContextProfiles`, `nyayavigyaContextLearningHistory`, `nyayavigyaOrchestrationJobs` | ⚠️ "founderContextProfiles" — domain-leak. Audit. |
| `wai*` (email automation) | 5 | `waiEmails`, `waiEmailAccounts`, `waiEmailAutomationRules`, `waiEmailResponses`, `waiEmailProcessing` | ❌ NO — looks like an embedded email-automation product (different from AutomateAI). Move out or document. |
| Other | 59 | Most of the platform — needs full enumeration before final cleanup | mostly ✅ |

**Action for v5.0.1 (non-destructive):** keep all 87 tables, do NOT drop
columns or rename. We only:
1. Document each table's owner (NV vs downstream) in
   `docs/v5.0.0/SCHEMA-OWNERSHIP-2026-05-06.md`.
2. Add a follow-up task to extract `wai*` (email automation) into its own
   schema namespace in v5.1 if confirmed not part of the AI backbone.
3. Verify all 87 tables exist in the live RDS DB (drift check) before EC2
   deploy.

`drizzle/` migrations 0000-0006 are the source of truth; `drizzle-kit push`
for new migrations only.

### 3.1 10M-row scale considerations (forward-looking)
The schema currently has **no partitioning, no columnar indexes, no time-range
sharding** on the high-write tables (`sdkApiRequestLogs`, `sdkUsageMetering`,
`documentProcessingJobs`, `nv_audit_chain`). For 10M+ rows per table:
- Add **monthly range partitions** on `sdkApiRequestLogs` and `sdkUsageMetering`
  by `created_at` (PG14+ declarative partitioning).
- Add composite indexes: `(org_id, created_at DESC)` and `(api_key_id, created_at DESC)`.
- Move `nv_audit_chain` to TimescaleDB hypertable OR partition by month +
  retention policy (immutable older partitions get archived to S3).
- Add `pg_cron` jobs to vacuum/analyze high-churn tables nightly.

These are **10M-prep tasks** (not v5.0.1 blockers). Will be tracked in a
new `docs/v5.0.0/SCALE-10M-READINESS.md` for post-launch v5.1.

---

## 4. Backend route → SDK exposure audit

`src/routes/` has 81 files. The user's mandate is "Nyayavigya = backbone,
exposes everything via SDK + API." Audit shows current registration in
`src/server.ts` covers the core surfaces (gateway, agents, intelligence,
docs, governance, SDK provisioning). Three issues:

1. **Two law-firm-only route files** (§2.5) shouldn't be here.
2. **Phase 4 / Phase 5 routes** (`nv-phase4-routes.ts`, `nv-phase5-routes.ts`)
   are exposed but their corresponding sidebar items are *only inside the
   inner duplicate sidebar* — orphaned at the outer level. Either expose
   them via the new sidebar (under AI Operations → Advanced AI) or remove.
3. **No central API spec** — there is `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-05.md`
   but it's a flat doc, not OpenAPI. For 7 downstream platforms to consume
   reliably at 10M scale, generate OpenAPI 3.1 from the route definitions
   (one-time codegen, then keep in sync via CI). Tracked for v5.1.

---

## 5. The single-dashboard target navigation (RBAC-gated)

One dashboard, one outer sidebar, role-based visibility. Everything below
is what the **outer** sidebar will look like after v5.0.1. The inner
sidebar inside `command-centre.tsx` is **deleted**.

```
┌─ COMMAND CENTER ────────────────────────────── (minRole: user) ──┐
│  • Mission Control            /command-centre                    │
│  • AI Legal Chat (Testbed)    /legal-chat                        │
│  • AI Workspace               /chat                              │
│  • Central Intelligence       /intelligence/dashboard            │
│  • Platform Health Map  NEW   /platform-health                   │
│  • Live Activity Feed   NEW   /activity                          │
│  • My Approvals         NEW   /approvals                         │
└──────────────────────────────────────────────────────────────────┘

┌─ ECOSYSTEM MGMT ──────────────────────────── (minRole: org_admin) ─┐
│  • Organisations              /superadmin/organisations            │
│  • Platform Registry          /superadmin/platforms                │
│  • Platform Settings          /org/platform-settings               │
│  • SDK Key Lifecycle          /sdk-key-management                  │
│  • Module Management          /platform-management                 │
│  • Team & RBAC                /rbac-console                        │
│  • Tenant Subscriptions  RNM  /billing/subscription                │
│  • Credit Wallet              /billing/credits                     │
│  • White-Label                /white-label                         │
│  • Onboarding Wizard          /onboarding                          │
└────────────────────────────────────────────────────────────────────┘

┌─ AI OPERATIONS ────────────────────────────── (minRole: operator) ─┐
│  ── Agents & Orchestration ──                                      │
│  • Agent Registry             /agent-registry                      │
│  • Agent Matrix               /superadmin/agents                   │
│  • Agent Wizard               /agent-wizard                        │
│  • Orchestration              /orchestration                       │
│  • ROMA L5 Admin              /roma-l5-admin                       │
│  ── LLMs & Routing ──                                              │
│  • LLM Priority Router        /llm-priority                        │
│  • Model Catalog              /model-catalog                       │
│  • LLM Budget Control         /superadmin/llm-budget               │
│  • Cost Optimizer             /cost-optimizer                      │
│  ── Intelligence Suite ──                                          │
│  • Legal Research             /intelligence/research               │
│  • Outcome Prediction         /intelligence/predict                │
│  • Classify                   /intelligence/classify               │
│  • Sentiment                  /intelligence/sentiment              │
│  • Translate                  /intelligence/translate              │
│  ── Document AI ──  NEW                                            │
│  • Document AI Hub      NEW   /document-ai                         │
│  • OCR & Extraction     NEW   /document-ai/ocr                     │
│  • Summarization        NEW   /document-ai/summarize               │
│  • Forensics                  /document-forensics                  │
│  ── Knowledge & Prompts ──  NEW                                    │
│  • Prompt Library       NEW   /prompts                             │
│  • RAG / Knowledge Base NEW   /rag                                 │
│  • Tools & MCP          NEW   /tools                               │
│  ── Legal Knowledge ──  NEW                                        │
│  • Statutes & Citations NEW   /legal/statutes                      │
│  • Jurisdiction Mapping NEW   /legal/jurisdictions                 │
│  • Web Scraping Targets NEW   /legal/scraping                      │
│  ── AI Modules ──                                                  │
│  • ClaWdBot™                  /clawdbot                            │
│  • OpenBot™                   /openbot                             │
│  • AutomateAI™                /automateai                          │
│  • TwinDesk™                  /twindesk                            │
│  • SkillShop™                 /skillshop                           │
│  ── Advanced AI ──  (was inside duplicate sidebar)                 │
│  • Phase 4 — Advanced AI NEW  /phase4                              │
│  • Phase 5 — Next-Gen AI NEW  /phase5                              │
└────────────────────────────────────────────────────────────────────┘

┌─ GOVERNANCE ──────────────────────────────── (minRole: analyst) ──┐
│  • ISO 42001 Compliance       /superadmin/compliance              │
│  • EU AI Act                  /eu-ai-compliance                   │
│  • DPDPA Compliance     NEW   /dpdpa-compliance                   │
│  • Hash Chain Audit           /audit-chain                        │
│  • HITL Decisions             /hitl-decision-cards                │
│  • Guardrail Monitor          /intelligence/guardrails            │
│  • Adversarial Testing        /adversarial                        │
│  • Model Drift                /drift-monitor                      │
│  • Regulatory Monitor         /regulatory                         │
│  • GRPO Training              /orchestration/grpo                 │
│  • LLM Judge Console          /llm-judge                          │
└───────────────────────────────────────────────────────────────────┘

┌─ SDK DEVELOPER ─────────────────────────── (minRole: developer) ──┐
│  • SDK Hub                    /sdk-hub                            │
│  • Developer Console          /sdk-console                        │
│  • Platform Onboarding        /sdk/onboarding                     │
│  • API Tester                 /sdk/api-tester                     │
│  • API Playground             /sdk-playground                     │
│  • Testing Console            /sdk-testing                        │
│  • Smoke Harness Console NEW  /sdk/smoke                          │
│  • SDK Downloads              /sdk-downloads                      │
│  • Database Schema            /database-schema                    │
└───────────────────────────────────────────────────────────────────┘
```

**RBAC matrix** (`ProtectedRoute minRole=…`):
- `user` < `developer` < `operator` < `analyst` < `org_admin` < `super_admin`
- Each section has a `minRole` (shown above). Items inside sections may
  override with a stricter `minRole` (e.g., `Tenant Subscriptions` =
  `org_admin`, `GRPO Training` = `senior_analyst`).

---

## 6. v5.0.1 execution plan (one pass, versioned, with CHANGELOG)

This is what I will execute when you say "go". All work is bundled under
**v5.0.1** with a single CHANGELOG entry. The order is dependency-driven so
nothing breaks mid-flight.

### Phase A — Cleanup (touches 0 functionality, fixes the screenshot)
1. Delete inner sidebar from `client/src/pages/command-centre.tsx`
   (lines 105-156 + the `SIDEBAR_GROUPS`/`SIDEBAR_SECTIONS` const + the
   left rail JSX in the render). Convert to single-content layout.
2. Delete `client/src/pages/nyayamitra-chat.tsx` + remove route + sidebar
   entry. (Confirmed: `examples/nyayamitra-mobile/` owns this surface.)
3. Delete orphan nav components:
   `client/src/components/navigation.tsx`,
   `client/src/components/EnhancedNavigation.tsx`.
4. Delete the 17 redundant dashboard files (§2.2) + 34 orphan page files
   (§2.3) where confirmed unreachable. Keep `Onboarding.tsx` OR
   `onboarding.tsx` (not both — case-collision).
5. Dedupe duplicate `<Route>` entries in `App.tsx` (`/home`, `/agent-testing`).
6. Move `nv-case-management-routes.ts` + `nv-case-update-routes.ts` out of
   `src/routes/` (or delete) and unmount from `src/server.ts`.

### Phase B — Sidebar v2 (single source of truth)
7. Rewrite `client/src/components/NyvSidebar.tsx` to the §5 layout. RBAC
   `minRole` enforced per section + per item. Section dividers (no nested
   menus).
8. Add the rename: `Org Billing` → `Tenant Subscriptions`.

### Phase C — New pages (functionality)
9. Build the 11 new pages listed in §5 as `NEW`:
   - **Command Center:** Platform Health Map, Live Activity Feed, My Approvals (3)
   - **AI Operations:** Document AI Hub, OCR & Extraction, Summarization,
     Prompt Library, RAG/KB, Tools & MCP, Statutes & Citations,
     Jurisdiction Mapping, Web Scraping Targets (9)
   - **Governance:** DPDPA Compliance (1)
   - **SDK Developer:** Smoke Harness Console (1)
   Each page is functional (real API wiring), not a placeholder. Where the
   backend route exists today, page calls it; where it doesn't, page calls
   a new `src/routes/nv-<feature>-routes.ts` skeleton that returns
   `501 Not Implemented` with a clear `feature_flag` field — so the UI
   compiles and renders, but production knows the feature is staged.

### Phase D — Tighten Command Centre page itself
10. The page becomes the "Mission Control" content for `/command-centre`.
    KPIs pulled from existing endpoints:
    `/api/nv/health/full`, `/api/nv/gateway/usage`,
    `/api/nv/dashboard`, audit-chain head hash. No more inner navigation.

### Phase E — Schema documentation (no DDL)
11. Write `docs/v5.0.0/SCHEMA-OWNERSHIP-2026-05-06.md` enumerating all 87
    tables with owner (NV-CORE / SDK / DOC-AI / HITL / LEGAL / WAI / OTHER),
    write/read pattern, expected row count at 10M-user scale, partition
    candidate Y/N.
12. Write `docs/v5.0.0/SCALE-10M-READINESS.md` with the partitioning +
    indexing plan (deferred to v5.1, but documented now).

### Phase F — Versioning & CHANGELOG
13. Bump `package.json` → `5.0.1`.
14. Bump `NYV_PLATFORM_VERSION` constant → `5.0.1`.
15. Add `[5.0.1] — 2026-05-06` section to `CHANGELOG.md` listing every
    Phase A-E action with file paths.
16. Update `replit.md` "Where things live" pointers + Gotchas.

### Phase G — Verification (the "first time right" gate)
17. `npm run typecheck` → 0 errors.
18. `npm run build` → succeeds.
19. Run `bash scripts/nv-smoke-bash.sh http://localhost:5000` → must hit
    **101/101 PASS** (this requires fixing the two deploy-blockers B1+B2
    from `EC2-CLEAN-DEPLOYMENT-PLAN.md` §0.1, which I will include in
    v5.0.1 since you asked for "all phases simultaneously").
20. Take fresh screenshots of each section (Command Center, Ecosystem,
    AI Ops, Governance, SDK Dev) at three RBAC roles (user, operator,
    super_admin). Save under `docs/v5.0.0/screenshots/v5.0.1/`.
21. Use the Replit testing skill to run an end-to-end Playwright pass
    over: login → each sidebar item → assert page loads without error.

### Estimated effort
~ **6-7 days** of focused work end-to-end. Compresses from the prior 8-day
estimate because (a) we're folding in the EC2 blocker fixes, (b) deletions
are fast, (c) new pages share a common skeleton.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Deleting an "orphan" page that's actually deep-linked from another page | For each candidate deletion: `rg "page-name"` in entire `client/src/` first. If any reference exists → rename target to "**deferred**" instead of delete. |
| RBAC regressions (a `super_admin`-only page becomes visible to `user`) | Add unit test per sidebar section asserting `minRole` semantics. Run E2E with three role tokens. |
| Schema drift between `shared/schema.ts` and live RDS | Run `drizzle-kit check` against live DB before deploy. Block deploy on diff. |
| 10M-scale tasks slip into v5.0.1 and bloat scope | Strict scope: v5.0.1 = navigation + cleanup + EC2 blockers ONLY. Scale work is a documented v5.1 backlog. |
| Breaking SDK consumers in NSP/NYM/JRX clients | No backend route deletions except the two confirmed law-firm leaks. SDK contract unchanged. Run smoke against all 7 platform keys. |

---

## 8. What I need from you to proceed

One go/no-go decision:

> **"Approved — execute v5.0.1 per §6, ship in one PR with CHANGELOG, and re-run the 101-probe smoke at the end."**

Or, if you want to stage:

> **"Approved Phase A+B+F (cleanup + sidebar + version) only this week; defer C+D+E+G to next sprint."**

Or any custom slice. Once you confirm, I execute end-to-end, run all
verifications, and present the green smoke ledger + screenshots.

---

## Appendix A — Files to be deleted (full list)

```
# Orphan nav components
client/src/components/navigation.tsx
client/src/components/EnhancedNavigation.tsx

# Replicated downstream-only page
client/src/pages/nyayamitra-chat.tsx

# Redundant dashboards (folded into the canonical 5)
client/src/pages/nyayavigya-dashboard.tsx
client/src/pages/admin-console.tsx
client/src/pages/unified-central-dashboard.tsx
client/src/pages/unified-enterprise-dashboard.tsx
client/src/pages/realtime-dashboard.tsx
client/src/pages/feature-test-dashboard.tsx
client/src/pages/agent-activity-dashboard.tsx
client/src/pages/agent-flows-dashboard.tsx
client/src/pages/automation-dashboard.tsx
client/src/pages/lrm-router-dashboard.tsx
client/src/pages/llm-priority-dashboard.tsx
client/src/pages/sdlc-dashboard.tsx
client/src/pages/digital-twin-dashboard.tsx

# Case-collision — keep one
client/src/pages/Onboarding.tsx   # keep onboarding.tsx (lowercase, sidebar-referenced)

# Backend law-firm leaks (move OR delete)
src/routes/nv-case-management-routes.ts
src/routes/nv-case-update-routes.ts
```

(34 orphan pages from §2.3 will be triaged file-by-file during Phase A
with `rg`-confirmed safety before deletion.)

## Appendix B — CHANGELOG entry preview

```markdown
## [5.0.1] — 2026-05-06 — Navigation & dashboard consolidation

### Removed
- Duplicate inner sidebar inside `client/src/pages/command-centre.tsx`
  (lines 105-156). The page is now a single content surface.
- Orphan nav components: `navigation.tsx`, `EnhancedNavigation.tsx`.
- Downstream-owned page: `nyayamitra-chat.tsx` (lives in NYM client).
- 17 redundant dashboard files (see Appendix A in
  `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`).
- Backend law-firm route files moved out of NV backbone:
  `nv-case-management-routes.ts`, `nv-case-update-routes.ts`.
- Duplicate `<Route>` declarations: `/home`, `/agent-testing`.

### Added
- 11 new pages wired to backend: Platform Health Map, Live Activity Feed,
  My Approvals, Document AI Hub, OCR & Extraction, Summarization, Prompt
  Library, RAG/Knowledge Base, Tools & MCP, Statutes & Citations,
  Jurisdiction Mapping, Web Scraping Targets, DPDPA Compliance, Smoke
  Harness Console.
- `docs/v5.0.0/SCHEMA-OWNERSHIP-2026-05-06.md` (87-table inventory).
- `docs/v5.0.0/SCALE-10M-READINESS.md` (forward-looking partitioning plan).

### Changed
- `NyvSidebar.tsx` → single source of truth, RBAC-gated, 5 sections.
- "Org Billing" → "Tenant Subscriptions".
- `package.json`, `NYV_PLATFORM_VERSION` → `5.0.1`.

### Fixed
- B1 (deploy-blocker): `domainResearchAPIService.searchLegal is not a function`.
- B2 (deploy-blocker): `/api/nv/gateway/translate` and `/research/query`
  scope rules corrected.

### Verified
- `bash scripts/nv-smoke-bash.sh` → 101/101 PASS.
- `npm run typecheck` → 0 errors.
- E2E Playwright pass at three RBAC roles.
```
