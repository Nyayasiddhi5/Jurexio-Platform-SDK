import { describe, it, expect } from "vitest";
import request from "supertest";
import { default as app } from "../app";

describe("Open Data analytics scaffold", () => {
  it("GET /api/analytics/citations returns honest empty-state note when no refs", async () => {
    const res = await request(app).get("/api/analytics/citations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalRuns");
    expect(res.body).toHaveProperty("note");
    expect(typeof res.body.note).toBe("string");
    expect(Array.isArray(res.body.bySource)).toBe(true);
  });

  it("GET /api/analytics/litigation returns run aggregates scaffold", async () => {
    const res = await request(app).get("/api/analytics/litigation");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalRuns");
    expect(res.body).toHaveProperty("byWorkType");
    expect(res.body).toHaveProperty("note");
    expect(Array.isArray(res.body.byWorkType)).toBe(true);
  });
});
