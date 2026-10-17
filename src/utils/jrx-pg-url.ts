/**
 * Postgres connection-string normalizer + verify-full upgrader.
 *
 * Two complementary helpers, applied consistently to every consumer that
 * builds a pg URL from `NYV_DATABASE_URL` / `DATABASE_URL` /
 * `NS_DATABASE_URL` / `NM_DATABASE_URL`:
 *
 * 1. `normalizePgConnectionString()` (NV-PG-SSL-COMPAT-2026-05-11, task-135)
 *    — appends `uselibpqcompat=true` to URLs whose `sslmode` is `prefer`,
 *    `require`, or `verify-ca`. This silences the `pg` v8.13+ one-shot
 *    SECURITY WARNING about those modes being treated as aliases for
 *    `verify-full`, AND pins libpq semantics for the day `pg` v9 lands
 *    (which flips the alias default to strict verification). Kept for
 *    callers / connection strings we have NOT yet upgraded to
 *    `verify-full`.
 *
 * 2. `upgradePgConnectionStringToVerifyFull()` (NV-PG-SSL-VERIFY-2026-05-11,
 *    task-142) — rewrites those same aliases (`prefer`/`require`/
 *    `verify-ca`) to `sslmode=verify-full` and drops the
 *    `uselibpqcompat=true` shim, matching the runtime SSL posture in
 *    `src/utils/jrx-pg-ssl.ts` (`{ ca: <bundled RDS CA>,
 *    rejectUnauthorized: true }`). The actual CA still flows via the
 *    `pg.Pool({ ssl })` option — flipping the URL just keeps libpq-style
 *    tooling (`psql`, `pg_dump`) and our own diagnostic logs reading the
 *    same intent.
 *
 * Both helpers are idempotent and no-ops on URLs without an `sslmode`
 * parameter or with `sslmode=disable` / `sslmode=verify-full`.
 */

const WARNED_MODES = new Set(['prefer', 'require', 'verify-ca']);
const UPGRADEABLE_MODES = new Set(['prefer', 'require', 'verify-ca']);

/**
 * Returns the connection string with `uselibpqcompat=true` appended when
 * the URL contains a sslmode value that triggers the pg v8/v9 warning AND
 * the libpq-compat opt-in is not already present. Idempotent + safe on
 * URLs without a sslmode parameter.
 */
export function normalizePgConnectionString(connectionString: string): string {
  if (!connectionString) return connectionString;

  // Tolerate non-URL inputs (key=value DSNs); only process http(s)-style URIs.
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const sslmode = url.searchParams.get('sslmode');
  if (!sslmode || !WARNED_MODES.has(sslmode.toLowerCase())) {
    return connectionString;
  }

  if (url.searchParams.get('uselibpqcompat') === 'true') {
    return connectionString;
  }

  url.searchParams.set('uselibpqcompat', 'true');
  return url.toString();
}

/**
 * NV-PG-SSL-VERIFY-2026-05-11 (task-142): rewrite the URL's `sslmode` to
 * `verify-full` for managed-Postgres targets that ship a CA bundle. We
 * still pass the actual CA via `pg.Pool({ ssl: { ca, rejectUnauthorized:
 * true } })` (see src/utils/jrx-pg-ssl.ts) — flipping the URL keeps the
 * connection-string form aligned with the runtime posture so libpq-style
 * tools (`psql`, `pg_dump`) and the diagnostic logs all read the same
 * intent. Idempotent + no-op when sslmode is missing, already
 * `verify-full`, or `disable`. The `uselibpqcompat=true` shim is dropped
 * because verify-full is the explicit, unambiguous mode (no alias warning).
 */
export function upgradePgConnectionStringToVerifyFull(connectionString: string): string {
  if (!connectionString) return connectionString;

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const sslmode = url.searchParams.get('sslmode');
  if (!sslmode) return connectionString;
  const lc = sslmode.toLowerCase();
  if (lc === 'disable' || lc === 'verify-full') return connectionString;
  if (!UPGRADEABLE_MODES.has(lc)) return connectionString;

  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.delete('uselibpqcompat');
  return url.toString();
}
