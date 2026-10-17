// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';
import { requireRole } from '../middleware/jrx-auth.js';
import { nvAgentTestingFramework } from '../services/testing/jrx-agent-testing-framework.js';
import { nvLlmJudgeService } from '../services/testing/jrx-llm-judge-service.js';

const logger = createLogger('./jrx-testing-routes');
const router = Router();

router.use(requireRole('admin', 'org_admin', 'super_admin'));

// Normalize router-side jurisdiction codes to the
// framework's internal codes. The Console/UI sends `GC` (router code), but
// our oracle/adversarial fixtures and ROUTER_JURISDICTION_MAP key off `GCC`.
// Without this, jurisdiction=GC silently misses fixtures.
type TestingJurisdiction = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
const TESTING_JURISDICTION_NORMALIZE: Record<string, TestingJurisdiction> = {
  GC: 'GCC', GCC: 'GCC',
  IN: 'IN', UK: 'UK', US: 'US', EU: 'EU', SG: 'SG', EUR: 'EU',
};
function normalizeTestingJurisdiction(input: unknown): TestingJurisdiction | null {
  if (typeof input !== 'string') return null;
  const k = input.trim().toUpperCase();
  return TESTING_JURISDICTION_NORMALIZE[k] ?? null;
}

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '3.1.2',
    services: {
      agentTestingFramework: 'active',
      llmJudge: 'active',
    },
    note: 'Admin-only testing endpoints',
  });
});

router.post('/oracle-tests', async (req: Request, res: Response) => {
  try {
    const { jurisdiction, agentId } = req.body;
    const j = normalizeTestingJurisdiction(jurisdiction);
    if (!j) { res.status(400).json({ error: 'jurisdiction is required (IN|UK|US|EU|SG|GC|GCC)' }); return; }
    const result = await nvAgentTestingFramework.runOracleTests(j, agentId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'oracle-tests', error: (error as Error).message });
    res.status(500).json({ error: 'Oracle tests failed' });
  }
});

router.post('/adversarial-tests', async (req: Request, res: Response) => {
  try {
    const { jurisdiction, agentId } = req.body;
    const j = normalizeTestingJurisdiction(jurisdiction);
    if (!j) { res.status(400).json({ error: 'jurisdiction is required (IN|UK|US|EU|SG|GC|GCC)' }); return; }
    const result = await nvAgentTestingFramework.runAdversarialTests(agentId, j);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'adversarial-tests', error: (error as Error).message });
    res.status(500).json({ error: 'Adversarial tests failed' });
  }
});

router.post('/llm-judge', async (req: Request, res: Response) => {
  try {
    const { response, query, jurisdiction, domain, judgeModel } = req.body;
    if (!response || !query || !jurisdiction || !domain) {
      res.status(400).json({ error: 'response, query, jurisdiction, domain are required' });
    }
    const result = await nvLlmJudgeService.evaluate(response, { query, jurisdiction, domain }, judgeModel);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'llm-judge', error: (error as Error).message });
    res.status(500).json({ error: 'LLM Judge evaluation failed' });
  }
});

router.post('/scorecard', async (req: Request, res: Response) => {
  try {
    const { jurisdiction, agentId } = req.body;
    const j = normalizeTestingJurisdiction(jurisdiction);
    if (!j) { res.status(400).json({ error: 'jurisdiction is required (IN|UK|US|EU|SG|GC|GCC)' }); return; }
    const result = await nvAgentTestingFramework.generateScorecard(j, agentId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ route: 'scorecard', error: (error as Error).message });
    res.status(500).json({ error: 'Scorecard generation failed' });
  }
});

export default router;
