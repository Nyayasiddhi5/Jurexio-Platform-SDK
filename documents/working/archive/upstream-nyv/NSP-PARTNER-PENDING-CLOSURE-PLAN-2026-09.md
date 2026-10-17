# NSP partner — pending/partial inventory + closure plan

> **Tracker:** `NV-NSP-PARTNER-CLOSURE-PLAN-001` · **Snapshot:** 2026-09-22 · deploy **`5417fb15`** (Wave D; live crosscheck [Platform full-flow crosscheck](fae4da54-f94a-48cf-b089-6b42e0b232a1))  
> **Companion:** [`NSP-PARTNER-LIVE-PENDING-FLOWS-2026-09.md`](./NSP-PARTNER-LIVE-PENDING-FLOWS-2026-09.md)

**Verify baseline:** `partner:smoke:ec2` · `demo:probe:ec2` · `NSP_PROBE_REQUIRE_NYV_VALIDATION=1 npm run probe:nyv`

---

## A. Master inventory (PARTIAL / PENDING / BLOCKED)

See subagent deliverable for full 40-row table (corpus #1–13, CNR #14–17, eCourts #18–20, drafting #21–26, search #27–29, NSP #30–33, SME #34–36, ops #37–40). **LIVE today:** #17 resolve/cascade/bundle, #21 drafting SSE + Wave C, #27 instant search via NYV, #31 BFF contract.

---

## B. Workstreams (next actions)

| Workstream | Top gaps | Owner | GO / verify |
|------------|----------|-------|-------------|
| **Corpus** | Embed ~77%, PII/diary 0%, Siddhanta merge, acts sparse | NYS/Ops | P1 monitor; embed soak; `_nsp-field-coverage-probe.ts` |
| **Live eCourts** | Tier-3 NIC + Tier-4b portal OFF | NYV+Ops | Post-demo NIC key **GO**; `live-fetch` poll |
| **Drafting** | `courtFee`, procedural limitation depth | NYV+SME | P2 SME fee pack; probe:nyv |
| **NSP BFF** | Filing Readiness + SSE parser | NSP | Staging stream vs public API |
| **SME** | State fees, certified forms | SME | Registry sign-off |
| **Ops/prod** | `.com`, rotation, UAT D1–D4 | Ops+QA | Infra **GO**; UAT v2 |

---

## C. Roadmap (from 2026-09-22)

- **~30d:** NSP Filing Readiness (#25, #30); P1 ETL + merge (#9); keep eCourts OFF unless NIC **GO**
- **~60d:** P3/joins; `draftProfile.limitation` if SME ready; matter UX manual slots until PII ≥15%
- **~90d:** Embed →85%+; optional NIC pilot; `courtFee` P2; P5/P6 if keys approved

**Appendix L gate:** do not drop manual PII/status until PII **≥15%** and hearings **≥75%** on disposed sample.

---

## D. Honest “100% ready”

| Workstream | Pilot-ready | Not literal 100% |
|------------|-------------|------------------|
| Corpus | Cascade green, honest `not_found`, DC national in RDS | Every CNR, full PII, full body FTS |
| eCourts | Tier-3 opt-in pilot | Portal captcha at scale; `claimEcourts` everywhere |
| Drafting | `-fast` + validationResults + 40 keys | All state fees; certified forms; e-filing |
| NSP | NYV-only BFF + Readiness UI | Console parity |

---

## E. Checklist (C-01 … C-25)

| ID | Item | Owner | Next action | Verify |
|----|------|-------|-------------|--------|
| C-01 | Embed ~77% | NYS/Ops | Continue embed job | Embed SLO |
| C-02 | PII 0% | NYS/Ops | New PII source + ETL (unchanged post GO-002) | field-coverage probe |
| C-03 | P1 2025 slice | NYS/Ops | **DONE** — ETL complete; acts **~76%** on 2025+ slice | SSM `b5814025`, `a2eb34bf` |
| C-04 | Siddhanta merge | NYS/Ops | **DONE** — run complete; **updated=0** (overlap limited) | SSM `429214fc`, log `20260921T040156Z` |
| C-05 | delta-dc | NYS/Ops | **DONE** | DC 9,523,847 |
| C-06 | Diary P2a | NYV | **DONE** — legacy enrich without CNR on nysdev **`dd96c667`** | SSM `2229a3d7` |
| C-07 | SC diary cnr null | NSP | Diary-first UX | Matter E2E |
| C-08 | SC diary timeline | NYS/Ops | **BLOCKED** — pending diaries have **no CNR** | SSM `925ce4cc`; one-pager §10 |
| C-09 | Tier-3 NIC | Ops+NYV | Key + flag **GO** | ecourts-live-fetch |
| C-10 | Tier-4b portal | NYV+Ops | Session/captcha pilot | live-fetch poll |
| C-11 | claimEcourts policy | Legal+NSP | Product copy | toggle review |
| C-12 | validationResults SSE | NYV | **DONE** | probe:nyv |
| C-13 | Filing Readiness UI | NSP | Parse run_completed | NSP staging |
| C-14 | limitation procedural | NYV+SME | **DONE** (appeal/caveat/revision days on **`dd96c667`**) | probe:nyv |
| C-15 | courtFee | NYV+SME | P2 fee pack | phase-4 tests |
| C-16 | hybrid search UX | NSP+NYS | fts vs hybrid | typeahead QA |
| C-17 | CNR resolve/search | NYV | **DONE** | partner:smoke |
| C-18 | document bundle | NYV | **DONE** | SDK 5.1.5 |
| C-19 | Kanoon P6 | NYV | **DONE** (auto-enable when key set; no key on EC2) | vitest mock |
| C-20 | PDF P5 | NYV | **DONE** (legacy extractPreview merge on resolve) | diary probe |
| C-21 | NYS dist rebuild | NYS/Ops | **BLOCKED** — no pnpm/source on worker; use workstation `build.mjs` upload | SSM `5839fda7` |
| C-22 | nyayasiddhi.com | Ops | Prod plan | cutover smoke |
| C-23 | Key rotation | Ops | Post-demo **GO** | handover stamp |
| C-24 | UAT D1–D4 | QA | Browser pass | UAT v2 |
| C-25 | Manual PII slots | NSP | Until C-02 ≥15% | Appendix L |
