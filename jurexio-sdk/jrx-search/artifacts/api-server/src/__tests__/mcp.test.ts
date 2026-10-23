import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../lib/agent", () => ({
  performLegalWork: vi.fn(async () => "# Mock Work Product"),
  evaluateWork: vi.fn(async () => ({ results: [] })),
}));
vi.mock("../lib/chatActions", () => ({
  runChatAction: vi.fn(async () => ({ content: "mock answer", structured: null })),
}));
vi.mock("../lib/caselaw", () => ({
  searchIndianCaselaw: vi.fn(async () => ({
    total: 1,
    results: [{ title: "State v. Mock", citation: "(2020) 1 SCC 1" }],
  })),
  searchUsCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
  retrieveAuthorities: vi.fn(async () => []),
}));
vi.mock("../lib/statutes", () => ({
  searchStatutes: vi.fn(async () => ({ total: 0, results: [] })),
  getStatuteBySection: vi.fn(async (code: string, section: string) =>
    code === "BNS" && section === "103"
      ? { code: "BNS", section: "103", title: "Punishment for murder" }
      : null,
  ),
  compareIpcToBns: vi.fn(async () => ({ ipc: null, bnsMatches: [] })),
}));
vi.mock("../lib/retrievalRouter", () => ({
  planAndRetrieve: vi.fn(async () => ({
    intent: "caselaw-search",
    llmRequired: false,
    reason: "mock",
    steps: [],
  })),
}));

const { default: app } = await import("../app");

function rpc(body: object, token?: string) {
  const req = request(app).post("/api/mcp");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body);
}

const ORIGINAL_MCP_TOKEN = process.env.MCP_TOKEN;
const ORIGINAL_AUTH_REQUIRED = process.env.AUTH_REQUIRED;

beforeEach(() => {
  delete process.env.MCP_TOKEN;
  delete process.env.AUTH_REQUIRED;
});

afterEach(() => {
  if (ORIGINAL_MCP_TOKEN === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = ORIGINAL_MCP_TOKEN;
  if (ORIGINAL_AUTH_REQUIRED === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = ORIGINAL_AUTH_REQUIRED;
});

describe("POST /api/mcp — protocol surface", () => {
  it("handles initialize", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe("2.0");
    expect(res.body.id).toBe(1);
    expect(res.body.result.protocolVersion).toBe("2025-03-26");
    expect(res.body.result.serverInfo.name).toBe("nys-agentic-ai");
    expect(res.body.result.capabilities.tools).toBeDefined();
  });

  it("echoes the client protocolVersion when provided", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });
    expect(res.body.result.protocolVersion).toBe("2024-11-05");
  });

  it("responds to ping", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({});
  });

  it("accepts notifications with 202 and no body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });

  it("rejects non-JSON-RPC bodies with -32600", async () => {
    const res = await rpc({ hello: "world" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
  });

  it("returns -32601 for unknown methods with an id", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32601);
  });

  it("rejects GET with 405", async () => {
    const res = await request(app).get("/api/mcp");
    expect(res.status).toBe(405);
  });
});

describe("POST /api/mcp — tools/list", () => {
  it("lists every registered tool with a name, description, and inputSchema", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/list" });
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as Array<{
      name: string;
      description: string;
      inputSchema: { type: string; required?: string[] };
    }>;
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "search_caselaw",
      "search_statutes",
      "get_statute",
      "compare_ipc_bns",
      "retrieve",
      "check_citations",
      "perform_legal_work",
      "chat_action",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });
});

describe("POST /api/mcp — tools/call", () => {
  it("runs check_citations (pure, no mocks) and returns MCP content", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "check_citations",
        arguments: { text: "See (2020) 5 SCC 1 for the holding." },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(false);
    expect(res.body.result.content).toHaveLength(1);
    expect(res.body.result.content[0].type).toBe("text");
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(Array.isArray(parsed.citations)).toBe(true);
    expect(parsed.citations.length).toBeGreaterThan(0);
  });

  it("runs search_caselaw against the (mocked) IN corpus", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "search_caselaw", arguments: { query: "murder" } },
    });
    expect(res.body.result.isError).toBe(false);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.results[0].title).toBe("State v. Mock");
  });

  it("runs get_statute and reports found=false for a miss", async () => {
    const hit = await rpc({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "get_statute", arguments: { code: "bns", section: "103" } },
    });
    expect(JSON.parse(hit.body.result.content[0].text).found).toBe(true);

    const miss = await rpc({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "get_statute", arguments: { code: "BNS", section: "9999" } },
    });
    expect(miss.body.result.isError).toBe(false);
    expect(JSON.parse(miss.body.result.content[0].text)).toEqual({
      found: false,
      statute: null,
    });
  });

  it("returns -32602 for unknown tools", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32602);
    expect(res.body.error.message).toContain("no_such_tool");
  });

  it("returns isError=true (not a transport error) when arguments fail validation", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "search_caselaw", arguments: { query: "x" } },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("Tool error:");
  });

  it("returns isError=true when a tool handler throws", async () => {
    const { searchIndianCaselaw } = await import("../lib/caselaw");
    vi.mocked(searchIndianCaselaw).mockRejectedValueOnce(new Error("corpus offline"));
    const res = await rpc({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "search_caselaw", arguments: { query: "murder" } },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("corpus offline");
  });
});

describe("POST /api/mcp — bearer auth", () => {
  it("allows requests without a token when MCP_TOKEN is unset (dev passthrough)", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 13, method: "ping" });
    expect(res.status).toBe(200);
  });

  it("rejects missing/incorrect tokens with 401 when MCP_TOKEN is set", async () => {
    process.env.MCP_TOKEN = "sekret";
    const noToken = await rpc({ jsonrpc: "2.0", id: 14, method: "ping" });
    expect(noToken.status).toBe(401);
    const badToken = await rpc({ jsonrpc: "2.0", id: 15, method: "ping" }, "wrong");
    expect(badToken.status).toBe(401);
  });

  it("accepts the correct bearer token when MCP_TOKEN is set", async () => {
    process.env.MCP_TOKEN = "sekret";
    const res = await rpc({ jsonrpc: "2.0", id: 16, method: "ping" }, "sekret");
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({});
  });

  it("returns 503 when AUTH_REQUIRED=1 but MCP_TOKEN is unset", async () => {
    process.env.AUTH_REQUIRED = "1";
    const res = await rpc({ jsonrpc: "2.0", id: 17, method: "ping" });
    expect(res.status).toBe(503);
  });
});
