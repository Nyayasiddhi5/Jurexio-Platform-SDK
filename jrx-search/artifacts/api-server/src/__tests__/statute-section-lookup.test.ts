/**
 * Direct coverage for the exact-section lookup helper `getStatuteBySection`
 * (lib/statutes.ts) plus the retrieval router's statute path that depends on
 * it (`POST /api/retrieve` with e.g. "IPC 420").
 *
 * The helper powers chat statute answers; its exact-match + prefix-fallback
 * logic ("318" finds "318(4)" and vice versa, case/whitespace normalization)
 * was previously only exercised indirectly through the comparator routes, so
 * a reseed or schema change could break it without a direct test failing.
 *
 * Fixtures use high 990xxx section numbers that never occur in the real
 * corpus, so the suite runs green on both an empty dev DB and a fully
 * seeded corpus. Only rows the suite actually inserted are removed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

const { db, statutesTable } = await import("@workspace/db");
const { getStatuteBySection } = await import("../lib/statutes");
const { default: app } = await import("../app");

type Fixture = {
  code: string;
  jurisdiction: string;
  section: string;
  heading: string;
  text: string;
};

const FIXTURES: Fixture[] = [
  {
    code: "IPC",
    jurisdiction: "IN",
    section: "990420",
    heading: "Fixture cheating provision",
    text: "Exact-section lookup fixture for the retrieval router statute path.",
  },
  {
    // Only the subsection exists — base lookup must prefix-match it.
    code: "BNS",
    jurisdiction: "IN",
    section: "990319(4)",
    heading: "Fixture subsection-only provision",
    text: "Prefix fallback fixture: base section query must find this subsection row.",
  },
  {
    // Only the base exists — subsection lookup must prefix-match it.
    code: "BNS",
    jurisdiction: "IN",
    section: "990320",
    heading: "Fixture base-only provision",
    text: "Prefix fallback fixture: subsection query must find this base row.",
  },
  {
    // Uppercase letter suffix — lookups must normalize case and whitespace.
    code: "BNS",
    jurisdiction: "IN",
    section: "990321A",
    heading: "Fixture letter-suffix provision",
    text: "Normalization fixture: lowercase and padded queries must resolve this row.",
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

describe("getStatuteBySection", () => {
  it("returns an exact match with the full StatuteOut shape", async () => {
    const row = await getStatuteBySection("IPC", "990420");
    expect(row).not.toBeNull();
    expect(row!.code).toBe("IPC");
    expect(row!.section).toBe("990420");
    expect(row!.heading).toBe("Fixture cheating provision");
    expect(typeof row!.id).toBe("number");
    expect(Array.isArray(row!.mappedSections)).toBe(true);
  });

  it("falls back to a subsection row when only the base is queried (990319 -> 990319(4))", async () => {
    const row = await getStatuteBySection("BNS", "990319");
    expect(row).not.toBeNull();
    expect(row!.section).toBe("990319(4)");
  });

  it("falls back to the base row when a subsection is queried (990320(2) -> 990320)", async () => {
    const row = await getStatuteBySection("BNS", "990320(2)");
    expect(row).not.toBeNull();
    expect(row!.section).toBe("990320");
  });

  it("prefers the exact match over prefix candidates", async () => {
    // "990319(4)" exists exactly; exact match must win, not prefix scan.
    const row = await getStatuteBySection("BNS", "990319(4)");
    expect(row).not.toBeNull();
    expect(row!.section).toBe("990319(4)");
  });

  it("normalizes lowercase section letters (990321a -> 990321A)", async () => {
    const row = await getStatuteBySection("BNS", "990321a");
    expect(row).not.toBeNull();
    expect(row!.section).toBe("990321A");
  });

  it("trims surrounding whitespace in the section query", async () => {
    const row = await getStatuteBySection("BNS", "  990321A  ");
    expect(row).not.toBeNull();
    expect(row!.section).toBe("990321A");
  });

  it("scopes the lookup to the given code", async () => {
    // Section exists under IPC only; asking for it under BNS must miss.
    const row = await getStatuteBySection("BNS", "990420");
    expect(row).toBeNull();
  });

  it("returns null for a section that exists nowhere", async () => {
    const row = await getStatuteBySection("IPC", "990999");
    expect(row).toBeNull();
  });
});

describe("POST /api/retrieve — statute-lookup path", () => {
  it("resolves an exact-section query (IPC 990420) deterministically without an LLM", async () => {
    const res = await request(app)
      .post("/api/retrieve")
      .send({ query: "IPC 990420" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("statute");
    expect(res.body.llmRequired).toBe(false);
    const step = res.body.steps.find(
      (s: { tool: string }) => s.tool === "statute-lookup",
    );
    expect(step).toBeDefined();
    expect(step.statutes).toHaveLength(1);
    expect(step.statutes[0].code).toBe("IPC");
    expect(step.statutes[0].section).toBe("990420");
  });

  it("resolves 'section N of the IPC' phrasing through the same path", async () => {
    const res = await request(app)
      .post("/api/retrieve")
      .send({ query: "section 990420 of the IPC" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("statute");
    const step = res.body.steps.find(
      (s: { tool: string }) => s.tool === "statute-lookup",
    );
    expect(step.statutes[0].section).toBe("990420");
  });

  it("uses the prefix fallback on the route (BNS 990319 -> 990319(4))", async () => {
    const res = await request(app)
      .post("/api/retrieve")
      .send({ query: "BNS 990319" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("statute");
    expect(res.body.llmRequired).toBe(false);
    const step = res.body.steps.find(
      (s: { tool: string }) => s.tool === "statute-lookup",
    );
    expect(step.statutes[0].section).toBe("990319(4)");
  });
});
