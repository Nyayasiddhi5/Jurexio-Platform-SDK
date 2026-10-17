/**
 * Shared schema-drift guard for jrx-seed-*.ts scripts (task #347).
 *
 * Lifted from `jrx-seed-grpo-demo.ts` (task #346). The seeders rely on
 * `CREATE TABLE IF NOT EXISTS … then INSERT INTO …` against tables that are
 * actually owned by Drizzle migrations in real environments. When the live
 * column shape diverges from the script's hard-coded INSERT shape, the seeder
 * blows up mid-run with a deep `column "x" does not exist` error from inside
 * the INSERT — fail-silent until you actually try to use it.
 *
 * `assertColumns` checks `information_schema.columns` for every (schema, table)
 * the seeder writes to, and raises a single clear error listing each missing
 * column. Call it right after `ensureTables()` (or before the first INSERT).
 *
 *   import { assertColumns } from './_assert-columns.js';
 *   await assertColumns(sql, './jrx-seed-foo', {
 *     'nv_schema.nv_foo': ['col_a', 'col_b'],
 *     'public.nv_bar':    ['col_c'],
 *   });
 *
 * NV-DB-SCRIPT-001: relies on a `makePgSql`-style tagged-template `sql`.
 * NV-NAMING-001: leading underscore + no `jrx-` prefix marks this as a
 *                shared, non-runnable helper (matches `_pg-pool.ts`).
 */

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;
type PgClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export type SqlOrPg = SqlFn | PgClient;
export type RequiredColumns = Record<string, readonly string[]>;

function splitQualified(qualified: string): { schema: string; table: string } {
  const parts = qualified.split('.');
  if (parts.length === 2) return { schema: parts[0], table: parts[1] };
  if (parts.length === 1) return { schema: 'public', table: parts[0] };
  throw new Error(
    `assertColumns: invalid table identifier "${qualified}" — expected "schema.table" or "table"`
  );
}

function isPgClient(client: SqlOrPg): client is PgClient {
  return typeof (client as PgClient).query === 'function';
}

async function fetchColumns(client: SqlOrPg, schema: string, table: string): Promise<string[]> {
  if (isPgClient(client)) {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );
    return r.rows.map((row) => String(row.column_name));
  }
  const rows: any[] = await client`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = ${schema}
       AND table_name   = ${table}
  `;
  return rows.map((row) => String(row.column_name));
}

export async function assertColumns(
  client: SqlOrPg,
  scriptName: string,
  required: RequiredColumns,
): Promise<void> {
  const errors: string[] = [];
  for (const [qualified, expected] of Object.entries(required)) {
    const { schema, table } = splitQualified(qualified);
    const columns = await fetchColumns(client, schema, table);
    const present = new Set(columns);
    const missing = expected.filter((c) => !present.has(c));
    if (columns.length === 0) {
      errors.push(`  • ${schema}.${table}: table not found`);
    } else if (missing.length > 0) {
      errors.push(`  • ${schema}.${table}: missing column(s) [${missing.join(', ')}]`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `${scriptName}: schema drift detected — INSERTs would fail.\n` +
      errors.join('\n') +
      '\n  Fix: update Drizzle migrations (or the REQUIRED_COLUMNS map in this script) so the two stay in sync.'
    );
  }
}
