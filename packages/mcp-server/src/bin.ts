#!/usr/bin/env node
/**
 * @jurexio/mcp-server — CLI entry (stdio default, optional SSE).
 */

import { loadConfig } from './config.js';
import { startMcpServer } from './server.js';
import { filterCuratedTools } from './curated-tools.js';
import { resolveAllowedToolIds } from './allowlist.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`@jurexio/mcp-server v5.0.0

Usage:
  nyayavigya-mcp-server [--stdio|--sse] [--list-tools]

Environment:
  JRX_BASE_URL          Gateway base URL (default: https://api.jurexio.example)
  JRX_API_KEY           Required SDK API key (X-API-Key)
  JRX_MCP_SKU           nsp|nym|jrx|full (default: full)
  JRX_MCP_ALLOWLIST     Comma-separated tool id override
  JRX_MCP_AUDIT_LOG     Optional file path for JSON audit lines
  JRX_MCP_ENABLE_HITL   Set 1/true to expose HITL tools
  JRX_MCP_TRANSPORT     stdio|sse (default: stdio)
  JRX_MCP_SSE_HOST      SSE bind host (default: 127.0.0.1)
  JRX_MCP_SSE_PORT      SSE port (default: 8787)
`);
    return;
  }

  const config = loadConfig();

  if (args.includes('--sse')) {
    config.transport = 'sse';
  }
  if (args.includes('--stdio')) {
    config.transport = 'stdio';
  }

  if (args.includes('--list-tools')) {
    const allowed = resolveAllowedToolIds(config.sku, config.allowlist, config.enableHitl);
    const tools = filterCuratedTools(allowed);
    for (const t of tools) {
      process.stdout.write(`${t.id}\t${t.kind}\t${t.name}\n`);
    }
    process.stderr.write(`[nyayavigya-mcp-server] ${tools.length} curated tools (sku=${config.sku})\n`);
    return;
  }

  await startMcpServer(config);
}

main().catch((err) => {
  process.stderr.write(`[nyayavigya-mcp-server] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
