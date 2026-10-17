import { describe, it, expect } from "vitest";
import request from "supertest";
import { z } from "zod";
import {
  SearchCaselawQueryParams,
  SearchStatutesQueryParams,
  RetrieveBody,
  ExtractCitationsBody,
  CompareIpcBnsQueryParams,
} from "@workspace/api-zod";

import app from "../app";

interface McpToolListItem {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

async function listTools(): Promise<McpToolListItem[]> {
  const res = await request(app)
    .post("/api/mcp")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  expect(res.status).toBe(200);
  return res.body.result.tools as McpToolListItem[];
}

function zodKeys(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape);
}

// Each MCP tool that mirrors an OpenAPI operation. The MCP surface intentionally
// renames a few fields for LLM ergonomics (alias) and omits server-only knobs
// (omit). Any *other* divergence (a new/removed OpenAPI field) is real drift and
// must fail this test until the MCP tool is reconciled.
interface Mapping {
  tool: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** OpenAPI field name -> MCP field name */
  alias: Record<string, string>;
  /** OpenAPI fields deliberately not exposed over MCP */
  omit: string[];
}

const MAPPINGS: Mapping[] = [
  {
    tool: "search_caselaw",
    schema: SearchCaselawQueryParams as z.ZodObject<z.ZodRawShape>,
    alias: { q: "query" },
    omit: ["year", "court", "courtType"],
  },
  {
    tool: "search_statutes",
    schema: SearchStatutesQueryParams as z.ZodObject<z.ZodRawShape>,
    alias: { q: "query" },
    omit: [],
  },
  {
    tool: "retrieve",
    schema: RetrieveBody as z.ZodObject<z.ZodRawShape>,
    alias: {},
    omit: ["limit"],
  },
  {
    tool: "check_citations",
    schema: ExtractCitationsBody as z.ZodObject<z.ZodRawShape>,
    alias: {},
    omit: ["link"],
  },
  {
    tool: "compare_ipc_bns",
    schema: CompareIpcBnsQueryParams as z.ZodObject<z.ZodRawShape>,
    alias: { section: "ipcSection" },
    omit: [],
  },
];

describe("MCP tool input schemas vs OpenAPI-derived Zod schemas", () => {
  it("exposes each mapped tool with fields matching its OpenAPI schema (drift guard)", async () => {
    const tools = await listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    for (const m of MAPPINGS) {
      const tool = byName.get(m.tool);
      expect(tool, `MCP tool ${m.tool} must exist`).toBeDefined();
      if (!tool) continue;

      const expected = zodKeys(m.schema)
        .filter((k) => !m.omit.includes(k))
        .map((k) => m.alias[k] ?? k)
        .sort();

      const actual = Object.keys(tool.inputSchema.properties ?? {}).sort();

      expect(
        actual,
        `Input-schema fields for MCP tool "${m.tool}" drifted from its OpenAPI schema. ` +
          `Update the tool (or the alias/omit map) to reconcile.`,
      ).toEqual(expected);
    }
  });

  it("snapshots every MCP tool input schema to catch any structural drift", async () => {
    const tools = await listTools();
    const snapshot = tools
      .map((t) => ({ name: t.name, inputSchema: t.inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(snapshot).toMatchSnapshot();
  });
});
