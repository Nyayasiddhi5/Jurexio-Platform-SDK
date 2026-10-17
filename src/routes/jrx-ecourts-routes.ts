// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * NV eCourts API Routes v3.1.2
 * GET  /api/jrx/ecourts/health
 * GET  /api/jrx/ecourts/case/:cnrNumber         — Case status by CNR
 * GET  /api/jrx/ecourts/case/:cnrNumber/orders  — Case orders
 * GET  /api/jrx/ecourts/causelist/:courtCode    — Cause list for date
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/jrx-auth.js';
import {
  getCaseStatus,
  getCaseOrders,
  getCauseList,
  geteCourtsHealth,
} from '../services/jrx-ecourts-client.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-ecourts-routes');

// ── Health (public) ────────────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response) => {
  const health = await geteCourtsHealth();
  res.json({ success: true, ecourts: health, version: '3.1.2' });
});

// All other routes require auth
router.use(authenticateToken);

// ── Case status by CNR ────────────────────────────────────────────────────────
router.get('/case/:cnrNumber', async (req: Request, res: Response) => {
  const { cnrNumber } = req.params;
  if (!cnrNumber || cnrNumber.length < 10) {
    res.status(400).json({ error: 'Valid CNR number required (e.g. MHCC010123452024)' });
    return;
  }

  logger.info('[eCourts] Case status lookup', { cnrNumber });
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const result = await getCaseStatus(cnrNumber);

  if ('error' in result) {
    res.status(422).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, case: result });
});

// ── Case orders ───────────────────────────────────────────────────────────────
router.get('/case/:cnrNumber/orders', async (req: Request, res: Response) => {
  const { cnrNumber } = req.params;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const result = await getCaseOrders(cnrNumber);
  if ('error' in result) {
    res.status(422).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, orders: result, count: result.length });
});

// ── Cause list ────────────────────────────────────────────────────────────────
router.get('/causelist/:courtCode', async (req: Request, res: Response) => {
  const { courtCode } = req.params;
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const result = await getCauseList(courtCode, date);
  if ('error' in result) {
    res.status(422).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, causeList: result, count: result.length, date, courtCode });
});

export default router;
