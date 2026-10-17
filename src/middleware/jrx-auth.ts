// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { SECURITY_CONFIG } from '../config/platform-config.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('auth');

const ACCESS_TOKEN_EXPIRY_HOURS = SECURITY_CONFIG.session.jwtExpiryHours;
const REFRESH_TOKEN_EXPIRY_DAYS = SECURITY_CONFIG.session.refreshTokenExpiryDays;

function getJwtSecret(): string {
  // NYV-AUDIT-A1 (2026-05-05): centralized JWT-secret resolution.
  // Accept any of NYV_JWT_SECRET, JWT_SECRET, NS_JWT_SECRET (in priority order)
  // to avoid the historical triple-naming split-brain. All three should ideally
  // hold the same value; the fallback chain protects against single-name typos.
  const secret =
    process.env.NYV_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.NS_JWT_SECRET;
  if (!secret) {
    throw new Error('FATAL: JWT secret env var (NYV_JWT_SECRET / JWT_SECRET / NS_JWT_SECRET) is required. Refusing to start with insecure defaults.');
  }
  return secret;
}

function getPool() {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

/**
 * NV-UAT-DEFAULT-ORG-001 (2026-05-13, hardened post-Task-#335 review):
 * dev/UAT defaults a missing org_id to platform-baseline org_id=1 so demo
 * flows resolve. Production MUST fail closed — silently issuing a token
 * for org 1 to a tenantless principal is a cross-tenant access vector.
 * Removed when Task #343 (sub-tenancy) lands.
 */
function devDefaultOrg(orgId: number | string | null | undefined): number | string {
  if (orgId != null && orgId !== '') return orgId as number | string;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NV-UAT-DEFAULT-ORG-001: refusing baseline org_id=1 default in production — token must carry an explicit organizationId');
  }
  return 1;
}

export function generateToken(payload: { id?: string; userId?: string; email: string; role?: string; organizationId?: number | string | null; applicationId?: number | null }): string {
  // task-367 (2026-05-13): include `applicationId` (sdk_applications.id of
  // the partner platform that owns the user's organisation) so the SDK
  // gateway JWT bypass can populate `sdkContext.applicationId` with a real
  // platform id instead of 0. Callers (login, refresh) resolve it via
  // `resolveApplicationIdForOrg(orgId)`. Omitted from the signed payload
  // when null/undefined to keep tokens identical for users with no SDK
  // application bound to their org.
  const claims: Record<string, any> = {
    userId: payload.id || payload.userId,
    email: payload.email,
    role: payload.role || 'user',
    organizationId: devDefaultOrg(payload.organizationId),
  };
  if (typeof payload.applicationId === 'number' && payload.applicationId > 0) {
    claims.applicationId = payload.applicationId;
  }
  return jwt.sign(claims, getJwtSecret(), { expiresIn: `${ACCESS_TOKEN_EXPIRY_HOURS}h` as any });
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(userId: string, refreshToken: string, userAgent?: string, ipAddress?: string): Promise<void> {
  const hashedToken = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  await getPool().query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashedToken, expiresAt, userAgent || null, ipAddress || null]
  );
}

export async function rotateRefreshToken(oldToken: string, userId: string, userAgent?: string, ipAddress?: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const oldHash = hashToken(oldToken);
  
  const db = getPool();
  const result = await db.query(
    `SELECT id, user_id, expires_at, is_revoked FROM refresh_tokens WHERE token_hash = $1`,
    [oldHash]
  );
  
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  if (result.rows.length === 0) return null;
  
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  const stored = result.rows[0];
  // @ts-expect-error NV-TS230 legacy typing gap (TS2769)
  if (stored.is_revoked || new Date(stored.expires_at) < new Date()) {
    if (!stored.is_revoked) {
      await db.query(`UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1`, [oldHash]);
    }
    return null;
  }
  
  // NV-AUTH-FIX-2026-05-10 #1: pg returns INT as JS number; route forwards JSON string.
  // Strict !== was 401-ing every legit refresh. Normalize both sides as strings.
  if (String(stored.user_id) !== String(userId)) return null;

  await db.query(`UPDATE refresh_tokens SET is_revoked = true, revoked_at = NOW() WHERE token_hash = $1`, [oldHash]);

  // NV-AUTH-FIX-2026-05-10 #2: schema is `nv_users` (NV-NAMING-001), not `users`.
  // The org-FK column is `org_id` in nv_users (verified via information_schema 2026-05-10),
  // not `organization_id` — alias to keep the downstream payload key stable.
  const userResult = await db.query(`SELECT id, email, role, org_id AS organization_id FROM nv_users WHERE id = $1`, [userId]);
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  if (userResult.rows.length === 0) return null;
  
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  const user = userResult.rows[0];

  // task-367 (2026-05-13): stamp the partner-platform applicationId onto
  // the refreshed access token so the SDK gateway JWT bypass can populate
  // `sdkContext.applicationId` immediately, without an extra DB lookup per
  // request. Resolution is best-effort — if the user's org owns no
  // sdk_applications row, the claim is omitted (and the bypass falls back
  // to its own DB lookup).
  const { resolveApplicationIdForOrg } = await import('../services/jrx-resolve-application-for-org.js');
  const orgIdNum = typeof user.organization_id === 'number' ? user.organization_id : Number(user.organization_id);
  const applicationId = await resolveApplicationIdForOrg(Number.isFinite(orgIdNum) ? orgIdNum : null);

  const newAccessToken = generateToken({
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    id: user.id,
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    email: user.email,
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    role: user.role,
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    organizationId: devDefaultOrg(user.organization_id),
    applicationId: applicationId ?? null,
  });
  
  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(userId, newRefreshToken, userAgent, ipAddress);
  
  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE refresh_tokens SET is_revoked = true, revoked_at = NOW() WHERE user_id = $1 AND is_revoked = false`,
    [userId]
  );
}

export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const result = await getPool().query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW() OR (is_revoked = true AND revoked_at < NOW() - INTERVAL \'7 days\') RETURNING id`
  );
  return result.rowCount || 0;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    username?: string;
    role?: string;
    organizationId?: number | string | null;
  };
}

const streamTokens = new Map<string, { jwt: string; expiresAt: number }>();

export function issueStreamToken(jwtToken: string): string {
  const streamId = crypto.randomUUID();
  streamTokens.set(streamId, { jwt: jwtToken, expiresAt: Date.now() + 30000 });
  return streamId;
}

function consumeStreamToken(streamId: string): string | null {
  const entry = streamTokens.get(streamId);
  if (!entry) return null;
  streamTokens.delete(streamId);
  if (Date.now() > entry.expiresAt) return null;
  return entry.jwt;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of streamTokens) {
    if (now > v.expiresAt) streamTokens.delete(k);
  }
}, 60000);

setInterval(async () => {
  try {
    const cleaned = await cleanupExpiredRefreshTokens();
    if (cleaned > 0) {
      logger.info(`[Auth] Cleaned ${cleaned} expired/revoked refresh tokens`);
    }
  } catch {}
}, 6 * 60 * 60 * 1000);

export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  try {
    /* ── Inter-service auth bypass ─────────────────────────────
       Allows trusted internal services (NSP, NSI, Nyayamitra) to
       call Core SDK without a user JWT — verified by a shared
       secret presented either as:
         - X-NSP-Inter-Secret: <secret>          (legacy header)
         - X-Inter-Service-Secret: <secret>      (alias)
         - Authorization: Bearer <secret>        (NV_API_KEY style — used by Nyayamitra)
       Accepts either NV_API_KEY or NV_INTER_SERVICE_SECRET; if
       NV_API_KEY is unset it falls back to NV_INTER_SERVICE_SECRET.
    ─────────────────────────────────────────────────────────── */
    const interServiceSecret  = (req.headers['x-nsp-inter-secret'] || req.headers['x-inter-service-secret']) as string | undefined;
    const validInterSecret    = process.env.NV_INTER_SERVICE_SECRET;
    // Collect all API keys: NV_API_KEY (legacy singular), NV_API_KEYS (comma-separated),
    // and any env var matching NV_API_KEY_* (e.g. NV_API_KEY_NSP, NV_API_KEY_NYM).
    const keyCollector: string[] = [];
    if (process.env.NV_API_KEY) keyCollector.push(process.env.NV_API_KEY);
    if (process.env.NV_API_KEYS) {
      for (const k of process.env.NV_API_KEYS.split(',')) {
        const t = k.trim();
        if (t) keyCollector.push(t);
      }
    }
    for (const [name, val] of Object.entries(process.env)) {
      if (/^NV_API_KEY_[A-Z0-9_]+$/.test(name) && typeof val === 'string' && val.trim()) {
        keyCollector.push(val.trim());
      }
    }
    if (validInterSecret) keyCollector.push(validInterSecret);
    const allowedSecrets = Array.from(new Set(keyCollector));
    const authHeaderRaw       = req.headers.authorization;
    const bearerToken         = authHeaderRaw && /^Bearer\s+/i.test(authHeaderRaw)
                                  ? authHeaderRaw.replace(/^Bearer\s+/i, '').trim()
                                  : undefined;

    if (interServiceSecret && allowedSecrets.includes(interServiceSecret)) {
      logger.info(`[nv-auth] auth_method=inter_service header=x-nsp-inter-secret`);
      req.user = {
        id:             'service-account',
        userId:         'service-account',
        email:          process.env.NYV_SERVICE_ACCOUNT_EMAIL || 'service@nyayavigya.internal',
        role:           'service',
        // NV-UAT-DEFAULT-ORG-001: service accounts default to baseline org_id=1.
        organizationId: 1,
      };
      return next();
    }

    if (bearerToken && allowedSecrets.includes(bearerToken)) {
      logger.info(`[nv-auth] auth_method=api_key header=authorization-bearer`);
      req.user = {
        id:             'service-account',
        userId:         'service-account',
        email:          process.env.NYV_SERVICE_ACCOUNT_EMAIL || 'service@nyayavigya.internal',
        role:           'service',
        // NV-UAT-DEFAULT-ORG-001: service accounts default to baseline org_id=1.
        organizationId: 1,
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.split(' ')[1];

    if (!token && req.query.stream_token && req.path.endsWith('/notifications/stream')) {
      const resolved = consumeStreamToken(req.query.stream_token as string);
      if (resolved) token = resolved;
    }
    
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token required',
        code: 'AUTH_TOKEN_MISSING'
      });
      return;
    }
    
    const decoded = jwt.verify(token, getJwtSecret()) as {
      userId: string;
      email: string;
      role: string;
      organizationId?: number | string | null;
      iat: number;
      exp: number;
    };
    
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role || 'user',
      organizationId: devDefaultOrg(decoded.organizationId),
    };
    
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Access token expired. Use refresh token to obtain a new access token.',
        code: 'AUTH_TOKEN_EXPIRED'
      });
      return;
    }
    
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        message: 'Invalid access token',
        code: 'AUTH_TOKEN_INVALID'
      });
      return;
    }
    
    res.status(401).json({
      success: false,
      message: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Optional auth — attaches req.user if a valid JWT is present, but never blocks.
 * Used to distinguish public vs authenticated rate limit tiers on the same route group.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    const decoded = jwt.verify(token, getJwtSecret()) as {
      userId: string;
      email: string;
      role: string;
      organizationId?: number | string | null;
    };
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role || 'user',
      organizationId: devDefaultOrg(decoded.organizationId),
    };
  } catch {
    // Token invalid or expired — just skip, don't block
  }
  next();
};

/**
 * Server-side role hierarchy — kept in lock-step with the client
 * `ROLE_HIERARCHY` (client/src/lib/rbac-registry.ts). A higher-or-equal
 * ranked role satisfies a lower-ranked requirement. `sme` is intentionally
 * NOT ranked here: it is hard-isolated (matching the client, which assigns it
 * rank 0 below every console minRole), so it only ever passes a check that
 * explicitly lists `sme`. Non-ranked roles (e.g. the internal `service`
 * account) likewise require an explicit listing.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  super_admin: 100,
  admin: 95,
  platform_admin: 92,
  org_admin: 90,
  manager: 80,
  senior_analyst: 70,
  analyst: 60,
  operator: 50,
  developer: 40,
  viewer: 30,
  user: 20,
  guest: 10,
};

/**
 * True when `userRole` satisfies the `allowedRoles` gate. Semantics:
 *   1. An exact match always satisfies — this preserves every existing
 *      allowed-role list, including isolated roles (`sme`) and the internal
 *      `service` account.
 *   2. Otherwise, a role ranked HIGHER-OR-EQUAL to the lowest-ranked allowed
 *      role satisfies the check (the hierarchy rule). Only roles present in
 *      ROLE_HIERARCHY participate in this comparison.
 */
export function roleSatisfies(userRole: string | undefined | null, allowedRoles: string[]): boolean {
  if (!userRole) return false;
  if (allowedRoles.includes(userRole)) return true;

  const userLevel = ROLE_HIERARCHY[userRole];
  if (userLevel === undefined) return false; // unranked/isolated role → exact match only

  const requiredLevels = allowedRoles
    .map(r => ROLE_HIERARCHY[r])
    .filter((n): n is number => typeof n === 'number');
  if (requiredLevels.length === 0) return false; // gate lists only unranked roles → exact match only

  return userLevel >= Math.min(...requiredLevels);
}

export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    if (!roleSatisfies(authReq.user.role, allowedRoles)) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${allowedRoles.join(', ')} (or higher)`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
      return;
    }

    next();
  };
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthRequest;
  if (!authReq.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
    return;
  }

  // Hierarchy-aware: admin (95) and super_admin (100) clear the bar; lower
  // tiers (platform_admin 92, org_admin 90, …) remain denied. Preserves the
  // prior ['admin','super_admin'] semantics while honouring the hierarchy.
  if (!roleSatisfies(authReq.user.role, ['admin', 'super_admin'])) {
    res.status(403).json({
      success: false,
      message: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
    return;
  }

  next();
};
