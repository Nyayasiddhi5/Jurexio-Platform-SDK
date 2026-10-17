# Semantic Versioning Policy — `@jurexio/client-sdk`

This package and its companion packages (`@jurexio/types`,
`@jurexio/react-hooks`, `@jurexio/client-sdk-react-native`,
`@jurexio/nyayamitra-sdk`) follow [SemVer 2.0](https://semver.org).

## What counts as a breaking change (MAJOR)

- Removing or renaming any export from `src/index.ts`.
- Removing or renaming any public method on `NyvClient`, any `*Api` class, or
  `NyvStreamReader`.
- Changing the type of any required argument or return value of a public
  method.
- Adding a new required argument to a public method (use an options bag with
  optional fields instead).
- Changing the wire format of webhook payloads or signature algorithm.
- Bumping the minimum supported Node version.
- Bumping the minimum supported React (peer) version.

## What counts as a feature (MINOR)

- A new exported symbol.
- A new optional argument with a default that preserves prior behavior.
- A new event type emitted by `NyvStreamReader`.
- A new field added to a response payload.

## What counts as a patch (PATCH)

- Bug fixes that do not change any documented behavior.
- Performance improvements.
- Internal refactors that do not change the public API.
- Documentation, JSDoc, or test changes.

## Deprecation cycle

1. A symbol marked `@deprecated` in JSDoc + a `console.warn` on first use ships
   in the **next minor**.
2. The symbol must continue to work for **at least one major** release.
3. Removal happens in the major release after the deprecation announcement.

## Pre-release tags

- `*-alpha.*` — internal builds; no API stability guarantees.
- `*-beta.*` — feature-frozen; no breaking changes; bug fixes only.
- `*-rc.*` — release candidate; would-be GA pending sign-off.

## Companion package alignment

The four companion packages (`types`, `react-hooks`, `client-sdk-react-native`,
`nyayamitra-sdk`) are released together with `@jurexio/client-sdk` at the
**same MAJOR** version. Their MINOR/PATCH versions may differ.

For v6 GA all five packages share `^6.0.0` (except `nyayamitra-sdk` which
starts at `1.0.0` since it is brand new — its v1 is contract-aligned with
`@jurexio/client-sdk@^6.0.0`).
