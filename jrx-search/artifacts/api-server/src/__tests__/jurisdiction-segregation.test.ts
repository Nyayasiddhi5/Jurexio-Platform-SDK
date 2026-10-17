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

describe("GET /api/tasks jurisdiction segregation", () => {
  it("returns only US + GLOBAL tasks for jurisdiction=US, each with a jurisdiction field", async () => {
    const res = await request(app).get("/api/tasks").query({ jurisdiction: "US" });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const t of res.body) {
      expect(["US", "GLOBAL"]).toContain(t.jurisdiction);
    }
  });

  it("returns only IN + GLOBAL tasks for jurisdiction=IN (no US tasks leak)", async () => {
    const res = await request(app).get("/api/tasks").query({ jurisdiction: "IN" });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const t of res.body) {
      expect(t.jurisdiction).not.toBe("US");
    }
  });

  it("IN and US task sets differ (US-specific tasks excluded from IN)", async () => {
    const [inRes, usRes] = await Promise.all([
      request(app).get("/api/tasks").query({ jurisdiction: "IN" }),
      request(app).get("/api/tasks").query({ jurisdiction: "US" }),
    ]);
    expect(usRes.body.length).toBeGreaterThan(inRes.body.length);
  });

  it("returns all tasks when jurisdiction is omitted (backward compatible)", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(200);
    const jurisdictions = new Set(res.body.map((t: { jurisdiction: string }) => t.jurisdiction));
    expect(jurisdictions.has("US")).toBe(true);
    expect(jurisdictions.has("GLOBAL")).toBe(true);
  });

  it("rejects unknown jurisdiction values", async () => {
    const res = await request(app).get("/api/tasks").query({ jurisdiction: "XX" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("GET /api/categories jurisdiction segregation", () => {
  it("category counts respect the jurisdiction filter", async () => {
    const [all, inRes] = await Promise.all([
      request(app).get("/api/categories"),
      request(app).get("/api/categories").query({ jurisdiction: "IN" }),
    ]);
    expect(all.status).toBe(200);
    expect(inRes.status).toBe(200);
    const totalAll = all.body.reduce((s: number, c: { taskCount: number }) => s + c.taskCount, 0);
    const totalIn = inRes.body.reduce((s: number, c: { taskCount: number }) => s + c.taskCount, 0);
    expect(totalIn).toBeLessThan(totalAll);
    expect(totalIn).toBeGreaterThan(0);
  });
});

describe("POST /api/runs jurisdiction persistence", () => {
  it("persists jurisdiction on the run and echoes it in responses", { timeout: 30_000 }, async () => {
    const res = await request(app).post("/api/runs").send({
      title: "Jurisdiction segregation regression run",
      category: "general-commercial",
      workType: "draft",
      instruction: "Draft a short test memo.",
      jurisdiction: "IN",
    });
    expect(res.status).toBeLessThan(400);
    expect(res.body.id).toBeDefined();
    createdRunIds.push(res.body.id);
    expect(res.body.jurisdiction).toBe("IN");

    const detail = await request(app).get(`/api/runs/${res.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.jurisdiction).toBe("IN");
  });

  it("runs without jurisdiction persist null (legacy behavior)", { timeout: 30_000 }, async () => {
    const res = await request(app).post("/api/runs").send({
      title: "Legacy run without jurisdiction",
      category: "general-commercial",
      workType: "draft",
      instruction: "Draft a short test memo.",
    });
    expect(res.status).toBeLessThan(400);
    createdRunIds.push(res.body.id);
    expect(res.body.jurisdiction ?? null).toBeNull();
  });
});

describe("GET /api/dashboard/summary jurisdiction scoping", () => {
  it("scopes run stats to the requested jurisdiction", { timeout: 30_000 }, async () => {
    const inRun = await request(app).post("/api/runs").send({
      title: "Dashboard IN scoping run",
      category: "general-commercial",
      workType: "draft",
      instruction: "Draft a short test memo.",
      jurisdiction: "IN",
    });
    expect(inRun.status).toBeLessThan(400);
    createdRunIds.push(inRun.body.id);

    const [inSummary, usSummary] = await Promise.all([
      request(app).get("/api/dashboard/summary").query({ jurisdiction: "IN" }),
      request(app).get("/api/dashboard/summary").query({ jurisdiction: "US" }),
    ]);
    expect(inSummary.status).toBe(200);
    expect(usSummary.status).toBe(200);
    expect(inSummary.body.totalRuns).toBeGreaterThanOrEqual(1);

    const inRecentIds = (inSummary.body.recentRuns ?? []).map((r: { id: number }) => r.id);
    const usRecentIds = (usSummary.body.recentRuns ?? []).map((r: { id: number }) => r.id);
    expect(inRecentIds).toContain(inRun.body.id);
    expect(usRecentIds).not.toContain(inRun.body.id);
  });

  it("unscoped summary includes all runs (backward compatible)", async () => {
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalRuns).toBe("number");
  });

  it("ALL summary includes byJurisdiction breakdown", async () => {
    const res = await request(app).get("/api/dashboard/summary").query({ jurisdiction: "ALL" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.byJurisdiction)).toBe(true);
  });
});

describe("GET /api/runs jurisdiction filter", () => {
  it("returns live + legacy runs for jurisdiction=ALL", { timeout: 30_000 }, async () => {
    const inRun = await request(app).post("/api/runs").send({
      title: "Runs ALL filter IN",
      category: "general-commercial",
      workType: "draft",
      instruction: "Draft a short test memo.",
      jurisdiction: "IN",
    });
    expect(inRun.status).toBeLessThan(400);
    createdRunIds.push(inRun.body.id);

    const res = await request(app).get("/api/runs").query({ jurisdiction: "ALL" });
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: number }) => r.id);
    expect(ids).toContain(inRun.body.id);
  });

  it("rejects unknown jurisdiction on GET /runs", async () => {
    const res = await request(app).get("/api/runs").query({ jurisdiction: "XX" });
    expect(res.status).toBe(400);
  });
});
