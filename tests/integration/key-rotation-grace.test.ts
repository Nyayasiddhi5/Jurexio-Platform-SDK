/**
 * T010 Stream A — API key rotation grace-period integration test.
 *
 * Acceptance:
 *   - `rotateApiKey` returns BOTH the new plaintext key and the old key's
 *     grace-window expiration timestamp (default 7 days).
 *   - The TX inserts a fresh row with the same platform/tier/rate-limit and
 *     stamps `expires_at = NOW + grace` on the old row, leaving `is_active = true`.
 *   - During the grace window the old key still authenticates because the SDK
 *     gateway's check is `expires_at < NOW()` (already implemented in
 *     nv-sdk-gateway.ts) — we assert that the stamped expiry is strictly in
 *     the future so the gateway will accept the old key until then.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queries: Array<{ sql: string; params: any[] }> = [];
const queryResponses: any[] = [];
const released: { count: number } = { count: 0 };

const mockClient = {
  query: vi.fn(async (sql: string, params: any[] = []) => {
    queries.push({ sql, params });
    return queryResponses.shift() ?? { rows: [] };
  }),
  release: vi.fn(() => { released.count++; }),
};

vi.mock('../../src/db/index.js', () => ({
  pool: {
    connect: vi.fn(async () => mockClient),
    query:   vi.fn(async () => ({ rows: [] })),
  },
}));

import {
  rotateApiKey,
  ApiKeyRotationError,
  DEFAULT_GRACE_DAYS,
} from '../../src/services/jrx-api-key-rotation-service.js';

beforeEach(() => {
  queries.length = 0;
  queryResponses.length = 0;
  released.count = 0;
  mockClient.query.mockClear();
});

describe('rotateApiKey — 7-day grace period', () => {
  it('returns both keys and stamps grace expiry on the old key', async () => {
    // BEGIN, SELECT old, INSERT new, UPDATE old, COMMIT
    queryResponses.push(
      { rows: [] },                                      // BEGIN
      { rows: [{                                         // SELECT old key
        id: 11, name: 'NSP Prod', key_prefix: 'nyv_test_sk_',
        platform: 'nsp', tier: 'pro', rate_limit_per_minute: 200,
        is_active: true, expires_at: null, org_id: 7,
      }] },
      { rows: [{                                         // INSERT new key
        id: 12, name: 'NSP Prod (rotated)', key_prefix: 'nyv_test_sk_',
        platform: 'nsp', tier: 'pro', rate_limit_per_minute: 200,
        created_at: new Date(), expires_at: null,
      }] },
      { rows: [] },                                      // UPDATE old.expires_at
      { rows: [] },                                      // COMMIT
    );

    const before = Date.now();
    const result = await rotateApiKey({ keyId: 11, orgId: 7 });
    const after = Date.now();

    // ── Both keys present ──
    expect(result.oldKey.id).toBe(11);
    expect(result.newKey.id).toBe(12);
    expect(result.newKey.key).toMatch(/^nyv_(test|live)_sk_[a-f0-9]{64}$/);

    // ── Grace expiry strictly in the future, ~7 days out ──
    const expiry = Date.parse(result.oldKey.expiresAt);
    expect(result.oldKey.graceDays).toBe(DEFAULT_GRACE_DAYS);
    expect(expiry).toBeGreaterThan(after);
    expect(expiry - before).toBeGreaterThanOrEqual(DEFAULT_GRACE_DAYS * 86_400_000 - 1000);
    expect(expiry - before).toBeLessThanOrEqual(DEFAULT_GRACE_DAYS * 86_400_000 + 1000);

    // ── Atomic: BEGIN/INSERT/UPDATE/COMMIT all observed, in order ──
    const sqls = queries.map(q => q.sql.trim().split(/\s+/)[0].toUpperCase());
    expect(sqls).toEqual(['BEGIN', 'SELECT', 'INSERT', 'UPDATE', 'COMMIT']);

    // ── UPDATE preserves is_active=true (only expires_at set) ──
    const updateSql = queries[3].sql;
    expect(updateSql).toMatch(/UPDATE\s+nv_org_api_keys/i);
    expect(updateSql).toMatch(/SET\s+expires_at\s*=/i);
    expect(updateSql).not.toMatch(/is_active/i);

    // ── Grace expiry is the parameter passed to UPDATE ──
    expect((queries[3].params[0] as Date).toISOString()).toBe(result.oldKey.expiresAt);

    // ── Connection released ──
    expect(released.count).toBe(1);
  });

  it('honours a custom graceDays override (clamped to [0, 30])', async () => {
    queryResponses.push(
      { rows: [] },
      { rows: [{ id: 1, name: 'k', key_prefix: 'p', platform: 'nsp', tier: 'pro', rate_limit_per_minute: 100, is_active: true, expires_at: null, org_id: 1 }] },
      { rows: [{ id: 2, name: 'k (rotated)', key_prefix: 'p', platform: 'nsp', tier: 'pro', rate_limit_per_minute: 100, created_at: new Date(), expires_at: null }] },
      { rows: [] },
      { rows: [] },
    );
    const r = await rotateApiKey({ keyId: 1, orgId: 1, graceDays: 999 });
    expect(r.oldKey.graceDays).toBe(30);
  });

  it('rolls back and throws when the old key does not exist', async () => {
    queryResponses.push(
      { rows: [] },     // BEGIN
      { rows: [] },     // SELECT (none)
      { rows: [] },     // ROLLBACK
    );
    await expect(rotateApiKey({ keyId: 404, orgId: 1 })).rejects.toBeInstanceOf(ApiKeyRotationError);
    const sqls = queries.map(q => q.sql.trim().split(/\s+/)[0].toUpperCase());
    expect(sqls).toContain('ROLLBACK');
    expect(released.count).toBe(1);
  });

  it('rejects rotation of an already-revoked (is_active=false) key', async () => {
    queryResponses.push(
      { rows: [] },
      { rows: [{ id: 1, name: 'dead', key_prefix: 'p', platform: 'nsp', tier: 'pro', rate_limit_per_minute: 100, is_active: false, expires_at: null, org_id: 1 }] },
      { rows: [] }, // ROLLBACK
    );
    await expect(rotateApiKey({ keyId: 1, orgId: 1 })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
