/**
 * McpApi — Model Context Protocol tool invocation for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/tools/mcp/list, /api/jrx/tools/mcp/invoke,
 *        /api/jrx/v1/mcp/tools/:toolId/execute
 *
 * NV-MCP-SSOT-EXEC-001: `invoke()` and `execute()` share the canonical,
 * transport-agnostic MCP executor server-side. Requires a `developer`+ role.
 */

import type { JrxHttpClient } from '../JrxClient.js';

export interface McpToolDescriptor {
  id: string;
  name?: string;
  category?: string;
  /** True when the tool has a real server-side implementation (not catalog-only). */
  executable?: boolean;
  [k: string]: unknown;
}

export interface McpToolListResponse {
  tools: McpToolDescriptor[];
  total: number;
  executableTotal: number;
  catalogTotal: number;
  categories: string[];
  jurisdictions: string[];
}

export interface McpExecutionResult {
  found: boolean;
  executionId: string;
  toolId: string;
  toolName?: string;
  result: unknown;
  latencyMs: number;
  [k: string]: unknown;
}

export class McpApi {
  constructor(private readonly http: JrxHttpClient) {}

  /** List MCP tools with executable-vs-catalog annotations. `GET /api/jrx/tools/mcp/list`. */
  listTools(): Promise<McpToolListResponse> {
    return this.http.get('/api/jrx/tools/mcp/list');
  }

  /**
   * Invoke an MCP tool by id. `POST /api/jrx/tools/mcp/invoke`.
   * Requires a `developer`+ role.
   */
  invoke(toolId: string, input?: unknown, sessionId?: string): Promise<McpExecutionResult> {
    return this.http.post('/api/jrx/tools/mcp/invoke', { toolId, input, sessionId });
  }

  /**
   * Canonical execute path (equivalent to `invoke`, path-param form).
   * `POST /api/jrx/v1/mcp/tools/:toolId/execute`. Requires a `developer`+ role.
   */
  execute(toolId: string, input?: unknown, sessionId?: string): Promise<McpExecutionResult> {
    return this.http.post(`/api/jrx/v1/mcp/tools/${encodeURIComponent(toolId)}/execute`, { input, sessionId });
  }
}
