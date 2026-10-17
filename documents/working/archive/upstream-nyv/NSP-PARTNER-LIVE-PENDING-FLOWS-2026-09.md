# NSP partner — LIVE vs PENDING + feature flows

> **Audience:** NSP product / BFF / PM · **API:** `https://api.nyayasiddhi.online` · **Snapshot:** 2026-09-22 · deploy **`5417fb15`** (`2026-09-22T1034Z-aws-ssm-5417fb15`) · probes **`demo:probe:ec2`** + **`probe:nyv`** PASS 2026-09-22T12:43Z  
> **Tracker:** `NV-NSP-PARTNER-BRIEF-001` · **Closure plan (40 gaps + C-01…C-25):** [`NSP-PARTNER-PENDING-CLOSURE-PLAN-2026-09.md`](./NSP-PARTNER-PENDING-CLOSURE-PLAN-2026-09.md)  
> **NSP case fields + documents (Appendix C):** [`NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md`](./NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md#appendix-c--nsp-partner-export-resolve--search--casecreate--documents)

---

## Part A — Status NOW

### Case corpus (SC / HC / DC)

Large national archive: case-api index ~**57M** rows, DuckDB lookup ~**78M**, DC judgments **9,523,847** (32 state prefixes after national delta-dc). S3 judgment objects ~129k HC / 43k SC / 188k DC. Semantic embed ~**77%** India aggregate — keyword search broad; hybrid quality improves with backfill.

### CNR resolve & search

**LIVE:** `POST /api/nv/v1/sdk/cnr/resolve` (CNR or SC diary) → `found` / `not_found` / `suggested` + **`caseCreate`** autofill. **Unified cascade LIVE:** Tier-1 miss → Tier-2 legacy (RDS / Athena / S3). **Search LIVE:** `GET …/sdk/cnr/search`. Always **`claimEcourts: false`** (corpus, not live docket).

### Filing & drafting

**LIVE:** orchestrate stream with `-fast` task types; terminal **`run_completed`** carries **`validationResults[]`** + **`draftProfile`** (probe PASS 2026-09-22). **43** filing-book `nvTemplateKey`s (Wave D) + **`legal-draft-agentic`**. **`draftProfile.courtFee`** advisory (generic slab + `unavailableReason` when state tables absent).

### Instant Search

**LIVE** via NYV only (`nyv.instantSearch.*`). Statutes typeahead fast; caselaw use **`mode=fts`** for UI; **`mode=hybrid`** for research (embed-dependent).

### eCourts / live detail

**Corpus path LIVE.** Tier-3 NIC + Tier-4b portal **wired, OFF** (no NIC key; captcha **stub**). Miss → **`not_found`** unless ops **GO** enables flags + credentials.

---

## Part B — Still PENDING

| Group | Examples | Owner | Unlock |
|-------|----------|-------|--------|
| **Corpus gaps** | Some DC CNRs miss; SC diary **`cnr` null**; diary/PII ETL 0%; embed <100%; full HC/DC body FTS | NYS / Ops | Ingest + embed soak **GO** |
| **Live eCourts** | NIC API, portal captcha/session, `claimEcourts: true` | NYV + Ops | NIC key **GO** + flags; legal review for portal |
| **NSP-only** | BFF parse SSE mirror; no direct NYS; Filing UI vs `draftProfile`; court-fee UI | NSP | Ship parser + render NYV outbound |
| **NSP Pro UI** | ~~View Client blue screen (FB-484 `RestoreClientDialog` import)~~ | NSP | **DONE** Pro **`fb485-5899d23c-09221718`** — **`pro.nyayasiddhi.online`** (not NYV Console) |
| **SME / product** | State court-fee tables; certified forms; live e-filing | NYV + SME | P2 fee pack; explicit e-filing **GO** |
| **Ops** | `*.nyayasiddhi.com` prod; key rotation; capacity/SOC2 | Ops | Infra **GO** |

---

## Part C — Flows & tasks

### 1) CNR / diary resolve + cascade

**Partner steps:** Enter identifier → `resolve` with `profile: caseCreate` → map `caseCreate` / `fields` → show corpus disclaimer → if `not_found`, manual matter.

**System:** NSP → NYV → Tier-1 case-api → (miss) Tier-2 legacy → (optional GO) Tier-3/4 eCourts.

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| Resolve + cascade | NYV + NYS | **LIVE** | `POST …/sdk/cnr/resolve` |
| Tier 3/4 | NYV | **PENDING** | Env flags + keys |

### 2) CNR search + autofill

**Partner steps:** Search filters → pick row → resolve with `caseCreate`.

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| Search | NYV | **LIVE** | `GET …/sdk/cnr/search` |
| SC diary | NYV | **LIVE** | diary `identifier`; HC/DC diary **400** |

### 3) Documents / PDFs

**Partner steps:** Use `documents[]` or `document-bundle`; refresh presigned URLs before expiry (~15 min).

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| Bundle P3 | NYV | **LIVE** | `GET …/cnr/{cnr}/document-bundle` |

### 4) Draft + SSE (FB-468)

**Partner steps:** Stream `doc-draft-fast` / `legal-draft-fast` → on **`run_completed`**, read `validationResults` / `draftProfile` from **`result`** or **event root**.

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| Checklist SSE | NYV | **LIVE** | `POST …/orchestrate/stream` |
| NSP Readiness UI | NSP | **PENDING** | Consume NYV fields |

### 5) Instant Search

**Partner steps:** Debounce ≥2 chars → statutes vs caselaw routes → server-side key only.

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| Statutes / caselaw | NYV → NYS | **LIVE** | `nyv.instantSearch.*` |

### 6) Corpus miss + live-fetch

**Partner steps:** Honest `not_found` → manual / retry → (after GO) `POST …/live-fetch` + poll.

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| Live-fetch API | NYV | **PENDING** | `POST/GET …/sdk/cnr/live-fetch*` |

### 7) eCourts (after GO)

**Partner steps:** Enable product toggle → async job → label live fields; fallback on captcha fail.

| Task | Owner | Status | Entry |
|------|--------|--------|--------|
| NIC Tier-3 | NYV | **PENDING** | `NYV_F_ECOURTS_LIVE_FETCH=1` + key |
| Portal Tier-4b | NYV | **PENDING** | `NYV_F_ECOURTS_PORTAL_FETCH=1` + session/solver |

---

## Verify (engineering)

`npm run partner:smoke:ec2` · `npm run demo:probe:ec2` · `NSP_PROBE_REQUIRE_NYV_VALIDATION=1 npm run probe:nyv` (NYV repo, approved env).
