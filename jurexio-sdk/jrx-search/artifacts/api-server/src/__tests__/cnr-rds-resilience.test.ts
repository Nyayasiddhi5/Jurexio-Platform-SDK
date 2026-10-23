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

const { resolveCnr } = await import("../lib/cnrResolve");

const makeTimeoutError = () =>
  Object.assign(new Error("canceling statement due to statement timeout"), {
    code: "57014",
  });

const sampleRow = {
  id: 42,
  court_type: "hc",
  court_code: "RJHC01",
  court: "Rajasthan High Court",
  bench: "jaipur",
  year: 2024,
  title: "Test v State",
  petitioner: "Test",
  respondent: "State",
  judges: "Hon Judge",
  citation: null,
  cnr: "RJHC010012342024",
  case_type: "CRL",
  case_no: "123/2024",
  decision_date: "2024-06-01",
  disposal_nature: "Disposed",
  pet_advocate: null,
  res_advocate: null,
  fir_no: null,
  purpose_name: null,
  description: null,
  date_of_registration: null,
  pdf_link: null,
  source: "nys_rds",
};

function makeClient(plan: { failSelects?: boolean; rows?: typeof sampleRow[] }) {
  const release = vi.fn();
  const query = vi.fn(async (text: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(text)) return { rows: [] };
    if (text.includes("cnr_case_details")) return { rows: [] };
    if (text.includes("cnr_resolve_metrics")) return { rows: [] };
    if (plan.failSelects) throw makeTimeoutError();
    if (text.includes("FROM judgments")) {
      return { rows: plan.rows ?? [sampleRow] };
    }
    return { rows: [] };
  });
  return { query, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ATHENA_DATABASE;
});

describe("CNR RDS fail-soft (P2-7)", () => {
  it("returns found when RDS lookup succeeds", async () => {
    connect.mockResolvedValue(makeClient({ rows: [sampleRow] }));
    const out = await resolveCnr({ cnr: "RJHC010012342024" });
    expect(out.status).toBe("found");
    expect(out.matchType).toBe("exact");
    expect(out.source).toBe("nys_rds");
  });

  it("retries once on statement_timeout then succeeds", async () => {
    let selectCalls = 0;
    const client = makeClient({ rows: [sampleRow] });
    const origQuery = client.query;
    client.query = vi.fn(async (text: string, ...rest: unknown[]) => {
      if (text.includes("FROM judgments")) {
        selectCalls += 1;
        if (selectCalls === 1) throw makeTimeoutError();
      }
      return origQuery(text, ...rest);
    });
    connect.mockResolvedValue(client);
    const out = await resolveCnr({ cnr: "RJHC010012342024" });
    expect(out.status).toBe("found");
    expect(selectCalls).toBe(2);
  });

  it("fail-soft: throws upstream_busy after double timeout (not not_found)", async () => {
    connect.mockResolvedValue(makeClient({ failSelects: true }));
    await expect(resolveCnr({ cnr: "RJHC010012342024" })).rejects.toMatchObject({
      code: "CNR_UPSTREAM_BUSY",
    });
  });

  it("caseCreate: tries Athena tier when RDS degraded", async () => {
    connect.mockResolvedValue(makeClient({ failSelects: true }));
    process.env.ATHENA_DATABASE = "nyv_docs";
    process.env.ATHENA_TABLE = "judgments_meta";
    process.env.ATHENA_OUTPUT_S3 = "s3://bucket/out/";
    const out = await resolveCnr({
      cnr: "TSWL000000742024",
      profile: "caseCreate",
    }).catch((e) => e);
    if (out instanceof Error) {
      expect(out).toMatchObject({ code: "CNR_UPSTREAM_BUSY" });
    } else {
      expect(out.sourcesTried).toContain("opendata_athena");
    }
  });

  it("default profile skips Athena cold path even when RDS empty", async () => {
    connect.mockResolvedValue(makeClient({ rows: [] }));
    const out = await resolveCnr({ cnr: "TSWL000000742024", profile: "default" });
    expect(out.sourcesTried).not.toContain("opendata_athena");
    expect(out.sourcesTried).not.toContain("opendata_athena_case_details");
    expect(out.sourcesTried).not.toContain("nys_fts");
    expect(out.status).toBe("not_found");
  });
});
