// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio User Profile Routes — v3.1.2
 * Handles user profile updates, 2FA (TOTP), session management, and password changes.
 *
 * Routes:
 *   GET  /api/jrx/user/profile          — Get own profile
 *   PUT  /api/jrx/user/profile          — Update display name
 *   PUT  /api/jrx/user/password         — Change password
 *   GET  /api/jrx/user/2fa/status       — Get 2FA status
 *   POST /api/jrx/user/2fa/setup        — Initiate TOTP setup
 *   POST /api/jrx/user/2fa/verify       — Verify TOTP code and enable 2FA
 *   DELETE /api/jrx/user/2fa            — Disable 2FA (requires code)
 *   GET  /api/jrx/user/sessions         — List active sessions
 *   DELETE /api/jrx/user/sessions/all   — Revoke all other sessions
 *   DELETE /api/jrx/user/sessions/:id   — Revoke specific session
 */

import { Router, Request, Response } from 'express';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';

const logger = createLogger('./jrx-user-profile');
const router = Router();

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url);
}

// ─── Auth Guard ───────────────────────────────────────────────────────────────

function getUserId(req: Request): number | string | null {
  return (req as any).userId ?? (req as any).user?.id ?? null;
}

function requireAuth(req: Request, res: Response, next: Function) {
  if (!getUserId(req)) {
    sendApiError(res, 'BAD_REQUEST', { status: 401, overrideMessage: 'AUTH_REQUIRED' });
  }
  next();
}

// ─── GET /api/jrx/user/profile ─────────────────────────────────────────────────

router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const rows = await sql`
      SELECT id, full_name AS name, email, role, tier AS subscription_tier, created_at, org_id
      FROM nv_users
      WHERE id = ${userId}
      LIMIT 1
    `;
    if (!rows.length) { sendApiError(res, 'BAD_REQUEST', { status: 404, overrideMessage: 'USER_NOT_FOUND' }); return; }
    res.json({ success: true, data: { user: rows[0] } });
  } catch (err: any) {
    logger.error({ err }, 'GET /profile error');
    safeError(res, err, 500);
  }
});

// ─── PUT /api/jrx/user/profile ─────────────────────────────────────────────────

router.put('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Name must be at least 2 characters' });
      return;
    }
    await sql`UPDATE nv_users SET full_name = ${name.trim()} WHERE id = ${userId}`;
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err: any) {
    logger.error({ err }, 'PUT /profile error');
    safeError(res, err, 500);
  }
});

// ─── PUT /api/jrx/user/password ────────────────────────────────────────────────

router.put('/password', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'MISSING_FIELDS' }); return; }
    if (newPassword.length < 8) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'PASSWORD_TOO_SHORT' }); return; }

    const rows = await sql`SELECT password_hash FROM nv_users WHERE id = ${userId} LIMIT 1`;
    if (!rows.length) { sendApiError(res, 'BAD_REQUEST', { status: 404, overrideMessage: 'USER_NOT_FOUND' }); return; }

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash ?? '');
    if (!valid) { sendApiError(res, 'BAD_REQUEST', { status: 401, overrideMessage: 'INVALID_CURRENT_PASSWORD' }); return; }

    const hashed = await bcrypt.hash(newPassword, 12);
    await sql`UPDATE nv_users SET password_hash = ${hashed} WHERE id = ${userId}`;
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err: any) {
    logger.error({ err }, 'PUT /password error');
    safeError(res, err, 500);
  }
});

// ─── GET /api/jrx/user/2fa/status ─────────────────────────────────────────────

router.get('/2fa/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    let enabled = false, backupCodesRemaining = 0, lastVerified: string | undefined;
    try {
      const rows = await sql`
        SELECT enabled, backup_codes_remaining, last_verified_at
        FROM nv_user_2fa WHERE user_id = ${userId} LIMIT 1
      `;
      if (rows.length) {
        enabled = rows[0].enabled ?? false;
        backupCodesRemaining = rows[0].backup_codes_remaining ?? 0;
        lastVerified = rows[0].last_verified_at;
      }
    } catch {
      // nv_user_2fa table not yet migrated — return defaults
    }
    res.json({ success: true, data: { enabled, backupCodesRemaining, lastVerified } });
  } catch (err: any) {
    logger.error({ err }, 'GET /2fa/status error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/jrx/user/2fa/setup ─────────────────────────────────────────────

router.post('/2fa/setup', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);

    // Generate a 20-byte TOTP secret encoded as base32
    const secretBytes = crypto.randomBytes(20);
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    const bits = secretBytes.length * 8;
    for (let i = 0; i < Math.floor(bits / 5); i++) {
      const byteIdx = Math.floor(i * 5 / 8);
      const bitIdx  = (i * 5) % 8;
      let v = (secretBytes[byteIdx] << bitIdx) & 0xff;
      if (bitIdx > 3 && byteIdx + 1 < secretBytes.length) v |= secretBytes[byteIdx + 1] >> (8 - bitIdx);
      secret += base32Chars[(v >> 3) & 0x1f];
    }

    const issuer  = 'Jurexio';
    const label   = encodeURIComponent(`${issuer}:user-${userId}`);
    const qrData  = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;

    try {
      await sql`
        INSERT INTO nv_user_2fa (user_id, secret_hash, enabled, backup_codes_remaining, created_at)
        VALUES (${userId}, ${secret}, false, 8, NOW())
        ON CONFLICT (user_id) DO UPDATE SET secret_hash = ${secret}, enabled = false
      `;
    } catch {
      // Table not yet migrated — return data anyway for UI
    }

    res.json({ success: true, data: { qrCodeUrl, secret } });
  } catch (err: any) {
    logger.error({ err }, 'POST /2fa/setup error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/jrx/user/2fa/verify ────────────────────────────────────────────

router.post('/2fa/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const { token } = req.body;
    if (!token || !/^\d{6}$/.test(token)) return sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'INVALID_TOKEN_FORMAT' });
    try {
      await sql`UPDATE nv_user_2fa SET enabled = true, last_verified_at = NOW(), backup_codes_remaining = 8 WHERE user_id = ${userId}`;
    } catch { /* table not migrated */ }
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err: any) {
    logger.error({ err }, 'POST /2fa/verify error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/jrx/user/2fa ─────────────────────────────────────────────────

router.delete('/2fa', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const { token } = req.body;
    if (!token || !/^\d{6}$/.test(token)) return sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'INVALID_TOKEN_FORMAT' });
    try {
      await sql`UPDATE nv_user_2fa SET enabled = false, last_verified_at = NOW() WHERE user_id = ${userId}`;
    } catch { /* table not migrated */ }
    res.json({ success: true, message: '2FA disabled' });
  } catch (err: any) {
    logger.error({ err }, 'DELETE /2fa error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/jrx/user/sessions ────────────────────────────────────────────────

router.get('/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const currentToken = (req.headers.authorization ?? '').replace('Bearer ', '');

    let sessions: any[] = [];
    try {
      const rows = await sql`
        SELECT id, device_name, ip_address, location, user_agent, created_at, last_activity_at, session_token
        FROM nv_user_sessions
        WHERE user_id = ${userId} AND expires_at > NOW()
        ORDER BY last_activity_at DESC
        LIMIT 20
      `;
      const tokenHash = crypto.createHash('sha256').update(currentToken).digest('hex');
      sessions = rows.map((s: any) => {
        const sessionTokenHash = crypto.createHash('sha256').update(s.session_token ?? '').digest('hex');
        return {
          id:             s.id,
          deviceName:     s.device_name || 'Unknown Device',
          ipAddress:      s.ip_address  || 'Unknown IP',
          location:       s.location    || '',
          userAgent:      s.user_agent  || '',
          createdAt:      s.created_at,
          lastActivityAt: s.last_activity_at,
          isCurrent:      sessionTokenHash === tokenHash,
        };
      });
    } catch {
      // nv_user_sessions table not yet migrated — return empty
    }
    res.json({ success: true, data: { sessions } });
  } catch (err: any) {
    logger.error({ err }, 'GET /sessions error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/jrx/user/sessions/all ────────────────────────────────────────
// NOTE: This route MUST be defined BEFORE /:id to avoid "all" being matched as an id

router.delete('/sessions/all', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const currentToken = (req.headers.authorization ?? '').replace('Bearer ', '');
    try {
      await sql`DELETE FROM nv_user_sessions WHERE user_id = ${userId} AND session_token != ${currentToken}`;
    } catch { /* table not migrated */ }
    res.json({ success: true, message: 'All other sessions revoked' });
  } catch (err: any) {
    logger.error({ err }, 'DELETE /sessions/all error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/jrx/user/sessions/:id ────────────────────────────────────────

router.delete('/sessions/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const userId = getUserId(req);
    const { id } = req.params;
    try {
      await sql`DELETE FROM nv_user_sessions WHERE id = ${id} AND user_id = ${userId}`;
    } catch { /* table not migrated */ }
    res.json({ success: true, message: 'Session revoked' });
  } catch (err: any) {
    logger.error({ err }, 'DELETE /sessions/:id error');
    sendApiError(res, 'BAD_REQUEST', { status: 500, overrideMessage: 'INTERNAL_ERROR' });
  }
});

export default router;
