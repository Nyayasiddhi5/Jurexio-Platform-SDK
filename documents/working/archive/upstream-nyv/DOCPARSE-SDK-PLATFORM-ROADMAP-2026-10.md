# DocParse Platform SDK — roadmap (parallel line)

**Production SSoT (engine):** `@nyv/docparse-sdk@1.0.0-alpha.2` on NYV legal ingest when `NYV_F_DOCPARSE_SDK` on (default **ON** in non-dev); legacy `@nyv/docparse@0.2.1` remains fail-soft fallback if SDK load throws.

**NSP contract:** `docparseMeta.legalParseGuide`, `docparseMeta.docparseResultV1`, `docparseMeta.docparseIntelligence` — bind via `@nyayavigya/client-sdk` `NyvLegalDocparse` types + `nspAutofillAction()`.

## Phase status (2026-10-06 legal-first pass)

| Phase | Scope | Status |
|---|---|---|
| **0** | Fork, contracts, PII catalog, domain packs, docs | **DONE** (alpha.2) |
| **1** | Legal+gov types, Paddle plugin, corpus benchmark + legal gate | **DONE** — `npm run docparse-sdk:gate:legal`; OCR/RULED metrics in benchmark report |
| **2** | Job queue | **DONE (NYV)** — BullMQ `nyv-docparse-sdk` + Redis job records when `NYV_F_DOCPARSE_JOBS` + Redis live; in-memory fallback |
| **3** | Intelligence in Result v1 | **DONE** — `docparse.intelligence/v1` (quality band, PII summary, embedded LegalParseGuide) |
| **4** | JSON DomainPack loader | **DONE (legal + POC)** — `legal-in`, gov pack, `insurance-fnol.json`; other domains post-legal GO |
| **Integration** | NYV/NSP | **DONE (legal-first)** — SDK default non-dev; client-sdk **5.2.2** (`DocparseApi`, analyze alias); [`NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md`](./NSP-DOCPARSE-INTEGRATION-ONE-PAGER.md) |
| **OCR policy** | `forceOcr` / `preferOcr` | **DONE** — RunOptions + partner HTTP |
| **Async large docs** | Jobs bridge | **DONE** — `NYV_DOCPARSE_ASYNC_MIN_BYTES` + `NYV_F_DOCPARSE_JOBS` |
| **Domain catalog** | `listDomainPacks()` + GET `/packs` | **DONE** — legal-in, legal-in-gov, insurance-fnol |
| **Cutover** | Remove legacy-only path | **PARTIAL** — SDK primary + legacy fallback; drop `@nyv/docparse` duplicate after parity gate green on CI |

## Commands

```bash
npm run docparse-sdk:test
npm run docparse-sdk:build
npm run docparse-sdk:gate:legal
npm run nsp:probe:dlct-court-fetch:ec2   # post-deploy spot
```

## Post-legal (global best — Legal + PII first, then domains)

**North star:** one Platform SDK — deterministic ingest, PII catalog + redaction before resolution, multi-engine OCR (Tesseract + Paddle), `docparse.intelligence/v1`, domain packs as JSON/npm, async jobs for corpus-scale PDFs.

| Track | Scope | Status |
|---|---|---|
| **Legal + PII** | IN courts/police/deeds, autofill four-state, PII withhold/mask | **LIVE** on nysdev |
| **Advanced OCR** | Text-layer distrust, `forceOcr`/`preferOcr`, handwriting triage | **LIVE** |
| **Intelligence** | Quality band, completeness, embedded LegalParseGuide | **LIVE** |
| **Domains** | `insurance-fnol` POC; HR/finance/health packs | **After 7d legal gate** |
| **Distribution** | npm `@nyv/docparse-sdk`, `@nyv/docparse-pack-*` | **Pending publish GO** |
| **JRX** | HTTP-only via NYV gateway | Planned (no fork in Jurexio repo) |
| **NSP corpus** | Bulk backfill + UI bind | NSP-side; NYV APIs ready for per-doc + jobs |

1. Publish `@nyv/docparse-sdk` npm + optional `@nyv/docparse-pack-*`
2. Expand non-legal domain packs only after legal gate holds on nysdev for 7d
3. JRX HTTP-only consumption (no fork in Jurexio repo)
