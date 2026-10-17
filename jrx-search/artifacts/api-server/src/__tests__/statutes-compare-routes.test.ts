/**
 * Route-level tests for the statute comparator endpoints:
 *   GET /api/statutes/compare/ipc-bns   (IPC → BNS)
 *   GET /api/statutes/compare/old-new   (CrPC → BNSS, IEA → BSA)
 *   GET /api/statutes/compare/new-old   (BNSS → CrPC, BSA → IEA, BNS → IPC)
 *
 * These pin known official NCRB mappings (BNSS 482 ↔ CrPC 438,
 * BNS 318 ↔ IPC 415/417/418/420, BSA 63 ↔ IEA 65B) so a future mapping
 * reseed or schema change that breaks either direction fails loudly.
 *
 * Fixtures are upserted into the statutes table (same rows the real seed
 * produces) and only rows this suite inserted are removed afterwards, so the
 * suite works both on an empty dev DB and on a fully seeded corpus.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

const { db, statutesTable } = await import("@workspace/db");
const { default: app } = await import("../app");

type Fixture = {
  code: string;
  section: string;
  heading: string;
  text: string;
  mappedCode: string | null;
  mappedSections: string[];
  changeNotes: string | null;
};

const fx = (
  code: string,
  section: string,
  heading: string,
  mappedCode: string | null = null,
  mappedSections: string[] = [],
  changeNotes: string | null = null,
): Fixture => ({
  code,
  section,
  heading,
  text: `${code} Section ${section} — ${heading}. Fixture text for comparator route tests.`,
  mappedCode,
  mappedSections,
  changeNotes,
});

const FIXTURES: Fixture[] = [
  // IPC → BNS mapping lives on the IPC rows (official NCRB direction).
  fx("IPC", "415", "Cheating", "BNS", ["318(1)"]),
  fx("IPC", "417", "Punishment for cheating", "BNS", ["318(2)"]),
  fx(
    "IPC",
    "418",
    "Cheating with knowledge that wrongful loss may ensue",
    "BNS",
    ["318(3)"],
  ),
  fx(
    "IPC",
    "420",
    "Cheating and dishonestly inducing delivery of property",
    "BNS",
    ["318(4)"],
    "Renumbered as BNS 318(4); substance unchanged.",
  ),
  fx("BNS", "318(1)", "Cheating — definition"),
  fx("BNS", "318(2)", "Cheating — punishment"),
  fx("BNS", "318(3)", "Cheating — wrongful loss"),
  fx("BNS", "318(4)", "Cheating and dishonestly inducing delivery of property"),
  // BNSS/BSA rows carry the new→old mapping directly.
  fx("BNSS", "482", "Direction for grant of bail to person apprehending arrest", "CrPC", ["438"]),
  fx("BSA", "63", "Admissibility of electronic records", "IEA", ["65B"]),
];

const insertedIds: number[] = [];

beforeAll(async () => {
  for (const f of FIXTURES) {
    const rows = await db
      .insert(statutesTable)
      .values({
        code: f.code,
        jurisdiction: "IN",
        section: f.section,
        heading: f.heading,
        text: f.text,
        mappedCode: f.mappedCode,
        mappedSections: f.mappedSections,
        changeNotes: f.changeNotes,
      })
      .onConflictDoNothing()
      .returning({ id: statutesTable.id });
    // Only track rows we actually inserted; pre-seeded corpus rows are left alone.
    for (const r of rows) insertedIds.push(r.id);
  }
});

afterAll(async () => {
  if (insertedIds.length > 0) {
    await db.delete(statutesTable).where(inArray(statutesTable.id, insertedIds));
  }
});

describe("GET /api/statutes/compare/ipc-bns", () => {
  it("maps IPC 420 to BNS 318(4) with side-by-side text and change notes", async () => {
    const res = await request(app).get("/api/statutes/compare/ipc-bns?section=420");
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.ipcSection).toBe("420");
    expect(res.body.ipc.code).toBe("IPC");
    expect(res.body.ipc.section).toBe("420");
    expect(res.body.ipc.mappedCode).toBe("BNS");
    expect(res.body.ipc.mappedSections).toContain("318(4)");
    const bnsSections = res.body.bnsMatches.map((m: { section: string }) => m.section);
    expect(bnsSections).toContain("318(4)");
    for (const m of res.body.bnsMatches) {
      expect(m.code).toBe("BNS");
      expect(m.text.length).toBeGreaterThan(0);
    }
  });

  it("returns 404 for an IPC section not in the corpus", async () => {
    const res = await request(app).get("/api/statutes/compare/ipc-bns?section=999999");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/999999/);
  });

  it("returns 400 when section is missing", async () => {
    const res = await request(app).get("/api/statutes/compare/ipc-bns");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});

describe("GET /api/statutes/compare/old-new", () => {
  it("maps CrPC 438 (anticipatory bail) to BNSS 482", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/old-new?from=CrPC&section=438",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.oldCode).toBe("CrPC");
    expect(res.body.newCode).toBe("BNSS");
    expect(res.body.oldSection).toBe("438");
    const sections = res.body.matches.map((m: { section: string }) => m.section);
    expect(sections).toContain("482");
    for (const m of res.body.matches) expect(m.code).toBe("BNSS");
  });

  it("maps IEA 65B (electronic records) to BSA 63", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/old-new?from=IEA&section=65B",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.oldCode).toBe("IEA");
    expect(res.body.newCode).toBe("BSA");
    const sections = res.body.matches.map((m: { section: string }) => m.section);
    expect(sections).toContain("63");
  });

  it("normalizes lowercase section input (65b → 65B)", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/old-new?from=IEA&section=65b",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.oldSection).toBe("65B");
  });

  it("returns 404 for an old-code section with no mapping", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/old-new?from=CrPC&section=999999",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/999999/);
    expect(res.body.error).toMatch(/BNSS/);
  });

  it("returns 400 for an unsupported from code", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/old-new?from=IPC&section=420",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 when from is missing", async () => {
    const res = await request(app).get("/api/statutes/compare/old-new?section=438");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/statutes/compare/new-old", () => {
  it("maps BNSS 482 back to CrPC 438 via the row's own mapping", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=BNSS&section=482",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.newCode).toBe("BNSS");
    expect(res.body.oldCode).toBe("CrPC");
    expect(res.body.newSection).toBe("482");
    expect(res.body.statute).not.toBeNull();
    expect(res.body.statute.section).toBe("482");
    expect(res.body.oldSections).toContain("438");
  });

  it("maps BSA 63 back to IEA 65B", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=BSA&section=63",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.oldCode).toBe("IEA");
    expect(res.body.oldSections).toContain("65B");
  });

  it("maps BNS 318 back to IPC 415/417/418/420 via reverse query on IPC rows", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=BNS&section=318",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.newCode).toBe("BNS");
    expect(res.body.oldCode).toBe("IPC");
    expect(res.body.oldSections).toEqual(
      expect.arrayContaining(["415", "417", "418", "420"]),
    );
    const matchSections = res.body.matches.map((m: { section: string }) => m.section);
    expect(matchSections).toEqual(
      expect.arrayContaining(["415", "417", "418", "420"]),
    );
    for (const m of res.body.matches) expect(m.code).toBe("IPC");
  });

  it("maps a subsection query BNS 318(4) back to IPC 420", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=BNS&section=318(4)",
    );
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.oldSections).toContain("420");
  });

  it("returns 404 for a new-code section with no mapping", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=BNSS&section=999999",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/999999/);
  });

  it("returns 400 for an unsupported from code", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=CrPC&section=438",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("returns 400 when section is empty", async () => {
    const res = await request(app).get(
      "/api/statutes/compare/new-old?from=BNS&section=",
    );
    expect(res.status).toBe(400);
  });
});
