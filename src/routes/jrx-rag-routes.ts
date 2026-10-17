/**
 * NV RAG Live Routes v3.1.2
 * POST /api/jrx/rag/query         — Retrieve documents (live pgvector or keyword)
 * POST /api/jrx/rag/embed         — Embed and store a document
 * GET  /api/jrx/rag/health        — pgvector + embeddings status
 * GET  /api/jrx/rag/namespaces    — List available namespaces
 */

import { Router, Request, Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import {
  retrieveDocuments,
  embedAndStore,
  getRagHealth,
} from '../services/jrx-rag-live-service.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

const router = Router();
const logger = createLogger('./jrx-rag-routes');

router.use(dualSdkOrJwt);

// ── RAG Health ─────────────────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response) => {
  const health = await getRagHealth();
  res.json({
    success: true,
    rag: {
      ...health,
      mode: health.pgvector && health.embeddings ? 'live_vector' : health.embeddings ? 'embeddings_only' : 'keyword_fallback',
    },
    version: '3.1.2',
  });
});

// ── Query documents ────────────────────────────────────────────────────────────
// NV-AUTO-RAG-001 / NV-RAG-BYPASS-001: by default this admin query endpoint now
// routes through the UNIFIED tier-aware Auto-RAG router (adaptive / corrective /
// LightRAG / GraphRAG / RRF / rerank) instead of the low-level pgvector
// retriever — so the admin surface uses the exact same retrieval brain as the
// Queen hot path. `raw: true` keeps the legacy single-layer pgvector escape
// hatch for diagnostics.
router.post('/query', async (req: Request, res: Response) => {
  const { query, namespace, jurisdiction, topK, minSimilarity, raw } = req.body;
  if (!query || typeof query !== 'string') {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'query string is required' });
    return;
  }

  const startTime = Date.now();
  try {
    if (raw === true) {
      const documents = await retrieveDocuments({ query, namespace, jurisdiction, topK, minSimilarity });
      logger.info('[RAG] Query served (raw pgvector)', { query: query.slice(0, 40), count: documents.length, ms: Date.now() - startTime });
      res.json({ success: true, query, mode: 'raw_vector', documents, count: documents.length, latencyMs: Date.now() - startTime });
      return;
    }

    const { autoRagRetrieve } = await import('../services/jrx-auto-rag-router.js');
    const userId = (req as any).user?.id || (req as any).user?.userId;
    const tenantId = (req as any).user?.orgId || (req as any).user?.organizationId;
    const result = await autoRagRetrieve({
      query,
      jurisdiction: jurisdiction || 'IN',
      tier: (req as any).user?.tier,
      topK: typeof topK === 'number' ? topK : 8,
      userId,
      tenantId,
    });
    const documents = result.chunks.map((c) => ({
      id: c.id,
      content: c.content,
      source: c.source,
      title: c.title,
      jurisdiction: c.jurisdiction,
      similarity: c.score,
      layer: c.layer,
      citationRef: c.citationRef,
    }));
    logger.info('[RAG] Query served (auto-rag)', {
      query: query.slice(0, 40),
      count: documents.length,
      intent: result.intent,
      layersUsed: result.layersUsed,
      ms: Date.now() - startTime,
    });
    res.json({
      success: true,
      query,
      mode: 'auto_rag',
      intent: result.intent,
      layersUsed: result.layersUsed,
      retrievalMethods: result.retrievalMethods,
      confidence: result.confidence,
      documents,
      count: documents.length,
      latencyMs: Date.now() - startTime,
    });
  } catch (err: any) {
    logger.warn('[RAG] Query failed', { error: err.message });
    safeError(res, err, 500);
  }
});

// ── Embed and store document ──────────────────────────────────────────────────
router.post('/embed', async (req: Request, res: Response) => {
  const { content, metadata, namespace, jurisdiction } = req.body;
  if (!content || !namespace) {
    sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'content and namespace are required' });
    return;
  }

  const result = await embedAndStore(content, metadata || {}, namespace, jurisdiction || 'IN');
  res.status(result.success ? 201 : 422).json(result);
});

// ── List namespaces ────────────────────────────────────────────────────────────
router.get('/namespaces', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    namespaces: [
      { id: 'ipc',          label: 'Indian Penal Code',           jurisdiction: 'IN' },
      { id: 'cpc',          label: 'Code of Civil Procedure',     jurisdiction: 'IN' },
      { id: 'crpc',         label: 'Code of Criminal Procedure',  jurisdiction: 'IN' },
      { id: 'contracts',    label: 'Contract Act 1872',           jurisdiction: 'IN' },
      { id: 'companies',    label: 'Companies Act 2013',          jurisdiction: 'IN' },
      { id: 'dpdpa',        label: 'DPDP Act 2023',               jurisdiction: 'IN' },
      { id: 'uk_common',    label: 'UK Common Law',               jurisdiction: 'UK' },
      { id: 'us_federal',   label: 'US Federal Law',              jurisdiction: 'US' },
      { id: 'eu_gdpr',      label: 'GDPR / EU Law',               jurisdiction: 'EU' },
      { id: 'difc',         label: 'DIFC Law (GCC)',              jurisdiction: 'GCC' },
      { id: 'sg_statutes',  label: 'Singapore Statutes',          jurisdiction: 'SG' },
    ],
    version: '3.1.2',
  });
});

export default router;
