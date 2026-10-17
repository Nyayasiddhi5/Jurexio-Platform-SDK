/**
 * NYV-SCRIPT-AUDIT-RESET-001 (2026-05-08) — Reset broken hash chain on dev DB.
 * The pre-fix records (hashed without canonical payload normalization) all
 * appear "broken" to the post-fix verifier. Truncates nv_audit_logs so the
 * fixed writer + verifier can establish a clean genesis chain.
 *
 * SAFETY: requires NYV_ALLOW_AUDIT_RESET=1 env var. NEVER use on production.
 *
 * Guardrail compliance:
 *  - NV-NAMING-001: prefixed nv-, no duplicate (rg confirmed empty)
 *  - NV-SECRETS-001: uses canonical NYV_DATABASE_URL via existing db pool
 */

import { db } from '../src/db/index.js';
import { sql } from 'drizzle-orm';

const ALLOW = process.env.NYV_ALLOW_AUDIT_RESET === '1';

(async () => {
  if (!ALLOW) {
    console.error('REFUSING: set NYV_ALLOW_AUDIT_RESET=1 to confirm. Production-safe by default.');
    process.exit(2);
  }

  console.log('[audit-chain-reset] counting pre-reset records …');
  const before = await db.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_audit_logs`);
  const beforeCount = (before as any).rows?.[0]?.c ?? 0;
  console.log(`[audit-chain-reset] ${beforeCount} record(s) before reset`);

  console.log('[audit-chain-reset] TRUNCATE nv_schema.nv_audit_logs …');
  await db.execute(sql`TRUNCATE TABLE nv_schema.nv_audit_logs`);

  const after = await db.execute(sql`SELECT COUNT(*)::int AS c FROM nv_schema.nv_audit_logs`);
  const afterCount = (after as any).rows?.[0]?.c ?? 0;
  console.log(`[audit-chain-reset] ${afterCount} record(s) after reset`);

  if (afterCount !== 0) {
    console.error('[audit-chain-reset] FAILED — table not empty after TRUNCATE');
    process.exit(1);
  }

  console.log('[audit-chain-reset] ✓ chain reset to genesis. Next write will start a fresh canonical chain.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
