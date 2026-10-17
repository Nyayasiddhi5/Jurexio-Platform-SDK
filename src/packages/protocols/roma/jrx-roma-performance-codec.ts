import type { AgentMetrics, PerformanceMetrics } from './types.js';

const MAX_AGENTS = 500;

export function serializeRomaStore(store: PerformanceMetrics): string {
  const keys = Object.keys(store).slice(0, MAX_AGENTS);
  const out: Record<string, Record<string, unknown>> = {};
  for (const k of keys) {
    const m = store[k];
    if (!m) continue;
    out[k] = {
      usageCount: m.usageCount,
      successRate: m.successRate,
      fallbackRate: m.fallbackRate,
      averageLatencyMs: m.averageLatencyMs,
      hallucinationFlags: m.hallucinationFlags,
      lastUsed: m.lastUsed instanceof Date ? m.lastUsed.toISOString() : m.lastUsed,
    };
  }
  return JSON.stringify(out);
}

export function deserializeRomaStore(raw: string): PerformanceMetrics {
  const parsed = JSON.parse(raw) as Record<string, Partial<AgentMetrics> & { lastUsed?: string | Date }>;
  const out: PerformanceMetrics = {};
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [id, m] of Object.entries(parsed)) {
    if (!id || !m || typeof m !== 'object') continue;
    const last = m.lastUsed;
    out[id] = {
      usageCount: Number(m.usageCount) || 0,
      successRate: Number(m.successRate) || 0,
      fallbackRate: Number(m.fallbackRate) || 0,
      averageLatencyMs: Number(m.averageLatencyMs) || 0,
      hallucinationFlags: Number(m.hallucinationFlags) || 0,
      lastUsed: last ? new Date(last) : new Date(),
    };
  }
  return out;
}

/** Copy incoming keys into target only when the target does not already have them. */
export function mergeRomaStoreIfMissing(target: PerformanceMetrics, incoming: PerformanceMetrics): number {
  let added = 0;
  for (const [id, metrics] of Object.entries(incoming)) {
    if (!id || !metrics || target[id]) continue;
    target[id] = { ...metrics };
    added += 1;
  }
  return added;
}
