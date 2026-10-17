/**
 * Inter-Service API Key Authentication Middleware
 * Handles authentication for platform-to-Jurexio Core AI gateway calls
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { sdkAppApiKeys, sdkApplications } from '@shared/schema.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('inter-service-auth');

// Narrow row-shape extensions for runtime columns that are not declared on
// the Drizzle schema in shared/schema.ts (revokedAt, rateLimitOverride
// added by later migrations). Strictly additive — never a blanket `any`.
type SdkAppApiKeyDbRow = typeof sdkAppApiKeys.$inferSelect & {
  revokedAt?: Date | null;
  rateLimitOverride?: number | null;
};
type SdkApplicationDbRow = typeof sdkApplications.$inferSelect;

/**
 * Service Identity - attached to request after authentication
 */
export interface ServiceIdentity {
  platformId: string;
  platformName: string;
  tier: string;
  permissions: string[];
}

/**
 * Extended Express Request with service context
 */
declare global {
  namespace Express {
    interface Request {
      serviceIdentity?: ServiceIdentity;
    }
  }
}

/**
 * In-memory cache for validated API keys
 * Stores: keyHash -> { platformId, platformName, tier, permissions, expiresAt }
 */
const keyCache = new Map<string, { identity: ServiceIdentity; expiresAt: number }>();

/**
 * In-memory rate limit tracker per platformId
 * Stores: platformId -> { count: number; windowStart: number }
 */
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Platform-specific tier configuration
 */
const PLATFORM_TIER_CONFIG: Record<string, { tier: string; defaultRateLimit: number }> = {
  'NV Core': { tier: 'core', defaultRateLimit: 2000 },
  'NS Professional Solo': { tier: 'standard', defaultRateLimit: 100 },
  'NS Professional Plus': { tier: 'standard', defaultRateLimit: 200 },
  'NS Professional Pro': { tier: 'premium', defaultRateLimit: 500 },
  'NM Nyayamitra': { tier: 'standard', defaultRateLimit: 500 },
  'NI Institutional': { tier: 'enterprise', defaultRateLimit: 800 },
  'NMIN Ministry': { tier: 'enterprise', defaultRateLimit: 300 },
  'NACAD Academy': { tier: 'enterprise', defaultRateLimit: 300 },
  'SDK Automation': { tier: 'premium', defaultRateLimit: 1500 },
};

/**
 * Default rate limits per tier
 */
const DEFAULT_RATE_LIMITS: Record<string, number> = {
  core: 2000,
  premium: 5000,
  standard: 1000,
  enterprise: 2000,
};

/**
 * Cleanup expired cache entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of keyCache) {
    if (now > entry.expiresAt) {
      keyCache.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Cleanup expired rate limit windows
 */
setInterval(() => {
  const now = Date.now();
  for (const [, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(now.toString());
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Hash an API key using SHA-256
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Extract API key from request headers
 */
function extractApiKey(req: Request): string | null {
  const key = req.headers['x-nv-api-key'];
  if (typeof key === 'string' && key.trim()) {
    return key.trim();
  }
  return null;
}

/**
 * Check and enforce rate limit for a platform
 */
function checkRateLimit(
  platformId: string,
  limit: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(platformId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(platformId, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
}

/**
 * Main API Key Validation Middleware
 * Validates X-NV-API-Key header and attaches service identity to request
 */
export async function validateServiceApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Extract API key from headers
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.status(401).json({
        success: false,
        error: {
          code: 'API_KEY_MISSING',
          message: 'X-NV-API-Key header is required for inter-service authentication',
        },
      });
      return;
    }

    // Hash the key
    const keyHash = hashApiKey(apiKey);

    // Check cache first
    const now = Date.now();
    const cached = keyCache.get(keyHash);
    if (cached && now < cached.expiresAt) {
      req.serviceIdentity = cached.identity;

      // Check rate limit
      const tierConfig = PLATFORM_TIER_CONFIG[cached.identity.platformName] || {
        tier: cached.identity.tier,
        defaultRateLimit: DEFAULT_RATE_LIMITS[cached.identity.tier] || 1000,
      };
      const rateLimit = tierConfig.defaultRateLimit;
      const rateLimitResult = checkRateLimit(cached.identity.platformId, rateLimit);

      if (!rateLimitResult.allowed) {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit of ${rateLimit} requests per minute exceeded`,
          },
        });
        res.setHeader('X-RateLimit-Limit', String(rateLimit));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('Retry-After', String(Math.ceil((rateLimitResult.resetAt - now) / 1000)));
        return;
      }

      res.setHeader('X-RateLimit-Limit', String(rateLimit));
      res.setHeader('X-RateLimit-Remaining', String(rateLimitResult.remaining));

      next();
      return;
    }

    // Database lookup
    if (!db) {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database connection unavailable',
        },
      });
      return;
    }

    const results = await db
      .select()
      .from(sdkAppApiKeys)
      .where(eq(sdkAppApiKeys.keyHash, keyHash))
      .limit(1);

    const apiKeyRecord = results[0] as SdkAppApiKeyDbRow | undefined;
    if (!apiKeyRecord) {
      res.status(403).json({
        success: false,
        error: {
          code: 'API_KEY_INVALID',
          message: 'Invalid API key',
        },
      });
      return;
    }

    // Check if key is active
    if (!apiKeyRecord.isActive) {
      res.status(403).json({
        success: false,
        error: {
          code: 'API_KEY_INACTIVE',
          message: 'API key is inactive',
        },
      });
      return;
    }

    // Check if key has been revoked
    if (apiKeyRecord.revokedAt) {
      res.status(403).json({
        success: false,
        error: {
          code: 'API_KEY_REVOKED',
          message: 'API key has been revoked',
        },
      });
      return;
    }

    // Check if key has expired
    if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
      res.status(403).json({
        success: false,
        error: {
          code: 'API_KEY_EXPIRED',
          message: 'API key has expired',
        },
      });
      return;
    }

    // Fetch application info
    const appResults = await db
      .select()
      .from(sdkApplications)
      .where(eq(sdkApplications.id, apiKeyRecord.applicationId as number))
      .limit(1);

    const appRecord = appResults[0] as SdkApplicationDbRow | undefined;
    if (!appRecord || appRecord.status !== 'active') {
      res.status(403).json({
        success: false,
        error: {
          code: 'APPLICATION_INACTIVE',
          message: 'Associated application is inactive or not found',
        },
      });
      return;
    }

    // Extract permissions from scopes
    const permissions = Array.isArray(apiKeyRecord.scopes) ? (apiKeyRecord.scopes as string[]) : [];

    // Determine tier
    const tierConfig = PLATFORM_TIER_CONFIG[appRecord.appName] || {
      tier: 'standard',
      defaultRateLimit: DEFAULT_RATE_LIMITS['standard'] || 1000,
    };

    // Build service identity
    const serviceIdentity: ServiceIdentity = {
      platformId: appRecord.clientId,
      platformName: appRecord.appName,
      tier: tierConfig.tier,
      permissions,
    };

    // Cache the validated identity
    keyCache.set(keyHash, {
      identity: serviceIdentity,
      expiresAt: now + CACHE_TTL_MS,
    });

    // Attach to request
    req.serviceIdentity = serviceIdentity;

    // Check rate limit
    const rateLimit = apiKeyRecord.rateLimitOverride ?? tierConfig.defaultRateLimit;
    const rateLimitResult = checkRateLimit(serviceIdentity.platformId, rateLimit);

    if (!rateLimitResult.allowed) {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit of ${rateLimit} requests per minute exceeded`,
        },
      });
      res.setHeader('X-RateLimit-Limit', String(rateLimit));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('Retry-After', String(Math.ceil((rateLimitResult.resetAt - now) / 1000)));
      return;
    }

    res.setHeader('X-RateLimit-Limit', String(rateLimit));
    res.setHeader('X-RateLimit-Remaining', String(rateLimitResult.remaining));

    next();
  } catch (error: any) {
    logger.error('[Inter-Service Auth] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication service error',
      },
    });
  }
}

/**
 * API Key Generation Utility
 * Generates a new inter-service API key with SHA-256 hash
 */
export function generateServiceApiKey(platformPrefix: string = 'nv'): {
  apiKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  // Generate random key (32 bytes = 256 bits)
  const randomBytes = crypto.randomBytes(32).toString('hex');

  // Create prefix from platform name (first 2-3 chars)
  const cleanPrefix = platformPrefix.replace(/[^a-z0-9]/gi, '').substring(0, 3).toLowerCase();

  // Construct full key
  const apiKey = `${cleanPrefix}_${randomBytes.substring(0, 24)}`;

  // Store prefix for identification (first 4 chars)
  const keyPrefix = apiKey.substring(0, Math.min(4, apiKey.length));

  // Hash the full key
  const keyHash = hashApiKey(apiKey);

  return {
    apiKey,
    keyHash,
    keyPrefix,
  };
}

/**
 * Utility to create a middleware that requires specific permissions
 */
export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.serviceIdentity) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Service authentication required',
        },
      });
      return;
    }

    const hasAllPermissions = requiredPermissions.every((perm) =>
      req.serviceIdentity!.permissions.includes(perm)
    );

    if (!hasAllPermissions) {
      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Missing required permissions: ${requiredPermissions.join(', ')}`,
        },
      });
      return;
    }

    next();
  };
}
