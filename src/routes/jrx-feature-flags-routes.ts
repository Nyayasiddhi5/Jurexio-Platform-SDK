// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NYV Feature Flag Routes
 * /api/jrx/flags/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Full CRUD REST API for feature flag management.
 * Includes kill switch, A/B testing, and per-tenant flag evaluation.
 *
 * @module nv-feature-flags-routes
 */

import { Router, Request, Response } from 'express';
import { featureFlagManager, FlagEvalContext, FlagPlatform, JurisdictionCode } from '../services/nyv-feature-flag-manager.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

// NV-RBAC-GAP-001: flag CREATE/TOGGLE/KILL-SWITCH/DELETE/SYNC are platform-wide
// state changes (a kill-switch can disable a feature for every tenant). Gate
// every mutation with auth + super_admin. Read/eval GETs stay open for runtime
// flag evaluation by internal services.
const adminOnly = [authenticateToken, requireRole('super_admin')];

const logger = createLogger('./jrx-feature-flags-routes');
const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/flags
// List all flags with optional filtering
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const { type, enabled, platform, jurisdiction } = req.query;
  let flags = featureFlagManager.getAll();

  if (type) flags = flags.filter(f => f.type === type);
  if (enabled !== undefined) flags = flags.filter(f => f.enabled === (enabled === 'true'));
  if (platform) flags = flags.filter(f => f.platforms.includes('all') || f.platforms.includes(platform as FlagPlatform));
  if (jurisdiction) flags = flags.filter(f => f.jurisdictions.includes('all') || f.jurisdictions.includes(jurisdiction as JurisdictionCode));

  res.json({
    success: true,
    data: {
      flags,
      total: flags.length,
      enabled: flags.filter(f => f.enabled).length,
      killSwitches: flags.filter(f => f.killSwitchArmed).length,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/flags/evaluate
// Evaluate all flags for a given context
// Query: ?orgId=x&userId=y&platform=pro&jurisdiction=IN
// ─────────────────────────────────────────────────────────────────────────────
router.get('/evaluate', (req: Request, res: Response) => {
  const ctx: FlagEvalContext = {
    orgId: req.query.orgId as string,
    userId: req.query.userId as string,
    platform: req.query.platform as FlagPlatform,
    jurisdiction: req.query.jurisdiction as JurisdictionCode,
  };

  const all = featureFlagManager.getAll();
  const results: Record<string, { enabled: boolean; variant?: string; reason: string }> = {};

  for (const flag of all) {
    const result = featureFlagManager.evaluate(flag.key, ctx);
    results[flag.key] = result;
  }

  res.json({ success: true, data: { context: ctx, results } });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/flags/:key
// Get single flag definition + evaluation for current env
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:key', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const flag = featureFlagManager.get(req.params.key);
  if (!flag) {
    sendApiError(res, 'NOT_FOUND', { status: 404, overrideMessage: `Flag not found: ${req.params.key}` });
  }
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const evaluation = featureFlagManager.evaluate(req.params.key);
  res.json({ success: true, data: { flag, evaluation } });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/flags
// Create or update a feature flag
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', adminOnly, (req: Request, res: Response) => {
  try {
    const { key, ...rest } = req.body;
    if (!key) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Missing required field: key' }); return; }

    const existing = featureFlagManager.get(key);
    featureFlagManager.upsert({ key, ...rest });

    logger.info(`[FeatureFlags] Flag ${existing ? 'updated' : 'created'} via API: ${key}`);
    res.status(existing ? 200 : 201).json({
      success: true,
      data: featureFlagManager.get(key),
      action: existing ? 'updated' : 'created',
    });
  } catch (err: any) {
    safeError(res, err, 400);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/jrx/flags/:key/toggle
// Enable or disable a flag
// Body: { enabled: true|false }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:key/toggle', adminOnly, (req: Request, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'enabled must be a boolean' });
  }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    featureFlagManager.setEnabled(req.params.key, enabled);
    res.json({ success: true, data: { key: req.params.key, enabled } });
  } catch (err: any) {
    safeError(res, err, 404);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/flags/:key/kill-switch
// Arm the kill switch — instantly and permanently disables the feature
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:key/kill-switch', adminOnly, (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    featureFlagManager.armKillSwitch(req.params.key);
    logger.warn(`[FeatureFlags] Kill switch armed via API: ${req.params.key}`);
    res.json({
      success: true,
      data: {
        key: req.params.key,
        message: `Kill switch armed. ${req.params.key} is now permanently disabled.`,
      },
    });
  } catch (err: any) {
    safeError(res, err, 404);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/jrx/flags/:key
// Remove a feature flag
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:key', adminOnly, (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const removed = featureFlagManager.delete(req.params.key);
  if (!removed) {
    sendApiError(res, 'NOT_FOUND', { status: 404, overrideMessage: `Flag not found: ${req.params.key}` });
  }
  res.json({ success: true, data: { removed: req.params.key } });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/flags/sync
// Hot-sync from database (no restart needed)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sync', adminOnly, async (req: Request, res: Response) => {
  try {
    await featureFlagManager.syncFromDatabase();
    res.json({ success: true, data: { synced: true, total: featureFlagManager.getAll().length } });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

export { router as featureFlagsRoutes };
