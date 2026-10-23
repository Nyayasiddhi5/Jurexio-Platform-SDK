import { describe, it, expect, vi, beforeEach } from "vitest";

// buildReverseCompareLink lives in chatActions, which pulls in the Anthropic
// integration and caselaw retrieval at module load — mock both so the test
// exercises only the deterministic link-building path. compareNewToOld is the
// statute lookup under test's control.
const compareNewToOld = vi.fn(
  async () => ({ found: false, statute: null, oldSections: [], matches: [] }) as any,
);
const compareIpcToBns = vi.fn(async () => ({ found: false, bnsMatches: [] }) as any);

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
  streamText: vi.fn(async function* () {}),
}));
vi.mock("../lib/caselaw", () => ({
  retrieveAuthorities: vi.fn(async () => []),
  searchIndianCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
  searchUsCaselaw: vi.fn(async () => ({ total: 0, results: [] })),
}));
vi.mock("../lib/statutes", () => ({
  searchStatutes: vi.fn(async () => ({ results: [] })),
  hybridSearchStatutes: vi.fn(
    async () => ({ method: "fts", provider: "hash", total: 0, results: [] }),
  ),
  getStatuteBySection: vi.fn(async () => null),
  compareIpcToBns,
  compareOldToNew: vi.fn(async () => ({ found: false, matches: [] })),
  compareNewToOld,
}));
vi.mock("../lib/rdsCaselaw", () => ({
  rdsBackendEnabled: () => false,
  searchRdsJudgments: vi.fn(async () => ({ results: [] })),
}));

const { buildReverseCompareLink, buildCompareLink } = await import(
  "../lib/chatActions"
);
const { detectNewOldCompareIntent, planAndRetrieve } = await import(
  "../lib/retrievalRouter"
);

beforeEach(() => {
  vi.clearAllMocks();
  compareNewToOld.mockResolvedValue({
    found: false,
    statute: null,
    oldSections: [],
    matches: [],
  });
  compareIpcToBns.mockResolvedValue({ found: false, bnsMatches: [] });
});

describe("buildReverseCompareLink", () => {
  it("appends a compare link when the reverse mapping is found", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "CrPC",
      oldSections: ["438"],
      statute: {},
      matches: [],
    });
    const link = await buildReverseCompareLink("BNSS 482 was which CrPC section?");
    expect(link).not.toBeNull();
    expect(compareNewToOld).toHaveBeenCalledWith("BNSS", "482");
    expect(link).toContain("Compare side-by-side");
    expect(link).toContain("BNSS § 482");
    expect(link).toContain("CrPC § 438");
    expect(link).toContain("(/statutes/compare?from=BNSS&section=482)");
  });

  it("joins multiple mapped old sections in the link label", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "IPC",
      oldSections: ["420", "417"],
      statute: {},
      matches: [],
    });
    const link = await buildReverseCompareLink(
      "BNS 318 corresponds to which IPC section?",
    );
    expect(link).toContain("IPC § 420, § 417");
    expect(link).toContain("(/statutes/compare?from=BNS&section=318)");
  });

  it("normalizes lowercase input and letter-suffixed sections into the link", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "IEA",
      oldSections: ["65B"],
      statute: {},
      matches: [],
    });
    const link = await buildReverseCompareLink(
      "bsa 63a was earlier which evidence act section?",
    );
    expect(compareNewToOld).toHaveBeenCalledWith("BSA", "63A");
    expect(link).toContain("(/statutes/compare?from=BSA&section=63A)");
  });

  it("links every verified section when multiple provisions are asked about", async () => {
    compareNewToOld
      .mockResolvedValueOnce({
        found: true,
        oldCode: "CrPC",
        oldSections: ["438"],
        statute: {},
        matches: [],
      })
      .mockResolvedValueOnce({
        found: true,
        oldCode: "IEA",
        oldSections: ["65B"],
        statute: {},
        matches: [],
      });
    const link = await buildReverseCompareLink(
      "BNSS 482 and BSA 63 were which old sections?",
    );
    expect(compareNewToOld).toHaveBeenCalledWith("BNSS", "482");
    expect(compareNewToOld).toHaveBeenCalledWith("BSA", "63");
    expect(link).toContain("(/statutes/compare?from=BNSS&section=482)");
    expect(link).toContain("(/statutes/compare?from=BSA&section=63)");
    expect(link).toContain("- [BNSS § 482 ↔ CrPC § 438]");
    expect(link).toContain("- [BSA § 63 ↔ IEA § 65B]");
  });

  it("silently skips unverified sections but keeps verified ones", async () => {
    compareNewToOld
      .mockResolvedValueOnce({
        found: true,
        oldCode: "CrPC",
        oldSections: ["438"],
        statute: {},
        matches: [],
      })
      .mockResolvedValueOnce({ found: false, statute: null, oldSections: [], matches: [] });
    const link = await buildReverseCompareLink(
      "BNSS 482 and BSA 9999 were which old sections?",
    );
    expect(link).toContain("(/statutes/compare?from=BNSS&section=482)");
    expect(link).not.toContain("BSA");
    // Single verified link keeps the inline (non-list) format.
    expect(link).toContain("**Compare side-by-side:** [BNSS § 482");
  });

  it("returns null when the message has no reverse-compare intent", async () => {
    const link = await buildReverseCompareLink(
      "Summarize the lease dispute for me",
    );
    expect(link).toBeNull();
    expect(compareNewToOld).not.toHaveBeenCalled();
  });

  it("returns null when the mapping is not found", async () => {
    compareNewToOld.mockResolvedValue({
      found: false,
      statute: null,
      oldSections: [],
      matches: [],
    });
    const link = await buildReverseCompareLink("BNSS 9999 was which CrPC section?");
    expect(link).toBeNull();
  });

  it("returns null (never throws) when the statute lookup throws", async () => {
    compareNewToOld.mockRejectedValue(new Error("db down"));
    await expect(
      buildReverseCompareLink("BNSS 482 was which CrPC section?"),
    ).resolves.toBeNull();
  });
});

describe("buildCompareLink (mixed directions)", () => {
  it("merges reverse and forward links into one footer for a mixed question", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "CrPC",
      oldSections: ["438"],
      statute: {},
      matches: [],
    });
    compareIpcToBns.mockResolvedValue({
      found: true,
      bnsMatches: [{ section: "103" }],
    });
    const link = await buildCompareLink(
      "BNSS 482 was which CrPC section, and what replaced IPC 302?",
    );
    expect(compareNewToOld).toHaveBeenCalledWith("BNSS", "482");
    expect(compareIpcToBns).toHaveBeenCalledWith("302");
    expect(link).toContain("Compare side-by-side");
    expect(link).toContain("- [BNSS § 482 ↔ CrPC § 438](/statutes/compare?from=BNSS&section=482)");
    expect(link).toContain("- [IPC § 302 ↔ BNS § 103](/statutes/compare?section=302)");
    // Reverse links come first in the merged footer.
    expect(link!.indexOf("BNSS § 482")).toBeLessThan(link!.indexOf("IPC § 302"));
  });

  it("keeps the forward link when the reverse mapping is unverified", async () => {
    compareIpcToBns.mockResolvedValue({
      found: true,
      bnsMatches: [{ section: "103" }],
    });
    const link = await buildCompareLink(
      "BNSS 9999 was which CrPC section, and what replaced IPC 302?",
    );
    expect(link).toContain("**Compare side-by-side:** [IPC § 302 ↔ BNS § 103]");
    expect(link).not.toContain("BNSS");
  });

  it("caps the merged footer at 5 links total", async () => {
    compareNewToOld.mockResolvedValue({
      found: true,
      oldCode: "IPC",
      oldSections: ["1"],
      statute: {},
      matches: [],
    });
    compareIpcToBns.mockResolvedValue({
      found: true,
      bnsMatches: [{ section: "1" }],
    });
    const link = await buildCompareLink(
      "BNS 103, BNS 105, BNS 111 and BNSS 482 were earlier which sections? Also what replaced IPC 302 and IPC 420?",
    );
    const count = (link!.match(/\/statutes\/compare/g) ?? []).length;
    expect(count).toBe(5);
  });

  it("returns null when the message has no compare intent in either direction", async () => {
    const link = await buildCompareLink("Summarize the lease dispute for me");
    expect(link).toBeNull();
    expect(compareNewToOld).not.toHaveBeenCalled();
    expect(compareIpcToBns).not.toHaveBeenCalled();
  });
});

describe("detectNewOldCompareIntent ↔ router lockstep", () => {
  // Queries the router should route to new-old-compare — the chat link
  // detector must fire on exactly these, so the two stay in lockstep.
  const REVERSE_QUERIES: Array<{ q: string; code: string; section: string }> = [
    { q: "BNSS 482 was which CrPC section?", code: "BNSS", section: "482" },
    { q: "Which old section did BNSS 482 replace?", code: "BNSS", section: "482" },
    { q: "What was BSA 63 under the Indian Evidence Act?", code: "BSA", section: "63" },
    { q: "BNS 318 corresponds to which IPC section?", code: "BNS", section: "318" },
  ];

  const NON_REVERSE_QUERIES = [
    "What does BNS section 103 say?",
    "What is the BNS equivalent of section 302 of the IPC?",
    "cases about CrPC 438 anticipatory bail",
    "anticipatory bail in dowry cases",
  ];

  it.each(REVERSE_QUERIES)(
    "detects and routes $q the same way",
    async ({ q, code, section }) => {
      expect(detectNewOldCompareIntent(q)).toEqual({ code, section });
      compareNewToOld.mockResolvedValue({
        found: true,
        oldCode: "CrPC",
        oldSections: ["1"],
        statute: {},
        matches: [],
      });
      const plan = await planAndRetrieve({ query: q });
      expect(plan.intent).toBe("new-old-compare");
      expect(compareNewToOld).toHaveBeenCalledWith(code, section);
    },
  );

  it.each(NON_REVERSE_QUERIES.map((q) => ({ q })))(
    "neither detects nor routes $q as reverse compare",
    async ({ q }) => {
      expect(detectNewOldCompareIntent(q)).toBeNull();
      const plan = await planAndRetrieve({ query: q });
      expect(plan.intent).not.toBe("new-old-compare");
      expect(compareNewToOld).not.toHaveBeenCalled();
    },
  );
});
