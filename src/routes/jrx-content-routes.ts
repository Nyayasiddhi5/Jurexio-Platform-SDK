// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX-SVC-CONTENT Routes — /api/jrx/content/*
 */

import { Router, Request, Response } from 'express';
import { contentEngineService } from '../services/content-engine-service.js';
import { agentPersonaService, type Platform, type TimeOfDay } from '../services/agent-persona-service.js';
import { authenticateToken as authenticate } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('content-routes');

const router = Router();
router.use(authenticate as any);

const VALID_PLATFORMS: Platform[] = ['whatsapp', 'email', 'portal', 'api'];
const VALID_TIME_OF_DAY: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

// ── POST /api/jrx/content/generate — generate on-demand content ────────────────
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const userId = user?.id;

    const {
      agentKey = 'corporate-ma',
      platform = 'portal',
      timeOfDay,
      topic,
      matterId,
      useKnowledgeContext = true,
      maxRetries = 3,
    } = req.body;

    if (!VALID_PLATFORMS.includes(platform)) {
      res.status(400).json({ success: false, message: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` });
      return;
    }
    if (timeOfDay && !VALID_TIME_OF_DAY.includes(timeOfDay)) {
      res.status(400).json({ success: false, message: `timeOfDay must be one of: ${VALID_TIME_OF_DAY.join(', ')}` });
      return;
    }

    const result = await contentEngineService.generateContent({
      agentKey,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      orgId,
      platform,
      timeOfDay,
      matterId,
      userId,
      useKnowledgeContext,
      topic,
      maxRetries,
    });

    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Content generation failed.', error: err.message });
  }
});

// ── GET /api/jrx/content/history — browse content history ─────────────────────
router.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const agentKey = req.query.agentKey as string | undefined;
    const platform = req.query.platform as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const history = await contentEngineService.getContentHistory(orgId, { agentKey, platform, limit, offset });

    res.json({ success: true, history, total: history.length, limit, offset });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get content history.', error: err.message });
  }
});

// ── POST /api/jrx/content/insights — trigger proactive insights ────────────────
router.post('/insights', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { agentKey = 'corporate-ma' } = req.body;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const insights = await contentEngineService.getProactiveInsights(orgId, agentKey);

    res.json({ success: true, insights, total: insights.length, message: `Generated ${insights.length} proactive insight(s).` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to generate insights.', error: err.message });
  }
});

// ── GET /api/jrx/content/schedule — view time-of-day content schedule ──────────
router.get('/schedule', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    schedule: [
      { timeOfDay: 'morning', hours: '05:00–11:59', focus: 'Daily legal briefings, case updates, deadline alerts, court calendar', modules: ['LegalNewsModule'] },
      { timeOfDay: 'afternoon', hours: '12:00–16:59', focus: 'Document analysis, research, obligation tracking, due diligence', modules: ['CourtRulingsModule', 'LegalNewsModule'] },
      { timeOfDay: 'evening', hours: '17:00–20:59', focus: 'Risk summaries, compliance status, settlement considerations, legislative updates', modules: ['LegislationModule'] },
      { timeOfDay: 'night', hours: '21:00–04:59', focus: 'Deep research, statute analysis, precedent mining, jurisdiction analysis', modules: ['LegalPrecedentModule', 'CourtRulingsModule'] },
    ],
    currentTimeOfDay: agentPersonaService.getCurrentTimeOfDay(),
  });
});

// ── POST /api/jrx/content/bulk-generate — generate for all active agents ───────
router.post('/bulk-generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    if (!['admin', 'super_admin', 'manager'].includes(user?.role)) {
      res.status(403).json({ success: false, message: 'Only admins can trigger bulk generation.' });
      return;
    }

    const { agentKeys, platform = 'portal', useKnowledgeContext = true } = req.body;

    const keysToUse: string[] = Array.isArray(agentKeys) && agentKeys.length > 0
      ? agentKeys
      : agentPersonaService.listAllPersonas().map(p => p.agentKey).slice(0, 5);

    res.json({ success: true, message: `Bulk generation started for ${keysToUse.length} agents.`, agentKeys: keysToUse });

    Promise.allSettled(
      keysToUse.map(agentKey =>
        // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
        contentEngineService.generateContent({ agentKey, orgId, platform, useKnowledgeContext, maxRetries: 2 })
      )
    ).then(results => {
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      logger.info(`[CONTENT-ENGINE] Bulk generation complete for org ${orgId}: ${succeeded}/${keysToUse.length} succeeded`);
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Bulk generation failed.', error: err.message });
  }
});

export default router;
