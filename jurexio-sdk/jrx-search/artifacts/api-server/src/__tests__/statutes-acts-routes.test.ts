/**
 * Route-level tests for act-level browse:
 *   GET /api/statutes/acts  (grouped act list with search, jurisdiction +
 *   practice-area filters, per-act section counts, and totals)
 *
 * These pin act search matching (by actName and by code), the jurisdiction
 * and practiceArea filters, per-act section counts (rows grouped per
 * code+jurisdiction), actName ordering, total/totalSections accounting, the
 * practiceAreas facet, and 400 paths — so a future reseed, grouping change,
 * or schema change fails loudly instead of silently breaking the acts page.
 *
 * Fixtures carry a unique nonsense token ("zyxquactstest") in their code and
 * act name so assertions match only rows this suite inserted; the suite runs
 * green on both an empty dev DB and a fully seeded corpus. Only rows the
 * suite actually inserted are removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

const { db, statutesTable } = await import("@workspace/db");
const { default: app } = await import("../app");

const TOKEN = "zyxquactstest";
const ACT_A = `${TOKEN.toUpperCase()}-ALPHA-ACT-1999`;
const ACT_B = `${TOKEN.toUpperCase()}-BETA-ACT-2001`;
const ACT_US = `${TOKEN.toUpperCase()}-US-CODE`;
const PRACTICE_AREA = `${TOKEN}-corporate`;

type ActRow = {
  code: string;
  actName: string;
  jurisdiction: string;
  actYear: string | null;
  actNo: string | null;
  ministry: string | null;
  practiceArea: string | null;
  enactmentDate: string | null;
  sectionCount: number;
};

const FIXTURES = [
  // ACT_A: two sections → sectionCount 2, tagged with a unique practice area.
  {
    code: ACT_A,
    jurisdiction: "IN",
    section: "990101",
    heading: `Fixture ${TOKEN} alpha section one`,
    text: `${TOKEN} alpha act fixture section one.`,
    actName: `Zzz ${TOKEN} Alpha Act, 1999`,
    actYear: "1999",
    actNo: "42",
    ministry: "Ministry of Fixtures",
    practiceArea: PRACTICE_AREA,
    enactmentDate: "1999-01-15",
  },
  {
    code: ACT_A,
    jurisdiction: "IN",
    section: "990102",
    heading: `Fixture ${TOKEN} alpha section two`,
    text: `${TOKEN} alpha act fixture section two.`,
    actName: `Zzz ${TOKEN} Alpha Act, 1999`,
    actYear: "1999",
    actNo: "42",
    ministry: "Ministry of Fixtures",
    practiceArea: PRACTICE_AREA,
    enactmentDate: "1999-01-15",
  },
  // ACT_B: one section, no practice area, sorts after ACT_A by name.
  {
    code: ACT_B,
    jurisdiction: "IN",
    section: "990103",
    heading: `Fixture ${TOKEN} beta section`,
    text: `${TOKEN} beta act fixture single section.`,
    actName: `Zzz ${TOKEN} Beta Act, 2001`,
    actYear: "2001",
    actNo: null,
    ministry: null,
    practiceArea: null,
    enactmentDate: null,
  },
  // ACT_US: US jurisdiction, one section.
  {
    code: ACT_US,
    jurisdiction: "US",
    section: "990104",
    heading: `Fixture ${TOKEN} US section`,
    text: `${TOKEN} US fixture single section.`,
    actName: `Zzz ${TOKEN} United States Fixture Code`,
    actYear: null,
    actNo: null,
    ministry: null,
    practiceArea: null,
    enactmentDate: null,
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
        actName: f.actName,
        actYear: f.actYear,
        actNo: f.actNo,
        ministry: f.ministry,
        practiceArea: f.practiceArea,
        enactmentDate: f.enactmentDate,
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

function fixtureActs(body: { results: ActRow[] }): ActRow[] {
  return body.results.filter((a) => a.code.startsWith(TOKEN.toUpperCase()));
}

describe("GET /api/statutes/acts", () => {
  it("searches acts by name token and returns exact totals with section counts", async () => {
    const res = await request(app).get(`/api/statutes/acts?q=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.results).toHaveLength(3);
    // totalSections must sum per-act section counts (2 + 1 + 1).
    expect(res.body.totalSections).toBe(4);

    const byCode = new Map<string, ActRow>(
      res.body.results.map((a: ActRow) => [a.code, a]),
    );
    expect(byCode.get(ACT_A)?.sectionCount).toBe(2);
    expect(byCode.get(ACT_B)?.sectionCount).toBe(1);
    expect(byCode.get(ACT_US)?.sectionCount).toBe(1);
  });

  it("carries act metadata (year, number, ministry, practice area, enactment date)", async () => {
    const res = await request(app).get(`/api/statutes/acts?q=${TOKEN}`);
    expect(res.status).toBe(200);
    const alpha = res.body.results.find((a: ActRow) => a.code === ACT_A);
    expect(alpha).toBeDefined();
    expect(alpha.actName).toContain("Alpha Act");
    expect(alpha.jurisdiction).toBe("IN");
    expect(alpha.actYear).toBe("1999");
    expect(alpha.actNo).toBe("42");
    expect(alpha.ministry).toBe("Ministry of Fixtures");
    expect(alpha.practiceArea).toBe(PRACTICE_AREA);
    expect(alpha.enactmentDate).toBe("1999-01-15");
  });

  it("orders acts by act name", async () => {
    const res = await request(app).get(`/api/statutes/acts?q=${TOKEN}`);
    expect(res.status).toBe(200);
    const names = res.body.results.map((a: ActRow) => a.actName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    // Alpha must precede Beta specifically.
    const idxAlpha = res.body.results.findIndex((a: ActRow) => a.code === ACT_A);
    const idxBeta = res.body.results.findIndex((a: ActRow) => a.code === ACT_B);
    expect(idxAlpha).toBeLessThan(idxBeta);
  });

  it("matches acts by code as well as name", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${encodeURIComponent(ACT_B.toLowerCase())}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].code).toBe(ACT_B);
    expect(res.body.results[0].sectionCount).toBe(1);
  });

  it("applies the jurisdiction filter (IN excludes the US fixture)", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${TOKEN}&jurisdiction=IN`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const codes = res.body.results.map((a: ActRow) => a.code).sort();
    expect(codes).toEqual([ACT_A, ACT_B].sort());
    for (const a of res.body.results) expect(a.jurisdiction).toBe("IN");
    expect(res.body.totalSections).toBe(3);
  });

  it("applies the jurisdiction filter (US)", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${TOKEN}&jurisdiction=US`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].code).toBe(ACT_US);
    expect(res.body.results[0].jurisdiction).toBe("US");
  });

  it("applies the practiceArea filter", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${TOKEN}&practiceArea=${encodeURIComponent(PRACTICE_AREA)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].code).toBe(ACT_A);
    expect(res.body.results[0].practiceArea).toBe(PRACTICE_AREA);
    expect(res.body.totalSections).toBe(2);
  });

  it("combines jurisdiction and practiceArea filters", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${TOKEN}&jurisdiction=IN&practiceArea=${encodeURIComponent(PRACTICE_AREA)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].code).toBe(ACT_A);
  });

  it("exposes the practiceAreas facet computed before filters are applied", async () => {
    // Even when the practiceArea filter narrows results, the facet list still
    // includes every distinct practice area (it's the filter UI's source).
    const res = await request(app).get(
      `/api/statutes/acts?practiceArea=${encodeURIComponent(PRACTICE_AREA)}`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.practiceAreas)).toBe(true);
    expect(res.body.practiceAreas).toContain(PRACTICE_AREA);
    const sorted = [...res.body.practiceAreas].sort();
    expect(res.body.practiceAreas).toEqual(sorted);
  });

  it("lists all acts (fixtures included) when no filters are given", async () => {
    const res = await request(app).get("/api/statutes/acts");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.results.length);
    const mine = fixtureActs(res.body);
    expect(mine).toHaveLength(3);
    // totalSections must equal the sum of every returned act's sectionCount.
    const summed = res.body.results.reduce(
      (s: number, a: ActRow) => s + a.sectionCount,
      0,
    );
    expect(res.body.totalSections).toBe(summed);
  });

  it("returns an empty result set (not an error) for a no-match search", async () => {
    const res = await request(app).get(
      "/api/statutes/acts?q=qqzzunmatchableactstoken",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalSections).toBe(0);
  });

  it("returns an empty result set for an unknown practiceArea", async () => {
    const res = await request(app).get(
      "/api/statutes/acts?practiceArea=no-such-practice-area-9999",
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
  });

  it("respects an explicit limit while reporting the true totals", async () => {
    const res = await request(app).get(`/api/statutes/acts?q=${TOKEN}&limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    // Totals still reflect the full filtered set, not the page.
    expect(res.body.total).toBe(3);
    expect(res.body.totalSections).toBe(4);
    // Ordering preserved: the first act by name comes back.
    expect(res.body.results[0].code).toBe(ACT_A);
  });

  it("clamps a below-minimum limit up to 1", async () => {
    const res = await request(app).get(`/api/statutes/acts?q=${TOKEN}&limit=0`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.total).toBe(3);
  });

  it("clamps an oversized limit to the 1000-act max without erroring", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${TOKEN}&limit=99999`,
    );
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(1000);
    expect(res.body.total).toBe(3);
  });

  it("returns all acts when no limit is given (backward compatible)", async () => {
    const res = await request(app).get(`/api/statutes/acts?q=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(res.body.total);
  });

  it("returns 400 for a non-numeric limit", async () => {
    const res = await request(app).get(
      `/api/statutes/acts?q=${TOKEN}&limit=abc`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid jurisdiction", async () => {
    const res = await request(app).get("/api/statutes/acts?jurisdiction=UK");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 for an empty q", async () => {
    const res = await request(app).get("/api/statutes/acts?q=");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty practiceArea", async () => {
    const res = await request(app).get("/api/statutes/acts?practiceArea=");
    expect(res.status).toBe(400);
  });
});
