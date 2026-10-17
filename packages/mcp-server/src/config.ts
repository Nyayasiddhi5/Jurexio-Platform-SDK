/**
 * Environment configuration for @jurexio/mcp-server
 */

export type McpSku = 'nsp' | 'nym' | 'jrx' | 'full';
export type McpTransport = 'stdio' | 'sse';

export interface McpServerConfig {
  baseUrl: string;
  apiKey: string;
  sku: McpSku;
  allowlist: string[] | null;
  auditLogPath: string | null;
  enableHitl: boolean;
  transport: McpTransport;
  sseHost: string;
  ssePort: number;
  platformClient?: string;
}

function parseAllowlist(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : null;
}

function parseSku(raw: string | undefined): McpSku {
  const v = (raw ?? 'full').toLowerCase();
  if (v === 'nsp' || v === 'nym' || v === 'jrx' || v === 'full') return v;
  throw new Error(`Invalid JRX_MCP_SKU="${raw}". Expected nsp|nym|jrx|full.`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const baseUrl = (env.JRX_BASE_URL ?? 'https://api.jurexio.example').replace(/\/$/, '');
  const apiKey = env.JRX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('JRX_API_KEY is required. Set your Jurexio Enterprise Platform SDK API key.');
  }

  return {
    baseUrl,
    apiKey,
    sku: parseSku(env.JRX_MCP_SKU),
    allowlist: parseAllowlist(env.JRX_MCP_ALLOWLIST),
    auditLogPath: env.JRX_MCP_AUDIT_LOG?.trim() || null,
    enableHitl: env.JRX_MCP_ENABLE_HITL === '1' || env.JRX_MCP_ENABLE_HITL === 'true',
    transport: env.JRX_MCP_TRANSPORT === 'sse' ? 'sse' : 'stdio',
    sseHost: env.JRX_MCP_SSE_HOST ?? '127.0.0.1',
    ssePort: Number(env.JRX_MCP_SSE_PORT ?? 8787),
    platformClient: env.JRX_MCP_PLATFORM_CLIENT?.trim() || undefined,
  };
}
