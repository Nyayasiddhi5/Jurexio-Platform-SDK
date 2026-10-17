---
status: completed
version: v6.0.0
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya SDK v6 — Integration Guide

> Audience: backend / web engineers integrating Nyayavigya into a server or
> Next.js / Node app. Mobile readers should follow the
> [Mobile Integration Guide](./NYV-MOBILE-INTEGRATION-GUIDE.md) instead.

---

## 1. Get an API key

1. Sign in to <https://app.nyayavigya.in/console>.
2. Open **SDK Apps** → **+ New app**.
3. Pick the platform (`web` / `mobile` / `api` / `console`) and the
   jurisdiction(s) you'll operate in.
4. Copy the `nyv_live_sk_…` key. **You will not see the secret again.**
5. Optionally set a `Webhook URL` — the console will generate and show a
   one-time `Webhook Secret` (`nyv_whsec_…`). Save it; you'll need it for
   signature verification.

## 2. Install

```bash
npm i @nyayavigya/client-sdk @nyayavigya/types
# React app? Add the hook bindings:
npm i @nyayavigya/react-hooks
```

## 3. The "rule of three"

Every NYV integration follows the same shape:

1. **Server-side**: hold the live `nyv_live_sk_…` key. Never expose it.
2. **Edge**: a thin proxy or route handler that adds the `Authorization`
   header for the browser. The reference Next.js sample uses
   `src/app/api/nyv-proxy/[...path]/route.ts` (see `examples/nsp-web-quickstart`).
3. **Client**: the browser calls your proxy, never the gateway directly.

## 4. First call

```ts
import { NyvClient } from '@nyayavigya/client-sdk';

const nyv = new NyvClient({
  apiKey: process.env.NYV_API_KEY!,
  baseUrl: 'https://api.nyayavigya.com',
});

const r = await nyv.ask('What is BNS Section 103?');
console.log(r.answer, r.citations);
```

## 5. Streaming (Server-Sent Events)

```ts
const ac = new AbortController();
await nyv.stream.streamPattern('cot', { task: '...' }, {
  onTextDelta: (delta) => process.stdout.write(delta),
  onComplete:  (final) => console.log('\n--', final.traceId),
  onError:     (err)   => console.error(err),
}, { signal: ac.signal });
```

## 6. Webhooks — `orchestration.completed`

Set `Webhook URL` and `Webhook Secret` in the console. The gateway will POST
a signed payload after every orchestration the SDK app initiates. See section
5 of the [API reference](./NYV-SDK-v6-API-REFERENCE.md) for the schema and
the verification recipe.

A reference receiver lives at
`examples/nsp-web-quickstart/src/app/api/nyv-webhook/route.ts`.

To test before going live:

```bash
curl -X POST -H "Authorization: Bearer $NYV_CONSOLE_TOKEN" \
  https://app.nyayavigya.in/api/nv/sdk/console/apps/$APP_ID/webhook/test
```

The console responds with the delivery id; check your receiver's logs to see
the synthetic event.

## 7. Errors and retries

The SDK throws `NyvError` for any non-2xx HTTP response and retries `429` /
`5xx` automatically with exponential back-off (3 attempts, jitter ±20 %).

For idempotency-sensitive endpoints (uploads, agent runs), pass a stable
`x-nyv-correlation-id` header — the gateway uses it as an idempotency key.

## 8. Observability

Every response carries:

- `X-NYV-Trace-Id` — surface this in your error UI for support.
- `X-NYV-Pattern-Used` — the pattern actually executed (router decisions).
- `X-NYV-Cost-Inr` — estimated INR spend for the call.

The same fields are available on the typed response envelope at
`response.traceId`, `response.patternUsed`, `response.costInr`.

## 9. Versioning + upgrades

- `package.json` should pin `^6.0.0` — semver minor + patch are safe.
- Major upgrades (`6.x → 7.x`) follow the
  [`SEMVER.md`](../../../packages/client-sdk/SEMVER.md) policy: at least 90 days'
  notice + a side-by-side migration guide.
- v5 receives security patches only; see
  [`NYV-SDK-v5-DEPRECATION-POLICY.md`](../superseded/NYV-SDK-v5-DEPRECATION-POLICY.md).

## 10. Going to production

- ✅ Server-side `NYV_API_KEY` in secrets manager (not in source).
- ✅ Browser uses a proxy, not the live key directly.
- ✅ Webhook receiver verifies signature + timestamp.
- ✅ Rate-limit `/api/nyv-proxy/*` per session.
- ✅ Error UI surfaces `traceId` so support can correlate.
- ✅ `NyvClient.VERSION` logged at boot for forensics.
- ✅ Sentry / OTEL hooked to capture `NyvError.code` + `requestId`.
