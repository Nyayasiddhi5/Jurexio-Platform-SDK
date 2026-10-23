import { describe, it, expect, vi, beforeEach } from "vitest";

const transaction = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { transaction },
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

const { searchIndianCaselaw, CorpusBusyError, isStatementTimeout } =
  await import("../lib/caselaw");

const makeTimeoutError = () => Object.assign(new Error("canceling statement due to statement timeout"), {
  code: "57014",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isStatementTimeout", () => {
  it("recognises Postgres query_canceled (57014)", () => {
    expect(isStatementTimeout(makeTimeoutError())).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isStatementTimeout(new Error("boom"))).toBe(false);
    expect(isStatementTimeout({ code: "23505" })).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
  });
});

describe("searchIndianCaselaw resilience", () => {
  it("returns results on a normal query", async () => {
    transaction.mockResolvedValue({ total: 1, results: [{ id: 1 }] });
    const out = await searchIndianCaselaw({ q: "bail" });
    expect(out.total).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first attempt times out, then succeeds", async () => {
    transaction
      .mockRejectedValueOnce(makeTimeoutError())
      .mockResolvedValueOnce({ total: 2, results: [{ id: 1 }, { id: 2 }] });
    const out = await searchIndianCaselaw({ q: "bail" });
    expect(out.total).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("throws CorpusBusyError when both attempts time out", async () => {
    transaction.mockRejectedValue(makeTimeoutError());
    await expect(searchIndianCaselaw({ q: "bail" })).rejects.toBeInstanceOf(
      CorpusBusyError,
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry or wrap a non-timeout error", async () => {
    const other = Object.assign(new Error("dup"), { code: "23505" });
    transaction.mockRejectedValue(other);
    await expect(searchIndianCaselaw({ q: "bail" })).rejects.toBe(other);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-timeout error surfaced only on the retry", async () => {
    const other = Object.assign(new Error("dup"), { code: "23505" });
    transaction
      .mockRejectedValueOnce(makeTimeoutError())
      .mockRejectedValueOnce(other);
    await expect(searchIndianCaselaw({ q: "bail" })).rejects.toBe(other);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
