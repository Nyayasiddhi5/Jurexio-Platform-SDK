# Indian draft — SME rubric v2 workshop brief (one page)

> **Purpose:** Replace **engineering v1** (NV-INDIAN-DRAFT-EVAL-001, ~71–72% live baseline) with **SME-owned** quality definition before any **95%** NSP product claim.  
> **Beta constraint:** No **mandatory** NSP wire changes — optional P1 fields (`documentType`, `cnrFacts`, `matterRecall`, `templateId`) may improve scores but are not required for workshop or v2 fixture authoring.  
> **Cross-links:** `INDIAN-DRAFT-QA-RUBRIC-2026-10.md` · `NSP-OPTION-B-95-RELEASE-PROGRAM-2026-10.md` · fixtures `scripts/fixtures/nv-indian-draft-sme-cases.json` · code `src/services/nv-indian-draft-eval-rubric.ts`.

---

## What v1 is (today)

| Item | Status |
|------|--------|
| **Score meaning** | Deterministic checklist on **final draft text** (structure, completion, length band, advocate voice, placeholders) — **not** “would win in court.” |
| **Who set weights (30/30/15/15/10)** | Platform engineering (Oct 2026); **not** external SME sign-off. |
| **Who set “10 cases”** | Internal eval cost/runtime slice; platform registry has **20+** `DraftDocumentType` keys. |
| **External claim** | **Defer 95%** until v2 rubric + expanded fixtures + SME sign-off (`release95` stage). |

---

## Workshop goal (≈90 minutes)

1. Agree **what “filing-ready” means** per doc family for **medium (fast)** vs **comprehensive (counsel)** tiers.  
2. Confirm or revise **dimension weights** and **must-have sections** (see questions below).  
3. Decide **gold sample count** and **redaction rules** for the eval fixture pack.  
4. Name **sign-off owner** and **pass bar** for merge vs public 95% claim.

---

## Questions for legal SMEs (please answer in writing)

### A — Weights (0–100 total; current v1 in parentheses)

| # | Question |
|---|----------|
| A1 | Should **structure** (cause title, numbered paras, statutory blocks) stay **30%**, or rise/fall vs **completion** (prayer, verification, clean ending)? |
| A2 | Is **length vs tier** (**15%**) fair for **medium** (notice/bail) vs **comprehensive** (WS, SLP, agreements), or should length be **tier-split** (different weights per tier)? |
| A3 | **Advocate voice** (**15%**): which phrases are **hard fail** (e.g. “As an AI…”, wrong forum line) vs **soft penalty**? |
| A4 | **Placeholders** (**10%**): when facts are missing, is `[[PLACEHOLDER:…]]` **acceptable** up to N brackets, or always penalised on “rich fact” prompts? |
| A5 | Any **missing dimension** for Indian practice (e.g. **limitation citation**, **court fee / valuation**, **vakalatnama block**, **synopsis for SLP only**)? Proposed weight? |

### B — Must-have sections (per doc type)

For each type, mark **M** (mandatory at medium), **C** (counsel-only), **O** (optional), **N** (not required for AI beta).

**v1 eval covers 10 types** (fixture IDs): bail · WS · legal notice · SLP skeleton · HC writ · counter-affidavit · IA · review · execution · simple agreement.

**Registry types not in v1 eval (prioritise for v2):** affidavit (simple/case) · reply to notice · petition/application · criminal petition · divorce · civil plaint · written/final arguments · legal opinion · case summary · complex agreement · revision · cross-objection · caveat · general fallback.

| # | Question |
|---|----------|
| B1 | Provide a **one-row checklist** per type you care about (columns: cause title, showeth/facts, grounds, prayer/relief, verification, limitation, list of dates, synopsis, certificate, vakalatnama, annexures). |
| B2 | **Order VIII / BNSS / NI Act / CPC Order XLVII** — which doc types must **explicitly** reference the procedural frame in the body (not just parameters)? |
| B3 | **Supreme Court vs HC vs district/session** — should rubric **fail** generic “Republic of India” when `highCourt` / `courtName` was supplied? |
| B4 | **Transactional** (notice, agreement): is **signature block + place/date** mandatory at medium, or only at counsel? |

### C — Gold samples & fixtures

| # | Question |
|---|----------|
| C1 | **How many gold exemplars per doc type** for automation? Suggested default: **2 medium + 1 counsel** per type in **Phase 1 expansion** (10 types → 30 cases); **1+1** for long-tail types until demand proven. Accept? |
| C2 | **Source:** redacted firm templates, synthetic-only (current approach), or mix? **PII / privilege** handling and storage location (NYV repo vs secure vault only). |
| C3 | Should fixtures include **optional** `cnrFacts` / `matterRecall` (already supported in harness) for realism, or stay **prompt-only** for beta fairness? |
| C4 | **Negative controls:** include 2–3 prompts designed to **fail** (truncation, missing prayer) to prove rubric sensitivity? |

### D — Pass bars & tiers

| # | Question |
|---|----------|
| D1 | **Merge gate (engineering):** counsel avg ≥ fast + **5** points on fixture set — keep, drop, or replace with SME rule? |
| D2 | **95% claim:** average ≥ **95%** on **all** fixture types, or **95% per type** with no type below **85%**? |
| D3 | **Medium vs comprehensive:** same rubric weights for both lanes, or **counsel-only** sections (e.g. list of dates, detailed para-wise reply)? |
| D4 | **Human spot review:** how many live drafts per month before external marketing uses “95%”? |

### E — Beyond drafting (scope boundary)

| # | Question |
|---|----------|
| E1 | Confirm: **this workshop owns Indian draft deliverables only**; chat / research / search / docparse need **separate** SME briefs (see Option B task matrix). |
| E2 | Should **RAG / attachment-grounded** drafts use **same** structure rubric plus a **fidelity** dimension (later), or a separate gate?

---

## Workshop deliverables (NYV will implement after SME answers)

1. **`nv-indian-draft-sme-cases/v2`** fixture pack + changelog of prompts/parameters.  
2. **Rubric v2** in `nv-indian-draft-eval-rubric.ts` (weights + per-type must-haves aligned to SME table).  
3. **Updated gates:** merge threshold + `release95` thresholds documented in `INDIAN-DRAFT-QA-RUBRIC-2026-10.md`.  
4. **Sign-off record:** name, date, fixture version hash, approved pass bar (stored in `Project-Tracker.md` — no secret content).

---

## Sign-off block (complete after workshop)

| Field | Value |
|-------|--------|
| SME lead / firm | _ |
| Date (UTC) | _ |
| Approved weights | _ |
| Fixture schema version | _ |
| Pass bar (merge / 95% claim) | _ |
| Optional NSP P1 fields recommended? | Yes / No — _ |

---

*Tracker stamp when brief is adopted: append row to root `Project-Tracker.md`; v1 baseline remains valid until v2 is merged and re-run live.*
