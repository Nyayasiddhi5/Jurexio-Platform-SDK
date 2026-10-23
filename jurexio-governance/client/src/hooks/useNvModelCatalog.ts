import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';

export interface NvModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  tier: string;
  ctx: string;
}

function normalizeCatalogRow(m: Record<string, unknown>): NvModelCatalogEntry | null {
  const id = String(m.id ?? m.model_id ?? m.modelId ?? '').trim();
  if (!id) return null;
  const ctxRaw = m.contextLength ?? m.ctx;
  const ctx =
    typeof ctxRaw === 'number' && ctxRaw >= 1000
      ? `${Math.round(ctxRaw / 1000)}K`
      : String(ctxRaw ?? '—');
  return {
    id,
    name: String(m.name ?? m.displayName ?? id),
    provider: String(m.provider ?? '—'),
    tier: String(m.tier ?? m.legalQuality ?? m.costTier ?? '—'),
    ctx,
  };
}

export function extractModelCatalogRows(payload: unknown): NvModelCatalogEntry[] {
  const root = payload as Record<string, unknown> | null | undefined;
  const rows =
    (Array.isArray(root?.models) && root.models) ||
    (Array.isArray((root?.data as Record<string, unknown> | undefined)?.models) &&
      (root?.data as { models: unknown[] }).models) ||
    (Array.isArray(root?.data) && root.data) ||
    (Array.isArray(payload) && payload) ||
    [];
  return (rows as Record<string, unknown>[])
    .map(normalizeCatalogRow)
    .filter((m): m is NvModelCatalogEntry => m != null);
}

/** Live model catalog from GET /api/jrx/models (intelligent-router SSoT). */
export function useNvModelCatalog(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [nv('models'), 'catalog-hook'],
    enabled: options?.enabled !== false,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await apiRequest(nv('models'));
      return extractModelCatalogRows(r);
    },
  });
}

/** Default orchestration model — first recommended entry or catalog fallback. */
export function pickDefaultOrchestrationModel(models: NvModelCatalogEntry[]): string {
  if (!models.length) return 'claude-opus-4-6';
  const preferred =
    models.find((m) => /opus|3\.1-pro|gpt-4\.1(?!-(mini|nano))/i.test(m.id)) ??
    models.find((m) => /sonnet|flash|4\.1/i.test(m.id)) ??
    models[0];
  return preferred?.id ?? 'claude-opus-4-6';
}
