# NYV Docparse — Zip vs In-Repo Gap Analysis

> **Date:** 2026-08-27  
> **Evidence:** [Legal docparse gap analysis](d20df1b1-43f7-44a8-b5e3-74034079da0a)  
> **Attachments compared:** `NYV-DOCPARSE-2026-08-26.zip` (v0.1.0) · **`NYV-DOCPARSE-v0.2.0.zip` (adopt this)**  
> **Status:** **LIVE on nysdev** (2026-08-27) — deploy `2026-08-27T1229Z-aws-ssm`; P1/P2 code complete; smoke health **200** + `demo:probe:ec2` Success

---

## Executive summary

| Question | Answer |
|---|---|
| **Best parsing logic?** | **`NYV-DOCPARSE-v0.2.0.zip`** (`@nyv/docparse`) — 373 tests, 58 doc-type profiles, 41 Indian ID/grammar patterns, Indic OCR arbitration, table extraction, 4-state autofill |
| **What does NYV run today?** | `@nyv/docparse` via `nv-docparse-adapter-service.ts` on all partner binary ingest paths; tier-2 `nv-got-ocr-adapter` + heuristics + LLM |
| **Is zip in repo?** | **Yes** — `packages/docparse/` v0.2.1 |
| **Live on nysdev?** | **Yes** — deploy `2026-08-27T1229Z-aws-ssm` (SSM `2de6d42d`); smoke `demo:probe:ec2` Success |

---

## Integration flow (shipped 2026-08-27)

```
Upload (any partner path + base64/bytes)
  → resolveIngestBytes → extractCourtDocumentFields(options.bytes)
  → @nyv/docparse run() [NYV_F_DOCPARSE=1, IN + PDF/image]
  → on fail/degraded → nv-got-ocr-adapter → heuristics/NER
  → merge + buildCourtDocFieldBlock (fieldSource / extractionPath / docparseMeta / tables[])
  → optional LLM (Patra Mitra, analyze)
```

---

## P0 — integration status

| # | Task | Status |
|---|---|---|
| 1 | Vend v0.2.0 → `packages/docparse/` v0.2.1 | ✅ Done |
| 2 | Wire `run()` via `nv-docparse-adapter-service.ts` + production-doc-processor | ✅ Done |
| 3 | Map autofill → `buildCourtDocFieldBlock()` + provenance | ✅ Done |
| 4 | Replace coarse classifiers on all partner paths | ✅ Done (2026-08-27) |
| 5 | CNR + Indian ID grammar as SSoT | ✅ Via docparse; heuristics remain fallback |

## P1

| # | Task | Status |
|---|---|---|
| 6 | Route scanned IN PDFs through docparse Indic OCR stack | ✅ Done — adapter + OCR fallback chain |
| 7 | Expose `TableRecord` in API (`tables[]`) | ✅ Done — `buildCourtDocFieldBlock` |
| 8 | Per-page progress for long OCR jobs | ✅ Done — `onPage` in docparse run + job `progressStages` metadata |
| 9 | Multi-document bundle resolution | ✅ Done — `documents[]` batch cap 5 |
| 10 | Expand court-fields tests | ✅ Done — adapter + ingest + FIR/vakalatnama paths |

## P2

| # | Task | Status |
|---|---|---|
| 11 | DOCX path | ✅ Done — pre-convert via `nv-doc-content-extractor`; heuristics + `inputFormat: docx` meta |
| 12 | Real tenant corpus benchmark (200–500 docs) | ⏸ Deferred — needs corpus |
| 13 | IPC→BNS concordance SME sign-off | ⏸ Deferred — `concordanceStatus: DRAFT` in API only |
| 14 | OCR table detection on scans | ✅ Done — zip `layout/tables.ts` via docparse analysis path |
| 15 | Handwriting triage UI | ⏸ Deferred — `handwritingTriageSuggested` metadata flag only |

---

## Wiring audit (NV-WIRING-001)

| Component | Live on partner ingest? |
|---|---|
| `@nyv/docparse` | **Yes** — all paths below when bytes + `NYV_F_DOCPARSE=1` |
| `nv-sdk-gateway-routes` `/documents/analyze` | **Yes** |
| `nv-sdk-doc-pipeline-routes` intelligence/analyze/pipeline | **Yes** |
| `nv-orchestration-routes` `/orchestrate` | **Yes** (when `documentBase64` / `base64` supplied) |
| `nv-patra-mitra-service` | **Yes** |
| `production-doc-processor` | **Yes** |
| `sdk-document-pipeline-service.runFullPipeline` | **Yes** |

---

## Fallback verification

| Flag / path | Expected |
|---|---|
| `NYV_F_DOCPARSE=1` + PDF bytes | `fieldSource` ∈ `docparse`, `mixed`, `ocr_fallback` |
| `NYV_F_DOCPARSE=0` | `fieldSource` = `nyv` or `heuristic` (no docparse run) |
| Scanned PDF bytes-only (OCR_NEEDS_PATH) | `extractionPath=ocr_fallback`, `docparseMeta.ocrProvider` set when cloud OCR succeeds |

---

## Related registry / code

- `FEATURES-REGISTRY.md` — `@nyv/docparse` entry (**WIRED**)
- `nv-docparse-ingest-helper.ts`, `nv-docparse-adapter-service.ts`
- Gap doc: this file

---

## Live binary docparse smoke (partner integration)

Send **`base64`** or **`documentBase64`** (or **`documents[]`**, max 5) on:

- `POST /api/nv/v1/sdk/documents/analyze` (gateway)
- Doc-pipeline intelligence / analyze / pipeline routes
- `POST /api/nv/orchestrate` when attaching a filing

Text-only requests stay on the heuristic path (by design). Expect `fieldSource`, `extractionPath`, `docparseMeta`, and optional `tables[]` in the response.
