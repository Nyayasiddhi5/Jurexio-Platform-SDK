/**
 * Pins the empty-corpus hint behavior of searchIndianCaselaw:
 *   - zero-result search on an EMPTY corpus → `message` with the seed:caselaw command
 *   - zero-result search on a NON-EMPTY corpus → no `message`
 *   - the emptiness check failing must never error the search (hint just omitted)
 *   - non-zero results → the emptiness check isn't even consulted
 *
 * Uses a mocked @workspace/db so the corpus can be made "empty" without
 * touching the real dev table. Route-level passthrough is pinned separately
 * in caselaw-search-routes.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const transaction = vi.fn();
const limitMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    transaction,
    select: () => ({ from: () => ({ limit: limitMock }) }),
  },
  caselawDocumentsTable: {
    title: "title",
    petitioner: "petitioner",
    respondent: "respondent",
    description: "description",
    citation: "citation",
    year: "year",
    id: "id",
  },
}));

const { searchIndianCaselaw } = await import("../lib/caselaw");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchIndianCaselaw empty-corpus hint", () => {
  it("adds the seed:caselaw hint when the search is empty AND the corpus is empty", async () => {
    transaction.mockResolvedValue({ total: 0, results: [] });
    limitMock.mockResolvedValue([]); // corpus has zero rows
    const out = await searchIndianCaselaw({ q: "bail" });
    expect(out.total).toBe(0);
    expect(out.results).toEqual([]);
    expect(out.message).toBeDefined();
    expect(out.message).toContain("not seeded");
    expect(out.message).toContain(
      "pnpm --filter @workspace/api-server run seed:caselaw",
    );
  });

  it("omits the hint for a zero-result search on a seeded (non-empty) corpus", async () => {
    transaction.mockResolvedValue({ total: 0, results: [] });
    limitMock.mockResolvedValue([{ one: 1 }]); // corpus has rows
    const out = await searchIndianCaselaw({ q: "qqzzunmatchabletoken" });
    expect(out.total).toBe(0);
    expect(out.message).toBeUndefined();
    expect(out).not.toHaveProperty("message");
  });

  it("never errors the search when the emptiness check itself fails", async () => {
    transaction.mockResolvedValue({ total: 0, results: [] });
    limitMock.mockRejectedValue(new Error("connection lost"));
    const out = await searchIndianCaselaw({ q: "bail" });
    expect(out.total).toBe(0);
    expect(out.results).toEqual([]);
    expect(out.message).toBeUndefined();
  });

  it("does not consult the emptiness check when the search has results", async () => {
    transaction.mockResolvedValue({ total: 3, results: [{ id: 1 }] });
    const out = await searchIndianCaselaw({ q: "bail" });
    expect(out.total).toBe(3);
    expect(out.message).toBeUndefined();
    expect(limitMock).not.toHaveBeenCalled();
  });
});
