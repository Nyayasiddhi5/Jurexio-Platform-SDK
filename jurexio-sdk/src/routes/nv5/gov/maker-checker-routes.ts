// /api/nv5/gov/maker-checker/* — admin queue-read endpoints for the
// Maker-Checker HITL surface. Strict SDK auth (rejects JWT-shaped Bearer)
// + admin scope. This sub-router is read-only by contract; no mutation
// paths exposed (the canonical mutation surface — submitHumanDecision —
// runs through the existing HITL flow per task-101.md "Out of scope:
// removing or replacing existing HITL flow"). Note: a sibling sub-router
// (org-ratelimit) intentionally exposes a documented cache-invalidate
// POST — see its file header for rationale; that exception does not
// extend to maker-checker.
import { Router, type Request, type Response } from 'express';
import { makerCheckerService } from '../../../services/maker-checker-service.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/queue', requireSdkKeyOnly, requireScope('admin'), (req: Request, res: Response) => {
  try {
    const priority = typeof req.query.priority === 'string'
      ? req.query.priority as 'urgent' | 'high' | 'medium' | 'low'
      : undefined;
    const reviews = makerCheckerService.getPendingHumanReviews(priority);
    res.json({
      success: true,
      count: reviews.length,
      reviews: reviews.map(r => ({
        requestId: r.requestId,
        sessionId: r.sessionId,
        priority: r.priority,
        reason: r.reason,
        iterations: r.iterations.length,
        createdAt: r.createdAt,
        deadline: r.deadline,
      })),
    });
  } catch (e) { safeError(res, e); }
});

router.get('/queue/:requestId', requireSdkKeyOnly, requireScope('admin'), (req: Request, res: Response) => {
  try {
    const all = makerCheckerService.getPendingHumanReviews();
    const found = all.find(r => r.requestId === req.params.requestId);
    if (!found) return safeError(res, `review not found: ${req.params.requestId}`, 404);
    res.json({ success: true, review: found });
  } catch (e) { safeError(res, e); }
});

export default router;
