# `nsp-web-quickstart` — Next.js 14 sample for `@nyayavigya/client-sdk@^6.0.0`

A minimal Next.js 14 app router sample wired to the v6 SDK demonstrating:

| Page | What it shows |
|---|---|
| `/chat`         | NyayaRAG ask/answer with citations. |
| `/document`     | Upload a PDF → poll status → run clause analysis. |
| `/voice`        | Sarvam Hindi text-to-speech. |
| `/intelligence` | Precedent search via `nyv.intelligence.findPrecedents(query, 'IN', { topK })`. |
| `/stream`       | CoT pattern with live thinking + token-delta streaming. |

## Setup

```bash
cp .env.example .env.local
# then edit .env.local and set JRX_API_KEY
npm install
npm run dev
# open http://localhost:3100
```

> The browser **never** sees the API key — every call is proxied through
> `/api/jrx-proxy/*`, which lives in `src/app/api/jrx-proxy/[...path]/route.ts`
> and adds the `Authorization: Bearer …` header server-side.

## Webhook receiver

This sample also includes a webhook endpoint at
`POST /api/jrx-webhook` that verifies the HMAC `X-JRX-Signature` header and
prints `orchestration.completed` events to the server console. To wire it up,
go to the JRX console → SDK Apps → Edit → set `Webhook URL` to:

```
https://<your-deploy>/api/jrx-webhook
```

…and copy the generated secret into `JRX_WEBHOOK_SECRET` in `.env.local`.

## Manual smoke test (clean machine)

1. `git clone <this-repo>` and `cd examples/nsp-web-quickstart`.
2. `cp .env.example .env.local`; paste a real key.
3. `npm install` then `npm run build` — no errors expected.
4. `npm run dev`, open `/chat`, ask "What is BNS Section 103?", verify a
   non-empty answer + citations.
5. Click `/stream`, run the CoT prompt, verify the "Thinking" list grows and
   the "Output" pane fills in real time.
6. From the console, send a test webhook (`POST /apps/:id/webhook/test`) and
   verify the server prints `orchestration.completed received`.

## Production checklist

- Replace the in-process proxy with an edge function or API gateway in front
  of the Next.js app (Cloudflare, Vercel Edge Middleware, etc).
- Move `JRX_API_KEY` into your hosting platform's secrets manager.
- Enable rate-limiting on `/api/jrx-proxy/*` so a leaked browser session can't
  drain your gateway quota.
- Set a longer-lived TLS certificate on your webhook receiver — the gateway
  will refuse to deliver to certs newer than 90 days.
