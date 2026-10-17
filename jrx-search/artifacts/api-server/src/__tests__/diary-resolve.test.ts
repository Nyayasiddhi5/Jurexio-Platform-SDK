import { describe, it, expect, vi, beforeEach } from "vitest";

const connect = vi.fn();

vi.mock("../lib/rdsPool", () => ({
  getRdsPool: async () => ({ connect }),
}));

vi.mock("../lib/rdsCaselaw", () => ({
  rdsBackendEnabled: () => true,
  searchRdsJudgments: vi.fn(async () => ({ total: 0, results: [] })),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  caselawDocumentsTable: {},
  sql: vi.fn(),
}));

const { resolveDiary } = await import("../lib/cnrResolve");

const makeTimeoutError = () =>
  Object.assign(new Error("canceling statement due to statement timeout"), {
    code: "57014",
  });

const scRow = {
  id: 99,
  court_type: "sc",
  court_code: null,
  court: "Supreme Court of India",
  bench: null,
  year: 2024,
  title: "Petitioner v Respondent",
  petitioner: "Petitioner",
  respondent: "Respondent",
  judges: "Hon Judge",
  citation: "(2024) 1 SCC 1",
  cnr: "SCIN0100012342024",
  case_type: null,
  case_no: "12345/2024",
  decision_date: "2024-06-01",
  disposal_nature: "Allowed",
  pet_advocate: null,
  res_advocate: null,
  fir_no: null,
  purpose_name: null,
  description: null,
  date_of_registration: null,
  pdf_link: "s3://bucket/path.pdf",
  source: "in-sc",
};

function makeClient(plan: { failSelects?: boolean; rows?: typeof scRow[] }) {
  const release = vi.fn();
  const query = vi.fn(async (text: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(text)) return { rows: [] };
    if (text.includes("cnr_case_details")) return { rows: [] };
    if (text.includes("cnr_resolve_metrics")) return { rows: [] };
    if (plan.failSelects && text.includes("FROM judgments")) {
      throw makeTimeoutError();
    }
    if (text.includes("FROM judgments")) {
      return { rows: plan.rows ?? [scRow] };
    }
    return { rows: [] };
  });
  return { query, release };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveDiary", () => {
  it("returns found for SC diary case_no match", async () => {
    connect.mockResolvedValue(makeClient({ rows: [scRow] }));
    const out = await resolveDiary({ diaryNumber: "12345/2024", courtType: "sc" });
    expect(out.status).toBe("found");
    expect(out.lookupType).toBe("diary");
    expect(out.diaryNumber).toBe("12345/2024");
    expect(out.cnr).toBe("SCIN0100012342024");
    expect(out.fields?.diaryNumber?.value).toBe("12345/2024");
  });

  it("returns invalid for bad diary shape", async () => {
    const out = await resolveDiary({ diaryNumber: "not-valid" });
    expect(out.status).toBe("invalid");
    expect(out.matchType).toBe("invalid");
  });

  it("throws upstream_busy after double RDS timeout", async () => {
    connect.mockResolvedValue(makeClient({ failSelects: true }));
    await expect(resolveDiary({ diaryNumber: "12345/2024" })).rejects.toMatchObject({
      code: "CNR_UPSTREAM_BUSY",
    });
  });
});
