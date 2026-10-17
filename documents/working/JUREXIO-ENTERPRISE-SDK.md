# Jurexio Enterprise SDK — integration guide

**Product:** Jurexio Enterprise Platform (global).  
**Do not use:** Nyayasiddhi URLs, `NYV_SDK_KEY_*`, or legacy NYV partner JRX keys for Enterprise.

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://127.0.0.1:5010` |
| Staging | `https://api.staging.jurexio.example` (set at deploy) |

All routes: **`/api/jrx/v1/...`**

## TypeScript SDK

```ts
import { JrxClient } from '@jurexio/client-sdk';

const jrx = new JrxClient({
  apiKey: process.env.JRX_SDK_KEY!,
  baseUrl: process.env.JRX_PUBLIC_API_URL!,
  apiPathPrefix: '/api/jrx',
  jurisdiction: 'US',
});

const health = await jrx.http.get('/api/jrx/health');
```

## Packages

| Package | Purpose |
|---------|---------|
| `@jurexio/client-sdk` | Gateway REST |
| `@jurexio/enterprise-sdk` | Enterprise orchestration helpers |
| `@jurexio/docparse-sdk` | Document understanding (US/global packs) |
| `@jurexio/mcp-server` | MCP tools |

## Legacy NYV partner JRX

Integrators on **Nyayavigya** gateway remain on `/api/nv/` — see upstream NYV docs in `archive/upstream-nyv/` (reference only).
