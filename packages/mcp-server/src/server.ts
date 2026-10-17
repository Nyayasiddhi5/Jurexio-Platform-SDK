/**
 * MCP server factory — stdio (default) and optional SSE transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServerConfig } from './config.js';
import { resolveAllowedToolIds } from './allowlist.js';
import { filterCuratedTools, type CuratedToolDef } from './curated-tools.js';
import { ToolExecutor } from './executor.js';
import { AuditLogger } from './audit-log.js';

export interface JrxMcpServerOptions {
  config: McpServerConfig;
}

export function createJrxMcpServer(options: JrxMcpServerOptions): {
  server: Server;
  tools: CuratedToolDef[];
  executor: ToolExecutor;
  audit: AuditLogger;
} {
  const { config } = options;
  const audit = new AuditLogger(config.auditLogPath);
  const allowed = resolveAllowedToolIds(config.sku, config.allowlist, config.enableHitl);
  const tools = filterCuratedTools(allowed);
  const executor = new ToolExecutor(config);

  const server = new Server(
    {
      name: 'jurexio-mcp-server',
      version: '5.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    audit.log({
      event: 'tool_list',
      toolId: '*',
      sku: config.sku,
      ok: true,
    });
    return {
      tools: tools.map((t) => ({
        name: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolId = request.params.name;
    const tool = tools.find((t) => t.id === toolId);
    const started = Date.now();

    if (!tool) {
      audit.log({
        event: 'tool_error',
        toolId,
        sku: config.sku,
        ok: false,
        error: 'tool_not_allowed',
      });
      return {
        content: [{ type: 'text', text: `Tool not allowed or unknown: ${toolId}` }],
        isError: true,
      };
    }

    try {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const result = await executor.execute(tool, args);
      audit.log({
        event: 'tool_call',
        toolId,
        sku: config.sku,
        ok: true,
        latencyMs: Date.now() - started,
      });
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      audit.log({
        event: 'tool_error',
        toolId,
        sku: config.sku,
        ok: false,
        latencyMs: Date.now() - started,
        error: message,
      });
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return { server, tools, executor, audit };
}

export async function runStdioServer(config: McpServerConfig): Promise<void> {
  const { server } = createJrxMcpServer({ config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function runSseServer(config: McpServerConfig): Promise<void> {
  const { server } = createJrxMcpServer({ config });
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${config.sseHost}:${config.ssePort}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => {
        transports.delete(transport.sessionId);
      });
      await server.connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400).end('Missing sessionId');
        return;
      }
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404).end('Unknown session');
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.ssePort, config.sseHost, () => resolve());
    httpServer.on('error', reject);
  });

  process.stderr.write(
    `[jurexio-mcp-server] SSE listening on http://${config.sseHost}:${config.ssePort}/sse (${createJrxMcpServer({ config }).tools.length} tools)\n`,
  );
}

export async function startMcpServer(config: McpServerConfig): Promise<void> {
  if (config.transport === 'sse') {
    await runSseServer(config);
    return;
  }
  await runStdioServer(config);
}
