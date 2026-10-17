// /api/nv5/gov/org-ratelimit/* — admin endpoints for the per-org rate
// limiter. Surface is documented "read + cache invalidate" (NOT pure
// read-only): GET /check exposes the live decision, POST /cache/:orgId/
// invalidate flushes the cached `ai_rate_limit` lookup so admin updates
// to ns_schema.organisations take effect immediately. Cache invalidation
// is a deliberate documented exception to the otherwise read-only gov
// surface (architect-final 2026-05-10).
//
// The Express middleware (`orgRateLimiter.middleware()`) IS conditionally
// mounted on /api/jrx/* by src/index.ts when JRX_F_GOV_ORG_RATELIMIT=1
// (default OFF). Mount placement is after the existing tenant-isolation
// layer and before business-route handlers — see src/index.ts comment
// block at the gov middleware mount.
//
// Strict SDK auth (rejects JWT-shaped Bearer) + admin scope.
import { Router, type Request, type Response } from 'express';
import { orgRateLimiter } from '../../../services/org-rate-limiter.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/check/:orgId/:userId', requireSdkKeyOnly, requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const result = await orgRateLimiter.check(String(req.params.orgId), String(req.params.userId));
    res.json({ success: true, ...result });
  } catch (e) { safeError(res, e); }
});

router.post('/cache/:orgId/invalidate', requireSdkKeyOnly, requireScope('admin'), (req: Request, res: Response) => {
  try {
    orgRateLimiter.invalidateCache(String(req.params.orgId));
    res.json({ success: true, orgId: req.params.orgId, cacheInvalidated: true });
  } catch (e) { safeError(res, e); }
});

export default router;
