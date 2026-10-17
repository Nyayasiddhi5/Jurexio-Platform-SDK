# `@jurexio/mcp-server`

Standalone **Model Context Protocol (MCP)** server for Jurexio ecosystem platforms (NSP, NYM, JRX, and future partners). Wraps `@jurexio/client-sdk` and the partner gateway MCP invoke path — **not** the full 500+ catalog stubs.

| | |
|---|---|
| Package | `@jurexio/mcp-server` |
| Version | **5.0.0** (aligned with client-sdk lock) |
| Transport | stdio (default) + optional SSE |
| Min Node | 22.x |

---

## Install

```bash
npm install @jurexio/mcp-server @jurexio/client-sdk
```

Monorepo dev:

```bash
cd nyayavigya-platform-312/packages/mcp-server
npm install
npm run build
```

---

## Environment

| Variable | Required | Description |
|---|---|---|
| `JRX_API_KEY` | **Yes** | SDK API key (`X-API-Key`) |
| `JRX_BASE_URL` | No | Gateway base URL (default: `https://api.jurexio.example`) |
| `JRX_MCP_SKU` | No | `nsp` \| `nym` \| `jrx` \| `full` (default: `full`) |
| `JRX_MCP_ALLOWLIST` | No | Comma-separated tool id override |
| `JRX_MCP_AUDIT_LOG` | No | File path for JSON audit lines (default: stderr) |
| `JRX_MCP_ENABLE_HITL` | No | Set `1` or `true` to expose HITL tools |
| `JRX_MCP_TRANSPORT` | No | `stdio` (default) or `sse` |
| `JRX_MCP_SSE_HOST` | No | SSE bind host (default: `127.0.0.1`) |
| `JRX_MCP_SSE_PORT` | No | SSE port (default: `8787`) |

---

## Run

**stdio (Cursor / Claude Desktop):**

```bash
export JRX_API_KEY=nyv_live_sk_...
export JRX_MCP_SKU=nsp
npx @jurexio/mcp-server
# or
node nyayavigya-platform-312/packages/mcp-server/dist/bin.js
```

**List curated tools for a SKU:**

```bash
JRX_API_KEY=nyv_live_sk_... JRX_MCP_SKU=nym npx @jurexio/mcp-server --list-tools
```

**SSE (optional remote attach):**

```bash
JRX_MCP_TRANSPORT=sse JRX_MCP_SSE_PORT=8787 npx @jurexio/mcp-server --sse
# Connect MCP client to GET http://127.0.0.1:8787/sse
```

### Cursor `mcp.json` example

```json
{
  "mcpServers": {
    "nyayavigya": {
      "command": "npx",
      "args": ["-y", "@jurexio/mcp-server"],
      "env": {
        "JRX_API_KEY": "nyv_live_sk_...",
        "JRX_BASE_URL": "https://api.jurexio.example",
        "JRX_MCP_SKU": "nsp"
      }
    }
  }
}
```

---

## Curated tool surface

Executable-only tools (~35 full SKU, fewer per platform SKU):

| Category | Tool ids (sample) |
|---|---|
| Queen / orchestrate | `nyv_orchestrate` |
| NYS knowledge plane | `nys_search_caselaw`, `nys_search_statutes`, `nys_get_statute`, `nys_retrieve`, `nys_athena_search`, … |
| Legal work | `nyv_legal_work_create_run`, `nys_perform_legal_work`, `nys_chat_action` |
| RAG | `nyv_rag_query`, `rag_namespace_search` |
| Citations / hallucination | `citation_verify`, `nys_check_citations`, `nyv_hallucination_check` |
| Memory (scoped) | `nyv_memory_get_matter`, `nyv_memory_get_client` |
| Documents / EDJ | `nyv_edj_create_job`, `document_parse` |
| HITL (gated) | `nyv_hitl_create_request`, `nyv_hitl_decide` |

Gateway-backed tools call:

`POST /api/jrx/sdk/workflows/protocols/mcp/tools/invoke`

API-backed tools call typed NyvClient surfaces (`orchestrateApi`, `knowledge`, `legalWork`, `rag`, `gateway`, …).

---

## Audit log

Each `tools/list` and `tools/call` emits a structured JSON line:

```json
{"ts":"2026-07-14T09:00:00.000Z","event":"tool_call","toolId":"nys_retrieve","sku":"nsp","ok":true,"latencyMs":842}
```

Set `JRX_MCP_AUDIT_LOG=/var/log/nyv-mcp-audit.jsonl` to persist to disk.

---

## Auth / scopes

Partner API keys need **`protocols:read` / `protocols:write`**, or the gateway accepts these aliases for MCP list/invoke:

- read: `agents:read`, `research:read`, `intelligence:read`
- write: `agents:execute`, `research:write`, `intelligence:write`

Console JWT paths receive explicit `protocols:*` and `workflows:*` via the SDK gateway internal scope map.

---

## Test

```bash
cd packages/mcp-server && npm test
```

---

## License

PROPRIETARY — Jurexio Technology Pvt Ltd
