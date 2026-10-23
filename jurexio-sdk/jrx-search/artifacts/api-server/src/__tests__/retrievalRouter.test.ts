import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCase = (id: number) => ({ id, title: `Case ${id}` }) as any;
const mockStatute = (section: string) => ({ code: "IPC", section, title: `Sec ${section}` }) as any;

const searchIndianCaselaw = vi.fn(async () => ({ results: [] as any[] }));
const searchUsCaselaw = vi.fn(async () => ({ results: [] as any[] }));
const searchStatutes = vi.fn(async () => ({ results: [] as any[] }));
const hybridSearchStatutes = vi.fn(
  async () => ({ method: "fts", provider: "hash", total: 0, results: [] as any[] }) as any,
);
const getStatuteBySection = vi.fn(async () => null as any);
const compareIpcToBns = vi.fn(async () => ({ found: false }) as any);
const compareOldToNew = vi.fn(async () => ({ found: false, matches: [] }) as any);
const compareNewToOld = vi.fn(
  async () => ({ found: false, statute: null, oldSections: [], matches: [] }) as any,
);

vi.mock("../lib/caselaw", () => ({
  searchIndianCaselaw,
  searchUsCaselaw,
  UpstreamError: class UpstreamError extends Error {},
}));
vi.mock("../lib/rdsCaselaw", () => ({
  rdsBackendEnabled: () => false,
  searchRdsJudgments: vi.fn(async () => ({ results: [] })),
}));
vi.mock("../lib/statutes", () => ({
  searchStatutes,
  hybridSearchStatutes,
  getStatuteBySection,
  compareIpcToBns,
  compareOldToNew,
  compareNewToOld,
}));

const {
  planAndRetrieve,
  detectNewOldCompareIntent,
  detectOldNewCompareIntent,
  detectNewOldCompareIntents,
  detectOldNewCompareIntents,
} =
  await import("../lib/retrievalRouter");

beforeEach(() => {
  vi.clearAllMocks();
  searchIndianCaselaw.mockResolvedValue({ results: [] });
  searchUsCaselaw.mockResolvedValue({ results: [] });
  searchStatutes.mockResolvedValue({ results: [] });
  hybridSearchStatutes.mockResolvedValue({
    method: "fts",
    provider: "hash",
    total: 0,
    results: [],
  });
  getStatuteBySection.mockResolvedValue(null);
  compareIpcToBns.mockResolvedValue({ found: false });
  compareOldToNew.mockResolvedValue({ found: false, matches: [] });
  compareNewToOld.mockResolvedValue({ found: false, statute: null, oldSections: [], matches: [] });
});

describe("planAndRetrieve intent selection", () => {
  it("routes a citation query to citation-lookup without LLM", async () => {
    searchIndianCaselaw.mockResolvedValue({ results: [mockCase(1)] });
    const plan = await planAndRetrieve({ query: "What did (1973) 4 SCC 225 decide?" });
    expect(plan.intent).toBe("citation");
    expect(plan.llmRequired).toBe(false);
    expect(plan.steps[0].tool).toBe("citation-lookup");
    expect(searchIndianCaselaw).toHaveBeenCalledWith(
      expect.objectContaining({ q: "(1973) 4 SCC 225" }),
    );
  });

  it("routes a US citation to the US search path", async () => {
    searchUsCaselaw.mockResolvedValue({ results: [mockCase(9)] });
    const plan = await planAndRetrieve({ query: "347 U.S. 483 (1954)" });
    expect(plan.intent).toBe("citation");
    expect(searchUsCaselaw).toHaveBeenCalled();
    expect(searchIndianCaselaw).not.toHaveBeenCalled();
  });

  it("routes an IPC→BNS comparison query to ipc-bns-compare", async () => {
    compareIpcToBns.mockResolvedValue({ found: true, ipc: {}, bns: {} });
    const plan = await planAndRetrieve({
      query: "What is the BNS equivalent of section 302 of the IPC?",
    });
    expect(plan.intent).toBe("ipc-bns-compare");
    expect(plan.llmRequired).toBe(false);
    expect(compareIpcToBns).toHaveBeenCalledWith("302");
  });

  it("routes IPC 'new section' phrasing to ipc-bns-compare even without 'BNS'", async () => {
    compareIpcToBns.mockResolvedValue({ found: true });
    const plan = await planAndRetrieve({ query: "What is the new equivalent of IPC 420?" });
    expect(plan.intent).toBe("ipc-bns-compare");
    expect(compareIpcToBns).toHaveBeenCalledWith("420");
  });

  it("routes a CrPC→BNSS question to old-new-compare without LLM", async () => {
    compareOldToNew.mockResolvedValue({ found: true, newCode: "BNSS", matches: [{}] });
    const plan = await planAndRetrieve({ query: "What is CrPC 438 under BNSS?" });
    expect(plan.intent).toBe("old-new-compare");
    expect(plan.llmRequired).toBe(false);
    expect(plan.steps[0].tool).toBe("old-new-compare");
    expect(compareOldToNew).toHaveBeenCalledWith("CrPC", "438");
  });

  it("routes long-form CrPC phrasing (Code of Criminal Procedure) to old-new-compare", async () => {
    compareOldToNew.mockResolvedValue({ found: true, newCode: "BNSS", matches: [{}] });
    const plan = await planAndRetrieve({
      query: "What replaced section 438 of the Code of Criminal Procedure?",
    });
    expect(plan.intent).toBe("old-new-compare");
    expect(compareOldToNew).toHaveBeenCalledWith("CrPC", "438");
  });

  it("routes an Evidence Act→BSA question to old-new-compare", async () => {
    compareOldToNew.mockResolvedValue({ found: true, newCode: "BSA", matches: [{}] });
    const plan = await planAndRetrieve({
      query: "What is the BSA equivalent of section 65B of the Indian Evidence Act?",
    });
    expect(plan.intent).toBe("old-new-compare");
    expect(compareOldToNew).toHaveBeenCalledWith("IEA", "65B");
  });

  it("routes IEA shorthand to old-new-compare", async () => {
    compareOldToNew.mockResolvedValue({ found: true, newCode: "BSA", matches: [{}] });
    const plan = await planAndRetrieve({ query: "IEA 65B under BSA?" });
    expect(plan.intent).toBe("old-new-compare");
    expect(compareOldToNew).toHaveBeenCalledWith("IEA", "65B");
  });

  it("routes a BNSS→CrPC reverse question to new-old-compare without LLM", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "CrPC",
      oldSections: ["438"],
      statute: {},
      matches: [],
    });
    const plan = await planAndRetrieve({ query: "BNSS 482 was which CrPC section?" });
    expect(plan.intent).toBe("new-old-compare");
    expect(plan.llmRequired).toBe(false);
    expect(plan.steps[0].tool).toBe("new-old-compare");
    expect(compareNewToOld).toHaveBeenCalledWith("BNSS", "482");
  });

  it("routes 'which old section' phrasing without naming the old code", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "CrPC",
      oldSections: ["438"],
      statute: {},
      matches: [],
    });
    const plan = await planAndRetrieve({ query: "Which old section did BNSS 482 replace?" });
    expect(plan.intent).toBe("new-old-compare");
    expect(compareNewToOld).toHaveBeenCalledWith("BNSS", "482");
  });

  it("routes a BSA→IEA reverse question to new-old-compare", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "IEA",
      oldSections: ["65B"],
      statute: {},
      matches: [],
    });
    const plan = await planAndRetrieve({
      query: "What was BSA 63 under the Indian Evidence Act?",
    });
    expect(plan.intent).toBe("new-old-compare");
    expect(compareNewToOld).toHaveBeenCalledWith("BSA", "63");
  });

  it("routes a BNS→IPC reverse question to new-old-compare", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "IPC",
      oldSections: ["420"],
      statute: {},
      matches: [{}],
    });
    const plan = await planAndRetrieve({ query: "BNS 318 corresponds to which IPC section?" });
    expect(plan.intent).toBe("new-old-compare");
    expect(plan.llmRequired).toBe(false);
    expect(compareNewToOld).toHaveBeenCalledWith("BNS", "318");
  });

  it("falls through to statute-lookup when reverse mapping is not found", async () => {
    compareNewToOld.mockResolvedValue({ found: false, statute: null, oldSections: [], matches: [] });
    getStatuteBySection.mockResolvedValue(mockStatute("482"));
    const plan = await planAndRetrieve({ query: "BNSS 482 was which CrPC section?" });
    expect(plan.intent).toBe("statute");
    expect(plan.steps.some((s) => s.tool === "new-old-compare")).toBe(true);
  });

  it("does not trigger new-old-compare on a plain new-code section query", async () => {
    getStatuteBySection.mockResolvedValue(mockStatute("103"));
    const plan = await planAndRetrieve({ query: "What does BNS section 103 say?" });
    expect(compareNewToOld).not.toHaveBeenCalled();
    expect(plan.intent).toBe("statute");
  });

  it("does not route forward IPC→BNS questions to new-old-compare", async () => {
    compareIpcToBns.mockResolvedValue({ found: true, ipc: {}, bnsMatches: [] });
    const plan = await planAndRetrieve({
      query: "What is the BNS equivalent of section 302 of the IPC?",
    });
    expect(compareNewToOld).not.toHaveBeenCalled();
    expect(plan.intent).toBe("ipc-bns-compare");
  });

  it("generative reverse ask retrieves the mapping but still requires LLM", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "CrPC",
      oldSections: ["438"],
      statute: {},
      matches: [],
    });
    const plan = await planAndRetrieve({
      query: "Draft a note on which CrPC provision BNSS 482 replaced",
    });
    expect(plan.llmRequired).toBe(true);
    expect(plan.intent).toBe("generate");
    expect(plan.steps.some((s) => s.tool === "new-old-compare")).toBe(true);
  });

  it("falls through when old-new mapping is not found", async () => {
    compareOldToNew.mockResolvedValue({ found: false, matches: [] });
    const plan = await planAndRetrieve({ query: "What is CrPC 9999 under BNSS?" });
    expect(plan.intent).not.toBe("old-new-compare");
    expect(plan.llmRequired).toBe(false);
    expect(plan.steps.some((s) => s.tool === "old-new-compare")).toBe(true);
  });

  it("does not trigger old-new-compare without a comparison cue", async () => {
    searchIndianCaselaw.mockResolvedValue({ results: [mockCase(7)] });
    const plan = await planAndRetrieve({ query: "cases about CrPC 438 anticipatory bail" });
    expect(compareOldToNew).not.toHaveBeenCalled();
    expect(plan.intent).toBe("case-search");
  });

  it("generative CrPC ask retrieves the mapping but still requires LLM", async () => {
    compareOldToNew.mockResolvedValue({ found: true, newCode: "BNSS", matches: [{}] });
    const plan = await planAndRetrieve({
      query: "Draft a note on the new BNSS provision for CrPC 438",
    });
    expect(plan.llmRequired).toBe(true);
    expect(plan.intent).toBe("generate");
    expect(plan.steps.some((s) => s.tool === "old-new-compare")).toBe(true);
  });

  it("falls through to statute-lookup when comparison is not found", async () => {
    compareIpcToBns.mockResolvedValue({ found: false });
    getStatuteBySection.mockResolvedValue(mockStatute("302"));
    const plan = await planAndRetrieve({ query: "What replaced section 302 of the IPC?" });
    expect(plan.intent).toBe("statute");
    expect(plan.llmRequired).toBe(false);
    expect(getStatuteBySection).toHaveBeenCalledWith("IPC", "302");
  });

  it("routes an exact section query to statute-lookup", async () => {
    getStatuteBySection.mockResolvedValue(mockStatute("103"));
    const plan = await planAndRetrieve({ query: "What does BNS section 103 say?" });
    expect(plan.intent).toBe("statute");
    expect(getStatuteBySection).toHaveBeenCalledWith("BNS", "103");
    expect(compareIpcToBns).not.toHaveBeenCalled();
  });

  it("normalizes long-form code names (Indian Penal Code → IPC)", async () => {
    getStatuteBySection.mockResolvedValue(mockStatute("420"));
    const plan = await planAndRetrieve({ query: "text of section 420 of the Indian Penal Code" });
    expect(getStatuteBySection).toHaveBeenCalledWith("IPC", "420");
    expect(plan.intent).toBe("statute");
  });

  it("routes statute-flavoured queries without a section to hybrid statute retrieval", async () => {
    hybridSearchStatutes.mockResolvedValue({
      method: "hybrid",
      provider: "hash",
      total: 1,
      results: [mockStatute("1")],
    });
    const plan = await planAndRetrieve({ query: "which statute governs cheating and dishonesty" });
    expect(plan.intent).toBe("statute");
    expect(hybridSearchStatutes).toHaveBeenCalled();
  });

  it("routes plain queries with caselaw hits to case-search", async () => {
    searchIndianCaselaw.mockResolvedValue({ results: [mockCase(2)] });
    const plan = await planAndRetrieve({ query: "anticipatory bail in dowry cases" });
    expect(plan.intent).toBe("case-search");
    expect(plan.llmRequired).toBe(false);
    expect(plan.steps[0]).toMatchObject({ tool: "case-search", jurisdiction: "IN" });
  });

  it("respects an explicit US jurisdiction for case-search", async () => {
    searchUsCaselaw.mockResolvedValue({ results: [mockCase(3)] });
    const plan = await planAndRetrieve({ query: "qualified immunity doctrine", jurisdiction: "US" });
    expect(plan.intent).toBe("case-search");
    expect(searchUsCaselaw).toHaveBeenCalled();
  });

  it("escalates to generate when nothing local matches", async () => {
    const plan = await planAndRetrieve({ query: "hello there" });
    expect(plan.intent).toBe("generate");
    expect(plan.llmRequired).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it("flags llmRequired for generative asks but still retrieves grounding", async () => {
    getStatuteBySection.mockResolvedValue(mockStatute("302"));
    const plan = await planAndRetrieve({ query: "Draft a memo on section 302 of the IPC" });
    expect(plan.intent).toBe("generate");
    expect(plan.llmRequired).toBe(true);
    expect(plan.steps.some((s) => s.tool === "statute-lookup")).toBe(true);
  });

  it("generative query with citations still runs citation-lookup but requires LLM", async () => {
    searchIndianCaselaw.mockResolvedValue({ results: [mockCase(4)] });
    const plan = await planAndRetrieve({ query: "Summarize (1973) 4 SCC 225" });
    expect(plan.llmRequired).toBe(true);
    expect(plan.intent).toBe("generate");
    expect(plan.steps.some((s) => s.tool === "citation-lookup")).toBe(true);
  });

  it("US upstream failure degrades to empty results without throwing", async () => {
    const { UpstreamError } = await import("../lib/caselaw");
    searchUsCaselaw.mockRejectedValue(new (UpstreamError as any)("down"));
    const plan = await planAndRetrieve({ query: "due process", jurisdiction: "US" });
    expect(plan.intent).toBe("generate");
    expect(plan.llmRequired).toBe(true);
  });
});

describe("detectOldNewCompareIntent (forward old→new)", () => {
  it("detects 'What replaced IPC 302?'", () => {
    expect(detectOldNewCompareIntent("What replaced IPC 302?")).toEqual({
      code: "IPC",
      section: "302",
    });
  });

  it("detects 'CrPC 438 under BNSS?'", () => {
    expect(detectOldNewCompareIntent("CrPC 438 under BNSS?")).toEqual({
      code: "CrPC",
      section: "438",
    });
  });

  it("detects Evidence Act phrasing → IEA", () => {
    expect(
      detectOldNewCompareIntent("What is the BSA equivalent of section 65B of the Evidence Act?"),
    ).toEqual({ code: "IEA", section: "65B" });
  });

  it("detects 'section 420 of the IPC' phrasing with a new-code cue", () => {
    expect(
      detectOldNewCompareIntent("What is the new section for section 420 of the IPC?"),
    ).toEqual({ code: "IPC", section: "420" });
  });

  it("returns null without a forward cue", () => {
    expect(detectOldNewCompareIntent("Explain the elements of IPC 302")).toBeNull();
  });

  it("returns null for a plain question with no section reference", () => {
    expect(detectOldNewCompareIntent("What replaced the old sedition law?")).toBeNull();
  });

  it("yields to the reverse detector when the query is new→old", () => {
    const q = "BNSS 482 was which CrPC section?";
    expect(detectNewOldCompareIntent(q)).toEqual({ code: "BNSS", section: "482" });
    expect(detectOldNewCompareIntent(q)).toBeNull();
  });

  it("does not treat a BNS-only section reference as forward intent", () => {
    expect(detectOldNewCompareIntent("What does BNS 103 say now?")).toBeNull();
  });
});

describe("multi-section compare intents", () => {
  it("detects every distinct forward section: 'What replaced IPC 302 and IPC 420?'", () => {
    expect(detectOldNewCompareIntents("What replaced IPC 302 and IPC 420?")).toEqual([
      { code: "IPC", section: "302" },
      { code: "IPC", section: "420" },
    ]);
  });

  it("detects mixed old codes in one forward question", () => {
    expect(
      detectOldNewCompareIntents(
        "What replaced CrPC 438, section 65B of the Evidence Act, and IPC 420?",
      ),
    ).toEqual([
      { code: "CrPC", section: "438" },
      { code: "IEA", section: "65B" },
      { code: "IPC", section: "420" },
    ]);
  });

  it("dedupes repeated forward references", () => {
    expect(
      detectOldNewCompareIntents("What replaced IPC 302? I mean IPC 302 specifically."),
    ).toEqual([{ code: "IPC", section: "302" }]);
  });

  it("caps forward references at 5", () => {
    const q =
      "What replaced IPC 302, IPC 420, IPC 376, IPC 498A, IPC 304B, IPC 124A and IPC 377?";
    expect(detectOldNewCompareIntents(q)).toHaveLength(5);
  });

  it("detects every distinct reverse section: 'BNSS 482 and BSA 63 were which old sections?'", () => {
    expect(
      detectNewOldCompareIntents("BNSS 482 and BSA 63 were which old sections?"),
    ).toEqual([
      { code: "BNSS", section: "482" },
      { code: "BSA", section: "63" },
    ]);
  });

  it("dedupes repeated reverse references and caps at 5", () => {
    expect(
      detectNewOldCompareIntents("BNS 103 and BNS 103 were earlier which IPC sections?"),
    ).toEqual([{ code: "BNS", section: "103" }]);
    const q =
      "BNS 103, BNS 105, BNS 111, BNS 318, BNSS 482 and BSA 63 were earlier which sections?";
    expect(detectNewOldCompareIntents(q)).toHaveLength(5);
  });

  it("mixed question yields both directions: reverse keeps its refs, forward keeps the rest", () => {
    const q = "BNSS 482 was which CrPC section, and what replaced IPC 302?";
    expect(detectNewOldCompareIntents(q)).toEqual([{ code: "BNSS", section: "482" }]);
    expect(detectOldNewCompareIntents(q)).toEqual([{ code: "IPC", section: "302" }]);
  });

  it("forward skips only reverse-claimed refs, keeping multiple forward refs", () => {
    const q =
      "BNS 103 was earlier which IPC section? Also, what replaced IPC 420 and CrPC 438?";
    expect(detectNewOldCompareIntents(q)).toEqual([{ code: "BNS", section: "103" }]);
    expect(detectOldNewCompareIntents(q)).toEqual([
      { code: "CrPC", section: "438" },
      { code: "IPC", section: "420" },
    ]);
  });

  it("reverse-only question still yields no forward intents", () => {
    const q = "BNSS 482 was which CrPC section?";
    expect(detectNewOldCompareIntents(q)).toEqual([{ code: "BNSS", section: "482" }]);
    expect(detectOldNewCompareIntents(q)).toEqual([]);
  });

  it("singular detectors return the first plural result", () => {
    expect(detectOldNewCompareIntent("What replaced IPC 302 and IPC 420?")).toEqual({
      code: "IPC",
      section: "302",
    });
    expect(
      detectNewOldCompareIntent("BNSS 482 and BSA 63 were which old sections?"),
    ).toEqual({ code: "BNSS", section: "482" });
  });

  it("returns empty arrays when there is no compare cue", () => {
    expect(detectOldNewCompareIntents("Explain IPC 302 and IPC 420")).toEqual([]);
    expect(detectNewOldCompareIntents("What do BNS 103 and BSA 63 say?")).toEqual([]);
  });
});
