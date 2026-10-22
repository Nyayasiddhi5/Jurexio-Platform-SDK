/**
 * M11 CommandCentre — central access-decision stub (Sprint 1).
 * Mounted at: POST /api/jrx/platform/access/evaluate
 * Deny by default until policy engine is wired to MatterCore context.
 */
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('./jrx-platform-access');

router.use(sdkGatewayAuth);

router.post('/evaluate', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown>;
  const permission = String(body?.permission ?? '').trim();
  const subjectId = String(body?.subjectId ?? body?.subject_id ?? '').trim();
  const resourceId = String(body?.resourceId ?? body?.resource_id ?? '').trim();

  if (!permission || !subjectId) {
    res.status(400).json({
      success: false,
      code: 'ACCESS_EVAL_INVALID',
      error: 'permission and subjectId are required',
    });
    return;
  }

  logger.info('access evaluate stub (deny default)', {
    permission_len: permission.length,
    subject_len: subjectId.length,
    resource_len: resourceId.length,
  });

  res.status(200).json({
    success: true,
    decision: 'deny',
    code: 'ACCESS_POLICY_NOT_WIRED',
    message:
      'CommandCentre access policy engine is not yet wired; deny by default per M11 R1.',
    evaluated_at: new Date().toISOString(),
    permission,
    subjectId,
    resourceId: resourceId || null,
  });
});

export default router;
