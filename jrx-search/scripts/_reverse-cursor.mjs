/**
 * Shared reverse-chronological cursor for SC corpus backfills (newest first).
 * Cursor: { cursorDate: 'YYYY-MM-DD', cursorId: number } — process rows strictly older.
 */
export const REVERSE_CURSOR_INIT = {
  cursorDate: "9999-12-31",
  cursorId: 2147483647,
  done: 0,
  errors: 0,
  startedAt: null,
};

/** SQL fragment: $1 = cursorDate, $2 = cursorId */
export const REVERSE_ORDER_SQL = `
  COALESCE(decision_date, make_date(GREATEST(year, 1900), 12, 31)) DESC, id DESC`;

export const REVERSE_WHERE_AFTER_CURSOR = `
  (
    COALESCE(decision_date, make_date(GREATEST(year, 1900), 12, 31)) < $1::date
    OR (
      COALESCE(decision_date, make_date(GREATEST(year, 1900), 12, 31)) = $1::date
      AND id < $2
    )
  )`;

export function advanceReverseCursor(state, row) {
  const d = row.decision_date ?? `${Math.max(row.year ?? 1900, 1900)}-12-31`;
  state.cursorDate =
    typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  state.cursorId = Number(row.id);
}
