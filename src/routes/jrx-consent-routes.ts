/**
 * DPDPA 2023 + GDPR Consent Management Routes
 * POST /api/jrx/consent/grant
 * POST /api/jrx/consent/withdraw
 * GET  /api/jrx/consent/status
 * GET  /api/jrx/consent/export
 * DELETE /api/jrx/consent/delete-my-data
 */
import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { consentManagementService, type ConsentPurpose } from '../services/consent-management-service.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('consent-routes');

const VALID_PURPOSES: ConsentPurpose[] = [
  'ai_processing', 'legal_research', 'document_storage', 'analytics',
  'marketing', 'third_party_sharing', 'biometric', 'sensitive_legal_data',
];

const GrantSchema = z.object({
  purposes: z.array(z.enum(VALID_PURPOSES as [ConsentPurpose, ...ConsentPurpose[]])).min(1),
  jurisdiction: z.string().default('IN'),
});

const WithdrawSchema = z.object({
  purposes: z.array(z.enum(VALID_PURPOSES as [ConsentPurpose, ...ConsentPurpose[]])).min(1),
});

/** POST /grant — Grant consent for one or more purposes */
router.post('/grant', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = GrantSchema.parse(req.body);
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const records = await consentManagementService.grantConsent({
      userId,
      // NV-UAT-DEFAULT-ORG-001 (task #335): missing org → baseline org_id=1
      // in dev / E2E-bypass mode. Production keeps undefined and fails closed.
      orgId: (req as any).user?.org_id ??
        ((process.env.NODE_ENV !== 'production') ? 1 : undefined),
      purposes: body.purposes,
      jurisdiction: body.jurisdiction,
      ipAddress: req.ip || undefined,
      userAgent: req.headers['user-agent'] || undefined,
      consentVersion: '3.1.2-dpdpa-2023',
    });

    res.json({ success: true, message: `Consent granted for ${records.length} purpose(s)`, records });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    logger.error('consent_grant_error', { err });
    res.status(500).json({ error: 'Failed to grant consent' });
  }
});

/** POST /withdraw — Withdraw consent */
router.post('/withdraw', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = WithdrawSchema.parse(req.body);
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const result = await consentManagementService.withdrawConsent(userId, body.purposes);
    res.json({ success: true, message: `Consent withdrawn for ${result.withdrawn.length} purpose(s)`, ...result });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: 'Failed to withdraw consent' });
  }
});

/** GET /status — Get consent status for the authenticated user */
router.get('/status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const status = await consentManagementService.getConsentStatus(userId);
    res.json({ success: true, ...status });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get consent status' });
  }
});

/** GET /export — Export all user data (DPDPA §12 portability right) */
router.get('/export', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const exportData = await consentManagementService.exportUserData(userId);
    res.setHeader('Content-Disposition', `attachment; filename="nyayavigya-data-export-${userId}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to export data' });
  }
});

/** DELETE /delete-my-data — Right to erasure (DPDPA §13) */
router.delete('/delete-my-data', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await consentManagementService.deleteUserData(userId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete user data' });
  }
});

/** GET /purposes — List all consent purposes and their legal basis */
router.get('/purposes', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    jurisdiction: 'IN — Digital Personal Data Protection Act 2023',
    purposes: VALID_PURPOSES.map(p => ({
      purpose: p,
      required: ['ai_processing', 'legal_research'].includes(p),
      description: getPurposeDescription(p),
    })),
    consentVersion: '3.1.2-dpdpa-2023',
    dataController: 'Jurexio Legal AI Pvt Ltd',
    dpo: 'dpo@nyayavigya.in',
  });
});

function getPurposeDescription(p: ConsentPurpose): string {
  const desc: Record<ConsentPurpose, string> = {
    ai_processing: 'Processing your legal queries through AI models for research assistance',
    legal_research: 'Using your query history to improve legal research recommendations',
    document_storage: 'Storing documents you upload for analysis and retrieval',
    analytics: 'Anonymous usage analytics to improve the platform',
    marketing: 'Sending product updates, legal news, and promotional content',
    third_party_sharing: 'Sharing anonymised insights with legal data partners',
    biometric: 'Voice recognition and authentication via biometric data',
    sensitive_legal_data: 'Processing sensitive matters (family law, criminal, medical)',
  };
  return desc[p] || p;
}

export default router;
