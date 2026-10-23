/**
 * Throughput tab — Task #302.
 * Backend: GET /api/jrx/operations/throughput (analyst+; 30s refetch).
 * Renders rpm (last 60 minutes) and rph (last 24 hours) as inline bar charts.
 */
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxErrorState } from '@/components/JrxErrorState';
import { p } from '@/lib/jrx-api-paths';
import { useOpsJurisdiction } from './useOpsJurisdiction';

type Bucket = { bucket: string; value: number };
type Resp = { perMinute: Bucket[]; perHour: Bucket[]; jurisdiction: string; generatedAt: string };

const PATH = p('OPS_THROUGHPUT');

function MiniBars({ data, label }: { data: Bucket[]; label: string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="rounded border p-4 bg-white" data-testid={`throughput-chart-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-semibold text-sm">{label}</h3>
        <span className="text-xs text-muted-foreground">peak: {max.toLocaleString()}</span>
      </div>
      {data.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">No traffic in window.</div>
      ) : (
        <div className="flex items-end gap-px h-32">
          {data.map((d, i) => (
            <div key={i} className="flex-1 bg-blue-500 hover:bg-blue-600 transition-colors min-w-0" style={{ height: `${(d.value / max) * 100}%` }} title={`${new Date(d.bucket).toLocaleString()}: ${d.value}`}/>
          ))}
        </div>
      )}
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{data[0] ? new Date(data[0].bucket).toLocaleTimeString() : ''}</span>
        <span>{data[data.length - 1] ? new Date(data[data.length - 1].bucket).toLocaleTimeString() : ''}</span>
      </div>
    </div>
  );
}

export default function Throughput() {
  const { jurisdiction, JurisdictionFilter } = useOpsJurisdiction();
  const url = jurisdiction === 'ALL' ? PATH : `${PATH}?jurisdiction=${jurisdiction}`;
  const q = useQuery<Resp>({
    queryKey: [PATH, jurisdiction],
    queryFn: () => fetch(url, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (q.isLoading) return <div className="p-4"><Skeleton className="h-64 w-full"/></div>;
  if (q.isError) return <JrxErrorState title="Could not load throughput" error={q.error} onRetry={() => q.refetch()} variant="card"/>;

  return (
    <div className="p-4 space-y-4" data-testid="ops-tab-throughput">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Requests per minute (last hour) and per hour (last 24h).</div>
        <JurisdictionFilter />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MiniBars data={q.data?.perMinute ?? []} label="Requests / minute (60m)"/>
        <MiniBars data={q.data?.perHour ?? []} label="Requests / hour (24h)"/>
      </div>
    </div>
  );
}
