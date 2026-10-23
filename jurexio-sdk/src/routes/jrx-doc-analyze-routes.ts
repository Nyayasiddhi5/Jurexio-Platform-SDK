// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX-SVC-DOCAI Routes — /api/jrx/doc-analyze/*
 */

import { Router, Request, Response } from 'express';
import { legalDocAnalyzeService, type DocAnalysisOptions } from '../services/legal-doc-analyze-service.js';
import { authenticateToken as authenticate } from '../middleware/auth.js';
import { nyvDocIntelligence } from '../services/jrx-document-intelligence-orchestrator.js';
import { createLogger } from '../utils/logger.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';

const docAnalyzeLogger = createLogger('doc-analyze');

// T004: All document uploads go through the async job queue (jrx-document-intelligence-orchestrator).
// This ensures consistent job tracking, embeddings, and observability for ALL documents.
// The SYNC_MAX_BYTES limit has been removed — ALL uploads are async.
const SYNC_MAX_BYTES = 0; // T004: force all uploads to async queue

const router = Router();
router.use(authenticate as any);

// ── POST /api/jrx/doc-analyze/extract ─────────────────────────────────────────
// Body: { fileBase64: string, fileName: string }
// Returns extracted text + page count + word count
// T004: Large files (>5MB) are redirected to the async job queue.
router.post('/extract', consentGate({ purpose: 'document_storage', triggeredBy: 'doc-analyze:/extract' }), async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const { fileBase64, fileName } = req.body;
    if (!fileBase64 || !fileName) {
      res.status(400).json({ success: false, message: 'fileBase64 and fileName are required.' });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    // T004 — Large-file guard: enqueue via orchestrator for files > 5MB
    if (buffer.length > SYNC_MAX_BYTES) {
      const result = await nyvDocIntelligence.ingest({
        fileBuffer: buffer,
        fileName,
        fileSizeBytes: buffer.length,
        mimeType: fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        userId: String(user?.id ?? 'anon'),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
        orgId: String(user?.orgId ?? user?.org_id ?? '1'),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        platform: String(user?.platform ?? 'nv'),
        customMetadata: { source: 'doc-analyze-legacy-extract', asyncMode: 'true' },
      });
      res.status(202).json({
        success: true,
        async: true,
        message: `File (${(buffer.length / 1024 / 1024).toFixed(1)} MB) exceeds 5 MB sync limit — queued for async processing`,
        docId: result.docId,
        jobId: result.jobId,
        statusUrl: `/api/jrx/documents/${result.docId}/status`,
      });
      return;
    }

    const ext = fileName.toLowerCase().split('.').pop();

    let result;
    if (ext === 'pdf') {
      result = await legalDocAnalyzeService.extractTextFromPDF(buffer);
    } else if (ext === 'docx' || ext === 'doc') {
      result = await legalDocAnalyzeService.extractTextFromDOCX(buffer);
    } else {
      res.status(400).json({ success: false, message: 'Unsupported file format. Use PDF or DOCX.' });
      return;
    }

    res.json({
      success: true,
      text: result.text,
      pageCount: result.pageCount,
      wordCount: result.wordCount,
      format: result.format,
      extractionMethod: result.extractionMethod,
    });
  } catch (err: any) {
    docAnalyzeLogger.error({ err: err.message }, '[DOC-ANALYZE] /extract error');
    res.status(500).json({ success: false, message: 'Document extraction failed.', error: err.message });
  }
});

// ── POST /api/jrx/doc-analyze/analyze ─────────────────────────────────────────
// Body: { text: string, pageCount?: number, options?: DocAnalysisOptions }
// Returns full DocAnalysisResult
router.post('/analyze', consentGate({ purpose: 'ai_processing', triggeredBy: 'doc-analyze:/analyze' }), async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { text, pageCount = 1, options = {} } = req.body;

    if (!text || text.length < 50) {
      res.status(400).json({ success: false, message: 'Document text is required (minimum 50 characters).' });
      return;
    }

    const analysisOptions: DocAnalysisOptions = {
      generateSummary: options.generateSummary !== false,
      extractClauses: options.extractClauses !== false,
      identifyObligations: options.identifyObligations !== false,
      assessRisks: options.assessRisks !== false,
      findMissingTerms: options.findMissingTerms !== false,
      detectPrivacyAlerts: options.detectPrivacyAlerts !== false,
    };

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const result = await legalDocAnalyzeService.analyzeDocument(text, pageCount, analysisOptions, orgId);

    res.json({ success: true, analysis: result });
  } catch (err: any) {
    docAnalyzeLogger.error({ err: err.message }, '[DOC-ANALYZE] /analyze error');
    res.status(500).json({ success: false, message: 'Document analysis failed.', error: err.message });
  }
});

// ── POST /api/jrx/doc-analyze/extract-and-analyze ─────────────────────────────
// Convenience: extract + analyze in one call
// Body: { fileBase64: string, fileName: string, options?: DocAnalysisOptions }
// T004: Large files (>5MB) are redirected to async job queue.
router.post('/extract-and-analyze', consentGate({ purpose: 'ai_processing', triggeredBy: 'doc-analyze:/extract-and-analyze' }), async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    const { fileBase64, fileName, options = {} } = req.body;

    if (!fileBase64 || !fileName) {
      res.status(400).json({ success: false, message: 'fileBase64 and fileName are required.' });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');

    // T004 — Large-file guard
    if (buffer.length > SYNC_MAX_BYTES) {
      const queued = await nyvDocIntelligence.ingest({
        fileBuffer: buffer,
        fileName,
        fileSizeBytes: buffer.length,
        mimeType: fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        userId: String(user?.id ?? 'anon'),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2551)
        orgId: String(user?.orgId ?? user?.org_id ?? '1'),
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        platform: String(user?.platform ?? 'nv'),
        customMetadata: {
          source: 'doc-analyze-legacy-extract-analyze',
          asyncMode: 'true',
          analysisOptions: JSON.stringify(options ?? {}),
        },
      });
      res.status(202).json({
        success: true,
        async: true,
        message: `File (${(buffer.length / 1024 / 1024).toFixed(1)} MB) exceeds 5 MB sync limit — queued for full RAG indexing + analysis`,
        docId: queued.docId,
        jobId: queued.jobId,
        statusUrl: `/api/jrx/documents/${queued.docId}/status`,
      });
      return;
    }

    const ext = fileName.toLowerCase().split('.').pop();

    let extraction;
    if (ext === 'pdf') {
      extraction = await legalDocAnalyzeService.extractTextFromPDF(buffer);
    } else if (ext === 'docx' || ext === 'doc') {
      extraction = await legalDocAnalyzeService.extractTextFromDOCX(buffer);
    } else {
      res.status(400).json({ success: false, message: 'Unsupported file format. Use PDF or DOCX.' });
      return;
    }

    if (!extraction.text || extraction.text.length < 50) {
      res.status(422).json({ success: false, message: 'Could not extract meaningful text from document. It may be a scanned/image-based PDF — please use Vision AI OCR instead.' });
      return;
    }

    const analysis = await legalDocAnalyzeService.analyzeDocument(
      extraction.text, extraction.pageCount,
      { generateSummary: true, extractClauses: true, identifyObligations: true, assessRisks: true, findMissingTerms: true, detectPrivacyAlerts: true, ...options },
      // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
      orgId
    );

    res.json({
      success: true,
      extraction: { pageCount: extraction.pageCount, wordCount: extraction.wordCount, format: extraction.format },
      analysis,
    });
  } catch (err: any) {
    docAnalyzeLogger.error({ err: err.message }, '[DOC-ANALYZE] /extract-and-analyze error');
    res.status(500).json({ success: false, message: 'Extract-and-analyze failed.', error: err.message });
  }
});

// ── GET /api/jrx/doc-analyze/stats ────────────────────────────────────────────
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    const orgId = user?.orgId || user?.organizationId || 'default';
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const stats = await legalDocAnalyzeService.getAnalysisStats(orgId);
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch stats.', error: err.message });
  }
});

// ── GET /api/jrx/doc-analyze/checklist ────────────────────────────────────────
router.get('/checklist', async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, checklist: legalDocAnalyzeService.STANDARD_LEGAL_CHECKLIST, total: legalDocAnalyzeService.STANDARD_LEGAL_CHECKLIST.length });
});

export default router;
