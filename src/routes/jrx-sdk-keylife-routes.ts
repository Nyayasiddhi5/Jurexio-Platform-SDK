// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — SDK Key Lifecycle Routes
 * NYV-SDK-KEYLIFE-001
 *
 * Full 4-key lifecycle management for SDK applications.
 * Every raw key is shown ONCE and stored as SHA-256 hash.
 *
 * Key Types (4 per platform):
 *  sdk_api_key        nyv_live_sk_[32hex] — primary backend auth
 *  webhook_secret     nyv_wh_[32hex]      — HMAC signing for webhooks
 *  publishable_key    nyv_pk_[24hex]      — frontend-safe, limited scopes
 *  signing_key        nyv_ss_[64hex]      — request signing (HMAC-SHA256)
 *
 * Routes:
 *  POST   /api/jrx/sdk/keys/:appId/generate            — generate a new key
 *  POST   /api/jrx/sdk/keys/:appId/rotate              — rotate existing key type
 *  POST   /api/jrx/sdk/keys/:appId/revoke/:keyId       — revoke specific key
 *  POST   /api/jrx/sdk/keys/:appId/revoke-all          — revoke ALL keys for app
 *  GET    /api/jrx/sdk/keys/:appId                     — list all keys (no raw values)
 *  GET    /api/jrx/sdk/keys/:appId/status              — expiry + rotation schedule
 *  POST   /api/jrx/sdk/keys/verify                     — verify a key (hash check)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '../utils/logger.js';
import { secureRandomHex } from '../utils/jrx-secure-random.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';

const logger = createLogger('sdk-keylife');
const router = Router();

// task-260: typed contract for the neon HTTP SQL tag returned by getSql()
// so downstream helpers (verifyAppOwnership, etc.) take a typed parameter
// instead of `sql: any`. The runtime shape of `neon(url)\`SELECT ...\`` on
// the HTTP driver is a Promise resolving to a row array directly (NOT a
// pg-style `{ rows }` envelope). We model that here as a plain template-
// tag function returning `Promise<Row[]>`. This both rejects accidental
// non-tagged invocation and gives every call site a typed `.length`,
// `.find()`, `[0]`, etc. without any further assertions.
type NvNeonSqlRow = Record<string, unknown>;
type NvNeonSql = <T extends NvNeonSqlRow = NvNeonSqlRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

function getSql(): NvNeonSql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not configured');
  return neon(url) as unknown as NvNeonSql;
}

async function verifyAppOwnership(sql: NvNeonSql, appId: string, req: Request): Promise<{ allowed: boolean; error?: string }> {
  const user = (req as any).user;
  if (!user) return { allowed: false, error: 'NYV-KEYLIFE-AUTH-001: Authentication required' };
  if (user.role === 'super_admin' || user.role === 'service') return { allowed: true };

  const rows = (await sql`SELECT organization_id FROM nv_sdk_applications WHERE id = ${appId}`) as Array<{ organization_id: string | number | null }>;
  if (!rows.length) return { allowed: false, error: 'NYV-KEYLIFE-404: Application not found' };

  const appOrgId = String(rows[0].organization_id);
  const userOrgId = String(user.organizationId ?? '');
  if (!userOrgId || appOrgId !== userOrgId) {
    return { allowed: false, error: 'NYV-KEYLIFE-AUTHZ-001: You do not own this application' };
  }
  return { allowed: true };
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function buildRawKey(type: string, env: string): string {
  const prefix = env === 'production' ? 'live' : 'test';
  switch (type) {
    case 'sdk_api_key':    return `nyv_${prefix}_sk_${secureRandomHex(32)}`;
    case 'webhook_secret': return `nyv_wh_${secureRandomHex(32)}`;
    case 'publishable_key':return `nyv_pk_${secureRandomHex(24)}`;
    case 'signing_key':    return `nyv_ss_${secureRandomHex(64)}`;
    default:               return `nyv_key_${secureRandomHex(32)}`;
  }
}

function keyExpiresAt(type: string): Date {
  const days = type === 'sdk_api_key' ? 90
             : type === 'signing_key' ? 180
             : type === 'publishable_key' ? 365
             : 0; // webhook_secret: no expiry by default
  if (!days) return new Date(Date.now() + 10 * 365 * 86400 * 1000); // 10yr
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function scopesForKeyType(type: string): string[] {
  switch (type) {
    case 'sdk_api_key':    return ['agents:execute', 'agents:read', 'documents:read', 'documents:write', 'research:read', 'usage:read', 'completions:write'];
    case 'publishable_key':return ['completions:write', 'research:read'];
    case 'webhook_secret': return ['webhooks:receive'];
    case 'signing_key':    return ['requests:sign'];
    default:               return ['agents:read'];
  }
}

const KeyTypeEnum = z.enum(['sdk_api_key', 'webhook_secret', 'publishable_key', 'signing_key']);

// ─── POST /api/jrx/sdk/keys/:appId/generate ──────────────────────────────────

router.post('/:appId/generate', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { appId: rawAppId } = req.params; const appId = String(rawAppId ?? "");

    const ownership = await verifyAppOwnership(sql, appId, req);
    if (!ownership.allowed) { return res.status(403).json({ error: ownership.error }); }

    const schema = z.object({
      key_type: KeyTypeEnum,
      name: z.string().optional(),
      rate_limit: z.number().int().positive().optional().default(1000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      // Bug fix (Task #29 round-3 review) — must `return` after writing the
      // 400 or the rest of the handler runs against `parsed.data` which is
      // undefined on a failed parse, crashing into a 500.
      return res.status(400).json({ error: 'NYV-KEYLIFE-VAL-001: Invalid payload', details: parsed.error.flatten() });
    }

    const appRows = await sql`SELECT id, environment, is_active FROM nv_sdk_applications WHERE id = ${appId}`;
    if (!appRows.length) { return res.status(404).json({ error: 'NYV-KEYLIFE-404: Application not found' }); }
    if (!appRows[0].is_active) { return res.status(403).json({ error: 'NYV-KEYLIFE-403: Application is suspended' }); }

    const env = String(appRows[0].environment ?? 'sandbox');
    const { key_type, name, rate_limit } = parsed.data;
    const rawKey = buildRawKey(key_type, env);
    const keyHash = hashKey(rawKey);
    const prefix = rawKey.slice(0, rawKey.indexOf('_', 8) + 5);
    const scopes = scopesForKeyType(key_type);
    const expiresAt = keyExpiresAt(key_type);

    // Insert key record (hash only — never store raw)
    const keyRows = await sql`
      INSERT INTO nv_api_keys (
        app_id, key_prefix, key_hash, name, key_type,
        permissions, scopes, rate_limit, is_active, expires_at, created_at
      ) VALUES (
        ${appId}, ${prefix}, ${keyHash},
        ${name ?? `${key_type} key`}, ${key_type},
        ${scopes}::text[], ${scopes}::text[],
        ${rate_limit}, true, ${expiresAt.toISOString()}, NOW()
      )
      RETURNING id, app_id, key_prefix, name, key_type, scopes, rate_limit, is_active, expires_at, created_at
    `;

    // Update app hash column for this key type
    if (key_type === 'webhook_secret') {
      await sql`UPDATE nv_sdk_applications SET webhook_secret_hash = ${keyHash}, updated_at = NOW() WHERE id = ${appId}`;
    } else if (key_type === 'publishable_key') {
      await sql`UPDATE nv_sdk_applications SET publishable_key_hash = ${keyHash}, updated_at = NOW() WHERE id = ${appId}`;
    } else if (key_type === 'signing_key') {
      await sql`UPDATE nv_sdk_applications SET signing_key_hash = ${keyHash}, updated_at = NOW() WHERE id = ${appId}`;
    } else {
      await sql`UPDATE nv_sdk_applications SET key_expires_at = ${expiresAt.toISOString()}, updated_at = NOW() WHERE id = ${appId}`;
    }

    logger.info('SDK key generated', { appId, key_type, key_id: keyRows[0]?.id });

    // Route SDK key-lifecycle audit through the chain-enforced writer
    // (Task #29 deliverable #4). A direct write to the audit-log table
    // would bypass SHA-256 chain validation and create unverified records.
    // See docs/v3.1.2/completed_docs/NYV-COMPLIANCE-ATTESTATION.md §4 for the full rationale.
    //
    // FAIL-CLOSED (Task #29 round-3 review): a chain-enforcement failure
    // here must NOT yield a successful 201 — that would let an unauditable
    // key escape into client hands. We deactivate the just-inserted key
    // (best-effort) and return 500 so the caller retries. The key row is
    // left for forensic review; it cannot authenticate because is_active=false.
    try {
      const userId = (req as any).user?.id ?? 'unknown';
      await appendAuditRecord({
        eventType: 'sdk_key_created',
        payload: JSON.stringify({
          user_id: String(userId),
          route: '/sdk/keys',
          method: 'POST',
          app_id: appId,
          key_type,
          key_id: keyRows[0]?.id,
          key_prefix: prefix,
          rate_limit,
          expires_at: expiresAt.toISOString(),
        }),
      });
    } catch (auditErr: unknown) {
      const msg = auditErr instanceof Error ? auditErr.message : String(auditErr);
      logger.error('Audit log write failed for sdk_key_created — failing the request closed', { error: msg, key_id: keyRows[0]?.id });
      try {
        await sql`UPDATE nv_api_keys SET is_active = false WHERE id = ${keyRows[0]?.id}`;
      } catch (compErr: unknown) {
        logger.error('Compensating revoke failed; key row left active for manual review', { error: compErr instanceof Error ? compErr.message : String(compErr), key_id: keyRows[0]?.id });
      }
      return res.status(500).json({
        error: 'NYV-KEYLIFE-AUDIT-001: audit chain enforcement failed; key has been revoked. Please retry.',
      });
    }

    return res.status(201).json({
      key_id: keyRows[0]?.id,
      key_type,
      raw_key: rawKey,
      key_prefix: prefix,
      scopes,
      rate_limit,
      expires_at: expiresAt.toISOString(),
      created_at: keyRows[0]?.created_at,
      warning: 'This is the only time the raw key will be shown. Copy it now and store it securely.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Key generation error', { error: msg });
    return res.status(500).json({ error: 'NYV-KEYLIFE-500: Key generation failed', detail: msg });
  }
});

// ─── POST /api/jrx/sdk/keys/:appId/rotate ────────────────────────────────────

router.post('/:appId/rotate', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { appId: rawAppId } = req.params; const appId = String(rawAppId ?? "");

    const ownership = await verifyAppOwnership(sql, appId, req);
    if (!ownership.allowed) { res.status(403).json({ error: ownership.error }); return; }

    const schema = z.object({ key_type: KeyTypeEnum, revoke_old: z.boolean().optional().default(true) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-KEYLIFE-VAL-002: key_type required' }); return; }

    const appRows = await sql`SELECT id, environment FROM nv_sdk_applications WHERE id = ${appId}`;
    if (!appRows.length) { res.status(404).json({ error: 'NYV-KEYLIFE-404: Application not found' }); return; }

    const env = String(appRows[0].environment ?? 'sandbox');
    const { key_type, revoke_old } = parsed.data;

    // Revoke old keys of this type
    if (revoke_old) {
      await sql`
        UPDATE nv_api_keys
        SET is_active = false
        WHERE app_id = ${appId} AND key_type = ${key_type} AND is_active = true
      `;
    }

    // Generate new key
    const rawKey = buildRawKey(key_type, env);
    const keyHash = hashKey(rawKey);
    const prefix = rawKey.slice(0, rawKey.indexOf('_', 8) + 5);
    const scopes = scopesForKeyType(key_type);
    const expiresAt = keyExpiresAt(key_type);

    const keyRows = await sql`
      INSERT INTO nv_api_keys (
        app_id, key_prefix, key_hash, name, key_type,
        permissions, scopes, rate_limit, is_active, expires_at, created_at
      ) VALUES (
        ${appId}, ${prefix}, ${keyHash}, ${'Rotated ' + key_type}, ${key_type},
        ${scopes}::text[], ${scopes}::text[], 1000, true, ${expiresAt.toISOString()}, NOW()
      )
      RETURNING id, key_prefix, expires_at, created_at
    `;

    // ── NYV-NS-002 (2026-05-01) — dual-write rotated key into canonical
    // sdk_app_api_keys so the SDK gateway middleware actually finds it.
    try {
      const mapRows = await sql`
        SELECT canonical_id FROM nyv_sdk_legacy_id_map
         WHERE legacy_uuid = ${appId} AND table_name = 'sdk_applications'
         LIMIT 1
      `;
      const canonicalAppId = (mapRows[0] as { canonical_id: number } | undefined)?.canonical_id;
      if (canonicalAppId) {
        await sql`
          INSERT INTO sdk_app_api_keys (
            application_id, key_hash, key_prefix, name,
            scopes, is_active, expires_at, created_at
          ) VALUES (
            ${canonicalAppId}, ${keyHash}, ${prefix}, ${'Rotated ' + key_type},
            ${JSON.stringify(scopes)}::jsonb, true, ${expiresAt.toISOString()}, NOW()
          )
          ON CONFLICT (key_hash) DO NOTHING
        `;
      } else {
        logger.warn('NYV-NS-002: rotated key has no canonical app mapping (run migration 0006)', { appId });
      }
    } catch (dualErr: unknown) {
      const dualMsg = dualErr instanceof Error ? dualErr.message : String(dualErr);
      logger.error('NYV-NS-002 keylife dual-write failed', { appId, error: dualMsg });
    }

    logger.info('SDK key rotated', { appId, key_type, new_key_id: keyRows[0]?.id });

    res.json({
      rotated: true,
      key_id: keyRows[0]?.id,
      key_type,
      raw_key: rawKey,
      key_prefix: prefix,
      scopes,
      expires_at: expiresAt.toISOString(),
      old_keys_revoked: revoke_old,
      warning: 'Update your platform SDK config with this new key immediately. This key will not be shown again.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Key rotation error', { error: msg });
    res.status(500).json({ error: 'NYV-KEYLIFE-500: Key rotation failed', detail: msg });
  }
});

// ─── POST /api/jrx/sdk/keys/:appId/revoke/:keyId ─────────────────────────────

router.post('/:appId/revoke/:keyId', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const appId = String(req.params.appId ?? '');
    const keyId = String(req.params.keyId ?? '');

    const ownership = await verifyAppOwnership(sql, appId, req);
    if (!ownership.allowed) { res.status(403).json({ error: ownership.error }); return; }

    const rows = await sql`
      UPDATE nv_api_keys
      SET is_active = false
      WHERE id = ${keyId} AND app_id = ${appId}
      RETURNING id, key_prefix, key_type, is_active
    `;
    if (!rows.length) { res.status(404).json({ error: 'NYV-KEYLIFE-404: Key not found' }); return; }
    logger.info('SDK key revoked', { appId, keyId });
    res.json({ revoked: true, key: rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-KEYLIFE-500: Revoke failed', detail: msg });
  }
});

// ─── POST /api/jrx/sdk/keys/:appId/revoke-all ────────────────────────────────

router.post('/:appId/revoke-all', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { appId: rawAppId } = req.params; const appId = String(rawAppId ?? "");

    const ownership = await verifyAppOwnership(sql, appId, req);
    if (!ownership.allowed) { res.status(403).json({ error: ownership.error }); return; }

    const result = await sql`
      UPDATE nv_api_keys
      SET is_active = false
      WHERE app_id = ${appId} AND is_active = true
      RETURNING id
    `;
    logger.info('All SDK keys revoked', { appId, count: result.length });
    res.json({ revoked: true, keys_revoked: result.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-KEYLIFE-500: Revoke-all failed', detail: msg });
  }
});

// ─── GET /api/jrx/sdk/keys/:appId ────────────────────────────────────────────

router.get('/:appId', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { appId: rawAppId } = req.params; const appId = String(rawAppId ?? "");

    const ownership = await verifyAppOwnership(sql, appId, req);
    if (!ownership.allowed) { res.status(403).json({ error: ownership.error }); return; }

    const rows = await sql`
      SELECT
        id, app_id, key_prefix, name, key_type,
        scopes, rate_limit, is_active,
        last_used_at, expires_at, created_at
      FROM nv_api_keys
      WHERE app_id = ${appId}
      ORDER BY created_at DESC
    `;
    res.json({ keys: rows, total: rows.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-KEYLIFE-500: Failed to list keys', detail: msg });
  }
});

// ─── GET /api/jrx/sdk/keys/:appId/status ─────────────────────────────────────

router.get('/:appId/status', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { appId: rawAppId } = req.params; const appId = String(rawAppId ?? "");

    const ownership = await verifyAppOwnership(sql, appId, req);
    if (!ownership.allowed) { res.status(403).json({ error: ownership.error }); return; }

    const rows = await sql`
      SELECT key_type, is_active, expires_at, last_used_at, created_at
      FROM nv_api_keys
      WHERE app_id = ${appId}
      ORDER BY created_at DESC
    `;

    const now = new Date();
    const warn14 = new Date(now.getTime() + 14 * 86400 * 1000);

    const keyTypes = ['sdk_api_key', 'webhook_secret', 'publishable_key', 'signing_key'];
    const status = keyTypes.map(kt => {
      const key = rows.find(r => r.key_type === kt && r.is_active);
      if (!key) return { key_type: kt, status: 'missing', action_required: true };
      const exp = key.expires_at ? new Date(key.expires_at as string) : null;
      const expired = exp && exp < now;
      const expiringSoon = exp && exp < warn14 && !expired;
      return {
        key_type: kt,
        status: expired ? 'expired' : expiringSoon ? 'expiring_soon' : 'active',
        expires_at: key.expires_at,
        last_used_at: key.last_used_at,
        days_until_expiry: exp ? Math.max(0, Math.floor((exp.getTime() - now.getTime()) / 86400000)) : null,
        action_required: expired || expiringSoon || false,
      };
    });

    res.json({
      app_id: appId,
      key_status: status,
      rotation_schedule: {
        sdk_api_key: '90 days',
        signing_key: '180 days',
        publishable_key: '365 days',
        webhook_secret: 'On demand',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-KEYLIFE-500: Failed to get key status', detail: msg });
  }
});

// ─── POST /api/jrx/sdk/keys/verify ───────────────────────────────────────────

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const schema = z.object({ key: z.string().min(20), expected_type: KeyTypeEnum.optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'NYV-KEYLIFE-VAL-003: key required' }); return; }

    const keyHash = hashKey(parsed.data.key);
    const rows = await sql`
      SELECT k.id, k.key_type, k.is_active, k.expires_at, k.scopes,
             a.name as app_name, a.environment
      FROM nv_api_keys k
      JOIN nv_sdk_applications a ON k.app_id = a.id
      WHERE k.key_hash = ${keyHash}
    `;

    if (!rows.length) { res.json({ valid: false, reason: 'Key not found' }); return; }
    const r = rows[0];
    if (!r.is_active) { res.json({ valid: false, reason: 'Key revoked' }); return; }
    if (r.expires_at && new Date(r.expires_at as string) < new Date()) {
      res.json({ valid: false, reason: 'Key expired' });
    }
    if (parsed.data.expected_type && r.key_type !== parsed.data.expected_type) {
      res.json({ valid: false, reason: `Expected ${parsed.data.expected_type}, got ${r.key_type}` });
    }

    res.json({
      valid: true,
      key_type: r.key_type,
      scopes: r.scopes,
      app_name: r.app_name,
      environment: r.environment,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'NYV-KEYLIFE-500: Verification failed', detail: msg });
  }
});

export default router;
