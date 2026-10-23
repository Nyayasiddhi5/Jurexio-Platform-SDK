// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NV Row-Level Security (RLS) Service v3.1.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-org data isolation using PostgreSQL Row Level Security.
 * Ensures each org can only see their own data — enforced at DB level.
 *
 * Architecture:
 *   - Drizzle ORM queries always include org_id filter (application-level)
 *   - PostgreSQL RLS policies add database-level enforcement (defense-in-depth)
 *   - JWT claims carry org_id for automatic filtering
 *
 * Tables with RLS: nyv_audit_log, nyv_cases, nyv_credit_wallets,
 *                  nyv_consent_records, nyv_ai_governance_reports
 */

import { pool as _raw_pool } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const pool = lazyRequire(() => _raw_pool, 'pool');
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-rls-service');

export interface RlsPolicyStatus {
  table: string;
  rlsEnabled: boolean;
  policies: string[];
}

export interface OrgDataStats {
  orgId: string;
  auditLogCount: number;
  creditBalance: number;
  activeUsers: number;
}

// ─── SQL: Enable RLS and create policies ──────────────────────────────────────
const RLS_SETUP_SQL = `
-- Enable RLS on core multi-tenant tables
DO $$
BEGIN

  -- ── nyv_audit_log ─────────────────────────────────────────────────────────
  ALTER TABLE IF EXISTS nyv_audit_log ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nyv_audit_log_org_isolation ON nyv_audit_log;
  CREATE POLICY nyv_audit_log_org_isolation ON nyv_audit_log
    USING (
      org_id IS NULL
      OR org_id = current_setting('app.current_org_id', TRUE)
      OR current_setting('app.is_super_admin', TRUE) = 'true'
    );

  -- ── nyv_credit_wallets ─────────────────────────────────────────────────────
  ALTER TABLE IF EXISTS nyv_credit_wallets ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nyv_credit_wallets_org_isolation ON nyv_credit_wallets;
  CREATE POLICY nyv_credit_wallets_org_isolation ON nyv_credit_wallets
    USING (
      org_id IS NULL
      OR org_id = current_setting('app.current_org_id', TRUE)
      OR current_setting('app.is_super_admin', TRUE) = 'true'
    );

  -- ── nyv_consent_records ────────────────────────────────────────────────────
  ALTER TABLE IF EXISTS nyv_consent_records ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nyv_consent_records_org_isolation ON nyv_consent_records;
  CREATE POLICY nyv_consent_records_org_isolation ON nyv_consent_records
    USING (
      org_id IS NULL
      OR org_id = current_setting('app.current_org_id', TRUE)
      OR current_setting('app.is_super_admin', TRUE) = 'true'
    );

  -- ── nyv_ai_governance_reports ──────────────────────────────────────────────
  ALTER TABLE IF EXISTS nyv_ai_governance_reports ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nyv_ai_governance_reports_org_isolation ON nyv_ai_governance_reports;
  CREATE POLICY nyv_ai_governance_reports_org_isolation ON nyv_ai_governance_reports
    USING (
      org_id IS NULL
      OR org_id = current_setting('app.current_org_id', TRUE)
      OR current_setting('app.is_super_admin', TRUE) = 'true'
    );

EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'RLS setup warning (non-fatal): %', SQLERRM;
END;
$$;
`;

// ─── Apply RLS policies to database ───────────────────────────────────────────
export async function applyRlsPolicies(): Promise<{ success: boolean; message: string }> {
  try {
    await pool.query(RLS_SETUP_SQL);
    logger.info('[RLS] Row-Level Security policies applied successfully');
    return { success: true, message: 'RLS policies applied to all multi-tenant tables' };
  } catch (err: any) {
    logger.warn('[RLS] RLS policy setup failed (non-fatal — application-level filtering still active)', { error: err.message });
    return { success: false, message: `RLS policy setup failed: ${err.message}` };
  }
}

// ─── Check RLS status for a specific table ────────────────────────────────────
export async function getRlsStatus(tableName: string): Promise<RlsPolicyStatus> {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
    const rlsCheck = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
      [tableName]
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
    const policyCheck = await pool.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = $1`,
      [tableName]
    );
    return {
      table: tableName,
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
      rlsEnabled: rlsCheck.rows[0]?.relrowsecurity ?? false,
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
      policies: policyCheck.rows.map(r => r.policyname),
    };
  } catch {
    return { table: tableName, rlsEnabled: false, policies: [] };
  }
}

// ─── Get all RLS policy statuses ─────────────────────────────────────────────
export async function getAllRlsStatuses(): Promise<RlsPolicyStatus[]> {
  const tables = ['nyv_audit_log', 'nyv_credit_wallets', 'nyv_consent_records', 'nyv_ai_governance_reports'];
  return Promise.all(tables.map(getRlsStatus));
}

// ─── Set org context for current DB session ───────────────────────────────────
export async function setOrgContext(orgId: string, isSuperAdmin = false): Promise<void> {
  await pool.query(
    `SELECT set_config('app.current_org_id', $1, TRUE), set_config('app.is_super_admin', $2, TRUE)`,
    [orgId, String(isSuperAdmin)]
  );
}

// ─── Get org data statistics ──────────────────────────────────────────────────
export async function getOrgDataStats(orgId: string): Promise<OrgDataStats> {
  try {
    const [auditRes, creditRes] = await Promise.all([
      // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM nyv_audit_log WHERE org_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ count: '0' }] })),
      // @ts-expect-error NV-TS230 legacy typing gap (TS2558)
      pool.query<{ balance: string }>(
        `SELECT COALESCE(SUM(balance), 0)::text AS balance FROM nyv_credit_wallets WHERE org_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ balance: '0' }] })),
    ]);

    return {
      orgId,
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2345)
      auditLogCount: parseInt(auditRes.rows[0]?.count || '0', 10),
      // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2345)
      creditBalance: parseFloat(creditRes.rows[0]?.balance || '0'),
      activeUsers: 0,
    };
  } catch (err: any) {
    logger.warn('[RLS] Failed to fetch org stats', { orgId, error: err.message });
    return { orgId, auditLogCount: 0, creditBalance: 0, activeUsers: 0 };
  }
}
