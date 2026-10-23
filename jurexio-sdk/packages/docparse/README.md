# @jurexio/docparse

Indian legal document parsing, field extraction, autofill and analysis.
Deterministic, provenance-bearing, local. **No LLM in the default path.**

```
373 tests passing · 58 document types, all fixture-verified · 41 grammar patterns
58 anchors · 11 scripts · table detection on 4 grid families
text layer 92 ms/page · OCR 5.3 s/page
```

## Install

```bash
npm install
npm test              # 373 tests
npm run typecheck
```

**System requirements** (not npm packages):

```bash
# Tesseract 5 with Indic language data
apt-get install -y tesseract-ocr tesseract-ocr-hin tesseract-ocr-ben \
  tesseract-ocr-tam tesseract-ocr-tel tesseract-ocr-kan tesseract-ocr-mal \
  tesseract-ocr-guj tesseract-ocr-pan tesseract-ocr-ori tesseract-ocr-asm \
  tesseract-ocr-mar tesseract-ocr-nep tesseract-ocr-san tesseract-ocr-urd \
  tesseract-ocr-script-deva tesseract-ocr-script-beng \
  tesseract-ocr-script-taml tesseract-ocr-script-telu

# Poppler, for rasterisation
apt-get install -y poppler-utils
```

The script-level models (`script-deva` and friends) are **not optional**. Measured:
the Devanagari *language* models drop the leading digit of dates, and the script
model is what catches it. See `src/ocr/arbitrate.ts`.

## Use

```ts
import { run } from "@jurexio/docparse";

const result = await run(
  [{ path: "/data/fir.pdf", fileName: "fir.pdf" }],
  { batchId: "batch-1", actor: "advocate:1234", referenceYear: 2026 },
);

result.autofill.fields          // pre-fill the form with these
result.autofill.lowConfidence   // OFFER these — do not pre-fill
result.autofill.conflicts       // make the user choose; no default
result.autofill.absent          // show "not found in your documents"

result.resolutions              // per field: status + chosen + competing + rationale
result.analysis[0].timeline     // chronology, extractive
result.governance.auditEvents   // hash-chained, verifiable
```

## The four states

This is the core of the API and the thing most likely to be flattened by mistake.

| State | Meaning | UI |
|---|---|---|
| `RESOLVED` | Confident, above threshold | pre-fill the input |
| `LOW_CONFIDENCE` | Found, uncertain | input **empty**, candidate offered beside it |
| `CONFLICT` | Documents disagree | chooser, **no default** |
| `ABSENT` | Genuinely not in the documents | empty, labelled "not found" |

Collapsing these into "filled or blank" destroys the user's ability to tell an
extraction from a guess. A pre-filled field is a field nobody reads.

## What it does well

- **Text-layer fast path** at 92 ms/page — e-filed documents are effectively instant
- **Indian identifier grammar**: CNR, case numbers with dotted type tokens, FIR
  numbers in six spellings, neutral citations including hyphenated benches
  (`2024:BHC-AS:5678:DB`), 30+ reporters, sections with subsections, Aadhaar, PAN,
  GSTIN, CIN, DIN, IFSC, MICR, survey numbers, and 25 more
- **Indian numerals**: lakh/crore grouping (`1,50,000` → 150000, not 150), amount
  words cross-checked against figures, and a loud `DISAGREE` when they differ
- **Indic scripts**: 11 scripts, digits folded from all ten numeral systems, month
  names in five languages plus the Saka calendar
- **Multi-pass numeric arbitration** that recovers dates the Indic language models
  silently truncate
- **Structural OCR repair** of fixed-width identifiers with Verhoeff and GSTIN
  checksums
- **Cross-document resolution** with authority weights, corroboration and explicit
  conflicts
- **Table extraction** by whitespace projection, working on both the text-layer and
  OCR routes: bank statements (debit/credit/balance separated, wrapped rows merged),
  invoice line items, charge-sheet witness and document lists, cause lists. Grids
  are labelled `LEDGER` / `LINE_ITEMS` / `ID_LIST` / `LISTING`, normalised through
  the same date and money parsers as everything else, and carry a bbox per cell
- **Every one of the 58 document types has a fixture of its own type.** That is how
  five classifier collisions were found — including a lease cue that matched inside
  the word "pleased", which appears in the standard prayer formula of every petition
- **Governance**: masking before persistence, restricted-matter gating, hash-chained
  audit

## What it does not do

Read `ARCHITECTURE.md` §9 in full before presenting this to anyone. The short list:

- **Table detection is unverified on scanned pages.** Every table fixture is a
  text-layer page; OCR word boxes are noisier and have never been measured. A table
  found on a scan is unproven.
- **A monospaced cause list's case-number column over-splits.** The two spaces
  inside "W.P.  No.  18842/2024" are geometrically identical to the two that
  separate columns, so no width rule can tell them apart. Serial, CNR and party
  columns are correct.
- **Table cells do not feed autofill, by design.** A statement's ten transaction
  dates are not the date of the document, and re-reading the same words the prose
  sweep already read would register as corroboration and inflate confidence on
  evidence that is not independent. Grids are published as structure instead.
- **Indic prose OCR is unreliable.** Numerics survive; names do not. Indic-language
  matters need human verification of every name field.
- **Indic handwriting is not machine-readable today** by any engine, cloud or local.
  Handwritten pages are flagged for review and produce no fields.
- **The IPC→BNS concordance is DRAFT** and mostly unverified. Only VERIFIED entries
  apply. It must not drive anything a court sees until an advocate signs it off.
- **No DOCX path yet.**
- **All timings are from one 2-core container and 14 synthetic fixtures** — real
  measurements of real code, but not a benchmark on your corpus.

## Layout

```
src/
  types.ts              core types; provenance is structural
  grammar/              script, patterns, dates, money, sections, repair
  ocr/                  engines, arbitration, routing
  pipeline/             text layer, raster/deskew, orchestrator
  layout/               grouping, page zones, table detection + semantics
  doctype/              58 profiles, classifier, bundle segmentation
  anchors/              label→value extraction, authority weights
  resolve/              sweep, parties, conflicts
  analyze/              extractive analysis
  autofill/             payload assembly, NSP case draft
  governance/           redaction, restriction, audit chain
test/
  patterns.test.ts      103 tests — grammar pack + ReDoS probe
  repair.test.ts        21 tests  — repair positives, refusals, checksums
  e2e.test.ts           89 tests  — whole pipeline over 14 fixtures
  classify.test.ts      102 tests — all 58 types against their own fixture
  tables.test.ts        58 tests  — grids, false positives, semantics, ledgers
  fixtures/             two generators + 67 rendered documents
```

## Licensing

- This package: **UNLICENSED**, internal.
- `pdfjs-dist` Apache-2.0 · `sharp` Apache-2.0 (libvips LGPL-3.0, dynamically
  linked) · `node-poppler` MIT · `tesseract.js` Apache-2.0 · `zod` MIT
- **Poppler binaries are GPL-2.0/GPL-3.0.** Invoked as a separate process, never
  linked. Record in the SBOM; do not statically link into a distributed artefact.
- **Never add `mupdf`, `mupdf-js` or `scribe.js-ocr`** — all AGPL-3.0-or-later, a
  hard licensing blocker.

## Regenerating fixtures

```bash
python3 test/fixtures/build_fixtures.py    # 7 types, text-layer + degraded scan
python3 test/fixtures/build_all_types.py   # one form for every remaining type
```

Needs `reportlab`, `Pillow`, `fonts-indic`, `poppler-utils`. Deterministic
(seeded). `build_fixtures.py` produces each document as a text-layer PDF and a
**deliberately degraded** scan — rotated 0.7°, noised, blurred, JPEG quality 55. A
clean rasterisation is not a test. `build_all_types.py` produces the remaining
document types as faithful statutory forms, so that no classifier profile and no
anchor set is unexercised; the tabular ones are set in a monospaced face because
hand-counted spaces in a proportional face are not column-aligned, which is a
mistake the first version of those fixtures made.
