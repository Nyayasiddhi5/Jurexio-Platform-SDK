# Admin Console E2E (Phase 4 foundational suite)

Playwright suite seeded by Session-15 v9 (2026-05-11). Covers the
runtime-React-error gap that the SDK-key API smoke (`scripts/jrx-smoke-bash.sh`)
cannot detect — the Vite SPA shell returns 200 for every route even when a
component throws and renders an empty page.

## Run locally

```bash
# one-time: download Chromium (~500 MB)
npm run e2e:install

# run the suite (assumes NYV Console on :3004 + NYV Gateway on :5000)
npm run e2e

# or against a different deployment
NYV_E2E_BASE_URL=https://console.nyayasiddhi.online \
NYV_E2E_GATEWAY_URL=https://api.nyayasiddhi.online \
  npm run e2e
```

## Adding specs

Drop `*.spec.ts` files in this directory. Conventions:

- **Use `data-testid`** selectors first; fall back to role/text only when
  no testid exists. The console codebase already adds `data-testid` to
  every interactive element (see e.g. `client/src/pages/SuperAgent.tsx`).
- **Attach `attachConsoleAssertions(page)` from `admin-console.spec.ts`**
  to every protected-route spec to catch runtime React errors.
- **Filter benign console noise** (`Sentry`, `favicon`) — anything else is
  a real regression.
- **Protected routes need a seeded test user + session token.** That
  scaffolding is deferred to Item #4 continuation per the Session-15
  feature-matrix backlog.

## CI

- `forbidOnly: !!process.env.CI` — `test.only` will fail the build.
- `retries: 2` in CI, `0` locally.
- `reporter: [github, list]` in CI for inline annotations.
- No `webServer` block — CI must start the Console + Gateway workflows
  before invoking `npx playwright test`.

## Scope reminder (NV-SDK-UNIFIED-001 v6)

This suite exercises the **Admin Console UI only**. The 7-platform SDK API
surface (NSP, NSPM, NSI, NSM, NSA, NYM, JRX) is exhaustively covered by
`scripts/jrx-smoke-bash.sh` and `scripts/jrx-smoke-all-platforms.ts`. Do NOT
duplicate those probes here — keep this suite focused on what only a real
browser can see.
