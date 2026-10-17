// /api/nv5/compliance/eu-ai-act/* — read-only EU AI Act compliance
// document generation. All generators are deterministic data lookups
// (no LLM calls). Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { nvEuAiActService } from '../../../services/compliance/jrx-eu-ai-act-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-eu-ai-act',
    articles: ['Article 9 — Risk Management', 'Article 10 — Data Governance',
               'Article 11 — Technical Documentation', 'Article 13 — Explainability',
               'Article 14 — Human Oversight', 'Article 15 — Bias Audit'],
    documents: ['risk-management', 'data-governance', 'technical-doc', 'explainability-log',
                'human-oversight', 'bias-audit', 'full-compliance-report'],
  });
});

router.get('/report', requireSdkKeyOnly, requireScope('admin'), async (_req: Request, res: Response) => {
  try {
    const report = await nvEuAiActService.generateFullEuComplianceReport();
    res.json({ success: true, report });
  } catch (e) { safeError(res, e); }
});

router.get('/agent/:agentId/risk-management', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const doc = await nvEuAiActService.generateRiskManagementDoc(String(req.params.agentId));
    res.json({ success: true, document: doc });
  } catch (e) { safeError(res, e); }
});

router.get('/agent/:agentId/bias-audit', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const doc = await nvEuAiActService.generateBiasAuditReport(String(req.params.agentId));
    res.json({ success: true, report: doc });
  } catch (e) { safeError(res, e); }
});

export default router;
