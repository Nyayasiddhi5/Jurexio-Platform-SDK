import { describe, it, expect, vi, afterAll } from "vitest";
import request from "supertest";

vi.mock("../lib/agent", () => ({
  performLegalWork: vi.fn(async () => "# Mock Work Product\n\nDrafted for test."),
  evaluateWork: vi.fn(async () => ({ results: [] })),
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

describe("GET /api/tasks jurisdiction=ALL", () => {
  it("returns IN + US + GLOBAL (no reserved codes)", async () => {
    const res = await request(app).get("/api/tasks").query({ jurisdiction: "ALL" });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const t of res.body) {
      expect(["IN", "US", "GLOBAL"]).toContain(t.jurisdiction);
    }
    const set = new Set(res.body.map((t: { jurisdiction: string }) => t.jurisdiction));
    expect(set.has("GLOBAL")).toBe(true);
  });
});

describe("GET /api/templates jurisdiction=ALL", () => {
  it("returns both IN and US template banks", async () => {
    const res = await request(app).get("/api/templates").query({ jurisdiction: "ALL" });
    expect(res.status).toBe(200);
    const set = new Set(res.body.map((t: { jurisdiction: string }) => t.jurisdiction));
    expect(set.has("IN")).toBe(true);
    expect(set.has("US")).toBe(true);
  });
});

describe("GET /api/analytics/usage jurisdiction filter", () => {
  it("accepts jurisdiction=ALL and returns byJurisdiction", async () => {
    const res = await request(app)
      .get("/api/analytics/usage")
      .query({ days: 7, jurisdiction: "ALL" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("byJurisdiction");
    expect(res.body.jurisdiction).toBe("ALL");
  });
});
