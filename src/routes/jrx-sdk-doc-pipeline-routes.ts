// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { nvAiCreditCap } from '../middleware/jrx-ai-credit-cap-middleware.js';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { guardrailEnforcementMiddleware, responseGuardrailMiddleware } from '../middleware/guardrails-enforcement.js';
import { sdkDocumentPipelineService } from '../services/sdk/sdk-document-pipeline-service.js';
import { extractCourtDocumentFields, buildCourtDocFieldBlock } from '../services/jrx-court-document-fields.js';
import { resolveIngestBytes, toCourtDocExtractOptions } from '../services/jrx-docparse-ingest-helper.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { extractDocumentText } from '../services/sdk/jrx-doc-content-extractor.js';

function checkScope(scopes: string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(required);
}

function buildCtx(req: Request): any {
  const ctx = req.sdkContext!;
  return {
    applicationId: ctx.applicationId,
    organizationId: ctx.organizationId,
    apiKeyId: ctx.apiKeyId,
    appName: ctx.appName,
    jurisdiction: ctx.jurisdiction,
    requestId: `req_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
  };
}

const router = Router();

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
/* NV-PARTNER-INDIA-SCOPE-001 (doc-pipeline) — same reasoning as the gateway router:
 * NSP/NYM are India-only, and this router serves the `/documents/analyze` alias NSP
 * actually calls. After auth because it reads `req.sdkContext`; no-op for non-India
 * partners. */
router.use(partnerIndiaScopeMiddleware);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);

// Task #217: pre-flight DPDPA consent gate. The SDK doc-pipeline
// surface is the entry point most likely to process customer
// personal data via the SDK (parse / analyze / embeddings / compare
// / summarize / suggest / compliance-check). Mount once at router
// level so every doc-pipeline route gets a `checkConsent` call —
// breaches land in the CAM reviewer queue, mode is observation
// unless NV_DPDPA_CONSENT_ENFORCE=1.
router.use(consentGate({ purpose: 'ai_processing', triggeredBy: 'sdk-doc-pipeline' }));

/* NV-CREDIT-UNIVERSAL-001 — pre-spend cap, applied per-route rather than via
 * router.use.
 *
 * Deliberate: a router-level cap would also refuse the deterministic reads in this
 * router (`/documents/templates`, `/clauses/library`, `/clauses/:id`) once a budget
 * was exhausted. Those spend nothing, so refusing them would degrade a partner
 * flow to close a gap that does not exist on those paths. */
const docPipelineCap = nvAiCreditCap({ agentKey: 'sdk:docs-pipeline', completionAllowance: 4_096 });
/* NV-CREDIT-COST-DIM-001 — money-metered, not token-metered: see
 * nv-aux-cost-estimator.ts. Observe mode, same as the token caps above. */
const docPipelineEmbeddingsCap = nvAiCreditCap({
  agentKey: 'sdk:docs-pipeline/embeddings',
  costDriver: 'embedding_tokens',
});

router.post('/documents/extract', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:write' });
    return;
  }
  const { content, base64, fileName, mimeType } = req.body;
  if (!content && !base64) {
    res.status(400).json({ success: false, error: 'Missing required field: content (text) or base64 (PDF/image/binary)' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.extractContent({ content, base64, fileName, mimeType });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(422).json({ success: false, error: error?.message || 'Failed to extract document text' });
  }
});

router.post('/documents/pipeline', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:write' });
    return;
  }
  const { content, base64, fileName, mimeType, jurisdiction, language, includeDraft, documents } = req.body;
  if (!content && !base64 && !(Array.isArray(documents) && documents.length > 0)) {
    res.status(400).json({ success: false, error: 'Missing required field: content, base64, or documents[]' });
    return;
  }
  try {
    const ingestCtx = resolveIngestBytes(req.body);
    const result = await sdkDocumentPipelineService.runFullPipeline(
      { content, base64, fileName, mimeType, jurisdiction: jurisdiction || ctx.jurisdiction || 'IN', language: language || 'en', includeDraft: Boolean(includeDraft), documents: ingestCtx.batch.length > 1 ? ingestCtx.batch.map((d) => ({ base64: d.bytes.toString('base64'), fileName: d.fileName, mimeType: d.mimeType })) : undefined },
      buildCtx(req),
      toCourtDocExtractOptions(ingestCtx, { batchId: `pipe_${Date.now()}`, actor: `sdk:${ctx.applicationId}` }),
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(422).json({ success: false, error: error?.message || 'Document pipeline failed' });
  }
});

router.post('/documents/parse', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:write' });
    return;
  }
  const body = req.body || {};
  const { content, format, jurisdiction, language } = body;
  const effectiveJurisdiction = jurisdiction || ctx.jurisdiction || 'IN';
  const ingestCtx = resolveIngestBytes(body);

  /* NV-DOCPARSE-PARSE-BINARY-001 — binary upload → Platform SDK (same engine as analyze).
   * Text-only + format → legacy LLM sectioning (no docparseMeta). Partners filing autofill
   * should prefer analyze or docparse jobs; this path keeps parse callers unbroken. */
  if (ingestCtx.primary?.bytes?.length) {
    try {
      const extracted = await extractDocumentText({
        base64: ingestCtx.primary.bytes.toString('base64'),
        fileName: ingestCtx.primary.fileName,
        mimeType: ingestCtx.primary.mimeType,
      });
      const extractOpts = {
        ...toCourtDocExtractOptions(ingestCtx, {
          batchId: `parse_${Date.now()}`,
          actor: `sdk:${ctx.applicationId}`,
        }),
        domainPackId: typeof body.domainPackId === 'string' ? body.domainPackId : undefined,
        forceOcr: body.forceOcr === true,
        preferOcr: body.preferOcr === true,
        maxPagesPerDoc:
          typeof body.maxPagesPerDoc === 'number' && body.maxPagesPerDoc > 0
            ? Math.min(body.maxPagesPerDoc, 400)
            : undefined,
      };
      const courtExtraction = await extractCourtDocumentFields(
        extracted.text,
        effectiveJurisdiction,
        extractOpts,
      );
      res.json({
        success: true,
        data: {
          parseMode: 'docparse-deterministic',
          format: extracted.format || 'pdf',
          jurisdiction: effectiveJurisdiction,
          language: language || 'en',
          extraction: extracted,
          ...buildCourtDocFieldBlock(courtExtraction, null, null),
          recommendedEndpoint:
            'For LLM obligations/risks use POST /documents/analyze; async OCR use POST /api/jrx/v1/sdk/docparse/jobs',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      res.status(422).json({
        success: false,
        error: sanitizeErrorForClient(error?.message || 'Deterministic parse failed'),
      });
    }
    return;
  }

  if (!content || typeof content !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Missing required field: content (text) or base64 (PDF/image for deterministic parse)',
    });
    return;
  }
  if (!format || typeof format !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: format' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.parseDocument(
      content, format, effectiveJurisdiction, language || 'en', buildCtx(req)
    );
    res.json({
      success: true,
      data: {
        ...result,
        parseMode: 'llm-structure',
        docparseMeta: null,
        recommendedEndpoint:
          'Filing autofill: POST /documents/analyze with base64, or POST /api/jrx/v1/sdk/docparse/jobs',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to parse document' });
  }
});

async function handleDocumentIntelligence(req: Request, res: Response): Promise<void> {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const body = req.body || {};
  const documentText =
    (typeof body.documentText === 'string' && body.documentText) ||
    (typeof body.content === 'string' && body.content) ||
    (typeof body.text === 'string' && body.text) ||
    '';
  if (!documentText || typeof documentText !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Missing required field: documentText (aliases: content, text)',
      code: 'DOCUMENT_TEXT_REQUIRED',
      retryable: false,
    });
    return;
  }
  const trimmed = documentText.trim();
  if (trimmed.length < 20 || /^(document[_-]?pending|pending|null|undefined)$/i.test(trimmed)) {
    res.status(400).json({
      success: false,
      error: 'Document text is empty or still pending. Wait for parse/ingest to finish, then retry analysis.',
      code: 'DOCUMENT_TEXT_PENDING_OR_EMPTY',
      retryable: true,
    });
    return;
  }
  const ingestCtx = resolveIngestBytes(body);
  const extractOpts = {
    ...toCourtDocExtractOptions(ingestCtx, {
      batchId: `docpipe_${Date.now()}`,
      actor: `sdk:${ctx.applicationId}`,
    }),
    domainPackId: typeof body.domainPackId === 'string' ? body.domainPackId : undefined,
    forceOcr: body.forceOcr === true,
    preferOcr: body.preferOcr === true,
    maxPagesPerDoc:
      typeof body.maxPagesPerDoc === 'number' && body.maxPagesPerDoc > 0
        ? Math.min(body.maxPagesPerDoc, 400)
        : undefined,
  };
  try {
    const result = await sdkDocumentPipelineService.analyzeDocument(
      documentText,
      body.jurisdiction || ctx.jurisdiction || 'IN',
      body.analysisTypes || ['obligations', 'risks', 'deadlines', 'entities'],
      buildCtx(req),
    );

    /* NV-COURT-DOC-FIELDS-001 (parity) — this handler serves BOTH
     * `/documents/intelligence` and the `/documents/analyze` NSP alias below, and it
     * is a different handler from `/api/jrx/gateway/documents/analyze`. Adding the
     * structured fields only to the gateway route left the alias returning
     * obligations/risks/entities with no filing metadata — which is why NSP's
     * extraction kept reporting `heuristicFallback: true` after the gateway fix
     * landed. Both `analyze` surfaces must behave identically or "we fixed it" is
     * true on one path and false on the one the partner actually calls.
     *
     * Additive and fail-soft, exactly as on the gateway route: existing keys are
     * untouched and an extraction throw can never turn a working analysis into an
     * error. */
    let courtFields: Awaited<ReturnType<typeof extractCourtDocumentFields>> | null = null;
    let courtOutcome: { failed?: boolean; reason?: string } | null = null;
    try {
      courtFields = await extractCourtDocumentFields(
        documentText,
        body.jurisdiction || ctx.jurisdiction || 'IN',
        extractOpts,
      );
    } catch {
      /* NV-ANALYZE-STATUS-005 — a throw and an empty document must not both read as `[]`. */
      courtOutcome = {
        failed: true,
        reason: 'Structured field extraction failed; arrays are empty because extraction did not complete.',
      };
    }

    /* NV-ANALYZE-FLAT-ALIASES-001 — expose the arrays partners actually map.
     *
     * NSP reported "entities: [] statutes: [] deadlines: [] obligations: []" and
     * concluded the extraction was empty. Reading their mapping against our payload
     * explains it: `entities` here is a CONTAINER object
     * (`entities.entities|obligations|risks|deadlines`), so `data.entities.length` is
     * undefined, and `statutes` / `deadlines` / `obligations` never existed at the top
     * level at all — NSP was mapping a shape we do not emit, and there was no
     * `statutes` array anywhere in the contract.
     *
     * Rather than ask them to restructure a working client, the flat aliases are added
     * alongside the nested object. `statutes` is derived from the extracted
     * `statutes_invoked` field so it is a real array of citations rather than a stub.
     * The nested `entities` object is left EXACTLY as-is for existing consumers —
     * this is purely additive.
     *
     * NV-COURT-DOC-FIELDS-004: the block is now shaped by `buildCourtDocFieldBlock`
     * rather than assembled inline here. Three handlers had each built it by hand and
     * a fourth (orchestrate — the one NSP actually calls) had none; a single builder
     * is what makes "fixed on one path only" impossible to repeat. */
    const nested = ((result as Record<string, unknown>).entities || {}) as Record<string, unknown[]>;

    res.json({
      success: true,
      data: {
        ...(result as Record<string, unknown>),
        ...buildCourtDocFieldBlock(courtFields, nested, courtOutcome),
      },
    });
  } catch (error: any) {
    /* Last-resort fail-soft for NSP Pro ai-summary — never opaque 500/503.
     *
     * NV-COURT-DOC-FIELDS-001: even here, deterministic extraction is still
     * possible — it does not depend on the LLM that just failed. Returning fields
     * on the degraded path is the difference between "AI unavailable, but you still
     * get the case number and parties" and a badge that reads Heuristic. */
    let degradedFields: Awaited<ReturnType<typeof extractCourtDocumentFields>> | null = null;
    try {
      degradedFields = await extractCourtDocumentFields(
        documentText,
        body.jurisdiction || ctx.jurisdiction || 'IN',
        extractOpts,
      );
    } catch {
      /* nothing more to try */
    }
    res.status(200).json({
      success: true,
      data: {
        analysisId: `intel_degraded_${Date.now()}`,
        jurisdiction: body.jurisdiction || ctx.jurisdiction || 'IN',
        analysisTypes: body.analysisTypes || ['obligations', 'risks', 'deadlines', 'entities'],
        entities: { obligations: [], risks: [], deadlines: [], entities: [] },
        /* NV-COURT-DOC-FIELDS-004 — same builder as the happy path, so the degraded
         * response carries the flat aliases too. Previously this branch emitted
         * `fields`/`fieldSource` but NOT `statutes`/`entitiesFlat`/…, so a client
         * mapping the aliases would break precisely when the LLM was already down.
         *
         * NV-ANALYZE-STATUS-005 — this branch is reached only because the analyzer
         * threw, so it is `failed` by construction even when deterministic extraction
         * salvaged some fields. This is the response NSP could not distinguish from a
         * clean empty result, and it is the one they most need to retry. */
        ...buildCourtDocFieldBlock(degradedFields, null, {
          failed: true,
          reason: sanitizeErrorForClient(error?.message || 'Document analysis failed'),
        }),
        degraded: true,
        degradeReason: error?.message || 'Failed to analyze document',
        summary: {
          totalObligations: 0,
          totalRisks: 0,
          totalDeadlines: 0,
          totalEntities: 0,
          overallRiskLevel: 'unknown',
          confidence: 0.2,
          note: 'Analysis degraded; retry after parse text is confirmed.',
        },
        timestamp: new Date().toISOString(),
      },
    });
  }
}

router.post('/documents/intelligence', docPipelineCap, handleDocumentIntelligence);
/** NSP alias — some Pro clients call /analyze instead of /intelligence. */
router.post('/documents/analyze', docPipelineCap, handleDocumentIntelligence);

router.post('/documents/embeddings', docPipelineEmbeddingsCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const { documents, model } = req.body;
  if (!documents || !Array.isArray(documents) || documents.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required field: documents (non-empty array of { id, content })' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.generateEmbeddings(documents, model || 'text-embedding-3-small', buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate embeddings' });
  }
});

router.post('/documents/compare', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const { documentA, documentB, compareTypes } = req.body;
  if (!documentA || !documentB) {
    res.status(400).json({ success: false, error: 'Missing required fields: documentA, documentB' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.compareDocuments(
      documentA, documentB, compareTypes || ['text', 'structure', 'clauses'], buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to compare documents' });
  }
});

router.post('/documents/summarize', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const { documentText, jurisdiction, length } = req.body;
  if (!documentText || typeof documentText !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: documentText' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.summarizeDocument(
      documentText, jurisdiction || ctx.jurisdiction || 'IN', length || 'medium', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to summarize document' });
  }
});

router.get('/documents/templates', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.getTemplates(
      (req.query.jurisdiction as string) || ctx.jurisdiction || 'IN', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch templates' });
  }
});

router.get('/clauses/library', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const result = await sdkDocumentPipelineService.getClauseLibrary(
      (req.query.jurisdiction as string) || ctx.jurisdiction || 'IN',
      req.query.category as string | undefined,
      page, limit, buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch clause library' });
  }
});

router.get('/clauses/:clauseId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.getClauseDetail(String(req.params.clauseId), buildCtx(req));
    if (!result) {
      res.status(404).json({ success: false, error: `Clause '${req.params.clauseId}' not found` });
      return;
    }
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch clause detail' });
  }
});

router.post('/clauses/suggest', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const { documentContext, jurisdiction, contractType } = req.body;
  if (!documentContext || typeof documentContext !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: documentContext' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.suggestClauses(
      documentContext, jurisdiction || ctx.jurisdiction || 'IN', contractType || 'general', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to suggest clauses' });
  }
});

router.post('/documents/compliance-check', docPipelineCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }
  const { documentText, jurisdiction, frameworks } = req.body;
  if (!documentText || typeof documentText !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: documentText' });
    return;
  }
  try {
    const result = await sdkDocumentPipelineService.complianceCheck(
      documentText, jurisdiction || ctx.jurisdiction || 'IN', frameworks || ['GDPR', 'DPDP'], buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to run compliance check' });
  }
});

export default router;
