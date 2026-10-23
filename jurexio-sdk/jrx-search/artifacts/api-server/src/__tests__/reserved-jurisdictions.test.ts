import { describe, it, expect, vi, afterAll } from "vitest";
import request from "supertest";

vi.mock("../lib/agent", () => ({
  performLegalWork: vi.fn(async () => "# Mock Work Product\n\nDrafted for test."),
  evaluateWork: vi.fn(async () => ({ results: [] })),
}));

const { default: app } = await import("../app");
const { db, runsTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { retrieveAuthorities } = await import("../lib/caselaw");

const RESERVED = ["GCC", "UK", "EU", "SG"] as const;

const createdRunIds: number[] = [];

afterAll(async () => {
  for (const id of createdRunIds) {
    await db.delete(runsTable).where(eq(runsTable.id, id));
  }
});

describe("GET /api/caselaw/search with reserved jurisdictions", () => {
  for (const j of RESERVED) {
    it(`returns 200 comingSoon for ${j}`, async () => {
      const res = await request(app)
        .get("/api/caselaw/search")
        .query({ jurisdiction: j, q: "contract breach" });
      expect(res.status).toBe(200);
      expect(res.body.comingSoon).toBe(true);
      expect(res.body.jurisdiction).toBe(j);
      expect(res.body.total).toBe(0);
      expect(res.body.results).toEqual([]);
      expect(typeof res.body.message).toBe("string");
      expect(res.body.message.length).toBeGreaterThan(0);
    });
  }

  it("still validates unknown jurisdictions as errors (not silent success)", async () => {
    const res = await request(app)
      .get("/api/caselaw/search")
      .query({ jurisdiction: "XX", q: "contract breach" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("retrieveAuthorities with reserved jurisdictions", () => {
  for (const j of RESERVED) {
    it(`returns empty authorities for ${j} without throwing`, async () => {
      const authorities = await retrieveAuthorities({
        query: "breach of contract damages",
        jurisdiction: j,
      });
      expect(authorities).toEqual([]);
    });
  }
});

describe("POST /api/runs with reserved jurisdiction", () => {
  it("completes a run with jurisdiction GCC and empty authorities", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({
        title: "Reserved jurisdiction regression test run",
        category: "general-commercial",
        workType: "draft",
        instruction: "Draft a short test memo.",
        jurisdiction: "GCC",
      });
    expect(res.status).toBeLessThan(400);
    expect(res.body.id).toBeDefined();
    createdRunIds.push(res.body.id);
    expect(res.body.status).toBe("completed");
    expect(res.body.output).toContain("Mock Work Product");

    const [row] = await db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, res.body.id));
    expect(row).toBeDefined();
    expect(row!.authorities ?? []).toEqual([]);
  });
});
