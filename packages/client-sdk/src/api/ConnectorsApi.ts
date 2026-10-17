/**
 * ConnectorsApi — Legaltech MCP integration connectors for ecosystem SDKs.
 * Wraps /api/jrx/mcp/connectors/*
 */
import type { NyvHttpClient } from '../NyvClient.js';

export interface ConnectorDescriptor {
  id: string;
  name: string;
  category: string;
  authType: string;
  status: string;
  mcpToolIds: string[];
  connectPath: string;
  description: string;
}

export class ConnectorsApi {
  constructor(private readonly http: NyvHttpClient) {}

  list(): Promise<{ connectors: ConnectorDescriptor[]; stats: Record<string, unknown> }> {
    return this.http.get('/api/jrx/mcp/connectors').then((r: any) => r.data ?? r);
  }

  get(connectorId: string): Promise<ConnectorDescriptor> {
    return this.http.get(`/api/jrx/mcp/connectors/${encodeURIComponent(connectorId)}`).then((r: any) => r.data ?? r);
  }

  connect(connectorId: string, credentials?: Record<string, unknown>): Promise<unknown> {
    return this.http.post(`/api/jrx/mcp/connectors/${encodeURIComponent(connectorId)}/connect`, credentials ?? {});
  }

  disconnect(connectorId: string): Promise<unknown> {
    return this.http.post(`/api/jrx/mcp/connectors/${encodeURIComponent(connectorId)}/disconnect`, {});
  }

  health(connectorId: string): Promise<unknown> {
    return this.http.get(`/api/jrx/mcp/connectors/${encodeURIComponent(connectorId)}/health`).then((r: any) => r.data ?? r);
  }

  invoke(connectorId: string, action: string, input?: unknown): Promise<unknown> {
    return this.http.post(`/api/jrx/mcp/connectors/${encodeURIComponent(connectorId)}/invoke`, { action, input });
  }
}
