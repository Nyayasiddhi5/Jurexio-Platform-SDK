/**
 * Super-admin API for LLM / provider secret overlay (hot-apply).
 * Mount: /api/jrx/admin/provider-secrets
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '../utils/logger.js';
import {
  PROVIDER_SECRET_CATALOG,
  bootProviderSecretsOverlay,
  clearProviderSecret,
  listProviderSecretStatus,
  upsertProviderSecret,
} from '../services/jrx-runtime-provider-secrets.js';

const logger = createLogger('provider-secrets-routes');
const router = Router();

router.get('/catalog', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      providers: PROVIDER_SECRET_CATALOG,
      note: 'Values are never returned. Overlay secrets hot-apply into process.env without restart.',
    },
  });
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    await bootProviderSecretsOverlay();
    const status = await listProviderSecretStatus();
    res.json({ success: true, data: { secrets: status } });
  } catch (e: any) {
    logger.error('list_failed', { error: e?.message });
    res.status(500).json({ success: false, error: e?.message || 'list failed' });
  }
});

router.put('/:providerId/:envName', async (req: Request, res: Response) => {
  try {
    const providerId = String(req.params.providerId);
    const envName = String(req.params.envName);
    const value = String(req.body?.value || req.body?.secret || '').trim();
    const reason = req.body?.reason ? String(req.body.reason) : undefined;
    if (!value) {
      res.status(400).json({ success: false, error: 'value is required' });
      return;
    }
    const updatedBy = String((req as any).user?.email || (req as any).user?.id || 'dashboard');
    const result = await upsertProviderSecret({
      providerId,
      envName,
      value,
      updatedBy,
      reason,
    });
    res.json({
      success: true,
      data: {
        providerId,
        envName,
        last4: result.last4,
        applied: 'hot',
        message: 'Secret stored and applied to running process (no restart required for new calls).',
      },
    });
  } catch (e: any) {
    logger.error('upsert_failed', { error: e?.message });
    res.status(400).json({ success: false, error: e?.message || 'upsert failed' });
  }
});

router.delete('/:providerId/:envName', async (req: Request, res: Response) => {
  try {
    const providerId = String(req.params.providerId);
    const envName = String(req.params.envName);
    const updatedBy = String((req as any).user?.email || (req as any).user?.id || 'dashboard');
    await clearProviderSecret({ providerId, envName, updatedBy });
    res.json({ success: true, data: { providerId, envName, cleared: true } });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'clear failed' });
  }
});

export default router;
