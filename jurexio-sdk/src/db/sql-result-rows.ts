/** Normalize drizzle/pg execute results to a row array (server tsc helper). */
export function sqlResultRows<T = Record<string, unknown>>(
  result: { rows?: T[] } | T[],
): T[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}
