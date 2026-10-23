/**
 * Route-level tests for the sibling statute endpoints:
 *   GET /api/statutes/search  (Postgres FTS over code/section/heading/text)
 *   GET /api/statutes         (list/browse with filters)
 *
 * These pin search ranking-by-relevance behavior, code/jurisdiction filters,
 * the 400 on too-short queries, and limit clamping — so a future corpus
 * reseed, FTS expression change, or schema change fails loudly instead of
 * silently breaking search or browse.
 *
 * Fixtures carry a unique nonsense token ("zyxqutestlaw") in their text so
 * FTS assertions match only rows this suite inserted; the suite runs green
 * on both an empty dev DB and a fully seeded corpus. Only rows the suite
 * actually inserted are removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

const { db, statutesTable } = await import("@workspace/db");
const { default: app } = await import("../app");

const TOKEN = "zyxqutestlaw";

type Fixture = {
  code: string;
  jurisdiction: string;
  section: string;
  heading: string;
  text: string;
};

const FIXTURES: Fixture[] = [
  {
    code: "BNS",
    jurisdiction: "IN",
    section: "990001",
    heading: `Fixture ${TOKEN} primary provision`,
    // The token appears in heading AND text so this row ranks highest.
    text: `${TOKEN} ${TOKEN} — this fixture provision exists only for the search route tests.`,
  },
  {
    code: "IPC",
    jurisdiction: "IN",
    section: "990002",
    heading: "Fixture secondary provision",
    text: `A single mention of ${TOKEN} in the body text of this fixture.`,
  },
  {
    code: "USC",
    jurisdiction: "US",
    section: "990003",
    heading: "Fixture US provision",
    text: `United States fixture mentioning ${TOKEN} once for jurisdiction filter tests.`,
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
        mappedSections: [],
      })
      .onConflictDoNothing()
      .returning({ id: statutesTable.id });
    for (const r of rows) insertedIds.push(r.id);
  }
});

afterAll(async () => {
  if (insertedIds.length > 0) {
    await db.delete(statutesTable).where(inArray(statutesTable.id, insertedIds));
  }
});

describe("GET /api/statutes/search", () => {
  // 20s timeout: first FTS query pays GIN-index warmup on the full statutes corpus,
  // which can exceed the default 5s while the India Code ingest is concurrently writing.
  it("finds fixture rows via FTS and ranks the densest match first", { timeout: 20_000 }, async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.results).toHaveLength(3);
    // Row with the token in heading + text (twice) must outrank single mentions.
    expect(res.body.results[0].section).toBe("990001");
    expect(res.body.results[0].code).toBe("BNS");
    for (const r of res.body.results) {
      expect(typeof r.id).toBe("number");
      expect(r.heading.length).toBeGreaterThan(0);
      expect(r.text.length).toBeGreaterThan(0);
      expect(Array.isArray(r.mappedSections)).toBe(true);
    }
  });

  it("always labels the response with a method (search contract requires it)", async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(["hybrid_rrf", "fts"]).toContain(res.body.method);
  });

  it("applies the code filter", async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}&code=IPC`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].code).toBe("IPC");
    expect(res.body.results[0].section).toBe("990002");
  });

  it("applies the jurisdiction filter", async () => {
    const res = await request(app).get(
      `/api/statutes/search?q=${TOKEN}&jurisdiction=US`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].jurisdiction).toBe("US");
    expect(res.body.results[0].code).toBe("USC");
  });

  it("combines code and jurisdiction filters", async () => {
    const res = await request(app).get(
      `/api/statutes/search?q=${TOKEN}&code=BNS&jurisdiction=IN`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].section).toBe("990001");
  });

  it("returns 400 for a query shorter than 2 characters", async () => {
    const res = await request(app).get("/api/statutes/search?q=a");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 when q is missing", async () => {
    const res = await request(app).get("/api/statutes/search");
    expect(res.status).toBe(400);
  });

  it("accepts open-ended code filters (India Code act slugs) and returns empty for unknown codes", async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}&code=NO-SUCH-ACT-9999`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("returns 400 for a malformed code filter (illegal characters)", async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}&code=${encodeURIComponent("bad code!")}`);
    expect(res.status).toBe(400);
  });

  it("respects an explicit limit while reporting the true total", async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}&limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.total).toBe(3);
  });

  it("clamps a below-minimum limit up to 1", async () => {
    const res = await request(app).get(`/api/statutes/search?q=${TOKEN}&limit=0`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.total).toBe(3);
  });

  it("clamps an oversized limit to the 50-row max without erroring", async () => {
    const res = await request(app).get(
      `/api/statutes/search?q=${TOKEN}&limit=99999`,
    );
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(50);
    expect(res.body.total).toBe(3);
  });

  it("returns an empty result set (not an error) for a no-match query", async () => {
    const res = await request(app).get(
      "/api/statutes/search?q=qqzzunmatchabletoken",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
  });
});

describe("GET /api/statutes", () => {
  it("does not include a method field (list contract has no retrieval method)", async () => {
    const res = await request(app).get("/api/statutes?code=BNS");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("method");
    expect(typeof res.body.total).toBe("number");
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it("lists rows for a code filter and reports the true total", async () => {
    const res = await request(app).get("/api/statutes?code=USC&jurisdiction=US");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const sections = res.body.results.map((r: { section: string }) => r.section);
    expect(sections).toContain("990003");
    for (const r of res.body.results) {
      expect(r.code).toBe("USC");
      expect(r.jurisdiction).toBe("US");
    }
  });

  it("applies the jurisdiction filter alone", async () => {
    const res = await request(app).get("/api/statutes?jurisdiction=US");
    expect(res.status).toBe(200);
    for (const r of res.body.results) expect(r.jurisdiction).toBe("US");
    const sections = res.body.results.map((r: { section: string }) => r.section);
    expect(sections).toContain("990003");
  });

  it("orders results by code then section", async () => {
    const res = await request(app).get("/api/statutes?jurisdiction=IN&limit=600");
    expect(res.status).toBe(200);
    const pairs = res.body.results.map(
      (r: { code: string; section: string }) => [r.code, r.section] as const,
    );
    const sorted = [...pairs].sort(
      (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
    );
    expect(pairs).toEqual(sorted);
  });

  it("applies the default limit of 100 when none is given", async () => {
    const res = await request(app).get("/api/statutes");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(100);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });

  it("clamps an oversized limit to the 600-row max without erroring", async () => {
    const res = await request(app).get("/api/statutes?limit=99999");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(600);
  });

  it("clamps a below-minimum limit up to 1", async () => {
    const res = await request(app).get("/api/statutes?limit=-5");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it("accepts open-ended code filters and returns empty for unknown codes", async () => {
    const res = await request(app).get("/api/statutes?code=NO-SUCH-ACT-9999");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
  });

  it("returns 400 for a malformed code filter (illegal characters)", async () => {
    const res = await request(app).get(`/api/statutes?code=${encodeURIComponent("bad code!")}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 for a non-numeric limit", async () => {
    const res = await request(app).get("/api/statutes?limit=abc");
    expect(res.status).toBe(400);
  });
});
