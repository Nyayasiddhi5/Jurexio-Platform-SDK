// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurisdiction API Routes
 * 
 * Global Legal Operating System - 6 Jurisdictions
 * Data residency, compliance, and LLM routing
 */

import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { jurisdictionService } from '../services/jurisdiction-service.js';
import { syncAllJurisdictionAgents, getJurisdictionStats } from '../services/jurisdiction-agents/unified-jurisdiction-sync.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { createLogger } from '../utils/logger.js';
import {
  loadAllJurisdictionRegistries,
  getAgentsByJurisdiction,
  getJurisdictionAgent,
  getJurisdictionStats as getJurisdictionRegistryStats,
  getAllJurisdictionAgents,
  resolveJurisdictionAgent,
} from '../config/jurisdiction-configs.js';

const logger = createLogger('jurisdiction-routes');

const router = Router();

router.use((req, res, next) => {
  const publicPaths = ['/', '/supported', '/registries/stats', '/registries/agents', '/registries/load'];
  if (publicPaths.includes(req.path)) return next();
  if (req.path.match(/^\/[A-Z]{2}\/agents/i)) return next();
  return authenticateToken(req, res, next);
});

router.get('/', (req: Request, res: Response) => {
  try {
    const jurisdictions = jurisdictionService.getJurisdictions();
    res.json({
      success: true,
      data: jurisdictions,
      count: jurisdictions.length
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = jurisdictionService.getGlobalStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/db-stats', async (req: Request, res: Response) => {
  try {
    const stats = await getJurisdictionStats();
    res.json({
      success: true,
      data: stats,
      source: 'database',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/sync', async (req: Request, res: Response) => {
  try {
    logger.info('🌍 Starting jurisdiction agents sync...');
    const result = await syncAllJurisdictionAgents();
    res.json({
      success: result.success,
      data: result,
      message: `Synced agents across 6 jurisdictions: Total ${result.totals.total} agents`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/sync', async (req: Request, res: Response) => {
  try {
    logger.info('🌍 Starting jurisdiction agents sync (GET)...');
    const result = await syncAllJurisdictionAgents();
    res.json({
      success: result.success,
      data: result,
      message: `Synced agents across 6 jurisdictions: Total ${result.totals.total} agents`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/compliance', (req: Request, res: Response) => {
  try {
    const compliance = jurisdictionService.getComplianceSummary();
    res.json({
      success: true,
      data: compliance
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const jurisdiction = jurisdictionService.getJurisdictionByCode(req.params.code);
    if (!jurisdiction) {
      res.status(404).json({ success: false, error: 'Jurisdiction not found' });
    }
    res.json({ success: true, data: jurisdiction });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code/compliance', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const rules = jurisdictionService.getComplianceRules(req.params.code);
    res.json({
      success: true,
      data: rules,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      jurisdiction: req.params.code.toUpperCase()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code/data-residency', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const config = jurisdictionService.getDataResidencyConfig(req.params.code);
    if (!config) {
      res.status(404).json({ success: false, error: 'Jurisdiction not found' });
    }
    res.json({
      success: true,
      data: config,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      jurisdiction: req.params.code.toUpperCase()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code/llm-routing', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const routing = jurisdictionService.routeLLMByJurisdiction(req.params.code);
    res.json({
      success: true,
      data: routing,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      jurisdiction: req.params.code.toUpperCase()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code/languages', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const languages = jurisdictionService.getLanguagesForJurisdiction(req.params.code);
    res.json({
      success: true,
      data: languages,
      count: languages.length,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      jurisdiction: req.params.code.toUpperCase()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/validate-transfer', (req: Request, res: Response) => {
  try {
    const { fromJurisdiction, toJurisdiction } = req.body;
    const validation = jurisdictionService.validateDataTransfer(fromJurisdiction, toJurisdiction);
    res.json({
      success: true,
      data: validation,
      from: fromJurisdiction,
      to: toJurisdiction
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/registries/stats', async (_req: Request, res: Response) => {
  try {
    const stats = getJurisdictionRegistryStats();

    // NV-JURIS-STATS-COUNTS-001 (2026-06-25): the registry-derived stats hardcode
    // courts:0 / statutes:0 (the JSON registries don't carry those). Enrich each
    // jurisdiction with the real per-jurisdiction counts from nv_statutes /
    // nv_courts so the Jurisdiction Mapping page shows live numbers. Best-effort:
    // if either table is missing/drifted the counts stay 0 (page still renders).
    const statuteByJur = new Map<string, number>();
    const courtByJur = new Map<string, number>();
    if (db) {
      try {
        const r = await db.execute(sql`SELECT UPPER(jurisdiction) AS j, COUNT(*)::int AS n FROM nv_statutes GROUP BY UPPER(jurisdiction)`);
        for (const row of ((r as any).rows ?? r) as Array<{ j: string; n: number }>) statuteByJur.set(String(row.j), Number(row.n));
      } catch { /* nv_statutes missing/drifted — leave statute counts at 0 */ }
      try {
        const r = await db.execute(sql`SELECT UPPER(jurisdiction) AS j, COUNT(*)::int AS n FROM nv_courts GROUP BY UPPER(jurisdiction)`);
        for (const row of ((r as any).rows ?? r) as Array<{ j: string; n: number }>) courtByJur.set(String(row.j), Number(row.n));
      } catch { /* nv_courts missing/drifted — leave court counts at 0 */ }
    }

    let totalStatutes = 0;
    let totalCourts = 0;
    const jurisdictions = stats.jurisdictions.map((j) => {
      const statutes = statuteByJur.get(String(j.code).toUpperCase()) ?? 0;
      const courts = courtByJur.get(String(j.code).toUpperCase()) ?? 0;
      totalStatutes += statutes;
      totalCourts += courts;
      return { ...j, statutes, courts };
    });

    res.json({ success: true, data: { ...stats, jurisdictions, totalStatutes, totalCourts } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/registries/agents', (_req: Request, res: Response) => {
  try {
    const agents = getAllJurisdictionAgents();
    res.json({
      success: true,
      totalAgents: agents.length,
      data: agents.map(a => ({
        id: a.id,
        name: a.name,
        jurisdiction: a.jurisdiction,
        jurisdictionName: a.jurisdictionName,
        tier: a.tier,
        module: a.module,
        practiceArea: a.practiceArea,
        status: a.status,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/registries/load', (_req: Request, res: Response) => {
  try {
    const result = loadAllJurisdictionRegistries();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code/agents', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const code = req.params.code.toUpperCase();
    const agents = getAgentsByJurisdiction(code);
    const { module, tier, search } = req.query;

    let filtered = agents;
    if (module) filtered = filtered.filter(a => a.module === module);
    if (tier) filtered = filtered.filter(a => a.tier === tier);
    if (search) {
      const q = (search as string).toLowerCase();
      filtered = filtered.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.practiceArea ?? '').toLowerCase().includes(q)
      );
    }

    res.json({
      success: true,
      jurisdiction: code,
      totalAgents: agents.length,
      filteredCount: filtered.length,
      data: filtered.map(a => ({
        id: a.id,
        originalAgentId: a.originalAgentId,
        name: a.name,
        tier: a.tier,
        module: a.module,
        practiceArea: a.practiceArea,
        description: a.description,
        capabilities: a.capabilities,
        protocols: a.protocols,
        supportedLanguages: a.supportedLanguages,
        status: a.status,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.get('/:code/agents/:agentId', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const code = req.params.code.toUpperCase();
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const agent = getJurisdictionAgent(code, req.params.agentId);
    if (!agent) {
      res.status(404).json({ success: false, error: `Agent ${req.params.agentId} not found in ${code}` });
    }
    res.json({ success: true, data: agent });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

router.post('/resolve-agent', (req: Request, res: Response) => {
  try {
    const { agentId, jurisdictionCode, capability } = req.body;
    const agent = resolveJurisdictionAgent(agentId, jurisdictionCode, capability);
    if (!agent) {
      res.status(404).json({ success: false, error: 'No matching agent found' });
    }
    res.json({ success: true, data: agent });
  } catch (error: any) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(error) });
  }
});

export default router;
