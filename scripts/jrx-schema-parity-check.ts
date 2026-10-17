/**
 * jrx-schema-parity-check.ts — DB ⇄ Drizzle ⇄ SDK parity guardrail
 *
 * For every Drizzle table export found in `shared/`, verifies:
 *   1. The table exists in Postgres at the qualified schema.
 *   2. Every column declared in Drizzle exists in the DB with a compatible
 *      data type (Drizzle text ≈ DB text/varchar; Drizzle integer ≈ int4/int8;
 *      Drizzle boolean ≈ bool; Drizzle jsonb ≈ jsonb; Drizzle timestamp ≈
 *      timestamp/timestamptz; Drizzle uuid ≈ uuid).
 *   3. Reports DB columns NOT in Drizzle as `extra_db_columns` (warn, not fail
 *      — these are tolerable but should be documented).
 *
 * Special canonical-table assertions (post-2026-05-05 B1+B2):
 *   - public.nv_statutes must exist; nv_schema.nv_statutes must NOT exist.
 *   - public.sdk_api_request_logs must exist; nv_schema.sdk_api_request_logs
 *     must NOT exist.
 *
 * Exit codes:
 *   0  — all parity checks pass
 *   1  — one or more parity violations
 *
 * Usage:
 *   pnpm db:parity                 # one-shot, exits non-zero on drift
 *   pnpm db:parity --warn-only     # always exit 0 (for dev startup)
 *
 * Wired from `scripts/jrx-start-dev.sh` in warn-only mode so dev never blocks
 * on parity drift; CI runs the strict mode.
 */

import pg from 'pg';
import * as schema from '@shared/schema.js';
import * as govSchema from '@shared/jrx-governance-schema.js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[parity] FATAL: DATABASE_URL not set');
  process.exit(2);
}

const warnOnly = process.argv.includes('--warn-only');
const pool = new pg.Pool({ connectionString: normalizePgConnectionString(DATABASE_URL), max: 2 });

async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params as never[]);
  return (r.rows ?? []) as T[];
}

interface DrizzleColumnSpec {
  name: string;
  drizzleType: string;
  notNull: boolean;
}

interface DbColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

const TYPE_COMPAT: Record<string, RegExp> = {
  PgText:           /^text$/,
  PgVarchar:        /^(character varying|text)$/,
  PgInteger:        /^(integer|bigint|smallint)$/,
  PgBigInt53:       /^(bigint|integer)$/,
  PgSerial:         /^integer$/,
  PgBigSerial53:    /^bigint$/,
  PgBoolean:        /^boolean$/,
  PgTimestamp:      /^timestamp/,
  PgTimestampTz:    /^timestamp/,
  PgDate:           /^date$/,
  PgUUID:           /^uuid$/,
  PgJsonb:          /^jsonb$/,
  PgJson:           /^json$/,
  PgNumeric:        /^numeric$/,
  PgArray:          /^ARRAY$/,
  PgVector:         /^USER-DEFINED$/,
  PgCustomColumn:   /.*/,
};

function typesCompatible(drizzleType: string, dbType: string): boolean {
  const norm = drizzleType.replace(/^Pg/, 'Pg');
  const re = TYPE_COMPAT[norm];
  if (!re) return true; // unknown drizzle type — don't fail
  return re.test(dbType);
}

function collectDrizzleTables(mod: Record<string, unknown>) {
  const out: { exportName: string; schema: string; name: string; columns: DrizzleColumnSpec[] }[] = [];
  for (const [exportName, value] of Object.entries(mod)) {
    if (!value || typeof value !== 'object') continue;
    try {
      const cfg = getTableConfig(value as never);
      if (!cfg?.name) continue;
      const cols: DrizzleColumnSpec[] = (cfg.columns ?? []).map((c) => ({
        name: c.name,
        drizzleType: c.constructor?.name ?? 'unknown',
        notNull: !!c.notNull,
      }));
      out.push({
        exportName,
        schema: cfg.schema ?? 'public',
        name: cfg.name,
        columns: cols,
      });
    } catch {
      // not a table export; skip
    }
  }
  return out;
}

async function main() {
  const violations: string[] = [];
  const warnings: string[] = [];

  // 1. Canonical-table assertions (B1 + B2)
  const tables = await query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name IN ('nv_statutes', 'sdk_api_request_logs')
         AND table_schema IN ('public', 'nv_schema')
       ORDER BY 1, 2`,
  );

  const tableSet = new Set(tables.map((t) => `${t.table_schema}.${t.table_name}`));

  if (!tableSet.has('public.nv_statutes')) {
    violations.push('CANON: public.nv_statutes MUST exist (B1 canonical)');
  }
  if (tableSet.has('nv_schema.nv_statutes')) {
    violations.push('CANON: nv_schema.nv_statutes MUST NOT exist (B1 dropped 2026-05-05)');
  }
  if (!tableSet.has('public.sdk_api_request_logs')) {
    violations.push('CANON: public.sdk_api_request_logs MUST exist (B2 canonical)');
  }
  if (tableSet.has('nv_schema.sdk_api_request_logs')) {
    violations.push('CANON: nv_schema.sdk_api_request_logs MUST NOT exist (B2 dropped 2026-05-05)');
  }

  // 2. Drizzle export ⇄ DB column parity
  const allDrizzleTables = [
    ...collectDrizzleTables(schema as Record<string, unknown>),
    ...collectDrizzleTables(govSchema as Record<string, unknown>),
  ];

  console.log(`[parity] Drizzle tables found: ${allDrizzleTables.length}`);

  for (const t of allDrizzleTables) {
    const dbCols = await query<Pick<DbColumn, 'column_name' | 'data_type' | 'is_nullable'>>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
      [t.schema, t.name],
    );

    if (dbCols.length === 0) {
      violations.push(`MISSING TABLE: ${t.schema}.${t.name} (Drizzle export ${t.exportName})`);
      continue;
    }

    const dbColMap = new Map(dbCols.map((c) => [c.column_name, c]));
    for (const dCol of t.columns) {
      const db = dbColMap.get(dCol.name);
      if (!db) {
        violations.push(
          `MISSING COLUMN: ${t.schema}.${t.name}.${dCol.name} (Drizzle ${dCol.drizzleType}; export=${t.exportName})`,
        );
        continue;
      }
      if (!typesCompatible(dCol.drizzleType, db.data_type)) {
        violations.push(
          `TYPE MISMATCH: ${t.schema}.${t.name}.${dCol.name} — Drizzle ${dCol.drizzleType} vs DB ${db.data_type}`,
        );
      }
    }

    // Extra DB columns (warn, not fail)
    const drizzleColNames = new Set(t.columns.map((c) => c.name));
    for (const dbCol of dbCols) {
      if (!drizzleColNames.has(dbCol.column_name)) {
        warnings.push(
          `EXTRA DB COLUMN: ${t.schema}.${t.name}.${dbCol.column_name} (${dbCol.data_type}) not in Drizzle export ${t.exportName}`,
        );
      }
    }
  }

  // 3. Report
  console.log('');
  console.log('═'.repeat(70));
  console.log(' NV SCHEMA PARITY REPORT — Neon ⇄ Drizzle ⇄ SDK');
  console.log('═'.repeat(70));
  console.log(` ✓ Drizzle tables checked:  ${allDrizzleTables.length}`);
  console.log(` ✗ Violations:              ${violations.length}`);
  console.log(` ⚠ Warnings:                ${warnings.length}`);
  console.log('═'.repeat(70));

  if (violations.length) {
    console.log('\nVIOLATIONS:');
    violations.forEach((v) => console.log(`  ✗ ${v}`));
  }
  if (warnings.length && warnings.length < 50) {
    console.log('\nWARNINGS:');
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  } else if (warnings.length) {
    console.log(`\nWARNINGS: ${warnings.length} (suppressed; pass --verbose to see)`);
    if (process.argv.includes('--verbose')) {
      warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    }
  }

  await pool.end();

  if (violations.length === 0) {
    console.log('\n✅ PARITY OK — all canonical assertions and Drizzle/DB column checks pass.');
    process.exit(0);
  }

  if (warnOnly) {
    console.log('\n⚠ Parity violations detected, but --warn-only is set; exiting 0.');
    process.exit(0);
  }
  console.log('\n✗ PARITY FAILED — see violations above.');
  process.exit(1);
}

main().catch((err) => {
  console.error('[parity] uncaught error:', err);
  pool.end().catch(() => {});
  process.exit(2);
});
