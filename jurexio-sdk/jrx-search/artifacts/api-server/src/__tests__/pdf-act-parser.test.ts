import { describe, expect, it } from "vitest";
import { parsePdfActText, parseArrangement, pickPdfPath } from "../lib/pdfActParser";

const GAZETTE_TEXT = `1 THE SAMPLE-TAX ACT, 1961 ____________ ARRANGEMENT OF SECTIONS ____________ CHAPTER I PRELIMINARY SECTIONS 1. Short title, extent and commencement. 2. Definitions. 3. \u201CPrevious year\u201D defined. CHAPTER II BASIS OF CHARGE 4. Charge of income-tax. 4A. [Omitted.]. 5. Scope of total income. THE FIRST SCHEDULE. 30 THE SAMPLE-TAX ACT, 1961 ACT NO. 43 OF 1961 [13th September, 1961.] An Act to consolidate the law. BE it enacted as follows:\u2014 CHAPTER I PRELIMINARY 1. Short title, extent and commencement.\u2014(1) This Act may be called the Sample-tax Act, 1961. (2) It extends to the whole of India. 2. Definitions.\u2014In this Act, unless the context otherwise requires, \u201Cagricultural income\u201D means rent. 3. \u201CPrevious year\u201D defined.\u2014For the purposes of this Act, \u201Cprevious year\u201D means the financial year. CHAPTER II BASIS OF CHARGE 4.1[Charge of income-tax.\u2014Where any Central Act enacts that income-tax shall be charged for any assessment year. 1. Subs. by Act 1 of 1965.] 5. Scope of total income.\u2014Subject to the provisions of this Act, the total income of any previous year.`;

describe("parsePdfActText (arrangement mode)", () => {
  const parsed = parsePdfActText(GAZETTE_TEXT);

  it("parses all arrangement entries", () => {
    expect(parsed.stats.mode).toBe("arrangement");
    expect(parsed.sections.map((s) => s.section)).toEqual(["1", "2", "3", "4", "4A", "5"]);
  });

  it("locates body text for present sections", () => {
    const s1 = parsed.sections.find((s) => s.section === "1")!;
    expect(s1.headingOnly).toBe(false);
    expect(s1.text).toContain("This Act may be called the Sample-tax Act");
    expect(s1.text).not.toContain("Definitions.\u2014In this Act");
    const s2 = parsed.sections.find((s) => s.section === "2")!;
    expect(s2.text).toContain("agricultural income");
  });

  it("handles footnote-marker gaps before headings (4.1[Charge…)", () => {
    const s4 = parsed.sections.find((s) => s.section === "4")!;
    expect(s4.headingOnly).toBe(false);
    expect(s4.text).toContain("income-tax shall be charged");
  });

  it("falls back to heading for omitted sections missing from the body", () => {
    const s4a = parsed.sections.find((s) => s.section === "4A")!;
    expect(s4a.headingOnly).toBe(true);
    expect(s4a.text).toBe("[Omitted.]");
  });

  it("keeps curly-quoted headings intact", () => {
    const s3 = parsed.sections.find((s) => s.section === "3")!;
    expect(s3.heading).toBe("\u201CPrevious year\u201D defined");
    expect(s3.headingOnly).toBe(false);
  });
});

describe("parsePdfActText (body-scan fallback)", () => {
  it("splits acts without an arrangement on ascending section boundaries", () => {
    const text =
      "THE OLD ESTATE ACT, 1854. Preamble text here. " +
      "1. Power to appoint.\u2014The Governor may appoint officers for the estate. " +
      "2. Duties of officers.\u2014Every officer so appointed shall keep records. " +
      "3. Penalty.\u2014Any person who contravenes shall be liable to fine.";
    const parsed = parsePdfActText(text);
    expect(parsed.stats.mode).toBe("body-scan");
    expect(parsed.sections.map((s) => s.section)).toEqual(["1", "2", "3"]);
    expect(parsed.sections[1].text).toContain("shall keep records");
    expect(parsed.sections[1].text).not.toContain("Penalty");
  });

  it("ignores non-ascending numbers (footnotes, cross-references)", () => {
    const text =
      "Preamble. 1. First section.\u2014Text one. 7. Not a section start. " +
      "2. Second section.\u2014Text two.";
    const parsed = parsePdfActText(text);
    expect(parsed.sections.map((s) => s.section)).toEqual(["1", "2"]);
  });
});

describe("parseArrangement", () => {
  it("dedupes repeated section numbers keeping the first", () => {
    const entries = parseArrangement(
      "SECTIONS 1. First heading. 2. Second heading. 1. Duplicate. CHAPTER II",
    );
    expect(entries).toEqual([
      { section: "1", heading: "First heading" },
      { section: "2", heading: "Second heading" },
    ]);
  });

  it("skips absurdly long headings (runaway matches)", () => {
    const long = "x".repeat(400);
    const entries = parseArrangement(`SECTIONS 1. ${long}. 2. Real heading. CHAPTER II`);
    expect(entries.map((e) => e.section)).toEqual(["2"]);
  });
});

describe("pickPdfPath", () => {
  it("prefers the English aYYYY-NN.pdf bitstream", () => {
    const html =
      '<a href="/bitstream/123456789/19036/2/H1854-05.pdf">Hindi</a>' +
      '<a href="/bitstream/123456789/19036/1/a1854-05.pdf">English</a>';
    expect(pickPdfPath(html, "123456789/19036")).toBe(
      "/bitstream/123456789/19036/1/a1854-05.pdf",
    );
  });

  it("prefers bitstreams under the act's own handle", () => {
    const html =
      '<a href="/bitstream/123456789/999/1/a1900-01.pdf">Other act</a>' +
      '<a href="/bitstream/123456789/2435/1/a1961-43.pdf">Own</a>';
    expect(pickPdfPath(html, "123456789/2435")).toBe(
      "/bitstream/123456789/2435/1/a1961-43.pdf",
    );
  });

  it("returns null when no PDF links exist", () => {
    expect(pickPdfPath("<html><body>no pdfs</body></html>", "123456789/1")).toBeNull();
  });
});
