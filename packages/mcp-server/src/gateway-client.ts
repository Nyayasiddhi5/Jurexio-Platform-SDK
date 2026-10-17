/**
 * Partner gateway MCP protocols client — list + invoke via SDK workflows path.
 */

export interface GatewayMcpListResponse {
  success: boolean;
  data?: {
    tools?: Array<{ id: string; executable?: boolean; [k: string]: unknown }>;
    executableTotal?: number;
    catalogTotal?: number;
  };
  error?: string;
}

export interface GatewayMcpInvokeResponse {
  success: boolean;
  data?: {
    result?: unknown;
    canonicalToolId?: string;
    executable?: boolean;
    latencyMs?: number;
    [k: string]: unknown;
  };
  error?: string;
}

export class GatewayMcpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'X-NYV-SDK-Version': '5.0.0',
      'X-NYV-Platform': 'mcp-server',
    };
  }

  async listTools(): Promise<GatewayMcpListResponse> {
    const res = await fetch(`${this.baseUrl}/api/jrx/sdk/workflows/protocols/mcp/tools`, {
      method: 'GET',
      headers: this.headers(),
    });
    return res.json() as Promise<GatewayMcpListResponse>;
  }

  async invokeTool(
    toolName: string,
    parameters: Record<string, unknown> = {},
    context: Record<string, unknown> = {},
  ): Promise<GatewayMcpInvokeResponse> {
    const res = await fetch(`${this.baseUrl}/api/jrx/sdk/workflows/protocols/mcp/tools/invoke`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ toolName, parameters, context }),
    });
    return res.json() as Promise<GatewayMcpInvokeResponse>;
  }
}
