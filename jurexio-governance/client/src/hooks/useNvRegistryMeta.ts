/**
 * Shared runtime registry metadata for Console operational pages.
 * Prefers live `/api/jrx/health` payload; falls back to v5.1.0 / 164 defaults.
 */
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';

export const NV_REGISTRY_DEFAULTS = {
  registryVersion: '5.1.0',
  totalAgents: 164,
  platformVersion: '5.1.0',
} as const;

type HealthAgents = {
  registryVersion?: string;
  totalAgents?: number;
  registryFormat?: string;
};

type HealthPayload = {
  version?: string;
  platformVersion?: string;
  registryVersion?: string;
  totalAgents?: number;
  agents?: HealthAgents;
};

export function useNvRegistryMeta() {
  const q = useQuery({
    queryKey: [nv('health')],
    queryFn: () => apiRequest(nv('health'), 'GET') as Promise<HealthPayload>,
    staleTime: 60_000,
    retry: 1,
  });

  const h = q.data;
  const agents = h?.agents;

  return {
    isLoading: q.isLoading,
    registryVersion:
      agents?.registryVersion ??
      h?.registryVersion ??
      NV_REGISTRY_DEFAULTS.registryVersion,
    totalAgents:
      agents?.totalAgents ??
      h?.totalAgents ??
      NV_REGISTRY_DEFAULTS.totalAgents,
    platformVersion:
      h?.platformVersion ??
      h?.version ??
      NV_REGISTRY_DEFAULTS.platformVersion,
    registryFormat: agents?.registryFormat,
  };
}
