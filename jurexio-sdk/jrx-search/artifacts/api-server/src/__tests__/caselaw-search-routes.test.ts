/**
 * Route-level tests for GET /api/caselaw/search (IN, local-corpus backend),
 * pinning the empty-corpus hint contract end to end:
 *   - seeded corpus → zero-result queries return NO `message` field
 *   - empty corpus (searchIndianCaselaw returns a hint) → the route passes
 *     `message` through verbatim in the JSON body
 *
 * A fixture judgment with a unique nonsense token guarantees the corpus is
 * non-empty, so the suite runs green on both an empty dev DB and the fully
 * seeded 43k corpus. The empty-corpus path is exercised by stubbing
 * searchIndianCaselaw for one test (the real dev table can't be emptied);
 * the hint-generation logic itself is unit-tested in
 * caselaw-empty-corpus.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

vi.mock("../lib/caselaw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/caselaw")>();
  return {
    ...actual,
    searchIndianCaselaw: vi.fn(actual.searchIndianCaselaw),
  };
});

const { db, caselawDocumentsTable } = await import("@workspace/db");
const caselawLib = await import("../lib/caselaw");
const { default: app } = await import("../app");

const searchIndianCaselawMock = vi.mocked(caselawLib.searchIndianCaselaw);

const TOKEN = "zyxqutestcase";
const insertedIds: number[] = [];

beforeAll(async () => {
  const rows = await db
    .insert(caselawDocumentsTable)
    .values({
      jurisdiction: "IN",
      source: "test-fixture",
      title: `Fixture ${TOKEN} v. State of Testing`,
      petitioner: `Fixture ${TOKEN}`,
      respondent: "State of Testing",
      description: `Route-test fixture judgment mentioning ${TOKEN}.`,
      year: 2099,
      languages: [],
    })
    .returning({ id: caselawDocumentsTable.id });
  for (const r of rows) insertedIds.push(r.id);
});

afterAll(async () => {
  if (insertedIds.length > 0) {
    await db
      .delete(caselawDocumentsTable)
      .where(inArray(caselawDocumentsTable.id, insertedIds));
  }
});

describe("GET /api/caselaw/search (IN)", () => {
  // The first FTS query against the seeded 43k corpus can exceed vitest's 5s
  // default when other validation suites hammer the same dev DB in parallel.
  it("finds the fixture judgment via FTS", { timeout: 30_000 }, async () => {
    const res = await request(app).get(
      `/api/caselaw/search?jurisdiction=IN&q=${TOKEN}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.jurisdiction).toBe("IN");
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].title).toContain(TOKEN);
  });

  it("returns NO message field for a zero-result query on a seeded corpus", async () => {
    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=IN&q=qqzzunmatchabletoken",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
    expect(res.body).not.toHaveProperty("message");
  });

  it("passes the empty-corpus hint through as `message` when the corpus is empty", async () => {
    const hint =
      "The local Indian caselaw corpus is not seeded, so search returns no results. " +
      "Run: pnpm --filter @workspace/api-server run seed:caselaw";
    searchIndianCaselawMock.mockResolvedValueOnce({
      total: 0,
      results: [],
      message: hint,
    });
    const res = await request(app).get(
      "/api/caselaw/search?jurisdiction=IN&q=bail",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
    expect(res.body.message).toBe(hint);
    expect(res.body.message).toContain("seed:caselaw");
  });
});
