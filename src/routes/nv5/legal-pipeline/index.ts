// /api/nv5/legal-pipeline/* — barrel router for Session-11 Batch E (legal
// document RAG pipeline). Wires 5 previously-orphan services:
//   - jrx-legal-chunker-service       → /chunker     (capabilities + preview)
//   - jrx-legal-embedding-service     → /embedding   (capabilities + models)
//   - jrx-legal-reranker-service      → /reranker    (capabilities + rrf-fuse)
//   - jrx-legal-summarizer-service    → /summarizer  (capabilities only)
//   - jrx-readability-scorer-service  → /readability (capabilities + score)
//
// All sub-routers are admin-scoped. Each sub-mount is independently
// feature-flagged (default OFF). With all 5 flags OFF the entire namespace
// returns 404 — matching Batches A/B/C/D wiring discipline.
//
// NV-LLM-001 / NV-ARCH-001: provider-emitting paths (embedding API calls,
// LLM summarization, cross-encoder reranking) are deliberately NOT exposed.
// Those remain reachable only through the canonical RAG pipeline traversed
// by realLLMService.executeRequest. The /preview, /score, and /rrf-fuse
// endpoints are pure deterministic computation (no provider calls).
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isJrxFeatureOn, type JrxFeatureFlag } from '../../../config/jrx-feature-flags.js';
import chunkerRouter from './chunker-routes.js';
import embeddingRouter from './embedding-routes.js';
import rerankerRouter from './reranker-routes.js';
import summarizerRouter from './summarizer-routes.js';
import readabilityRouter from './readability-routes.js';

const router = Router();

// Always-on liveness probe (Phase 1 audit fix 2026-05-11). Additive.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'legal-pipeline',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: {
      chunker:     isJrxFeatureOn('legalPipelineChunker'),
      embedding:   isJrxFeatureOn('legalPipelineEmbedding'),
      reranker:    isJrxFeatureOn('legalPipelineReranker'),
      summarizer:  isJrxFeatureOn('legalPipelineSummarizer'),
      readability: isJrxFeatureOn('legalPipelineReadability'),
    },
  });
});

const gate = (flag: JrxFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isJrxFeatureOn(flag) ? sub(req, res, next) : next();

router.use('/chunker',     gate('legalPipelineChunker',     chunkerRouter));
router.use('/embedding',   gate('legalPipelineEmbedding',   embeddingRouter));
router.use('/reranker',    gate('legalPipelineReranker',    rerankerRouter));
router.use('/summarizer',  gate('legalPipelineSummarizer',  summarizerRouter));
router.use('/readability', gate('legalPipelineReadability', readabilityRouter));

export default router;
