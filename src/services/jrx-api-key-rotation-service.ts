/**
 * NV API Key Rotation Service — T010 Stream A
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the seven-day grace-period rotation contract for `nv_org_api_keys`.
 *
 * Contract:
 *   1. Caller invokes `rotateApiKey(keyId, orgId, opts)` against the OLD key.
 *   2. We mint a brand-new key (same platform/tier/rate-limit) and INSERT it.
 *   3. We mark the OLD key with `expires_at = NOW() + grace`. The OLD key
 *      stays `is_active = true` until that timestamp; the SDK gateway already
 *      enforces `expires_at` (returns API_KEY_EXPIRED past then).
 *   4. The whole flow runs inside a single TX so a partial failure never
 *      leaves an orphaned new key without grace on the old one (or vice versa).
 *
 * Acceptance: `POST /api/jrx/api-keys/:id/rotate` returns BOTH the new key
 * and the old key's expiration timestamp; integration test asserts that
 * the old key still authenticates during the grace window.
 *
 * @module nv-api-key-rotation-service
 */

import { randomBytes, createHash } from 'crypto';
import { pool as _raw_pool } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const pool = lazyRequire(() => _raw_pool, 'pool');
interface OldKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  platform: string;
  tier: string;
  rate_limit_per_minute: number;
  is_active: boolean;
  expires_at: Date | string | null;
  org_id: number;
}
interface NewKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  platform: string;
  tier: string;
  rate_limit_per_minute: number;
  created_at: Date | string;
  expires_at: Date | string | null;
}
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-api-key-rotation');

export const DEFAULT_GRACE_DAYS = 7;

export interface RotateApiKeyInput {
  keyId: number;
  orgId: number;
  graceDays?: number;
  rotatedBy?: string;
}

export interface RotatedKeyResult {
  oldKey: {
    id: number;
    keyPrefix: string;
    expiresAt: string; // ISO
    graceDays: number;
  };
  newKey: {
    id: number;
    name: string;
    key: string;        // plaintext — shown once
    keyPrefix: string;
    platform: string;
    tier: string;
    rateLimitPerMinute: number;
    createdAt: string;  // ISO
    expiresAt: string | null;
  };
}

export class ApiKeyRotationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'ApiKeyRotationError';
  }
}

function mintApiKey(): { key: string; keyHash: string; prefix: string } {
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const prefix = `nyv_${env}_sk_`;
  const raw = randomBytes(32).toString('hex');
  const key = `${prefix}${raw}`;
  const keyHash = createHash('sha256').update(key).digest('hex');
  return { key, keyHash, prefix };
}

/**
 * Atomically rotate a key. Returns plaintext for the new key (unrecoverable
 * after this call) and the grace-period expiry timestamp on the old key.
 */
export async function rotateApiKey(input: RotateApiKeyInput): Promise<RotatedKeyResult> {
  const graceDays = Math.max(0, Math.min(input.graceDays ?? DEFAULT_GRACE_DAYS, 30));
  const graceMs = graceDays * 86_400_000;
  const newExpiry = new Date(Date.now() + graceMs);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the old key row to prevent concurrent rotations
    const oldRows = await client.query(
      `SELECT id, name, key_prefix, platform, tier, rate_limit_per_minute,
              is_active, expires_at, org_id
         FROM nv_org_api_keys
        WHERE id = $1 AND org_id = $2
        FOR UPDATE`,
      [input.keyId, input.orgId],
    );
    const oldKey = oldRows.rows?.[0] as OldKeyRow | undefined;
    if (!oldKey) {
      throw new ApiKeyRotationError('API key not found for this organisation', 404);
    }
    if (!oldKey.is_active) {
      throw new ApiKeyRotationError('Cannot rotate an inactive/revoked key', 409);
    }

    // 2. Mint and insert the replacement
    const { key: plainKey, keyHash, prefix } = mintApiKey();
    const newRows = await client.query(
      `INSERT INTO nv_org_api_keys
         (org_id, name, key_hash, key_prefix, platform, tier,
          rate_limit_per_minute, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       RETURNING id, name, key_prefix, platform, tier,
                 rate_limit_per_minute, created_at, expires_at`,
      [
        input.orgId,
        `${oldKey.name} (rotated)`,
        keyHash,
        prefix,
        oldKey.platform,
        oldKey.tier,
        oldKey.rate_limit_per_minute,
      ],
    );
    const newRow = newRows.rows?.[0] as NewKeyRow | undefined;
    if (!newRow) throw new ApiKeyRotationError('Failed to insert replacement key', 500);

    // 3. Stamp grace expiry on the old key
    await client.query(
      `UPDATE nv_org_api_keys
          SET expires_at = $1
        WHERE id = $2 AND org_id = $3`,
      [newExpiry, input.keyId, input.orgId],
    );

    await client.query('COMMIT');

    logger.info('api_key_rotated', {
      orgId: input.orgId,
      oldKeyId: input.keyId,
      newKeyId: newRow.id,
      graceDays,
      oldExpiresAt: newExpiry.toISOString(),
      rotatedBy: input.rotatedBy ?? 'unknown',
    });

    return {
      oldKey: {
        id: oldKey.id,
        keyPrefix: oldKey.key_prefix,
        expiresAt: newExpiry.toISOString(),
        graceDays,
      },
      newKey: {
        id: newRow.id,
        name: newRow.name,
        key: plainKey,
        keyPrefix: newRow.key_prefix,
        platform: newRow.platform,
        tier: newRow.tier,
        rateLimitPerMinute: newRow.rate_limit_per_minute,
        createdAt: new Date(newRow.created_at).toISOString(),
        expiresAt: newRow.expires_at ? new Date(newRow.expires_at).toISOString() : null,
      },
    };
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* ignored */ }
    if (err instanceof ApiKeyRotationError) throw err;
    logger.error('api_key_rotation_failed', { err: err?.message, keyId: input.keyId });
    throw new ApiKeyRotationError(err?.message ?? 'Rotation failed', 500);
  } finally {
    client.release();
  }
}
