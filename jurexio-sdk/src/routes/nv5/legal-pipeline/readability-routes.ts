// /api/nv5/legal-pipeline/readability/* — pure deterministic readability
// scoring (Flesch-Kincaid, no LLM). Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { nvReadabilityScorerService } from '../../../services/jrx-readability-scorer-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-readability-scorer',
    metrics: ['flesch-kincaid-grade', 'flesch-reading-ease', 'avg-sentence-length',
              'avg-syllables-per-word', 'complex-word-percentage'],
    targetRange: 'Plain-language legal writing: grade 8-12, reading ease 50-70',
  });
});

router.post('/score', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text || text.length < 20) return safeError(res, 'text required (>=20 chars)', 400);
    if (text.length > 100_000) return safeError(res, 'text too large (max 100k chars)', 400);
    const score = await nvReadabilityScorerService.score(text);
    res.json({ success: true, ...score });
  } catch (e) { safeError(res, e); }
});

export default router;
