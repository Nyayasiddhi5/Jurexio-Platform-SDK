#!/usr/bin/env tsx
/**
 * nv-rls-enforce-flip.ts — Task #365
 *
 * One-command "switch on tenant data isolation" helper. Designed to be the
 * single thing an operator runs against a target Postgres (dev OR prod) to
 * persist `app.nyv_rls_enforce=true`, re-apply migration 0013 with
 * enforcement on, and prove tenant isolation works via a sentinel smoke
 * test that mirrors `tests/unit/security/rls.test.ts`.
 *
 * What it does (idempotent — safe to re-run):
 *   1. ALTER DATABASE <current> SET app.nyv_rls_enforce = 'true'
 *      Persists the GUC for every NEW session against this database, so
 *      the gateway picks it up on its next restart without any code edit.
 *   2. SET app.nyv_rls_enforce = 'true' on the running session and re-runs
 *      drizzle/0004 + 0012 + 0013 (the same code path nv-migrate.ts uses).
 *      0004 covers the legacy org_id tables; 0013 covers the seven
 *      (platform_id, customer_org_id) tables listed in the task.
 *   3. Verifies all 7 target tables end up with relrowsecurity=true AND
 *      relforcerowsecurity=true.
 *   4. Sentinel smoke test on nv_rls_sentinel_v2: insert two rows under
 *      two different tenants, then run a deliberately-broken
 *      `SELECT * FROM nv_rls_sentinel_v2` (no WHERE) bound to tenant A.
 *      The query MUST return only tenant A's row. Then RESET the GUCs
 *      and prove an unbound session sees zero rows (fail-closed).
 *
 * Per repo guardrails (replit.md, AGENT-GOTCHAS.md), running this against
 * the production RDS cluster requires explicit user "GO". The script does
 * NOT prompt — it just runs against whatever DATABASE_URL is set. The GO
 * gate is enforced by the operator, not the script.
 *
 * Usage:
 *   # Dry-run (against current DATABASE_URL — defaults to dev):
 *   tsx scripts/jrx-rls-enforce-flip.ts
 *
 *   # Against prod (operator has user GO; pulls prod URL from a secret):
 *   DATABASE_URL="$NYV_PROD_DATABASE_URL" tsx scripts/jrx-rls-enforce-flip.ts
 *
 * After this script reports OK against prod, the gateway on EC2 must be
 * restarted (bash scripts/deploy-replit-ssm.sh) so its existing pool
 * connections re-handshake and pick up the persisted GUC. New sessions
 * created after the ALTER DATABASE inherit the GUC automatically; existing
 * pooled connections do not.
 *
 * Exit codes:
 *   0  — flip persisted, all 7 tables enforce RLS, sentinel proves isolation
 *   1  — any step failed (no persistent state changed beyond what is logged)
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as dotenv from 'dotenv';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';

dotenv.config();

const TARGET_TABLES = [
  'sdk_api_request_logs',
  'sdk_usage_metering',
  'sdk_workflows',
  'sdk_workflow_executions',
  'nv_hitl_queue',
  'nv_hitl_decisions',
  'nv_cam_actions',
] as const;

interface FlipReport {
  databaseName: string;
  alterDatabaseApplied: boolean;
  migrationsApplied: string[];
  tableStatus: Array<{ table: string; rowsecurity: boolean; forcerowsecurity: boolean; present: boolean }>;
  sentinelResult: 'PASS' | 'SKIP_SUPERUSER' | 'FAIL';
  sentinelDetail: string;
}

async function main(): Promise<void> {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error('FATAL: DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: normalizePgConnectionString(rawUrl),
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 2,
  });

  const report: FlipReport = {
    databaseName: '',
    alterDatabaseApplied: false,
    migrationsApplied: [],
    tableStatus: [],
    sentinelResult: 'FAIL',
    sentinelDetail: '',
  };

  try {
    const c = await pool.connect();
    try {
      const dbRow = await c.query<{ db: string }>(`SELECT current_database() AS db`);
      report.databaseName = dbRow.rows[0].db;
      console.log(`\n  → target database: ${report.databaseName}`);

      // SENTINEL_ONLY mode: skip Steps 1 + 2 (DDL) and only verify state +
      // run the sentinel proof. Designed for the post-flip evidence run under
      // the non-superuser app role (e.g. nv_app), which lacks ALTER DATABASE
      // and ALTER TABLE … FORCE privileges. Required by task #365 acceptance:
      // sentinel proof must be captured under the runtime app role.
      const sentinelOnly = process.env.NYV_SENTINEL_ONLY === '1' || process.env.NYV_SENTINEL_ONLY === 'true';
      if (sentinelOnly) {
        console.log('  ⓘ NYV_SENTINEL_ONLY=1 → skipping ALTER DATABASE + migration re-apply');
      }

      // ── Step 1: persist app.nyv_rls_enforce=true at the database level.
      // Quoted identifier so DBs with mixed-case names work; ALTER DATABASE
      // SET is idempotent — re-running just overwrites with the same value.
      // Gracefully degrades on permission-denied (42501): on managed RDS the
      // app role typically lacks superuser/db-owner so this fails. That's
      // OK — runtime RLS enforcement is driven by ALTER TABLE … FORCE ROW
      // LEVEL SECURITY (applied below by the migration), which writes to the
      // table catalog and persists regardless of any session GUC. The
      // ALTER DATABASE step is purely a convenience so future migration
      // re-runs default to enforce mode; the operator can achieve the same
      // by setting the GUC in the RDS parameter group or by always exporting
      // NYV_RLS_ENFORCE=true before running nv-migrate.ts.
      const safeDbName = report.databaseName.replace(/"/g, '""');
      if (sentinelOnly) {
        console.log('  ⏭ Step 1 skipped (sentinel-only)');
      } else {
      try {
        await c.query(`ALTER DATABASE "${safeDbName}" SET app.nyv_rls_enforce = 'true'`);
        report.alterDatabaseApplied = true;
        console.log('  ✓ ALTER DATABASE … SET app.nyv_rls_enforce = \'true\' (persists for new sessions)');
      } catch (err) {
        const pgErr = err as { code?: string; message?: string };
        if (pgErr?.code === '42501') {
          report.alterDatabaseApplied = false;
          console.log(
            '  ⚠ ALTER DATABASE … SET skipped: permission denied (42501).\n' +
              '    Connected role is not superuser/db-owner — expected on managed RDS.\n' +
              '    Runtime enforcement is unaffected (driven by ALTER TABLE … FORCE).\n' +
              '    To make NYV_RLS_ENFORCE the default for future migration runs,\n' +
              '    add `app.nyv_rls_enforce = on` to the RDS parameter group instead.',
          );
        } else {
          throw err;
        }
      }

      } // end of !sentinelOnly Step 1 block

      // ── Step 2: bind the GUC for THIS session and re-apply 0004/0012/0013.
      // We must use SET (not SET LOCAL) — the migration files inspect the
      // GUC inside DO blocks via current_setting('app.nyv_rls_enforce',true).
      await c.query(`SELECT set_config('app.nyv_rls_enforce', 'true', false)`);

      const fieldKey = process.env.NYV_FIELD_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY ?? '';
      if (fieldKey) {
        await c.query(`SELECT set_config('app.field_encryption_key', $1, false)`, [fieldKey]);
      }

      if (sentinelOnly) {
        console.log('  ⏭ Step 2 skipped (sentinel-only) — no migration re-apply');
      } else {
        for (const file of [
          '0004_enable_rls_for_tenant_tables.sql',
          '0012_customer_organizations.sql',
          '0013_customer_org_rls.sql',
        ]) {
          const sqlText = readFileSync(resolve(process.cwd(), 'drizzle', file), 'utf8');
          await c.query(sqlText);
          report.migrationsApplied.push(file);
          console.log(`  ✓ re-applied drizzle/${file} (with NYV_RLS_ENFORCE=true)`);
        }
      }

      // ── Step 3: verify the 7 target tables have ENABLE + FORCE RLS on.
      const status = await c.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class
          WHERE relname = ANY($1::text[]) AND relkind = 'r'`,
        [TARGET_TABLES as unknown as string[]],
      );
      const byName = new Map(status.rows.map((r) => [r.relname, r]));
      let allEnforced = true;
      for (const t of TARGET_TABLES) {
        const row = byName.get(t);
        const present = !!row;
        const rls = !!row?.relrowsecurity;
        const force = !!row?.relforcerowsecurity;
        report.tableStatus.push({
          table: t,
          present,
          rowsecurity: rls,
          forcerowsecurity: force,
        });
        const flag = !present ? 'MISSING' : rls && force ? 'ENFORCED' : 'NOT-ENFORCED';
        console.log(
          `  ${flag === 'ENFORCED' ? '✓' : '✗'} ${t.padEnd(28)} present=${present} rls=${rls} force=${force} → ${flag}`,
        );
        // Strict: ALL 7 target tables MUST be present AND fully enforced.
        // A missing table is a hard failure (per task #365 acceptance: "switch
        // on tenant data isolation in production" — silent gaps are unsafe).
        if (!present || !rls || !force) allEnforced = false;
      }

      // ── Step 4: sentinel smoke test on nv_rls_sentinel_v2.
      // Same shape as tests/unit/security/rls.test.ts so the prod evidence
      // is byte-for-byte comparable to the unit test result.
      const su = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      const isSuperuser = !!(su.rows[0]?.rolsuper || su.rows[0]?.rolbypassrls);

      if (isSuperuser) {
        // Superuser bypasses RLS by definition, so the sentinel cannot
        // demonstrate isolation here. Per task #42 follow-up, prod must run
        // the smoke test as a non-superuser app role; we surface this
        // explicitly so the operator knows to re-run from that role.
        report.sentinelResult = 'SKIP_SUPERUSER';
        report.sentinelDetail =
          `current_user is superuser/bypassrls — sentinel cannot demonstrate isolation. ` +
          `Re-run as the non-superuser app role (see follow-up to provision app role).`;
        console.log(`  ⚠ sentinel: ${report.sentinelDetail}`);
      } else {
        // Insert under tenant A (platform=1, customer_org=1000001).
        await c.query(`SELECT set_config('nv.platform_id', '1', false)`);
        await c.query(`SELECT set_config('nv.customer_org_id', '1000001', false)`);
        await c.query(`DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 1 AND customer_org_id = 1000001`);
        await c.query(
          `INSERT INTO nv_rls_sentinel_v2 (platform_id, customer_org_id, payload) VALUES (1, 1000001, 'A')`,
        );

        // Insert under tenant B (platform=2, customer_org=2000001).
        await c.query(`SELECT set_config('nv.platform_id', '2', false)`);
        await c.query(`SELECT set_config('nv.customer_org_id', '2000001', false)`);
        await c.query(`DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 2 AND customer_org_id = 2000001`);
        await c.query(
          `INSERT INTO nv_rls_sentinel_v2 (platform_id, customer_org_id, payload) VALUES (2, 2000001, 'B')`,
        );

        // Bound to tenant A — DELIBERATELY OMIT the WHERE clause.
        await c.query(`SELECT set_config('nv.platform_id', '1', false)`);
        await c.query(`SELECT set_config('nv.customer_org_id', '1000001', false)`);
        const broken = await c.query<{ platform_id: number; customer_org_id: string; payload: string }>(
          `SELECT platform_id, customer_org_id, payload FROM nv_rls_sentinel_v2`,
        );
        const allTenantA =
          broken.rows.length > 0 &&
          broken.rows.every(
            (r) => Number(r.platform_id) === 1 && String(r.customer_org_id) === '1000001',
          );
        const sawTenantB = broken.rows.some((r) => r.payload === 'B');

        // Unbound session sees ZERO rows (fail-closed).
        await c.query(`RESET nv.platform_id`);
        await c.query(`RESET nv.customer_org_id`);
        const empty = await c.query(`SELECT 1 FROM nv_rls_sentinel_v2`);

        // Cleanup under each tenant.
        await c.query(`SELECT set_config('nv.platform_id', '1', false)`);
        await c.query(`SELECT set_config('nv.customer_org_id', '1000001', false)`);
        await c.query(`DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 1 AND customer_org_id = 1000001`);
        await c.query(`SELECT set_config('nv.platform_id', '2', false)`);
        await c.query(`SELECT set_config('nv.customer_org_id', '2000001', false)`);
        await c.query(`DELETE FROM nv_rls_sentinel_v2 WHERE platform_id = 2 AND customer_org_id = 2000001`);

        if (allTenantA && !sawTenantB && empty.rows.length === 0) {
          report.sentinelResult = 'PASS';
          report.sentinelDetail =
            `broken-WHERE bound to tenant A returned ${broken.rows.length} row(s), all tenant A; ` +
            `unbound session returned 0 rows.`;
          console.log(`  ✓ sentinel: ${report.sentinelDetail}`);
        } else {
          report.sentinelResult = 'FAIL';
          report.sentinelDetail =
            `broken-WHERE returned ${broken.rows.length} rows (allTenantA=${allTenantA} sawTenantB=${sawTenantB}); ` +
            `unbound returned ${empty.rows.length} rows. Expected: >0 tenant-A rows, no tenant-B leak, 0 unbound rows.`;
          console.log(`  ✗ sentinel: ${report.sentinelDetail}`);
        }
      }

      console.log('\n  ── flip report ──');
      console.log(JSON.stringify(report, null, 2));

      // alterDatabaseApplied is best-effort (managed RDS app roles often lack
      // privilege); only allEnforced + sentinel matter for the actual flip.
      // Per task #365 acceptance, SKIP_SUPERUSER is NOT a successful terminal
      // state for production: prod requires sentinel proof under the
      // non-superuser app role. Allow PASS only.
      const ok = allEnforced && report.sentinelResult === 'PASS';
      if (!ok) {
        console.error('\n  ✗ FLIP INCOMPLETE — see report above');
        if (!allEnforced) {
          const missing = report.tableStatus.filter((t) => !t.present).map((t) => t.table);
          const partial = report.tableStatus
            .filter((t) => t.present && (!t.rowsecurity || !t.forcerowsecurity))
            .map((t) => t.table);
          if (missing.length)
            console.error(`    missing tables (must be provisioned first): ${missing.join(', ')}`);
          if (partial.length)
            console.error(`    present but not fully enforced: ${partial.join(', ')}`);
        }
        if (report.sentinelResult === 'SKIP_SUPERUSER') {
          console.error(
            '    sentinel skipped because connected as superuser/bypassrls;\n' +
              '    re-run from the non-superuser app role (e.g. nv_app) to obtain\n' +
              '    prod evidence of cross-tenant isolation.',
          );
        }
        process.exit(1);
      }
      console.log(
        '\n  ✓ FLIP COMPLETE — all 7 target tables ENABLED + FORCED RLS;\n' +
          '    sentinel proved cross-tenant isolation under the app role.\n' +
          '    Restart the gateway so pooled connections pick up the new GUC.',
      );
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n  ✗ FATAL', err);
  process.exit(1);
});
