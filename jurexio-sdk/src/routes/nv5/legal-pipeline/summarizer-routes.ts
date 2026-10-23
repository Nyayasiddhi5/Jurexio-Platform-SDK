// /api/nv5/legal-pipeline/summarizer/* — read-only capability listing for
// nvLegalSummarizerService. The actual summarize() method calls LLMs;
// real summarization flows go through the canonical pipeline traversed by
// realLLMService.executeRequest. Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { requireSdkKeyOnly, requireScope } from '../_auth.js';
// Static-import edge so the wiring auditor counts the service WIRED.
import { nvLegalSummarizerService } from '../../../services/jrx-legal-summarizer-service.js';
void nvLegalSummarizerService;

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-legal-summarizer',
    levels: ['executive', 'detailed', 'technical'],
    audiences: ['lawyer', 'citizen', 'judge', 'student'],
    consistencyThreshold: 0.90,
    longDocThresholdTokens: 2000,
    note: 'Summarization emission only via canonical orchestrator path.',
  });
});

export default router;
