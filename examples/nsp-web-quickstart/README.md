# `nsp-web-quickstart` — Next.js 14 sample for `@jurexio/client-sdk@5.0.0`

A minimal Next.js 14 app router sample wired to the JRX SDK demonstrating:

| Page | What it shows |
|---|---|
| `/chat`         | NyayaRAG ask/answer with citations. |
| `/document`     | Upload a PDF → poll status → run clause analysis. |
| `/voice`        | Sarvam Hindi text-to-speech. |
| `/intelligence` | Precedent search via `jrx.intelligence.findPrecedents(query, 'IN', { topK })`. |
| `/stream`       | CoT pattern with live thinking + token-delta streaming. |

## Setup

```bash
cp .env.example .env.local
# then edit .env.local and set JRX_API_KEY
npm install
npm run dev
# open http://localhost:3000
```

> The browser **never** sees the API key — every call is proxied through
> `/api/jrx-proxy/*`, which lives in `src/app/api/jrx-proxy/[...path]/route.ts`
> and adds `Authorization: Bearer …` and `X-API-Key` server-side.

Gateway paths use **`/api/jrx/`** (not legacy `/api/nv/`).

## Webhook receiver

Webhook endpoint: `POST /api/jrx-webhook` (see `src/app/api/jrx-webhook/route.ts`).

## Manual smoke test (clean machine)

See `documents/working/JRX-FRONTEND-INTEGRATION.md` for CORS and SDK-key guidance.
