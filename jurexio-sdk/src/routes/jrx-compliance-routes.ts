// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Compliance Routes — ISO 42001 AIMS + SOC2 + EU AI Act + Bias Assessment
 * GET  /api/jrx/compliance/aims/inventory
 * GET  /api/jrx/compliance/aims/risk-register
 * GET  /api/jrx/compliance/aims/model-cards
 * GET  /api/jrx/compliance/aims/summary
 * GET  /api/jrx/compliance/soc2/evidence
 * GET  /api/jrx/compliance/evidence-pack
 * GET  /api/jrx/compliance/eu-ai-act/classifications
 * GET  /api/jrx/compliance/eu-ai-act/gap-analysis
 * GET  /api/jrx/compliance/bias/report
 * GET  /api/jrx/compliance/health
 */
import { Router, Request, Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { aimsService } from '../services/aims-ai-management-service.js';
import { soc2EvidenceService } from '../services/soc2-evidence-service.js';
import { euAiActComplianceService } from '../services/eu-ai-act-compliance-service.js';
import { createLogger } from '../utils/logger.js';
import {
  buildComplianceEvidencePack,
  type EvidenceFramework,
} from '../services/compliance/jrx-compliance-evidence-pack.js';

const router = Router();
const logger = createLogger('compliance-routes');

router.use(dualSdkOrJwt);

// ── Health ─────────────────────────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    services: ['ISO 42001 AIMS', 'SOC 2 Evidence', 'EU AI Act', 'Bias Assessment', 'DPDPA Consent'],
    status: 'operational',
    version: '3.1.2',
  });
});

// ── ISO 42001 AIMS ─────────────────────────────────────────────────────────
router.get('/aims/inventory', (_req: Request, res: Response): void => {
  res.json({ success: true, systems: aimsService.getInventory(), total: aimsService.getInventory().length });
});

router.get('/aims/risk-register', (req: Request, res: Response): void => {
  const { systemId, status } = req.query as Record<string, string>;
  const risks = aimsService.getRiskRegister({ systemId, status });
  res.json({ success: true, risks, total: risks.length });
});

router.get('/aims/model-cards', (req: Request, res: Response): void => {
  const { systemId } = req.query as Record<string, string>;
  const cards = aimsService.getModelCards(systemId);
  res.json({ success: true, modelCards: cards, total: cards.length });
});

router.get('/aims/summary', (_req: Request, res: Response): void => {
  res.json({ success: true, ...aimsService.getComplianceSummary() });
});

// ── SOC 2 Evidence ─────────────────────────────────────────────────────────
router.get('/soc2/evidence', async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to } = req.query as Record<string, string>;
    const report = await soc2EvidenceService.collectEvidence(from && to ? { from, to } : undefined);
    res.json({ success: true, report });
  } catch (err: any) {
    // Task #48 — DPDPA: do not log raw error message to avoid PII / stack-trace leak.
    // Log a stable code + sanitized class only; client gets a generic message.
    logger.error('soc2_evidence_error', { errClass: err?.name ?? 'Error', code: err?.code ?? 'UNKNOWN' });
    res.status(500).json({ error: 'Failed to collect SOC 2 evidence' });
  }
});

// ── EU AI Act ──────────────────────────────────────────────────────────────
router.get('/eu-ai-act/classifications', (_req: Request, res: Response): void => {
  res.json({ success: true, classifications: euAiActComplianceService.getAllClassifications() });
});

router.get('/eu-ai-act/classification/:systemId', (req: Request, res: Response): void => {
  const classification = euAiActComplianceService.classifySystem(String(req.params.systemId));
  if (!classification) { res.status(404).json({ error: 'System not found in classification database' }); return; }
  res.json({ success: true, classification });
});

router.get('/eu-ai-act/gap-analysis', (_req: Request, res: Response): void => {
  res.json({ success: true, ...euAiActComplianceService.getComplianceGap() });
});

// ── Bias Assessment ────────────────────────────────────────────────────────
router.get('/bias/report', (req: Request, res: Response): void => {
  const { systemId } = req.query as Record<string, string>;
  const reports = euAiActComplianceService.getBiasReport(systemId);
  res.json({ success: true, reports, total: reports.length });
});

// ── Platform evidence pack (checklists + live audit/hash/residency — not certs) ─
async function handleEvidencePack(req: Request, res: Response): Promise<void> {
  try {
    const raw =
      (req.query.frameworks as string | undefined)
      || (typeof req.body?.frameworks === 'string' ? req.body.frameworks : undefined)
      || (Array.isArray(req.body?.frameworks) ? req.body.frameworks.join(',') : undefined);
    const frameworks = raw
      ? (raw.split(',').map((s: string) => s.trim().toUpperCase()) as EvidenceFramework[])
      : undefined;
    const pack = await buildComplianceEvidencePack(frameworks);
    const packAny = pack as unknown as Record<string, unknown>;
    res.json({
      success: true,
      evidenceClass: 'platform_evidence',
      pack,
      checksum: packAny?.checksum || packAny?.digest || packAny?.packHash || undefined,
    });
  } catch (err: any) {
    logger.error('evidence_pack_error', { errClass: err?.name ?? 'Error' });
    res.status(500).json({ error: 'Failed to build platform evidence pack' });
  }
}

router.get('/evidence-pack', handleEvidencePack);
router.post('/evidence-pack', handleEvidencePack);

// ── Combined Dashboard ─────────────────────────────────────────────────────
router.get('/dashboard', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [aims, soc2, euAi] = await Promise.all([
      Promise.resolve(aimsService.getComplianceSummary()),
      soc2EvidenceService.collectEvidence(),
      Promise.resolve(euAiActComplianceService.getComplianceGap()),
    ]);

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      platformVersion: '3.1.2',
      overallScore: calculateOverallScore(aims, soc2, euAi),
      iso42001: aims,
      soc2: { status: soc2.overallStatus, passing: soc2.controlsPassing, total: soc2.controlsTotal },
      euAiAct: euAi,
      dpdpa: { status: 'implemented', framework: 'Digital Personal Data Protection Act 2023', endpoint: '/api/jrx/consent/*' },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate compliance dashboard' });
  }
});

function calculateOverallScore(aims: any, soc2: any, euAi: any): number {
  const aimsScore = aims.openRisks === 0 ? 100 : Math.max(60, 100 - aims.openRisks * 8);
  const soc2Score = Math.round((soc2.controlsPassing / Math.max(soc2.controlsTotal, 1)) * 100);
  const euScore = Math.round((euAi.obligationsFulfilled / Math.max(euAi.obligationsTotal, 1)) * 100);
  return Math.round((aimsScore + soc2Score + euScore) / 3);
}

export default router;
