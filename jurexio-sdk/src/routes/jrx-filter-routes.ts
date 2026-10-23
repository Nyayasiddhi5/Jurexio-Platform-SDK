// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX-SVC-FILTER Routes — /api/jrx/filter/*
 */

import { Router, Request, Response } from 'express';
import { messageFilterService, type FilterCategory, type FilterConfig } from '../services/message-filter-service.js';
import { authenticateToken as authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate as any);

// ── POST /api/jrx/filter/classify — classify a message (admin/debug) ───────────
router.post('/classify', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { message, agentKey = 'generic', context } = req.body;

    if (!message || message.length < 3) {
      res.status(400).json({ success: false, message: 'message is required (minimum 3 characters).' });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = await messageFilterService.runFilterPipeline(message, agentKey, orgId, user?.id, context);

    res.json({
      success: true,
      message,
      classification: result,
      pipelineStages: {
        selfReferenceCheck: messageFilterService.isSelfReference(message, agentKey),
        orgRulesApplied: true,
        llmClassification: result.category,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Classification failed.', error: err.message });
  }
});

// ── GET /api/jrx/filter/config — get org filter config ────────────────────────
router.get('/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const agentKey = req.query.agentKey as string | undefined;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const config = await messageFilterService.getFilterConfig(orgId, agentKey);
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get filter config.', error: err.message });
  }
});

// ── PUT /api/jrx/filter/config — update org filter rules ──────────────────────
router.put('/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';

    if (!['admin', 'super_admin', 'manager'].includes(user?.role)) {
      res.status(403).json({ success: false, message: 'Only admins and managers can update filter config.' });
      return;
    }

    const { agentKey, rules, blockedCategories, allowAmbiguous } = req.body;

    const validCategories: FilterCategory[] = ['legal_query', 'off_topic', 'spam_promo', 'inappropriate', 'self_reference', 'capability_request', 'ambiguous'];
    if (blockedCategories && !Array.isArray(blockedCategories)) {
      res.status(400).json({ success: false, message: 'blockedCategories must be an array.' });
      return;
    }
    if (blockedCategories) {
      const invalid = blockedCategories.filter((c: string) => !validCategories.includes(c as FilterCategory));
      if (invalid.length > 0) {
        res.status(400).json({ success: false, message: `Invalid categories: ${invalid.join(', ')}. Valid: ${validCategories.join(', ')}` });
        return;
      }
    }

    const config: FilterConfig = {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      orgId,
      agentKey: agentKey || undefined,
      rules: rules || [],
      blockedCategories: blockedCategories || ['spam_promo', 'inappropriate'],
      allowAmbiguous: allowAmbiguous !== false,
    };

    await messageFilterService.saveFilterConfig(config);
    res.json({ success: true, message: 'Filter config updated.', config });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update filter config.', error: err.message });
  }
});

// ── GET /api/jrx/filter/categories — list all filter categories with descriptions
router.get('/categories', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    categories: [
      { id: 'legal_query', description: 'A genuine legal question or request — ALLOWED', action: 'allow' },
      { id: 'off_topic', description: 'Question unrelated to legal matters — soft redirect', action: 'redirect' },
      { id: 'spam_promo', description: 'Promotional/advertising content — BLOCKED by default', action: 'block' },
      { id: 'inappropriate', description: 'Harmful, abusive, or discriminatory content — BLOCKED by default', action: 'block' },
      { id: 'self_reference', description: 'AI-generated response passed as input (circular) — IGNORED', action: 'ignore' },
      { id: 'capability_request', description: 'Asking what the agent can do — ALLOWED with capability description', action: 'allow' },
      { id: 'ambiguous', description: 'Unclear intent — ALLOWED by default with low-confidence flag', action: 'allow_with_flag' },
    ],
  });
});

export default router;
