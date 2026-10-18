import { sql, type SQL } from 'drizzle-orm';
import {
  governancePgSchemasForRead,
  resolveGovernancePgSchemaName,
} from '../../shared/pg-governance-namespace.js';

/** Qualified `schema.table` for raw SQL fragments (validated identifiers only). */
export function qualifiedGovernanceTable(tableName: string): string {
  const schema = resolveGovernancePgSchemaName();
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`[governance-sql] invalid schema name: ${schema}`);
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
    throw new Error(`[governance-sql] invalid table name: ${tableName}`);
  }
  return `${schema}.${tableName}`;
}

export function governanceProtocolRegistryRef(): SQL {
  return sql.raw(qualifiedGovernanceTable('protocol_registry'));
}

/** Dual-read: first schema in cutover list that has a matching row. */
export async function governanceSelectOneIdByColumn(
  execute: (query: SQL) => Promise<{ rows?: Array<Record<string, unknown>> }>,
  tableName: string,
  columnName: string,
  value: string,
): Promise<string | null> {
  for (const schema of governancePgSchemasForRead()) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema) || !/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
      continue;
    }
    if (!/^[a-z_][a-z0-9_]*$/i.test(columnName)) {
      continue;
    }
    const ref = sql.raw(`${schema}.${tableName}`);
    const col = sql.raw(columnName);
    const result = await execute(
      sql`SELECT id FROM ${ref} WHERE ${col} = ${value} LIMIT 1`,
    );
    const row = result.rows?.[0];
    const id = row?.id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  return null;
}
