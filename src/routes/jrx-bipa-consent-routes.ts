/**
 * BIPA 740 ILCS 14/15 consent surface (task-357).
 *
 *   POST   /api/jrx/bipa/consent/grant     — record §15(b) written consent
 *   POST   /api/jrx/bipa/consent/revoke    — revoke + run §15(a) destruction
 *   GET    /api/jrx/bipa/consent/status    — list consents for the auth user
 *   GET    /api/jrx/bipa/consent/policy    — public disclosure metadata
 *   POST   /api/jrx/bipa/consent/destroy   — admin-trigger destruction worker
 *
 * @module nv-bipa-consent-routes
 */
import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import {
  bipaConsentService,
  BIPA_BIOMETRIC_TYPES,
  BIPA_POLICY_VERSION,
  BIPA_DEFAULT_RETENTION_TERM,
  type BipaBiometricType,
} from '../services/compliance/jrx-bipa-consent-service.js';
// task-357: share the gate's identity resolver so a record granted via
// Console (JWT user.id) is the SAME principal the HTTP / WS / SDK gates
// look up at capture time. Avoids the "consent granted but still
// blocked" bug from divergent identity schemes.
import { resolveBipaSubject } from '../middleware/jrx-bipa-consent-gate.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-bipa-consent-routes');

const TYPE_ENUM = z.enum(BIPA_BIOMETRIC_TYPES as unknown as [BipaBiometricType, ...BipaBiometricType[]]);

const GrantSchema = z.object({
  biometricType: TYPE_ENUM,
  purpose: z.string().min(8, 'purpose must describe the specific use'),
  signatureName: z.string().min(2, 'printed name required for §15(b)(3) signature'),
  signaturePayload: z.string().optional(),
  disclosureText: z.string().optional(),
  retentionTerm: z.string().optional(),
});

const RevokeSchema = z.object({
  biometricType: TYPE_ENUM,
  reason: z.string().optional(),
});

const DestroySchema = z.object({
  userId: z.string().min(1),
  biometricType: TYPE_ENUM,
});

function userIdOf(req: Request): string | null {
  return resolveBipaSubject(req);
}

function orgIdOf(req: Request): string | null {
  const u = (req as any).user;
  if (u?.orgId) return String(u.orgId);
  if (u?.organizationId) return String(u.organizationId);
  return null;
}

router.post('/grant', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = GrantSchema.parse(req.body);
    const userId = userIdOf(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const record = await bipaConsentService.grant({
      userId,
      orgId: orgIdOf(req),
      biometricType: body.biometricType,
      purpose: body.purpose,
      signatureName: body.signatureName,
      signaturePayload: body.signaturePayload ?? null,
      disclosureText: body.disclosureText,
      retentionTerm: body.retentionTerm,
      ipAddress: req.ip || null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    });
    res.json({ success: true, record });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    logger.error('bipa_grant_error', { err: err?.message });
    res.status(500).json({ error: 'Failed to grant BIPA consent' });
  }
});

router.post('/revoke', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = RevokeSchema.parse(req.body);
    const userId = userIdOf(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await bipaConsentService.revokeAndDestroy({
      userId,
      biometricType: body.biometricType,
      triggeredBy: 'data-subject-revoke',
      reason: body.reason,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    logger.error('bipa_revoke_error', { err: err?.message });
    res.status(500).json({ error: 'Failed to revoke BIPA consent' });
  }
});

router.get('/status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = userIdOf(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const records = await bipaConsentService.listForUser(userId);
    const active = records.filter(r => r.status === 'granted');
    res.json({
      success: true,
      userId,
      activeBiometricTypes: active.map(r => r.biometricType),
      policyVersion: BIPA_POLICY_VERSION,
      records,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch BIPA consent status' });
  }
});

router.get('/policy', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    policy: 'POL-US-BIPA-740-14-15',
    statute: '740 ILCS 14/15',
    policyVersion: BIPA_POLICY_VERSION,
    biometricTypes: BIPA_BIOMETRIC_TYPES,
    retentionTerm: BIPA_DEFAULT_RETENTION_TERM,
    disclosureSummary:
      'Jurexio obtains §15(b) written informed consent before any biometric ' +
      'collection, never sells or profits from biometric data (§15(c)), discloses ' +
      'only with consent or legal compulsion (§15(d)), and destroys identifiers ' +
      'within 3 years of last interaction or upon revocation (§15(a)).',
    revocationEndpoint: '/api/jrx/bipa/consent/revoke',
    grantEndpoint: '/api/jrx/bipa/consent/grant',
  });
});

/** Admin / privacy-ops: re-run the §15(a) destruction worker for a principal. */
router.post('/destroy', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = DestroySchema.parse(req.body);
    const caller = (req as any).user;
    const role = String(caller?.role ?? '').toLowerCase();
    if (!['super_admin', 'compliance_officer', 'admin'].includes(role)) {
      res.status(403).json({ error: 'Privacy-ops role required to re-run destruction worker' });
      return;
    }
    const result = await bipaConsentService.runDestructionWorker(body.userId, body.biometricType, `admin:${caller?.id ?? 'unknown'}`);
    res.json({ success: true, destroyed: result });
  } catch (err: any) {
    if (err instanceof ZodError) { res.status(400).json({ error: err.errors }); return; }
    res.status(500).json({ error: 'Destruction worker failed' });
  }
});

export default router;
