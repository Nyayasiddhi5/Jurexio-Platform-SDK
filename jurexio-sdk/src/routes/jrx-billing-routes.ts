/**
 * Billing Aggregator Routes (Task #178 / B2)
 *   GET /api/jrx/subscription   — current org/user subscription tier, renewal, seats
 *   GET /api/jrx/credits        — paged credit transactions with running balance
 *
 * Mounted alongside the existing /api/jrx/subscription/* and /api/jrx/credits/*
 * routers; only adds a root GET handler. RBAC-gated to org_admin+.
 */
import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-billing-routes');

const ADMIN_ROLES = ['org_admin', 'admin', 'super_admin', 'owner'];

// ── /api/jrx/subscription (root) ────────────────────────────────────────────
const subscriptionRoot = Router();
subscriptionRoot.use(authenticateToken);

subscriptionRoot.get('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  const orgId = String((req as any).user?.orgId ?? (req as any).user?.organizationId ?? '');
  const userId = String((req as any).user?.id ?? (req as any).user?.userId ?? '');

  try {
    const result = await db.execute(sql`
      SELECT id, plan, status, current_period_start, current_period_end,
             cancel_at_period_end, monthly_token_limit, tokens_used_this_period,
             metadata, created_at, updated_at
      FROM nv_subscriptions
      WHERE ${orgId ? sql`org_id = ${orgId}` : sql`user_id = ${userId}`}
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const rows = (result as any).rows ?? result ?? [];
    const sub = rows[0] ?? null;

    let seats = 0;
    if (orgId) {
      try {
        const seatRes = await db.execute(sql`
          SELECT COUNT(*)::int AS seats FROM nv_users WHERE organization_id = ${orgId}
        `);
        seats = Number(((seatRes as any).rows ?? seatRes ?? [{}])[0]?.seats ?? 0);
      } catch { /* table-shape variance */ }
    }

    res.json({
      success: true,
      org_id: orgId || null,
      user_id: userId || null,
      subscription: sub,
      seats,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.warn('subscription_root_error', { err: err?.message });
    res.json({ success: true, subscription: null, seats: 0, note: 'no subscription on file' });
  }
});

// ── /api/jrx/credits (root) ────────────────────────────────────────────────
const creditsRoot = Router();
creditsRoot.use(authenticateToken);

creditsRoot.get('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response): Promise<void> => {
  const userId = String((req as any).user?.id ?? (req as any).user?.userId ?? '');
  const orgId  = String((req as any).user?.orgId ?? (req as any).user?.organizationId ?? '');
  const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10));

  try {
    const wallet = await db.execute(sql`
      SELECT balance_credits, lifetime_earned_credits, lifetime_spent_credits,
             reserved_credits, currency, expires_at
      FROM nv_credit_wallet
      WHERE ${orgId ? sql`org_id = ${orgId}` : sql`user_id = ${userId}`}
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const walletRow = ((wallet as any).rows ?? wallet ?? [])[0] ?? null;

    const txns = await db.execute(sql`
      SELECT id, type, amount, balance_after, description, reference_id,
             reference_type, pattern_key, tokens_consumed, created_at
      FROM nv_credit_transactions
      WHERE ${orgId ? sql`user_id IN (SELECT id::text FROM nv_users WHERE organization_id = ${orgId})`
                    : sql`user_id = ${userId}`}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const txRows = (txns as any).rows ?? txns ?? [];

    res.json({
      success: true,
      wallet: walletRow,
      transactions: txRows,
      paging: { limit, offset, returned: txRows.length },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.warn('credits_root_error', { err: err?.message });
    res.json({ success: true, wallet: null, transactions: [], paging: { limit, offset, returned: 0 } });
  }
});

export { subscriptionRoot, creditsRoot };
