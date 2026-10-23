// /api/nv5/legal-pipeline/chunker/* — read-only metadata + deterministic
// preview endpoints for nvLegalChunkerService. No LLM calls (chunking is
// pure rule-based segmentation). Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { nvLegalChunkerService } from '../../../services/document-pipeline/jrx-legal-chunker-service.js';
import { nvLegalParserService } from '../../../services/document-pipeline/jrx-legal-parser-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-legal-chunker',
    chunkTypes: ['section', 'clause', 'definition', 'recital', 'schedule', 'heading'],
    defaults: { minTokens: 100, maxTokens: 800, overlapTokens: 50 },
    supportedDocTypes: ['statute', 'contract', 'judgment'],
  });
});

router.post('/preview', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text || text.length < 10) return safeError(res, 'text required (>=10 chars)', 400);
    if (text.length > 50_000) return safeError(res, 'text too large for preview (max 50k chars)', 400);
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'text/plain';
    const parsed = await nvLegalParserService.parseDocument(text, mimeType);
    // NV-CTX-RETRIEVAL-001: this admin preview is deterministic by contract
    // (ZERO LLM emission, NV-LLM-001/ARCH-001). Strip any `contextualize` opt-in
    // so the preview can never fan out LLM enrichment calls.
    const { contextualize: _ignored, ...previewOptions } = (req.body?.options ?? {}) as Record<string, unknown>;
    const chunks = await nvLegalChunkerService.chunkDocument(parsed, previewOptions);
    res.json({
      success: true,
      mimeType,
      docType: parsed.metadata.docType,
      chunkCount: chunks.length,
      chunks: chunks.slice(0, 20),
      truncated: chunks.length > 20,
    });
  } catch (e) { safeError(res, e); }
});

export default router;
