// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Per-Platform Rate Limiter Middleware
 * Configurable rate limiting with sliding window counter for different platforms
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('per-platform-rate-limiter');

// task-2026-05-13: dev/test E2E bypass.
const NV_E2E_BYPASS =
  process.env.NV_E2E_BYPASS === '1' && process.env.NODE_ENV !== 'production';
// NV-PLATFORM-UAT-BYPASS-001 (2026-05-14): production-safe targeted bypass for
// the 7 internal Jurexio platform keys only.
import { isPlatformUatRequest } from './jrx-platform-uat-bypass.js';
import { shouldSkipPartnerProductRateLimits } from '../utils/jrx-partner-platform.js';

/**
 * Rate limit configuration per platform
 */
export interface PlatformRateLimitConfig {
  [platformId: string]: {
    requestsPerMinute: number;
    description?: string;
  };
}

/**
 * Rate limit entry stored in memory
 */
interface RateLimitEntry {
  requestTimestamps: number[];
  windowStart: number;
}

/**
 * Rate limiter instance
 */
export interface PlatformRateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  reset: () => void;
  getStatus: (platformId: string) => { remaining: number; resetAt: number } | null;
}

const WINDOW_MS = 60 * 1000; // 1 minute
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Default platform rate limit configurations
 */
const DEFAULT_PLATFORM_LIMITS: PlatformRateLimitConfig = {
  'NV Core': { requestsPerMinute: 2000, description: 'Jurexio Core AI Gateway' },
  'NS Professional Solo': { requestsPerMinute: 100, description: 'Jurexio Professional Solo' },
  'NS Professional Plus': { requestsPerMinute: 200, description: 'Jurexio Professional Plus' },
  'NS Professional Pro': { requestsPerMinute: 500, description: 'Jurexio Professional Pro' },
  'NM Jurexio Citizen': { requestsPerMinute: 500, description: 'Jurexio Citizen Citizen Platform' },
  'NI Institutional': { requestsPerMinute: 800, description: 'Jurexio Institutional' },
  'NMIN Ministry': { requestsPerMinute: 300, description: 'Jurexio Ministry' },
  'NACAD Academy': { requestsPerMinute: 300, description: 'Jurexio Academy' },
  'SDK Automation': { requestsPerMinute: 1500, description: 'SDK Automation Service' },
};

/**
 * Create a platform rate limiter with custom configuration
 * @param config Optional custom rate limit configuration, merges with defaults
 * @returns Rate limiter middleware and utilities
 */
export function createPlatformRateLimiter(config?: PlatformRateLimitConfig): PlatformRateLimiter {
  // Merge custom config with defaults
  const finalConfig: PlatformRateLimitConfig = {
    ...DEFAULT_PLATFORM_LIMITS,
    ...(config || {}),
  };

  /**
   * In-memory store for rate limit tracking
   * Key: platformId, Value: RateLimitEntry with sliding window timestamps
   */
  const rateLimitStore = new Map<string, RateLimitEntry>();

  /**
   * Cleanup old windows periodically
   */
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [platformId, entry] of rateLimitStore) {
      // Remove timestamps older than 2 windows
      entry.requestTimestamps = entry.requestTimestamps.filter((ts) => now - ts < WINDOW_MS * 2);
      if (entry.requestTimestamps.length === 0) {
        rateLimitStore.delete(platformId);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Ensure cleanup doesn't keep process alive
  cleanupInterval.unref();

  /**
   * Check rate limit for a platform using sliding window counter
   * @returns { allowed: boolean, remaining: number, resetAt: number }
   */
  function checkRateLimit(
    platformId: string,
    limit: number
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let entry = rateLimitStore.get(platformId);

    if (!entry) {
      entry = {
        requestTimestamps: [now],
        windowStart: now,
      };
      rateLimitStore.set(platformId, entry);
      return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS };
    }

    // Remove timestamps outside the current window
    const windowCutoff = now - WINDOW_MS;
    entry.requestTimestamps = entry.requestTimestamps.filter((ts) => ts > windowCutoff);

    if (entry.requestTimestamps.length >= limit) {
      // Rate limit exceeded
      const oldestTimestamp = entry.requestTimestamps[0];
      const resetAt = oldestTimestamp + WINDOW_MS;
      return { allowed: false, remaining: 0, resetAt };
    }

    // Add current request
    entry.requestTimestamps.push(now);
    const resetAt = entry.requestTimestamps[0] + WINDOW_MS;

    return {
      allowed: true,
      remaining: limit - entry.requestTimestamps.length,
      resetAt,
    };
  }

  /**
   * Express middleware for rate limiting
   */
  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (NV_E2E_BYPASS) { next(); return; }
    if (isPlatformUatRequest(req)) { next(); return; }
    if (shouldSkipPartnerProductRateLimits(req)) {
      res.setHeader('X-NSP-Unlimited', '1');
      next();
      return;
    }
    try {
      // Extract platform ID from request
      // First try from service identity (if validateServiceApiKey was used)
      const platformId =
        req.serviceIdentity?.platformId ||
        req.headers['x-platform-id'] ||
        req.headers['x-service-id'] ||
        'unknown';

      // Get platform configuration
      const platformName =
        req.serviceIdentity?.platformName ||
        (req.headers['x-platform-name'] as string) ||
        platformId;

      const platformConfig = finalConfig[String(platformName)] || finalConfig[String(platformId)];

      if (!platformConfig) {
        // No rate limit configured, proceed
        next();
        return;
      }

      const limit = platformConfig.requestsPerMinute;
      const rateLimitResult = checkRateLimit(platformId as string, limit);

      // Set rate limit headers
      const resetAtSeconds = Math.ceil(rateLimitResult.resetAt / 1000);
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimitResult.remaining)));

      if (!rateLimitResult.allowed) {
        // NV-WIRING-BUDGET-001 Phase-1 fix (2026-05-10) — set Retry-After
        // BEFORE res.json() to avoid "headers already sent" warnings.
        const retryAfterSeconds = Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000);
        res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit of ${limit} requests per minute exceeded for platform: ${platformName}`,
          },
        });
        return;
      }

      next();
    } catch (error: any) {
      logger.error('[Per-Platform Rate Limiter] Unexpected error:', error);
      // On error, allow the request to proceed but log it
      next();
    }
  };

  /**
   * Reset all rate limit counters
   */
  const reset = (): void => {
    rateLimitStore.clear();
  };

  /**
   * Get status for a specific platform
   */
  const getStatus = (platformId: string): { remaining: number; resetAt: number } | null => {
    const entry = rateLimitStore.get(platformId);
    if (!entry) return null;

    const platformConfig = finalConfig[platformId];
    if (!platformConfig) return null;

    const now = Date.now();
    const windowCutoff = now - WINDOW_MS;
    const validRequests = entry.requestTimestamps.filter((ts) => ts > windowCutoff);

    const resetAt = validRequests.length > 0 ? validRequests[0] + WINDOW_MS : now + WINDOW_MS;

    return {
      remaining: Math.max(0, platformConfig.requestsPerMinute - validRequests.length),
      resetAt,
    };
  };

  return {
    middleware,
    reset,
    getStatus,
  };
}

/**
 * Pre-configured rate limiter with default platform settings
 */
export const defaultPlatformRateLimiter = createPlatformRateLimiter();

/**
 * Convenience export for using the default rate limiter directly as middleware
 */
export const platformRateLimitMiddleware = defaultPlatformRateLimiter.middleware;

/**
 * Utility function to create a custom rate limiter for specific platforms
 * @param customLimits Object with platform names/IDs as keys and request limits as values
 */
export function createCustomPlatformRateLimiter(customLimits: Record<string, number>): PlatformRateLimiter {
  const config: PlatformRateLimitConfig = {};
  for (const [platform, limit] of Object.entries(customLimits)) {
    config[platform] = {
      requestsPerMinute: limit,
      description: `Custom limit for ${platform}`,
    };
  }
  return createPlatformRateLimiter(config);
}

/**
 * Utility to check current rate limit status across all tracked platforms
 * @returns Map of platform IDs to their current rate limit status
 */
export function getAllRateLimitStatus(): Map<string, { remaining: number; resetAt: number }> {
  const status = new Map<string, { remaining: number; resetAt: number }>();

  // This would need access to the internal store
  // For now, return empty map - can be enhanced if needed
  return status;
}
