/**
 * Task #156 — SME credential issuance + setup-token redemption.
 *
 * NV-AUTH-HEADER-001 — JWT (`authenticateToken`) only; not SDK auth.
 * NV-API-CONTRACT-001 — additive routes only.
 *
 * Aligns with the canonical nv_users schema (integer id, password_hash)
 * and uses `generateToken` from middleware/jrx-auth.ts so JWTs minted
 * here authenticate against `authenticateToken` (which reads `userId`).
 */

import { Router, type Request, type Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcrypt';
import { pool as db } from '../db/index.js';
import { authenticateToken, generateToken, type AuthRequest } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-sme-setup-routes');

const TOKEN_TTL_HOURS = 24 * 7;

function isSuperadmin(req: Request): boolean {
  const r = String((req as AuthRequest).user?.role || '').toLowerCase();
  return r === 'superadmin' || r === 'super_admin';
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function publicBaseUrl(req: Request): string {
  const env = process.env.JRX_PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, '');
  const host = req.get('host');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  return host ? `${proto}://${host}` : '';
}

// NV-SME-RLS-001 (2026-06-17): nv_users carries an org_id column, so the
// strict tenant-isolation RLS policy (drizzle/0004) is FORCE-enabled on it
// when `app.nyv_rls_enforce=true` (EC2). A plain pooled INSERT/UPDATE that
// never binds `app.current_org_id` fails the WITH CHECK / sees zero rows.
// These helpers resolve a safe numeric org and bind it via SET LOCAL on the
// transaction's pinned connection. SET LOCAL cannot take bind params, so the
// value MUST be validated as a digits-only string before interpolation.
function resolveOrgId(raw: number | string | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NV-SME-RLS-001: superadmin token missing organizationId (cannot bind RLS org context in production)');
  }
  return 1; // platform-baseline org for dev / UAT
}

async function bindOrgContext(client: { query: (...args: any[]) => Promise<any> }, orgId: number): Promise<void> {
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error('NV-SME-RLS-001: refusing to bind non-numeric org id');
  }
  await client.query(`SET LOCAL app.current_org_id = '${orgId}'`);
}

export const smeSetupAllocationRouter = Router();
smeSetupAllocationRouter.use(authenticateToken);

smeSetupAllocationRouter.post('/sme-allocations/issue', async (req: Request, res: Response): Promise<void> => {
  if (!isSuperadmin(req)) { res.status(403).json({ error: 'superadmin only' }); return; }
  const issuedBy = parseInt(String((req as AuthRequest).user!.id), 10);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const scope = req.body?.scope ?? {};
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'valid email required' }); return;
  }
  if (!db) { res.status(503).json({ error: 'db unavailable' }); return; }

  // NV-SME-RLS-001: bind the issuing superadmin's org so RLS-enforced writes
  // to nv_users succeed; the new SME user is created in that same org.
  let orgId: number;
  try {
    orgId = resolveOrgId((req as AuthRequest).user?.organizationId);
  } catch (e) {
    res.status(500).json({ error: 'issue failed', detail: e instanceof Error ? e.message : String(e) });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await bindOrgContext(client, orgId);

    type UserRow = { id: number | string; role: string };
    const lookup = await client.query(
      `SELECT id, role FROM nv_users WHERE LOWER(email) = $1 LIMIT 1`,
      [email],
    );
    let userRow: UserRow | undefined = (lookup.rows?.[0] as UserRow | undefined);

    if (!userRow) {
      const placeholderHash = await bcrypt.hash(randomBytes(24).toString('hex'), 12);
      const ins = await client.query(
        `INSERT INTO nv_users (email, password_hash, role, tier, org_id, is_active, created_at, updated_at)
         VALUES ($1, $2, 'sme', 'solo', $3, TRUE, NOW(), NOW())
         ON CONFLICT (email) DO NOTHING
         RETURNING id, role`,
        [email, placeholderHash, orgId],
      );
      userRow = (ins.rows?.[0] as UserRow | undefined)
        ?? ((await client.query(
          `SELECT id, role FROM nv_users WHERE LOWER(email) = $1 LIMIT 1`,
          [email],
        )).rows?.[0] as UserRow | undefined);
    } else {
      const cur = String(userRow.role).toLowerCase();
      if (cur !== 'sme' && cur !== 'superadmin' && cur !== 'super_admin') {
        await client.query(`UPDATE nv_users SET role = 'sme', updated_at = NOW() WHERE id = $1`, [userRow.id]);
      }
    }
    if (!userRow) { await client.query('ROLLBACK'); res.status(500).json({ error: 'user upsert failed' }); return; }

    const smeUserId = parseInt(String(userRow.id), 10);
    await client.query(
      `INSERT INTO sme_allocations (sme_user_id, allocated_by_user_id, scope, active, created_at)
       VALUES ($1, $2, $3::jsonb, TRUE, NOW())`,
      [smeUserId, issuedBy, JSON.stringify(scope)],
    );

    const rawToken = randomBytes(24).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000);
    // NV-SME-RLS-001: persist the bound org in the token scope so the
    // (public, token-only) setup route can re-bind RLS context on redemption.
    const scopeWithOrg = { ...(typeof scope === 'object' && scope ? scope : {}), org_id: orgId };
    await client.query(
      `INSERT INTO nv_sme_setup_tokens
         (token_hash, sme_user_id, issued_by_user_id, scope, expires_at, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
      [tokenHash, smeUserId, issuedBy, JSON.stringify(scopeWithOrg), expiresAt],
    );

    await client.query('COMMIT');
    const setupUrl = `${publicBaseUrl(req)}/sme/setup?token=${rawToken}`;
    // Token deliberately NOT returned in the response body — the setupUrl
    // already embeds it and is the canonical way for Superadmin UIs/tests
    // to hand the credential to the SME. Keeping the raw token out of the
    // JSON body reduces accidental leakage via logs / response captures.
    res.json({
      ok: true,
      smeUserId,
      email,
      setupUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('sme issue failed', { error: msg });
    res.status(500).json({ error: 'issue failed', detail: msg });
  } finally {
    client.release();
  }
});

export const smeSetupAuthRouter = Router();

smeSetupAuthRouter.post('/sme-setup', async (req: Request, res: Response): Promise<void> => {
  const rawToken = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!rawToken || password.length < 10) {
    res.status(400).json({ error: 'token and password (>= 10 chars) required' }); return;
  }
  if (!db) { res.status(503).json({ error: 'db unavailable' }); return; }
  const tokenHash = hashToken(rawToken);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    type TokRow = {
      id: number; sme_user_id: number; expires_at: string | Date;
      consumed_at: string | Date | null; scope: Record<string, unknown> | null;
    };
    // nv_sme_setup_tokens has no org_id column → no RLS policy, safe to read
    // before binding org context. Recover the org embedded at issue time.
    const t = ((await client.query(
      `SELECT id, sme_user_id, expires_at, consumed_at, scope
         FROM nv_sme_setup_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    )).rows?.[0] as TokRow | undefined);
    if (!t) { await client.query('ROLLBACK'); res.status(404).json({ error: 'invalid token' }); return; }
    if (t.consumed_at) { await client.query('ROLLBACK'); res.status(409).json({ error: 'token already used' }); return; }
    if (new Date(t.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK'); res.status(410).json({ error: 'token expired' }); return;
    }
    // NV-SME-RLS-001: bind the org persisted in the token scope so the
    // RLS-enforced nv_users UPDATE/SELECT below operate on the right tenant.
    try {
      await bindOrgContext(client, resolveOrgId((t.scope as { org_id?: number | string } | null)?.org_id));
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'setup failed', detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `UPDATE nv_users SET password_hash = $1, role = 'sme', is_active = TRUE, updated_at = NOW()
        WHERE id = $2`,
      [passwordHash, t.sme_user_id],
    );
    await client.query(`UPDATE nv_sme_setup_tokens SET consumed_at = NOW() WHERE id = $1`, [t.id]);
    type UserOut = { id: number | string; email: string; role: string; org_id: number | string | null };
    const u = ((await client.query(
      `SELECT id, email, role, org_id FROM nv_users WHERE id = $1`, [t.sme_user_id],
    )).rows?.[0] as UserOut | undefined);
    await client.query('COMMIT');
    if (!u) { res.status(500).json({ error: 'user not found after setup' }); return; }

    const jwtToken = generateToken({
      id: String(u.id),
      email: String(u.email),
      role: String(u.role),
      // NV-UAT-DEFAULT-ORG-001 (task #335): SME setup tokens default to
      // platform-baseline org_id=1 in dev / E2E-bypass mode when the row
      // has no org_id yet. Production keeps the historical null.
      organizationId: ((u.org_id as number | string | null) ??
        ((process.env.NODE_ENV !== 'production') ? 1 : null)) as number | string | null,
    });
    res.json({ ok: true, token: jwtToken, user: { id: u.id, email: u.email, role: u.role } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('sme setup failed', { error: msg });
    res.status(500).json({ error: 'setup failed', detail: msg });
  } finally {
    client.release();
  }
});
