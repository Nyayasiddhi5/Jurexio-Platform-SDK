/** Postgres 28P01 — role exists but password was rejected. */
function codeOf(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const rec = value as { code?: unknown; cause?: unknown };
  if (typeof rec.code === 'string') return rec.code;
  return codeOf(rec.cause, depth + 1);
}

export function isPgAuthFailed(err: unknown): boolean {
  if (codeOf(err) === '28P01') return true;
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /password authentication failed/i.test(msg);
}
