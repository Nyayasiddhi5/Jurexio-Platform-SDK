/**
 * Operations Overview — wired to the canonical aggregator
 * `/api/jrx/operations/overview` (Task #194 / 2026-05-12).
 *
 * Backend: src/routes/jrx-operations-aggregators.ts → GET /api/jrx/operations/overview
 * Auth:    analyst+; 30s refetch.
 *
 * Path imported via `p('OPERATIONS_OVERVIEW')` from nv-api-paths.ts. Rendered
 * as the "Overview" tab inside hubs/OperationsHub.tsx.
 */
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvErrorState } from '@/components/NyvErrorState';
import { p } from '@/lib/jrx-api-paths';

type OperationsOverview = {
  activeAgents: number;
  runsLast24h: number;
  errorsLast24h: number;
  avgLatencyMs: number;
  queueDepth: number;
  errorRate24h: number;
  sources: { runsFromDb: number; runsFromLiveRouter: number };
  generatedAt: string;
};

const OPS_OVERVIEW_PATH = p('OPERATIONS_OVERVIEW');

export default function OperationsOverview() {
  const q = useQuery<OperationsOverview>({
    queryKey: [OPS_OVERVIEW_PATH],
    queryFn: () => fetch(OPS_OVERVIEW_PATH, { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  if (q.isLoading) {
    return (
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="page-operations-overview">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (q.isError) {
    return (
      <NyvErrorState
        title="Could not load operations overview"
        description={`Unable to retrieve ${OPS_OVERVIEW_PATH}. You may not have analyst+ access.`}
        error={q.error}
        onRetry={() => q.refetch()}
        variant="card"
      />
    );
  }

  const d = q.data;
  const tile = (label: string, value: string, sub?: string, testid?: string) => (
    <Card data-testid={testid}>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 space-y-4" data-testid="page-operations-overview">
      <div>
        <h2 className="text-lg font-semibold">Operations overview</h2>
        <p className="text-sm text-muted-foreground">
          Canonical aggregator — active agents, 24h run/error counts, queue depth, and average latency. Auto-refreshes every 30s.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {tile('Active agents', String(d?.activeAgents ?? 0), undefined, 'tile-active-agents')}
        {tile(
          'Runs (24h)',
          (d?.runsLast24h ?? 0).toLocaleString(),
          `${d?.sources?.runsFromDb ?? 0} from DB · ${d?.sources?.runsFromLiveRouter ?? 0} from router`,
          'tile-runs-24h',
        )}
        {tile(
          'Errors (24h)',
          (d?.errorsLast24h ?? 0).toLocaleString(),
          `${((d?.errorRate24h ?? 0) * 100).toFixed(2)}% error rate`,
          'tile-errors-24h',
        )}
        {tile('Avg latency', `${d?.avgLatencyMs ?? 0} ms`, '24h SDK metrics', 'tile-avg-latency')}
        {tile('Queue depth', String(d?.queueDepth ?? 0), 'pending + queued + running', 'tile-queue-depth')}
      </div>

      {d?.generatedAt && (
        <p className="text-xs text-muted-foreground">Generated {new Date(d.generatedAt).toLocaleString()}</p>
      )}
    </div>
  );
}
