// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NV SDK — API Key Management
 * Platform clients (NSP, NSI, Nyayamitra) can generate and manage SDK keys.
 * Stores keys in nv_org_api_keys table with per-key rate limits and usage metering.
 */

import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { pool as _raw_pool } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { sendApiError, safeError } from '../utils/jrx-api-error.js';
const pool = lazyRequire(() => _raw_pool, 'pool');
import { createLogger } from '../utils/logger.js';
import { writeAuditLog } from '../middleware/jrx-sdk-tracking-middleware.js';
import { rotateApiKey, ApiKeyRotationError, DEFAULT_GRACE_DAYS } from '../services/jrx-api-key-rotation-service.js';


const logger = createLogger('api-keys-routes');

const router = Router();

function generateApiKey(platform: string, tier?: string): { key: string; keyHash: string; prefix: string } {
  const raw = randomBytes(32).toString('hex');
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const prefix = `nyv_${env}_sk_`;
  const key = `${prefix}${raw}`;
  const keyHash = createHash('sha256').update(key).digest('hex');
  return { key, keyHash, prefix };
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nv_org_api_keys (
      id           SERIAL PRIMARY KEY,
      org_id       INTEGER NOT NULL,
      name         VARCHAR(120) NOT NULL,
      key_hash     VARCHAR(64) NOT NULL UNIQUE,
      key_prefix   VARCHAR(30) NOT NULL,
      platform     VARCHAR(30) NOT NULL DEFAULT 'custom',
      tier         VARCHAR(20) NOT NULL DEFAULT 'pro',
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 200,
      requests_this_month   INTEGER NOT NULL DEFAULT 0,
      requests_total        INTEGER NOT NULL DEFAULT 0,
      tokens_this_month     BIGINT  NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      is_active    BOOLEAN NOT NULL DEFAULT true,
      expires_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_nv_org_api_keys_hash ON nv_org_api_keys (key_hash);
    CREATE INDEX IF NOT EXISTS idx_nv_org_api_keys_org  ON nv_org_api_keys (org_id);
    CREATE TABLE IF NOT EXISTS nv_org_api_usage_log (
      id          SERIAL PRIMARY KEY,
      api_key_id  INTEGER REFERENCES nv_org_api_keys(id) ON DELETE SET NULL,
      org_id      INTEGER NOT NULL,
      agent_key   VARCHAR(100),
      model       VARCHAR(80),
      tokens_used INTEGER NOT NULL DEFAULT 0,
      latency_ms  INTEGER,
      status      VARCHAR(20) DEFAULT 'success',
      used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_nv_org_api_usage_key ON nv_org_api_usage_log (api_key_id, used_at);
  `);
}

/* ── GET / — list org keys ──────────────────── */
router.get('/', authenticateToken as any, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const orgId = req.user?.orgId || req.user?.organizationId || 1;
    const rows = await pool.query(
      `SELECT id, name, key_prefix, platform, tier, rate_limit_per_minute,
              requests_this_month, requests_total, last_used_at, is_active, created_at, expires_at
       FROM nv_org_api_keys
       WHERE org_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [orgId]
    );
    res.json({ success: true, data: rows.rows, total: rows.rowCount });
  } catch (err: any) {
    logger.error('[API Keys] List error:', err.message);
    safeError(res, err, 500);
  }
});

/* ── POST / — create new key ──────────── */
router.post('/', authenticateToken as any, requireRole('developer', 'org_admin') as any, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const orgId = req.user?.orgId || req.user?.organizationId || 1;
    const { name, platform = 'custom', tier = 'pro', rateLimitPerMinute = 200, expiresInDays } = req.body;

    if (!name) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'name required' }); return; }
    const validPlatforms = ['nsp', 'nsi', 'nyayamitra', 'custom'];
    if (!validPlatforms.includes(platform)) {
      sendApiError(res, 'BAD_REQUEST', { status: 400, overrideMessage: `platform must be one of: ${validPlatforms.join(' | ')}` }); return;
    }

    const tierLimits: Record<string, number> = { solo: 50, plus: 100, pro: 200, enterprise: 1000 };
    const resolvedLimit = Math.min(rateLimitPerMinute, tierLimits[tier] || 200);
    const { key, keyHash, prefix } = generateApiKey(platform);
    const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86400000) : null;

    const result = await pool.query(
      `INSERT INTO nv_org_api_keys
         (org_id, name, key_hash, key_prefix, platform, tier, rate_limit_per_minute, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, name, key_prefix, platform, tier, rate_limit_per_minute, created_at, expires_at`,
      [orgId, name, keyHash, prefix, platform, tier, resolvedLimit, expiresAt]
    );

    // ── Audit log: API key creation (tamper-evident hash chain) ──────────────
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    const newKey = result.rows[0];
    try {
      await writeAuditLog({
        traceId: crypto.randomUUID(),
        appId:   String(newKey.id),
        orgId:   String(orgId),
        route:   '/api/jrx/api-keys',
        method:  'POST',
        statusCode: 201,
        latencyMs: 0,
        tokensUsed: 0,
      });
    } catch {
      // Non-critical — key is already created
    }

    res.status(201).json({
      success: true,
      data: { ...newKey, key },
      message: 'Store this key securely — it will not be shown again.',
    });
  } catch (err: any) {
    logger.error('[API Keys] Create error:', err.message);
    safeError(res, err, 500);
  }
});

/* ── PATCH /:id — update name/limit ── */
router.patch('/:id', authenticateToken as any, requireRole('developer', 'org_admin') as any, async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.user?.organizationId || 1;
    const { name, rateLimitPerMinute } = req.body;
    const updates: string[] = [];
    const vals: any[] = [];
    if (name) { vals.push(name); updates.push(`name = $${vals.length}`); }
    if (rateLimitPerMinute) { vals.push(Number(rateLimitPerMinute)); updates.push(`rate_limit_per_minute = $${vals.length}`); }
    if (!updates.length) { sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'No fields to update' }); return; }
    vals.push(Number(req.params.id), orgId);
    const r = await pool.query(
      `UPDATE nv_org_api_keys SET ${updates.join(', ')} WHERE id = $${vals.length - 1} AND org_id = $${vals.length} RETURNING id, name, rate_limit_per_minute`,
      vals
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    if (!r.rows.length) { sendApiError(res, 'NOT_FOUND'); return; }
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    res.json({ success: true, data: r.rows[0] });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

/* ── POST /:id/rotate — atomic rotation with grace period (T010) ─────────── */
router.post('/:id/rotate', authenticateToken as any, requireRole('developer', 'org_admin') as any, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const orgId = Number(req.user?.orgId || req.user?.organizationId || 1);
    const keyId = Number(req.params.id);
    if (!Number.isFinite(keyId) || keyId <= 0) {
      sendApiError(res, 'BAD_REQUEST', { overrideMessage: 'Invalid key id' });
      return;
    }
    const graceDays = req.body?.graceDays != null ? Number(req.body.graceDays) : DEFAULT_GRACE_DAYS;

    const result = await rotateApiKey({
      keyId,
      orgId,
      graceDays,
      rotatedBy: String(req.user?.id ?? req.user?.userId ?? 'unknown'),
    });

    try {
      await writeAuditLog({
        traceId: crypto.randomUUID(),
        appId:   String(result.newKey.id),
        orgId:   String(orgId),
        route:   `/api/jrx/api-keys/${keyId}/rotate`,
        method:  'POST',
        statusCode: 200,
        latencyMs: 0,
        tokensUsed: 0,
      });
    } catch { /* non-critical */ }

    res.status(200).json({
      success: true,
      data: result,
      message: `Old key remains valid for ${result.oldKey.graceDays} days; store the new key securely.`,
    });
  } catch (err: any) {
    if (err instanceof ApiKeyRotationError) {
      safeError(res, err, err.statusCode || 500);
      return;
    }
    logger.error('[API Keys] Rotate error:', err.message);
    safeError(res, err, 500);
  }
});

/* ── DELETE /:id — revoke ─────────── */
router.delete('/:id', authenticateToken as any, requireRole('org_admin') as any, async (req: Request, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.user?.organizationId || 1;
    const r = await pool.query(
      `UPDATE nv_org_api_keys SET is_active = false WHERE id = $1 AND org_id = $2 RETURNING id`,
      [Number(req.params.id), orgId]
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    if (!r.rows.length) { sendApiError(res, 'NOT_FOUND'); return; }
    res.json({ success: true, message: 'API key revoked' });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

/* ── GET /usage/summary — token usage by org ── */
router.get('/usage/summary', authenticateToken as any, async (req: Request, res: Response) => {
  try {
    await ensureTables();
    const orgId = req.user?.orgId || req.user?.organizationId || 1;
    const rows = await pool.query(
      `SELECT k.id, k.name, k.platform, k.tier, k.requests_this_month, k.requests_total, k.last_used_at,
              COALESCE(
                (SELECT SUM(l.tokens_used) FROM nv_org_api_usage_log l
                 WHERE l.api_key_id = k.id AND l.used_at > NOW() - INTERVAL '30 days'),
                0
              ) AS tokens_this_month
       FROM nv_org_api_keys k
       WHERE k.org_id = $1 AND k.is_active = true
       ORDER BY k.requests_this_month DESC`,
      [orgId]
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    const totals = rows.rows.reduce((a: any, r: any) => ({
      requests: a.requests + (r.requests_this_month || 0),
      tokens: a.tokens + parseInt(r.tokens_this_month || 0),
    }), { requests: 0, tokens: 0 });
    res.json({ success: true, data: rows.rows, totals });
  } catch (err: any) {
    safeError(res, err, 500);
  }
});

export default router;
