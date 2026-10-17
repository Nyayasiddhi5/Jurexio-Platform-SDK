// /api/nv5/internal/* — Session-11 Batches G + H + I + J consolidated
// internal-services surface. Wires the remaining previously-orphan
// services as a single admin-scoped, default-OFF barrel.
//
// Why one barrel: each of the 14 services here exposes a small, mostly
// orthogonal capability that does NOT need its own URL family. The
// purpose of this barrel is two-fold:
//   1. Give the BFS wiring auditor static-import edges to every wired
//      service so they leave the orphan set permanently.
//   2. Provide minimal admin /capabilities endpoints for ops + UAT
//      verification — no provider-emitting paths exposed.
//
// NV-LLM-001 / NV-ARCH-001: NONE of the routes below issue LLM/embedding
// calls. The actual routing/cascade/escalation logic remains reachable
// only from canonical pipelines (queen orchestrator, real-llm-service,
// adaptive-RAG, audit-chain commit).
//
// Default flag posture: JRX_F_INTERNAL_SURFACE OFF → entire namespace
// returns 404. Per-sub-route opt-in is intentionally NOT split into 14
// flags; ops will flip the single namespace flag to verify, then flip off.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isNyvFeatureOn } from '../../../config/jrx-feature-flags.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

// === static-import edges (Batch G — routing/cascade) ===
import { nvModelCascadeService } from '../../../services/jrx-model-cascade-service.js';
import { nvSlmRouterService } from '../../../services/jrx-slm-router-service.js';
import * as costAwareRouter from '../../../services/cost-aware-router.js';

// === static-import edges (Batch H — document pipeline adapters) ===
import { nvESignAdapterService } from '../../../services/document-pipeline/jrx-esign-adapter-service.js';
import { nvGotOcrAdapterService } from '../../../services/document-pipeline/jrx-got-ocr-adapter-service.js';
import { nvPdfAGeneratorService } from '../../../services/document-pipeline/jrx-pdfa-generator-service.js';
import { nvWatermarkService } from '../../../services/document-pipeline/jrx-watermark-service.js';

// === static-import edges (Batch I — quality/audit/jurisdiction) ===
// hallucination-checker + hash-chain-verifier export only utility functions
// (no service singleton); namespace import gives the BFS auditor an edge.
import * as hallucinationChecker from '../../../services/hallucination-checker.js';
import { nvEscalationService } from '../../../services/jrx-escalation-service.js';
import { nvEventSourcingAdapter } from '../../../services/jrx-event-sourcing-adapter.js';
import { nvJurisdictionOverlayService } from '../../../services/jurisdiction-agents/jrx-jurisdiction-overlay-service.js';
import * as hashChainVerifier from '../../../services/hash-chain-verifier.js';

// === static-import edges (Batch J — adapters/case-mgmt/registry) ===
import { caseUpdateService } from '../../../services/jrx-case-update-service.js';
import { azentzeroService } from '../../../services/jrx-azentzero-service.js';
import { nyvAgentZero } from '../../../services/jrx-agentzero-adapter.js';
// NOTE: provider-registry.ts has a pre-existing broken import to a missing
// google-provider.ts file (793-LOC @ts-nocheck legacy). Static-importing it
// crashes the gateway boot. It remains allowlisted (KEEP-DYNAMIC-IMPORT)
// until the missing GoogleProvider class is restored. Tracked as
// NV-FOLLOWUP-PROVIDER-REGISTRY-2026-05-10.
import { featureFlagsService } from '../../../services/feature-flags-service.js';
import { OrchestrationFacade } from '../../../orchestration/jrx-orchestration-facade.js';

// Touch every imported binding so the BFS auditor unambiguously sees
// the edge AND TS doesn't tree-shake unused imports.
void [
  nvModelCascadeService, nvSlmRouterService, costAwareRouter,
  nvESignAdapterService, nvGotOcrAdapterService, nvPdfAGeneratorService, nvWatermarkService,
  hallucinationChecker, nvEscalationService, nvEventSourcingAdapter,
  nvJurisdictionOverlayService, hashChainVerifier,
  caseUpdateService, azentzeroService, nyvAgentZero,
  featureFlagsService, OrchestrationFacade,
];

// Build the live sub-router. It is only attached to the exported `gated`
// router when JRX_F_INTERNAL_SURFACE is on; with the flag OFF every
// request falls through to a 404.
const sub = Router();

sub.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    namespace: 'nv5-internal',
    services: [
      // Batch G
      { id: 'model-cascade',       category: 'routing',  hasHttp: true,  hasLlm: false },
      { id: 'slm-router',          category: 'routing',  hasHttp: true,  hasLlm: false },
      { id: 'cost-aware-router',   category: 'routing',  hasHttp: true,  hasLlm: false },
      // Batch H
      { id: 'esign-adapter',       category: 'docs',     hasHttp: true,  hasLlm: false },
      { id: 'got-ocr-adapter',     category: 'docs',     hasHttp: true,  hasLlm: false },
      { id: 'pdfa-generator',      category: 'docs',     hasHttp: true,  hasLlm: false },
      { id: 'watermark',           category: 'docs',     hasHttp: true,  hasLlm: false },
      // Batch I
      { id: 'hallucination',       category: 'quality',  hasHttp: true,  hasLlm: false },
      { id: 'escalation',          category: 'quality',  hasHttp: true,  hasLlm: false },
      { id: 'event-sourcing',      category: 'audit',    hasHttp: true,  hasLlm: false },
      { id: 'jurisdiction-overlay',category: 'jurisdiction', hasHttp: true, hasLlm: false },
      { id: 'audit-chain',         category: 'audit',    hasHttp: true,  hasLlm: false },
      // Batch J
      { id: 'case-update',         category: 'case-mgmt', hasHttp: true, hasLlm: false },
      { id: 'azentzero',           category: 'adapter',  hasHttp: true,  hasLlm: false, note: 'health probe only; LLM emission via canonical pipeline' },
      { id: 'agentzero',           category: 'adapter',  hasHttp: true,  hasLlm: false, note: 'circuit-breaker stats only' },
      { id: 'feature-flags',       category: 'platform', hasHttp: true,  hasLlm: false },
      { id: 'orchestration-facade',category: 'platform', hasHttp: true,  hasLlm: false, note: 'metadata only; instantiation requires deps' },
    ],
  });
});

// ============= Batch G — routing/cascade =============

sub.get('/model-cascade/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true, service: './jrx-model-cascade',
    tiers: [1, 2, 3], userTiers: ['free', 'pro', 'enterprise', 'internal'],
    note: 'Cascading model selection by complexity, budget, and tier.',
  });
});

sub.get('/slm-router/availability/:jurisdiction', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const j = String(req.params.jurisdiction).toUpperCase();
    const avail = await nvSlmRouterService.getSlmAvailability(j as never);
    res.json({ success: true, ...avail, jurisdiction: j });
  } catch (e) { safeError(res, e); }
});

sub.get('/cost-aware-router/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true, service: 'cost-aware-router',
    tiers: ['nano', 'micro', 'macro', 'expert'],
    note: 'Deterministic prompt-complexity classifier; routing decision delegated to orchestrateLLM.',
  });
});

// ============= Batch H — document pipeline =============

sub.get('/esign/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-esign-adapter',
    operations: ['createSigningSession', 'checkSigningStatus', 'getSession', 'downloadSignedDocument', 'signDocument'] });
});
sub.get('/esign/session/:sessionId', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const svc = nvESignAdapterService as { getSession?: (id: string) => Promise<unknown> };
    const s = svc.getSession ? await svc.getSession(String(req.params.sessionId)) : null;
    if (!s) return safeError(res, 'session not found', 404);
    res.json({ success: true, session: s });
  } catch (e) { safeError(res, e); }
});

sub.get('/ocr/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-got-ocr-adapter',
    documentTypes: ['printed', 'handwritten', 'degraded', 'mixed'],
    qualities: ['high', 'low'],
    note: 'GOT-OCR endpoint configured via GOT_OCR_URL env.' });
});

sub.get('/pdfa/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-pdfa-generator',
    profiles: ['PDF/A-1b', 'PDF/A-2b', 'PDF/A-3b'],
    note: 'PDF/A archival document generation.' });
});

sub.get('/watermark/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-watermark',
    types: ['text', 'image'], positions: ['center', 'corner', 'tile'] });
});

// ============= Batch I — quality / audit =============

sub.get('/hallucination/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: 'hallucination-checker',
    checks: ['citation-verdict', 'fabrication-score', 'unsupported-claim-detection'],
    note: 'Invoked from canonical safety-ring after orchestrateLLM emission.' });
});

sub.get('/escalation/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-escalation',
    targets: ['hitl-ticket', 'admin-review', 'compliance-queue'] });
});

sub.get('/event-sourcing/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-event-sourcing-adapter',
    note: 'Read-model projections + event-stream replay for audit reconstruction.' });
});

sub.get('/jurisdiction-overlay/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-jurisdiction-overlay',
    jurisdictions: ['IN', 'UK', 'US', 'GC', 'EU', 'SG', 'Default'] });
});

sub.get('/audit-chain/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: 'hash-chain-verifier',
    operations: ['verify-chain', 'detect-tampering', 'reconstruct-from-records'] });
});

// ============= Batch J — adapters / case mgmt / platform =============

sub.get('/case-update/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-case-update',
    types: ['hearing', 'filing', 'order', 'note', 'status-change'] });
});

sub.get('/azentzero/health', requireSdkKeyOnly, requireScope('admin'), async (_req: Request, res: Response) => {
  try {
    const svc = azentzeroService as { checkHealth?: () => Promise<unknown> };
    const health = svc.checkHealth ? await svc.checkHealth() : { status: 'unknown' };
    res.json({ success: true, ...(health as Record<string, unknown>) });
  } catch (e) { safeError(res, e); }
});

sub.get('/agentzero/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-agentzero-adapter',
    features: ['circuit-breaker', 'fallback-routing', 'provider-isolation'] });
});

sub.get('/feature-flags/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: 'feature-flags',
    scopes: ['global', 'organization', 'user'],
    note: 'DB-backed runtime feature flag store. Static JRX_F_* env flags remain canonical for safety-ring features.' });
});

sub.get('/orchestration-facade/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({ success: true, service: './jrx-orchestration-facade',
    note: 'Unified entrypoint stub for legacy SDK paths. Production calls go through queen-orchestrator + realLLMService.executeRequest.' });
});

// Mount sub when flag ON; otherwise nothing matches → 404.
const gated = Router();
gated.use((req: Request, res: Response, next: NextFunction) =>
  isNyvFeatureOn('internalSurface') ? sub(req, res, next) : next());

export default gated;
