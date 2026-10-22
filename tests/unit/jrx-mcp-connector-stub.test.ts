import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { nvMcpConnectorService } from '../../src/services/mcp/jrx-mcp-connector-service.js';

describe('jrx-mcp-connector-service stub honesty', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot, NODE_ENV: 'production', JRX_MCP_STUBS_DISABLED: '1' };
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it('lists OAuth catalog connectors as not_implemented', () => {
    const listed = nvMcpConnectorService.listConnectors('org-test');
    const drive = listed.find(c => c.id === 'google-drive');
    expect(drive?.implementationStatus).toBe('stub');
    expect(drive?.status).toBe('not_implemented');
  });

  it('refuses connect on stub connectors', async () => {
    const result = await nvMcpConnectorService.connect('google-drive', 'org-test', { accessToken: 'fake' });
    expect(result.success).toBe(false);
    expect(result.status).toBe('stub_not_implemented');
  });

  it('invoke returns stub_not_implemented (never ok) for stub tools', async () => {
    const result = await nvMcpConnectorService.invoke('google-drive', 'list', {}, 'org-test');
    expect(result.status).toBe('stub_not_implemented');
    expect(result.note).toMatch(/implementationStatus=stub/);
  });

  it('healthCheck marks stub connectors unhealthy', async () => {
    const health = await nvMcpConnectorService.healthCheck('slack', 'org-test');
    expect(health.healthy).toBe(false);
    expect(health.implementationStatus).toBe('stub');
  });
});
