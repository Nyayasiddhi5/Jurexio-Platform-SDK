/**
 * JRX Web Scraper Routes — agent-callable HTTP adapter
 * Mounted at /api/jrx/tools/scrape
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { webScrapingService, getRateLimiterStatus } from '../services/web-scraping.js';
import { NV_SCRAPER_ALLOWLIST } from '../config/jrx-scraper-allowlist.js';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

const router = Router();
const logger = createLogger('./jrx-web-scraper-routes');

const scrapeSchema = z.object({
  url: z.string().url(),
  options: z.object({
    redactPII: z.boolean().optional(),
    jurisdiction: z.enum(['IN', 'UK', 'US', 'GCC', 'EU', 'SG', 'DEFAULT']).optional(),
    indexInGraphRAG: z.boolean().optional(),
    orgId: z.string().optional(),
    documentClass: z.string().optional(),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  }).optional(),
});

router.post('/', authenticateToken, requireRole('developer', 'org_admin'), async (req: Request, res: Response) => {
  const parsed = scrapeSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, 'BAD_REQUEST', { details: parsed.error.format() });
  }
  const { url, options = {} } = parsed.data;
  logger.info({ msg: 'scrape request', url, user: (req as any).user?.email, opts: options });
  const result = await webScrapingService.scrape(url, options);
  return res.status(result.success ? 200 : 400).json(result);
});

router.get('/allowlist', authenticateToken, (_req: Request, res: Response) => {
  res.json({
    success: true,
    count: NV_SCRAPER_ALLOWLIST.length,
    sources: NV_SCRAPER_ALLOWLIST.map((s) => ({
      host: s.host,
      jurisdiction: s.jurisdiction,
      label: s.label,
      rateLimit: s.rateLimit,
      tier: s.tier,
      matchSubdomains: s.matchSubdomains ?? false,
    })),
  });
});

router.get('/rate-limiter', authenticateToken, (_req: Request, res: Response) => {
  res.json({ success: true, buckets: getRateLimiterStatus() });
});

export default router;
