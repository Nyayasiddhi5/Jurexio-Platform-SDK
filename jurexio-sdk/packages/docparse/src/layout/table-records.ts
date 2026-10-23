/**
 * Table consumption: turning a detected grid into something a caller can use.
 *
 * Detection answers "where is the grid". This module answers "what is it", which
 * is the question a case-creation flow, a ledger review or a cause-list import
 * actually asks. The two are kept apart because they fail differently: a
 * mis-detected grid produces nonsense cells, while a mis-labelled grid produces
 * correct cells under the wrong heading, and a reviewer needs to be able to see
 * which happened. That is also why `gridConf` and `semanticsConf` are separate
 * numbers rather than one blended score.
 *
 * WHY THIS DOES NOT EMIT AUTOFILL CANDIDATES.
 *
 * The tempting next step is to push every dated money row into the `dates` and
 * `amounts` candidate paths. That would be wrong twice over:
 *
 *   1. A bank statement's ten transaction dates are not document-level facts.
 *      None of them is "the date of the document", and offering them for a field
 *      that means that produces a CONFLICT between ten equally-wrong values.
 *   2. The grid re-reads the same words the prose sweep already read. Counting
 *      them again registers as corroboration, and corroboration raises
 *      confidence. Evidence that is not independent must not raise confidence,
 *      or the whole calibration stops meaning anything.
 *
 * So tables are published as structure with per-cell provenance, and a consumer
 * that wants ledger rows reads them as ledger rows.
 */

import type {
  BBox, CellKind, ParsedDate, ParsedMoney, Table, TableRecord, TableSemantics,
} from "../types.js";
import { cellKind, toGrid, headerRow } from "./tables.js";
import { parseDate } from "../grammar/dates.js";
import { findMoney } from "../grammar/money.js";

// ---------------------------------------------------------------------------
// Column typing
// ---------------------------------------------------------------------------

/**
 * The modal kind of a column, ignoring empty cells and the header row.
 *
 * The header is excluded because a header is text by definition — "Date",
 * "Amount", "Particulars" — and including it in the vote drags every column
 * towards TEXT_SHORT. On a four-row invoice that single row is a quarter of the
 * evidence, which is enough to flip a column's type.
 */
export function columnKinds(grid: string[][], header: number | null): CellKind[] {
  const cols = grid[0]?.length ?? 0;
  const out: CellKind[] = [];
  for (let c = 0; c < cols; c++) {
    const kinds: CellKind[] = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === header) continue;
      const k = cellKind(grid[r]![c] ?? "");
      if (k !== "EMPTY") kinds.push(k);
    }
    if (kinds.length === 0) { out.push("EMPTY"); continue; }
    const counts = new Map<CellKind, number>();
    for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    out.push([...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semantics
// ---------------------------------------------------------------------------

const CASE_NO_CELL = /\b(?:W\.?P\.?|C\.?R\.?L\.?|S\.?L\.?P\.?|O\.?S\.?|C\.?C\.?|S\.?C\.?|M\.?A\.?C\.?T\.?|C\.?M\.?A\.?|A\.?S\.?)[A-Z.()\s]{0,12}\d{1,6}\s*\/\s*(?:19|20)\d{2}\b/i;
const CNR_CELL = /\b[A-Z]{4}\d{6,8}\d{4}\b/;

/**
 * Label a grid by the SHAPE of its column types, not by the document it came
 * from.
 *
 * Deliberately shape-driven: a ledger inside a charge sheet is still a ledger,
 * and a bank statement annexed to a complaint is not a "complaint table". Tying
 * semantics to the document classification would mislabel exactly the annexures
 * that matter most in a cheque-bounce or a fraud matter.
 */
export function classifyTable(
  grid: string[][],
  kinds: CellKind[],
): { semantics: TableSemantics; conf: number } {
  const n = (k: CellKind): number => kinds.filter((x) => x === k).length;
  const dates = n("DATE");
  const money = n("MONEY");
  const nums = n("NUM");
  const codes = n("CODE");
  const flat = grid.flat().join(" ");

  // A listing is recognised by content, not shape: a court listing is the one
  // grid type whose defining columns are identifiers with a known format.
  const hasCase = CASE_NO_CELL.test(flat);
  const hasCnr = CNR_CELL.test(flat);
  if (hasCase && hasCnr) return { semantics: "LISTING", conf: 0.92 };
  if (hasCase && kinds.length >= 4) return { semantics: "LISTING", conf: 0.7 };

  // Dated money movements. Two money columns (debit/credit) or one plus a
  // running balance; at least one date column.
  if (dates >= 1 && money >= 2) return { semantics: "LEDGER", conf: dates >= 2 ? 0.9 : 0.82 };

  // Priced lines: a serial or code column, and at least two numeric columns, at
  // least one of which is money.
  if (money >= 1 && (nums >= 1 || codes >= 1) && kinds.length >= 4) {
    return { semantics: "LINE_ITEMS", conf: money >= 2 ? 0.85 : 0.7 };
  }

  // Identifier + description. Two columns, the first typed.
  if (kinds.length === 2 && kinds[0] !== undefined && kinds[0] !== "EMPTY"
      && ["CODE", "NUM", "DATE"].includes(kinds[0])) {
    return { semantics: "ID_LIST", conf: 0.8 };
  }

  return { semantics: "UNKNOWN", conf: 0.35 };
}

// ---------------------------------------------------------------------------
// Record construction
// ---------------------------------------------------------------------------

/** Cell bboxes laid out parallel to the grid, so a highlight can find its cell. */
function cellBoxGrid(table: Table, rowsCount: number): Array<Array<BBox | null>> {
  const rowIdx = [...new Set(table.cells.map((c) => c.row))].sort((a, b) => a - b);
  const out: Array<Array<BBox | null>> = [];
  for (let r = 0; r < rowsCount; r++) {
    const row = new Array<BBox | null>(table.cols).fill(null);
    const target = rowIdx[r];
    if (target !== undefined) {
      for (const c of table.cells) {
        if (c.row !== target) continue;
        for (let k = c.col; k < Math.min(table.cols, c.col + c.colSpan); k++) row[k] = c.bbox;
      }
    }
    out.push(row);
  }
  return out;
}

/**
 * Normalise the columns whose type makes normalisation unambiguous.
 *
 * Only DATE and MONEY columns are normalised, and only through the same parsers
 * the rest of the engine uses, so a date in a cell and the same date in prose
 * end up in one equivalence class. A cell that fails to parse is recorded as
 * null rather than skipped: a ledger row with an unreadable amount must stay
 * visibly unreadable, because dropping it silently changes the total.
 */
function normalise(
  grid: string[][], kinds: CellKind[], header: number | null, referenceYear?: number,
): TableRecord["normalized"] {
  const dates: Record<number, Array<ParsedDate | null>> = {};
  const money: Record<number, Array<ParsedMoney | null>> = {};
  for (let c = 0; c < kinds.length; c++) {
    if (kinds[c] === "DATE") {
      dates[c] = grid.map((row, r) => {
        if (r === header) return null;
        const t = (row[c] ?? "").trim();
        if (t.length === 0) return null;
        return parseDate(t, referenceYear !== undefined ? { referenceYear } : {});
      });
    } else if (kinds[c] === "MONEY") {
      money[c] = grid.map((row, r) => {
        if (r === header) return null;
        const t = (row[c] ?? "").trim();
        if (t.length === 0) return null;
        // A bare grouped number in a money column is money; the currency symbol
        // sits on the column heading, not in every cell, so it is supplied here
        // rather than requiring each cell to carry one.
        const found = findMoney(/[₹]|\bRs\b|\bINR\b/i.test(t) ? t : `Rs. ${t}`);
        const first = found[0];
        if (first === undefined) return null;
        // A malformed grouping in a ledger cell is a garbled read, and a wrong
        // figure in a money column is the most consequential error this engine
        // can make, so it is surfaced as unparsed rather than as a number.
        if (first.grouping === "MALFORMED") return null;
        return { amount: first.amount, currency: first.currency, scale: first.scale, raw: t };
      });
    }
  }
  return { dates, money };
}

export interface TableRecordOptions {
  referenceYear?: number;
}

/** Build the publishable record for one detected table. */
export function toTableRecord(
  table: Table,
  documentId: string,
  pageNo: number,
  options: TableRecordOptions = {},
): TableRecord {
  const grid = toGrid(table);
  const header = headerRow(table);
  const kinds = columnKinds(grid, header);
  const { semantics, conf } = classifyTable(grid, kinds);

  const columns = header !== null && grid[header] !== undefined
    ? grid[header]!.map((h, i) => (h.trim().length > 0 ? h.trim() : `col${i + 1}`))
    : kinds.map((_, i) => `col${i + 1}`);

  return {
    documentId,
    pageNo,
    semantics,
    gridConf: table.conf,
    semanticsConf: conf,
    method: table.method,
    rows: grid.length,
    cols: table.cols,
    headerRow: header,
    columns,
    columnKinds: kinds,
    grid,
    cellBoxes: cellBoxGrid(table, grid.length),
    normalized: normalise(
      grid, kinds, header,
      options.referenceYear,
    ),
  };
}

/**
 * A ledger's rows as debit/credit movements.
 *
 * Provided because "read the transactions" is the single most common thing a
 * consumer wants from a LEDGER, and leaving every caller to re-derive which
 * money column is the debit invites each of them to get it wrong differently.
 * The rule used here is positional and stated rather than guessed: in an Indian
 * bank statement the columns run debit, credit, balance, and the balance is the
 * last money column because it is the only one populated on every row.
 */
export function ledgerRows(rec: TableRecord): Array<{
  row: number;
  date: ParsedDate | null;
  particulars: string;
  debit: ParsedMoney | null;
  credit: ParsedMoney | null;
  balance: ParsedMoney | null;
}> {
  if (rec.semantics !== "LEDGER") return [];
  const moneyCols = rec.columnKinds.flatMap((k, i) => (k === "MONEY" ? [i] : []));
  const dateCols = rec.columnKinds.flatMap((k, i) => (k === "DATE" ? [i] : []));
  const textCols = rec.columnKinds.flatMap((k, i) => (k === "TEXT_LONG" || k === "TEXT_SHORT" ? [i] : []));

  // The balance column is the money column populated in every data row.
  const dataRows = rec.grid.map((_, r) => r).filter((r) => r !== rec.headerRow);
  const fillOf = (c: number): number =>
    dataRows.filter((r) => (rec.grid[r]![c] ?? "").trim().length > 0).length / Math.max(1, dataRows.length);
  const balanceCol = moneyCols.length > 0
    ? moneyCols.reduce((best, c) => (fillOf(c) > fillOf(best) ? c : best), moneyCols[moneyCols.length - 1]!)
    : null;
  const movement = moneyCols.filter((c) => c !== balanceCol);
  const debitCol = movement[0] ?? null;
  const creditCol = movement[1] ?? null;

  const at = (r: number, c: number | null): ParsedMoney | null =>
    c === null ? null : (rec.normalized.money[c]?.[r] ?? null);

  return dataRows.map((r) => ({
    row: r,
    date: dateCols[0] !== undefined ? (rec.normalized.dates[dateCols[0]]?.[r] ?? null) : null,
    particulars: textCols.map((c) => rec.grid[r]![c] ?? "").join(" ").trim(),
    debit: at(r, debitCol),
    credit: at(r, creditCol),
    balance: at(r, balanceCol),
  }));
}
