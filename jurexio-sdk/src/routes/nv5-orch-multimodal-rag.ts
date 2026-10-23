// /api/nv5/orch/multimodal-rag/* — AdvancedMultimodalRAG wiring.
//
// Session-10 Batch A. NV-LLM-001 honored: only /health and /kb/create
// (metadata only — no retrieval / no LLM emission). The previous /query
// endpoint was dropped because `performContextualRetrieval` may chain
// to embeddings/LLM calls, which would bypass the canonical orchestrator
// safety ring.
import { Router, type Request, type Response } from 'express';
import { advancedRAG } from '../packages/multimodal/advanced-multimodal-rag.js';
import { requireSdkKey, safeError } from './_nv5-orch-auth.js';

const router = Router();
router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, service: 'advanced-multimodal-rag' });
});

router.post('/kb/create', async (req: Request, res: Response) => {
  try {
    const { id, name, type } = req.body || {};
    if (!id || !name) return safeError(res, 'id and name required', 400);
    const validType: 'text' | 'multimodal' | 'dynamic' =
      type === 'text' || type === 'multimodal' || type === 'dynamic' ? type : 'multimodal';
    const kb = await advancedRAG.createKnowledgeBase(id, name, validType);
    res.json({ success: true, knowledgeBase: kb });
  } catch (e) { safeError(res, e); }
});

export default router;
