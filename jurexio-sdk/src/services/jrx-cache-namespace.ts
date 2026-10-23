/**
 * Shared helper for building / parsing the per-agent cache namespace used
 * by the LM prompt cache.
 *
 * The format `jrx-agent:tenant:<id>:juris:<JURIS>:agent:<id>` is referenced
 * from three places:
 *
 *   1. `jrx-queen-orchestrator.ts#buildCacheNamespace` — writes/reads cache
 *      entries keyed by (tenant × jurisdiction × agent) (Task #38).
 *   2. `jrx-sdk-gateway-routes.ts` admin invalidation endpoints (Task #66) —
 *      lets ops blow away stale entries when statutes / system prompts /
 *      templates change.
 *   3. `scripts/jrx-cache-invalidate.ts` — CLI variant of (2) for ops who
 *      don't have an HTTP path into the gateway.
 *
 * Keeping the format in one place means we cannot accidentally invalidate
 * the wrong shape (a typo would leak stale answers to users).
 */

export const AGENT_CACHE_NAMESPACE_PREFIX = './jrx-agent';

export const FALLBACK_TENANT_ID = 'global';
export const FALLBACK_JURISDICTION = 'IN';

export interface AgentCacheNamespaceParts {
  tenantId?: string | null;
  jurisdiction?: string | null;
  agentId: string;
}

/**
 * Build the exact namespace string for one (tenant, jurisdiction, agent)
 * triple. Missing tenant/jurisdiction collapse to the same sentinels the
 * Queen orchestrator uses so reads and writes line up.
 */
export function buildAgentCacheNamespace(parts: AgentCacheNamespaceParts): string {
  const tenantId = (parts.tenantId ?? FALLBACK_TENANT_ID).toString();
  const jurisdiction = (parts.jurisdiction ?? FALLBACK_JURISDICTION).toString().toUpperCase();
  return `${AGENT_CACHE_NAMESPACE_PREFIX}:tenant:${tenantId}:juris:${jurisdiction}:agent:${parts.agentId}`;
}

export interface AgentCacheMatch {
  tenantId?: string;
  jurisdiction?: string;
  agentId?: string;
}

/**
 * Build a predicate that decides whether a given namespace matches the
 * supplied filter. Any field left undefined is treated as a wildcard.
 *
 * Used by the admin "clear cache by jurisdiction / by tenant" flows so the
 * caller doesn't have to construct hand-rolled regexes.
 */
export function matchAgentCacheNamespace(filter: AgentCacheMatch): (namespace?: string) => boolean {
  const tenantId = filter.tenantId?.toString();
  const jurisdiction = filter.jurisdiction?.toString().toUpperCase();
  const agentId = filter.agentId?.toString();

  return (namespace?: string): boolean => {
    if (!namespace || !namespace.startsWith(`${AGENT_CACHE_NAMESPACE_PREFIX}:`)) return false;
    const parsed = parseAgentCacheNamespace(namespace);
    if (!parsed) return false;
    if (tenantId && parsed.tenantId !== tenantId) return false;
    if (jurisdiction && parsed.jurisdiction !== jurisdiction) return false;
    if (agentId && parsed.agentId !== agentId) return false;
    return true;
  };
}

/**
 * Parse a namespace string back into its parts. Returns null on shape
 * mismatch so callers can ignore non-agent entries (e.g. legacy `legal`
 * warm entries seeded in lm-cache-service).
 */
export function parseAgentCacheNamespace(namespace: string): {
  tenantId: string;
  jurisdiction: string;
  agentId: string;
} | null {
  const re = new RegExp(`^${AGENT_CACHE_NAMESPACE_PREFIX}:tenant:([^:]+):juris:([^:]+):agent:(.+)$`);
  const m = namespace.match(re);
  if (!m) return null;
  return { tenantId: m[1], jurisdiction: m[2].toUpperCase(), agentId: m[3] };
}
