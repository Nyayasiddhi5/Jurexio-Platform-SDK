#!/usr/bin/env tsx
/**
 * Task #385 pre-flight — Customer-org platform binding inventory.
 *
 * Read-only pass against the target Postgres (typically prod RDS) that
 * inventories every nv_customer_organizations row whose platform_id is
 * either NULL or pointing at a non-existent sdk_applications row.
 *
 * MUST be run BEFORE applying drizzle/0015_customer_org_platform_fk.sql
 * via the SSM + psql sidecar pattern (see Task #365 / #379 for the
 * canonical sequence). 0015 itself contains a matching DO-block that
 * RAISEs on the same conditions, so a clean preflight here guarantees
 * the migration is a no-op on data and a one-shot on schema.
 *
 * NV-DB-SCRIPT-001: uses makePgSql() (real pg.Pool); the Neon HTTP
 * driver silently drops writes against non-Neon Postgres, but here we
 * are read-only and just need the same TLS/connection-string handling
 * as every other prod-touching script.
 *
 * Exit codes:
 *   0 — clean (zero NULL, zero orphan rows)
 *   1 — dirty (rows surfaced; operator must rebind explicitly before
 *       0015 can be applied — we will not pick a sentinel platform)
 *   2 — script error (DB unreachable, etc.)
 *
 * Usage:
 *   DATABASE_URL=postgres://… tsx scripts/jrx-task385-preflight.ts
 *   DATABASE_URL=postgres://… tsx scripts/jrx-task385-preflight.ts --json
 */

import { makePgSql } from './_pg-pool.js';

const c = {
  ok: '\x1b[32m', no: '\x1b[31m', warn: '\x1b[33m',
  dim: '\x1b[2m', bold: '\x1b[1m', x: '\x1b[0m',
};

const JSON_OUT = process.argv.includes('--json');
const log = (s: string): void => { if (!JSON_OUT) process.stdout.write(s + '\n'); };

interface OrphanRow {
  id: number;
  platform_id: number | null;
  external_ref: string;
  display_name: string | null;
  status: string | null;
  created_at: string;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    process.stderr.write('FATAL: DATABASE_URL is not set.\n');
    process.exit(2);
  }
  const sql = makePgSql();

  try {
    // Fast existence guard — if the table isn't here, this preflight is
    // a no-op (env hasn't run 0012 yet, so 0015 won't apply either).
    const exists = (await sql`
      SELECT to_regclass('public.nv_customer_organizations') IS NOT NULL AS present
    `) as Array<{ present: boolean }>;
    if (!exists?.[0]?.present) {
      log(`${c.warn}[skip]${c.x} nv_customer_organizations not present on this DB — preflight is a no-op.`);
      if (JSON_OUT) process.stdout.write(JSON.stringify({ status: 'skip', reason: 'table_absent' }) + '\n');
      process.exit(0);
    }

    const nullRows = (await sql`
      SELECT id, platform_id, external_ref, display_name, status,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM nv_customer_organizations
       WHERE platform_id IS NULL
       ORDER BY id
    `) as OrphanRow[];

    const orphanRows = (await sql`
      SELECT c.id, c.platform_id, c.external_ref, c.display_name, c.status,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM nv_customer_organizations c
       WHERE c.platform_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.sdk_applications a
            WHERE a.id = c.platform_id
         )
       ORDER BY c.platform_id, c.id
    `) as OrphanRow[];

    const total = (await sql`
      SELECT COUNT(*)::int AS n FROM nv_customer_organizations
    `) as Array<{ n: number }>;

    const totalCount = total?.[0]?.n ?? 0;
    const dirty = nullRows.length + orphanRows.length;

    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({
        status: dirty === 0 ? 'clean' : 'dirty',
        total: totalCount,
        null_rows: nullRows,
        orphan_rows: orphanRows,
      }) + '\n');
    } else {
      log(`${c.bold}Task #385 pre-flight — nv_customer_organizations.platform_id${c.x}`);
      log(`${c.dim}target = ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@')}${c.x}`);
      log(`${c.dim}rows total: ${totalCount}${c.x}\n`);

      if (nullRows.length === 0) {
        log(`${c.ok}✓${c.x} 0 row(s) with NULL platform_id`);
      } else {
        log(`${c.no}✗${c.x} ${nullRows.length} row(s) with NULL platform_id:`);
        for (const r of nullRows) {
          log(`    id=${r.id}  external_ref=${r.external_ref}  status=${r.status}  created=${r.created_at}`);
        }
      }

      if (orphanRows.length === 0) {
        log(`${c.ok}✓${c.x} 0 row(s) referencing non-existent sdk_applications.id`);
      } else {
        log(`${c.no}✗${c.x} ${orphanRows.length} orphan row(s) (platform_id → no sdk_applications row):`);
        for (const r of orphanRows) {
          log(`    id=${r.id}  platform_id=${r.platform_id}  external_ref=${r.external_ref}  status=${r.status}  created=${r.created_at}`);
        }
      }

      log('');
      if (dirty === 0) {
        log(`${c.ok}${c.bold}CLEAN${c.x} — safe to apply drizzle/0015_customer_org_platform_fk.sql`);
      } else {
        log(`${c.no}${c.bold}DIRTY${c.x} — ${dirty} row(s) need operator action BEFORE 0015 can be applied.`);
        log(`${c.dim}    The migration will RAISE EXCEPTION on the same conditions.${c.x}`);
        log(`${c.dim}    Rebind each row to a real sdk_applications.id (or DELETE if dead),${c.x}`);
        log(`${c.dim}    then re-run this preflight until it returns CLEAN.${c.x}`);
      }
    }

    process.exit(dirty === 0 ? 0 : 1);
  } catch (err: any) {
    process.stderr.write(`FATAL: ${err?.message ?? err}\n`);
    process.exit(2);
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }
}

main();
