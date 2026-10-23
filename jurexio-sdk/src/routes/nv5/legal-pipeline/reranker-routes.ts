// /api/nv5/legal-pipeline/reranker/* — read-only metadata + deterministic
// RRF fusion endpoint. Pure math (no LLM). The cross-encoder rerankLegal
// method is NOT exposed here (calls external CROSS_ENCODER_URL); that path
// remains reachable only through the canonical RAG pipeline traversed by
// realLLMService.executeRequest. Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { nvLegalRerankerService } from '../../../services/rag/jrx-legal-reranker-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-legal-reranker',
    algorithms: ['rrf', 'mmr', 'cross-encoder'],
    defaults: { rrfK: 60, mmrLambda: 0.7, topK: 10, jurisdictionBoost: 1.2 },
    note: 'cross-encoder rerank exposed only via canonical RAG pipeline.',
  });
});

router.post('/rrf-fuse', requireSdkKeyOnly, requireScope('admin'), (req: Request, res: Response) => {
  try {
    const lists = Array.isArray(req.body?.lists) ? req.body.lists : null;
    if (!lists || lists.length === 0) return safeError(res, 'lists[] required', 400);
    if (lists.length > 10) return safeError(res, 'too many lists (max 10)', 400);
    const k = typeof req.body?.k === 'number' ? req.body.k : 60;
    const fused = nvLegalRerankerService.fusionRRF(lists, k);
    res.json({ success: true, fusedCount: fused.length, results: fused.slice(0, 50) });
  } catch (e) { safeError(res, e); }
});

export default router;
