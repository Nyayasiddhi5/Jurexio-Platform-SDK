// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NYV-SVC-SOCIAL-MEM Routes — /api/jrx/social-memory/*
 */

import { Router, Request, Response } from 'express';
import { socialMemoryService } from '../services/social-memory-service.js';
import { authenticateToken as authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate as any);

// ── GET /api/jrx/social-memory/org/:orgId — list all memories for org (admin) ──
router.get('/org/:orgId', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = req.params.orgId;
    const userOrgId = user?.orgId || user?.organizationId;

    if (userOrgId !== orgId && user?.role !== 'admin' && user?.role !== 'super_admin') {
      res.status(403).json({ success: false, message: 'Access denied: cannot view memories for another organization.' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const memories = await socialMemoryService.listOrgSocialMemories(orgId, limit, offset);

    res.json({ success: true, memories, total: memories.length, limit, offset });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to list social memories.', error: err.message });
  }
});

// ── GET /api/jrx/social-memory/:userId/:agentKey — get social memory record ────
router.get('/:userId/:agentKey', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { userId, agentKey } = req.params;

    if (user?.id !== userId && user?.role !== 'admin' && user?.role !== 'super_admin' && user?.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Access denied: cannot view another user\'s social memory.' });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const memory = await socialMemoryService.getOrCreateSocialMemory(userId, agentKey, orgId);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const context = await socialMemoryService.getSocialContext(userId, agentKey, orgId);

    res.json({ success: true, memory, contextString: context.contextString });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get social memory.', error: err.message });
  }
});

// ── DELETE /api/jrx/social-memory/:userId/:agentKey — clear history (GDPR) ────
router.delete('/:userId/:agentKey', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { userId, agentKey } = req.params;

    if (user?.id !== userId && user?.role !== 'admin' && user?.role !== 'super_admin') {
      res.status(403).json({ success: false, message: 'Access denied: can only delete your own social memory.' });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await socialMemoryService.clearHistory(userId, agentKey, orgId);

    res.json({ success: true, message: `Social memory cleared for user ${userId} / agent ${agentKey}. This action satisfies GDPR Article 17 (right to erasure).` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to clear social memory.', error: err.message });
  }
});

// ── POST /api/jrx/social-memory/:userId/:agentKey/refresh-opinion ──────────────
router.post('/:userId/:agentKey/refresh-opinion', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { userId, agentKey } = req.params;

    if (user?.id !== userId && user?.role !== 'admin' && user?.role !== 'super_admin' && user?.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Access denied.' });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const opinion = await socialMemoryService.updateOpinion(userId, agentKey, orgId);

    res.json({ success: true, opinion: opinion || null, message: opinion ? 'Opinion refreshed successfully.' : 'Not enough interaction history to form an opinion (minimum 2 conversations required).' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to refresh opinion.', error: err.message });
  }
});

// ── POST /api/jrx/social-memory/record — record a new interaction ──────────────
router.post('/record', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const userId = user?.id;
    const { agentKey, platform = 'portal', userMessage, agentResponse } = req.body;

    if (!agentKey || !userMessage || !agentResponse) {
      res.status(400).json({ success: false, message: 'agentKey, userMessage, and agentResponse are required.' });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await socialMemoryService.recordInteraction(userId, agentKey, orgId, platform, userMessage, agentResponse);

    res.json({ success: true, message: 'Interaction recorded.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to record interaction.', error: err.message });
  }
});

export default router;
