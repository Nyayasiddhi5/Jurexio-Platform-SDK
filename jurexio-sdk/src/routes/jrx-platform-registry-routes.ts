/**
 * M09/M11 — read-only module event registry + canonical name validation (v1 adopted).
 * Mounted at /api/jrx/platform/registry
 */
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { createLogger } from '../utils/logger.js';
import {
  getJrxEventRegistryMeta,
  lookupJrxRegistryEvent,
  validateJrxCanonicalEventName,
} from '../services/jrx-module-registry-service.js';

const router = Router();
const logger = createLogger('./jrx-platform-registry');

router.use(sdkGatewayAuth);

router.get('/meta', (_req: Request, res: Response): void => {
  const meta = getJrxEventRegistryMeta();
  res.json({
    success: true,
    registry: 'jurexio-specs/registry/events.json',
    version: meta.version,
    adopted_on: meta.adopted_on ?? null,
    alias_policy: meta.alias_policy ?? null,
    flag_012_event_count: meta.flag_012_core_events?.length ?? 0,
  });
});

router.get('/events/:name', (req: Request, res: Response): void => {
  const name = String(req.params.name || '').trim().toUpperCase();
  const row = lookupJrxRegistryEvent(name);
  if (!row) {
    res.status(404).json({ success: false, code: 'EVENT_NOT_IN_REGISTRY', name });
    return;
  }
  res.json({ success: true, event: row });
});

router.post('/events/validate', (req: Request, res: Response): void => {
  const name = String((req.body as Record<string, unknown>)?.name ?? '').trim();
  const result = validateJrxCanonicalEventName(name);
  logger.info('registry event validate', {
    name_len: name.length,
    valid: result.valid,
    code: result.code,
  });
  res.status(result.valid ? 200 : 422).json({
    success: result.valid,
    ...result,
    name: name.toUpperCase(),
  });
});

export default router;
