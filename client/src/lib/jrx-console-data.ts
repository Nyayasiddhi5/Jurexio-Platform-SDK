/**
 * Shared helpers for Console / SDK Hub API payload normalization.
 * apiRequest wraps bare arrays as `{ data: T[] }` via makeResult().
 */
import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';

export function nvAsArray(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as any[];
    if (Array.isArray(o.items)) return o.items as any[];
    if (Array.isArray(o.agents)) return o.agents as any[];
    if (Array.isArray(o.statutes)) return o.statutes as any[];
    if (o.data && typeof o.data === 'object') {
      const inner = o.data as Record<string, unknown>;
      if (Array.isArray(inner.agents)) return inner.agents as any[];
      if (Array.isArray(inner.items)) return inner.items as any[];
    }
  }
  return [];
}

export function nvAsObject(payload: unknown): Record<string, any> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
      return o.data as Record<string, any>;
    }
    return o as Record<string, any>;
  }
  return {};
}

export function nvHealthStatus(payload: unknown): 'OPERATIONAL' | 'DEGRADED' | 'CHECKING' {
  if (!payload) return 'CHECKING';
  const o = nvAsObject(payload);
  const raw = String(o.status ?? o.overall ?? '').toLowerCase();
  if (raw === 'healthy' || raw === 'operational' || raw === 'ok') return 'OPERATIONAL';
  if (raw === 'degraded' || raw === 'unhealthy') return 'DEGRADED';
  return 'DEGRADED';
}

export function nvAgentCount(agentPayload: unknown, healthPayload?: unknown): number {
  const agents = nvAsArray(agentPayload);
  if (agents.length > 0) return agents.length;
  const h = nvAsObject(healthPayload);
  const fromHealth = Number(h.totalAgents ?? h.agents?.total ?? h.services?.agents?.total);
  if (Number.isFinite(fromHealth) && fromHealth > 0) return fromHealth;
  return JRX_REGISTRY_RUNTIME.totalAgents;
}

export const NV_JURISDICTION_META = [
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'EU', name: 'European Union', flag: '🇪🇺' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'GC', name: 'GCC', flag: '🕌' },
] as const;

export function nvJurisdictionsFromStatutesSummary(summary: unknown): Array<{
  code: string; name: string; flag: string; statutes: number; active: boolean;
}> {
  const s = nvAsObject(summary);
  const byJur: Array<{ jurisdiction?: string; count?: number; c?: number }> =
    nvAsArray(s.by_jurisdiction).length
      ? nvAsArray(s.by_jurisdiction)
      : nvAsArray(s.byJurisdiction);

  const countMap: Record<string, number> = {};
  for (const row of byJur) {
    const code = String(row.jurisdiction ?? '').toUpperCase();
    if (code) countMap[code] = Number(row.count ?? row.c ?? 0);
  }

  return NV_JURISDICTION_META.map(j => ({
    ...j,
    statutes: countMap[j.code] ?? 0,
    active: (countMap[j.code] ?? 0) > 0 || j.code === 'IN',
  }));
}
