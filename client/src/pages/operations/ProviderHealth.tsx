/**
 * LLM Provider Health tab — Task #302.
 * Backend: GET /api/jrx/operations/provider-health (analyst+; 30s refetch).
 */
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxErrorState } from '@/components/JrxErrorState';
import { p } from '@/lib/jrx-api-paths';
import { useOpsJurisdiction } from './useOpsJurisdiction';

type Row = { provider: string; calls24h: number; avgLatencyMs: number; successRate: number; usd24h: number };
type Resp = { providers: Row[]; liveModelHealth: unknown[]; windowHours: number; jurisdiction: string; generatedAt: string };

const PATH = p('OPS_PROVIDER_HEALTH');

export default function ProviderHealth() {
  const { jurisdiction, JurisdictionFilter } = useOpsJurisdiction();
  const url = jurisdiction === 'ALL' ? PATH : `${PATH}?jurisdiction=${jurisdiction}`;
  const q = useQuery<Resp>({
    queryKey: [PATH, jurisdiction],
    queryFn: () => fetch(url, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (q.isLoading) return <div className="p-4"><Skeleton className="h-64 w-full"/></div>;
  if (q.isError) return <JrxErrorState title="Could not load provider health" error={q.error} onRetry={() => q.refetch()} variant="card"/>;

  const providers = q.data?.providers ?? [];
  return (
    <div className="p-4 space-y-4" data-testid="ops-tab-provider-health">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Per-provider success rate, latency, and cost in the last {q.data?.windowHours ?? 24}h.</div>
        <JurisdictionFilter />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map((p) => {
          const ok = p.successRate >= 0.95;
          const warn = p.successRate >= 0.8 && !ok;
          const status = ok ? 'healthy' : warn ? 'degraded' : 'unhealthy';
          const dot = ok ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-rose-500';
          return (
            <div key={p.provider} className="rounded border p-4 bg-white" data-testid={`provider-card-${p.provider}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-sm font-semibold">{p.provider}</div>
                <span className={`flex items-center gap-1 text-xs ${ok ? 'text-emerald-700' : warn ? 'text-amber-700' : 'text-rose-700'}`}>
                  <span className={`w-2 h-2 rounded-full ${dot}`}/>{status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Calls (24h): <strong className="text-foreground">{p.calls24h.toLocaleString()}</strong></div>
                <div>Success rate: <strong className="text-foreground">{(p.successRate * 100).toFixed(1)}%</strong></div>
                <div>Avg latency: <strong className="text-foreground">{p.avgLatencyMs}ms</strong></div>
                <div>Cost (24h): <strong className="text-foreground">${p.usd24h.toFixed(4)}</strong></div>
              </div>
            </div>
          );
        })}
        {providers.length === 0 && (
          <div className="col-span-full p-6 text-center text-sm text-muted-foreground">No provider activity in the last 24h.</div>
        )}
      </div>
    </div>
  );
}
