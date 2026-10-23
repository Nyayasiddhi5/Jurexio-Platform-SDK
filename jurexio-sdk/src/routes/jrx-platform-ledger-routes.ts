/**
 * M09 Ledger — registry-validated event ingest (Sprint 1 synthetic path).
 * Mounted at: POST /api/jrx/platform/ledger/ingest
 */
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { createLogger } from '../utils/logger.js';
import { ingestJrxLedgerEvent } from '../services/jrx-ledger-ingest-service.js';

const router = Router();
const logger = createLogger('./jrx-platform-ledger');

router.use(sdkGatewayAuth);

router.post('/ingest', (req: Request, res: Response): void => {
  const body = req.body as Record<string, unknown>;
  const eventName = String(body?.eventName ?? body?.event_name ?? '').trim();
  const tenantId = String(body?.tenantId ?? body?.tenant_id ?? '').trim();
  const synthetic = body?.synthetic === true;
  const payload =
    body?.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : undefined;

  const result = ingestJrxLedgerEvent({ eventName, tenantId, payload, synthetic });

  logger.info('ledger ingest', {
    accepted: result.accepted,
    code: result.code,
    event_len: eventName.length,
    tenant_len: tenantId.length,
  });

  res.status(result.accepted ? 202 : 422).json({
    success: result.accepted,
    ...result,
    eventName: eventName.toUpperCase(),
    tenantId,
  });
});

export default router;
