import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseJudgmentStructure,
  type JudgmentStructure,
} from "../lib/judgmentStructure";

/**
 * NYS-JUDGMENT-STRUCTURE-001 — tests over REAL extracted judgment text.
 *
 * The fixtures under `fixtures/judgments/` are text produced by the production
 * extraction path (`extractPdfTextLayer` + `normalizeExtractedText`, via unpdf)
 * over real Supreme Court Reports PDFs in the owned S3 estate. They are
 * deliberately not hand-written: the whole risk in this parser is what real
 * Indian judgment PDFs look like — years as sentence openers, Article numbers,
 * footnote markers, interleaved page furniture, OCR damage — and a fixture an
 * author invented would encode the author's assumptions rather than the corpus.
 * Each excerpt was checked to reproduce the verdict its full document produces.
 *
 * Provenance (bucket `your-supreme-court-data-bucket`, extracted 2026-08-20):
 *  - modern-single-opinion-2026-3-scr-525    year=2026/english/2026_3_525_555_EN.pdf
 *  - modern-multi-opinion-2025-5-scr-2534    year=2025/english/2025_5_2534_2592_EN.pdf
 *  - old-scr-unnumbered-maneka-1978…         year=1978/english/1978_2_621_776_EN.pdf
 *  - old-scr-unnumbered-kesavananda-1973…    year=1973/english/S_1973_1_1_1002_EN.pdf
 *  - old-scr-unnumbered-nbcc-1973-1-scr-40   year=1973/english/1973_1_40_52_EN.pdf
 *  - old-scr-headnote-holdings-1980…         year=1980/english/1980_3_383_420_EN.pdf
 *  - footnote-authorities-list-2025…         year=2025/english/2025_1_1782_1908_EN.pdf
 *  - quoted-prior-order-2025-5-scr-2534      year=2025/english/2025_5_2534_2592_EN.pdf
 *
 * The last two carry a two-line synthetic body anchor so the footnote / quoted
 * block is the only paragraph candidate in the excerpt. The numbered content
 * itself is verbatim source text.
 */
const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "judgments",
);

function fixture(name: string): string {
  const text = readFileSync(join(FIXTURE_DIR, `${name}.txt`), "utf8");
  // Positive control on the instrument itself: an empty or truncated fixture
  // would make most assertions below pass vacuously, because "no paragraphs
  // found" is the expected result for five of the eight documents.
  if (text.length < 1_000) {
    throw new Error(`fixture ${name} too small (${text.length} chars)`);
  }
  return text;
}

/** Every `n` must be literally present as a line-initial marker in the source. */
function everyNumberIsLiteral(text: string, parsed: JudgmentStructure): boolean {
  const lines = text.split("\n").map((l) => l.trim());
  return parsed.paras.every((p) =>
    lines.some(
      (l) =>
        l.startsWith(`${p.n}.`) ||
        l.startsWith(`(${p.n})`) ||
        l.startsWith(`${p.n})`),
    ),
  );
}

describe("parseJudgmentStructure — modern SCR, numbering present", () => {
  const text = fixture("modern-single-opinion-2026-3-scr-525");
  const parsed = parseJudgmentStructure(text);

  it("recovers every printed paragraph number contiguously", () => {
    expect(parsed.numbering).toBe("preserved");
    expect(parsed.paras.map((p) => p.n)).toEqual(
      Array.from({ length: 68 }, (_, i) => i + 1),
    );
  });

  it("never emits a number that is not printed in the source", () => {
    expect(everyNumberIsLiteral(text, parsed)).toBe(true);
  });

  it("attributes paragraphs to the authoring judge printed in the source", () => {
    expect(parsed.opinions).toHaveLength(1);
    expect(parsed.opinions[0]!.author).toContain("Maheshwari");
  });

  /**
   * The body anchor must be found, not guessed at. This volume prints 68
   * paragraphs after `Judgment / Order of the Supreme Court`; without that
   * anchor the parser starts at the first authoring-judge line instead and, on
   * multi-opinion volumes, silently loses the paragraphs of the lead opinion
   * (measured: [2024] 11 SCR 1647 drops from 776 to 613). Losing real
   * paragraphs is a quieter failure than inventing them, and just as bad for a
   * reader who cannot tell an incomplete judgment from a complete one.
   */
  it("starts the body at the reporter's caption so no opinion is dropped", () => {
    const lines = text.split("\n").map((l) => l.trim());
    const anchor = lines.findIndex((l) => /^Judgment\s*\/\s*Order of the Supreme Court/i.test(l));
    expect(anchor).toBeGreaterThan(0);
    // Paragraph 1 must come from the body, i.e. after the caption — not from
    // the headnote's `Held: 1.` enumeration that precedes it.
    const para1 = parsed.paras.find((p) => p.n === 1);
    expect(para1!.text).toMatch(/Leave granted/i);
  });

  /**
   * Independent cross-check against the reporter's own cross-reference: the
   * headnote in this volume cites `[Para 37]` for its first holding, so para 37
   * must contain the reasoning that holding summarises. This is the only
   * assertion here that verifies alignment rather than mere extraction — an
   * off-by-one in paragraph boundaries would still produce 1..68.
   */
  it("aligns paragraph 37 with the holding the headnote cites as [Para 37]", () => {
    const para37 = parsed.paras.find((p) => p.n === 37);
    expect(para37).toBeDefined();
    expect(para37!.text).toMatch(/Arbitral Tribunal/i);
    expect(para37!.text.length).toBeGreaterThan(120);
  });

  /**
   * The text layer interleaves the reporter's running header into the middle of
   * paragraphs (`[2026] 3 S.C.R. 529Municipal Corporation of Greater Mumbai v.`
   * plus a continuation line carrying the rest of the case name). Measured: 13
   * of these 68 paragraphs carried one before the filter matched the real
   * shapes. It has to be stripped, because an advocate copying a paragraph to
   * quote in a pleading would otherwise paste the page header into it.
   */
  it("strips the reporter's running header out of paragraph text", () => {
    // Both halves of the two-line header must go: the volume/page line and the
    // case-name continuation that follows it. Measured before the fix: 13 of
    // these 68 paragraphs carried one or the other.
    const contaminated = parsed.paras.filter(
      (p) =>
        /S\.C\.R\.\s*\d|SUPREME COURT REPORTS/i.test(p.text) ||
        /Municipal Corporation of Greater Mumbai v\.|Anderson Associates Limited/i.test(p.text),
    );
    expect(contaminated).toEqual([]);
  });

  it("extracts only fields the reporter typeset, and reports ratio/obiter absent", () => {    expect(parsed.coram).toEqual(["J.K. Maheshwari", "Atul S. Chandurkar"]);
    expect(parsed.parallelCitations).toContain("2026 INSC 228");
    expect(parsed.disposition).toBe("Appeals Dismissed.");
    // No Indian judgment format delimits ratio from obiter; guessing them by
    // keyword or sentence position is precisely the behaviour NSP deleted.
    expect(parsed.unavailableFields).toContain("ratio");
    expect(parsed.unavailableFields).toContain("obiter");
    expect(parsed.extractedFields).toContain("paras");
  });
});

describe("parseJudgmentStructure — old SCR, numbering genuinely absent", () => {
  /**
   * The load-bearing tests. Both of these judgments are landmark authorities an
   * advocate is very likely to open, and neither numbers its paragraphs: the
   * 1970s–80s SCR body is unnumbered prose with marginal letters A–G. Returning
   * a number here would be worse than returning nothing, because counsel would
   * cite it in court.
   */
  it.each([
    ["Maneka Gandhi [1978] 2 SCR 621", "old-scr-unnumbered-maneka-1978-2-scr-621"],
    ["Kesavananda Bharati [1973] 1 SCR 1", "old-scr-unnumbered-kesavananda-1973-1-scr-1"],
    ["National Buildings Construction Corp [1973] 1 SCR 40", "old-scr-unnumbered-nbcc-1973-1-scr-40"],
  ])("returns no paragraphs for %s and says why", (_label, key) => {
    const parsed = parseJudgmentStructure(fixture(key));
    expect(parsed.paras).toEqual([]);
    expect(parsed.numbering).not.toBe("preserved");
    expect(parsed.numberingNote).toMatch(/no paragraph numbers have been inferred/i);
    expect(parsed.unavailableFields).toContain("paras");
  });

  /**
   * [1980] 3 SCR 383's headnote prints `HELD : 1.` … `15.` — a genuine +1 chain
   * with prose-like spacing, so neither the chain test nor the density test can
   * reject it. Those numbers enumerate HOLDINGS (each ends in a reporter page
   * ref such as `[393 C-D]`), not paragraphs of the Court's judgment. Emitting
   * them would give counsel a "para 14" that cites the reporter's summary.
   */
  it("does not mistake headnote holdings for paragraphs", () => {
    const parsed = parseJudgmentStructure(fixture("old-scr-headnote-holdings-1980-3-scr-383"));
    expect(parsed.paras).toEqual([]);
  });
});

describe("parseJudgmentStructure — multi-opinion numbering", () => {
  /**
   * Indian judgments restart paragraph numbering at 1 for each concurring or
   * dissenting opinion, so `n` alone is ambiguous: "para 5" exists once per
   * opinion. The parser must keep those sequences separate and label the author,
   * because "para 5 of Khanna J." is the only citation that identifies anything.
   *
   * Fusing restarts into one sequence is not a cosmetic bug. With the restart
   * rule disabled, Kesavananda Bharati's separate quoted-clause lists merge into
   * a single 61-"paragraph" chain that crosses the coverage gate, and a judgment
   * with no paragraph numbers at all starts reporting 61 of them.
   */
  const parsed = parseJudgmentStructure(fixture("modern-multi-opinion-2025-5-scr-2534"));

  it("keeps restarted sequences as separate opinions rather than fusing them", () => {
    expect(parsed.numbering).toBe("preserved");
    expect(parsed.opinions.length).toBeGreaterThan(1);
    // Every opinion after the first must restart at or below the previous
    // opinion's last number — that is what makes it a restart and not a
    // continuation the merge step should have absorbed.
    for (let i = 1; i < parsed.opinions.length; i += 1) {
      expect(parsed.opinions[i]!.firstParagraph!).toBeLessThanOrEqual(
        parsed.opinions[i - 1]!.lastParagraph!,
      );
    }
  });

  it("warns the reader that a paragraph number needs its opinion to be unambiguous", () => {
    expect(parsed.numberingNote).toMatch(/restarts/i);
    const repeated = parsed.paras.filter((p) => p.n === 5);
    expect(repeated.length).toBeGreaterThan(1);
    expect(new Set(repeated.map((p) => p.opinionIndex)).size).toBe(repeated.length);
  });
});

describe("parseJudgmentStructure — refuses to fabricate", () => {
  /**
   * Real authorities list from [2025] 1 SCR 1782: `4. Bennion on Statutory
   * Interpretation…` / `5. (2022) 2 SCC 401.` / `6. …`. It is a perfect +1 chain
   * of 8 markers, so only the spacing distinguishes it from paragraphs — a
   * footnote entry is one line, a judgment paragraph is many. Without that check
   * a reader would be offered "para 5" pointing at a citation list.
   */
  it("rejects a dense footnote/authorities list that forms a perfect +1 chain", () => {
    const parsed = parseJudgmentStructure(fixture("footnote-authorities-list-2025-1-scr-1782"));
    expect(parsed.paras).toEqual([]);
    expect(parsed.numbering).not.toBe("preserved");
  });

  /**
   * Real quoted prior order from [2025] 5 SCR 2534, whose internal numbering
   * runs 22…27. A judgment's own paragraphs start near 1; a chain that begins at
   * 22 with no 1–21 anywhere is quoted material, and emitting it would attribute
   * another court's paragraph numbers to this judgment.
   */
  it("rejects a numbered chain that never starts near the top of an opinion", () => {
    const parsed = parseJudgmentStructure(fixture("quoted-prior-order-2025-5-scr-2534"));
    expect(parsed.paras).toEqual([]);
  });

  it("returns absent, not a guess, for prose with no markers at all", () => {
    const prose = Array.from(
      { length: 60 },
      (_, i) => `The appellant contends that the impugned order is unsustainable (${i}).`,
    ).join("\n");
    const parsed = parseJudgmentStructure(prose);
    expect(parsed.paras).toEqual([]);
    expect(parsed.numbering).toBe("absent");
  });

  it("is total on degenerate input rather than throwing", () => {
    for (const input of ["", "   ", "\n\n\n"]) {
      const parsed = parseJudgmentStructure(input);
      expect(parsed.paras).toEqual([]);
      expect(parsed.numbering).toBe("absent");
    }
  });

  it("is deterministic — a citation must not depend on when it was requested", () => {
    const text = fixture("modern-single-opinion-2026-3-scr-525");
    expect(JSON.stringify(parseJudgmentStructure(text))).toBe(
      JSON.stringify(parseJudgmentStructure(text)),
    );
  });
});
