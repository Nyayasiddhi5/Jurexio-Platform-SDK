// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX Document Intelligence Orchestrator REST Routes v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Exposes the JrxDocumentIntelligenceOrchestrator as a REST API.
 *
 * ENDPOINTS:
 *   POST   /api/jrx/documents/upload       — Upload + queue document for RAG indexing
 *   GET    /api/jrx/documents/:docId/status — Poll ingest status + progress
 *   GET    /api/jrx/documents/list          — List user's documents
 *   POST   /api/jrx/documents/search        — Hybrid RAG search across indexed docs
 *   DELETE /api/jrx/documents/:docId        — Delete document + all indexes
 *   GET    /api/jrx/documents/graph/stats   — Legal GraphRAG entity statistics
 *
 * AUTH: JWT required (req.user.id / req.user.orgId / req.user.platform)
 *
 * MULTIPART: Uses multer for file upload (buffered, max 100MB)
 *
 * @module jrx-document-orchestrator-routes
 * @version 1.0.0
 */

import { requireDb } from '../utils/jrx-type-helpers.js';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';
import { nyvDocIntelligence } from '../services/jrx-document-intelligence-orchestrator.js';
import { nyvGraphRAGLegal } from '../services/rag/jrx-graphrag-legal-service.js';
import { nvDocAccessGuard } from '../middleware/jrx-doc-access-guard.js';
import { getJrxDmsConfig } from '../config/jrx-dms-config.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';

const logger = createLogger('doc-orchestrator-routes');
const router = Router();

// T004 — Fix legacy route bypass: enforce JWT auth on ALL document endpoints
// (Previously mounted without auth; req.user could be undefined → anonymous fallback)
router.use(authenticateToken);

// ─────────────────────────────────────────────────────────────────────────────
// MULTER CONFIG (T010 Stream A — disk-backed streaming upload, configurable
// limit driven by jrx-dms config; default 1 GB. Switching from memoryStorage
// keeps RSS bounded for large legal corpora that previously OOM'd at 100 MB.)
// ─────────────────────────────────────────────────────────────────────────────

const NV_TMP_DIR = path.join(os.tmpdir(), 'jrx-uploads');
try { fs.mkdirSync(NV_TMP_DIR, { recursive: true }); } catch { /* best-effort */ }

function resolveMaxUploadBytes(): number {
  try {
    const cfg = getJrxDmsConfig();
    const fromCfg = (cfg as any)?.uploads?.maxFileSizeMb
      ?? (cfg as any)?.limits?.maxFileSizeMb;
    if (fromCfg && Number.isFinite(Number(fromCfg))) {
      return Number(fromCfg) * 1024 * 1024;
    }
  } catch { /* fall through to default */ }
  return 1024 * 1024 * 1024; // 1 GB default per Phase 2A
}

const MAX_UPLOAD_BYTES = resolveMaxUploadBytes();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, NV_TMP_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 80);
      cb(null, `${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}_${safe}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/markdown', 'text/html', 'application/json',
      'image/jpeg', 'image/png', 'image/tiff', 'image/webp',
    ];
    cb(null, ALLOWED.includes(file.mimetype) || file.mimetype.startsWith('text/'));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getUser(req: Request): { userId: string; orgId: string; platform: string } {
  const user = req.user;
  return {
    userId: String(user?.id ?? user?.userId ?? 'anonymous'),
    // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
    orgId: String(user?.orgId ?? user?.org_id ?? '1'),
    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    platform: String(user?.platform ?? 'nv'),
  };
}

function apiResponse<T>(data: T, meta: Record<string, any> = {}) {
  return { success: true, data, meta: { timestamp: new Date().toISOString(), ...meta } };
}

function apiError(message: string, code = 400, details?: any) {
  return { success: false, error: message, details, meta: { timestamp: new Date().toISOString() } };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/documents/upload
 * Upload a document and queue it for RAG indexing.
 * Returns immediately with docId + jobId + statusUrl.
 */
/**
 * Multer error-handling middleware (architect-mandated 2026-05-06).
 * If multer itself rejects the upload (size limit, fileFilter, malformed
 * multipart), the per-route handler's `finally` block never runs, so any
 * partially-written tmp file would leak. This middleware:
 *   1. Unlinks `req.file?.path` if multer wrote one before failing.
 *   2. Returns a clean JSON 400/413 instead of Express's default HTML.
 */
function uploadErrorHandler(err: any, req: Request, res: Response, next: any) {
  if (!err) return next();
  const tmpPath = (req.file as any)?.path;
  if (tmpPath) {
    fs.promises.unlink(tmpPath).catch((unlinkErr) =>
      logger.warn('upload_tmp_cleanup_failed', { tmpPath, err: unlinkErr?.message }),
    );
  }
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  logger.warn('upload_multer_error', { code: err.code, message: err.message });
  res.status(status).json(apiError(err.message ?? 'Upload failed', status));
}

// Task #217: consentGate runs BEFORE multer so the personal-data
// upload doesn't get parsed/written-to-disk before the DPDPA consent
// pre-flight has had a chance to record (and, in enforce mode,
// reject) a consent breach. Order: auth → consentGate → multer →
// uploadErrorHandler → handler.
router.post('/upload', consentGate({ purpose: 'document_storage', triggeredBy: 'doc-orchestrator:/upload' }), upload.single('file'), uploadErrorHandler, async (req: Request, res: Response) => {
  let tmpPath: string | undefined;
  try {
    if (!req.file) {
      res.status(400).json(apiError('No file provided. Use multipart/form-data with field name "file".'));
      return;
    }
    // multer.diskStorage writes to req.file.path; buffer is not populated.
    tmpPath = (req.file as any).path as string | undefined;

    const { userId, orgId, platform } = getUser(req);
    const body = req.body;

    // Read from the streamed-to-disk temp file. For very large uploads this
    // still allocates a Buffer for the storage adapter — a follow-up will
    // wire createReadStream directly into the storage backend's multipart
    // upload path. The win here vs. the previous memoryStorage code is that
    // multer no longer holds a 1 GB Buffer in RAM during the multipart parse,
    // so transient RSS is bounded by the storage upload, not parser+upload.
    const fileBuffer = tmpPath
      ? await fs.promises.readFile(tmpPath)
      : (req.file as any).buffer;

    const result = await nyvDocIntelligence.ingest({
      orgId,
      platform,
      userId,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      fileBuffer,
      documentClass: body.documentClass ?? 'user_document',
      jurisdiction: body.jurisdiction,
      language: body.language,
      tags: body.tags ? (Array.isArray(body.tags) ? body.tags : [body.tags]) : undefined,
      isConfidential: body.isConfidential === 'true' || body.isConfidential === true,
      retentionDays: body.retentionDays ? parseInt(body.retentionDays, 10) : undefined,
      namespaces: body.namespaces ? JSON.parse(body.namespaces) : undefined,
      enableGraphRAG: body.enableGraphRAG !== 'false' && body.enableGraphRAG !== false,
    });

    logger.info('document_upload_queued', {
      docId: result.docId, userId, orgId,
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
    });
    res.status(202).json(apiResponse(result, { message: 'Document queued for processing' }));
  } catch (err: any) {
    logger.error('document_upload_error', { error: err.message });
    res.status(err.message?.includes('exceeds') || err.message?.includes('Unsupported') ? 400 : 500)
      .json(apiError(err.message));
  } finally {
    if (tmpPath) {
      fs.promises.unlink(tmpPath).catch(() => { /* ignored */ });
    }
  }
});

/**
 * GET /api/jrx/documents/:docId/status
 * Poll the ingest status for a document.
 */
router.get('/:docId/status', nvDocAccessGuard({ paramName: 'docId' }), async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const docId: string = req.params["docId"] as string;

    const status = await nyvDocIntelligence.getStatus(docId, userId);
    if (!status) {
      res.status(404).json(apiError('Document not found.'));
      return;
    }

    res.json(apiResponse(status, { docAccess: (req as any).docAccess }));
  } catch (err: any) {
    res.status(500).json(apiError(err.message));
  }
});

/**
 * GET /api/jrx/documents/list
 * List all documents for the current user.
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { userId, orgId, platform } = getUser(req);
    const limit = Math.min(parseInt(String(Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit ?? '20'), 10), 100);
    const offset = parseInt(String(Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset ?? '0'), 10);

    const result = await nyvDocIntelligence.listDocuments(orgId, platform, userId, limit, offset);
    res.json(apiResponse(result, { limit, offset }));
  } catch (err: any) {
    res.status(500).json(apiError(err.message));
  }
});

/**
 * POST /api/jrx/documents/search
 * Hybrid RAG search (vector + BM25 + GraphRAG) across user's indexed documents.
 *
 * Body:
 *   query         string   required — natural language query
 *   jurisdiction  string   optional — 'IN', 'UK', 'US', etc.
 *   language      string   optional — 'en', 'hi', 'ta', etc.
 *   maxResults    number   optional — default 10, max 50
 *   minScore      number   optional — default 0.72
 *   docIds        string[] optional — limit to specific documents
 *   enableGraphRAG bool    optional — default true
 *   enableRerank  bool     optional — default true
 */
router.post('/search', consentGate({ purpose: 'ai_processing', triggeredBy: 'doc-orchestrator:/search' }), async (req: Request, res: Response) => {
  try {
    const { userId, orgId, platform } = getUser(req);
    const {
      query, jurisdiction, language, maxResults, minScore,
      docIds, enableGraphRAG, enableRerank,
      includeGlobalStatutes, includeOrgShared,
    } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      res.status(400).json(apiError('query is required and must be at least 2 characters.'));
    }

    const result = await nyvDocIntelligence.search({
      query: query.trim(),
      orgId,
      platform,
      userId,
      jurisdiction,
      language,
      maxResults: Math.min(parseInt(String(maxResults ?? '10'), 10), 50),
      minScore: parseFloat(String(minScore ?? '0.72')),
      docIds: Array.isArray(docIds) ? docIds : undefined,
      enableGraphRAG: enableGraphRAG !== false,
      enableRerank: enableRerank !== false,
      includeGlobalStatutes: includeGlobalStatutes !== false,
      includeOrgShared: includeOrgShared !== false,
    });

    res.json(apiResponse(result, {
      query, retrievalMethod: result.retrievalMethod, latencyMs: result.latencyMs,
    }));
  } catch (err: any) {
    logger.error('document_search_error', { error: err.message });
    res.status(500).json(apiError(err.message));
  }
});

/**
 * DELETE /api/jrx/documents/:docId
 * Delete a document and remove all its chunks from the RAG index.
 */
router.delete('/:docId', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const docId: string = req.params["docId"] as string;

    // Verify ownership before deletion
    const status = await nyvDocIntelligence.getStatus(docId, userId);
    if (!status) {
      res.status(404).json(apiError('Document not found or access denied.'));
      return;
    }

    const { db: _rawDb } = await import('../db/index.js'); const db = requireDb(_rawDb);
    const { sql } = await import('drizzle-orm');

    /* NV-DOC-ERASURE-001 — actually delete the stored object, not just the index rows.
     *
     * This endpoint previously removed `knowledge_chunks` rows and set the ingest row to
     * `status='failed'`, and stopped there. `nyvDocumentStorage.deleteDocument()` existed
     * with **zero callers**, so every "deleted" document's bytes stayed in S3 (or on local
     * disk) forever. Two consequences: object storage grows without bound, and a DPDP §12
     * / GDPR Art. 17 erasure request could not be honoured — we would have told a data
     * principal their document was deleted while still holding it.
     *
     * The ingest row carries `org_id`, `platform` and `file_name` (DDL at
     * jrx-document-intelligence-orchestrator.ts:185-215), which is exactly the tuple
     * `deleteDocument()` needs to rebuild the three object paths (primary file, parsed
     * content, embeddings). Read them BEFORE marking the row, because the row is the only
     * place that mapping exists.
     *
     * Ordering is deliberate: delete the object FIRST, then the DB rows. If the object
     * delete fails we return 500 with the document still fully intact and retryable —
     * whereas the reverse order would lose the storage coordinates and orphan the bytes
     * permanently with no way to find them again. */
    const meta = await db
      .execute(
        sql`SELECT org_id, platform, file_name, storage_path
              FROM nv_schema.nv_document_ingest_status
             WHERE doc_id = ${docId} AND user_id = ${userId} LIMIT 1`,
      )
      .catch(() => ({ rows: [] as unknown[] }));
    const row = ((meta as { rows?: Array<Record<string, unknown>> }).rows || [])[0];

    let objectDeleted = false;
    if (row) {
      const { nyvDocumentStorage } = await import('../services/jrx-document-storage-service.js');
      try {
        await nyvDocumentStorage.deleteDocument(
          String(row.org_id),
          String(row.platform),
          userId,
          docId,
          String(row.file_name),
        );
        objectDeleted = true;
      } catch (storageErr: unknown) {
        /* Fail loudly and keep the document intact so the caller can retry. Reporting
         * success here is what makes an erasure claim false. */
        logger.error('document_erasure_storage_failed', {
          docId,
          userId,
          alertCode: 'JRX-DOC-ERASURE-001',
          err: storageErr instanceof Error ? storageErr.message : String(storageErr),
        });
        res.status(500).json(
          apiError(
            'Document object could not be deleted from storage; nothing was removed. Retry, or escalate — the document is still present.',
          ),
        );
        return;
      }
    } else {
      /* No ingest row means no storage coordinates. Say so rather than implying the
       * bytes were removed. */
      logger.warn('document_erasure_no_storage_row', { docId, userId });
    }

    // Remove chunks from knowledge_chunks table
    await db.execute(sql`DELETE FROM knowledge_chunks WHERE doc_id = ${docId} AND user_id = ${userId}`).catch(() => {});
    /* `status='deleted'` rather than `'failed'`: a deletion is not an ingest failure, and
     * conflating them made erasures indistinguishable from processing errors in the audit
     * trail. `retrievable=false` so no retrieval path can surface it again. */
    await db.execute(sql`UPDATE nv_schema.nv_document_ingest_status
                            SET status = 'deleted', retrievable = false,
                                error_message = 'Deleted by user request',
                                updated_at = NOW()
                          WHERE doc_id = ${docId} AND user_id = ${userId}`).catch(() => {});

    logger.info('document_deleted', { docId, userId, objectDeleted });
    res.json(apiResponse({ docId, deleted: true, objectDeleted }));
  } catch (err: any) {
    res.status(500).json(apiError(err.message));
  }
});

/**
 * GET /api/jrx/documents/graph/stats
 * Legal GraphRAG entity graph statistics.
 */
router.get('/graph/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await nyvGraphRAGLegal.getStats();
    res.json(apiResponse(stats));
  } catch (err: any) {
    res.status(500).json(apiError(err.message));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NV-DOCPIPE-MRH-001 — Redline / Merge / Highlight (real implementations; these
// previously resolved to MCP stubs pointing at non-existent endpoints).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/jrx/documents/redline
 * Body: { documentA: string, documentB: string, semantic?: boolean, jurisdiction?: string }
 * Deterministic LCS line diff (track-changes) + optional safety-ring semantic
 * material-change summary.
 */
router.post('/redline', consentGate({ purpose: 'ai_processing', triggeredBy: 'doc-orchestrator:/redline' }), async (req: Request, res: Response) => {
  try {
    const { userId, orgId } = getUser(req);
    const documentA = String(req.body?.documentA ?? '');
    const documentB = String(req.body?.documentB ?? '');
    if (!documentA || !documentB) {
      res.status(400).json(apiError('Both documentA and documentB text are required.'));
      return;
    }
    const wantSemantic = req.body?.semantic !== false;
    const { diffLines, renderUnified, semanticRedlineSummary } = await import('../services/jrx-document-redline-merge-service.js');
    const { segments, stats } = diffLines(documentA, documentB);
    const semantic = wantSemantic
      ? await semanticRedlineSummary(documentA, documentB, { jurisdiction: req.body?.jurisdiction })
      : { summary: '', materialChanges: [] };
    logger.info('document_redline', { userId, orgId, ...stats, material: semantic.materialChanges.length });
    res.json(apiResponse({
      stats,
      segments,
      unified: renderUnified(segments),
      semanticSummary: semantic.summary,
      materialChanges: semantic.materialChanges,
    }, { mode: wantSemantic ? 'diff+semantic' : 'diff' }));
  } catch (err: any) {
    logger.error('document_redline_failed', { err: err?.message });
    res.status(500).json(apiError(err.message));
  }
});

/**
 * POST /api/jrx/documents/merge
 * Body: { documents: [{ title?, text }], dedupeClauses?: boolean }
 * Deterministic structured merge with clause dedupe + conflict detection.
 */
router.post('/merge', consentGate({ purpose: 'ai_processing', triggeredBy: 'doc-orchestrator:/merge' }), async (req: Request, res: Response) => {
  try {
    const { userId, orgId } = getUser(req);
    const docs = Array.isArray(req.body?.documents) ? req.body.documents : [];
    const cleaned = docs
      .map((d: any) => ({ title: d?.title ? String(d.title) : undefined, text: String(d?.text ?? '') }))
      .filter((d: any) => d.text.trim().length > 0);
    if (cleaned.length < 2) {
      res.status(400).json(apiError('Provide at least two documents (each with non-empty text) to merge.'));
      return;
    }
    const { mergeDocuments } = await import('../services/jrx-document-redline-merge-service.js');
    const result = mergeDocuments(cleaned, { dedupeClauses: req.body?.dedupeClauses });
    logger.info('document_merge', { userId, orgId, docs: cleaned.length, conflicts: result.conflicts.length, deduped: result.dedupedCount });
    res.json(apiResponse(result));
  } catch (err: any) {
    logger.error('document_merge_failed', { err: err?.message });
    res.status(500).json(apiError(err.message));
  }
});

/**
 * POST /api/jrx/documents/highlight
 * Body: { text: string, documentType?: string, pageCount?: number }
 * Analyzes the document (risks / clauses / privacy / missing terms) and maps
 * findings to character-offset highlight spans for inline rendering.
 */
router.post('/highlight', consentGate({ purpose: 'ai_processing', triggeredBy: 'doc-orchestrator:/highlight' }), async (req: Request, res: Response) => {
  try {
    const { userId, orgId } = getUser(req);
    const text = String(req.body?.text ?? '');
    if (!text || text.trim().length < 20) {
      res.status(400).json(apiError('Document text (min 20 chars) is required.'));
      return;
    }
    const pageCount = Number(req.body?.pageCount ?? Math.max(1, Math.ceil(text.length / 3000)));
    const { analyzeDocument } = await import('../services/legal-doc-analyze-service.js');
    const { computeHighlightSpans } = await import('../services/jrx-document-redline-merge-service.js');
    const analysis = await analyzeDocument(
      text,
      pageCount,
      { assessRisks: true, extractClauses: true, findMissingTerms: true, detectPrivacyAlerts: true },
      orgId,
    );
    const highlights = computeHighlightSpans(text, analysis);
    logger.info('document_highlight', { userId, orgId, highlights: highlights.length, risks: analysis?.risks?.length ?? 0 });
    res.json(apiResponse({
      documentType: analysis?.documentType,
      riskDistribution: analysis?.riskDistribution,
      confidenceScore: analysis?.confidenceScore,
      highlights,
      risks: analysis?.risks ?? [],
      clauses: analysis?.clauses ?? [],
      privacyAlerts: analysis?.privacyAlerts ?? [],
      missingTerms: analysis?.missingTerms ?? [],
    }));
  } catch (err: any) {
    logger.error('document_highlight_failed', { err: err?.message });
    res.status(500).json(apiError(err.message));
  }
});

export default router;
export { router as documentOrchestratorRouter };
