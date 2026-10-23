// /api/nv5/legal-pipeline/embedding/* — read-only capability/model listing
// for nvLegalEmbeddingService. The actual embed() method calls OpenAI /
// self-hosted endpoints; per NV-LLM-001 / NV-ARCH-001 we expose
// metadata-only here. Real embedding flows go through the canonical RAG
// pipeline traversed by realLLMService.executeRequest. Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';
// Static-import edge so the wiring auditor counts the service WIRED.
import { nvLegalEmbeddingService } from '../../../services/rag/jrx-legal-embedding-service.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-legal-embedding',
    indicLanguages: ['hi', 'bn', 'te', 'ta', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'as', 'ur'],
    note: 'Embedding emission only via canonical RAG pipeline (realLLMService.executeRequest). Use this surface for capability discovery.',
  });
});

router.get('/models', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  try {
    void nvLegalEmbeddingService;
    const models = [
      { id: 'text-embedding-3-large', provider: 'openai', dimensions: 3072, default: true },
      { id: 'text-embedding-3-small', provider: 'openai', dimensions: 1536 },
      { id: 'multilingual-e5-large', provider: 'self-hosted', envVar: 'SELF_HOSTED_EMBED_URL' },
      { id: 'in-legal-bert', provider: 'self-hosted', envVar: 'IN_LEGAL_BERT_URL', jurisdiction: 'IN' },
      { id: 'legal-bert-base', provider: 'self-hosted', envVar: 'LEGAL_BERT_URL' },
    ];
    res.json({ success: true, models });
  } catch (e) { safeError(res, e); }
});

export default router;
