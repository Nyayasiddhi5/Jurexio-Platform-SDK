import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { eq, and, sql, gte } from 'drizzle-orm';
import { sdkAppApiKeys, sdkApplications, sdkApiRequestLogs } from '@shared/schema.js';
import { resolveApplicationIdForOrg } from '../services/jrx-resolve-application-for-org.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { SECURITY_CONFIG } from '../config/platform-config.js';
import { createLogger } from '../utils/logger.js';
import { isPlatformUatKey, platformUatLabel } from './jrx-platform-uat-bypass.js';
import { isSoftPolicyKey, runWithSoftPolicy } from './jrx-integration-soft-policy.js';
import { INDIA_ONLY_PARTNER_CODES, isNspPlatformRequest, wantsNspUnlimited } from '../utils/jrx-partner-platform.js';
import { platformFromAppType } from '../services/jrx-ecosystem-document-job-contract.js';


const logger = createLogger('sdk-gateway');

// Local row type extensions: the Drizzle schema in shared/schema.ts is a
// subset of what the live `public.sdk_app_api_keys` / `public.sdk_applications`
// tables expose at runtime (revokedAt, rateLimitOverride, deletedAt have
// been added by migrations but not back-ported into the schema file). These
// interfaces narrow the row shape we actually consume — strictly an
// extension of the inferred Drizzle row, never a blanket `any` escape.
type SdkAppApiKeyDbRow = typeof sdkAppApiKeys.$inferSelect & {
  revokedAt?: Date | null;
  rateLimitOverride?: number | null;
};
type SdkApplicationDbRow = typeof sdkApplications.$inferSelect & {
  deletedAt?: Date | null;
};

interface SdkContext {
  applicationId: number;
  organizationId: number;
  apiKeyId: number;
  appName: string;
  appType: string;
  allowedAgents: string[];
  llmConfig: Record<string, any>;
  jurisdiction: string;
  tier?: string;
  rateLimitPerMinute: number;
  dailyTokenBudget: number;
  scopes: string[];
  requestId: string;
  /** NV soft-policy: NSP/NYM integration testing — skip content/agent policy blocks. */
  softPolicy?: boolean;
  platformUatLabel?: string | null;
  /** Short partner code when resolved (NSP, NYM, JRX, …). */
  partnerPlatformCode?: string;
  // Task #343: two-tier tenancy. The platform identity (above) is augmented
  // with the downstream customer-org identity asserted by the platform via
  // X-Customer-Org-Id (auto-provisioned in nv_customer_organizations).
  // Synthesised default = applicationId × 1_000_000 when the header is
  // absent — keeps every legacy caller working until platforms migrate.
  platformId?: number;             // alias of applicationId (clarity at call sites)
  platformOrgId?: number;          // alias of organizationId (clarity at call sites)
  customerOrgId?: number;
  customerOrgName?: string;
  customerOrgExternalRef?: string;
  customerOrgIsSynthetic?: boolean;
  customerUserId?: string;
  customerUserEmail?: string;
  // Task #384: enterprise multi-product grouping. Resolved best-effort from
  // nv_super_org_platform_memberships using (platform_id, customer_org_id).
  // PURELY a grouping/UI/billing hint — RLS policy `customer_org_isolation`
  // is INTENTIONALLY unchanged and per-platform rate limits / scopes
  // continue to be enforced at (platform_id, customer_org_id). Routes that
  // want cross-product UX (the Console "switch product" picker) read this;
  // data-plane routes ignore it.
  superOrgId?: number;
  superOrgSlug?: string;
}

declare global {
  namespace Express {
    interface Request {
      sdkContext?: SdkContext;
    }
  }
}

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const apiKeyRateLimitStore = new Map<string, { count: number; windowStart: number }>();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300_000;
const MAX_REQUEST_BODY_SIZE = 1048576;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(key);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS).unref();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiKeyRateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      apiKeyRateLimitStore.delete(key);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS).unref();

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(all\s+)?previous/i,
  /override\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+if\s+you\s+are/i,
  /\bsystem\s*:/i,
  /\brole\s*:\s*(system|assistant|admin)/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,
  /pretend\s+you\s+are/i,
  /new\s+instructions\s*:/i,
  /\bDAN\s+mode\b/i,
  /jailbreak/i,
];

// NV-AUTH-HEADER-001 (2026-05-10): canonical SDK API-key extractor lives in
// src/middleware/jrx-sdk-auth-header.ts. Do NOT re-introduce a local
// extractApiKey() — it will be flagged by the auth-header-discipline CI
// guardrail (scripts/jrx-check-auth-header-discipline.sh).
import { extractSdkApiKey as extractApiKey } from './jrx-sdk-auth-header.js';
import { withSdkTenantTx } from './jrx-org-rls-middleware.js';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Task #355 — attach `req.withSdkTenant(fn)` after `req.sdkContext` is set.
 *
 * The helper opens a transaction, binds `nv.platform_id` and
 * `nv.customer_org_id` via `SET LOCAL`, and hands the pinned tx to `fn`.
 * Both GUCs revert on COMMIT/ROLLBACK so nothing leaks back to the pool.
 *
 * No-op (the helper just throws) if either id is missing — the request
 * has not been authenticated, and any DB call dressed up as tenant-scoped
 * MUST fail closed rather than silently widen the audience.
 */
function attachWithSdkTenant(req: Request): void {
  const ctx = req.sdkContext;
  if (!ctx) return;
  const platformId = ctx.platformId ?? ctx.applicationId;
  const customerOrgId = ctx.customerOrgId;
  req.withSdkTenant = async (fn) => {
    if (platformId == null || customerOrgId == null) {
      throw new Error('[SDK Gateway] withSdkTenant called without (platform_id, customer_org_id) — refusing to bind tenant');
    }
    return withSdkTenantTx(platformId, customerOrgId, fn);
  };
}

function checkRateLimit(appId: number, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const key = `sdk_app_${appId}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
}

function checkApiKeyRateLimit(apiKeyId: number, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const key = `sdk_key_${apiKeyId}`;
  const now = Date.now();
  const entry = apiKeyRateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    apiKeyRateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
}

function redactPii(text: string): string {
  let redacted = text;
  const patterns = SECURITY_CONFIG.pii.patterns;
  const redactionChar = SECURITY_CONFIG.pii.redactionChar;

  for (const [, pattern] of Object.entries(patterns) as [string, RegExp][]) {
    const regex = new RegExp(pattern.source, pattern.flags);
    redacted = redacted.replace(regex, (match: string) => redactionChar.repeat(match.length));
  }

  return redacted;
}

function redactBodyFields(body: any): any {
  if (!body || typeof body !== 'object') return body;

  if (Array.isArray(body)) {
    return body.map((item) => redactBodyFields(item));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      result[key] = redactPii(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactBodyFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function detectPromptInjection(body: any): boolean {
  if (!body || typeof body !== 'object') return false;

  const textsToScan: string[] = [];

  function extractTexts(obj: any): void {
    if (typeof obj === 'string') {
      textsToScan.push(obj);
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) extractTexts(item);
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const value of Object.values(obj)) extractTexts(value);
    }
  }

  extractTexts(body);

  for (const text of textsToScan) {
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) return true;
    }
  }

  return false;
}

// ─── Internal JWT Bypass ─────────────────────────────────────────────────────
// Dashboard users (analyst+) can call SDK intelligence routes without SDK keys.
// A valid JWT from the platform grants an internal sdkContext.

// Include `admin` — common nv_users.role for Console operators (NV-CONSOLE-JWT-DUAL-001).
const INTERNAL_JWT_ROLES = new Set(['admin', 'analyst', 'senior_analyst', 'manager', 'org_admin', 'super_admin', 'developer', 'operator']);

// Roles allowed to perform privileged cache invalidation. Task #66 deliberately
// keeps this narrower than INTERNAL_JWT_ROLES — analysts/developers/managers
// can read intelligence and run agents, but only admins/operators may flush
// the cross-tenant cache (since stale answers are a content-correction
// safety lever, not a routine read).
export const CACHE_ADMIN_ROLES = new Set(['org_admin', 'super_admin', 'operator']);

const BASE_INTERNAL_SCOPES = [
  'agents:read', 'agents:execute',
  'intelligence:read', 'intelligence:write',
  'usage:read',
  'documents:read', 'documents:write',
  'memory:read', 'memory:write',
  'cache:read', 'cache:write',
  // NV-MCP-PARTNER-AUTH-001: Console JWT users need MCP protocol routes.
  'protocols:read', 'protocols:write',
  'workflows:read', 'workflows:write',
];

/**
 * Compute the SDK gateway scopes for an internal-dashboard JWT bearer based
 * on their platform role. Exported so tests can lock in the role→scope
 * mapping without spinning up Express + DB.
 *
 * Returns an empty array for roles outside `INTERNAL_JWT_ROLES`.
 */
export function computeInternalScopesForRole(role: string | undefined): string[] {
  if (!role || !INTERNAL_JWT_ROLES.has(role)) return [];
  const scopes = [...BASE_INTERNAL_SCOPES];
  if (CACHE_ADMIN_ROLES.has(role)) scopes.push('cache:admin');
  // task-354 (2026-05-13): partner-platform admins (and Jurexio
  // super-admins) signing into the Console with a JWT need the same
  // customer-orgs:admin scope that an SDK key with `customer-orgs:admin`
  // would carry, so the Customer Orgs page can list / read usage for
  // their downstream firms. Cross-tenant isolation is still enforced
  // server-side by the `platform_id = sdkContext.applicationId` filter
  // inside `jrx-customer-orgs-routes.ts`. Mirrors classifyLayer() in
  // src/services/rbac/jrx-customer-org-rbac.ts.
  if (role === 'org_admin' || role === 'super_admin' || role === 'admin') {
    scopes.push('customer-orgs:admin');
  }
  // Console super_admin needs platform-tier readouts for Limits admin tab.
  if (role === 'super_admin' || role === 'admin') {
    scopes.push('platform:admin', 'platform:read', 'admin');
  }
  return scopes;
}

async function tryJwtBypass(req: Request, res: Response, next: NextFunction): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token || token.startsWith('nyv_')) return false; // SDK keys start with nyv_

  try {
    // Use the unified secret-resolution chain (JRX_JWT_SECRET preferred)
    // to match how generateToken() signs in src/middleware/jrx-auth.ts.
    const secret =
      process.env.JRX_JWT_SECRET ||
      process.env.JWT_SECRET ||
      process.env.NS_JWT_SECRET;
    if (!secret) return false;
    const decoded = jwt.verify(token, secret) as {
      userId?: number;
      role?: string;
      organizationId?: number;
      applicationId?: number;
    };
    if (!decoded?.role || !INTERNAL_JWT_ROLES.has(decoded.role)) return false;

    const scopes = computeInternalScopesForRole(decoded.role);

    if (decoded.organizationId == null && process.env.NODE_ENV === 'production') {
      logger.error('[SDK Gateway/JWT] Internal JWT missing organizationId — rejecting (production fail-closed)', { userId: decoded.userId, role: decoded.role });
      return false;
    }
    // Normalize: legacy tokens occasionally carry organizationId as a
    // string (the auth route used to forward the DB column verbatim).
    // Coerce to number so resolveApplicationIdForOrg's `Number.isInteger`
    // guard accepts it.
    const rawOrg: any = decoded.organizationId;
    const orgNum = typeof rawOrg === 'number'
      ? rawOrg
      : (typeof rawOrg === 'string' && rawOrg.trim() !== '' ? Number(rawOrg) : NaN);
    const organizationId = Number.isFinite(orgNum) && orgNum > 0 ? orgNum : 1;

    // task-367 (2026-05-13): resolve the partner-platform applicationId so
    // platform-scoped routes (e.g. /api/jrx/sdk/customer-orgs) actually
    // filter by the right `platform_id`. Preferred path: the JWT itself
    // carries an `applicationId` claim stamped at login. Fallback: look it
    // up in `sdk_applications` by org membership (cached). Stays at 0 only
    // when neither path resolves — downstream routes that require a
    // platform identity will then 401 via `platformIdOrFail`.
    let applicationId =
      typeof decoded.applicationId === 'number' && decoded.applicationId > 0
        ? decoded.applicationId
        : 0;
    if (applicationId === 0) {
      const resolved = await resolveApplicationIdForOrg(organizationId);
      if (resolved) applicationId = resolved;
    }

    req.sdkContext = {
      applicationId,
      // NV-UAT-DEFAULT-ORG-001 (2026-05-13, hardened): dev/UAT only —
      // production rejected above.
      organizationId,
      apiKeyId:          0,
      appName:           'Internal Dashboard',
      appType:           'internal',
      allowedAgents:     [],
      llmConfig:         { primary: 'auto', fallback: 'auto', budget_mode: 'balanced', monthly_cap_usd: 9999, alert_threshold_pct: 100 },
      jurisdiction:      'IN',
      rateLimitPerMinute: 120,
      dailyTokenBudget:  10_000_000,
      scopes,
      requestId:         crypto.randomUUID(),
      platformId:        applicationId > 0 ? applicationId : undefined,
      platformOrgId:     organizationId,
    };
    attachWithSdkTenant(req);
    next();
    return true;
  } catch {
    return false;
  }
}

export async function sdkGatewayAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestStart = Date.now();
  const requestId = crypto.randomUUID();

  // Allow internal dashboard users (JWT auth) to access SDK intelligence routes
  if (await tryJwtBypass(req, res, next)) return;

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'API_KEY_MISSING',
        message: 'API key is required. Provide via X-API-Key header or Authorization: Bearer token.',
      },
    });
    return;
  }

  if (!db) {
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database connection unavailable.',
      },
    });
    return;
  }

  const keyHash = hashApiKey(apiKey);

  let apiKeyRecord: SdkAppApiKeyDbRow | undefined;
  try {
    const results = await db
      .select()
      .from(sdkAppApiKeys)
      .where(eq(sdkAppApiKeys.keyHash, keyHash))
      .limit(1);
    apiKeyRecord = results[0] as SdkAppApiKeyDbRow | undefined;
  } catch (err: any) {
    logger.error('[SDK Gateway] Database error looking up API key:', err);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to validate API key.',
      },
    });
    return;
  }

  if (!apiKeyRecord) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'API_KEY_INVALID',
        message: 'Invalid API key.',
      },
    });
    return;
  }

  if (!apiKeyRecord.isActive) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'API_KEY_INACTIVE',
        message: 'API key is inactive.',
      },
    });
    return;
  }

  if (apiKeyRecord.revokedAt) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'API_KEY_REVOKED',
        message: 'API key has been revoked.',
      },
    });
    return;
  }

  if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt) < new Date()) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'API_KEY_EXPIRED',
        message: 'API key has expired.',
      },
    });
    return;
  }

  // Fail closed if the API key isn't bound to an application — without
  // this binding we cannot resolve the tenant, scopes, or rate limits.
  if (apiKeyRecord.applicationId == null) {
    logger.error('[SDK Gateway] API key has no applicationId — failing closed', {
      apiKeyId: apiKeyRecord.id,
    });
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'API_KEY_UNBOUND',
        message: 'API key is not bound to an application. Contact administrator.',
      },
    });
    return;
  }

  let appRecord: SdkApplicationDbRow | undefined;
  try {
    const results = await db
      .select()
      .from(sdkApplications)
      .where(
        and(
          eq(sdkApplications.id, apiKeyRecord.applicationId),
          eq(sdkApplications.status, 'active')
        )
      )
      .limit(1);
    appRecord = results[0] as SdkApplicationDbRow | undefined;
  } catch (err: any) {
    logger.error('[SDK Gateway] Database error loading application:', err);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to load application context.',
      },
    });
    return;
  }

  if (!appRecord) {
    res.status(403).json({
      success: false,
      data: null,
      error: {
        code: 'APPLICATION_INACTIVE',
        message: 'Associated SDK application is inactive or not found.',
      },
    });
    return;
  }

  if (appRecord.deletedAt) {
    res.status(403).json({
      success: false,
      data: null,
      error: {
        code: 'APPLICATION_DELETED',
        message: 'Associated SDK application has been deleted.',
      },
    });
    return;
  }

  // NV-PLATFORM-UAT-BYPASS-001 (2026-05-14): when NV_PLATFORM_UAT_BYPASS=1 AND
  // the inbound key fingerprint matches one of the 7 internal Jurexio
  // platform keys (JRX_SDK_KEY_{NSP,NSPM,NSI,NSA,NSM,NYM,JRX}), skip rate
  // limits + force scopes='*'. Auth/audit/RLS/PII/guardrails remain enforced.
  // Bypass calls are tagged with X-Platform-UAT-Bypass response header.
  // NV-PARTNER-DEMO-UNLIMITED-001 / NV-NSP-UNLIMITED-001: skip RPM + daily
  // token budget for platform UAT keys and for *any* NSP request (header /
  // appType / client id) so every NSP user gets full intelligent delivery.
  const __platformUatBypass = isPlatformUatKey(apiKey);
  const __uatLabel = platformUatLabel(apiKey);
  const __softPolicy = isSoftPolicyKey(apiKey);
  const __demoUnlimited = (() => {
    const v = String(process.env.JRX_PARTNER_DEMO_UNLIMITED ?? '1').trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off') return false;
    return isPlatformUatKey(apiKey);
  })();
  const appTypeUpper = String(appRecord.appType || appRecord.appName || '').toUpperCase();
  const fromAppType = platformFromAppType(String(appRecord.appType || ''));
  const __nspApp =
    __uatLabel === 'NSP'
    || __uatLabel === 'NSPM'
    || fromAppType === 'NSP'
    || fromAppType === 'NSPM'
    || /\bNSP\b/.test(appTypeUpper)
    || appTypeUpper.includes('PROFESSIONAL')
    || isNspPlatformRequest(req);
  const __nspUnlimited =
    __nspApp
    && !(
      String(process.env.JRX_NSP_UNLIMITED ?? '1').trim().toLowerCase() === '0'
      || String(process.env.JRX_NSP_UNLIMITED ?? '1').trim().toLowerCase() === 'false'
      || String(process.env.JRX_NSP_UNLIMITED ?? '1').trim().toLowerCase() === 'off'
    );
  const __skipProductRateLimits = __platformUatBypass || __demoUnlimited || __nspUnlimited || wantsNspUnlimited(req);

  if (__platformUatBypass) {
    res.setHeader('X-Platform-UAT-Bypass', '1');
    res.setHeader('X-Platform-UAT-Label', __uatLabel ?? 'unknown');
  }
  if (__demoUnlimited || __nspUnlimited) {
    res.setHeader('X-Partner-Demo-Unlimited', '1');
  }
  if (__nspUnlimited) {
    res.setHeader('X-NSP-Unlimited', '1');
  }
  if (__softPolicy) {
    res.setHeader('X-Platform-Soft-Policy', '1');
    res.setHeader('X-Platform-Soft-Policy-Label', __uatLabel ?? 'unknown');
  }

  const effectiveRateLimit = apiKeyRecord.rateLimitOverride ?? appRecord.rateLimitPerMinute ?? 60;
  const rateLimitResult = checkRateLimit(appRecord.id, effectiveRateLimit);

  if (!__skipProductRateLimits && !rateLimitResult.allowed) {
    res.status(429).json({
      success: false,
      data: null,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit of ${effectiveRateLimit} requests per minute exceeded.`,
      },
    });
    res.setHeader('X-RateLimit-Limit', String(effectiveRateLimit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
    return;
  }

  res.setHeader('X-RateLimit-Limit', String(__skipProductRateLimits ? 'unlimited' : effectiveRateLimit));
  res.setHeader('X-RateLimit-Remaining', String(__skipProductRateLimits ? 'unlimited' : rateLimitResult.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));

  const effectiveApiKeyRateLimit = apiKeyRecord.rateLimitOverride ?? appRecord.rateLimitPerMinute ?? 60;
  const apiKeyRateLimitResult = checkApiKeyRateLimit(apiKeyRecord.id, effectiveApiKeyRateLimit);

  if (!__skipProductRateLimits && !apiKeyRateLimitResult.allowed) {
    res.status(429).json({
      success: false,
      data: null,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit of ${effectiveApiKeyRateLimit} requests per minute exceeded for this API key.`,
      },
    });
    res.setHeader('X-RateLimit-Key-Limit', String(effectiveApiKeyRateLimit));
    res.setHeader('X-RateLimit-Key-Remaining', '0');
    res.setHeader('X-RateLimit-Key-Reset', String(Math.ceil(apiKeyRateLimitResult.resetAt / 1000)));
    return;
  }

  res.setHeader('X-RateLimit-Key-Limit', String(__skipProductRateLimits ? 'unlimited' : effectiveApiKeyRateLimit));
  res.setHeader('X-RateLimit-Key-Remaining', String(__skipProductRateLimits ? 'unlimited' : apiKeyRateLimitResult.remaining));
  res.setHeader('X-RateLimit-Key-Reset', String(Math.ceil(apiKeyRateLimitResult.resetAt / 1000)));

  if (appRecord.dailyTokenBudget) {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const usageResults = await db
        .select({
          totalTokens: sql<number>`COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0)`,
        })
        .from(sdkApiRequestLogs)
        .where(
          and(
            eq(sdkApiRequestLogs.applicationId, appRecord.id),
            gte(sdkApiRequestLogs.createdAt, todayStart)
          )
        );

      const totalTokensUsed = Number(usageResults[0]?.totalTokens ?? 0);

      if (!__softPolicy && !__skipProductRateLimits && totalTokensUsed >= appRecord.dailyTokenBudget) {
        res.status(429).json({
          success: false,
          data: null,
          error: {
            code: 'DAILY_TOKEN_BUDGET_EXCEEDED',
            message: `Daily token budget of ${appRecord.dailyTokenBudget} tokens has been exceeded.`,
          },
        });
        return;
      }
    } catch (err: any) {
      logger.error('[SDK Gateway] Error checking daily token budget:', err);
    }
  }

  if (req.body && typeof req.body === 'object') {
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > MAX_REQUEST_BODY_SIZE) {
      res.status(413).json({
        success: false,
        data: null,
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: `Request body exceeds maximum size of ${MAX_REQUEST_BODY_SIZE} bytes. Current size: ${bodySize} bytes.`,
        },
      });
      return;
    }

    if (!__softPolicy && detectPromptInjection(req.body)) {
      res.status(403).json({
        success: false,
        data: null,
        error: {
          code: 'PROMPT_INJECTION_DETECTED',
          message: 'Request contains potentially malicious prompt injection patterns.',
        },
      });
      return;
    }

    req.body = redactBodyFields(req.body);
  }

  const scopes = (Array.isArray(apiKeyRecord.scopes) ? apiKeyRecord.scopes : []) as string[];
  // NV-PLATFORM-UAT-BYPASS-001: inject wildcard scope so all 76 checkScope()
  // call sites (which already accept '*' as a wildcard) pass without per-site
  // edits. Only effective for the 7 internal Jurexio platform fingerprints.
  if (__platformUatBypass && !scopes.includes('*')) {
    scopes.push('*');
  }
  // NV-NSP-SCOPE-STAR-001: NSP unlimited delivery must never 403 on missing
  // documents:/voice:/multimodal: scopes — Pro AI paths depend on full access.
  if ((__nspUnlimited || wantsNspUnlimited(req) || __softPolicy) && !scopes.includes('*')) {
    scopes.push('*');
  }
  // Soft policy (NSP/NYM): open agent allowlist so any agentId succeeds.
  const allowedAgents = __softPolicy
    ? ([] as string[])
    : ((Array.isArray(appRecord.allowedAgents) ? appRecord.allowedAgents : []) as string[]);
  const llmConfig = (appRecord.llmConfig && typeof appRecord.llmConfig === 'object' ? appRecord.llmConfig : {}) as Record<string, any>;

  // NV-UAT-DEFAULT-ORG-001 (2026-05-13, hardened post-Task-#335 review):
  // dev/UAT may default a missing organization_id to baseline org_id=1
  // (Jurexio Technologies) so demo flows resolve. Production MUST
  // fail closed — silently mapping a tenantless SDK app to org 1 would
  // be a cross-tenant access vector. See Tracker doc 10 + Task #343.
  if (appRecord.organizationId == null && process.env.NODE_ENV === 'production') {
    logger.error('[SDK Gateway] Application missing organization_id — rejecting (production fail-closed)', {
      applicationId: appRecord.id,
      appName: appRecord.appName,
    });
    res.status(403).json({ success: false, error: 'sdk_application_missing_org_binding', message: 'SDK application has no organization binding; contact administrator.' });
    return;
  }
  const effectiveOrgId = appRecord.organizationId ?? 1;
  if (appRecord.organizationId == null) {
    logger.warn('[SDK Gateway] Application missing organization_id — UAT default applied (org_id=1)', {
      applicationId: appRecord.id,
      appName: appRecord.appName,
    });
  }

  // Task #343: resolve (and auto-provision) the downstream customer org from
  // the X-Customer-Org-Id header. Failures fall back to the per-platform
  // synthetic default so legacy callers keep working.
  let customerOrg;
  try {
    const { resolveCustomerOrg } = await import('../services/jrx-customer-org-service.js');
    customerOrg = await resolveCustomerOrg(appRecord.id, req);
  } catch (err: any) {
    logger.warn('[SDK Gateway] customer org resolution failed; using synthetic default', { err: err?.message });
    customerOrg = {
      customerOrgId: appRecord.id * 1_000_000,
      customerOrgName: '__default__',
      externalRef: '__default__',
      isSynthetic: true,
    };
  }

  // Task #384: best-effort super-org lookup. Failures are non-fatal — this
  // is a UI/billing hint, not a security boundary. The lookup is wrapped in
  // a try/catch and a NULL result simply means "this tenant isn't grouped
  // under an enterprise super-org" (the legacy single-product world).
  let superOrgInfo: { id: number; slug: string } | null = null;
  try {
    if (db && customerOrg.customerOrgId && !customerOrg.isSynthetic) {
      const r: any = await db.execute(sql`
        SELECT s.id, s.slug
          FROM nv_super_org_platform_memberships m
          JOIN nv_super_orgs s ON s.id = m.super_org_id
         WHERE m.platform_id = ${appRecord.id}
           AND m.customer_org_id = ${customerOrg.customerOrgId}
         LIMIT 1
      `);
      const row = r?.rows?.[0] ?? r?.[0] ?? null;
      if (row?.id) superOrgInfo = { id: Number(row.id), slug: String(row.slug) };
    }
  } catch (err: any) {
    // Swallow — tables may not exist yet on envs that haven't run 0015.
    logger.debug?.('[SDK Gateway] super_org lookup skipped', { err: err?.message });
  }

  req.sdkContext = {
    applicationId: appRecord.id,
    organizationId: effectiveOrgId,
    apiKeyId: apiKeyRecord.id,
    appName: appRecord.appName,
    appType: appRecord.appType,
    allowedAgents,
    llmConfig,
    jurisdiction: appRecord.jurisdiction ?? 'IN',
    rateLimitPerMinute: __skipProductRateLimits ? 0 : effectiveRateLimit,
    dailyTokenBudget: __skipProductRateLimits ? 0 : (appRecord.dailyTokenBudget ?? 100000),
    scopes,
    requestId,
    softPolicy: __softPolicy,
    platformUatLabel: __uatLabel || (__nspApp ? 'NSP' : null),
    platformId: appRecord.id,
    platformOrgId: effectiveOrgId,
    customerOrgId: customerOrg.customerOrgId,
    customerOrgName: customerOrg.customerOrgName,
    customerOrgExternalRef: customerOrg.externalRef,
    customerOrgIsSynthetic: customerOrg.isSynthetic,
    customerUserId: customerOrg.customerUserId,
    customerUserEmail: customerOrg.customerUserEmail,
    superOrgId: superOrgInfo?.id,
    superOrgSlug: superOrgInfo?.slug,
  };

  // NV-PARTNER-INDIA-SCOPE-001 — NSP/NYM are India-only products.
  {
    const uat = (__uatLabel || (__nspApp ? 'NSP' : '')).toUpperCase();
    const fromType = platformFromAppType(appRecord.appType)?.toUpperCase?.() || '';
    const code = (uat && INDIA_ONLY_PARTNER_CODES.has(uat) ? uat : null)
      || (INDIA_ONLY_PARTNER_CODES.has(fromType) ? fromType : null)
      || (__nspApp ? 'NSP' : null);
    if (code) {
      req.sdkContext.jurisdiction = 'IN';
      req.sdkContext.partnerPlatformCode = code;
    } else if (uat) {
      req.sdkContext.partnerPlatformCode = uat;
    } else if (fromType) {
      req.sdkContext.partnerPlatformCode = fromType;
    }
  }

  // Task #355 — bind the per-request two-tier RLS helper. Routes opt in by
  // wrapping their DB work with `await req.withSdkTenant(async (tx) => ...)`,
  // which opens a transaction and runs `SET LOCAL nv.platform_id = ...` +
  // `SET LOCAL nv.customer_org_id = ...` on the pinned connection so the
  // strict policies installed by drizzle/0013_customer_org_rls.sql filter
  // rows correctly.
  attachWithSdkTenant(req);

  // The runtime table carries `last_used_ip` (added by migration) but the
  // Drizzle schema doesn't declare it. Build the update payload via a
  // narrow extension type rather than `as any`.
  const apiKeyUpdate: Partial<typeof sdkAppApiKeys.$inferInsert> & { lastUsedIp?: string } = {
    lastUsedAt: new Date(),
    lastUsedIp: req.ip || req.socket.remoteAddress || 'unknown',
  };
  db.update(sdkAppApiKeys)
    .set(apiKeyUpdate)
    .where(eq(sdkAppApiKeys.id, apiKeyRecord.id))
    .catch((err: unknown) => logger.error('[SDK Gateway] Failed to update API key last used:', err));

  res.on('finish', () => {
    const latencyMs = Date.now() - requestStart;

    if (!db) return;

    // JRX-P1-ORCH-CORE-001 (item B): wire the REAL per-request token + cost
    // figures accumulated by jrx-request-usage-context (recordLlmUsage →
    // res.locals.nvUsage) into the request log. Previously this writer
    // hard-coded tokensIn:0/tokensOut:0, so SDK usage/billing dashboards
    // (and the daily-budget check above, which SUMs tokens_in+tokens_out)
    // always saw zero. We read res.locals.nvUsage — the same accumulator the
    // activity publisher reads on finish — because the AsyncLocalStorage
    // context does not survive to the 'finish' event, but the object pinned
    // on res.locals does. Null/0 for non-LLM routes, which is correct.
    const __usage = res.locals?.nvUsage as
      | { promptTokens?: number; completionTokens?: number; costUsd?: number; model?: string; provider?: string }
      | undefined;
    const __tokensIn = Math.max(0, Math.floor(Number(__usage?.promptTokens) || 0));
    const __tokensOut = Math.max(0, Math.floor(Number(__usage?.completionTokens) || 0));
    const __costUsd = Math.max(0, Number(__usage?.costUsd) || 0);

    // ── B2 (2026-05-05): writer aligned to canonical public.sdk_api_request_logs ──
    // Previously wrote `tokensUsed`/`estimatedCost`/`ipAddress`/`userAgent`/
    // `errorMessage`/`organizationId` keys that DO NOT EXIST on the Drizzle
    // schema (shared/schema.ts:144) — Drizzle silently dropped them. Now
    // writes only declared columns; everything else lives in `metadata` jsonb.
    // See docs/v3.1.2/JRX-DATABASE-CANONICAL-2026-05-05.md §3 for the full
    // column-shape table-of-truth.
    // Task #343: stamp customer_org_id on the request log so the audit
    // chain shows the FULL identity (platform=<app> customer_org=<co>
    // user=<email>). The column is added by drizzle/0012_*.sql; on envs
    // that haven't run the migration yet the typed insert below silently
    // omits the field (it's not on the Drizzle schema), and a follow-up
    // raw SQL UPDATE-by-request_id stamps it. We accept the eventual-
    // consistency window so a missing migration never 500s the request.
    db.insert(sdkApiRequestLogs)
      .values({
        applicationId: appRecord.id,
        apiKeyId: apiKeyRecord.id,
        requestId,
        endpoint: req.originalUrl || req.url,
        method: req.method,
        statusCode: res.statusCode,
        latencyMs,
        tokensIn: __tokensIn,
        tokensOut: __tokensOut,
        metadata: {
          appName: appRecord.appName,
          jurisdiction: appRecord.jurisdiction,
          keyPrefix: apiKeyRecord.keyPrefix,
          orgId: appRecord.organizationId,
          costUsd: __costUsd,
          ...(__usage?.model ? { model: __usage.model } : {}),
          ...(__usage?.provider ? { provider: __usage.provider } : {}),
          customerOrgId: req.sdkContext?.customerOrgId ?? null,
          customerOrgExternalRef: req.sdkContext?.customerOrgExternalRef ?? null,
          customerOrgIsSynthetic: req.sdkContext?.customerOrgIsSynthetic ?? null,
          customerUserId: req.sdkContext?.customerUserId ?? null,
          customerUserEmail: req.sdkContext?.customerUserEmail ?? null,
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          errorMessage: res.statusCode >= 400 ? res.statusMessage || null : null,
        },
      })
      .then(() => {
        // Best-effort stamp on the dedicated column (NULL-safe, additive).
        const cid = req.sdkContext?.customerOrgId;
        if (cid && db) {
          return db.execute(sql`
            UPDATE sdk_api_request_logs
               SET customer_org_id = ${cid}
             WHERE request_id = ${requestId}
               AND customer_org_id IS NULL
          `).catch(() => undefined);
        }
        return undefined;
      })
      .catch((err: unknown) => logger.error('[SDK Gateway] Failed to log request:', err));

    // Webhook fan-out — only for successful 2xx responses on the well-known
    // completion endpoints. Lazy-import to avoid a circular dep with services.
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const url = req.originalUrl || req.url || '';
      const isCompletion =
        /\/agents\/[^/]+\/execute(\?|$)/.test(url) ||
        /\/documents\/(analyze|draft)(\?|$)/.test(url) ||
        /\/orchestrate(\?|$)/.test(url);
      if (isCompletion) {
        import('../services/sdk/sdk-webhook-listener.js')
          .then(({ fireOrchestrationCompletedWebhook }) =>
            fireOrchestrationCompletedWebhook(appRecord.id, {
              orchestrationId: requestId,
              endpoint: url,
              metadata: { latencyMs, method: req.method },
            }),
          )
          .catch((err: unknown) =>
            logger.warn('[SDK Gateway] webhook fan-out failed', {
              err: err instanceof Error ? err.message : String(err),
            }),
          );
      }
    }
  });

  // Bind soft-policy ALS for the rest of the request (guardrails + LLM path).
  runWithSoftPolicy(__softPolicy, __uatLabel, () => next());
}
