# Jurexio Enterprise SDK — integration guide

**Product:** Jurexio Enterprise Platform (global).  
**Production API:** `https://jurexio.nyayasiddhi.online`  
**Do not use:** non-Jurexio legacy gateway hosts or pre-rebrand API prefixes for new frontends.

**Frontend CORS, SDK key vs JWT, and route/auth matrix:** [JRX-FRONTEND-INTEGRATION.md](./JRX-FRONTEND-INTEGRATION.md)

## Base URL

| Environment | URL |
|-------------|-----|
| Production | `https://jurexio.nyayasiddhi.online` |
| Local gateway | `http://127.0.0.1:5010` (or your compose port) |

Partner REST surface: **`/api/jrx/...`** (OpenAPI at `/api/jrx/openapi.json`).

## TypeScript SDK

```ts
import { JrxClient } from '@jurexio/client-sdk';

const jrx = new JrxClient({
  apiKey: process.env.JRX_SDK_KEY!,
  baseUrl: process.env.JRX_PUBLIC_API_URL ?? 'https://jurexio.nyayasiddhi.online',
  apiPathPrefix: '/api/jrx',
  defaultJurisdiction: 'IN',
});

const health = await jrx.http.get('/api/jrx/health');
```

Published semver line: **`@jurexio/client-sdk@5.0.0`**.

## Packages

| Package | Purpose |
|---------|---------|
| `@jurexio/client-sdk` | Gateway REST (`JrxClient`) |
| `@jurexio/types` | Shared TypeScript types |
| `@jurexio/enterprise-sdk` | Enterprise orchestration helpers |
| `@jurexio/mcp-server` | MCP tools over `JrxClient` |
| `@jurexio/docparse-sdk` | Internal/private — use gateway docparse routes from SPAs |

## Quickstart example

`examples/nsp-web-quickstart` — Next.js BFF proxy at `/api/jrx-proxy/*` → gateway `/api/jrx/*` (API key server-side only).
