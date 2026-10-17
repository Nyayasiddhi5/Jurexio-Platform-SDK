# NSP beta launch readiness matrix (2026-09-22)

> **Tracker:** `NV-BOOK-SME-WAVE-D-001` · **Audience:** NSP PM, NYV/NYS ops, SME  
> **Related:** [`NSP-CASE-SEARCH-INTEGRATION-2026-09.md`](./NSP-CASE-SEARCH-INTEGRATION-2026-09.md) (primary NSP case search handoff) · [`NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md`](./NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md) · [`NSP-PARTNER-LIVE-PENDING-FLOWS-2026-09.md`](./NSP-PARTNER-LIVE-PENDING-FLOWS-2026-09.md)

---

## Executive answer — can NSP launch beta?

**Yes, with documented honesty gates** — partner CNR/diary resolve, search, documents, and FB-468 drafting (`draftProfile` + `validationResults[]` on stream `run_completed`) are **LIVE** on nysdev. Beta is **not** blocked on NYV code for the core matter + draft loop.

**Hard dependencies before marketing “national coverage” or “live docket”:**

| Blocker | Owner | Beta workaround |
|---|---|---|
| RDS watermark lag (~21M rows vs DuckDB) | NYS ops (**`data_rds/rds_daily`** — **IN-PROGRESS** NV-NYS-OPS-GO-004) | `meta.provenance.tableVersion` + `betaReadiness`; search on indexed CNRs |
| SC diary RDS index **0%** | NYS ETL | Diary resolve via DuckDB hydrate **LIVE**; RDS search gap documented |
| Party PII **0%** | NYS + product | `corpus_unavailable` / manual intake |
| Live next hearing / eCourts | NYV Tier-3 **GO** | `claimEcourts: false` everywhere |
| Per-state court-fee tables | NYV + SME | Generic slab + `courtFee.unavailableReason` |
| Criminal/bail/writ/SLP **model forms** in practitioner book | SME | NYV coarse `bail_application` / `writ_petition` drafting **LIVE**; no FB-468 `nvTemplateKey` (book has no model forms) |

---

## nysapi vs nysearch — what NSP should expect (2026-09-23)

| Surface | Role | Not a substitute for |
|---|---|---|
| **nysapi** (`nysapi.nyayasiddhi.online`) | Daily-refreshed **corpus** index: CNR/diary/filing/party/FIR search + resolve + PDFs when S3-linked | Live eCourts docket, guaranteed PII, witnesses, “today’s hearing” |
| **NYV** (`api.nyayasiddhi.online` SDK) | Maps nysapi → partner shapes; cascade to legacy when staging misses; **`claimEcourts: false`** + field manifests | Calling nysapi directly from NSP |
| **nysearch** (legacy `:8080` / caselaw FTS) | Judgment **research** + cascade **enrichment** (acts, extra PDFs) | National matter search UI — use **`GET /sdk/cnr/search`** |

**Prod gap until deploy GO:** CNR-filtered search may return wrong row — **NV-NYSAPI-SEARCH-PASSTHROUGH-001** (SDK **5.1.8**) fixed in tree. Evidence: [NYSAPI strength vs NSP needs](63b17b6c-e0af-4c5f-a21d-5104baa9913a).

---

## Beta launch checklist (NYV vs NYS vs NSP)

| Capability | NYV | NYS | NSP | Status |
|---|---|---|---|---|
| CNR resolve + unified cascade | Adapter + honesty envelope | case-api + legacy corpus | BFF + matter UX | **LIVE** |
| SC diary resolve | `lookupType: diary` | DuckDB diary search | Diary entry field | **LIVE** (CNR often empty pre-judgment) |
| HC/DC search + filing-ref resolve | Passthrough + B9 hint | RDS GIN + DuckDB enrich | Search UI | **LIVE** (coverage = staging watermark) |
| `profile: caseCreate` autofill | `fieldManifest` + betaReadiness | Row hydrate | Matter create | **LIVE** |
| Judgment PDFs / presigned docs | 900s TTL adapter | S3 Siddhanta + Open Data | Document panel | **LIVE** |
| Acts on resolve | `acts_json` map | ~76% 2025+ slice | Charge/limitation UX | **LIVE** (partial corpus) |
| Draft stream + structure markers | orchestrate | — | Word / web editor | **LIVE** |
| `draftProfile.filingChecklist[]` | **43** `nvTemplateKey`s (Wave D) | — | Tick-list UI | **LIVE** (advisory) |
| `draftProfile.limitation` | Schedule + procedural days | — | Display / warn | **LIVE** |
| `draftProfile.courtFee` | Generic slab + `unavailableReason` | — | Fee panel | **LIVE** (not state-certified) |
| O.43 appealability hint | `nv-cpc-appealable-orders-pack` + validation row | — | CMA UX | **LIVE** (index only) |
| CPC §2–4 order tables (full) | — | RAG ingest P2 | Reference UI | **SME / P2** |
| Certified e-filing forms | — | — | — | **BLOCKED** (NV-NO-STUB) |
| Instant Search / hybrid caselaw | Gateway | Embed worker ~77% | Research tab | **LIVE** (quality ∝ embed) |
| Live eCourts / NIC | Tier-3 wired OFF | — | “Refresh docket” | **PENDING GO** |
| Partner SSE mirror of `draftProfile` | Emits on `run_completed` | — | Parser | **NSP PENDING** |

---

## NSP Pro (partner UI, not NYV Console)

**View Client** is on **`https://pro.nyayasiddhi.online`** (`ClientDetail`). FB-484 (missing `RestoreClientDialog` import → error boundary) is **fixed and redeployed** (**`fb485-5899d23c-09221718`**, NSP commits **`99d82b6c`** / **`7a2227c0`**). NYV **`console.nyayasiddhi.online`** has no View Client flow — no gateway change required.

---

## CNR / diary critical path (must-have for beta)

1. **Identifier routing:** SC → diary; HC/DC → CNR (diary query **400** on non-SC).
2. **Resolve with `profile: caseCreate`** for matter autofill; read `fieldManifest.manualRequired` for PII/witnesses/next date.
3. **Always show** `claimEcourts: false` and `meta.betaReadiness` / `corpus_unavailable` where applicable.
4. **Documents:** refresh presigned URLs before **900s** TTL; use `document-bundle` when resolve omits orders.
5. **Search fallback:** filing number + year (DC); party/FIR filters; accept `not_found` → manual matter.
6. **Draft path:** pass `parameters.filingContext.nvTemplateKey` when known; otherwise rely on NYV prompt inference + `intentResolution`.

---

## Book / SME — shipped vs blocked (Wave D, 2026-09-22)

| Item | Status | Evidence |
|---|---|---|
| Wave D +3 keys (`civil_miscellaneous_appeal`, `appeal_stay_petition`, `plaint_presentation_pack`) | **LIVE nysdev** | `FB-468.2026-09-22.waveD`; deploy **`2026-09-22T1034Z-aws-ssm-5417fb15`** sha **`5417fb15`**; extract **20/20** |
| First-appeal / plaint presentation enclosures | **SHIPPED** (advisory) | `nv-filing-checklist-registry.ts` |
| O.43 R.1 appealable-order index | **SHIPPED** (advisory) | `nv-cpc-appealable-orders-pack.ts` |
| Limitation book §5–6 procedural rows | **SHIPPED** (partial) | `nv-nyayatimeline-service.ts` PROCEDURAL_LIMITATION_DAYS |
| `courtFee.unavailableReason` | **SHIPPED** | `nv-draft-profile-assembler.ts` |
| Bail / criminal model forms | **SME-BLOCKED** | Book: limitation table only; no MODEL FORM |
| Writ / SLP model forms | **SME-BLOCKED** | Book: diagram + limitation; coarse NYV drafting only |
| Full CPC order-action tables §2–4 | **SME-BLOCKED** | OCR index only — P2 RAG pack |
| TN/Madras per-state court-fee tables §7 | **SME-BLOCKED** | Generic 1870 slab only |

---

## Verify before beta sign-off

```bash
cd nyayavigya-platform-312 && npm run guardrail
cd nyayavigya-platform-312 && npm run demo:probe:ec2
cd nyayavigya-platform-312 && FILING_BOOK_TEXT="$HOME/Downloads/BOOK OF FILING DRAFTING AND LEGAL NOTICES - extracted text.txt" tsx scripts/nv-filing-book-extract.ts
cd nyayavigya-platform-312 && npm run probe:fb468:draft-profile
```
