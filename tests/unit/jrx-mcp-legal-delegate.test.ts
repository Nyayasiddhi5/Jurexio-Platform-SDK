import { describe, it, expect } from 'vitest';
import { isDelegatedMcpTool, DELEGATED_MCP_TOOL_IDS } from '../../src/services/mcp/jrx-mcp-legal-delegate.js';
import { LEGALTECH_CONNECTORS, MCP_TOOL_TO_CONNECTOR } from '../../src/data/jrx-mcp-connector-catalog.js';
import { EXECUTABLE_MCP_TOOL_IDS } from '../../src/data/jrx-mcp-tools-registry.js';

describe('./jrx-mcp-legal-delegate', () => {
  it('delegated tool IDs are marked executable in registry SSOT', () => {
    for (const id of DELEGATED_MCP_TOOL_IDS) {
      expect(EXECUTABLE_MCP_TOOL_IDS.has(id)).toBe(true);
    }
  });

  it('connector MCP tools map to connector catalog', () => {
    expect(LEGALTECH_CONNECTORS.length).toBeGreaterThanOrEqual(20);
    for (const toolId of ['google_drive_list', 'slack_post_message', 'aws_s3_list']) {
      expect(isDelegatedMcpTool(toolId)).toBe(true);
      expect(MCP_TOOL_TO_CONNECTOR[toolId]).toBeTruthy();
    }
  });
});
