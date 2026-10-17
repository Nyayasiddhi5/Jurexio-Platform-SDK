/**
 * task-367 (2026-05-13): Resolve a platform organisation's
 * `sdk_applications.id` so JWT-authenticated Console requests can carry a
 * real `applicationId` (instead of the historical 0 hard-code) and
 * downstream filters like `nv_customer_organizations.platform_id =
 * sdkContext.applicationId` actually return the partner's customer firms.
 *
 * Used by:
 *   - `src/middleware/jrx-sdk-gateway.ts` `tryJwtBypass` — fallback when the
 *     JWT does not yet carry an `applicationId` claim.
 *   - `src/routes/jrx-auth-routes.ts` login + refresh — to stamp the claim
 *     onto newly-issued tokens.
 *
 * Cached in-process for 60 s to avoid an extra round-trip on every API
 * call. Cache is keyed by orgId only — sdk_applications rows do not move
 * between orgs at runtime, so a cold-cache miss after a re-onboarding is
 * acceptable.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sdkApplications } from '@shared/schema.js';

interface CacheEntry { appId: number; expiresAt: number }
const cache = new Map<number, CacheEntry>();
const TTL_MS = 60_000;

export async function resolveApplicationIdForOrg(orgId: number | null | undefined): Promise<number | null> {
  if (!db || typeof orgId !== 'number' || !Number.isInteger(orgId) || orgId <= 0) return null;
  const now = Date.now();
  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > now) {
    return cached.appId > 0 ? cached.appId : null;
  }
  try {
    const apps = await db
      .select({ id: sdkApplications.id })
      .from(sdkApplications)
      .where(eq(sdkApplications.organizationId, orgId))
      .limit(1);
    const appId = apps[0]?.id ?? 0;
    cache.set(orgId, { appId, expiresAt: now + TTL_MS });
    return appId > 0 ? appId : null;
  } catch {
    return null;
  }
}

export function _resetApplicationIdCacheForTests(): void {
  cache.clear();
}
