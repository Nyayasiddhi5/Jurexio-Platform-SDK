/**
 * NV RAG Audit Routes — Workstream #2 (V5.0.0)
 * Mounted at /api/jrx/admin/rag
 *
 *   POST  /audit/run         super_admin: run a fresh 203-cell audit (sync)
 *   GET   /audit/coverage    analyst+:    return last completed audit (heatmap data)
 *   GET   /audit/runs        analyst+:    list past audit run IDs
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken, roleSatisfies } from '../middleware/jrx-auth.js';
import { selectRows } from '../services/persistence/jrx-persistence-helper.js';
import { runAudit } from '../scripts/rag/audit-coverage.js';
import { CATEGORIES, JURISDICTIONS, totalCells, explicitFixtureCount } from '../scripts/rag/rag-audit-fixtures.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

const router = Router();
const logger = createLogger('./jrx-rag-audit-routes');

// NV-RBAC-HIERARCHY-001: delegate to the canonical hierarchy gate
// (`roleSatisfies` + ROLE_HIERARCHY in nv-auth.ts) so this route never drifts
// from the platform role ladder. The previous local `order` array omitted
// `admin`/`platform_admin`, which wrongly denied those roles.
function requireRole(role: string) {
  return (req: Request, res: Response, next: any): void => {
    const user = (req as any).user;
    if (!user) { sendApiError(res, 'UNAUTHORIZED'); return; }
    if (!roleSatisfies(user.role, [role])) {
      sendApiError(res, 'BAD_REQUEST', { status: 403, overrideMessage: `${role} role required (or higher)` });
      return;
    }
    next();
  };
}

router.post('/audit/run', authenticateToken, requireRole('super_admin'), async (req: Request, res: Response) => {
  logger.info({ msg: 'audit run requested', user: (req as any).user?.email });
  try {
    const result = await runAudit({ persist: true });
    res.json({ success: true, runId: result.runId, summary: { green: result.green, yellow: result.yellow, red: result.red, totalCells: result.totalCells, avgLatencyMs: result.avgLatencyMs } });
  } catch (e: any) {
    logger.error({ msg: 'audit run failed', error: e.message });
    safeError(res, e, 500);
  }
});

router.get('/audit/coverage', authenticateToken, requireRole('analyst'), async (_req: Request, res: Response): Promise<void> => {
  const lastRun = await selectRows(`SELECT run_id, MAX(ran_at) AS ran_at FROM nv_schema.nv_rag_coverage_audit GROUP BY run_id ORDER BY MAX(ran_at) DESC LIMIT 1`);
  if (lastRun.length === 0) {
    res.json({
      success: true, hasData: false,
      catalog: { categories: CATEGORIES, jurisdictions: JURISDICTIONS, totalCells: totalCells(), explicitFixtures: explicitFixtureCount() },
      message: 'No audit has been run yet. POST /audit/run to start one (super_admin).',
    });
    return;
  }
  const runId = lastRun[0].run_id;
  const cells = await selectRows(
    `SELECT category, jurisdiction, pipeline_used, sources_count, avg_similarity, grounded, latency_ms, status
     FROM nv_schema.nv_rag_coverage_audit WHERE run_id = $1 ORDER BY jurisdiction, category`,
    [runId],
  );
  const green = cells.filter((c: any) => c.status === 'green').length;
  const yellow = cells.filter((c: any) => c.status === 'yellow').length;
  const red = cells.filter((c: any) => c.status === 'red').length;
  res.json({
    success: true, hasData: true, runId, ranAt: lastRun[0].ran_at,
    catalog: { categories: CATEGORIES, jurisdictions: JURISDICTIONS, totalCells: totalCells(), explicitFixtures: explicitFixtureCount() },
    summary: { green, yellow, red, total: cells.length },
    cells,
  });
});

router.get('/audit/runs', authenticateToken, requireRole('analyst'), async (_req: Request, res: Response) => {
  const runs = await selectRows(
    `SELECT run_id, MIN(ran_at) AS ran_at, COUNT(*)::int AS cells,
            SUM(CASE WHEN status='green' THEN 1 ELSE 0 END)::int  AS green,
            SUM(CASE WHEN status='yellow' THEN 1 ELSE 0 END)::int AS yellow,
            SUM(CASE WHEN status='red' THEN 1 ELSE 0 END)::int    AS red
     FROM nv_schema.nv_rag_coverage_audit
     GROUP BY run_id ORDER BY MIN(ran_at) DESC LIMIT 50`,
  );
  res.json({ success: true, runs });
});

export default router;
