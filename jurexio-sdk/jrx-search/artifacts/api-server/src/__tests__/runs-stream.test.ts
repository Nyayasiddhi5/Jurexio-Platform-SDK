import { describe, it, expect, vi, afterAll } from "vitest";
import request from "supertest";
import { parseSseBlock, type StreamEvent } from "@workspace/nyv-sdk";

vi.mock("../lib/agent", () => ({
  performLegalWork: vi.fn(
    async (input: { onDelta?: (text: string) => void }) => {
      input.onDelta?.("# Mock ");
      input.onDelta?.("Work Product");
      return "# Mock Work Product";
    },
  ),
  evaluateWork: vi.fn(async () => ({ results: [] })),
}));
vi.mock("../lib/caselaw", () => ({
  retrieveAuthorities: vi.fn(async () => []),
  searchIndianCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
  searchUsCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
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
const { db, runsTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");

const createdRunIds: number[] = [];

afterAll(async () => {
  for (const id of createdRunIds) {
    await db.delete(runsTable).where(eq(runsTable.id, id));
  }
});

function parseSseText(text: string): StreamEvent<Record<string, unknown>>[] {
  const events: StreamEvent<Record<string, unknown>>[] = [];
  for (const block of text.split("\n\n")) {
    const event = parseSseBlock<Record<string, unknown>>(block);
    if (event) events.push(event);
  }
  return events;
}

describe("POST /api/runs/stream", () => {
  it("emits status → delta → done and persists the run", async () => {
    const res = await request(app)
      .post("/api/runs/stream")
      .set("Accept", "text/event-stream")
      .send({
        title: "Streaming smoke test",
        category: "custom",
        workType: "drafting",
        instruction: "Draft a short mock memorandum for the streaming smoke test.",
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
        res.on("end", () => cb(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const events = parseSseText(res.body as string);
    const types = events.map((e) => e.type);

    // Overall ordering: at least one status, then deltas, then exactly one done.
    expect(types.filter((t) => t === "done")).toHaveLength(1);
    expect(types).not.toContain("error");
    expect(types[types.length - 1]).toBe("done");

    const stages = events.flatMap((e) => (e.type === "status" ? [e.stage] : []));
    expect(stages).toEqual([
      "resolving-task",
      "retrieving-authorities",
      "drafting",
      "saving",
    ]);

    const deltas = events.flatMap((e) => (e.type === "delta" ? [e.text] : []));
    expect(deltas.join("")).toBe("# Mock Work Product");
    // Deltas must arrive after the "drafting" status event.
    expect(types.indexOf("delta")).toBeGreaterThan(
      events.findIndex((e) => e.type === "status" && e.stage === "drafting"),
    );

    const done = events.find((e) => e.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.payload.status).toBe("completed");
    expect(done.payload.output).toBe("# Mock Work Product");
    expect(done.payload.title).toBe("Streaming smoke test");
    expect(typeof done.payload.id).toBe("number");
    createdRunIds.push(done.payload.id as number);

    // The run really was persisted.
    const [row] = await db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, done.payload.id as number));
    expect(row).toBeDefined();
    expect(row.output).toBe("# Mock Work Product");
  });

  it("emits an error event (still HTTP 200 SSE) when the agent fails mid-stream", async () => {
    const { performLegalWork } = await import("../lib/agent");
    vi.mocked(performLegalWork).mockRejectedValueOnce(new Error("model unavailable"));

    const res = await request(app)
      .post("/api/runs/stream")
      .set("Accept", "text/event-stream")
      .send({
        title: "Streaming failure test",
        category: "custom",
        workType: "drafting",
        instruction: "Draft something that will fail for the streaming error test.",
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
        res.on("end", () => cb(null, data));
      });

    expect(res.status).toBe(200);
    const events = parseSseText(res.body as string);
    const last = events[events.length - 1];
    expect(last).toEqual({ type: "error", error: "model unavailable" });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
