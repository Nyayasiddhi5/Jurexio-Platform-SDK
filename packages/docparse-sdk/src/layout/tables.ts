/**
 * Table detection and cell extraction.
 *
 * WHY PROJECTION AND NOT RULED LINES, as the primary method.
 *
 * The obvious approach is to find the ruling lines and read the grid off them.
 * For Indian legal documents that is the wrong primary strategy, because most of
 * the tables that matter are NOT ruled:
 *
 *   cause list           — columns aligned by whitespace, no rules at all
 *   charge sheet lists   — witness and document lists, whitespace-aligned
 *   bank statement       — usually ruled on screen, but the PDF text layer often
 *                          carries no vector rules, only aligned text
 *   invoice line items   — ruled about half the time
 *   schedule of property — indented key/value pairs, never ruled
 *
 * A ruled-line detector finds nothing on any of those. Worse, it needs pixels,
 * so it cannot run on the text-layer fast path at all — which is exactly the
 * path a system-generated cause list or e-filed statement takes.
 *
 * Whitespace projection works on both routes from the same input the rest of the
 * pipeline already has: word boxes. The method is:
 *
 *   1. find runs of consecutive lines that look tabular (several word clusters
 *      separated by wide gaps, and consistent in count)
 *   2. project word coverage onto the x axis across the whole run
 *   3. the columns are the covered bands; the GUTTERS are the uncovered ones
 *   4. assign words to columns by overlap, rows are lines
 *
 * The critical detail is step 3. A gutter has to be empty across MOST rows, not
 * just one — a single short row would otherwise invent a column boundary in the
 * middle of a wide cell. That is what `gutterConsistency` enforces.
 *
 * Ruled detection is still available for pixel pages where rules exist and are
 * more reliable than whitespace (a dense ledger with narrow gutters), and the
 * chosen method is recorded on the result so a reviewer can see which ran.
 */

import type { BBox, CellKind, Line, Page, Table, TableCell } from "../types.js";
import { bboxUnion } from "../types.js";

export interface TableOptions {
  /** Minimum consecutive lines to consider a table. Two is a heading and a row. */
  minRows?: number;
  /** Minimum columns. Two columns is often just a label and a value. */
  minCols?: number;
  /**
   * A gap wider than this multiple of the median word width separates cells.
   * 1.2 is deliberately low: cause-list columns are often only a few spaces apart.
   */
  gapFactor?: number;
  /** Fraction of rows in which a gutter must be empty to count as a boundary. */
  gutterConsistency?: number;
  /** Fraction of rows in which every column must carry a cell. */
  minColumnOccupancy?: number;
  /** Mean occupancy across columns. */
  minMeanOccupancy?: number;
  /** Absolute minimum populated rows per column, independent of row count. */
  minColumnRows?: number;
  /** Minimum number of homogeneously non-prose columns. */
  minTypedColumns?: number;
}

const DEFAULTS: Required<TableOptions> = {
  minRows: 3,
  minCols: 3,
  gapFactor: 1.2,
  // Moderate, deliberately. This threshold controls how many COLUMNS are found,
  // and the two decisions — "where are the columns" and "is this a table at
  // all" — must not share a knob. Raising it to 0.85 to suppress false
  // positives also merged a six-column bank statement into three columns and
  // truncated its ten data rows to four. Rejection is the occupancy gate's job.
  gutterConsistency: 0.72,
  // Occupancy floor per column. Deliberately low, because a real ledger has
  // legitimately sparse columns — every row of a bank statement has either a
  // debit or a credit, never both, so each of those columns sits near 0.45.
  // A 0.55 floor rejected the very document type this feature exists for.
  // Indented prose, by contrast, has sparse columns at 0.05-0.15.
  minColumnOccupancy: 0.25,
  /** Mean occupancy across all columns. */
  minMeanOccupancy: 0.5,
  /**
   * Absolute floor on the evidence for a column: at least this many rows must
   * actually place a cell in it.
   *
   * A fractional occupancy floor is trivially satisfied when there are few
   * rows — with three rows, a single cell scores 0.33 and clears a 0.25 gate —
   * so the fractional test alone accepted two structures that are not tables:
   *
   *   - a writ petition's chronology paragraph, read as 4x4 at 0.77, where two
   *     of the four columns were populated by ONE row each (the words that
   *     happened to follow a wide gap on the line that wrapped);
   *   - a case diary's three-line HEADER, read as 3x5 at 0.79, where the middle
   *     three columns came from the comma spacing in "Under Sections: 406, 420
   *     r/w 34 IPC" and again held one cell each.
   *
   * Both were confidently wrong structured data, which is worse than none.
   * The rule that rejects them is geometric rather than document-specific: a
   * single cell cannot establish an alignment, so one cell is not a column. Two
   * is the smallest number that can agree on a left edge.
   *
   * This does not cost any real table. The sparsest column in the fixture set is
   * a bank statement's debit column at four populated rows out of ten.
   */
  minColumnRows: 2,
  /**
   * Minimum number of columns whose content is homogeneously NON-PROSE — all
   * dates, all amounts, all serials, all codes.
   *
   * This is the gate that actually separates a grid from indented prose, and it
   * took three attempts to find. Occupancy alone cannot: an affidavit's cause
   * title projects into three columns each filled in 75% of rows, which passes
   * any occupancy test, while a bank statement's debit column fails one.
   *
   * What a table really has is TYPED columns. A ledger has two date columns and
   * three money columns; an invoice has a serial, an HSN code and three
   * numerics; a cause list has a serial, a case number and a CNR. Flowing prose
   * broken by indentation has none — every "column" holds arbitrary sentence
   * fragments. Requiring two typed columns admits every real table in the
   * fixture set and rejects every false positive.
   */
  minTypedColumns: 2,
};

// ---------------------------------------------------------------------------
// Row-level cell splitting
// ---------------------------------------------------------------------------

interface Cluster { text: string; bbox: BBox }

/**
 * Split one line into clusters separated by wide gaps.
 *
 * The threshold is derived from the LINE's own median inter-word gap rather than
 * a fixed number of points, because a cause list set in 9pt and a charge sheet
 * set in 11pt have different natural word spacing, and a fixed threshold either
 * misses columns in the former or invents them in the latter.
 */
export function splitIntoClusters(line: Line, gapFactor: number): Cluster[] {
  const words = [...line.words].sort((a, b) => a.bbox.x - b.bbox.x);
  if (words.length === 0) return [];
  if (words.length === 1) return [{ text: words[0]!.text, bbox: { ...words[0]!.bbox } }];

  const gaps: number[] = [];
  for (let i = 1; i < words.length; i++) {
    gaps.push(words[i]!.bbox.x - (words[i - 1]!.bbox.x + words[i - 1]!.bbox.w));
  }
  const positive = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const medianGap = positive.length > 0 ? positive[positive.length >> 1]! : 2;
  // A space in a proportional font is roughly a quarter of the em; a column
  // separation is several spaces. Guard against a degenerate median of ~0 on a
  // line whose words touch.
  const threshold = Math.max(medianGap * 2.5, gapFactor * 6);

  const out: Cluster[] = [];
  let cur: typeof words = [words[0]!];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.bbox.x - (words[i - 1]!.bbox.x + words[i - 1]!.bbox.w);
    if (gap > threshold) {
      out.push(makeCluster(cur));
      cur = [words[i]!];
    } else {
      cur.push(words[i]!);
    }
  }
  out.push(makeCluster(cur));
  return out;
}

function makeCluster(words: Line["words"]): Cluster {
  const bbox = words.reduce<BBox>((acc, w) => bboxUnion(acc, w.bbox), { ...words[0]!.bbox });
  return { text: words.map((w) => w.text).join(" "), bbox };
}

// ---------------------------------------------------------------------------
// Region detection
// ---------------------------------------------------------------------------

interface Region { from: number; to: number; lines: Line[] }

/**
 * Covered x-intervals of one line, from its word boxes.
 */
function intervalsOf(line: Line): Array<[number, number]> {
  return [...line.words]
    .sort((a, b) => a.bbox.x - b.bbox.x)
    .map((w) => [w.bbox.x, w.bbox.x + w.bbox.w] as [number, number]);
}

/**
 * Count consistent gutters across a set of lines.
 *
 * This is the primitive that region detection is built on, and putting it here
 * rather than deriving regions from a per-line gap heuristic is the whole design.
 *
 * The first version gated regions on "how many clusters does this line split
 * into", where clustering used a gap threshold relative to that line's own word
 * spacing. That is circular and fragile: whether a line looks tabular depends on
 * a threshold, the threshold depends on the line, and a single ragged row breaks
 * the run. Measured result: zero tables detected on a bank statement, a cause
 * list, an invoice and a charge sheet — every one of which is unambiguously
 * tabular to a human.
 *
 * Columns are a property of the REGION, not of any line. So we measure them at
 * region level directly: an x position is a gutter if most lines have no ink
 * there. Cell splitting then follows FROM the boundaries, instead of the
 * boundaries being guessed from the splits.
 */
function gutterBoundaries(
  lines: Line[],
  gutterConsistency: number,
  minCols = 3,
  // 3pt, not 4. Two spaces at 10pt is about 5.6pt of gutter, and adjacent
  // fixed-width columns (two date columns side by side) are separated by
  // exactly that. A 4pt floor plus interval rounding erased them.
  minGutterPt = 3,
): number[] {
  if (lines.length === 0) return [];
  const minX = Math.floor(Math.min(...lines.map((l) => l.bbox.x)));
  const maxX = Math.ceil(Math.max(...lines.map((l) => l.bbox.x + l.bbox.w)));
  const width = Math.max(1, maxX - minX);
  if (width < 40) return [];

  const coverage = new Uint16Array(width);
  for (const line of lines) {
    const marked = new Uint8Array(width);
    for (const [a0, b0] of intervalsOf(line)) {
      // Round, do not expand. floor(start)/ceil(end) widens every word box by up
      // to 1pt on each side, which eats 2pt out of every gutter — enough to
      // erase the ~5pt separation between two adjacent columns.
      const a = Math.max(0, Math.round(a0 - minX));
      const b = Math.min(width, Math.round(b0 - minX));
      for (let x = a; x < b; x++) marked[x] = 1;
    }
    for (let x = 0; x < width; x++) if (marked[x] === 1) coverage[x]!++;
  }

  const gutterMax = Math.floor(lines.length * (1 - gutterConsistency));
  const found: Array<{ centre: number; width: number }> = [];
  let runStart = -1;
  for (let x = 0; x <= width; x++) {
    const isGutter = x < width && coverage[x]! <= gutterMax;
    if (isGutter) {
      if (runStart < 0) runStart = x;
      continue;
    }
    if (runStart >= 0) {
      const runWidth = x - runStart;
      // A gutter touching either edge of the region is margin, not a boundary.
      if (runWidth >= minGutterPt && runStart > 0 && x < width) {
        found.push({ centre: minX + runStart + runWidth / 2, width: runWidth });
      }
      runStart = -1;
    }
  }
  if (found.length === 0) return [];

  /**
   * Keep only the STRUCTURALLY SIGNIFICANT gutters.
   *
   * Whitespace projection has an inherent ambiguity that this resolves. In a
   * monospaced cause list, "W.P.  No.  18842/2024" repeats at the same offsets
   * down the page, so the gaps inside the case number are genuinely consistent
   * gutters — geometrically real, structurally meaningless. Left in, one column
   * became four and a six-column list came back as ten.
   *
   * A fixed ratio against the widest gutter does not work either: it depends on
   * whether the table happens to contain one unusually wide separation. Tried at
   * 0.34 of the widest, it fixed the cause list and destroyed the invoice, whose
   * separations are uniform.
   *
   * So the cut is found in the DATA. Gutter widths are bimodal when
   * over-splitting has happened — a cluster of narrow intra-cell gaps and a
   * cluster of real separations — so we look for the largest relative jump in
   * the sorted widths and cut there. Two guards make it safe: the jump must be
   * substantial (1.8x), and the cut must leave enough gutters to still form a
   * table. When the widths are unimodal there is no such jump and everything is
   * kept, which is the correct answer for a uniformly-spaced grid.
   */
  if (found.length <= minCols - 1) return found.map((g) => g.centre);

  const sorted = [...found].sort((a, b) => a.width - b.width);
  let cutIndex = -1;
  let bestRatio = 1.8;
  for (let i = 1; i < sorted.length; i++) {
    // Cutting here keeps sorted.length - i gutters.
    if (sorted.length - i < minCols - 1) break;
    const ratio = sorted[i]!.width / Math.max(0.5, sorted[i - 1]!.width);
    if (ratio > bestRatio) { bestRatio = ratio; cutIndex = i; }
  }
  if (cutIndex < 0) return found.map((g) => g.centre);

  const floor = sorted[cutIndex]!.width;
  return found.filter((g) => g.width >= floor).map((g) => g.centre);
}

/**
 * Find visually contiguous runs of lines.
 *
 * Deliberately says nothing about whether a run is a table. Region finding and
 * table rejection are separate concerns and sharing one threshold between them
 * cannot work: tightening it to suppress false positives also merges real
 * columns and truncates real tables, and loosening it does the reverse.
 *
 * So this answers only "which lines form one visual block", by vertical
 * continuity — the same criterion a reader uses. Whether the block is a grid is
 * decided later, by column occupancy, which is the property that actually
 * discriminates.
 */
function findRegions(lines: Line[], opts: Required<TableOptions>): Region[] {
  const regions: Region[] = [];
  const heights = lines.map((l) => l.bbox.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[heights.length >> 1]! : 12;

  let start = 0;
  for (let i = 1; i <= lines.length; i++) {
    const broken =
      i === lines.length ||
      lines[i]!.bbox.y - (lines[i - 1]!.bbox.y + lines[i - 1]!.bbox.h) > medH * 1.6;
    if (!broken) continue;
    if (i - start >= opts.minRows) {
      regions.push({ from: start, to: i - 1, lines: lines.slice(start, i) });
    }
    start = i;
  }
  return regions;
}

// ---------------------------------------------------------------------------
// Column inference
// ---------------------------------------------------------------------------

/**
 * Infer column boundaries from the x-projection of word coverage.
 *
 * Builds a coverage histogram at 1-point resolution over the region's x extent,
 * counting how many ROWS have ink at each x. A gutter is a maximal run of x
 * positions where fewer than (1 - gutterConsistency) of the rows have ink.
 *
 * Requiring consistency across rows is the whole point. A single long cell in one
 * row would, on its own, fill what is a gutter everywhere else; and a single
 * short row would, on its own, create gutters in the middle of every wide cell.
 * Only a gap that persists down the region is a column boundary.
 */
export function inferColumns(
  region: { lines: Line[] },
  opts: Required<TableOptions>,
): number[] {
  return gutterBoundaries(region.lines, opts.gutterConsistency, opts.minCols);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build a Table from a region and its column boundaries.
 *
 * A cluster is assigned to the column its CENTRE falls in, and its colSpan is the
 * number of boundaries it crosses. Spanning matters: an invoice total row
 * ("Total Invoice Value") legitimately spans the description columns, and
 * splitting it across them would produce three fragments of a phrase.
 */
function assemble(
  region: Region,
  boundaries: number[],
  method: Table["method"],
  opts: Required<TableOptions>,
  depth = 0,
): Table | null {
  const cols = boundaries.length + 1;
  // The column-count gate is applied AFTER the cells exist, because whether two
  // columns are admissible depends on what is in them, and because an
  // under-supported boundary is repaired rather than fatal. See below.
  if (cols < 2) return null;

  const colOf = (x: number): number => {
    let i = 0;
    while (i < boundaries.length && x > boundaries[i]!) i++;
    return i;
  };

  const cells: TableCell[] = [];
  let filled = 0;

  // Cells come FROM the boundaries. Every word is placed in the column its
  // centre falls in and words in the same column are joined, so a multi-word
  // cell ("NEFT INWARD SHREE STEEL") stays one cell rather than becoming four,
  // and a narrow gap inside a cell can no longer invent a column.
  region.lines.forEach((line, rowIdx) => {
    const byCol = new Map<number, { words: string[]; bbox: BBox }>();
    for (const w of [...line.words].sort((a, b) => a.bbox.x - b.bbox.x)) {
      const col = colOf(w.bbox.x + w.bbox.w / 2);
      const e = byCol.get(col);
      if (e) { e.words.push(w.text); e.bbox = bboxUnion(e.bbox, w.bbox); }
      else byCol.set(col, { words: [w.text], bbox: { ...w.bbox } });
    }
    for (const [col, e] of byCol) {
      // colSpan from how many boundaries the assembled cell actually crosses.
      const startCol = colOf(e.bbox.x + 0.5);
      const endCol = colOf(e.bbox.x + e.bbox.w - 0.5);
      const span = Math.max(1, endCol - startCol + 1);
      cells.push({
        text: e.words.join(" "),
        bbox: e.bbox,
        row: rowIdx,
        col: span > 1 ? startCol : col,
        rowSpan: 1,
        colSpan: span,
      });
      filled++;
    }
  });

  // ---- The grid gate.
  //
  // See minTypedColumns in DEFAULTS for why column TYPE, not occupancy, is the
  // discriminator that works.
  //
  // Reject anything where a column is barely used. Indented prose projects into
  // "columns" that only a handful of rows reach into; a real table fills them.
  // Without this, the charge sheet's 27-line numbered body came back as a
  // 27x3 table at 0.70 confidence — confidently wrong structured data, which is
  // worse than no table at all, because a consumer reads those cells as if the
  // columns meant something.
  const perColumn = new Array<number>(cols).fill(0);
  const rowsPerColumn = new Array<number>(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    const rowsWithCell = new Set(cells.filter((x) => x.col <= c && x.col + x.colSpan - 1 >= c).map((x) => x.row));
    perColumn[c] = rowsWithCell.size / region.lines.length;
    // The absolute floor counts only cells that START in the column.
    //
    // A cell with colSpan > 1 is evidence AGAINST the boundaries it crosses on
    // that row, not for them, so counting it as populating each column it
    // covers is backwards for this purpose. It is what kept the writ petition's
    // chronology alive after the floor was added: the wide sentence cell in
    // column 1 spanned columns 2 and 3, lending its occupancy to two columns
    // that no row actually started a cell in more than once.
    rowsPerColumn[c] = new Set(cells.filter((x) => x.col === c).map((x) => x.row)).size;
  }
  /**
   * An under-supported boundary is REPAIRED, not fatal.
   *
   * A column no row starts a cell in more than once is not a column, but the
   * lines around it are often still a table — the boundary is a spurious split
   * inside one wide cell. Rejecting the whole region for it threw away real
   * structure: the charge sheet's "documents relied upon" list projected as five
   * columns, three of them supported by one row each, and the correct answer is
   * the two-column D-n/description list underneath, not "no table".
   *
   * So drop the boundary on the failing column's left (its right, for column 0,
   * which has no left boundary) and re-assemble. Recursion is bounded, and the
   * column-count and type gates below still decide whether what survives is a
   * table at all.
   */
  if (depth < 6) {
    for (let c = 0; c < cols; c++) {
      if (rowsPerColumn[c]! >= opts.minColumnRows) continue;
      const idx = c === 0 ? 0 : c - 1;
      const b = boundaries[idx];
      if (b === undefined) break;
      return assemble(region, boundaries.filter((x) => x !== b), method, opts, depth + 1);
    }
  }

  /**
   * The column-count gate, with one narrow exception for two columns.
   *
   * minCols is 3 because legal documents are full of two-column-looking
   * label/value blocks — an FIR header, a cause title, a case-diary masthead —
   * and reading those as tables produces cells whose "columns" mean nothing.
   *
   * But some real tables have exactly two columns, and they matter: a charge
   * sheet's list of documents relied upon (D-1 … D-n), its list of witnesses
   * (PW-1 … PW-n), a schedule of annexures. What separates those from a
   * label/value block is that EVERY row opens with an identifier token — D-1,
   * PW-4, A-2, a serial, a date — and every row has content to the right of the
   * boundary. A case-diary masthead fails on the first test: its rows open with
   * "FIR", "Under" and "Case".
   *
   * The test is on the row's LEADING TOKEN rather than on the whole first
   * column, because the projection sometimes makes one row's cell span both
   * columns (when its text starts flush against the boundary), and a
   * column-level type vote then silently drops that row from the vote. Judging
   * the first token is independent of how the cell happened to be split, which
   * is what a reader does anyway.
   */
  if (cols < opts.minCols) {
    if (cols !== 2) return null;
    const rowIdxs = [...new Set(cells.map((x) => x.row))].sort((a, b) => a - b);
    const everyRowOpensWithId = rowIdxs.length === region.lines.length && rowIdxs.every((r) => {
      const first = cells.filter((x) => x.row === r).sort((a, b) => a.col - b.col)[0];
      const token = (first?.text ?? "").trim().split(/\s+/)[0] ?? "";
      return NON_PROSE.has(cellKind(token));
    });
    const rightFull = perColumn[1] === 1;
    if (!everyRowOpensWithId || !rightFull) return null;
  }

  /**
   * Column type homogeneity. Two columns need one typed column rather than two:
   * the second column of a D-n/description list is prose by nature, and the
   * strictness that replaces the missing type signal is the leading-identifier
   * test above.
   */
  const typed = countTypedColumns(cells, cols);
  const needTyped = cols === 2 ? 1 : opts.minTypedColumns;
  if (typed.typedColumns < needTyped) {
    /**
     * Before rejecting, try MERGING two adjacent untyped columns.
     *
     * Two neighbouring columns that both hold prose cannot be distinguished as
     * columns by anything this detector can see, so the simpler reading — one
     * wide prose column — explains the same lines with one fewer boundary. This
     * is the same Occam rule as redundantBoundaries, applied to type rather than
     * to repeated literals.
     *
     * It is what recovers the charge sheet's list of documents relied upon.
     * D-1 … D-4 projected as three columns — the identifier, and the
     * description broken in two at a wide gap — which is one typed column out of
     * three and therefore rejected outright. Merging the two prose columns
     * yields the D-n/description pair a reader sees, and the two-column gate
     * above then has to be satisfied for it to be accepted at all.
     *
     * A rejection can only ever become a stricter-gated acceptance this way, so
     * it cannot loosen the false-positive behaviour: indented prose has no typed
     * leading column and still fails.
     */
    if (depth < 6) {
      for (let c = 0; c + 1 < cols; c++) {
        if (typed.typedFlags[c] === true || typed.typedFlags[c + 1] === true) continue;
        const b = boundaries[c];
        if (b === undefined) continue;
        return assemble(region, boundaries.filter((x) => x !== b), method, opts, depth + 1);
      }
    }
    return null;
  }

  const worstColumn = Math.min(...perColumn);
  const meanColumn = perColumn.reduce((a, b) => a + b, 0) / cols;
  if (worstColumn < opts.minColumnOccupancy) return null;
  if (meanColumn < opts.minMeanOccupancy) return null;

  // ---- Merge continuation rows.
  //
  // A wrapped cell produces a spurious row: a bank-statement entry whose credit
  // and balance overflow to the next line, or a cause-list entry whose party
  // names and advocate run to three lines under one case number. Modelling one
  // row per LINE makes those look like rows with an empty serial, an empty date
  // and an empty case number, which is not a row any reader would recognise.
  //
  // The rule is general and does not need to know the document type: a row whose
  // LEADING columns are all empty, while a later column has content, is a
  // continuation of the row above it. Leading columns are where the identifying
  // values live — the serial, the date, the case number — so their absence is
  // exactly the signature of a wrap.
  const merged = mergeContinuationRows(cells, cols);
  const mergedRowCount = new Set(merged.map((c) => c.row)).size;

  const bbox = region.lines.reduce<BBox>((acc, l) => bboxUnion(acc, l.bbox), { ...region.lines[0]!.bbox });

  /**
   * Confidence from grid REGULARITY, not from cell count.
   *
   * A real table fills most of its grid and has rows of similar width. A false
   * positive — a run of indented prose that happened to split into clusters — has
   * a sparse, ragged grid. Occupancy captures exactly that difference, and a
   * table detected at low confidence is worse than none, because downstream code
   * will read its cells as if they meant something.
   */
  const occupancy = filled / (region.lines.length * cols);
  const rowWidths = region.lines.map((l) => l.bbox.w);
  const meanW = rowWidths.reduce((a, b) => a + b, 0) / rowWidths.length;
  const widthVar = meanW > 0
    ? Math.sqrt(rowWidths.reduce((a, w) => a + (w - meanW) ** 2, 0) / rowWidths.length) / meanW
    : 1;

  const conf = Math.max(0, Math.min(0.95,
    0.25 * Math.min(1, occupancy * 1.4) +
    0.25 * meanColumn +
    0.30 * typed.homogeneity +
    0.10 * Math.max(0, 1 - widthVar * 1.5) +
    0.10 * Math.min(1, region.lines.length / 6),
  ));

  return { bbox, cells: merged, rows: mergedRowCount, cols, method, conf };
}

/**
 * Detect tables on a page.
 *
 * Returns an empty array rather than a low-confidence guess when nothing is
 * clearly tabular. A wrongly detected table is worse than no table: a consumer
 * reading cells that do not correspond to columns produces confidently wrong
 * structured data, whereas an absent table just falls back to prose extraction,
 * which is what happens today anyway.
 */
export function detectTables(page: Page, options: TableOptions = {}): Table[] {
  const opts = { ...DEFAULTS, ...options };
  // Margins and headers do not carry tables worth extracting; a running header
  // that happens to have three tab stops is not a table.
  const body = page.lines.filter((l) => l.zone === "BODY");
  if (body.length < opts.minRows) return [];

  const out: Table[] = [];
  for (const region of findRegions(body, opts)) {
    /**
     * Try the whole run first, then variants with the leading line(s) dropped.
     *
     * A caption or a column-heading line very often has different spacing from
     * the data rows beneath it — "Statement Period: …" above a ledger, or a
     * heading row whose labels are shorter than the values. Included in the
     * projection it shifts or erases a gutter and the table fails to assemble;
     * dropped, the grid appears cleanly. Trying both is cheaper than trying to
     * classify caption lines in advance, and it keeps the header when the header
     * genuinely aligns.
     */
    const attempts: Line[][] = [region.lines];
    if (region.lines.length > opts.minRows) attempts.push(region.lines.slice(1));
    if (region.lines.length > opts.minRows + 1) attempts.push(region.lines.slice(2));
    // Also try dropping a trailing total/footer line.
    if (region.lines.length > opts.minRows) attempts.push(region.lines.slice(0, -1));

    let best: Table | null = null;
    let bestLines: Line[] = region.lines;
    let bestBoundaries: number[] = [];
    for (const lines of attempts) {
      const sub: Region = { from: region.from, to: region.to, lines };
      const boundaries = inferColumns(sub, opts);
      const t = assemble(sub, boundaries, "PROJECTION", opts);
      if (!t) continue;
      /**
       * Select on CONFIDENCE, then prefer FEWER columns.
       *
       * The first version preferred more columns, reasoning that a six-column
       * ledger read as three is the worse answer. That is true, but the rule
       * generalises badly: it also prefers a five-column cause list read as six,
       * where the sixth "column" is the literal "No." split out of every case
       * number. Given the choice between two readings of the same lines, the
       * over-split one always has more columns, so the preference reliably
       * chose it.
       *
       * Confidence already encodes what actually matters — occupancy and column
       * type homogeneity — so it is the right primary key, and Occam settles
       * ties: the simpler grid that explains the same lines is the better one.
       */
      /**
       * A full-width reading beats a two-column one regardless of confidence.
       *
       * Two columns are admitted only by the narrow exception in assemble(), for
       * identifier/description lists. They must not compete with a richer
       * reading of the same lines, because a coarse grid is always the more
       * REGULAR grid: the invoice's true six-column reading scores 0.87 while a
       * two-column reading of the same four lines scores higher, and
       * confidence-primary selection duly picked it and threw away four columns
       * of line-item data.
       */
      const tier = (x: Table): number => (x.cols >= opts.minCols ? 1 : 0);
      const better = !best
        || tier(t) > tier(best)
        || (tier(t) === tier(best)
            && (t.conf > best.conf + 0.02
                || (Math.abs(t.conf - best.conf) <= 0.02 && t.cols < best.cols)));
      if (better) {
        best = t; bestLines = lines; bestBoundaries = boundaries;
      }
    }

    /**
     * Collapse redundant boundaries on the CHOSEN table, not on each candidate.
     *
     * Doing it per candidate did not work: collapsing reduces the column count,
     * and the selection above prefers more columns, so the un-collapsed variant
     * of another attempt always won and the collapse was silently discarded.
     * Applying it to the winner instead makes it unconditional.
     *
     * Iterated, because collapsing one fragment can reveal another — a cause
     * list splitting "W.P.  No.  18842/2024" into three needs two passes.
     */
    if (best) {
      for (let pass = 0; pass < 4; pass++) {
        const drop = redundantBoundaries(best, bestBoundaries);
        if (drop.length === 0) break;
        const kept = bestBoundaries.filter((b) => !drop.includes(b));
        const collapsed = assemble(
          { from: region.from, to: region.to, lines: bestLines }, kept, "PROJECTION", opts,
        );
        if (!collapsed) break;
        best = collapsed;
        bestBoundaries = kept;
      }
    }

    // 0.45 is the floor below which the grid is too ragged to be read as a grid.
    if (best && best.conf >= 0.45) out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consumption helpers
// ---------------------------------------------------------------------------

/** The cells of one row, in column order, with gaps left as empty strings. */
export function rowCells(table: Table, row: number): string[] {
  const out = new Array<string>(table.cols).fill("");
  for (const c of table.cells) {
    if (c.row !== row) continue;
    out[c.col] = c.text;
  }
  return out;
}

/** Every row as an array of column strings. */
export function toGrid(table: Table): string[][] {
  return Array.from({ length: table.rows }, (_, r) => rowCells(table, r));
}

/**
 * Guess which row is the header.
 *
 * Returns null rather than assuming row 0. A bank statement's grid often starts
 * with a caption line, and a cause list's first tabular row is sometimes already
 * data. A header is short, alphabetic and non-numeric across most columns — data
 * rows in these documents are numeric almost by definition.
 */
export function headerRow(table: Table): number | null {
  const grid = toGrid(table);
  for (let r = 0; r < Math.min(3, grid.length); r++) {
    const cells = grid[r]!.filter((c) => c.length > 0);
    if (cells.length < Math.max(2, table.cols - 1)) continue;
    const numeric = cells.filter((c) => /\d/.test(c)).length;
    const shortish = cells.filter((c) => c.length <= 24).length;
    if (numeric / cells.length <= 0.25 && shortish / cells.length >= 0.8) return r;
  }
  return null;
}

/**
 * Rows keyed by header, for the rows below the header.
 * Column names are the header cells; unnamed columns get `col{n}`.
 */
export function toRecords(table: Table): Array<Record<string, string>> {
  const hr = headerRow(table);
  const grid = toGrid(table);
  const names = hr === null
    ? Array.from({ length: table.cols }, (_, i) => `col${i}`)
    : grid[hr]!.map((h, i) => (h.trim().length > 0 ? h.trim() : `col${i}`));
  const start = hr === null ? 0 : hr + 1;
  return grid.slice(start).map((row) => {
    const rec: Record<string, string> = {};
    row.forEach((v, i) => { rec[names[i] ?? `col${i}`] = v; });
    return rec;
  });
}


// ---------------------------------------------------------------------------
// Column typing
// ---------------------------------------------------------------------------

// CellKind lives in types.ts so that TableRecord can name it without
// importing from a layout module.
export type { CellKind } from "../types.js";

/**
 * Classify one cell's content.
 *
 * Coarse on purpose. The question is not "what is this value" — the grammar pack
 * answers that later — but "is this column typed at all", which needs only
 * enough resolution to tell a column of dates from a column of sentence
 * fragments.
 */
export function cellKind(text: string): CellKind {
  const t = text.trim();
  if (t.length === 0) return "EMPTY";
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t)) return "DATE";
  if (/^(?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?\s*(?:\/-|CR|DR)?$/i.test(t) && /\d/.test(t)) {
    // A grouped number is money; a bare short integer is a serial.
    return /[,.]/.test(t) || t.replace(/\D/g, "").length > 4 ? "MONEY" : "NUM";
  }
  if (/^\d{1,4}$/.test(t)) return "NUM";
  // A code has no spaces and mixes letters and digits, or is a dotted token.
  if (!/\s/.test(t) && t.length <= 24 && /[A-Za-z]/.test(t) && /[\d.]/.test(t)) return "CODE";
  return t.length <= 24 ? "TEXT_SHORT" : "TEXT_LONG";
}

const NON_PROSE = new Set<CellKind>(["DATE", "MONEY", "NUM", "CODE"]);

/**
 * How many columns are homogeneously non-prose, and how homogeneous the grid is
 * overall. Empty cells are excluded from a column's vote: a sparse debit column
 * is still a money column.
 */
export function countTypedColumns(
  cells: TableCell[],
  cols: number,
): { typedColumns: number; homogeneity: number; typedFlags: boolean[] } {
  let typedColumns = 0;
  const modalFractions: number[] = [];
  const typedFlags: boolean[] = [];

  for (let c = 0; c < cols; c++) {
    const kinds = cells
      .filter((x) => x.col === c && x.colSpan === 1)
      .map((x) => cellKind(x.text))
      .filter((k) => k !== "EMPTY");
    if (kinds.length === 0) { modalFractions.push(0); typedFlags.push(false); continue; }

    const counts = new Map<CellKind, number>();
    for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    const [modalKind, modalCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const fraction = modalCount / kinds.length;
    modalFractions.push(fraction);

    // A column counts as typed when it is both non-prose and consistent.
    const isTyped = NON_PROSE.has(modalKind) && fraction >= 0.6;
    typedFlags.push(isTyped);
    if (isTyped) typedColumns++;
  }

  const homogeneity = modalFractions.length > 0
    ? modalFractions.reduce((a, b) => a + b, 0) / modalFractions.length
    : 0;
  return { typedColumns, homogeneity, typedFlags };
}


/**
 * Merge rows that are continuations of the row above.
 *
 * A row qualifies when its first column is empty and at least one later column
 * has content. Text is appended within each column with a space, which is what a
 * wrapped cell means; the row's bbox grows to cover both lines so the provenance
 * highlight still lands on everything the cell contains.
 *
 * The first row can never be a continuation, and a row with content in column 0
 * never is — so a table whose first column is legitimately blank in places (rare,
 * and usually a sign the column order was misread) degrades to no merging rather
 * than to wrong merging.
 */
export function mergeContinuationRows(cells: TableCell[], cols: number): TableCell[] {
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b);
  if (rows.length === 0) return cells;

  const byRow = new Map<number, TableCell[]>();
  for (const c of cells) {
    const arr = byRow.get(c.row);
    if (arr) arr.push(c); else byRow.set(c.row, [c]);
  }

  const hasCol = (row: number, col: number) =>
    (byRow.get(row) ?? []).some((c) => c.col <= col && c.col + c.colSpan - 1 >= col && c.text.trim().length > 0);

  // Map each source row to its target row after merging.
  const target = new Map<number, number>();
  let current = rows[0]!;
  target.set(current, current);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const isContinuation = !hasCol(r, 0) && (byRow.get(r) ?? []).some((c) => c.text.trim().length > 0);
    target.set(r, isContinuation ? current : (current = r));
  }

  // Rebuild, joining text per (targetRow, col).
  const acc = new Map<string, TableCell>();
  for (const c of cells) {
    if (c.text.trim().length === 0) continue;
    const tr = target.get(c.row) ?? c.row;
    const key = `${tr}|${c.col}`;
    const e = acc.get(key);
    if (e) {
      e.text = `${e.text} ${c.text}`.trim();
      e.bbox = bboxUnion(e.bbox, c.bbox);
      e.rowSpan = Math.max(e.rowSpan, 1);
      e.colSpan = Math.max(e.colSpan, c.colSpan);
    } else {
      acc.set(key, { ...c, row: tr, bbox: { ...c.bbox } });
    }
  }

  // Renumber target rows to be contiguous from 0.
  const targets = [...new Set([...acc.values()].map((c) => c.row))].sort((a, b) => a - b);
  const renumber = new Map(targets.map((t, i) => [t, i]));
  return [...acc.values()].map((c) => ({ ...c, row: renumber.get(c.row) ?? c.row }));
}



/**
 * Boundaries that split a repeated literal off from its neighbour.
 *
 * In a monospaced cause list the intra-cell gaps of "W.P.  No.  18842/2024" are
 * exactly as wide as the gaps between real columns, because both are two spaces
 * in the same fixed-width face. No width-based rule can separate them — the
 * geometry is genuinely identical.
 *
 * What separates them is CONTENT. A column holding the identical short literal
 * in every row ("No." down the whole list) is not a column; it is a fragment of
 * the label in the column beside it. Real columns vary down the page — that is
 * what makes them columns.
 *
 * Returns the boundaries to DROP so the fragment rejoins its neighbour.
 */
export function redundantBoundaries(table: Table, boundaries: number[]): number[] {
  const drop: number[] = [];
  for (let c = 0; c < table.cols; c++) {
    const texts = table.cells
      .filter((x) => x.col === c && x.colSpan === 1 && x.text.trim().length > 0)
      .map((x) => x.text.trim());
    if (texts.length < 2) continue;
    // Short literal, repeated in nearly every row of the column.
    const counts = new Map<string, number>();
    for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1);
    const [literal, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (literal.length > 6) continue;
    if (n / texts.length < 0.8) continue;
    // Drop the boundary on the LEFT of this column so it merges leftwards; for
    // column 0 there is no left boundary, so merge rightwards instead.
    const idx = c === 0 ? 0 : c - 1;
    const b = boundaries[idx];
    if (b !== undefined) drop.push(b);
  }
  return drop;
}
