/**
 * Unit smoke tests — curated tool list + mocked gateway invoke.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filterCuratedTools, CURATED_TOOLS } from '../../src/curated-tools.js';
import { resolveAllowedToolIds, SKU_TOOL_SETS } from '../../src/allowlist.js';
import { GatewayMcpClient } from '../../src/gateway-client.js';
import { createNyvMcpServer } from '../../src/server.js';
import type { McpServerConfig } from '../../src/config.js';

const BASE_CONFIG: McpServerConfig = {
  baseUrl: 'https://api.example.test',
  apiKey: 'nyv_test_sk_mock_key_for_unit_tests_only',
  sku: 'full',
  allowlist: null,
  auditLogPath: null,
  enableHitl: false,
  transport: 'stdio',
  sseHost: '127.0.0.1',
  ssePort: 8787,
};

describe('@jurexio/mcp-server', () => {
  describe('curated catalog', () => {
    it('exports a non-empty executable tool set', () => {
      expect(CURATED_TOOLS.length).toBeGreaterThan(20);
      const full = filterCuratedTools(resolveAllowedToolIds('full', null, false));
      expect(full.length).toBeGreaterThan(25);
      expect(full.some((t) => t.id === 'nyv_orchestrate')).toBe(true);
      expect(full.some((t) => t.id === 'nys_retrieve')).toBe(true);
    });

    it('SKU allowlists are subsets of the full catalog', () => {
      const allIds = new Set(CURATED_TOOLS.map((t) => t.id));
      for (const sku of ['nsp', 'nym', 'jrx'] as const) {
        for (const id of SKU_TOOL_SETS[sku]) {
          expect(allIds.has(id), `${sku} references unknown tool ${id}`).toBe(true);
        }
      }
    });

    it('gates HITL tools unless JRX_MCP_ENABLE_HITL', () => {
      const without = resolveAllowedToolIds('full', null, false);
      const withHitl = resolveAllowedToolIds('full', null, true);
      expect(without.has('nyv_hitl_create_request')).toBe(false);
      expect(withHitl.has('nyv_hitl_create_request')).toBe(true);
    });
  });

  describe('GatewayMcpClient', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('lists tools via protocols path', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { tools: [{ id: 'citation_verify', executable: true }], executableTotal: 1 },
        }),
      });

      const client = new GatewayMcpClient(BASE_CONFIG.baseUrl, BASE_CONFIG.apiKey);
      const resp = await client.listTools();

      expect(resp.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_CONFIG.baseUrl}/api/jrx/sdk/workflows/protocols/mcp/tools`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'X-API-Key': BASE_CONFIG.apiKey }),
        }),
      );
    });

    it('invokes tools via protocols path with mocked HTTP', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { result: { verified: true }, canonicalToolId: 'citation_verify', latencyMs: 12 },
        }),
      });

      const client = new GatewayMcpClient(BASE_CONFIG.baseUrl, BASE_CONFIG.apiKey);
      const resp = await client.invokeTool('citation_verify', { citation: 'AIR 2020 SC 1' });

      expect(resp.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_CONFIG.baseUrl}/api/jrx/sdk/workflows/protocols/mcp/tools/invoke`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            toolName: 'citation_verify',
            parameters: { citation: 'AIR 2020 SC 1' },
            context: {},
          }),
        }),
      );
    });
  });

  describe('MCP server factory', () => {
    it('registers listable tools for nym SKU', () => {
      const { tools } = createNyvMcpServer({
        config: { ...BASE_CONFIG, sku: 'nym' },
      });
      expect(tools.length).toBeGreaterThan(5);
      expect(tools.map((t) => t.id)).toContain('nys_chat_action');
      expect(tools.map((t) => t.id)).not.toContain('nyv_edj_create_job');
    });
  });
});
