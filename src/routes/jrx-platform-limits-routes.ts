/**
 * Platform-tier (Tier-0) admin routes.
 *
 * Mounted at: /api/jrx/sdk/platform
 *   GET  /limits  — what Jurexio has allocated to the calling platform
 *                    (rate-limit, daily / monthly token budget, allowed
 *                    agents/scopes) under its current `platform_tier`,
 *                    plus today's usage so a partner can render headroom.
 *   GET  /tiers   — the catalog of named platform AND customer-org tiers
 *                    so partner platforms can render a "tier picker" when
 *                    onboarding a new customer firm without having to
 *                    hard-code our matrix on their side.
 *
 * AUTH: SDK API key (sdkGatewayAuth). Every call resolves to one
 *       sdk_applications row via `req.sdkContext.applicationId`.
 *       Cross-platform reads are impossible — the SDK key IS the
 *       platform-id binding.
 *
 * NV-AUTH-HEADER-001 compliant (X-API-Key).
 * NV-API-CONTRACT-001: additions only.
 * NV-WIRING-001: imported and mounted in src/index.ts.
 */

import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { createLogger } from '../utils/logger.js';
import {
  loadPlatformLimits,
  loadTodaysUsageForPlatform,
} from '../services/jrx-billing-tier-service.js';
import {
  PLATFORM_TIERS,
  CUSTOMER_ORG_TIERS,
} from '../config/jrx-billing-tiers.js';

const router = Router();
const logger = createLogger('./jrx-platform-limits');

router.use(sdkGatewayAuth);

/**
 * Admin-scope guard — same contract as nv-customer-orgs-routes.ts.
 *
 * Platform-tier readouts expose billing headroom + tier matrices that
 * a per-firm developer-portal key has no business seeing. Require an
 * admin-scoped SDK key (or wildcard).
 */
const PLATFORM_ADMIN_SCOPES = new Set([
  '*',
  'platform:admin',
  'platform:read',
  'customer-orgs:admin',
  'admin',
]);

router.use((req: Request, res: Response, next): void => {
  const sdk = (req as any).sdkContext;
  const scopes: string[] = Array.isArray(sdk?.scopes) ? sdk.scopes : [];
  const ok = scopes.some((s) => PLATFORM_ADMIN_SCOPES.has(s));
  if (!ok) {
    res.status(403).json({
      success: false,
      error: 'platform-tier endpoints require an admin-scoped SDK key',
      code: 'PLATFORM_ADMIN_SCOPE_REQUIRED',
      required_one_of: Array.from(PLATFORM_ADMIN_SCOPES),
    });
    return;
  }
  next();
});

// GET /api/jrx/sdk/platform/limits
router.get('/limits', async (req: Request, res: Response): Promise<void> => {
  const sdk = (req as any).sdkContext;
  const applicationId = typeof sdk?.applicationId === 'number' ? sdk.applicationId : 0;
  if (!applicationId || applicationId <= 0) {
    res.status(401).json({
      success: false,
      error: 'this endpoint requires an SDK platform key',
      code: 'PLATFORM_KEY_REQUIRED',
    });
    return;
  }
  try {
    const view = await loadPlatformLimits(applicationId);
    if (!view) {
      res.status(404).json({
        success: false,
        error: 'sdk_applications row not found',
        code: 'PLATFORM_NOT_FOUND',
      });
      return;
    }
    const usage = await loadTodaysUsageForPlatform(applicationId);
    res.json({
      success: true,
      data: {
        platform: view,
        usage_today: usage,
        // Headroom is a derived convenience — agent-side caches MUST
        // re-query rather than treating this as authoritative for >60s.
        headroom: {
          daily_tokens_remaining:
            Math.max(0, view.tier.dailyTokenBudget - usage.tokensTotal),
        },
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error('platform_limits_failed', { applicationId, err: err?.message });
    res.status(500).json({ success: false, error: 'Failed to load platform limits', code: 'PLATFORM_LIMITS_FAILED' });
  }
});

// GET /api/jrx/sdk/platform/tiers
router.get('/tiers', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    data: {
      platform_tiers:     PLATFORM_TIERS,
      customer_org_tiers: CUSTOMER_ORG_TIERS,
      generated_at:       new Date().toISOString(),
    },
  });
});

export default router;
