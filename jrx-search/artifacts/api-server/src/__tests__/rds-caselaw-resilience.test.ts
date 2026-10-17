import { describe, it, expect, vi, beforeEach } from "vitest";

const connect = vi.fn();

vi.mock("../lib/rdsPool", () => ({
  getRdsPool: async () => ({ connect }),
}));

const { searchRdsJudgments } = await import("../lib/rdsCaselaw");

const makeTimeoutError = () =>
  Object.assign(new Error("canceling statement due to statement timeout"), {
    code: "57014",
  });

const sampleRow = {
  id: 1,
  court_type: "sc",
  court: "Supreme Court",
  bench_name: null,
  year: 2020,
  title: "A v B",
  petitioner: null,
  respondent: null,
  judges: null,
  author_judge: null,
  citation: null,
  cnr: null,
  case_type: null,
  case_no: null,
  judicial_section: null,
  decision_date: null,
  disposal_nature: null,
  languages: null,
  description: null,
  pdf_link: null,
  source: "in-sc",
};

/** Builds a mock pooled client whose SELECT queries behave per `plan`. */
function makeClient(plan: { failSelects?: boolean; count?: number }) {
  const release = vi.fn();
  const query = vi.fn(async (text: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(text)) return { rows: [] };
    if (plan.failSelects) throw makeTimeoutError();
    if (text.includes("count(*)")) {
      return { rows: [{ count: plan.count ?? 1 }] };
    }
    return { rows: [sampleRow] };
  });
  return { query, release };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchRdsJudgments resilience", () => {
  it("returns results and exact total on a normal query", async () => {
    const client = makeClient({ count: 42 });
    connect.mockResolvedValue(client);
    const out = await searchRdsJudgments({ q: "bail" });
    expect(out.total).toBe(42);
    expect(out.totalCapped).toBe(false);
    expect(out.results).toHaveLength(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    const calls = client.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((t) => t.includes("SET LOCAL statement_timeout"))).toBe(
      true,
    );
  });

  it("flags totalCapped when the count hits the cap", async () => {
    connect.mockResolvedValue(makeClient({ count: 10000 }));
    const out = await searchRdsJudgments({ q: "bail" });
    expect(out.total).toBe(10000);
    expect(out.totalCapped).toBe(true);
  });

  it("retries once on statement_timeout, then succeeds", async () => {
    const failing = makeClient({ failSelects: true });
    const ok = makeClient({ count: 3 });
    connect.mockResolvedValueOnce(failing).mockResolvedValueOnce(ok);
    const out = await searchRdsJudgments({ q: "bail" });
    expect(out.total).toBe(3);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(failing.release).toHaveBeenCalledTimes(1);
    expect(ok.release).toHaveBeenCalledTimes(1);
  });

  it("returns empty degraded envelope when all attempts time out", async () => {
    connect.mockImplementation(async () => makeClient({ failSelects: true }));
    const out = await searchRdsJudgments({ q: "bail" });
    expect(out.degraded).toBe(true);
    expect(out.degradedReason).toBe("corpus_busy");
    expect(out.results).toEqual([]);
    expect(out.total).toBe(0);
    expect(connect.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not retry or wrap a non-timeout error", async () => {
    const other = Object.assign(new Error("dup"), { code: "23505" });
    const client = makeClient({});
    client.query.mockImplementation(async (text: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(text)) return { rows: [] };
      throw other;
    });
    connect.mockResolvedValue(client);
    await expect(searchRdsJudgments({ q: "bail" })).rejects.toBe(other);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
