import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

// Capture every LLM prompt so we can assert the mode-critical instructions
// each action feeds the model. The provider is fully mocked — no network.
const h = vi.hoisted(() => {
  const calls: Array<{ system: string; user: string; model?: string }> = [];
  function jsonFor(system: string): string {
    if (system.includes('"parties"')) {
      return JSON.stringify({
        parties: [{ name: "Acme Corp", role: "plaintiff" }],
        counsel: [],
        judges: [],
        witnesses: [],
        organizations: [],
        keyDates: [],
        notes: "",
      });
    }
    if (system.includes('"caseTitle"')) {
      return JSON.stringify({
        caseTitle: "Acme v. Widget",
        summary: "A contract dispute.",
      });
    }
    if (system.includes('"pointsToNote"')) {
      return JSON.stringify({
        pointsToNote: ["Statute of limitations may bar the claim."],
        references: [],
        study: "Detailed analysis of the position.",
        arguments: [{ side: "Plaintiff", argument: "Breach is clear." }],
        approach: "File early and move for summary judgment.",
      });
    }
    if (system.includes('"outcomeLikelihoodPct"')) {
      return JSON.stringify({
        outcomeLikelihoodPct: 62,
        outcomeLabel: "Favorable settlement likely",
        confidence: "moderate",
        riskFactors: ["Weak documentary evidence."],
        suggestions: ["Depose the key witness early."],
      });
    }
    return "Free-form **Markdown** answer.";
  }
  return { calls, jsonFor };
});

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: vi.fn(
        async (opts: {
          system: string;
          model?: string;
          messages: Array<{ content: string }>;
        }) => {
          h.calls.push({
            system: opts.system,
            user: opts.messages[0]?.content ?? "",
            model: opts.model,
          });
          return { content: [{ type: "text", text: h.jsonFor(opts.system) }] };
        },
      ),
    },
  },
  streamText: vi.fn(async function* () {
    yield "streamed ";
    yield "answer";
  }),
}));

vi.mock("../lib/caselaw", () => ({
  retrieveAuthorities: vi.fn(async () => []),
  searchIndianCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
  searchUsCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
}));

const { runChatAction, PREDICTIONS_DISCLAIMER } = await import(
  "../lib/chatActions"
);
const { default: app } = await import("../app");
const { db, chatConversationsTable, chatMessagesTable } = await import(
  "@workspace/db"
);
const { eq } = await import("drizzle-orm");

beforeEach(() => {
  h.calls.length = 0;
});

const ATTORNEY_REQUEST = "Please review this commercial lease dispute.";

// The six AI action modes plus the mode-critical instruction each must carry.
const MODE_MARKERS: Record<string, string> = {
  summary: "professional summary",
  extract: "Extract the entities",
  case_details: "structured case-details record",
  draft: "legal work product",
  intelligence: "litigation-intelligence analysis",
  predictions: "likely outcome",
};

describe("runChatAction — prompt-builder locks per mode", () => {
  for (const [mode, marker] of Object.entries(MODE_MARKERS)) {
    it(`"${mode}" feeds its mode-critical instruction and the attorney request`, async () => {
      const outcome = await runChatAction({
        action: mode as never,
        prompt: ATTORNEY_REQUEST,
        format: "detailed",
        history: [],
        documents: [],
      });

      expect(h.calls).toHaveLength(1);
      const call = h.calls[0];
      expect(call.system).toContain(marker);
      // Every mode must carry the shared agent standards.
      expect(call.system).toContain("NYS Agentic AI");
      // The attorney's actual request is always forwarded to the model.
      expect(call.user).toContain(ATTORNEY_REQUEST);
      expect(outcome.content.length).toBeGreaterThan(0);
    });
  }

  it("structured modes return a structured payload; free-text modes do not", async () => {
    for (const mode of ["extract", "case_details", "intelligence", "predictions"]) {
      h.calls.length = 0;
      const outcome = await runChatAction({
        action: mode as never,
        prompt: ATTORNEY_REQUEST,
        format: "detailed",
        history: [],
        documents: [],
      });
      expect(outcome.structured).not.toBeNull();
    }
    for (const mode of ["chat", "summary", "draft"]) {
      h.calls.length = 0;
      const outcome = await runChatAction({
        action: mode as never,
        prompt: ATTORNEY_REQUEST,
        format: "brief",
        history: [],
        documents: [],
      });
      expect(outcome.structured).toBeNull();
      expect(h.calls[0].system).toContain("BRIEF");
    }
  });

  it("predictions always include the mandatory AI disclaimer (content + structured)", async () => {
    const outcome = await runChatAction({
      action: "predictions",
      prompt: ATTORNEY_REQUEST,
      format: "detailed",
      history: [],
      documents: [],
    });
    expect(outcome.content).toContain(PREDICTIONS_DISCLAIMER);
    expect(outcome.structured).not.toBeNull();
    expect(
      (outcome.structured as Record<string, unknown>).disclaimer,
    ).toBe(PREDICTIONS_DISCLAIMER);
  });

  it("intelligence mode routes through a (possibly stronger) configured model", async () => {
    await runChatAction({
      action: "intelligence",
      prompt: ATTORNEY_REQUEST,
      format: "detailed",
      history: [],
      documents: [],
    });
    // The model is chosen from ANTHROPIC_INTELLIGENCE_MODEL ?? MODEL — either
    // way a concrete model string must reach the provider.
    expect(typeof h.calls[0].model).toBe("string");
    expect((h.calls[0].model ?? "").length).toBeGreaterThan(0);
  });
});

describe("runChatAction — reserved-jurisdiction segregation", () => {
  const retrievingModes = ["case_details", "intelligence", "predictions"] as const;

  it("reserved jurisdictions never trigger authority retrieval (no US/IN fallback)", async () => {
    const { retrieveAuthorities } = await import("../lib/caselaw");
    for (const reserved of ["GCC", "UK", "EU", "SG"]) {
      for (const mode of retrievingModes) {
        vi.mocked(retrieveAuthorities).mockClear();
        await runChatAction({
          action: mode,
          prompt: ATTORNEY_REQUEST,
          format: "detailed",
          history: [],
          documents: [],
          jurisdiction: reserved,
        });
        expect(retrieveAuthorities).not.toHaveBeenCalled();
      }
    }
  });

  it("an explicit reserved jurisdiction wins over document-based inference", async () => {
    const { retrieveAuthorities } = await import("../lib/caselaw");
    vi.mocked(retrieveAuthorities).mockClear();
    await runChatAction({
      action: "intelligence",
      prompt: ATTORNEY_REQUEST,
      format: "detailed",
      history: [],
      documents: [
        {
          name: "note.txt",
          textContent: "India AIR 2019 SC 1 — strong Indian signals",
        } as never,
      ],
      jurisdiction: "GCC",
    });
    expect(retrieveAuthorities).not.toHaveBeenCalled();
  });

  it("live jurisdictions still retrieve authorities with the selected value", async () => {
    const { retrieveAuthorities } = await import("../lib/caselaw");
    for (const live of ["IN", "US"]) {
      vi.mocked(retrieveAuthorities).mockClear();
      await runChatAction({
        action: "intelligence",
        prompt: ATTORNEY_REQUEST,
        format: "detailed",
        history: [],
        documents: [],
        jurisdiction: live,
      });
      expect(retrieveAuthorities).toHaveBeenCalledTimes(1);
      expect(vi.mocked(retrieveAuthorities).mock.calls[0][0]).toMatchObject({
        jurisdiction: live,
      });
    }
  });
});

describe("POST /api/chat/conversations/:id/messages — mode validation contract", () => {
  const createdConversationIds: number[] = [];

  afterAll(async () => {
    for (const id of createdConversationIds) {
      await db
        .delete(chatMessagesTable)
        .where(eq(chatMessagesTable.conversationId, id));
      await db
        .delete(chatConversationsTable)
        .where(eq(chatConversationsTable.id, id));
    }
  });

  async function newConversation(): Promise<number> {
    const res = await request(app)
      .post("/api/chat/conversations")
      .send({ title: "Action contract test" });
    expect(res.status).toBe(201);
    const id = res.body.id as number;
    createdConversationIds.push(id);
    return id;
  }

  for (const mode of Object.keys(MODE_MARKERS)) {
    it(`accepts the "${mode}" action mode`, async () => {
      const id = await newConversation();
      const res = await request(app)
        .post(`/api/chat/conversations/${id}/messages`)
        .send({ content: ATTORNEY_REQUEST, action: mode });
      expect(res.status).toBe(201);
      expect(res.body.assistantMessage.action).toBe(mode);
      expect(res.body.assistantMessage.content.length).toBeGreaterThan(0);
    });
  }

  it('accepts the plain "chat" turn', async () => {
    const id = await newConversation();
    const res = await request(app)
      .post(`/api/chat/conversations/${id}/messages`)
      .send({ content: ATTORNEY_REQUEST, action: "chat" });
    expect(res.status).toBe(201);
  });

  it("rejects an unknown action mode with 400", async () => {
    const id = await newConversation();
    const res = await request(app)
      .post(`/api/chat/conversations/${id}/messages`)
      .send({ content: ATTORNEY_REQUEST, action: "bogus_mode" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("persists the mandatory disclaimer for the predictions mode", async () => {
    const id = await newConversation();
    const res = await request(app)
      .post(`/api/chat/conversations/${id}/messages`)
      .send({ content: ATTORNEY_REQUEST, action: "predictions" });
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.content).toContain(PREDICTIONS_DISCLAIMER);
    expect(res.body.assistantMessage.structured.disclaimer).toBe(
      PREDICTIONS_DISCLAIMER,
    );
  });
});
