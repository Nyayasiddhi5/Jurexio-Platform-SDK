'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';
import { extractModelCatalogRows } from '@/hooks/useNvModelCatalog';

export interface LLMProviderRow {
  id: string;
  displayName: string;
  status: 'healthy' | 'warning' | 'error';
  models: string[];
  costTracking: { dailySpent: number };
  usageStats: { totalRequests: number; averageResponseTime: number };
}

function mapProviderStatus(raw: string): LLMProviderRow['status'] {
  const s = raw.toLowerCase();
  if (s === 'available' || s === 'healthy' || s === 'active' || s === 'ok') return 'healthy';
  if (s === 'degraded' || s === 'warning') return 'warning';
  return 'error';
}

async function fetchLLMProviders(): Promise<LLMProviderRow[]> {
  const statusPayload = (await apiRequest(nv('llm/status'))) as {
    providers?: Array<{ id?: string; name?: string; status?: string; models?: string[] }>;
    data?: { providers?: Array<{ id?: string; name?: string; status?: string; models?: string[] }> };
  };
  const modelsPayload = await apiRequest(nv('models'));

  const catalog = extractModelCatalogRows(modelsPayload);
  const byProvider = new Map<string, string[]>();
  for (const m of catalog) {
    const key = m.provider.toLowerCase();
    const list = byProvider.get(key) ?? [];
    list.push(m.id);
    byProvider.set(key, list);
  }

  const providersRaw = statusPayload.providers ?? statusPayload.data?.providers;

  if (Array.isArray(providersRaw) && providersRaw.length) {
    return providersRaw.map((p) => {
      const id = String(p.id ?? p.name ?? 'unknown').toLowerCase();
      const models = byProvider.get(id) ?? p.models ?? [];
      return {
        id,
        displayName: String(p.name ?? p.id ?? 'Provider'),
        status: mapProviderStatus(String(p.status ?? 'unknown')),
        models,
        costTracking: { dailySpent: 0 },
        usageStats: { totalRequests: models.length, averageResponseTime: 0 },
      };
    });
  }

  return Array.from(byProvider.entries()).map(([provider, models]) => ({
    id: provider,
    displayName: provider.charAt(0).toUpperCase() + provider.slice(1),
    status: 'healthy' as const,
    models,
    costTracking: { dailySpent: 0 },
    usageStats: { totalRequests: models.length, averageResponseTime: 0 },
  }));
}

export function useLLMProviders() {
  return useQuery({
    queryKey: ['llm', 'providers', nv('llm/status')],
    queryFn: fetchLLMProviders,
    refetchInterval: 30_000,
  });
}

export function useLLMProvider(providerId: string) {
  const q = useLLMProviders();
  return {
    ...q,
    data: q.data?.find((p) => p.id === providerId),
  };
}

export function useLLMModels() {
  return useQuery({
    queryKey: ['llm', 'models', nv('models')],
    queryFn: async () => extractModelCatalogRows(await apiRequest(nv('models'))),
    refetchInterval: 60_000,
  });
}

export function useLLMUsageAnalytics() {
  return useQuery({
    queryKey: ['llm', 'usage', nv('operations/provider-health')],
    queryFn: () => apiRequest(nv('operations/provider-health')),
    refetchInterval: 30_000,
  });
}

export function useToggleLLMProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (_args: { providerId: string; enabled: boolean }) => {
      throw new Error('Provider toggle is read-only — use Model Catalog admin routes.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm', 'providers'] });
    },
  });
}

export function useUpdateLLMProviderLimits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (_args: { providerId: string; limits: unknown }) => {
      throw new Error('Provider limits are read-only in this build.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm', 'providers'] });
    },
  });
}
