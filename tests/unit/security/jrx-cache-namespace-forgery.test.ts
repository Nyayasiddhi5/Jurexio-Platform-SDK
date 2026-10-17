/**
 * NV-CACHE-NS-FORGERY-001 — the /cache/* SDK routes must never accept a
 * caller-supplied namespace.
 *
 * All five endpoints are gated on `documents:read` only — a broad, commonly
 * granted scope — yet each took its namespace from the request body with
 * `app_${applicationId}` as a mere DEFAULT. That exposed five distinct
 * cross-tenant operations to any SDK key:
 *
 *   /cache/lookup      read another firm's cached legal answers
 *   /cache/store       POISON them (attacker text served as our own answer)
 *   /cache/warm        bulk-poison many namespaces in one request
 *   /cache/invalidate  wipe another tenant's cache (cost-amplification: every
 *                      evicted entry becomes a fresh frontier-model call)
 *   /cache/flush       unscoped, platform-wide tier wipe
 *
 * Poisoning is the most serious direction and the least likely to be noticed: a
 * wiped cache is merely expensive, whereas a poisoned one silently returns wrong
 * law under the platform's own citation formatting.
 *
 * These are source-level assertions because booting the SDK gateway requires DB,
 * Redis and provider credentials. The invariant is nonetheless mechanical: the
 * namespace must be built from `ctx.applicationId` and never destructured from
 * `req.body`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const routes = readFileSync(
  join(process.cwd(), 'src/routes/jrx-sdk-gateway-routes.ts'),
  'utf8',
);

/** Slice a single route handler so assertions cannot leak across endpoints. */
function handler(path: string): string {
  const start = routes.indexOf(`router.post('${path}'`);
  expect(start, `${path} handler not found — was it renamed?`).toBeGreaterThan(-1);
  const next = routes.indexOf('\nrouter.', start + 10);
  const body = routes.slice(start, next === -1 ? undefined : next);
  /* Strip comments before asserting. The comment explaining WHY flush is refused
   * necessarily names `lmCacheService.flush()`, which would otherwise satisfy a
   * "does not call flush" assertion and make this suite fail on its own prose. */
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

const CACHE_ROUTES = ['/cache/lookup', '/cache/store', '/cache/invalidate', '/cache/warm', '/cache/flush'];

describe('NV-CACHE-NS-FORGERY-001 — namespace is derived, never supplied', () => {
  for (const path of CACHE_ROUTES) {
    it(`${path} does not destructure a namespace from the request body`, () => {
      const body = handler(path);
      // The precise defect shape: `const { prompt, namespace } = req.body`.
      expect(body).not.toMatch(/const\s*\{[^}]*\bnamespace\b[^}]*\}\s*=\s*req\.body/);
    });

    it(`${path} never falls back to a caller value with ||`, () => {
      // `namespace || \`app_${ctx.applicationId}\`` was the original hole: the
      // authenticated value was only a default, so any supplied value won.
      expect(handler(path)).not.toMatch(/namespace\s*\|\|\s*`app_/);
      expect(handler(path)).not.toMatch(/metadata\?\.namespace\s*\|\|/);
    });
  }

  it('lookup reads only from the authenticated application namespace', () => {
    const body = handler('/cache/lookup');
    expect(body).toContain('const namespace = `app_${ctx.applicationId}`');
    expect(body).toContain('lmCacheService.get(prompt, namespace)');
  });

  it('store stamps the namespace AFTER the metadata spread', () => {
    // Order is load-bearing: spreading `metadata` after the namespace would let a
    // caller smuggle another tenant's namespace back in through metadata.
    const body = handler('/cache/store');
    const spread = body.indexOf('...metadata');
    const stamp = body.indexOf('namespace: `app_${ctx.applicationId}`');
    expect(spread).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(spread);
  });

  it('warm re-stamps every entry, not just the first', () => {
    // `warmCache` reads `entry.metadata?.namespace` per entry, so a single
    // unscoped array was a bulk cross-tenant poisoning primitive.
    const body = handler('/cache/warm');
    expect(body).toMatch(/entries\.map\(/);
    expect(body).toContain('namespace: `app_${ctx.applicationId}`');
    expect(body).not.toMatch(/warmCache\(entries\)/);
  });

  it('invalidate can only evict the caller’s own namespace', () => {
    const body = handler('/cache/invalidate');
    expect(body).toContain('const namespace = `app_${ctx.applicationId}`');
    expect(body).toContain('invalidateNamespace(namespace)');
  });

  it('flush is refused outright rather than silently narrowed', () => {
    /* `lmCacheService.flush()` clears whole tiers and has no namespace dimension,
     * so it cannot be made tenant-safe by scoping an argument. Silently narrowing
     * it to the caller's namespace would mislead a caller who asked to flush all
     * and got a partial flush, so it is denied with an explanation instead. */
    const body = handler('/cache/flush');
    expect(body).toMatch(/res\.status\(403\)/);
    expect(body).not.toMatch(/lmCacheService\.flush\(/);
    expect(body).toMatch(/invalidate/i);
  });
});
