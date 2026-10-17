---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# Plan-vs-Reality Delta — 2026-05-06 Session 4

**Purpose:** Honest reconciliation of `NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`
plan claims against on-disk truth, performed via direct `ls` / `rg` /
`psql` audit on **2026-05-06**. Written because the rolling session-plan
document had drifted from reality — multiple "remaining" items were
already done, one item flagged "broken" was actually fine, and one
foundational doc (`replit.md`) referenced files that have never existed.

This document is the new source of truth for what is actually pending.
The old "Status" table in `NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md`
should be re-read **alongside** this delta, not in isolation.

---

## 1. T003 — Phase C "Build 14 NEW pages"

**Plan claim:** 14 pages to build, ~5-6 days, blocked on T002.

**Disk reality:**

| # | Page (slug) | File on disk? |
|---|---|---|
| 1 | `platform-health-map.tsx` | ✅ EXISTS |
| 2 | `live-activity-feed.tsx` | ✅ EXISTS |
| 3 | `my-approvals.tsx` | ✅ EXISTS |
| 4 | `document-ai-hub.tsx` | ✅ EXISTS |
| 5 | `ocr-extraction.tsx` | ✅ EXISTS |
| 6 | `summarization.tsx` | ✅ EXISTS |
| 7 | `prompt-library.tsx` | ✅ EXISTS |
| 8 | `rag-kb.tsx` | 🔴 **MISSING** |
| 9 | `tools-mcp.tsx` | ✅ EXISTS |
| 10 | `statutes-citations.tsx` | ✅ EXISTS |
| 11 | `jurisdiction-mapping.tsx` | ✅ EXISTS |
| 12 | `web-scraping-targets.tsx` | ✅ EXISTS |
| 13 | `dpdpa-compliance.tsx` | ✅ EXISTS |
| 14 | `smoke-harness-console.tsx` | ✅ EXISTS |

**Result: 13 of 14 page files exist. Only `rag-kb.tsx` is truly missing.**

**Caveat — NOT VERIFIED THIS SESSION:**
- Quality of each existing page (real backend wiring vs `<div>TODO</div>`).
- Whether each is registered in `App.tsx` and reachable from the sidebar.
- Whether the "501-stubbed endpoint" pattern from the audit was followed.

**Honest T003 status:** ~93% of file scaffolding done; functional-quality
audit pending; 1 file still to create. Effort to truly close T003 is
**hours, not days**, IF the existing 13 pages are functional. Could be
**days** if most are placeholder shells.

---

## 2. T004 — Phase D "Replace 55 hardcoded mock-data sites"

**Plan claim:** 55 sites, ~2 days.

**Disk reality (re-run 2026-05-06):**

| Regex | Match count in `client/src/pages/` |
|---|---|
| `mockData\|MOCK_DATA\|fakeData\|sampleData` (narrow — what plan text implies) | **0 files** |
| `TODO\|FIXME\|placeholder\|hardcoded\|dummy` (broader — what plan number implies) | **52 files** |
| `TODO\|FIXME\|mockData\|MOCK_DATA\|fakeData\|FAKE_\|sampleData` (per-task description) | needs re-run |

**Result:** The "55 sites" number cited in the plan corresponds to a
broader regex than the plan text describes. Either:
- (a) Adopt the broader regex and tackle all 52 — but most "TODO" / "placeholder"
  hits are intentional UI copy ("Search placeholder…") not mock data.
- (b) Define mock-data more precisely (e.g., literal arrays of fake records
  that should be `useQuery`) and re-count.

**Honest T004 status:** Cannot be measured against current text; needs the
acceptance criterion sharpened before work can claim done. Likely the
**real** mock-data swap surface is a small subset of the 52 (probably
8-15 files), not all of them.

---

## 3. Phase 2A scaffolding state

**Plan claim:** Scaffolding "intact and unmounted, dormant on disk".
**My earlier (Session 3) false claim:** "Imports broken — refs `n-service.js`."

**Disk reality (2026-05-06 Session 4 re-verification):**

| File | Exists | Imports valid | Mounted in `src/index.ts` |
|---|---|---|---|
| `src/services/nv-doc-sharing-service.ts` | ✅ | ✅ (imports `nvDocShareGrants` from `shared/schema`, `getNyvDmsConfig` from `nyv-dms-config`) | n/a |
| `src/routes/nv-doc-sharing-routes.ts` | ✅ | ✅ (imports from `../services/nv-doc-sharing-service.js`) | ❌ NOT MOUNTED |
| `src/config/nyv-dms-config.ts` | ✅ | ✅ | n/a |
| `config/storage/document-storage-deployment.yaml` | ✅ | (config file) | n/a |
| DB table `nv_doc_share_grants` | ✅ exists in DB | n/a | n/a |
| DB table `nv_esign_sessions` | ✅ exists in DB | n/a | n/a |

**Why Session 3's "broken imports" was wrong:** The audit ran
`rg -n "n-service" …` to find references to the doc-sharing service.
Because `n-service` is a substring of `nv-doc-sharing-service`, every
correct reference matched the regex. There are no actual broken imports.

**Honest Phase 2A status:** Compile-clean and DB-ready. The remaining
gate is the user's "T001-T005 all green" mandate plus the Phase A/B/C/D/E
cleanup work. Mount-and-go is plausibly a half-day once gated open.

---

## 4. `replit.md` factual errors found and fixed this session

| Old claim | Reality | Fix |
|---|---|---|
| API Entry Point: `src/server.ts` | File never existed; entry is `src/index.ts` | Updated to `src/index.ts` with explicit callout |
| Run Gateway: `node dist/server.js` | `dist/` is empty in dev; gateway runs via `bash scripts/nv-start-dev.sh` (tsx) | Updated to dev script + clarified prod build path |
| Phase 2A scaffolding "intact and unmounted" (vague) | Files compile, DB tables exist, routes not mounted in `src/index.ts` | Updated with specific file list + mount status |

---

## 5. What is actually pending after this session

| Task | Real status | Realistic effort |
|---|---|---|
| T001 Phase A finish | ✅ MERGED | done |
| T002 lint | ✅ GREEN | done |
| T003 page files | 🟡 13/14 exist; functional quality not audited | Hours (audit) + ~half day (rag-kb.tsx + any placeholder fixes) |
| T004 mock-data swaps | 🟡 acceptance criterion unclear; 52 files match broad regex but most are not mock data | Re-define scope first |
| T005 SDK doc refresh | ✅ DONE | done |
| Phase 2A mount | 🟡 dormant on disk, ready to mount | ~half day to wire + smoke test |
| E2E Playwright across 7 platforms | 🔴 NOT STARTED | 1-2 days |
| Phase F versioning + CHANGELOG (5.0.1) | 🔴 NOT STARTED | 2 hours |

**Total realistic remaining effort to "ready for EC2 push": ~3-4 days.**
Not the 8-12 days my earlier estimate suggested, AND not the 1 hour the
session plan implied. The truth is in between.

---

## 6. Decisions deferred to user

1. **T004 acceptance:** Pick the regex / definition for "mock data" so
   the task has a falsifiable done criterion.
2. **T003 page audit:** Do you want me to walk all 13 existing pages and
   classify each as Functional / Stub / Broken, then fix gaps? (~half day)
3. **Phase 2A mount:** Once T003/T004 close, do you want the doc-sharing
   routes mounted in dev only (smoke test), or mount + Playwright E2E in one push?
4. **CHANGELOG / version bump:** Bump to 5.0.1 now (truth-pass milestone)
   or wait until Phase 2A mounts (5.1.0)?

---

**Author:** Replit Agent, Session 4
**Triggered by:** User instruction "crosscheck once again all the pending
tasks and their plan document" — explicit pushback on context drift.
**Methodology:** Direct `ls` / `rg` / `psql` audit; no reliance on prior
session memory or plan-doc claims.
