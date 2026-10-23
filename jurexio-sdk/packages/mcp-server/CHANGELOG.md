# Changelog — @jurexio/mcp-server

All notable changes to this package are documented here.

## [5.0.0] — 2026-07-14

### Added

- Initial GA release aligned with `@jurexio/client-sdk` **5.0.0**.
- stdio MCP transport via official `@modelcontextprotocol/sdk`.
- Optional SSE transport (`JRX_MCP_TRANSPORT=sse`, `--sse`).
- Curated executable tool set (~35 tools) covering Queen orchestrate, NYS knowledge plane, legal-work, RAG, citations/hallucination checks, scoped memory, EDJ, and gated HITL.
- SKU allowlists: `JRX_MCP_SKU=nsp|nym|jrx|full` and env override `JRX_MCP_ALLOWLIST`.
- Structured JSON audit log to stderr or `JRX_MCP_AUDIT_LOG` file path.
- CLI: `jurexio-mcp-server` / `npx @jurexio/mcp-server` with `--list-tools`, `--help`.
- Unit smoke tests (catalog non-empty, mocked gateway invoke).

### Gateway (JRX)

- Partner MCP protocols path accepts `agents:*` / `research:*` / `intelligence:*` scope aliases for list+invoke (NV-MCP-PARTNER-AUTH-001).
- Console JWT internal scopes extended with `protocols:*` and `workflows:*`.
