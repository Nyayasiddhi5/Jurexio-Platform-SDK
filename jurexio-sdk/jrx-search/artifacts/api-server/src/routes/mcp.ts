import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { searchIndianCaselaw, searchUsCaselaw, retrieveAuthorities } from "../lib/caselaw";
import { searchStatutes, getStatuteBySection, compareIpcToBns } from "../lib/statutes";
import { planAndRetrieve } from "../lib/retrievalRouter";
import { extractCitations } from "../lib/citations";
import { performLegalWork } from "../lib/agent";
import { runChatAction, type ChatActionMode, type OutputFormat } from "../lib/chatActions";
import { recordModelUsage } from "../middlewares/usage";
import type { ChatDocument } from "@workspace/db";

const router: IRouter = Router();

/**
 * Minimal MCP (Model Context Protocol) server over Streamable HTTP.
 * Implements the JSON-RPC 2.0 surface MCP clients require: initialize,
 * tools/list, tools/call, ping. Auth: Bearer MCP_TOKEN (required whenever
 * MCP_TOKEN is set; in production set it alongside AUTH_REQUIRED).
 */

const PROTOCOL_VERSION = "2025-03-26";

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const SearchCaselawArgs = z.object({
  query: z.string().min(2),
  jurisdiction: z.enum(["IN", "US"]).default("IN"),
  limit: z.number().int().min(1).max(20).default(10),
});

const SearchStatutesArgs = z.object({
  query: z.string().min(2),
  code: z.string().optional(),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

const GetStatuteArgs = z.object({
  code: z.string().min(2),
  section: z.string().min(1),
});

const CompareArgs = z.object({ ipcSection: z.string().min(1) });

const RetrieveArgs = z.object({
  query: z.string().min(2),
  jurisdiction: z.enum(["IN", "US"]).default("IN"),
});

const CheckCitationsArgs = z.object({ text: z.string().min(3) });

const PerformWorkArgs = z.object({
  instruction: z.string().min(10),
  context: z.string().optional(),
  jurisdiction: z.enum(["IN", "US"]).default("IN"),
});

const ChatActionArgs = z.object({
  action: z.enum(["chat", "summary", "extract", "case_details", "draft", "intelligence", "predictions"]),
  prompt: z.string().default(""),
  documentText: z.string().optional(),
  documentName: z.string().default("document.txt"),
  format: z.enum(["brief", "detailed"]).default("detailed"),
  jurisdiction: z.enum(["IN", "US"]).default("IN"),
});

const TOOLS: McpTool[] = [
  {
    name: "search_caselaw",
    description:
      "Search real court judgments. jurisdiction IN searches the Indian Supreme Court/High Court corpus; US searches CourtListener live.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (websearch syntax supported for IN)" },
        jurisdiction: { type: "string", enum: ["IN", "US"], default: "IN" },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
    },
    handler: async (raw) => {
      const args = SearchCaselawArgs.parse(raw);
      const res =
        args.jurisdiction === "US"
          ? await searchUsCaselaw({ q: args.query, limit: args.limit })
          : await searchIndianCaselaw({ q: args.query, limit: args.limit });
      return { total: res.total, results: res.results };
    },
  },
  {
    name: "search_statutes",
    description:
      "Full-text search over the statutes corpus (BNS, BNSS, BSA, IPC, USC provisions).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        code: { type: "string", description: "Optional statute code filter, e.g. BNS, IPC" },
        jurisdiction: { type: "string", enum: ["IN", "US"] },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
    },
    handler: async (raw) => {
      const args = SearchStatutesArgs.parse(raw);
      return searchStatutes({
        q: args.query,
        code: args.code,
        jurisdiction: args.jurisdiction,
        limit: args.limit,
      });
    },
  },
  {
    name: "get_statute",
    description: "Fetch the exact text of a statutory provision by code and section (e.g. BNS 103).",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Statute code: BNS, BNSS, BSA, IPC, USC" },
        section: { type: "string" },
      },
      required: ["code", "section"],
    },
    handler: async (raw) => {
      const args = GetStatuteArgs.parse(raw);
      const statute = await getStatuteBySection(args.code.toUpperCase(), args.section);
      if (!statute) return { found: false, statute: null };
      return { found: true, statute };
    },
  },
  {
    name: "compare_ipc_bns",
    description: "Compare an IPC section against its mapped BNS successor provisions with change notes.",
    inputSchema: {
      type: "object",
      properties: { ipcSection: { type: "string", description: "IPC section number, e.g. 302" } },
      required: ["ipcSection"],
    },
    handler: async (raw) => compareIpcToBns(CompareArgs.parse(raw).ipcSection),
  },
  {
    name: "retrieve",
    description:
      "Retrieval-first legal research router: extracts citations, looks up statutes, compares IPC/BNS, and searches caselaw — deterministically, without an LLM.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        jurisdiction: { type: "string", enum: ["IN", "US"], default: "IN" },
      },
      required: ["query"],
    },
    handler: async (raw) => {
      const args = RetrieveArgs.parse(raw);
      return planAndRetrieve({ query: args.query, jurisdiction: args.jurisdiction });
    },
  },
  {
    name: "check_citations",
    description: "Extract and normalize legal citations (IN and US formats) from a block of text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    handler: async (raw) => ({
      citations: extractCitations(CheckCitationsArgs.parse(raw).text),
    }),
  },
  {
    name: "perform_legal_work",
    description:
      "Run the NYS legal agent on a drafting/analysis instruction. Returns a complete formatted work product grounded in retrieved authorities. Slow (20-90s).",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string" },
        context: { type: "string" },
        jurisdiction: { type: "string", enum: ["IN", "US"], default: "IN" },
      },
      required: ["instruction"],
    },
    handler: async (raw) => {
      const args = PerformWorkArgs.parse(raw);
      const authorities = await retrieveAuthorities({
        query: args.instruction.slice(0, 160),
        limit: 5,
        jurisdiction: args.jurisdiction,
      }).catch(() => []);
      const workProduct = await performLegalWork({
        title: args.instruction.slice(0, 120),
        categoryName: "Custom Instruction",
        workType: "drafting",
        instruction: args.instruction,
        context: args.context ?? null,
        authorities,
      });
      return { workProduct, authorities };
    },
  },
  {
    name: "chat_action",
    description:
      "Run one of the Legal Chat AI actions (summary, extract, case_details, draft, intelligence, predictions, or free chat) on a prompt and/or inline document text. Returns the formatted answer plus structured data for extraction-style actions. Slow (10-60s).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["chat", "summary", "extract", "case_details", "draft", "intelligence", "predictions"],
          description: "Which chat action mode to run",
        },
        prompt: { type: "string", description: "The user ask; may be empty for document-driven actions" },
        documentText: { type: "string", description: "Optional inline document text to analyze" },
        documentName: { type: "string", default: "document.txt" },
        format: { type: "string", enum: ["brief", "detailed"], default: "detailed" },
        jurisdiction: { type: "string", enum: ["IN", "US"], default: "IN" },
      },
      required: ["action"],
    },
    handler: async (raw) => {
      const args = ChatActionArgs.parse(raw);
      if (!args.prompt && !args.documentText) {
        throw new Error("Provide a prompt, documentText, or both.");
      }
      const documents: ChatDocument[] = args.documentText
        ? [
            {
              id: 0,
              conversationId: 0,
              filename: args.documentName,
              mimeType: "text/plain",
              byteSize: Buffer.byteLength(args.documentText),
              textContent: args.documentText,
              sourceRef: null,
              original: null,
              createdAt: new Date(),
            },
          ]
        : [];
      const outcome = await runChatAction({
        action: args.action as ChatActionMode,
        prompt: args.prompt,
        format: args.format as OutputFormat,
        history: [],
        documents,
        jurisdiction: args.jurisdiction,
      });
      return { content: outcome.content, structured: outcome.structured };
    },
  },
];

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function mcpAuth(req: Request, res: Response): boolean {
  const token = process.env.MCP_TOKEN;
  if (!token) {
    if (process.env.AUTH_REQUIRED === "1") {
      res.status(503).json({ error: "MCP is not configured (MCP_TOKEN unset)." });
      return false;
    }
    return true; // dev passthrough
  }
  const header = req.headers.authorization ?? "";
  if (header !== `Bearer ${token}`) {
    res.status(401).json({ error: "Invalid or missing MCP bearer token." });
    return false;
  }
  return true;
}

router.get("/mcp", (_req, res) => {
  // SSE server-push channel is optional in Streamable HTTP; we don't offer one.
  res.status(405).json({ error: "Use POST for MCP JSON-RPC requests." });
});

router.post("/mcp", async (req, res) => {
  if (!mcpAuth(req, res)) return;
  const body = req.body as {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    res.status(400).json(rpcError(body?.id, -32600, "Invalid JSON-RPC 2.0 request"));
    return;
  }
  const { id, method, params } = body;
  const isNotification = id === undefined;

  try {
    switch (method) {
      case "initialize":
        res.json(
          rpcResult(id, {
            protocolVersion:
              typeof params?.protocolVersion === "string"
                ? params.protocolVersion
                : PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "nys-agentic-ai", version: "2.0.0" },
          }),
        );
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        res.status(202).end();
        return;
      case "ping":
        res.json(rpcResult(id, {}));
        return;
      case "tools/list":
        res.json(
          rpcResult(id, {
            tools: TOOLS.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          }),
        );
        return;
      case "tools/call": {
        const toolName = typeof params?.name === "string" ? params.name : "";
        const tool = TOOLS.find((t) => t.name === toolName);
        if (!tool) {
          res.json(rpcError(id, -32602, `Unknown tool: ${toolName}`));
          return;
        }
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        if (toolName === "perform_legal_work" || toolName === "chat_action") {
          recordModelUsage(res);
        }
        try {
          const result = await tool.handler(args);
          res.json(
            rpcResult(id, {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: false,
            }),
          );
        } catch (err) {
          req.log.warn({ err: String(err), tool: toolName }, "mcp tool call failed");
          res.json(
            rpcResult(id, {
              content: [{ type: "text", text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
              isError: true,
            }),
          );
        }
        return;
      }
      default:
        if (isNotification) {
          res.status(202).end();
          return;
        }
        res.json(rpcError(id, -32601, `Method not found: ${method}`));
        return;
    }
  } catch (err) {
    req.log.error({ err: String(err) }, "mcp request failed");
    res.status(500).json(rpcError(id, -32603, "Internal error"));
  }
});

export default router;
