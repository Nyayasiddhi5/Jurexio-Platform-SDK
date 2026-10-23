/**
 * M11 CommandCentre — central access-decision API (Sprint 1 v1).
 * Mounted at: POST /api/jrx/platform/access/evaluate
 */
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { createLogger } from '../utils/logger.js';
import { evaluateJrxAccessDecision } from '../services/jrx-access-policy-service.js';

const router = Router();
const logger = createLogger('./jrx-platform-access');

router.use(sdkGatewayAuth);

router.post('/evaluate', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown>;
  const permission = String(body?.permission ?? '').trim();
  const subjectId = String(body?.subjectId ?? body?.subject_id ?? '').trim();
  const resourceId = String(body?.resourceId ?? body?.resource_id ?? '').trim();
  const matterPolicy = body?.matterPolicy ?? body?.matter_policy;
  const context = (body?.context ?? body?.ctx) as Record<string, unknown> | undefined;

  if (!permission || !subjectId) {
    res.status(400).json({
      success: false,
      code: 'ACCESS_EVAL_INVALID',
      error: 'permission and subjectId are required',
    });
    return;
  }

  const result = evaluateJrxAccessDecision({
    permission,
    subjectId,
    resourceId: resourceId || undefined,
    matterPolicy,
    context: context
      ? {
          heldPermissions: Array.isArray(context.heldPermissions)
            ? (context.heldPermissions as string[])
            : undefined,
          stepUpVerified: context.stepUpVerified === true,
          requesterId:
            context.requesterId !== undefined ? String(context.requesterId) : undefined,
          dualApproverIds: Array.isArray(context.dualApproverIds)
            ? (context.dualApproverIds as string[])
            : undefined,
        }
      : undefined,
  });

  logger.info('access evaluate', {
    decision: result.decision,
    code: result.code,
    permission_len: permission.length,
    subject_len: subjectId.length,
  });

  res.status(200).json({
    success: true,
    decision: result.decision,
    code: result.code,
    message: result.message,
    gateClass: result.gateClass ?? null,
    evaluated_at: new Date().toISOString(),
    permission,
    subjectId,
    resourceId: resourceId || null,
  });
});

export default router;
