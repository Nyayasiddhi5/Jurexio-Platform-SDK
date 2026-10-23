/**
 * Unit tests for the RRF fusion + vector distance-cutoff logic in
 * searchStatutes (src/lib/statutes.ts). The route suite
 * (statutes-search-routes.test.ts) pins FTS behavior; this suite pins the
 * hybrid branch explicitly:
 *   - a semantically-similar (shared-token) embedded row is fused in and the
 *     response reports method=hybrid_rrf
 *   - the cosine-distance cutoff (0.5 for the dev hash embedder) excludes
 *     noise rows the KNN would otherwise surface
 *   - when every vector candidate is beyond the cutoff, the search degrades
 *     to method=fts
 *   - a vector-branch failure (embedText throws) degrades to method=fts with
 *     FTS results intact — never an error
 *
 * Fixtures use a dedicated code (ZZRRF) so both legs are scoped to rows this
 * suite inserted; embeddings are the deterministic dev hash vectors, so
 * distances are stable: the shared-token query sits ~0.45 from the similar
 * row (inside the 0.5 cutoff) and ~0.96 from the noise row (outside it).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray, sql } from "drizzle-orm";

// Toggleable embed failure: the mock delegates to the real hash embedder
// unless a test flips the flag, letting us exercise the catch branch.
let failEmbed = false;
vi.mock("../lib/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/embeddings")>();
  return {
    ...actual,
    embedText: async (text: string) => {
      if (failEmbed) throw new Error("simulated embedding failure");
      return actual.embedText(text);
    },
  };
});

const { db, statutesTable } = await import("@workspace/db");
const { hashEmbed, statuteEmbeddingText } = await import("../lib/embeddings");
const { searchStatutes, clearStatuteCoverageCache } = await import(
  "../lib/statutes"
);

const CODE = "ZZRRF";
const TOKEN = "zyxqurrffusion";
const FTS_ONLY_TOKEN = "zyxqurrfplainfts";

/** Query sharing tokens with the similar row (hash distance ~0.45 < 0.5). */
const SHARED_TOKEN_QUERY = `cheating dishonest inducement delivery of property ${TOKEN}`;

const FIXTURES = [
  {
    section: "990101",
    heading: `Fixture ${TOKEN} cheating provision`,
    text: `${TOKEN} ${TOKEN} — cheating by dishonest inducement, delivery of property, fusion test fixture.`,
    embed: true,
  },
  {
    section: "990102",
    heading: "Maritime lighthouse dues fixture",
    text: "Levying of lighthouse dues on ships arriving at ports, maritime administration noise fixture.",
    embed: true,
  },
  {
    section: "990103",
    heading: `Fixture ${FTS_ONLY_TOKEN} unembedded provision`,
    text: `${FTS_ONLY_TOKEN} unembedded provision — matched only by full-text search, never by the vector leg.`,
    embed: false,
  },
];

const insertedIds: number[] = [];

beforeAll(async () => {
  for (const f of FIXTURES) {
    const rows = await db
      .insert(statutesTable)
      .values({
        code: CODE,
        jurisdiction: "IN",
        section: f.section,
        heading: f.heading,
        text: f.text,
        mappedSections: [],
      })
      .onConflictDoNothing()
      .returning({ id: statutesTable.id });
    for (const r of rows) insertedIds.push(r.id);
  }
  // Pre-computed deterministic hash embeddings for the embedded fixtures.
  for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i]!;
    if (!f.embed) continue;
    const emb = hashEmbed(
      statuteEmbeddingText({
        code: CODE,
        section: f.section,
        heading: f.heading,
        text: f.text,
      }),
    );
    await db.execute(
      sql`UPDATE statutes SET embedding = ${`[${emb.join(",")}]`}::vector WHERE id = ${insertedIds[i]!}`,
    );
  }
});

afterAll(async () => {
  failEmbed = false;
  if (insertedIds.length > 0) {
    await db.delete(statutesTable).where(inArray(statutesTable.id, insertedIds));
  }
});

describe("searchStatutes hybrid RRF fusion", () => {
  it("fuses the semantically-similar embedded row and reports method=hybrid_rrf", async () => {
    const res = await searchStatutes({ q: SHARED_TOKEN_QUERY, code: CODE });
    expect(res.method).toBe("hybrid_rrf");
    const sections = res.results.map((r) => r.section);
    expect(sections).toContain("990101");
    // The similar row matches both legs (FTS token + vector), so it must
    // outrank everything else under RRF (two 1/(k+rank) contributions).
    expect(res.results[0]!.section).toBe("990101");
  });

  it("distance cutoff excludes noise rows the KNN would otherwise return", async () => {
    // The noise row IS a KNN candidate (a KNN always returns something) but
    // sits ~0.96 cosine distance from the query — beyond the 0.5 dev cutoff —
    // and shares no FTS tokens, so it must not appear at all.
    const res = await searchStatutes({ q: SHARED_TOKEN_QUERY, code: CODE });
    expect(res.method).toBe("hybrid_rrf");
    const sections = res.results.map((r) => r.section);
    expect(sections).not.toContain("990102");
  });

  it("degrades to method=fts when every vector candidate is beyond the cutoff", async () => {
    // This query FTS-matches only the unembedded row; both embedded rows are
    // > 0.5 away, so the filtered vector list is empty → pure FTS path.
    const res = await searchStatutes({
      q: `${FTS_ONLY_TOKEN} unembedded provision`,
      code: CODE,
    });
    expect(res.method).toBe("fts");
    expect(res.total).toBe(1);
    expect(res.results.map((r) => r.section)).toEqual(["990103"]);
  });

  it("degrades to method=fts with FTS results intact when the vector branch throws", async () => {
    failEmbed = true;
    try {
      const res = await searchStatutes({ q: SHARED_TOKEN_QUERY, code: CODE });
      expect(res.method).toBe("fts");
      // FTS still finds the token-bearing row; the failure never blocks.
      expect(res.results.map((r) => r.section)).toContain("990101");
      expect(res.total).toBeGreaterThanOrEqual(1);
    } finally {
      failEmbed = false;
    }
  });

  it("recovers to hybrid_rrf after a transient vector failure (no sticky state)", async () => {
    const res = await searchStatutes({ q: SHARED_TOKEN_QUERY, code: CODE });
    expect(res.method).toBe("hybrid_rrf");
  });

  it("reports total as at least the fused result count", async () => {
    const res = await searchStatutes({ q: SHARED_TOKEN_QUERY, code: CODE });
    expect(res.total).toBeGreaterThanOrEqual(res.results.length);
  });

  it("exposes corpus-wide embedding coverage metadata (drift visibility)", async () => {
    clearStatuteCoverageCache();
    const res = await searchStatutes({ q: SHARED_TOKEN_QUERY, code: CODE });
    const cov = res.embeddingCoverage;
    expect(cov).toBeDefined();
    expect(cov.total).toBeGreaterThanOrEqual(3); // at least our fixtures
    expect(cov.embedded + cov.unembedded).toBe(cov.total);
    // Fixture 990103 is deliberately unembedded, so drift must be visible.
    expect(cov.unembedded).toBeGreaterThanOrEqual(1);
    expect(cov.coveragePct).toBeGreaterThanOrEqual(0);
    expect(cov.coveragePct).toBeLessThanOrEqual(100);
  });
});
