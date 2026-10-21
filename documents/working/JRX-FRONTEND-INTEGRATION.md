# JRX external frontend integration (SDK key + CORS)

**Product:** Jurexio Enterprise Platform  
**Gateway prefix:** `/api/jrx/`  
**Production origin:** `https://jurexio.nyayasiddhi.online`

See also: [JUREXIO-ENTERPRISE-SDK.md](./JUREXIO-ENTERPRISE-SDK.md), OpenAPI at `/api/jrx/openapi.json`.

---

## TypeScript SDK

```ts
import { JrxClient } from '@jurexio/client-sdk';

const jrx = new JrxClient({
  apiKey: process.env.JRX_SDK_KEY!, // server-side only in production SPAs
  baseUrl: 'https://jurexio.nyayasiddhi.online',
  apiPathPrefix: '/api/jrx', // convention; methods already use full paths
});

await jrx.healthCheck();
await jrx.orchestrate({ prompt: 'Summarize force majeure under Indian contract law.' });
await jrx.orchestrate.stream({ prompt: '…' }, { onTextDelta: (d) => process.stdout.write(d) });
```

Package line: **`@jurexio/client-sdk@5.0.0`** with **`@jurexio/types@5.0.0`** and **`@jurexio/enterprise-sdk@5.0.0`** (`peerDependencies`).

---

## Authentication modes

### SDK key (partner / headless frontend)

Used for almost all AI and document routes exposed to integrators.

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <JRX_SDK_KEY_*>` |
| `X-API-Key` | Same key (either header is accepted by `sdkGatewayAuth`) |

Optional partner headers (when documented for your app): `X-JRX-Platform`, `X-JRX-SDK-Version`, `X-Customer-Org-Id`, `x-jrx-jurisdiction` (ISO jurisdiction code: IN, US, UK, EU, SG, GC).

**GRPO feedback (SDK key):** `POST /api/jrx/v1/sdk/optimization/grpo/preferences` with `{ prompt, chosen, rejected }`.

**A2A production:** set `A2A_HMAC_SECRET` on gateway (see `env.production.jurexio.example`).

**Browser rule:** do not embed long-lived `sk_live` keys in client bundles. Use a **backend-for-frontend** proxy (see `examples/nsp-web-quickstart`) or mint short-lived tokens from your server.

### JWT session (hosted console only)

Console login (`POST /api/auth/login`) sets a session cookie / bearer JWT used by:

- `/api/jrx/auth/me`, most `/api/jrx/admin/*`, RBAC-gated dashboards
- `/api/jrx/legal-chat/*` (superadmin / allocated SME)
- `/api/jrx/credits/*` wallet endpoints (user-scoped ledger)

External SPAs on another origin should **not** rely on console JWT unless you operate a first-party console fork on the same auth domain.

---

## CORS

Gateway CORS is allowlist-based in production (not `*` when credentials are used).

| Variable | Role |
|----------|------|
| `CORS_ORIGINS` | Comma-separated allowed browser origins (primary; also read as `ALLOWED_ORIGINS` in `cors-config.ts`) |
| `JRX_CORS_ORIGINS` | JRX bootstrap alias mapped to the same allowlist in `jrx-env-bootstrap.ts` / scale config |
| `NV_PUBLIC_CORS` | When `true`, allows any origin **without** credentials (rare; dev/demo only) |
| `CORS_MAX_AGE` / `JRX_CORS_MAX_AGE` | Preflight cache seconds (default 86400) |

**Recommended production values** (adjust if your SPA host differs):

```env
CORS_ORIGINS=https://jurexio.nyayasiddhi.online,https://your-partner-spa.example
JRX_CORS_ORIGINS=https://jurexio.nyayasiddhi.online,https://your-partner-spa.example
```

**Local dev:**

```env
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5010
```

If the browser receives `CORS_BLOCKED`, the origin is not on the gateway allowlist — fix env on EC2/SSM, redeploy, and retry preflight.

---

## Route class → auth → frontend use case

| Route class | Example paths | Auth | Frontend use case |
|-------------|---------------|------|-------------------|
| Health / OpenAPI | `/api/jrx/health`, `/api/jrx/openapi.json` | None / public | Startup probes, codegen |
| Queen orchestration | `/api/jrx/orchestrate`, `/api/jrx/orchestrate/stream` | SDK key | Primary legal AI chat, agents |
| Agent registry | `/api/jrx/agents/*`, `/api/jrx/gateway/agents/*` | SDK key | Agent picker, execute |
| Universal chat testbed | `/api/chat/*` | SDK key or JWT | Multi-turn LRM chat UI |
| Console legal chat | `/api/jrx/legal-chat/*` | JWT + SME RBAC | Console fork only |
| Legal work | `/api/jrx/legal-work/*` | SDK key | Async tasks + chat conversations |
| Documents | `/api/jrx/documents/*`, `/api/jrx/doc-analyze/*` | SDK key | Upload, analyze, RAG |
| Partner intelligence | `/api/jrx/v1/sdk/intelligence/*`, `/api/jrx/intelligence/*` | SDK key | Risk, NER, research |
| Docparse jobs | `/api/jrx/v1/sdk/docparse/*` | SDK key | Structured doc intelligence |
| MCP tools | `/api/jrx/tools/mcp/*` | SDK key (+ role) | Tooling panels |
| Credits (user wallet) | `/api/jrx/credits/*` | JWT | Console billing UI |
| Usage (partner) | `/api/jrx/gateway/usage` | SDK key | Quota dashboards |
| Console admin | `/api/jrx/admin/*`, `/api/jrx/auth/me` | JWT | Hosted console only |

---

## NPM packages

| Package | Version line | Notes |
|---------|--------------|--------|
| `@jurexio/client-sdk` | 5.0.0 | `JrxClient` — use from Node or via BFF proxy |
| `@jurexio/types` | 5.0.0 | Shared types |
| `@jurexio/enterprise-sdk` | 5.0.0 | Enterprise helpers; peers `client-sdk ^5.0.0` |
| `@jurexio/mcp-server` | 5.0.0 | MCP wrapper over `JrxClient` |

`@jurexio/docparse-sdk` remains **private**; call gateway docparse routes instead.

---

## Ops smoke (partner matrix)

Requires `env.production.jurexio` (deploy IAM) for EC2 SSM targets. Logs **HTTP codes and latency only** — never secret values.

| Command | Purpose |
|---------|---------|
| `npm run partner:smoke:local` | Probes `JRX_SMOKE_BASE_URL` (default `http://127.0.0.1:5000`); set `JRX_SDK_KEY_NSP` for keyed probes |
| `npm run partner:smoke:ec2` | SSM on `JRX_EC2_INSTANCE_ID` (`i-0fb470b236c14405b`); reads keys on-host under `/opt/Jurexio/secrets/.env.production` |
| `npm run demo:probe:ec2` | SSM crosscheck: health, key lens, docparse/LLM/orchestrate HTTP codes |
| `npm run sdk:matrix:ec2` | Alias for partner smoke with `NV_TARGET=ec2` |

Public URL smoke without keys:

```bash
JRX_SMOKE_BASE_URL=https://jurexio.nyayasiddhi.online NV_TARGET=local npm run partner:smoke:local
```

Expect `health http=200`; keyed probes `SKIP no_key` until `JRX_SDK_KEY_NSP` is set locally or on EC2.
