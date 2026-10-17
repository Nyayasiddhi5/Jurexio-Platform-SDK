# Contributing to `@jurexio/client-sdk`

Thank you for considering a contribution to the Jurexio v6 SDK.

This package is the **official, public** TypeScript client for the Jurexio
Gateway API. Its contract is consumed by:

- `@jurexio/react-hooks`
- `@jurexio/client-sdk-react-native`
- `@jurexio/jurexio-citizen-sdk`
- The three example apps under `examples/`
- All third-party developer integrations

Because of that surface area, every PR must keep the contract stable.

---

## Local development

Requirements: Node ≥ 22, npm ≥ 10.

```bash
cd packages/client-sdk
npm install
npm run build           # tsc emit to ./dist
npm test                # vitest run
npm run test:coverage   # full coverage report
```

The package is **isomorphic** — it must build and run unchanged in:

- Node ≥ 22 (server, Lambda, Workers)
- Modern browsers (ESM)
- React Native 0.74+ (via `@jurexio/client-sdk-react-native`)

If your change adds a Node-only or browser-only API, gate it behind a runtime
check (`typeof window !== 'undefined'`, `typeof process !== 'undefined'`) and
document the constraint in JSDoc.

---

## Required PR checklist

1. `npm run build` passes with **zero TypeScript errors**.
2. `npm test` passes.
3. Public API changes (any export from `src/index.ts` or any `Api*` class) are
   recorded in `CHANGELOG.md` under the "Unreleased" heading using
   [Keep a Changelog](https://keepachangelog.com) categories.
4. Breaking changes to a public type or method signature require a major version
   bump per the [Semver policy](./SEMVER.md) **and** a deprecation entry in
   the previous minor.
5. A new public method ships with at least one usage example in JSDoc.
6. New dependencies require maintainer pre-approval — keep the SDK lean.

---

## Releasing

Releases are cut by maintainers only and are **fully automated** via GitHub
Actions. The same release-train tag publishes all three GA SDKs together:

- `@jurexio/client-sdk`
- `@jurexio/client-sdk-react-native`
- `@jurexio/jurexio-citizen-sdk`

### Process

1. Open a release PR that bumps the `version` field in each package's
   `package.json` you intend to release. Move the `Unreleased` block in
   `CHANGELOG.md` under the new version + date.
2. The **SDK Publish Dry-Run** workflow (`.github/workflows/sdk-publish-dryrun.yml`)
   runs automatically on the PR. It builds, type-checks, tests, and runs
   `npm publish --dry-run --access public --provenance` for every package so
   you can confirm the publish will succeed before tagging.
3. Merge the PR.
4. Tag the merge commit on `main` with the release-train tag and push:
   ```bash
   git tag sdk-v6.0.0 && git push origin sdk-v6.0.0
   ```
   The tag itself is just a marker — the actual versions that land on npm come
   from each package's `package.json`. Any package whose current version is
   already on the registry is skipped, so re-running on the same tag is safe.
5. The **SDK Publish** workflow (`.github/workflows/sdk-publish.yml`) runs on
   the tag push. For each package it:
   - Type-checks (`tsc --noEmit`)
   - Builds (`npm run build`, which fires `prepublishOnly`)
   - Runs `npm test` if defined
   - Runs `npm publish --dry-run` for content verification
   - Publishes via `npm publish --access public --provenance --tag latest`
6. Verify the new versions appear under
   <https://www.npmjs.com/package/@jurexio/client-sdk> (and the two sibling
   packages), each with a green **Provenance** badge that links back to the
   GitHub Actions run.

To publish to a non-`latest` channel (e.g. a release candidate), trigger the
**SDK Publish** workflow manually from the Actions tab and choose `beta` or
`next` as the dist-tag.

### Required repository secret: `NPM_TOKEN`

Both publishing workflows authenticate to the npm registry using the
`NPM_TOKEN` secret, which **must be configured at the repository level** in
GitHub → Settings → Secrets and variables → Actions:

| Secret name | Type | How to generate |
| ----------- | ---- | --------------- |
| `NPM_TOKEN` | Automation token (npm) | `npm token create --type=automation` while logged in as a member of the `@jurexio` org with publish rights, or via <https://www.npmjs.com/settings/your-org/tokens>. |

The token must:

- Be an **Automation** token (so 2FA is not required on `npm publish`).
- Have **Read and Publish** access to the `@jurexio` scope.
- Be stored as a repository secret (not an environment secret) so the workflow
  can read it without an environment-protection prompt.

The publish workflow also requests an OIDC `id-token` (`permissions: id-token: write`)
which is what enables `--provenance`. No additional configuration is needed —
GitHub Actions issues the token automatically when the workflow runs from this
repository.

### Manual fallback

If the workflow is unavailable, a maintainer can publish locally:

```bash
cd packages/client-sdk
npm run build && npm pack          # verify tarball tree under ./dist
npm publish --dry-run              # confirm files list matches package.json#files
npm publish --tag latest --access public
```

Then repeat for `packages/client-sdk-react-native` and
`packages/jurexio-citizen-sdk`. Note that locally published versions will **not**
carry npm provenance — prefer the workflow whenever possible.

---

## Coding standards

- Strict TypeScript (`"strict": true` in tsconfig). No `any` in public APIs.
- All public methods have JSDoc with at least one example.
- All thrown errors are `JrxError` instances with a stable `code`.
- All HTTP timeouts are configurable; default 30 s.
- All requests go through `JrxHttpClient` so headers/auth/retry are centralised.

---

## Reporting issues

Open a GitHub issue at the platform repo with a minimal repro, the SDK version
(`JrxClient.VERSION`), Node/RN version, and the full `JrxError` message including
`code`, `status`, `traceId`.
