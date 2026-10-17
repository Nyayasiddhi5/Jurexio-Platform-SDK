'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { nv, p } from '@/lib/jrx-api-paths';

export interface OrchestrationHistoryRow {
  id?: string;
  type?: string;
  status: 'success' | 'error' | 'pending';
  executionTime?: number;
  usedAgents?: string[];
  actualCost?: number;
  startTime?: string | number;
}

function mapActivityToHistory(payload: unknown): OrchestrationHistoryRow[] {
  const root = payload as Record<string, unknown> | null | undefined;
  const events = Array.isArray(root?.events)
    ? root.events
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.recentExecutions)
        ? root.recentExecutions
        : Array.isArray(root?.data)
          ? root.data
          : [];

  return (events as Record<string, unknown>[]).map((ev, i) => {
    const statusCode = Number(ev.status ?? ev.statusCode ?? 200);
    const ok = ev.ok === true || (statusCode >= 200 && statusCode < 400);
    return {
      id: String(ev.requestId ?? ev.orchestrationId ?? ev.id ?? i),
      type: String(ev.route ?? ev.workflow ?? ev.type ?? 'orchestration'),
      status: ok ? 'success' : statusCode >= 500 ? 'error' : 'pending',
      executionTime: Number(ev.ms ?? ev.duration ?? ev.latency_ms ?? 0),
      usedAgents: ev.agent ? [String(ev.agent)] : undefined,
      actualCost: Number(ev.cost ?? ev.cost_usd ?? 0) || undefined,
      startTime: String(ev.ts ?? ev.timestamp ?? Date.now()),
    };
  });
}

export function useOrchestrationHistory() {
  return useQuery({
    queryKey: ['orchestration', 'history', nv('activity/recent')],
    queryFn: async () => {
      const recent = await apiRequest(`${nv('activity/recent')}?limit=25&eventType=orchestrate`);
      const mapped = mapActivityToHistory(recent);
      if (mapped.length) return mapped;
      const dash = await apiRequest(p('ORCHESTRATION_DASH'));
      return mapActivityToHistory(
        (dash as { recentExecutions?: unknown[] })?.recentExecutions
        ?? (dash as { data?: { recentExecutions?: unknown[] } })?.data?.recentExecutions,
      );
    },
    refetchInterval: 15_000,
  });
}

export function useOrchestrationStatus(id: string) {
  return useQuery({
    queryKey: ['orchestration', 'status', id],
    queryFn: () => apiRequest(`${nv('orchestration/lineage')}/${encodeURIComponent(id)}`),
    enabled: !!id,
    refetchInterval: 5_000,
  });
}

export function useExecuteOrchestration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: Record<string, unknown>) =>
      apiRequest(nv('orchestrate'), 'POST', request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestration'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['llm'] });
    },
  });
}
