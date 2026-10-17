/**
 * Task #66 — Admin invalidation of stale per-agent cache entries.
 *
 * Validates the two new building blocks that back the gateway admin routes
 * (`/cache/admin/invalidate-agent`, `/cache/admin/invalidate-jurisdiction`)
 * and the ops CLI (`scripts/jrx-cache-invalidate.ts`):
 *
 *   1. `buildAgentCacheNamespace` matches the exact shape used by the
 *      Queen orchestrator — if these drift, admins clear the wrong bucket
 *      and stale answers keep getting served.
 *   2. `matchAgentCacheNamespace` filters tenant / jurisdiction / agent
 *      independently and never matches non-agent namespaces (e.g. the
 *      `legal` warm seed entries) which would otherwise be wiped.
 *   3. `LMCacheService.invalidateMatching` walks all three tiers, removes
 *      matched entries, returns a useful audit summary, and leaves
 *      non-matching entries (including legacy ones with no namespace)
 *      untouched.
 *
 * NV-LMCACHE-TEST-RESOLUTION-001: see the header of
 * `tests/unit/ai/lm-cache-shared-backend.test.ts` — the `redis-tcp-url.js` mock
 * works around a stray committed build artifact that made this file fail to
 * load, so these invalidation guarantees were never actually being checked.
 *
 * The `cache admin audit fail-closed policy` block at the bottom is still
 * blocked by the SAME class of defect one layer deeper: it imports
 * `nv-sdk-gateway-routes.ts`, whose graph pulls in `src/middleware/jrx-auth.js`
 * and `src/middleware/jrx-sdk-tracking-middleware.js` — two more committed
 * artifacts that shadow their `.ts` siblings and `require('../db/index.js')`.
 * Stubbing that graph out one module at a time was abandoned deliberately:
 * it would mean mocking half the gateway to assert a two-line env read, and the
 * resulting test would prove nothing. The real fix is to delete the 7 stray
 * compiled artifacts under `src/` (`nv-auth.js`, `nv-sdk-auth-header.js`,
 * `nv-sdk-tracking-middleware.js`, `platform-config.js`, `redis-tcp-url.js`,
 * `nv-cam-routes.js`, `audit-chain-lock.js`) or add a vitest `resolve.alias`
 * preferring `.ts` — both of which are outside this change's ownership.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/utils/redis-tcp-url.js', () => ({
  resolveRedisTcpUrl: () => ({ enabled: false, url: '' }),
  resolveRedisReadUrl: () => ({ enabled: false, url: '' }),
  getResolvedRedisVarName: () => null,
}));

import { LMCacheService } from '../src/services/lm-cache-service.js';
import {
  buildAgentCacheNamespace,
  matchAgentCacheNamespace,
  parseAgentCacheNamespace,
  AGENT_CACHE_NAMESPACE_PREFIX,
} from '../src/services/jrx-cache-namespace.js';
import {
  computeInternalScopesForRole,
  CACHE_ADMIN_ROLES,
} from '../src/middleware/jrx-sdk-gateway.js';

describe('cache namespace helper', () => {
  it('builds the documented `nv-agent:tenant:<id>:juris:<JURIS>:agent:<id>` shape', () => {
    expect(buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'in', agentId: 'litigation' }))
      .toBe('./jrx-agent:tenant:acme:juris:IN:agent:litigation');
  });

  it('falls back to the same sentinels the orchestrator uses when tenant/juris are missing', () => {
    expect(buildAgentCacheNamespace({ agentId: 'litigation' }))
      .toBe('./jrx-agent:tenant:global:juris:IN:agent:litigation');
  });

  it('round-trips through parseAgentCacheNamespace', () => {
    const ns = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'us', agentId: 'compliance' });
    expect(parseAgentCacheNamespace(ns)).toEqual({ tenantId: 'acme', jurisdiction: 'US', agentId: 'compliance' });
  });

  it('parseAgentCacheNamespace returns null for non-agent namespaces (e.g. seeded `legal` warm entries)', () => {
    expect(parseAgentCacheNamespace('legal')).toBeNull();
    expect(parseAgentCacheNamespace('app_42')).toBeNull();
    expect(parseAgentCacheNamespace(`${AGENT_CACHE_NAMESPACE_PREFIX}:malformed`)).toBeNull();
  });

  it('matchAgentCacheNamespace filters by tenant / jurisdiction / agent independently', () => {
    const ns = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'IN', agentId: 'litigation' });

    expect(matchAgentCacheNamespace({ jurisdiction: 'IN' })(ns)).toBe(true);
    expect(matchAgentCacheNamespace({ jurisdiction: 'in' })(ns)).toBe(true);  // case-insensitive
    expect(matchAgentCacheNamespace({ jurisdiction: 'US' })(ns)).toBe(false);

    expect(matchAgentCacheNamespace({ tenantId: 'acme' })(ns)).toBe(true);
    expect(matchAgentCacheNamespace({ tenantId: 'beta' })(ns)).toBe(false);

    expect(matchAgentCacheNamespace({ agentId: 'litigation' })(ns)).toBe(true);
    expect(matchAgentCacheNamespace({ agentId: 'compliance' })(ns)).toBe(false);

    expect(matchAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'IN', agentId: 'litigation' })(ns)).toBe(true);
    expect(matchAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'US' })(ns)).toBe(false);
  });

  it('matchAgentCacheNamespace never matches non-agent namespaces (e.g. seeded legal warm entries)', () => {
    const matchAll = matchAgentCacheNamespace({});
    expect(matchAll('legal')).toBe(false);
    expect(matchAll('app_42')).toBe(false);
    expect(matchAll(undefined)).toBe(false);
    expect(matchAll('')).toBe(false);
  });
});

describe('LMCacheService.invalidateMatching', () => {
  it('clears only matching entries and reports the affected namespaces', async () => {
    const cache = new LMCacheService({ enableSemanticMatching: false });

    const inLitigation = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'IN', agentId: 'litigation' });
    const inCompliance = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'IN', agentId: 'compliance' });
    const usLitigation = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'US', agentId: 'litigation' });
    const inLitigationOtherTenant = buildAgentCacheNamespace({ tenantId: 'beta', jurisdiction: 'IN', agentId: 'litigation' });

    await cache.set('q1', 'a1', { namespace: inLitigation });
    await cache.set('q2', 'a2', { namespace: inCompliance });
    await cache.set('q3', 'a3', { namespace: usLitigation });
    await cache.set('q4', 'a4', { namespace: inLitigationOtherTenant });

    // Bulk clear: every cached answer for jurisdiction=IN, regardless of
    // tenant or agent — the "Act amended" scenario from the task spec.
    const result = await cache.invalidateMatching(matchAgentCacheNamespace({ jurisdiction: 'IN' }));

    expect(result.count).toBe(3);
    expect(new Set(result.namespaces)).toEqual(new Set([inLitigation, inCompliance, inLitigationOtherTenant]));

    // The US entry survives.
    expect((await cache.get('q3', usLitigation)).hit).toBe(true);

    // None of the IN entries survive.
    expect((await cache.get('q1', inLitigation)).hit).toBe(false);
    expect((await cache.get('q2', inCompliance)).hit).toBe(false);
    expect((await cache.get('q4', inLitigationOtherTenant)).hit).toBe(false);
  });

  it('does not touch the seeded legal warm entries (no agent namespace)', async () => {
    const cache = new LMCacheService({ enableSemanticMatching: false });

    const stats = cache.getStats();
    const seededWarmCount = stats.warmEntries;
    expect(seededWarmCount).toBeGreaterThan(0); // sanity: seed entries exist

    // Clearing an entire jurisdiction must not nuke the global `legal` seed.
    const result = await cache.invalidateMatching(matchAgentCacheNamespace({ jurisdiction: 'IN' }));
    expect(result.count).toBe(0);
    expect(cache.getStats().warmEntries).toBe(seededWarmCount);
  });

  it('per-agent invalidate clears only the one (tenant × juris × agent) namespace', async () => {
    const cache = new LMCacheService({ enableSemanticMatching: false });

    const target = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'IN', agentId: 'litigation' });
    const sibling = buildAgentCacheNamespace({ tenantId: 'acme', jurisdiction: 'IN', agentId: 'compliance' });

    await cache.set('q1', 'a1', { namespace: target });
    await cache.set('q2', 'a2', { namespace: sibling });

    const cleared = await cache.invalidateNamespace(target);
    expect(cleared).toBe(1);
    expect((await cache.get('q1', target)).hit).toBe(false);
    expect((await cache.get('q2', sibling)).hit).toBe(true);
  });
});

describe('JWT bypass: cache:admin scope is restricted to admin/operator roles', () => {
  it('grants cache:admin only to org_admin / super_admin / operator', () => {
    expect(CACHE_ADMIN_ROLES.has('org_admin')).toBe(true);
    expect(CACHE_ADMIN_ROLES.has('super_admin')).toBe(true);
    expect(CACHE_ADMIN_ROLES.has('operator')).toBe(true);

    for (const adminRole of ['org_admin', 'super_admin', 'operator']) {
      expect(computeInternalScopesForRole(adminRole)).toContain('cache:admin');
    }
  });

  it('does NOT grant cache:admin to analyst / senior_analyst / manager / developer', () => {
    for (const nonAdmin of ['analyst', 'senior_analyst', 'manager', 'developer']) {
      const scopes = computeInternalScopesForRole(nonAdmin);
      expect(scopes).not.toContain('cache:admin');
      // Sanity: they still get the routine SDK scopes — only cache:admin is gated.
      expect(scopes).toContain('agents:read');
      expect(scopes).toContain('cache:read');
    }
  });

  it('returns no scopes for unknown roles or undefined', () => {
    expect(computeInternalScopesForRole(undefined)).toEqual([]);
    expect(computeInternalScopesForRole('attacker')).toEqual([]);
    expect(computeInternalScopesForRole('')).toEqual([]);
  });
});

describe('cache admin audit fail-closed policy', () => {
  // Reset the env between tests so each one observes a clean slate.
  let savedNodeEnv: string | undefined;
  let savedOverride: string | undefined;
  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    savedOverride = process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT;
  });
  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedOverride === undefined) delete process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT;
    else process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT = savedOverride;
  });

  it('requires audit success in production by default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT;
    const { shouldRequireAuditSuccess } = await import('../src/routes/jrx-sdk-gateway-routes.js');
    expect(shouldRequireAuditSuccess()).toBe(true);
  });

  it('does NOT require audit success in dev/test by default (so local invalidation works)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT;
    const { shouldRequireAuditSuccess } = await import('../src/routes/jrx-sdk-gateway-routes.js');
    expect(shouldRequireAuditSuccess()).toBe(false);
  });

  it('honors NV_CACHE_ADMIN_REQUIRE_AUDIT=1 in dev (staging-mirrors-prod knob)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT = '1';
    const { shouldRequireAuditSuccess } = await import('../src/routes/jrx-sdk-gateway-routes.js');
    expect(shouldRequireAuditSuccess()).toBe(true);
  });

  it('honors NV_CACHE_ADMIN_REQUIRE_AUDIT=0 to opt out even in production (escape hatch)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT = '0';
    const { shouldRequireAuditSuccess } = await import('../src/routes/jrx-sdk-gateway-routes.js');
    expect(shouldRequireAuditSuccess()).toBe(false);
  });
});
