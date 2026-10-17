/**
 * Execute curated MCP tools via NyvClient APIs or gateway MCP invoke.
 */

import { NyvClient } from '@jurexio/client-sdk';
import type { McpServerConfig } from './config.js';
import type { CuratedToolDef } from './curated-tools.js';
import { GatewayMcpClient } from './gateway-client.js';

export class ToolExecutor {
  private readonly nyv: NyvClient;
  private readonly gateway: GatewayMcpClient;

  constructor(private readonly config: McpServerConfig) {
    this.nyv = new NyvClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      platformClient: config.platformClient,
      version: '5.0.0',
    });
    this.gateway = new GatewayMcpClient(config.baseUrl, config.apiKey);
  }

  async execute(tool: CuratedToolDef, args: Record<string, unknown>): Promise<unknown> {
    if (tool.kind === 'gateway-mcp') {
      const toolName = tool.gatewayToolId ?? tool.id;
      const resp = await this.gateway.invokeTool(toolName, args);
      if (!resp.success) {
        throw new Error(resp.error ?? `Gateway MCP invoke failed for ${toolName}`);
      }
      return resp.data ?? { ok: true };
    }

    switch (tool.id) {
      case 'nyv_orchestrate':
        return this.nyv.orchestrateApi.run({
          prompt: String(args.prompt),
          jurisdiction: args.jurisdiction as never,
          agentKey: args.agentKey as string | undefined,
          enableRAG: args.enableRAG as boolean | undefined,
          enableMemory: args.enableMemory as boolean | undefined,
          enableCitationVerification: args.enableCitationVerification as boolean | undefined,
          enableHallucinationCheck: args.enableHallucinationCheck as boolean | undefined,
          enableHITL: args.enableHITL as boolean | undefined,
          sessionId: args.sessionId as string | undefined,
          matterId: args.matterId as string | undefined,
        });

      case 'nyv_knowledge_search':
        return this.nyv.knowledge.search({
          query: String(args.query),
          jurisdiction: (args.jurisdiction as never) ?? 'IN',
          limit: Number(args.limit ?? 10),
          searchMode: (args.searchMode as never) ?? 'hybrid',
        });

      case 'nyv_knowledge_retrieve':
        return this.nyv.knowledge.retrieve({
          query: String(args.query),
          jurisdiction: args.jurisdiction as string | undefined,
        });

      case 'nyv_legal_work_create_run':
        return this.nyv.legalWork.createRun({
          instruction: String(args.instruction),
          context: args.context as string | undefined,
          jurisdiction: args.jurisdiction as string | undefined,
          taskId: args.taskId as string | undefined,
        });

      case 'nyv_legal_work_get_run':
        return this.nyv.legalWork.getRun(String(args.runId));

      case 'nyv_rag_query':
        return this.nyv.rag.query(String(args.query), {
          jurisdiction: args.jurisdiction as never,
          namespace: args.namespace as string | undefined,
          topK: args.topK as number | undefined,
          raw: args.raw as boolean | undefined,
        });

      case 'nyv_verify_citations':
        return this.nyv.gateway.verifyCitations(
          String(args.outputText),
          args.jurisdiction as never,
        );

      case 'nyv_hallucination_check':
        return this.nyv.gateway.checkHallucination(String(args.outputText), {
          inputText: args.inputText as string | undefined,
          agentKey: args.agentKey as string | undefined,
          jurisdiction: args.jurisdiction as never,
        });

      case 'nyv_memory_get_matter':
        return this.nyv.memory.getMatter(String(args.matterId));

      case 'nyv_memory_get_client':
        return this.nyv.memory.getClient(String(args.clientId));

      case 'nyv_edj_create_job':
        return this.nyv.ecosystemDocuments.createJob(args as never);

      case 'nyv_edj_get_job':
        return this.nyv.ecosystemDocuments.getJob(String(args.jobId));

      case 'nyv_hitl_create_request':
        return this.nyv.orchestrateApi.run({
          prompt: `[HITL] ${String(args.title)}: ${String(args.description)}`,
          enableHITL: true,
          jurisdiction: (args.jurisdiction as never) ?? 'IN',
          preferences: {
            hitlPayload: args.payload ?? {},
            hitlPriority: args.priority ?? 'normal',
            hitlSource: 'mcp-server',
          },
        });

      case 'nyv_hitl_decide':
        return this.postJson(
          `/api/jrx/my-approvals/${encodeURIComponent(String(args.requestId))}/decision`,
          {
            decision: args.decision,
            comment: args.comment ?? '',
            source: 'mcp-server',
          },
        );

      case 'nyv_templates_catalog':
        return this.nyv.templates.catalog({
          practiceArea: args.practiceArea as string | undefined,
          jurisdiction: (args.jurisdiction as string | undefined) ?? 'IN',
          limit: Number(args.limit ?? 50),
        } as never);

      case 'nyv_templates_fill':
        return this.nyv.templates.generate(
          String(args.templateId),
          (args.variables as Record<string, unknown>) ?? {},
        );

      default:
        throw new Error(`No API handler registered for tool ${tool.id}`);
    }
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        Authorization: `Bearer ${this.config.apiKey}`,
        'X-NYV-SDK-Version': '5.0.0',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: string; message?: string }).error
        ?? (json as { message?: string }).message
        ?? res.statusText;
      throw new Error(String(msg));
    }
    return json;
  }
}
