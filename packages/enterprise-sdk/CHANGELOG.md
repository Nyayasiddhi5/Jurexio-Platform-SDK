# Changelog — `@jurexio/enterprise-sdk`

Format: [Keep a Changelog](https://keepachangelog.com).

---

## [5.1.1] — 2026-06-04 — Version-string unification

### Changed
- Bumped to `5.1.1` to match the partner `@jurexio/client-sdk@5.1.1`; peer
  dependency range raised to `^5.1.1`.
- Reconciled drifted version strings: `SDK_VERSION` and `EnterpriseClient.VERSION`
  were stale `3.1.2`, and the `package.json`/header described "Platform 3.1.2" —
  all corrected to `5.1.1` / platform `5.1.0`. No API surface change.

---

## [5.1.0] — 2026-05-28 — Registry alignment patch

### Changed
- Bumped to `5.1.0`; peer dependency on `@jurexio/client-sdk@^5.1.0`.
- No breaking enterprise surface changes; aligns semver with gateway v5.1.0
  runtime registry (164 active agents).

---

## [5.0.0] — 2026-04-25 — GA

Initial enterprise SDK release (compliance, billing, multi-org helpers).
