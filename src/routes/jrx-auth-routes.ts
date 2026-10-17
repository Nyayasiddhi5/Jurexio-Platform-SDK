// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { generateToken, authenticateToken, generateRefreshToken, storeRefreshToken, rotateRefreshToken, revokeAllRefreshTokens } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { findUserByEmailForLogin, findUserByIdForSession, touchLastLogin } from '../db/jrx-auth-db.js';
import { sql } from 'drizzle-orm';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
import { createLogger } from '../utils/logger.js';
import { SECURITY_CONFIG } from '../config/platform-config.js';


const logger = createLogger('auth-routes');

// NV-AUTH-LIFETIME-2026-05-10: derive expiresIn (seconds) from session config
// instead of the previously hard-coded 14400 (= 4h). Single source of truth.
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = SECURITY_CONFIG.session.jwtExpiryHours * 3600;

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, firstName, lastName } = req.body;

    if (!email || !password) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Email and password required' });
      return;
    }

    if (!db) {
      sendApiError(res, 'DB_UNAVAILABLE');
      return;
    }

    const existingUser = await db.execute(sql`SELECT id FROM nv_users WHERE email = ${email}`);
    if ((existingUser.rows || existingUser).length > 0) {
      safeError(res, 'User already exists', 409);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || name || null;

    const result = await db.execute(sql`
      INSERT INTO nv_users (email, password_hash, full_name, role, tier)
      VALUES (${email}, ${hashedPassword}, ${fullName}, 'user', 'solo')
      RETURNING id, email, role, full_name, tier
    `);

    const newUser = (result.rows || result)[0];
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const token = generateToken({ id: newUser.id, email: newUser.email, role: newUser.role, organizationId: null });
    const refreshToken = generateRefreshToken();
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await storeRefreshToken(newUser.id, refreshToken, req.headers['user-agent'], req.ip || undefined);

    res.status(201).json({
      success: true,
      user: { id: newUser.id, email: newUser.email, name: newUser.full_name || email, role: newUser.role },
      token,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    });
  } catch (error: any) {
    logger.error('Registration error:', error);
    safeError(res, 'Registration failed', 500);
  }
});

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Email and password required' });
      return;
    }

    if (!db) {
      sendApiError(res, 'DB_UNAVAILABLE');
      return;
    }

    const existingUser = await db.execute(sql`SELECT id FROM nv_users WHERE email = ${email}`);
    if ((existingUser.rows || existingUser).length > 0) {
      safeError(res, 'User already exists with this email', 409);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.execute(sql`
      INSERT INTO nv_users (email, password_hash, full_name, role, tier)
      VALUES (${email}, ${hashedPassword}, ${name || null}, 'user', 'solo')
      RETURNING id, email, role, full_name, tier
    `);

    const newUser = (result.rows || result)[0];
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const token = generateToken({ id: newUser.id, email: newUser.email, role: newUser.role, organizationId: null });

    res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.full_name || email,
        role: newUser.role,
        subscriptionTier: newUser.tier || 'solo',
        subscriptionStatus: 'active'
      },
      token
    });
  } catch (error: any) {
    logger.error('Signup error:', error);
    safeError(res, 'Signup failed', 500);
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Email and password required' });
      return;
    }

    if (!db) {
      sendApiError(res, 'DB_UNAVAILABLE');
      return;
    }

    const user = await findUserByEmailForLogin(email);
    if (!user) {
      sendApiError(res, 'UNAUTHORIZED');
      return;
    }

    if (!user.is_active) {
      safeError(res, 'Account is deactivated', 401);
      return;
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      sendApiError(res, 'UNAUTHORIZED');
      return;
    }

    await touchLastLogin(user.id, user.org_id);

    // task-367 (2026-05-13): resolve the partner-platform applicationId
    // (sdk_applications.id by org membership) and stamp it onto the JWT
    // so the SDK gateway bypass can populate sdkContext.applicationId
    // immediately. Skipped silently when the user's org owns no
    // sdk_applications row.
    const { resolveApplicationIdForOrg } = await import('../services/jrx-resolve-application-for-org.js');
    const orgIdNum = typeof user.org_id === 'number' ? user.org_id : Number(user.org_id);
    const applicationId = await resolveApplicationIdForOrg(Number.isFinite(orgIdNum) ? orgIdNum : null);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    const token = generateToken({ id: user.id, email: user.email, role: user.role, organizationId: user.org_id, applicationId: applicationId ?? null });
    const refreshToken = generateRefreshToken();
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    await storeRefreshToken(user.id, refreshToken, req.headers['user-agent'], req.ip || undefined);

    res.json({
      success: true,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.full_name || user.email,
        role: user.role,
        avatarUrl: null,
        subscriptionTier: user.tier || 'solo',
        subscriptionStatus: 'active',
        organizationId: user.org_id
      },
      token,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    });
  } catch (error: any) {
    logger.error('Login error:', error);
    safeError(res, 'Login failed', 500);
  }
});

router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendApiError(res, 'UNAUTHORIZED');
      return;
    }

    const token = authHeader.split(' ')[1];
    const jwt = await import('jsonwebtoken');
    // JRX-AUTH-FIX (2026-05-05): use the SAME secret-resolution chain as
    // generateToken() in src/middleware/jrx-auth.ts. Previously this read
    // only JWT_SECRET, while login signs with JRX_JWT_SECRET (preferred) →
    // every browser session was 401'd and immediately logged out.
    const secret =
      process.env.JRX_JWT_SECRET ||
      process.env.JWT_SECRET ||
      process.env.NS_JWT_SECRET;
    if (!secret) { safeError(res, 'Server configuration error', 500); return; }
    
    let decoded: any;
    try {
      decoded = jwt.default.verify(token, secret);
    } catch {
      safeError(res, 'Invalid token', 401);
      return;
    }

    const userId = decoded.userId || decoded.id;
    const orgHint = decoded.organizationId ?? decoded.org_id ?? null;
    const user = await findUserByIdForSession(userId, orgHint);
    if (!user) {
      safeError(res, 'User not found', 404);
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name || user.email,
        role: user.role,
        avatarUrl: null,
        subscriptionTier: user.tier || 'solo',
        subscriptionStatus: 'active',
        organizationId: user.org_id
      }
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Auth me error', { message: err.message.slice(0, 240), name: err.name });
    safeError(res, 'Failed to get user info', 500);
  }
});

router.get('/providers', async (_req: Request, res: Response) => {
  res.json({
    google: !!process.env.GOOGLE_CLIENT_ID,
    github: !!process.env.GITHUB_CLIENT_ID
  });
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken, userId } = req.body;
    if (!refreshToken || !userId) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Refresh token and userId are required' });
      return;
    }

    const result = await rotateRefreshToken(refreshToken, userId, req.headers['user-agent'], req.ip || undefined);
    if (!result) {
      sendApiError(res, 'UNAUTHORIZED', { overrideMessage: 'Invalid or expired refresh token' });
      return;
    }

    res.json({
      success: true,
      token: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    });
  } catch (error: any) {
    logger.error('Token refresh error:', error);
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'Token refresh failed' });
  }
});

router.post('/logout', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (userId) {
      await revokeAllRefreshTokens(userId);
    }
    res.json({ success: true, message: 'Logged out successfully. All sessions revoked.' });
  } catch (error: any) {
    res.json({ success: true, message: 'Logged out successfully' });
  }
});

const otpStore: Record<string, { code: string; expiresAt: number; attempts: number }> = {};

router.post('/otp/send', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Phone number is required' });
      return;
    }

    const code = (100000 + (parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 5), 16) % 900000)).toString();
    otpStore[phone] = { code, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 };

    logger.info(`[OTP] Code for ${phone}: ${code} (dev mode)`);

    res.json({
      success: true,
      data: {
        message: 'OTP sent successfully',
        expires_in: 300,
        ...(process.env.NODE_ENV !== 'production' ? { dev_code: code } : {}),
      }
    });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/otp/verify', async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Phone and OTP are required' });
      return;
    }

    const stored = otpStore[phone];
    if (!stored) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'No OTP found for this number. Please request a new one.' });
      return;
    }

    if (stored.attempts >= 5) {
      delete otpStore[phone];
      sendApiError(res, 'RATE_LIMIT_EXCEEDED', { status: 429 });
      return;
    }

    if (Date.now() > stored.expiresAt) {
      delete otpStore[phone];
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'OTP has expired. Please request a new one.' });
      return;
    }

    stored.attempts++;

    if (stored.code !== otp) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Invalid OTP' });
      return;
    }

    delete otpStore[phone];
    res.json({ success: true, data: { verified: true, message: 'Phone number verified successfully' } });
  } catch (error: any) {
    safeError(res, error, 500);
  }
});

router.post('/api-key', async (req: Request, res: Response) => {
  try {
    const { name, permissions } = req.body;
    const apiKey = `jurexio_${Buffer.from(Date.now().toString()).toString('base64').replace(/=/g, '')}`;

    res.json({
      success: true,
      apiKey,
      name: name || 'Default API Key',
      permissions: permissions || ['read', 'write'],
      createdAt: new Date().toISOString()
    });
  } catch (error: any) {
    safeError(res, 'API key generation failed', 500);
  }
});

export { router as authRouter };
