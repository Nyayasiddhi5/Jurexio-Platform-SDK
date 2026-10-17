// /api/nv5/orch/plugins/* — NyvIntegrationPluginManager introspection.
// Read-only endpoints; no LLM emission.
import { Router, type Request, type Response } from 'express';
import { pluginManager } from '../services/nyv-integration-plugin-manager.js';
import { requireSdkKey, safeError } from './_nv5-orch-auth.js';

const router = Router();
router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, service: 'nyv-integration-plugin-manager' });
});

router.get('/status-report', (_req: Request, res: Response) => {
  try {
    const report = pluginManager.getStatusReport();
    res.json({ success: true, plugins: report, count: report.length });
  } catch (e) { safeError(res, e); }
});

router.get('/audit-log', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1000);
    const log = pluginManager.getAuditLog(limit);
    res.json({ success: true, entries: log });
  } catch (e) { safeError(res, e); }
});

router.get('/global-stats', (_req: Request, res: Response) => {
  try {
    const stats = pluginManager.getGlobalStats();
    res.json({ success: true, stats });
  } catch (e) { safeError(res, e); }
});

export default router;
