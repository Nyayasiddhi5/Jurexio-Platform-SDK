// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * NV Multi-Org Row Level Security Routes v3.1.2
 * GET  /api/jrx/org/rls/status       — RLS status for all tables
 * POST /api/jrx/org/rls/apply        — Apply RLS policies (admin only)
 * GET  /api/jrx/org/rls/stats/:orgId — Data stats for an org
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/jrx-auth.js';
import {
  applyRlsPolicies,
  getAllRlsStatuses,
  getOrgDataStats,
} from '../services/jrx-rls-service.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

const router = Router();
const logger = createLogger('./jrx-rls-routes');

router.use(authenticateToken);

// ── RLS Status across all tables ───────────────────────────────────────────────
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const statuses = await getAllRlsStatuses();
    const allEnabled = statuses.every(s => s.rlsEnabled);
    res.json({
      success: true,
      rlsEnabled: allEnabled,
      tables: statuses,
      version: '3.1.2',
    });
  } catch (err: any) {
    logger.warn('[RLS] Status check failed', { error: err.message });
    safeError(res, err, 500);
  }
});

// ── Apply RLS policies (super-admin) ──────────────────────────────────────────
router.post('/apply', async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user?.role !== 'super_admin' && user?.role !== 'admin') {
    safeError(res, 'Super-admin role required to apply RLS policies', 403);
    return;
  }
  const result = await applyRlsPolicies();
  res.json({ success: result.success, message: result.message });
});

// ── Org data statistics ────────────────────────────────────────────────────────
router.get('/stats/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  const user = (req as any).user;
  const userOrgId = user?.orgId || user?.org_id || 'default';

  if (user?.role !== 'super_admin' && userOrgId !== orgId) {
    safeError(res, 'You can only view stats for your own organization', 403);
    return;
  }

  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const stats = await getOrgDataStats(orgId);
  res.json({ success: true, stats });
});

export default router;
