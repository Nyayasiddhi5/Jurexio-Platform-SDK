# JRX-DOCPARSE — Indian Legal Document Parsing Engine

**Package:** `@jurexio/docparse` · Node 20+ · TypeScript 5.9 ESM
**Status:** Working, tested, measured. 373/373 tests green.
**Classification:** Internal — CTO / Chairman review

---

## 1. What this is

A local, deterministic document-understanding engine for Indian legal documents. It
takes PDFs and images and returns structured case fields with provenance, plus a
document analysis, plus an audit trail.

It is **code, not a plan**. Every claim below is backed by a test in `test/` or a
measurement recorded in §7. Where something is unverified, §9 says so.

**Design commitments, in priority order:**

1. **No LLM in the default path.** Extraction is regex grammar + label anchors +
   structural rules. The LLM fallback is org-flagged, default-off, capped at 0.65
   confidence, and cannot self-enable.
2. **Nothing without provenance.** Every value carries document, page, bbox, line
   indices, extractor id, extractor kind and whether AI touched it.
3. **Never guess silently.** A field is FILLED, LOW-CONFIDENCE, CONFLICT or ABSENT.
   These four states are distinct in the payload and must stay distinct in the UI.
4. **Local only.** No court document leaves the tenant boundary. No third-party
   OCR API, no CAPTCHA automation, no eCourts scraping.
5. **Mask before persist.** Aadhaar and account numbers are masked at the
   candidate boundary *and* in the derived text plane, before resolution.

---

## 2. Pipeline

```
ingest (sha256, mime)
  │
  ├─ PDF ─→ text layer? ──trust?──→ YES ─→ fast path        (92 ms/page measured)
  │                         │
  │                         └─ NO ──→ rasterise → deskew → OSD script detect
  │                                      → OCR (concurrent pool)
  │                                      → numeric arbitration   (5.3 s/page measured)
  └─ image ─→ deskew → OSD → OCR
  │
layout       words → lines → blocks → zones (header/body/footer/margin)
  │
classify     58 doc-type profiles, weighted cues + anti-cues; bundle segmentation
  │
extract      anchors (label→value) + grammar sweep (line AND block level)
             + party structures + identifier repair
  │
REDACT       ◄── before resolution, so no unmasked PII enters a resolution object
  │
resolve      equivalence classes → authority → corroboration → conflicts
             cardinality-aware (SINGLE vs MULTI)
  │
autofill     four states, never collapsed; tier T0–T3
  │
analyse      extractive summary, timeline, obligations, reliefs, holding, citations
  │
governance   restriction gate + hash-chained audit chain
```

---

## 3. Module map

| Path | Responsibility |
|---|---|
| `src/types.ts` | Core types. Provenance is structural, not optional. |
| `src/grammar/script.ts` | Per-line script detection, Indic digit folding, text hygiene |
| `src/grammar/patterns.ts` | 41-pattern Indian legal identifier grammar pack |
| `src/grammar/dates.ts` | DD/MM ambiguity, 2-digit years, Saka calendar, impossible dates |
| `src/grammar/money.ts` | Indian lakh/crore grouping, words↔figures cross-check |
| `src/grammar/sections.ts` | Section runs, statute canonicalisation, IPC→BNS concordance |
| `src/grammar/repair.ts` | Structural OCR repair of fixed-width identifiers + checksums |
| `src/ocr/engines/tesseract-native.ts` | Tesseract 5 adapter, TSV, OSD script detection |
| `src/ocr/arbitrate.ts` | Multi-pass numeric arbitration |
| `src/ocr/router.ts` | Per-script engine/model routing |
| `src/pipeline/textlayer.ts` | pdf.js extraction + text-layer trust assessment |
| `src/pipeline/raster.ts` | pdftoppm, projection-profile skew estimation |
| `src/pipeline/run.ts` | Orchestrator, concurrency pool |
| `src/layout/lines.ts` | Word→line→block grouping, page zones, advance-width apportionment |
| `src/layout/tables.ts` | Whitespace-projection grid detection, cell typing, continuation merging |
| `src/layout/table-records.ts` | Grid semantics, column typing, date/money normalisation, ledger rows |
| `src/doctype/registry.ts` | 58 document-type profiles |
| `src/doctype/classify.ts` | Weighted-cue classifier + bundle segmentation |
| `src/anchors/engine.ts` | INLINE / COLUMN / COLON_WRAP label→value extraction |
| `src/anchors/profiles.ts` | Per-doc-type anchor sets + authority weight table |
| `src/resolve/sweep.ts` | Grammar sweep, zone weighting, script penalty |
| `src/resolve/parties.ts` | Cause title, numbered array, deed parties, advocates |
| `src/resolve/conflicts.ts` | Cardinality, equivalence, calibrated confidence |
| `src/analyze/analyze.ts` | Extractive analysis (no generated prose) |
| `src/autofill/autofill.ts` | Payload assembly, tier, NSP case draft mapping |
| `src/governance/governance.ts` | Redaction, restriction gate, hash-chained audit |

---

## 4. Coverage

**58 document types** across 16 families: FIR, charge sheet, case diary, seizure
memo, arrest memo, plaint, written statement, writ petition, PIL, criminal appeal,
civil appeal, SLP, bail application, quashing petition, revision, s.138 complaint,
MACT claim, consumer complaint, divorce petition, maintenance petition, DV
application, execution petition, interim application, caveat, judgement, order,
decree, arbitral award, summons, warrant, legal notice, proclamation, affidavit,
vakalatnama, power of attorney, board resolution, agreement, sale deed, agreement
to sell, lease deed, partnership deed, MoA/AoA, cheque, return memo, bank
statement, SARFAESI notice, invoice, Aadhaar, PAN, passport, Act, ordinance,
notification, bail bond, cause list, filing receipt, MLC, post-mortem.

**Identifiers:** CNR · case numbers (dotted/bracketed type tokens) · diary numbers
· FIR/crime numbers · charge sheet numbers · GD entries · SC neutral citations
(INSC) · HC neutral citations including hyphenated benches · SCC/AIR/Cri LJ and 30
other reporters · statutory sections with subsections · constitutional articles ·
CPC Order/Rule · Act numbers · gazette notifications · Aadhaar · PAN · GSTIN · CIN
· LLPIN · DIN · TAN · EPIC · passport · driving licence · bar enrolment · IFSC ·
MICR · cheque numbers · bank accounts · loan accounts · survey/khasra/khata/CTS ·
registered document numbers · vehicle registrations · phones · emails · PIN codes.

**Tables:** whitespace-projection detection on both the text-layer and OCR routes,
with grids labelled `LEDGER` · `LINE_ITEMS` · `ID_LIST` · `LISTING` · `UNKNOWN`.
Verified on bank statements, invoices, charge-sheet witness and document lists, and
cause lists; zero false positives across all 60 fixtures. Published as structure
with per-cell provenance, deliberately **not** as autofill candidates (§5.12).

**Scripts:** Latin, Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam,
Gujarati, Gurmukhi, Odia, Arabic (Urdu). Indic digits folded to ASCII in all ten
numeral systems. Month names in English, Devanagari (Gregorian *and* Saka), Tamil,
Telugu, Bengali.

---

## 5. The engineering that matters

These are the decisions that came from measurement, not from a whiteboard. Each is
recorded in the code at the point it applies.

### 5.1 Multi-pass numeric arbitration — recovers silently-corrupted dates

The Devanagari **language** models drop the leading digit of a date. Measured on a
degraded Hindi district-court order, ground truth `15/08/2024` and `10/03/2024`:

| Model | Case no. | Date 1 | Date 2 |
|---|---|---|---|
| `-l hin` | 456/2024 | **5/08/2024** | **0/03/2024** |
| `-l hin+mar+san+nep+eng` | 456/2024 | **5/08/2024** | **0/03/2024** |
| `-l eng` | **456 202** | 15/08/2024 | 10/03/2024 |
| `-l Devanagari` (script model) | 456/2024 | 15/08/2024 | 10/03/2024 |

`5/08/2024` is a perfectly well-formed date ten days early. Nothing downstream can
tell it is wrong, and Tesseract reports high confidence on it. This is the worst
defect class the system can produce: a plausible wrong value with no signal.

The countermeasure is redundancy. Indic pages get the language-union pass plus the
script model plus a Latin pass, and numeric tokens are reconciled positionally.
Agreement lifts confidence above any single pass; disagreement picks the longer
digit run (truncation is common, fabricating a digit is not), **caps confidence at
0.50** so the field is shown rather than pre-filled, and raises a warning.

Result on that page: 11/11 numerics correct, both truncated dates recovered, both
flagged for confirmation.

### 5.2 Script detection from pixels, not from a first pass

The intuitive design — recognise in Latin, look at the text, re-route if it turns
out to be Indic — cannot work. A Latin model reading a Devanagari page returns
garbled *Latin*, so the detector agrees with the wrong guess and never re-routes.
Both the Hindi and Tamil fixtures silently stayed on the English model.

Tesseract's OSD mode (`--psm 0`) classifies script from glyph shapes. Measured on
the degraded fixtures: Devanagari, Tamil and Latin all correct.

### 5.3 `OMP_THREAD_LIMIT=1` — a 4.4× latency win at zero accuracy cost

Tesseract 5 parallelises its LSTM with OpenMP. On realistic page sizes and core
counts that parallelisation *costs* time. Measured, 300 DPI A4, 2-core container:

| Page | Default OpenMP | `OMP_THREAD_LIMIT=1` | Speed-up | Recall |
|---|---|---|---|---|
| English FIR | 9,987 ms | **2,251 ms** | 4.4× | 14/14 both |
| Devanagari order | 2,557 ms | **1,034 ms** | 2.5× | 8/8 both |

Throughput then comes from running *pages* concurrently. 4 pages serially 20.9 s;
the same 4 pages concurrently 7.4 s on the same 2 cores.

### 5.4 Structural identifier repair

OCR read `IFSC: SBIN0000691` as `SBINO000691` — letter O for digit 0 — and the
bank identifier vanished from the extraction. Indian statutory identifiers are
fixed-width with a known letter/digit mask, so a mask-directed substitution is not
a guess: it is the only string of that length that satisfies the format.

Guardrails: mask-directed only, at most 2 substitutions, must pass the strict
validator *and* the checksum where one exists (Verhoeff for Aadhaar, base-36 mod
36 for GSTIN), never runs on a text layer, never on Indic-script lines, and every
repair is recorded on the candidate with a confidence penalty.

The GSTIN checksum immediately caught that my own fixture GSTIN was invalid — which
is what it is for.

### 5.5 Line grouping must not use a growing union box

The first grouper grew each candidate line's bbox with `bboxUnion` and tested new
words against it. That is unstable: the union only gets taller, so a word two rows
away still overlaps 40% of the shorter box, joins, and makes the box taller again.
On the OCR'd FIR this collapsed items 1–7 of the numbered form — a dozen visual
rows across two columns — into one "line":

```
"= wnhnrd Noor.. - - _. _ District: Acts FIR Occurrence Type Information
 Place No. & of of Sections: New 0123/2024 …"
```

The FIR number was in there, unparseable by any pattern, and the words themselves
were read at 0.92 confidence so nothing flagged it. Fixed by matching against a
running mean centre with a band fixed to the page's median word height, plus a
horizontal-gap guard that stops a label column merging into a value column.

### 5.6 The sweep runs at line AND block level

Legal text wraps, and a pattern straddling the break is invisible to a line-level
sweep. The s.138 notice reads `"...under Section 138 read" / "with Section 142 of
the Negotiable Instruments Act..."`. The line pass saw `Section 138 read` (no
statute → no match) and `Section 142 of the NI Act` (match). **Section 138 — the
provision the entire complaint rests on — was dropped.**

Patterns that can legitimately wrap get a second pass over block text, with
offsets mapped back to contributing lines so provenance survives. Only
wrap-capable patterns are included; a CNR never wraps.

### 5.7 Field cardinality — SINGLE vs MULTI

The first resolver treated every field as single-valued, so a sale deed naming the
vendor's PAN and the purchaser's PAN was a "PAN conflict"; an FIR listing four
charged sections was a "sections conflict"; four phone numbers were a "phone
conflict". In each case both values were correct and the system asked the advocate
to pick one. That teaches users to distrust the conflict UI — the one thing that
must stay trustworthy. MULTI fields now collect all distinct values, each scored on
its own evidence, with no contradiction penalty between siblings.

### 5.8 Catastrophic backtracking in `SECTION_BLOCK`

The first version made the separator optional inside a `{1,25}` repetition. A
200-digit run can be partitioned among 25 repetitions exponentially many ways;
measured, it produced no result in 90 seconds and hung the test runner. In
production that is a wedged ingest worker holding a page lock, triggered by one bad
OCR read of a table of figures. Fixed by making the separator mandatory between
tokens. A ReDoS probe over the whole registry now runs in the test suite.

### 5.9 Two silent date-corruption bugs

- **Indian lakh grouping.** `Rs. 1,50,000/-` matched by a Western
  `\d{1,3}(,\d{3})*` pattern yields `1,50` — ₹150 instead of ₹1,50,000, wrong on
  every claim above one lakh, and wrong in the direction that changes the court-fee
  bracket and the pecuniary jurisdiction.
- **Year alternation order.** `(?:\d{2}|\d{4})` matches "20" of "2024" and stops
  when not followed by `\b`. A sale-deed possession deadline of `30/09/2024`
  parsed as **2020-09-30**. Six sites shared the latent form; all now order
  longest-first.

### 5.10 Redaction covers the derived text plane, not just candidates

The original design masked candidates and left page text byte-exact, reasoning that
page text is "evidence". Half right, wrong conclusion: the *pixels* are the
evidence and live in the document store under their own controls; the page *text*
is a derived index that gets serialised, cached, logged and searched. Serialising
an `ExtractionResult` and grepping for the Aadhaar found it immediately. Masking is
now length-preserving in digit count so bboxes stay valid and "view in source"
still highlights the right region.

---

### 5.11 Table detection: whitespace projection, and four defects it exposed

`Page.tables` used to be typed and always empty. It is now populated, and the
route to a correct grid ran through four bugs, three of which were upstream of
tables entirely.

**Projection, not ruled lines.** Most Indian legal tables that matter are not
ruled: a cause list is aligned by whitespace, a charge-sheet list has no rules at
all, an e-filed bank statement's PDF often carries aligned text and no vector
rules. A ruled-line detector finds nothing on any of them, and it needs pixels, so
it cannot run on the text-layer fast path — which is exactly the path a
system-generated cause list takes. Projection works from word boxes, which both
routes already produce.

**The four defects.**

1. `linesFromTextLayer` **discarded whitespace** when apportioning word widths,
   packing words edge to edge. Every inter-word gap came out at 0.0, which destroys
   the only signal a whitespace-aligned table has. Nothing was detected anywhere.
2. Width was apportioned by **character count**, treating a space as being as wide
   as a digit. Measured on the bank statement, an ordinary word gap came out at
   6.1pt while the separation between the two date columns came out at 5.0pt — the
   column gap was *narrower* than the word gap, so no threshold could separate
   them. Fixed with a per-character advance-width table.
3. Gutter intervals used **floor/ceil**, widening every word box by up to 1pt a
   side and eating 2pt out of every gutter — enough to erase a two-space
   separation. Now `Math.round`.
4. Selection preferred **more columns**, on the reasoning that a six-column ledger
   read as three is worse. True, but it generalises backwards: the over-split
   reading of any ambiguous grid always has more columns, so the rule reliably
   chose it. Now confidence-primary, Occam as tiebreak.

**What separates a grid from indented prose** is not occupancy — an affidavit's
cause title projects into three columns each filled in 75% of rows — but **column
type homogeneity**. A ledger has two date columns and three money columns; prose
broken by indentation has none. Two typed columns is the gate.

Two further gates came from false positives found by running the prose fixtures:

- **An absolute floor of two populated rows per column.** A fractional occupancy
  floor is trivially met when there are few rows — with three rows one cell scores
  0.33 — which let a writ petition's chronology paragraph through as 4×4 @0.77 and
  a case diary's three-line *masthead* through as 3×5 @0.79. One cell cannot
  establish an alignment. The floor counts only cells that *start* in a column: a
  spanning cell is evidence against the boundaries it crosses, not for them.
- **The two-column exception, and its price.** `minCols` is 3 because label/value
  blocks are everywhere in legal documents. But a charge sheet's witnesses (PW-1…)
  and documents relied upon (D-1…) are real two-column tables, and they are exactly
  what a case-creation flow wants. They are admitted only when *every* row opens
  with an identifier token and every row has content to the right of the boundary —
  a masthead fails on the first test, since its rows open with "FIR", "Under" and
  "Case". A two-column reading also never competes with a fuller one: a coarse grid
  is always the more *regular* grid, and confidence-primary selection duly picked a
  two-column reading of the invoice over its true six-column one, discarding four
  columns of line items.

**Repair before rejection.** A boundary no row uses twice is a spurious split
inside one wide cell, and two adjacent prose columns cannot be told apart by
anything the detector can see. Both are merged and re-assembled rather than
rejected. That is what recovers **D-1** — the copy of the FIR, the first document
relied upon — which projected as three columns, failed the type gate, and survived
only in the reading with its first row dropped, i.e. silently absent.

### 5.12 Tables are published as structure, not as autofill candidates

The tempting next step is to push every dated money row into the `dates` and
`amounts` candidate paths. That would be wrong twice over.

A bank statement's ten transaction dates are **not document-level facts** — none
of them is "the date of the document", and offering them for a field that means
that produces a CONFLICT between ten equally-wrong values. And the grid re-reads
the same words the prose sweep already read, so counting them again registers as
**corroboration**, which raises confidence. Evidence that is not independent must
not raise confidence, or the calibration stops meaning anything.

So `DocumentAnalysis.tables` publishes each grid as a `TableRecord`: semantics
(`LEDGER` · `LINE_ITEMS` · `ID_LIST` · `LISTING` · `UNKNOWN`), per-column coarse
type, a rectangular grid, one bbox per cell for provenance highlighting, and
normalised dates and amounts through the same parsers the rest of the engine uses.
`gridConf` and `semanticsConf` stay **two numbers**, so a reviewer can tell a
mis-detected grid from a correctly-detected grid under the wrong label. A cell that
fails to normalise is recorded as `null` rather than skipped — dropping an
unreadable amount silently changes a ledger's total. Semantics are derived from
column shape, never from the document classification: a bank statement annexed to a
s.138 complaint is still a ledger.

`ledgerRows()` resolves debit/credit/balance rather than leaving every caller to
re-derive it and get it wrong differently. The balance is identified as the money
column populated on every row, which is *derived* rather than assumed positional.

## 6. Governance

| Control | Mechanism |
|---|---|
| Provenance | Every `Candidate` carries documentId, pageNo, bbox, lineIndices, extractorId, extractorKind, aiInvolved, authorityWeight |
| Aadhaar masking | Masked in candidates *and* page text, before resolution. `XXXX XXXX 0123`. Unmasked value never becomes the normalised form. |
| Account masking | Same, last 4 retained |
| Restricted matters | Section-driven (POCSO s.23, IPC s.228A, BNS s.72, JJ Act s.74) plus textual triggers. Withholds 12 identity field paths. Over-triggers by design. |
| Audit chain | SHA-256 hash-chained, append-only. Tampering with entry *n* invalidates every entry after it; `AuditChain.verify()` returns the first broken seq. Clock injected. |
| AI flag | `aiInvolved` on every candidate; `governance.aiInvolved` batch-level |
| AI cap | Applied last in `combineConfidence`, so nothing can exceed it |
| Human review | Unreadable pages, suspected handwriting, and failed pages are listed with reasons rather than yielding fields |
| Concordance gate | `CONCORDANCE_STATUS = "DRAFT"` — only the 43 VERIFIED mappings of 112 apply; OMITTED/SPLIT/CONTESTED never produce a successor |

**Compliance mapping:** SOC 2 CC6/CC7 (audit chain, append-only, provenance) ·
ISO 27001 (local processing, no external egress) · ISO 42001 (`aiInvolved` on every
value, AI cannot finalise, approval gate) · GDPR/DPDP (data minimisation via
masking at the candidate boundary, purpose limitation via restriction gate) · Bar
Council (no AI-authored output, attribution on every field, advocate approval).

---

## 7. Measured performance

Host: 2-core container, Tesseract 5.3.4, 300 DPI, `OMP_THREAD_LIMIT=1`,
concurrency 4. **These are measurements, not targets.**

| Document | Route | Pages | Total | ms/page | raster | ocr | extract |
|---|---|---|---|---|---|---|---|
| fir.text.pdf | TEXT_LAYER | 2 | 565 ms | 283 | – | – | 48 |
| fir.scan.pdf | OCR | 2 | 8,808 ms | 4,404 | 3,424 | 4,759 | 7 |
| judgement.text.pdf | TEXT_LAYER | 2 | 150 ms | 75 | – | – | 11 |
| judgement.scan.pdf | OCR | 2 | 7,907 ms | 3,953 | 3,184 | 4,038 | 25 |
| notice138.text.pdf | TEXT_LAYER | 1 | 52 ms | 52 | – | – | 4 |
| notice138.scan.pdf | OCR | 1 | 6,222 ms | 6,222 | 1,974 | 3,943 | 4 |
| bail.text.pdf | TEXT_LAYER | 2 | 166 ms | 83 | – | – | 14 |
| bail.scan.pdf | OCR | 2 | 8,055 ms | 4,028 | 3,171 | 4,287 | 28 |
| saledeed.text.pdf | TEXT_LAYER | 2 | 75 ms | 38 | – | – | 8 |
| saledeed.scan.pdf | OCR | 2 | 8,128 ms | 4,064 | 3,368 | 4,179 | 26 |
| order_hi.scan.pdf (3-pass) | OCR | 1 | 8,585 ms | 8,585 | 1,474 | 6,787 | 26 |
| order_ta.scan.pdf (2-pass) | OCR | 1 | 5,770 ms | 5,770 | 1,272 | 4,184 | 22 |

**Summary:** text layer **92 ms/page** mean · OCR **5,289 ms/page** mean · ratio 57×.

**Optimisation history, same host and fixtures:**

| Change | OCR mean/page | Improvement |
|---|---|---|
| Baseline | 11,969 ms | — |
| `OMP_THREAD_LIMIT=1` + page concurrency | **5,289 ms** | **2.26×** |

**Remaining levers, measured but not yet applied:**

- **DPI.** Rasterisation is now 1.5–3.4 s of each OCR page. Measured `pdftoppm`
  cost: 200 DPI 1,933 ms vs 300 DPI 3,562 ms on the FIR scan. Ground-truth token
  recall on that page was **14/14 at every DPI from 150 to 400**. The default stays
  300 because that is one document at 10.5 pt and small print (8 pt footnotes,
  stamps) has not been tested — but 200 DPI is a validated ~1.6 s/page saving
  pending a benchmark on the tenant's real corpus.
- **Selective arbitration.** Extra Indic passes currently run on the whole page.
  Restricting them to lines containing digits would cut the Hindi page's 6.8 s
  materially, since most of a page carries no numerics.
- **More cores.** Page concurrency scaled 2.8× on 2 cores; the pool is bounded by
  `ocr.maxConcurrency`.

**UX implication that must be designed for, not engineered away:** a 10-page
scanned bundle is roughly **50 seconds**, not sub-second. The intake screen needs
progressive per-page streaming (the existing `onStage` SSE pattern), not a spinner.
Text-layer documents — an increasing share as e-filing spreads — genuinely are
sub-second.

---

## 8. Test coverage

**373 tests, 5 files, all passing.**

| File | Tests | What it pins |
|---|---|---|
| `test/patterns.test.ts` | 103 | Every grammar-pack pattern against real document shapes; ReDoS probe over the whole registry; empty-match and `lastIndex` hygiene |
| `test/repair.test.ts` | 21 | Identifier repair positives *and* refusals; Verhoeff and GSTIN checksums pinned against independently-verified real-format examples |
| `test/e2e.test.ts` | 89 | Whole pipeline over 14 rendered fixtures |
| `test/classify.test.ts` | 102 | **All 58 document types against a fixture of their own type**; cue hygiene; ≥0.12 margin over the runner-up; 28 named near-neighbour pairs |
| `test/tables.test.ts` | 58 | Grid detection, the two-column exception, 23-type prose false-positive suite, cell typing, continuation merging, semantics and ledger normalisation |

Fixtures are generated by two scripts. `test/fixtures/build_fixtures.py` produces
seven document types, each in a text-layer and a **deliberately degraded** scanned
variant (rotated 0.7°, salt-and-pepper noise, Gaussian blur, JPEG quality 55) — a
clean rasterisation is not a test. `test/fixtures/build_all_types.py` produces one
faithful statutory form for **every remaining document type**, so no classifier
profile is unexercised. All names, numbers and facts are fictional; the *forms* are
faithful.

### 8.1 What full-type coverage actually found

Fixtures for all 58 types were built specifically because 53 profiles had never
been run against a document of their own type. Five classifier defects surfaced
immediately, none of which any amount of re-reading the cues would have found:

| Defect | Why it mattered |
|---|---|
| `LEASE_DEED` matched `lease` inside **"pleased"** | "be pleased to" is the standard prayer formula, so a weight-11 lease cue fired on maintenance petitions, writs and plaints |
| `POWER_OF_ATTORNEY` lost to `AGREEMENT` | The cues required "do hereby" and "MY true and lawful attorney"; real deeds say "doth hereby" and "his" — two of four cues scored nothing, 19 of 37 points |
| `WARRANT` beat `SUMMONS` by 2 points | A warrant recites the summons that preceded it; the warrant's own cue required the literal word "accused" instead of the commoner "apprehend the said ‹name›" |
| `SEIZURE_MEMO` 13 vs `CASE_DIARY` 15 | A case diary narrates the day's seizures |
| `CIVIL_APPEAL` vs `AGREEMENT_TO_SELL` at 0.11 margin | An appeal *about* a contract quotes the contract |

Three further defects were outside the classifier: `ARTICLE` was case-sensitive and
so found nothing in an entire Presidential Ordinance, whose authority rests on
*article 123*; an IMEI in a seizure memo collided with the Aadhaar pattern; and a
throwaway probe with an extension-less filename exposed that MIME detection was
extension-only — now magic-byte sniffing with a `MIME_MISMATCH` warning.

Every type now self-classifies, none below 0.40 confidence, all clear of the
runner-up by ≥0.12.

### 8.2 Table detection, measured over the whole fixture set

Four of the 53 type fixtures contain a grid. All four are detected; the other 49,
and all seven core fixtures, produce **no** table — zero false positives.

| Fixture | Detected |
|---|---|
| `BANK_STATEMENT` | `LEDGER` 10×6 @0.79 — debit/credit/balance separated, wrapped row merged, two adjacent date columns kept distinct |
| `INVOICE` | `LINE_ITEMS` 4×6 @0.87 — S.No, description, HSN, qty, rate, amount |
| `CHARGESHEET` | `ID_LIST` 4×2 @0.95 (witnesses PW-1…PW-4) and `ID_LIST` 4×2 @0.94 (documents D-1…D-4) |
| `CAUSE_LIST` | `LISTING` ×2 — serial, CNR and party columns correct; case number over-splits (see §9) |

Defects the suite caught that would otherwise have shipped: the ReDoS hang, both
date-corruption bugs, the dropped s.138, the line-grouping collapse, the Aadhaar
leak in serialised output, the checksum-invalid fixture, the wrong obligor on a
conveyance obligation, the missing IFSC, the five classifier collisions above, and
— in the table work — four separate defects described in §5.11.

---

## 9. Honest limits — required reading

1. **All timings are from one 2-core container and 14 synthetic fixtures.** They
   are real measurements of real code, but they are not a benchmark on the tenant's
   corpus. Real Indian court scans are worse than these fixtures: faded carbon
   copies, stamps over text, handwritten interlineations, skew beyond 5°.
2. **Indic prose OCR is unreliable.** Devanagari and Tamil produce systematic
   matra-reordering errors (`दनिंक` for `दिनांक`, `சனெனல` for `சென்னை`). Numerics
   survive; names, places and occupations do not. The engine applies a 0.72
   confidence penalty to textual fields off Indic lines, which is a mitigation, not
   a fix. **Indic-language matters need human verification of every name field.**
3. **Indic handwriting is not machine-readable today.** Google Document AI classes
   Devanagari and Bengali handwriting as *Experimental* and does not list Tamil or
   Telugu handwriting at all; Azure Document Intelligence supports **no** Indic
   handwriting. Handwritten pages are flagged for human review and produce no
   fields. Court annotations, endorsements and vakalatnama margins are therefore a
   manual step, not an automated one.
4. **The recodification concordance is `DRAFT` and only 38% verified.** 112
   mappings across IPC→BNS, CrPC→BNSS and IEA→BSA: **VERIFIED 43 · SECONDARY 60 ·
   UNVERIFIED 8 · CONTESTED 1**. Only the 43 VERIFIED entries apply while the table
   is DRAFT; the other 69 are withheld by `mapSuccessor()`. IPC 377 and 309 are
   recorded as OMITTED with no successor, and 377 as CONTESTED. **This table must
   not drive anything a court sees until an advocate signs it off.**
5. **Party role inference is conservative and will leave roles UNKNOWN.** When
   neither side of a cause title is labelled, both roles stay UNKNOWN rather than
   assuming the conventional order — which is not universal, since a State appeal
   inverts it.
6. **Table detection has three known limits.**
   (a) **A monospaced cause list's case-number column over-splits.** "W.P.  No.
   18842/2024" is written with two spaces inside the case number — geometrically
   *identical* to the two spaces that separate real columns, so no width rule can
   distinguish them. The content-based fix (`redundantBoundaries`) fires correctly,
   but the collapsed grid is then rejected by the typed-column gate, and loosening
   that gate is what keeps indented prose from being read as a table. The serial,
   CNR and party columns are all correct; only the case number splits. Asserted as
   a test so it stays visible.
   (b) **Table detection is unverified on OCR pages.** Every table fixture is a
   text-layer page. OCR word boxes are noisier and the gutter projection has never
   been measured against them. Treat a table found on a scanned page as unproven.
   (c) **`minRows` is applied before continuation-row merging**, so a cause list
   whose entries wrap over three lines each can emerge as a two-row table. Thin, but
   rejecting it would discard real listings.
7. **No DOCX path yet.** `mammoth` is an optional dependency but unwired.
8. **Bengali has no Paddle model in any generation** — Tesseract is the only route.
   PP-OCRv6 has **no** Indic coverage at all despite package README claims; only
   three PP-OCRv5 script models exist (Devanagari, Tamil, Telugu).
9. **`mupdf` / `mupdf-js` must never be added** — AGPL-3.0-or-later. Same for
   `scribe.js-ocr`. Poppler binaries are GPL and are invoked as a separate process,
   never linked; record that in the SBOM.
10. **Licence hygiene items** in the dependency set: `string-similarity` is
    formally deprecated (use `fastest-levenshtein`); `langdetect`, `tiny-segmenter`
    and `unorm` carry non-SPDX licence strings and need legal review before use.
11. **The classifier has no labelled Indian legal corpus behind it.** It is
    weighted cues, chosen deliberately for explainability and minute-scale
    correction. Accuracy on the tenant's real document mix is unmeasured.

---

## 10. Next steps

**Before any customer demo**
1. Benchmark on 200–500 real documents from the tenant's own corpus. Replace §7
   with those numbers and measure classification accuracy for the first time.
2. SME sign-off on the concordance, then flip `CONCORDANCE_STATUS`.
3. Wire progressive per-page streaming into the intake screen.

**Phase 2**
4. Ruled-line table detection for pixel pages, as a second route alongside
   projection — and a measurement of projection on OCR'd grids, which is currently
   unverified (§9.6b).
5. Selective arbitration on numeric-bearing lines only.
6. DOCX path via `mammoth`.
7. Court/case-type resolution against `nyv_ref` — note case-type codes are
   court-scoped, never national.

**Phase 3**
8. Handwriting triage: route suspected handwritten pages to a review queue with
   region crops rather than attempting extraction.
9. Per-tenant anchor profiles for tribunal-specific forms.
10. Active learning from advocate corrections — corrections are already captured
    as `MANUAL` candidates with full provenance, so the training signal exists.
