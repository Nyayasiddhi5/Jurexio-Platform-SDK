/**
 * NYV Multi-Org RLS Middleware v3.2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Two responsibilities:
 *   1. Resolve the `org_id` for the current request from JWT/header and stash
 *      it on `req.orgId` / `req.isSuperAdmin`.
 *   2. Provide a CONNECTION-SAFE tenant context binding for any DB work the
 *      request triggers, so the strict RLS policies installed by
 *      `0004_enable_rls_for_tenant_tables.sql` actually filter rows.
 *
 * ─── Why a transaction wrapper, not a bare `set_config()` call ─────────────
 * The previous version called `db.execute('SELECT set_config(...)')` once at
 * the start of the request. That is unsafe with a connection pool: the next
 * query in the request can land on a DIFFERENT pooled connection that never
 * received the SET, and the strict RLS policy would correctly return zero
 * rows — corrupting the request. Conversely, with the legacy permissive
 * policy (`OR setting = ''`) the empty default would silently bypass
 * isolation on the new connection.
 *
 * The fix is `withTenantTx(orgId, fn)`: it opens an explicit transaction,
 * runs `SET LOCAL app.current_org_id = ...` on that transaction's pinned
 * connection, then runs the caller's work. `SET LOCAL` is reverted on
 * COMMIT/ROLLBACK so nothing leaks back to the pool.
 *
 * For defence in depth, every fresh pooled connection has
 * `app.current_org_id` initialised to '' via a `pool.on('connect')` hook
 * registered in `src/db/index.ts`. With the strict policy that means an
 * un-bound connection sees ZERO rows — fail-closed.
 *
 * Cron jobs, queue workers, and migration scripts that need to operate on
 * a single tenant must use `withTenantTx(orgId, fn)`. Maintenance work that
 * legitimately spans tenants must connect as a dedicated Postgres role with
 * the `BYPASSRLS` attribute (see docs/v3.1.2/completed_docs/NYV-COMPLIANCE-ATTESTATION.md).
 *
 * Must be applied AFTER authenticateToken / sdkGatewayAuth.
 */

import { Request, Response, NextFunction } from 'express';
import { sql, SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-org-rls');

/**
 * Shape of the transaction handle that drizzle's `db.transaction(cb)` passes
 * to its callback. Both `drizzle-orm/neon-serverless` and
 * `drizzle-orm/node-postgres` expose this shape; we use a structural subset
 * (`execute` is what we need) so callers don't have to import driver-specific
 * generic types and we avoid an `any` escape hatch on the public API.
 */
export interface TenantTx {
  execute: (q: SQL) => Promise<{ rows: Record<string, unknown>[] } | unknown>;
}

declare module 'express' {
  interface Request {
    orgId?: string;
    isSuperAdmin?: boolean;
    /**
     * Run a callback inside a transaction whose `app.current_org_id` is bound
     * to the request's tenant. All DB work that crosses an RLS-enabled table
     * MUST be issued via the transaction handle passed to the callback so
     * Postgres applies the strict isolation policy on the same connection.
     */
    withTenant?: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
    /**
     * Task #355 — two-tier variant. Binds BOTH `nv.platform_id` and
     * `nv.customer_org_id` GUCs (per-transaction `SET LOCAL`) so the strict
     * (platform_id, customer_org_id) policies installed by
     * drizzle/0013_customer_org_rls.sql filter rows correctly. Wired by
     * `sdkGatewayAuth` after `req.sdkContext` is resolved.
     */
    withSdkTenant?: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  }
}

const SAFE_ORG_ID = /^[A-Za-z0-9_\-]{1,64}$/;
// Strict numeric guard — SET LOCAL cannot accept bind parameters, so we
// re-validate every interpolated value against a digits-only regex before
// formatting it into the SQL string.
const SAFE_NUMERIC_ID = /^\d{1,20}$/;

/**
 * Run `fn` inside a transaction whose `app.current_org_id` session variable
 * is bound to `orgId`. `SET LOCAL` keeps the binding scoped to the
 * transaction's connection — when COMMIT/ROLLBACK fires, the variable is
 * reverted, so nothing leaks back to the pool.
 *
 * The callback receives the transaction handle (`tx`) which it MUST use for
 * all queries. Using the global `db` handle inside the callback would land
 * on a different pooled connection without the SET LOCAL, defeating RLS.
 */

export async function withTenantTx<T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!SAFE_ORG_ID.test(orgId)) {
    throw new Error(`[OrgRLS] illegal org_id (rejected to prevent injection): ${orgId}`);
  }
  if (!db) {
    throw new Error('[OrgRLS] no database handle available');
  }
  return db.transaction(async (tx) => {
    // SET LOCAL is bound to this transaction's connection. We use literal
    // interpolation guarded by the SAFE_ORG_ID regex above because SET cannot
    // accept bind parameters. The regex caps length at 64 and limits the
    // charset to [A-Za-z0-9_-], making SQL injection impossible.
    await tx.execute(sql.raw(`SET LOCAL app.current_org_id = '${orgId}'`));
    return fn(tx as unknown as TenantTx);
  });
}

/**
 * Task #355 — two-tier variant of `withTenantTx`.
 *
 * Opens an explicit transaction, then runs `SET LOCAL nv.platform_id = ...`
 * and `SET LOCAL nv.customer_org_id = ...` on that transaction's pinned
 * connection so the strict (platform_id, customer_org_id) policies installed
 * by `drizzle/0013_customer_org_rls.sql` filter rows correctly. Both GUCs
 * revert on COMMIT/ROLLBACK so nothing leaks back to the pool.
 *
 * The callback receives the transaction handle (`tx`) which it MUST use for
 * all queries — issuing them via the global `db` handle would land on a
 * different pooled connection without the SET LOCAL, defeating RLS.
 *
 * Both ids are re-validated against a digits-only regex before string
 * interpolation; SET LOCAL cannot accept bind parameters, so the regex is
 * the only thing standing between caller input and the SQL string.
 */
export async function withSdkTenantTx<T>(
  platformId: number | string,
  customerOrgId: number | string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const pid = String(platformId);
  const cid = String(customerOrgId);
  if (!SAFE_NUMERIC_ID.test(pid)) {
    throw new Error(`[OrgRLS] illegal platform_id (rejected to prevent injection): ${pid}`);
  }
  if (!SAFE_NUMERIC_ID.test(cid)) {
    throw new Error(`[OrgRLS] illegal customer_org_id (rejected to prevent injection): ${cid}`);
  }
  if (!db) {
    throw new Error('[OrgRLS] no database handle available');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL nv.platform_id = '${pid}'`));
    await tx.execute(sql.raw(`SET LOCAL nv.customer_org_id = '${cid}'`));
    return fn(tx as unknown as TenantTx);
  });
}

/**
 * Legacy session-scoped variant kept for code paths that genuinely cannot
 * yet adopt the transaction wrapper (e.g. multi-step BullMQ jobs). It calls
 * `set_config(..., is_local=false)` so the binding lives until the next
 * request reuses the same pooled connection. Prefer `withTenantTx` for
 * anything new.
 */
export async function withTenantContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  if (!SAFE_ORG_ID.test(orgId)) {
    throw new Error(`[OrgRLS] illegal org_id (rejected to prevent injection): ${orgId}`);
  }
  if (!db) {
    throw new Error('[OrgRLS] no database handle available');
  }
  await db.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, false)`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT set_config('app.current_org_id', '', false)`).catch(() => undefined);
  }
}

export function orgRlsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;
  const sdkCtx = (req as any).sdkContext;

  // NV-UAT-DEFAULT-ORG-001 (task #335, 2026-05-13): in dev / E2E-bypass
  // mode the legacy 'default' fallback resolves to baseline org_id=1 so
  // demo pages stop receiving an unmatchable org token. Production keeps
  // the literal 'default' string and continues to fail closed downstream.
  const NV_DEV_DEFAULT_ORG =
    (process.env.NODE_ENV !== 'production')
      ? '1'
      : 'default';
  const rawOrgId =
    user?.orgId ||
    user?.org_id ||
    sdkCtx?.organizationId ||
    sdkCtx?.org_id ||
    (req.headers['x-org-id'] as string | undefined) ||
    NV_DEV_DEFAULT_ORG;

  const orgId = String(rawOrgId).trim();
  if (!SAFE_ORG_ID.test(orgId)) {
    logger.warn('[OrgRLS] rejecting illegal org_id', { orgId });
    res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid org identifier',
      code: 'ORG_ID_INVALID',
    });
    return;
  }

  const isSuperAdmin = user?.role === 'super_admin' || user?.isSuperAdmin === true;
  req.orgId = orgId;
  req.isSuperAdmin = isSuperAdmin;

  // Connection-safe binding: every DB call routed through req.withTenant runs
  // inside a transaction with SET LOCAL, so it lands on a pinned connection
  // that has the strict tenant policy correctly applied.
  req.withTenant = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenantTx(orgId, fn);

  logger.debug('[OrgRLS] tenant context bound', {
    orgId,
    isSuperAdmin,
    userId: user?.id || user?.userId,
  });
  next();
}

export function requireOrgMatch(paramField = 'orgId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestedOrg = req.params[paramField] || req.body?.[paramField];
    if (!requestedOrg) {
      next();
      return;
    }
    if (!req.isSuperAdmin && req.orgId !== requestedOrg) {
      res.status(403).json({
        error: 'Forbidden',
        message: "You do not have access to this organization's data.",
        code: 'ORG_ISOLATION_VIOLATION',
      });
      return;
    }
    next();
  };
}

// Exported for unit tests and worker bootstrap.
export const _internal = { withTenantTx, withTenantContext, withSdkTenantTx, SAFE_ORG_ID, SAFE_NUMERIC_ID };
