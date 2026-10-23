# Changelog — `@jurexio/client-sdk-react-native`

Format: [Keep a Changelog](https://keepachangelog.com).
Versioning: aligned with `@jurexio/client-sdk` per [SEMVER.md](../client-sdk/SEMVER.md).

---

## [5.1.1] — 2026-06-04 — Version-string unification

### Changed
- Bumped to `5.1.1` to align with `@jurexio/client-sdk@5.1.1`; dependency
  range on `@jurexio/client-sdk` raised to `^5.1.1`.
- Reconciled drifted version strings: `JrxClientRN.VERSION` was stale `1.0.0`,
  the `package.json` description said "v5.0.0", and the index header referenced
  `client-sdk@^6.0.0` — all corrected to `5.1.1` / `^5.1.1`. No API surface change.

---

## [5.1.0] — 2026-05-28 — Registry alignment patch

### Changed
- Bumped to `5.1.0`; depends on `@jurexio/client-sdk@^5.1.0` and
  `@jurexio/types@^5.1.0`.
- Build tsconfig paths resolve sibling packages for monorepo builds.

---

## [1.0.0] — 2026-04-25 — GA

First public release.

### Added
- `JrxClientRN.create({ baseUrl, ... })` — async factory that restores any
  saved API key from secure storage and constructs an underlying `JrxClient`.
- `createSecureStorage()` — picks the best available backend at runtime
  (`expo-secure-store` → `react-native-keychain` → AsyncStorage → memory).
- `JrxRNStreamReader` — streaming reader using `react-native-sse` with a
  long-poll fallback (`?stream=poll` NDJSON) for builds without SSE.
- `requestCameraPermission`, `requestMicrophonePermission`,
  `requestMediaLibraryPermission`, `requestPushNotificationPermission`,
  `requestStandardSdkPermissions` — Expo permission helpers with
  module-missing detection.
- `registerForHITLPushNotifications` — registers the device for HITL push
  notifications, persists incoming payloads to a secure inbox, and
  invokes a foreground callback.
- Re-exports of the underlying `JrxClient`, `JrxError`, `JrxStreamReader`,
  and the most-used types so consumers only need this one package.

### Pairs with
- `@jurexio/client-sdk@^6.0.0`
- `@jurexio/types@^6.0.0`

### Verification (2026-04-25)
- `tsc --noEmit` against `src/**/*` — **PASS** (0 errors). Run from repo root:
  `node_modules/.bin/tsc --project /tmp/tsc-verify.json`.
- `npm pack --dry-run` — **PASS**. Tarball: `jurexio-client-sdk-react-native-1.0.0.tgz` (3 files, 2.5 kB).
