import { describe, it, expect } from "vitest";
import { extractCitations } from "../lib/citations";

describe("extractCitations — Indian formats", () => {
  it("parses AIR SC citations", () => {
    const [c] = extractCitations("See AIR 1973 SC 1461 for the basic structure doctrine.");
    expect(c).toMatchObject({
      normalized: "AIR 1973 SC 1461",
      jurisdiction: "IN",
      reporter: "AIR",
      volume: null,
      year: 1973,
      page: "1461",
      court: "Supreme Court of India",
    });
  });

  it("parses AIR High Court citations with the court abbreviation preserved", () => {
    const [c] = extractCitations("AIR 2001 Bom 123");
    expect(c).toMatchObject({
      normalized: "AIR 2001 Bom 123",
      reporter: "AIR",
      year: 2001,
      page: "123",
      court: "Bom",
    });
  });

  it("parses SCC citations", () => {
    const [c] = extractCitations("Kesavananda Bharati, (1973) 4 SCC 225, held...");
    expect(c).toMatchObject({
      normalized: "(1973) 4 SCC 225",
      jurisdiction: "IN",
      reporter: "SCC",
      volume: "4",
      year: 1973,
      page: "225",
      court: "Supreme Court of India",
    });
  });

  it("parses SCC OnLine citations (SC and other courts)", () => {
    const cites = extractCitations("2024 SCC OnLine SC 123 and 2024 SCC OnLine Del 456");
    expect(cites).toHaveLength(2);
    expect(cites[0]).toMatchObject({
      normalized: "2024 SCC OnLine SC 123",
      reporter: "SCC OnLine",
      court: "Supreme Court of India",
    });
    expect(cites[1]).toMatchObject({
      normalized: "2024 SCC OnLine Del 456",
      reporter: "SCC OnLine",
      court: "Del",
    });
  });

  it("parses SCR citations with and without volume", () => {
    const cites = extractCitations("[1950] SCR 88; see also (1964) 1 SCR 332.");
    expect(cites.map((c) => c.normalized)).toEqual(["[1950] SCR 88", "(1964) 1 SCR 332"]);
    expect(cites[0]).toMatchObject({ volume: null, year: 1950, page: "88", reporter: "SCR" });
    expect(cites[1]).toMatchObject({ volume: "1", year: 1964, page: "332" });
  });

  it("parses neutral INSC citations", () => {
    const [c] = extractCitations("2023 INSC 123");
    expect(c).toMatchObject({
      normalized: "2023 INSC 123",
      reporter: "INSC",
      year: 2023,
      page: "123",
      court: "Supreme Court of India",
    });
  });
});

describe("extractCitations — US formats", () => {
  it("parses U.S. reporter citations", () => {
    const [c] = extractCitations("Brown v. Board, 347 U.S. 483 (1954), overruled Plessy.");
    expect(c).toMatchObject({
      normalized: "347 U. S. 483",
      jurisdiction: "US",
      reporter: "U. S.",
      volume: "347",
      year: 1954,
      page: "483",
      court: "Supreme Court of the United States",
    });
  });

  it("parses F.3d citations with a circuit court parenthetical", () => {
    const [c] = extractCitations("See 123 F.3d 456 (2d Cir. 1997).");
    expect(c).toMatchObject({
      jurisdiction: "US",
      reporter: "F. 3d",
      volume: "123",
      page: "456",
      year: 1997,
      court: "2d Cir.",
    });
  });

  it("prefers the longer reporter (F. Supp. 3d over F.)", () => {
    const [c] = extractCitations("99 F. Supp. 3d 1234 (S.D.N.Y. 2015)");
    expect(c.reporter).toBe("F. Supp. 3d");
    expect(c.court).toBe("S.D.N.Y.");
  });

  it("parses S. Ct. citations as SCOTUS", () => {
    const [c] = extractCitations("140 S. Ct. 1731");
    expect(c).toMatchObject({
      reporter: "S. Ct.",
      court: "Supreme Court of the United States",
      year: null,
    });
  });
});

describe("extractCitations — edge cases", () => {
  it("returns empty for text with no citations", () => {
    expect(extractCitations("Draft a lease agreement for a Mumbai flat.")).toEqual([]);
  });

  it("returns empty for empty string", () => {
    expect(extractCitations("")).toEqual([]);
  });

  it("does not match lookalike noise", () => {
    expect(extractCitations("AIRPORT 2020 revenue was 123; section 45 of the report")).toEqual([]);
  });

  it("dedupes repeated citations", () => {
    const cites = extractCitations("(1973) 4 SCC 225 ... again (1973) 4 SCC 225");
    expect(cites).toHaveLength(1);
  });

  it("extracts multiple mixed IN and US citations from one text", () => {
    const text =
      "Compare AIR 1978 SC 597 and (2017) 10 SCC 1 with 410 U.S. 113 (1973) and 2023 INSC 999.";
    const cites = extractCitations(text);
    expect(cites.map((c) => c.normalized)).toEqual(
      expect.arrayContaining(["AIR 1978 SC 597", "(2017) 10 SCC 1", "2023 INSC 999", "410 U. S. 113"]),
    );
    expect(cites).toHaveLength(4);
    expect(cites.filter((c) => c.jurisdiction === "IN")).toHaveLength(3);
    expect(cites.filter((c) => c.jurisdiction === "US")).toHaveLength(1);
  });

  it("keeps the raw matched text", () => {
    const [c] = extractCitations("as held in AIR 1950 SC 27.");
    expect(c.raw).toBe("AIR 1950 SC 27");
  });
});
