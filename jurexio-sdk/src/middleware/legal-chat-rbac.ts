/**
 * Legal Chat RBAC middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Pass if either:
 *   1. user.role ∈ {superadmin, super_admin}, OR
 *   2. an active sme_allocations row exists for this user.
 *
 * The Superadmin allocates SMEs through POST /api/jrx/legal-chat/sme-allocations.
 * Allocations may carry a scope (jurisdictions, practice areas) but the
 * gating decision is binary at the middleware layer; route handlers are free
 * to read the scope from req for finer checks.
 *
 * IMPORTANT: ordinary `admin` / `org_admin` are NOT bypassed. The product
 * spec is explicit: only Superadmin OR Superadmin-allocated SME may use
 * Legal Chat. Other admin tiers must be granted via sme_allocations.
 */

import { Request, Response, NextFunction } from 'express';
import { pool as db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type { AuthRequest } from './jrx-auth.js';

const logger = createLogger('legal-chat-rbac');

// Local typed extension for fields requireLegalChatAccess attaches to the
// request. Downstream route handlers cast to LegalChatAuthRequest instead
// of `as any` so the contract stays explicit.
export interface SmeAllocationRow {
  id: number;
  scope: unknown;
}
export type LegalChatRole = 'superadmin' | 'sme' | 'admin';
export interface LegalChatAuthRequest extends AuthRequest {
  legalChatRole?: LegalChatRole;
  smeAllocation?: SmeAllocationRow;
}

const SUPERADMIN_ROLES = new Set(['superadmin', 'super_admin']);
// Task #156 — SMEs identified by `role = 'sme'` skip the sme_allocations
// lookup (their role IS the allocation). Allocations remain the gating
// path for users with other roles who still need scoped chat access.
const SME_ROLES = new Set(['sme']);

export function isSuperadmin(req: Request): boolean {
  const user = (req as AuthRequest).user;
  return !!user && !!user.role && SUPERADMIN_ROLES.has(user.role);
}

export async function requireLegalChatAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authReq = req as LegalChatAuthRequest;
  const user = authReq.user;
  if (!user) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  // (1) Superadmin bypass (NARROW — admin/org_admin do NOT bypass).
  if (user.role && SUPERADMIN_ROLES.has(user.role)) {
    authReq.legalChatRole = 'superadmin';
    next();
    return;
  }

  // (1b) Native SME role bypass — Task #156.
  if (user.role && SME_ROLES.has(user.role)) {
    authReq.legalChatRole = 'sme';
    next();
    return;
  }

  // (2) Active SME allocation lookup.
  try {
    const userId = parseInt(String(user.id), 10);
    if (!Number.isFinite(userId)) {
      res.status(403).json({ error: 'forbidden — user id not numeric' });
      return;
    }
    if (!db) {
      res.status(503).json({ error: 'database unavailable' });
      return;
    }
    const result = await db.query(
      `SELECT id, scope FROM sme_allocations
         WHERE sme_user_id = $1 AND active = true AND revoked_at IS NULL
         LIMIT 1`,
      [userId],
    );
    const rows = result.rows;
    if (rows && rows.length > 0) {
      authReq.legalChatRole = 'sme';
      authReq.smeAllocation = rows[0] as unknown as SmeAllocationRow;
      next();
      return;
    }
  } catch (err) {
    logger.error('sme allocation lookup failed', {
      error: (err as Error).message,
      userId: user.id,
    });
    res.status(500).json({ error: 'internal error checking sme allocation' });
    return;
  }

  res.status(403).json({
    error: 'forbidden',
    message: 'Legal Chat is restricted to Superadmin and Superadmin-allocated SMEs.',
  });
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;
  const user = authReq.user;
  if (!user) { res.status(401).json({ error: 'authentication required' }); return; }
  if (!user.role || !SUPERADMIN_ROLES.has(user.role)) {
    res.status(403).json({ error: 'superadmin only' });
    return;
  }
  next();
}
