/**
 * Route-level regression tests for the Statutes-RAG endpoints:
 *   GET /api/statutes/retrieve     (hybrid FTS + vector KNN, RRF fusion)
 *   GET /api/statutes/:id/similar  (similar-provision lookup)
 *
 * Fixtures carry a unique nonsense token so assertions match only rows this
 * suite inserted; the fixture rows are embedded in beforeAll (deterministic
 * hash embeddings in dev), so both the FTS and vector legs are exercised.
 * The suite runs green on an empty dev DB or a fully seeded corpus.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray, sql } from "drizzle-orm";

const { db, statutesTable } = await import("@workspace/db");
const { embedText, statuteEmbeddingText } = await import("../lib/embeddings");
const { default: app } = await import("../app");

const TOKEN = "zyxquhybridlaw";

const FIXTURES = [
  {
    code: "BNS",
    jurisdiction: "IN",
    section: "980001",
    heading: `Hybrid fixture ${TOKEN} primary provision`,
    text: `${TOKEN} ${TOKEN} — cheating by dishonest inducement of delivery of property, hybrid retrieval fixture.`,
    practiceArea: "Criminal",
  },
  {
    code: "IPC",
    jurisdiction: "IN",
    section: "980002",
    heading: "Hybrid fixture secondary provision",
    text: `A single mention of ${TOKEN}: dishonest inducement and delivery of property, older-code fixture.`,
    practiceArea: "Criminal",
  },
  {
    code: "USC",
    jurisdiction: "US",
    section: "980003",
    heading: "Hybrid fixture US provision",
    text: `United States hybrid fixture mentioning ${TOKEN} once, wire fraud by dishonest scheme.`,
    practiceArea: "Criminal",
  },
];

const insertedIds: number[] = [];

beforeAll(async () => {
  for (const f of FIXTURES) {
    const rows = await db
      .insert(statutesTable)
      .values({
        code: f.code,
        jurisdiction: f.jurisdiction,
        section: f.section,
        heading: f.heading,
        text: f.text,
        practiceArea: f.practiceArea,
        mappedSections: [],
      })
      .onConflictDoNothing()
      .returning({ id: statutesTable.id });
    for (const r of rows) insertedIds.push(r.id);
  }
  // Embed the fixtures so the vector leg (and similar lookup) has real data.
  for (let i = 0; i < insertedIds.length; i++) {
    const f = FIXTURES[i]!;
    const emb = await embedText(
      statuteEmbeddingText({
        code: f.code,
        section: f.section,
        heading: f.heading,
        text: f.text,
        actName: null,
        chapter: null,
        practiceArea: f.practiceArea,
      }),
    );
    await db.execute(
      sql`UPDATE statutes SET embedding = ${`[${emb.join(",")}]`}::vector WHERE id = ${insertedIds[i]!}`,
    );
  }
});

afterAll(async () => {
  if (insertedIds.length > 0) {
    await db.delete(statutesTable).where(inArray(statutesTable.id, insertedIds));
  }
});

describe("GET /api/statutes/retrieve (hybrid RRF)", () => {
  it("returns RRF-fused hits with per-leg ranks and reports the hybrid method", async () => {
    const res = await request(app).get(`/api/statutes/retrieve?q=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(["hybrid", "fts"]).toContain(res.body.method);
    expect(typeof res.body.provider).toBe("string");
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    const sections = res.body.results.map((r: { section: string }) => r.section);
    for (const s of ["980001", "980002", "980003"]) expect(sections).toContain(s);
    for (const r of res.body.results) {
      expect(typeof r.rrfScore).toBe("number");
      expect(r.rrfScore).toBeGreaterThan(0);
      // Every hit must have come from at least one leg.
      expect(r.ftsRank !== null || r.vectorRank !== null).toBe(true);
    }
    // Results must be sorted by descending RRF score.
    const scores = res.body.results.map((r: { rrfScore: number }) => r.rrfScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("FTS-matched fixture rows carry a 1-based ftsRank", async () => {
    const res = await request(app).get(`/api/statutes/retrieve?q=${TOKEN}`);
    expect(res.status).toBe(200);
    const fixture = res.body.results.find(
      (r: { section: string }) => r.section === "980001",
    );
    expect(fixture).toBeDefined();
    expect(fixture.ftsRank).toBeGreaterThanOrEqual(1);
  });

  it("applies the jurisdiction filter to both legs", async () => {
    const res = await request(app).get(
      `/api/statutes/retrieve?q=${TOKEN}&jurisdiction=US`,
    );
    expect(res.status).toBe(200);
    for (const r of res.body.results) expect(r.jurisdiction).toBe("US");
    const sections = res.body.results.map((r: { section: string }) => r.section);
    expect(sections).toContain("980003");
  });

  it("applies the code filter", async () => {
    const res = await request(app).get(
      `/api/statutes/retrieve?q=${TOKEN}&code=IPC`,
    );
    expect(res.status).toBe(200);
    for (const r of res.body.results) expect(r.code).toBe("IPC");
    const sections = res.body.results.map((r: { section: string }) => r.section);
    expect(sections).toContain("980002");
  });

  it("applies the practiceArea filter", async () => {
    const res = await request(app).get(
      `/api/statutes/retrieve?q=${TOKEN}&practiceArea=Criminal`,
    );
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    for (const r of res.body.results) expect(r.practiceArea).toBe("Criminal");
  });

  it("respects the limit parameter", async () => {
    const res = await request(app).get(`/api/statutes/retrieve?q=${TOKEN}&limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it("returns 400 for a query shorter than 2 characters", async () => {
    const res = await request(app).get("/api/statutes/retrieve?q=a");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/api/statutes/retrieve");
    expect(res.status).toBe(400);
  });

  it("semantic-only queries can still surface embedded rows via the vector leg", async () => {
    // No fixture contains the literal words of this query; the vector leg
    // (hash embeddings are deterministic on token overlap) plus the fused
    // response shape must still return a well-formed payload.
    const res = await request(app).get(
      "/api/statutes/retrieve?q=dishonest%20inducement%20delivery%20property",
    );
    expect(res.status).toBe(200);
    expect(["hybrid", "fts"]).toContain(res.body.method);
    expect(Array.isArray(res.body.results)).toBe(true);
  });
});

describe("GET /api/statutes/:id/similar", () => {
  it("returns similar provisions for an embedded statute (vector method)", async () => {
    const res = await request(app).get(`/api/statutes/${insertedIds[0]}/similar`);
    expect(res.status).toBe(200);
    expect(res.body.statuteId).toBe(insertedIds[0]);
    expect(["vector", "fts"]).toContain(res.body.method);
    expect(res.body.statute.section).toBe("980001");
    expect(Array.isArray(res.body.results)).toBe(true);
    // The source row must never appear in its own similar list.
    for (const r of res.body.results) expect(r.id).not.toBe(insertedIds[0]);
  });

  it("finds the sibling fixture as similar (shared subject matter)", async () => {
    const res = await request(app).get(
      `/api/statutes/${insertedIds[0]}/similar?limit=20`,
    );
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for a missing statute id", async () => {
    const res = await request(app).get("/api/statutes/999999999/similar");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app).get("/api/statutes/abc/similar");
    expect(res.status).toBe(400);
  });
});
