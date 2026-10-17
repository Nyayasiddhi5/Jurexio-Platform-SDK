// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX-SVC-KM-MODULES Routes — /api/jrx/knowledge-modules/*
 */

import { Router, Request, Response } from 'express';
import { knowledgeModuleService, type ModuleName } from '../services/knowledge-module-service.js';
import { authenticateToken as authenticate } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('knowledge-module-routes');

const router = Router();
router.use(authenticate as any);

const VALID_MODULES: ModuleName[] = ['LegalNewsModule', 'CourtRulingsModule', 'LegislationModule', 'LegalPrecedentModule'];

// ── GET /api/jrx/knowledge-modules/ — list all modules + status ────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const status = await knowledgeModuleService.getAllModulesStatus(orgId);
    res.json({ success: true, modules: status, total: status.length });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get module status.', error: err.message });
  }
});

// ── POST /api/jrx/knowledge-modules/run-all — trigger all modules ──────────────
router.post('/run-all', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    if (!['admin', 'super_admin', 'manager'].includes(user?.role)) {
      res.status(403).json({ success: false, message: 'Only admins can trigger module runs.' });
      return;
    }

    res.json({ success: true, message: 'All knowledge modules triggered. Running in background...', orgId });

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    knowledgeModuleService.runAllModules(orgId).then(results => {
      const total = results.reduce((acc, r) => acc + r.itemsIngested, 0);
      logger.info(`[KM-MODULES] All modules complete for org ${orgId}: ${total} items ingested total`);
    }).catch(err => {
      logger.error(`[KM-MODULES] All modules run error for org ${orgId}:`, err.message);
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to trigger module run.', error: err.message });
  }
});

// ── POST /api/jrx/knowledge-modules/:moduleId/run — trigger single module ──────
router.post('/:moduleId/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { moduleId } = req.params;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    if (!['admin', 'super_admin', 'manager'].includes(user?.role)) {
      res.status(403).json({ success: false, message: 'Only admins can trigger module runs.' });
      return;
    }

    if (!VALID_MODULES.includes(moduleId as ModuleName)) {
      res.status(400).json({ success: false, message: `Invalid moduleId. Valid modules: ${VALID_MODULES.join(', ')}` });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = await knowledgeModuleService.runSingleModule(moduleId as ModuleName, orgId);

    res.json({ success: true, result, message: result.error ? `Module ${moduleId} ran with errors.` : `Module ${moduleId} completed: ${result.itemsIngested} items ingested.` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Module run failed.', error: err.message });
  }
});

// ── GET /api/jrx/knowledge-modules/content — browse ingested content ───────────
router.get('/content', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const moduleName = req.query.moduleName as ModuleName | undefined;
    const jurisdiction = req.query.jurisdiction as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (moduleName && !VALID_MODULES.includes(moduleName)) {
      res.status(400).json({ success: false, message: `Invalid moduleName. Valid: ${VALID_MODULES.join(', ')}` });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const content = await knowledgeModuleService.getIngestedContent(orgId, { moduleName, jurisdiction, limit, offset });

    res.json({ success: true, content, total: content.length, limit, offset });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get content.', error: err.message });
  }
});

// ── DELETE /api/jrx/knowledge-modules/content/:id — delete item ───────────────
router.delete('/content/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { id } = req.params;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    if (!['admin', 'super_admin', 'manager'].includes(user?.role)) {
      res.status(403).json({ success: false, message: 'Only admins can delete content items.' });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await knowledgeModuleService.deleteContentItem(id, orgId);
    res.json({ success: true, message: `Content item ${id} deleted.` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to delete content item.', error: err.message });
  }
});

// ── PUT /api/jrx/knowledge-modules/:moduleId/settings — update config ──────────
router.put('/:moduleId/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { moduleId } = req.params;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    if (!['admin', 'super_admin', 'manager'].includes(user?.role)) {
      res.status(403).json({ success: false, message: 'Only admins can update module settings.' });
      return;
    }

    if (!VALID_MODULES.includes(moduleId as ModuleName)) {
      res.status(400).json({ success: false, message: `Invalid moduleId. Valid: ${VALID_MODULES.join(', ')}` });
      return;
    }

    const { enabled, searchFrequency, preferredTimeOfDay, jurisdictions, maxItemsPerRun } = req.body;
    const config: Record<string, any> = {};
    if (typeof enabled === 'boolean') config.enabled = enabled;
    if (typeof searchFrequency === 'number') config.searchFrequency = searchFrequency;
    if (preferredTimeOfDay) config.preferredTimeOfDay = preferredTimeOfDay;
    if (Array.isArray(jurisdictions)) config.jurisdictions = jurisdictions;
    if (typeof maxItemsPerRun === 'number') config.maxItemsPerRun = maxItemsPerRun;

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await knowledgeModuleService.updateModuleConfig(orgId, moduleId as ModuleName, config);
    res.json({ success: true, message: `Settings updated for ${moduleId}.`, config });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update settings.', error: err.message });
  }
});

// ── GET /api/jrx/knowledge-modules/:moduleId/context — get agent context ───────
router.get('/:moduleId/context', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { moduleId } = req.params;
    const limit = parseInt(req.query.limit as string) || 5;

    if (!VALID_MODULES.includes(moduleId as ModuleName)) {
      res.status(400).json({ success: false, message: `Invalid moduleId. Valid: ${VALID_MODULES.join(', ')}` });
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const context = await knowledgeModuleService.getLatestContextForModule(moduleId as ModuleName, orgId, limit);

    res.json({ success: true, moduleId, context: context || null, hasContext: context.length > 0 });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get context.', error: err.message });
  }
});

export default router;
