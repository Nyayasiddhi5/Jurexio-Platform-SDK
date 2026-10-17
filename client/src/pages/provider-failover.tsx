/**
 * Provider Failover Dashboard — wired to the canonical aggregator
 * `/api/jrx/providers/failover` (Task #194 / 2026-05-12).
 *
 * Backend: src/routes/jrx-operations-aggregators.ts → GET /api/jrx/providers/failover
 * Auth:    analyst+; 15s refetch.
 *
 * Path imported via `p('PROVIDER_FAILOVER')` from jrx-api-paths.ts. The aggregator
 * returns providers (with `lastFailoverAt`, latency, error rate, env-key presence)
 * and the live model-health snapshot.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { JrxErrorState } from "@/components/JrxErrorState";
import { JrxEmptyState } from "@/components/JrxEmptyState";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow } from "date-fns";
import { p } from "@/lib/jrx-api-paths";

type Provider = {
  name: string;
  displayName: string;
  status: 'healthy' | 'degraded' | 'down' | 'disabled' | string;
  envKeyPresent: boolean;
  latencyMs: number | null;
  errorRate: number | null;
  calls24h: number;
  lastFailoverAt: string | null;
};

type ModelHealth = {
  modelId: string;
  ok: number;
  fail: number;
  failureRate: number;
  p50?: number;
  p95?: number;
  healthScore: number;
};

type FailoverResponse = {
  providers: Provider[];
  modelHealth: ModelHealth[];
  generatedAt: string;
};

const FAILOVER_PATH = p('PROVIDER_FAILOVER');

function statusBadge(status: string) {
  switch (status) {
    case 'healthy':  return 'bg-emerald-600';
    case 'degraded': return 'bg-amber-600';
    case 'down':     return 'bg-red-600';
    case 'disabled': return 'bg-slate-500';
    default:         return 'bg-slate-500';
  }
}

export default function ProviderFailoverPage() {
  const q = useQuery<FailoverResponse>({
    queryKey: [FAILOVER_PATH],
    queryFn: () => fetch(FAILOVER_PATH, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 15000,
  });

  const providers = q.data?.providers ?? [];
  const health = (q.data?.modelHealth ?? []).slice().sort((a, b) => a.healthScore - b.healthScore);
  const degraded = providers.filter((p) => p.status === 'degraded').length;
  const down = providers.filter((p) => p.status === 'down').length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-provider-failover">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Provider Failover Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Canonical failover aggregator — provider status, last failover timestamp, 24h latency &amp; error rate,
          plus live per-model health.
        </p>
      </div>

      {q.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="loading-provider-failover">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {q.isError && (
        <JrxErrorState
          title="Could not load provider failover data"
          description={`Unable to retrieve ${FAILOVER_PATH}. You may not have analyst+ access.`}
          error={q.error}
          onRetry={() => q.refetch()}
          variant="card"
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Providers tracked</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{providers.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Degraded</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-amber-600">{degraded}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Down</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-red-600">{down}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Provider status</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Provider</th>
                <th className="p-2">Status</th>
                <th className="p-2">Env key</th>
                <th className="p-2">Avg latency (24h)</th>
                <th className="p-2">Error rate (24h)</th>
                <th className="p-2">Calls (24h)</th>
                <th className="p-2">Last failover</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><JrxEmptyState title="No provider data yet" description="Provider failover statistics will appear once requests have been routed." size="sm" /></td></tr>
              ) : providers.map((p) => (
                <tr key={p.name} className="border-b hover:bg-muted/30" data-testid={`provider-row-${p.name}`}>
                  <td className="p-2 font-mono text-xs">
                    <div>{p.displayName}</div>
                    <div className="text-muted-foreground">{p.name}</div>
                  </td>
                  <td className="p-2"><Badge className={statusBadge(p.status)}>{p.status}</Badge></td>
                  <td className="p-2 text-xs">{p.envKeyPresent ? '✓ present' : '✗ missing'}</td>
                  <td className="p-2 text-xs">{p.latencyMs != null ? `${p.latencyMs} ms` : '—'}</td>
                  <td className="p-2 text-xs">{p.errorRate != null ? `${(p.errorRate * 100).toFixed(1)}%` : '—'}</td>
                  <td className="p-2 text-xs">{p.calls24h.toLocaleString()}</td>
                  <td className="p-2 text-xs" data-testid={`last-failover-${p.name}`}>
                    {p.lastFailoverAt
                      ? formatDistanceToNow(new Date(p.lastFailoverAt), { addSuffix: true })
                      : <span className="text-muted-foreground">never</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Per-model health (live router snapshot)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Model</th>
                <th className="p-2">OK / Fail</th>
                <th className="p-2">Failure rate</th>
                <th className="p-2">Health score</th>
                <th className="p-2 w-1/3">Score bar</th>
              </tr>
            </thead>
            <tbody>
              {health.length === 0 ? (
                <tr><td colSpan={5} className="p-0"><JrxEmptyState title="No model health data yet" description="Per-model health metrics will appear once the orchestrator reports them." size="sm" /></td></tr>
              ) : health.map((h) => (
                <tr key={h.modelId} className="border-b hover:bg-muted/30">
                  <td className="p-2 font-mono text-xs">{h.modelId}</td>
                  <td className="p-2 text-xs">{h.ok} / {h.fail}</td>
                  <td className="p-2 text-xs">{(h.failureRate * 100).toFixed(1)}%</td>
                  <td className="p-2">
                    <Badge className={h.healthScore >= 0.85 ? "bg-emerald-600" : h.healthScore >= 0.5 ? "bg-amber-600" : "bg-red-600"}>
                      {(h.healthScore * 100).toFixed(0)}%
                    </Badge>
                  </td>
                  <td className="p-2"><Progress value={h.healthScore * 100} className="h-2" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {q.data?.generatedAt && (
        <p className="text-xs text-muted-foreground">Generated {new Date(q.data.generatedAt).toLocaleString()}</p>
      )}
    </div>
  );
}
