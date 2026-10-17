# @jurexio/docparse-sdk — Changelog

## [1.0.0-alpha.8] — 2026-10-16

### Added
- **`BAR_COUNCIL_CERT`** doc type (Bar Council enrollment; identity pack).
- **`mapExtractionToNspOnboardingForm`**, **`resolveOnboardingDomainPack`** — NSP Pro Step-2 field names (`panNumber`, `barCouncilNumber`, `firmName`, …).
- Golden tests: `test/onboarding-extract-golden.test.ts` (PAN + Bar + MCA synthetic text).

## [1.0.0-alpha.7] — 2026-10-16

### Added
- **`pageManifest`** on `docparseIntelligence` v1 (`docparse.pageManifest/v1`) — per-page route, quality, table count, human-review flag for NSP partial UX.

## [1.0.0-alpha.6] — 2026-10-15

### Added
- **`legal-in-identity`** pack + `mapExtractionToNspUserOnboarding` (`userProfile`, `withheld` for Aadhaar).
- **`legal-in-evidence`** pack + `mapExtractionToNspEvidence` (`needsDepiction`, tags, visible text).
- **`domainPackIdForIngestRole()`** — `onboarding_kyc`, `case_evidence`, `chat_attachment`, `draft_attachment`, etc.
- Identity partial-LLM schema hooks (NYV provider).

### Tests
- `identity-evidence-p1p2.test.ts`; full suite **399/399** pass.

## [1.0.0-alpha.5] — 2026-10-15

### Added
- **`legal-in-civil`** domain pack + `domain-packs/legal-in-civil.json`; company/registration/GST doc types + `COMPANY_REGISTRATION` anchors.
- **`mapExtractionToNspCompanyProfile`**; pack-aware partial LLM schemas; autofill **`withheld`** list.
- Cloud OCR gate v2; PDF bytes temp-path ingest; Vasee-class synthetic regression test.

### Changed
- Default NYV SDK ingest pack **`legal-in-civil`** with **`preferOcr: true`**.

## [1.0.0-alpha.4] — 2026-10-07

### Fixed

- **Image ingest from bytes:** API/async jobs that send `bytes` + `mime` (no `path`) now materialize a temp file so OCR + cloud Textract hooks run (fixes empty pages on PNG job uploads).

## [1.0.0-alpha.1] — 2026-10-06

### Added

- Forked from `@jurexio/docparse@0.2.1` as parallel Platform SDK line (production unchanged).
- DocparseResult v1 serializer, LegalParseGuide builder, PII field catalog.
- Domain pack framework + `legal-in` pack id.
- In-memory job queue + `DocParseClient`.
- Optional Paddle OCR engine (`paddle-v5-*` ids).
- Government doc profiles: RTI, GOVT_ORDER, GAZETTE, TENDER_RFP.
- Assist-pass plugin interface (disabled by default; no LLM in core).

### Unchanged from 0.2.1 baseline

- Core pipeline, 373+ fixture tests (copied baseline).
