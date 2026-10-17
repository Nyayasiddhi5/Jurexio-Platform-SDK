# Changelog — `@jurexio/nyayamitra-sdk`

Format: [Keep a Changelog](https://keepachangelog.com).
Versioning: aligned with `@jurexio/client-sdk` per [SEMVER.md](../client-sdk/SEMVER.md).

---

## [5.1.2] — 2026-08-08 — Patra Mitra

### Added
- `openPatraMitra()` / `askPatraMitra()` — document parse (OCR), fields, summary, grounded Q&A via NYV `/api/jrx/v1/sdk/patra-mitra/*`.
- Expo sample tab **PATRA** in `examples/nyayamitra-mobile`.

---

## [5.1.1] — 2026-06-04 — Version-string unification

### Changed
- Bumped to `5.1.1` to align with `@jurexio/client-sdk@5.1.1`; dependency
  range raised to `^5.1.1`.
- Reconciled drifted version strings: `NyayamitraClient.VERSION` was stale
  `1.0.0` and the index header referenced `client-sdk@^6.0.0` — corrected to
  `5.1.1` / `^5.1.1`. No API surface change.

---

## [5.1.0] — 2026-05-28 — Registry alignment patch

### Changed
- Bumped to `5.1.0`; peer dependency on `@jurexio/client-sdk@^5.1.0`.
- Documents gateway v5.1.0 runtime truth (164 agents) without API changes.

---

## [1.0.0] — 2026-04-25 — GA

First public release.

### Added
- `NyayamitraClient.chat()` — wraps the `mitra-conversational` agent with
  typed request/response and follow-up extraction.
- `NyayamitraClient.classifyClauses()` — wraps `clause-classifier`,
  normalising risk levels and surfacing per-clause citations.
- `NyayamitraClient.generateCaseBrief()` — wraps `case-brief-generator`,
  returning a structured brief (summary, applicable laws, next steps,
  recommended lawyer type, INR cost band).
- `NYAYAMITRA_LANGUAGES`, `NYAYAMITRA_LANGUAGE_LIST`,
  `NYAYAMITRA_UI_STRINGS`, `detectLanguage()`, `isRTL()`, `localeFor()`,
  `t()` — Indic-language helpers covering English + 9 Indian languages.
- `OfflineDraftQueue` — storage-agnostic queue (AsyncStorage / MMKV /
  IndexedDB compatible) with envelope versioning, attempt counters, and
  `flush(dispatcher)` for replay on reconnect.

### Pairs with
- `@jurexio/client-sdk@^6.0.0`
- `@jurexio/types@^6.0.0`

### Verification (2026-04-25)
- `tsc --noEmit` against `src/**/*` — **PASS** (0 errors). Run from repo root:
  `node_modules/.bin/tsc --project /tmp/tsc-verify.json`.
- `npm pack --dry-run` — **PASS**. Tarball: `nyayavigya-nyayamitra-sdk-1.0.0.tgz` (3 files, 2.3 kB).
