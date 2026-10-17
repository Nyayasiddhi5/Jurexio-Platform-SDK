/**
 * NYS Athena OpenAPI expects: { q, year?, court?, archive?: 'sc'|'hc', limit? }
 * NYV SDK / matrix historically sent { query, archive: 'all' } → Zod 400.
 */
export function normalizeNysAthenaSearchBody(
  body: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const src = body && typeof body === 'object' ? { ...body } : {};
  const qRaw = src.q ?? src.query ?? src.search;
  const q = typeof qRaw === 'string' ? qRaw.trim() : qRaw != null ? String(qRaw).trim() : '';
  const out: Record<string, unknown> = {};
  if (q) out.q = q;

  if (src.year !== undefined && src.year !== null && src.year !== '') {
    const y = typeof src.year === 'number' ? src.year : Number(src.year);
    if (Number.isFinite(y)) out.year = y;
  }
  if (typeof src.court === 'string' && src.court.trim()) out.court = src.court.trim();

  const arch = typeof src.archive === 'string' ? src.archive.trim().toLowerCase() : '';
  if (arch === 'sc' || arch === 'hc') out.archive = arch;
  // omit archive for "all" / unknown — NYS searches both tables when unset

  if (src.limit !== undefined && src.limit !== null && src.limit !== '') {
    const lim = typeof src.limit === 'number' ? src.limit : Number(src.limit);
    if (Number.isFinite(lim)) out.limit = lim;
  }
  return out;
}
