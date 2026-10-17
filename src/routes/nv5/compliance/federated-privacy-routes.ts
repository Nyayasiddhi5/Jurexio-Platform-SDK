// /api/nv5/compliance/federated-privacy/* — federated learning session
// observability. Read-only listings + a deterministic differential-privacy
// noise probe. Mutating session lifecycle (initialize/submit/aggregate)
// remains in code-path use only — those are bound to an established
// federated training run, not an ad-hoc admin endpoint. Admin-scoped.
import { Router, type Request, type Response } from 'express';
import { nvFederatedPrivacyService } from '../../../services/security/jrx-federated-privacy-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/capabilities', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: './jrx-federated-privacy',
    capabilities: ['session-init', 'gradient-submit', 'gradient-aggregate',
                   'differential-privacy-noise', 'privacy-budget-tracking'],
    sessionStates: ['initialized', 'collecting', 'aggregating', 'completed', 'over_budget'],
    note: 'Session lifecycle mutations exposed only inside training-run code paths.',
  });
});

router.get('/sessions', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sessions = await nvFederatedPrivacyService.listSessions({ clientId, status });
    res.json({ success: true, count: sessions.length, sessions });
  } catch (e) { safeError(res, e); }
});

router.get('/sessions/:sessionId', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const sid = String(req.params.sessionId);
    const session = await nvFederatedPrivacyService.getSession(sid);
    if (!session) return safeError(res, `session not found: ${sid}`, 404);
    res.json({ success: true, session });
  } catch (e) { safeError(res, e); }
});

router.post('/dp-noise', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const queryResult = Number(req.body?.queryResult);
    const sensitivity = Number(req.body?.sensitivity);
    const epsilon = Number(req.body?.epsilon);
    if (!isFinite(queryResult) || !isFinite(sensitivity) || !isFinite(epsilon)) {
      return safeError(res, 'queryResult, sensitivity, epsilon (numbers) required', 400);
    }
    if (epsilon <= 0) return safeError(res, 'epsilon must be > 0', 400);
    const noised = await nvFederatedPrivacyService.addDifferentialPrivacyNoise(queryResult, sensitivity, epsilon);
    res.json({ success: true, original: queryResult, sensitivity, epsilon, noised });
  } catch (e) { safeError(res, e); }
});

export default router;
