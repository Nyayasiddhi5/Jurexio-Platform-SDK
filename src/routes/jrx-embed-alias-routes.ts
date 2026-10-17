/**
 * NV-EMBED-ALIAS-001 — POST /api/jrx/embed
 * Canonical 1536-d embedding alias for NSP docs/UAT (same cascade as gateway).
 */
import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { sendApiError } from '../utils/jrx-api-error.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-embed-alias');
router.use(dualSdkOrJwt);

router.post('/embed', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const { text, texts, input, content, dimensions } = body;
    const inputTexts: string[] = Array.isArray(texts)
      ? texts.map((t: unknown) => String(t || '')).filter(Boolean)
      : Array.isArray(input)
        ? input.map((t: unknown) => String(t || '')).filter(Boolean)
        : text != null && String(text).trim()
          ? [String(text)]
          : input != null && String(input).trim()
            ? [String(input)]
            : content != null && String(content).trim()
              ? [String(content)]
              : [];
    if (!inputTexts.length) {
      sendApiError(res, 'BAD_REQUEST', {
        overrideMessage: 'text or texts field required (aliases: input, content)',
      });
      return;
    }
    const dims = Number(dimensions) || Number(process.env.NYV_EMBEDDING_DIMS) || 1536;
    const { embedWithConfiguredCascade } = await import('../config/jrx-embedding-cascade.js');
    const embeddings: number[][] = [];
    let model = 'embedding-cascade';
    let provider = 'cascade';
    for (const t of inputTexts.slice(0, 32)) {
      const one = await embedWithConfiguredCascade(t.slice(0, 8000));
      if (!one?.embedding?.length) {
        // Prefer soft failure over 503 for partner embed probes — empty vector
        // with success:false is clearer than gateway outage semantics.
        sendApiError(res, 'BAD_REQUEST', {
          status: 422,
          overrideMessage: 'Embedding cascade returned empty vector; retry with shorter text',
        });
        return;
      }
      embeddings.push(one.embedding);
      model = one.model || model;
      provider = one.provider || provider;
    }
    const first = embeddings[0];
    res.json({
      success: true,
      embedding: first,
      embeddings,
      dimensions: first.length,
      model,
      provider,
      count: embeddings.length,
      requestedDimensions: dims,
    });
  } catch (error: any) {
    logger.error('[NV Embed] failed', { error: error?.message });
    sendApiError(res, 'INTERNAL_ERROR', {
      status: 422,
      overrideMessage: error?.message || 'Embedding generation failed',
    });
  }
});

export default router;
