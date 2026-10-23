// /api/nv5/orch/agent-select/* — BM25 agent selector (TF-IDF; no LLM).
import { Router, type Request, type Response } from 'express';
import { bm25AgentSelector, type AgentDescriptor } from '../services/bm25-agent-selector.js';
import { requireSdkKey, safeError } from './_nv5-orch-auth.js';

const router = Router();
router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, service: 'bm25-agent-selector' });
});

router.post('/load', (req: Request, res: Response) => {
  try {
    const { agents } = req.body || {};
    if (!Array.isArray(agents)) return safeError(res, 'agents array required', 400);
    bm25AgentSelector.load(agents as AgentDescriptor[]);
    res.json({ success: true, loaded: agents.length });
  } catch (e) { safeError(res, e); }
});

router.post('/select', (req: Request, res: Response) => {
  try {
    const { query, topK } = req.body || {};
    if (!query || typeof query !== 'string') return safeError(res, 'query string required', 400);
    const out = bm25AgentSelector.select(query, typeof topK === 'number' ? topK : 5);
    res.json({ success: true, selected: out, count: out.length });
  } catch (e) { safeError(res, e); }
});

export default router;
