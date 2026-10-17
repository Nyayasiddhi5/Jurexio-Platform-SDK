/**
 * NV-DOCPARSE-SDK-ROUTES-001 — async docparse jobs (Platform SDK, dev flag).
 */
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import {
  getDocparseSdkJob,
  submitDocparseSdkJob,
} from '../services/jrx-docparse-sdk-job-service.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { respondDocparseRouteError } from '../services/jrx-docparse-route-errors.js';

const router = Router();

/** Public mount probe — no job payload; feature flags only (NV-SECRETS-001). */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: isJrxFeatureOn('docparseSdk') ? 'ok' : 'disabled',
      docparseSdk: isJrxFeatureOn('docparseSdk'),
      docparseJobs: isJrxFeatureOn('docparseJobs'),
      textractPage: isJrxFeatureOn('textractOcr') || isJrxFeatureOn('docparseTextractPage'),
      llmFallback: isJrxFeatureOn('docparseLlmFallback'),
      evidenceDepict: isJrxFeatureOn('docparseEvidenceDepict'),
      attachUnderstand: isJrxFeatureOn('docparseAttachUnderstand'),
    },
  });
});

router.use(sdkGatewayAuth);
router.use(tenantIsolation);

function sdkDisabled(_req: Request, res: Response): boolean {
  if (!isJrxFeatureOn('docparseSdk')) {
    res.status(503).json({
      success: false,
      error: 'Docparse Platform SDK is disabled. Set JRX_F_DOCPARSE_SDK=1 on dev.',
      code: 'DOCPARSE_SDK_DISABLED',
    });
    return true;
  }
  return false;
}

function decodeFiles(body: Record<string, unknown>): Array<{ bytes: Buffer; fileName: string; mimeType?: string }> {
  const docs = body.documents;
  if (Array.isArray(docs) && docs.length > 0) {
    return docs.slice(0, 8).map((d: { base64?: string; fileName?: string; mimeType?: string }, i: number) => ({
      bytes: Buffer.from(String(d.base64 || ''), 'base64'),
      fileName: d.fileName || `document-${i + 1}.pdf`,
      mimeType: d.mimeType,
    }));
  }
  const base64 = body.base64;
  if (typeof base64 === 'string' && base64.length > 0) {
    return [{
      bytes: Buffer.from(base64, 'base64'),
      fileName: typeof body.fileName === 'string' ? body.fileName : 'upload.pdf',
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
    }];
  }
  return [];
}

router.post('/jobs', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const files = decodeFiles(req.body as Record<string, unknown>);
  if (files.length === 0 || files.every((f) => f.bytes.length === 0)) {
    res.status(400).json({ success: false, error: 'Provide base64 or documents[] with base64 payloads.' });
    return;
  }
  try {
    const domainPackId = typeof req.body.domainPackId === 'string' ? req.body.domainPackId : 'legal-in';
    const forceOcr = req.body.forceOcr === true;
    const preferOcr = req.body.preferOcr === true;
    const maxPagesPerDoc =
      typeof req.body.maxPagesPerDoc === 'number' && req.body.maxPagesPerDoc > 0
        ? Math.min(req.body.maxPagesPerDoc, 400)
        : undefined;
    const batchId = `sdk_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const jobId = await submitDocparseSdkJob({
      files: files.map((f) => ({
        bytes: new Uint8Array(f.bytes),
        fileName: f.fileName,
        mime: f.mimeType,
      })),
      run: {
        batchId,
        actor: 'nyv:docparse-sdk-api',
        domainPackId,
        forceOcr,
        preferOcr,
        maxPagesPerDoc,
      },
      domainPackId,
    });
    res.status(202).json({ success: true, data: { jobId, status: 'queued', batchId } });
  } catch (e) {
    res.status(422).json({ success: false, error: sanitizeErrorForClient(e) });
  }
});

/** NSP-only: onboarding KYC / firm cert → autofill JSON (OCR + partial LLM on JRX). */
router.post('/nsp/onboarding-extract', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const platform = String(req.headers['x-jrx-platform'] ?? req.headers['x-jrx-app'] ?? '').toLowerCase();
  if (platform !== 'nsp' && platform !== 'nsp-pro') {
    res.status(403).json({
      success: false,
      code: 'NSP_ONBOARDING_EXTRACT_PLATFORM',
      error: 'Set X-JRX-Platform: nsp or nsp-pro.',
    });
    return;
  }
  const files = decodeFiles(req.body as Record<string, unknown>);
  if (files.length === 0 || files[0]!.bytes.length === 0) {
    res.status(400).json({ success: false, error: 'Provide base64 or documents[] with file bytes.' });
    return;
  }
  try {
    const body = req.body as Record<string, unknown>;
    const { runNspOnboardingExtract } = await import('../services/jrx-docparse-nsp-onboarding-extract-service.js');
    const data = await runNspOnboardingExtract({
      bytes: files[0]!.bytes,
      fileName: files[0]!.fileName,
      mimeType: files[0]!.mimeType,
      jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction : 'IN',
      ingestRole: typeof body.ingestRole === 'string' ? body.ingestRole : undefined,
      documentHint: typeof body.documentHint === 'string' ? body.documentHint : undefined,
      actor: 'nyv:nsp-onboarding-extract-api',
    });
    res.json({ success: true, data });
  } catch (e) {
    respondDocparseRouteError(res, e);
  }
});

/** NSP-only: AI-assisted gap recovery when local docparse could not read pages / map fields. */
router.post('/nsp/agent-recover', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const platform = String(req.headers['x-jrx-platform'] ?? req.headers['x-jrx-app'] ?? '').toLowerCase();
  if (platform !== 'nsp' && platform !== 'nsp-pro') {
    res.status(403).json({
      success: false,
      code: 'NSP_AGENT_RECOVER_PLATFORM',
      error: 'This endpoint is for NSP gap recovery only. Set X-JRX-Platform: nsp.',
    });
    return;
  }
  const files = decodeFiles(req.body as Record<string, unknown>);
  if (files.length === 0 || files[0]!.bytes.length === 0) {
    res.status(400).json({ success: false, error: 'Provide base64 (same document NSP failed to parse locally).' });
    return;
  }
  try {
    const { runNspDocparseAgentRecover } = await import('../services/jrx-docparse-nsp-agent-recover-service.js');
    const body = req.body as Record<string, unknown>;
    const data = await runNspDocparseAgentRecover({
      bytes: files[0]!.bytes,
      fileName: files[0]!.fileName,
      mimeType: files[0]!.mimeType,
      domainPackId: typeof body.domainPackId === 'string' ? body.domainPackId : 'legal-in-civil',
      jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction : 'IN',
      localParse: typeof body.localParse === 'object' && body.localParse ? (body.localParse as Record<string, unknown>) as import('../services/jrx-docparse-nsp-agent-recover-service.js').NspLocalParseHints : undefined,
      options: typeof body.options === 'object' && body.options ? (body.options as import('../services/jrx-docparse-nsp-agent-recover-service.js').NspAgentRecoverOptions) : undefined,
      actor: 'nyv:nsp-agent-recover-api',
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(422).json({ success: false, error: sanitizeErrorForClient(e) });
  }
});

/** NSP-only: vision depiction for case photos / imaging when user asks what this shows. */
router.post('/nsp/evidence-depict', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const platform = String(req.headers['x-jrx-platform'] ?? req.headers['x-jrx-app'] ?? '').toLowerCase();
  if (platform !== 'nsp' && platform !== 'nsp-pro') {
    res.status(403).json({
      success: false,
      code: 'NSP_EVIDENCE_DEPICT_PLATFORM',
      error: 'This endpoint is for NSP evidence depiction only. Set X-JRX-Platform: nsp.',
    });
    return;
  }
  const files = decodeFiles(req.body as Record<string, unknown>);
  if (files.length === 0 || files[0]!.bytes.length === 0) {
    res.status(400).json({ success: false, error: 'Provide base64 image or document page.' });
    return;
  }
  try {
    const { runNspEvidenceDepict } = await import('../services/jrx-docparse-nsp-evidence-depict-service.js');
    const body = req.body as Record<string, unknown>;
    const data = await runNspEvidenceDepict({
      bytes: files[0]!.bytes,
      fileName: files[0]!.fileName,
      mimeType: files[0]!.mimeType,
      pageNo: typeof body.pageNo === 'number' ? body.pageNo : undefined,
      localVisibleText: typeof body.localVisibleText === 'string' ? body.localVisibleText : undefined,
      userQuestion: typeof body.userQuestion === 'string' ? body.userQuestion : undefined,
      jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction : 'IN',
      actor: 'nyv:nsp-evidence-depict-api',
    });
    res.json({ success: true, data });
  } catch (e) {
    respondDocparseRouteError(res, e);
  }
});

/** NSP-only: prompt-only attach understanding when local parse is partial (draft/chat). */
router.post('/nsp/attach-understand', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const platform = String(req.headers['x-jrx-platform'] ?? req.headers['x-jrx-app'] ?? '').toLowerCase();
  if (platform !== 'nsp' && platform !== 'nsp-pro') {
    res.status(403).json({
      success: false,
      code: 'NSP_ATTACH_UNDERSTAND_PLATFORM',
      error: 'This endpoint is for NSP attach understanding only. Set X-JRX-Platform: nsp.',
    });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const userPrompt = typeof body.userPrompt === 'string' ? body.userPrompt : typeof body.prompt === 'string' ? body.prompt : '';
  if (!userPrompt.trim()) {
    res.status(400).json({ success: false, error: 'Provide userPrompt (or prompt).' });
    return;
  }
  const attachContext =
    typeof body.attachContext === 'object' && body.attachContext
      ? (body.attachContext as import('../services/jrx-docparse-nsp-attach-understand-service.js').NspAttachContextInput)
      : {};
  try {
    const { runNspAttachUnderstand } = await import('../services/jrx-docparse-nsp-attach-understand-service.js');
    const data = await runNspAttachUnderstand({
      userPrompt,
      attachContext,
      jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction : 'IN',
      matterSummary: typeof body.matterSummary === 'string' ? body.matterSummary : undefined,
      actor: 'nyv:nsp-attach-understand-api',
    });
    res.json({ success: true, data });
  } catch (e) {
    respondDocparseRouteError(res, e);
  }
});

router.get('/packs', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  try {
    const { listDomainPacks } = await import('@jurexio/docparse-sdk');
    res.json({ success: true, data: { packs: listDomainPacks() } });
  } catch (e) {
    res.status(500).json({ success: false, error: sanitizeErrorForClient(e) });
  }
});

/** NSP bulk corpus — up to 5 documents per batch item, 8 batch items per request. */
router.post('/jobs/batch', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const batches = req.body?.batches;
  if (!Array.isArray(batches) || batches.length === 0) {
    res.status(400).json({ success: false, error: 'Provide batches[] with { documents[] | base64 } per item.' });
    return;
  }
  try {
    const domainPackId = typeof req.body.domainPackId === 'string' ? req.body.domainPackId : 'legal-in';
    const jobIds: string[] = [];
    for (const item of batches.slice(0, 8)) {
      const files = decodeFiles(item as Record<string, unknown>);
      if (files.length === 0 || files.every((f) => f.bytes.length === 0)) continue;
      const batchId = `sdk_batch_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const jobId = await submitDocparseSdkJob({
        files: files.slice(0, 5).map((f) => ({
          bytes: new Uint8Array(f.bytes),
          fileName: f.fileName,
          mime: f.mimeType,
        })),
        run: {
          batchId,
          actor: 'nyv:docparse-sdk-batch',
          domainPackId,
          forceOcr: item.forceOcr === true,
          preferOcr: item.preferOcr === true,
          maxPagesPerDoc:
            typeof item.maxPagesPerDoc === 'number' && item.maxPagesPerDoc > 0
              ? Math.min(item.maxPagesPerDoc, 400)
              : undefined,
        },
        domainPackId,
      });
      jobIds.push(jobId);
    }
    if (jobIds.length === 0) {
      res.status(400).json({ success: false, error: 'No valid files in batches.' });
      return;
    }
    res.status(202).json({ success: true, data: { jobIds, count: jobIds.length } });
  } catch (e) {
    res.status(422).json({ success: false, error: sanitizeErrorForClient(e) });
  }
});

router.get('/jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
  if (sdkDisabled(req, res)) return;
  const rec = await getDocparseSdkJob(req.params.jobId);
  if (!rec) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  res.json({
    success: true,
    data: {
      jobId: rec.jobId,
      status: rec.status,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      progress: rec.progress,
      error: rec.error,
      result: rec.status === 'done' ? rec.result : undefined,
    },
  });
});

export default router;
