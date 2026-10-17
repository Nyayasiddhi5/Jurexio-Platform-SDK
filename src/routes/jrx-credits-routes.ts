/**
 * NYV Credits Router — /api/jrx/credits/*
 * Jurexio Enterprise Platform 312
 *
 * ENDPOINTS:
 *   GET  /wallet        — wallet balance + reserved credits (auth required)
 *   GET  /transactions  — ledger last 50 (auth required)
 *   POST /topup         — add credits (enterprise/government only)
 *   GET  /costs         — tool credit cost table (auth required)
 *
 * All endpoints require auth. Costs are auth-gated to prevent rate-limit enumeration.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { creditService, TOOL_CREDIT_COSTS } from '../services/jrx-credit-service.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('credits');

router.use(authenticateToken);

/** GET /api/jrx/credits/wallet — wallet balance + reserved */
router.get('/wallet', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id ?? (req.user as any)?.userId;
    const wallet = await creditService.getWallet(userId);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.warn('credits_wallet_error', { err: (err as Error).message });
    res.status(500).json({ success: false, error: 'Failed to fetch wallet' });
  }
});

/** GET /api/jrx/credits/transactions — ledger */
router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id ?? (req.user as any)?.userId;
    const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
    const txns = await creditService.getTransactions(userId, limit);
    res.json({ success: true, data: { transactions: txns, count: txns.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
  }
});

// NV-RBAC-GAP-001: topup credits ANY user_id with arbitrary amounts — this is a
// money-equivalent write. Previously only `authenticateToken` (router-level), so
// any authed caller could grant themselves unlimited credits. Now super_admin
// only (the documented "admin or webhook" intent; webhooks use their own signed
// path, not this JWT route).
/** POST /api/jrx/credits/topup — super_admin only */
router.post('/topup', requireRole('super_admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { user_id, amount, source, note } = req.body as {
      user_id: string; amount: number; source?: string; note?: string;
    };
    if (!user_id || !amount || amount <= 0) {
      res.status(400).json({ success: false, error: 'user_id and positive amount required' });
      return;
    }
    const success = await creditService.addCredits(user_id, amount, (source as any) || 'MANUAL', note);
    res.json({ success, data: { user_id, credits_added: amount } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Topup failed' });
  }
});

/** GET /api/jrx/credits/costs — tool credit cost table */
router.get('/costs', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      costs: TOOL_CREDIT_COSTS,
      note: 'Credits are deducted per successful AI tool execution. Failed executions are not charged.',
      zero_balance_policy: 'All AI tools are immediately disabled when balance reaches 0. Returns HTTP 402.',
      low_balance_threshold: 10,
    },
  });
});

export default router;
