import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Network, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { nv } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

interface SwarmTopology {
  id?: string;
  topologyId?: string;
  name?: string;
  category?: string;
  description?: string;
  agentCount?: number;
  grpoCompatible?: boolean;
}

interface SwarmPayload {
  topologies?: SwarmTopology[];
  stats?: { total?: number; byCategory?: Record<string, number> };
}

const REFRESH_MS = 30_000;

export default function SwarmTopologiesPanel() {
  const statsQ = useQuery({
    queryKey: [nv('swarm/stats')],
    queryFn: () => nvFetchJson<{ total?: number; byCategory?: Record<string, number> }>(nv('swarm/stats')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const topologiesQ = useQuery({
    queryKey: [nv('swarm/topologies'), { limit: 48 }],
    queryFn: () => nvFetchJson<SwarmPayload>(`${nv('swarm/topologies')}?limit=48`),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const topologies = topologiesQ.data?.topologies ?? [];
  const total = topologiesQ.data?.stats?.total ?? statsQ.data?.total ?? topologies.length;
  const byCategory = topologiesQ.data?.stats?.byCategory ?? statsQ.data?.byCategory ?? {};
  const isError = statsQ.isError || topologiesQ.isError;
  const isLoading = statsQ.isLoading || topologiesQ.isLoading;

  if (isError) {
    return (
      <div className="p-6">
        <JrxErrorState
          title="Swarm registry unavailable"
          description="Could not load GET /api/jrx/swarm/topologies or /api/jrx/swarm/stats — check JWT session."
          onRetry={() => { void statsQ.refetch(); void topologiesQ.refetch(); }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-slate-50" data-testid="swarm-topologies-panel">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
              Swarm Topologies
            </h1>
            <p className="text-sm mt-1 text-slate-600">
              Live topology catalog from <code>GET /api/jrx/swarm/topologies</code> — ROMA L5 mode-dispatch registry.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { void statsQ.refetch(); void topologiesQ.refetch(); }}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-slate-600">Total topologies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{isLoading ? '—' : total}</div>
            </CardContent>
          </Card>
          {Object.entries(byCategory).slice(0, 3).map(([cat, n]) => (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-slate-600">{cat}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{n}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <Network className="h-4 w-4" style={{ color: '#C7B15B' }} />
              Topology catalog
            </CardTitle>
            <CardDescription>Registered swarm coordination patterns — not static demo data.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            )}
            {!isLoading && topologies.length === 0 && (
              <JrxEmptyState
                title="No swarm topologies returned"
                description="The gateway registry may be warming up. Retry or check operator JWT."
              />
            )}
            {!isLoading && topologies.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {topologies.map((t) => {
                  const id = t.topologyId ?? t.id ?? t.name ?? 'topology';
                  return (
                    <div
                      key={id}
                      className="rounded-lg border border-slate-200 bg-white p-4 space-y-2"
                      data-testid={`swarm-topo-${id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm text-slate-900">{t.name ?? id}</p>
                        {t.category ? (
                          <Badge variant="outline" className="text-xs shrink-0">{t.category}</Badge>
                        ) : null}
                      </div>
                      {t.description ? (
                        <p className="text-xs text-slate-600 line-clamp-2">{t.description}</p>
                      ) : null}
                      <div className="flex gap-2 text-xs text-slate-500">
                        {t.agentCount != null ? <span>{t.agentCount} agents</span> : null}
                        {t.grpoCompatible ? <Badge variant="secondary" className="text-xs">GRPO</Badge> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
