---
status: superseded
version: v5.0.0
superseded_by: docs/v3.1.2/completed_docs/NYV-SDK-v6-INTEGRATION-GUIDE.md
last_verified: 2026-04-25
---
# Nyayavigya SDK v5 — Deprecation Policy

> Status: **Maintenance** as of 2026-04-25 · Sunset: 2026-10-25

---

## 1. Summary

The v5 line of Nyayavigya SDK packages enters **maintenance mode** with the
release of v6 GA on 2026-04-25. v5 will continue to receive **security
patches only** for **6 months** and will then be unpublished from the npm
`latest` tag.

| Date         | Milestone |
|---|---|
| 2026-04-25 | v6.0.0 GA released. v5 enters maintenance. |
| 2026-04-25 | Console begins serving a deprecation banner to v5 callers. |
| 2026-07-25 | Final reminder email to all orgs still on v5 (90 days notice). |
| 2026-10-25 | v5 unpublished from `latest`; remains downloadable by version pin. |
| 2027-04-25 | v5 endpoints removed from the gateway. After this date all v5 calls return `410 Gone`. |

## 2. What "maintenance mode" means

While v5 is in maintenance, we will:

- **Patch CVEs** (SDK code, transitive deps, signing, transport).
- **Patch any P0/P1 bug** that affects production correctness or data loss.
- **Honour existing SLOs** — gateway-side rate limits, latency, uptime stay
  the same.

While v5 is in maintenance, we will NOT:

- Add features. Every new capability ships in v6.
- Add new patterns or agents to v5.
- Backport breaking type changes from v6.

## 3. What's actually different in v6

v5 → v6 is **additive**. There are no breaking source-code changes for the
core surface. The motivations for v6 are:

1. **First-class React Native support** via `@nyayavigya/client-sdk-react-native`.
2. **Citizen / Nyayamitra surface** via `@nyayavigya/nyayamitra-sdk`.
3. **HMAC-signed webhooks** delivered end-to-end.
4. **Tree-shakeable ESM exports** (`package.json#exports` correctly map to
   `.mjs` / `.js` / `.d.ts`).
5. **Documentation set + CONTRIBUTING + SEMVER**.

If you are happy on v5 and don't need any of the above, you can stay on v5
until 2026-10-25 with no functional regression.

## 4. Upgrade steps (v5 → v6)

```bash
# 1. Update dependencies
npm i @nyayavigya/client-sdk@^6 @nyayavigya/types@^6 @nyayavigya/react-hooks@^6

# 2. Re-build + re-test. No code change is required for the core surface.

# 3. Optional: adopt the RN wrapper if you ship mobile.
npx expo install @nyayavigya/client-sdk-react-native

# 4. Optional: wire webhook signature verification (see Integration Guide §6).
```

There is no codemod because the surface didn't change. Run `npm run typecheck`
after upgrading — any type errors are reported through the normal compiler.

## 5. Communication

- A deprecation banner is shown in the console for any SDK app whose most
  recent call carries the v5 user-agent.
- A header `X-NYV-Deprecation: client-sdk-v5; sunset=2026-10-25` is added to
  every response served to a v5 client.
- A monthly digest email goes to every org admin until the org has migrated
  100 % of its calls.

## 6. Support

For migration questions, file a ticket at <https://nyayavigya.in/support> with
subject `[v5→v6 migration]` or post in `#sdk-migration` on the developer
Slack. We track migrations in the public dashboard at
<https://app.nyayavigya.in/console/sdk-migration>.

## 7. Why now

We have run v5 in production for 6 months. Every NYV-internal team is now on
v6 GA, both apps (NSP web + NSP mobile + Nyayamitra) ship with v6, and the
gateway has had no v5-only code paths since 2026-03-15. Cutting the v5 line
in 6 months keeps the surface small enough to maintain rigorously.
