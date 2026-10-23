/**
 * Recent Errors tab — Task #302.
 * Backend: GET /api/jrx/operations/recent-errors (analyst+; 30s refetch).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxErrorState } from '@/components/JrxErrorState';
import { p } from '@/lib/jrx-api-paths';
import { useOpsJurisdiction } from './useOpsJurisdiction';

type ErrRow = {
  id: string; ts: string; route: string | null; method: string | null;
  statusCode: number; provider: string | null; model: string | null;
  orgId: string | null; keyPrefix: string | null; jurisdiction: string | null;
  latencyMs: number; error: string | null;
};
type Resp = { errors: ErrRow[]; count: number; jurisdiction: string; generatedAt: string };

const PATH = p('OPS_RECENT_ERRORS');

export default function RecentErrors() {
  const { jurisdiction, JurisdictionFilter } = useOpsJurisdiction();
  const url = jurisdiction === 'ALL' ? PATH : `${PATH}?jurisdiction=${jurisdiction}`;
  const q = useQuery<Resp>({
    queryKey: [PATH, jurisdiction],
    queryFn: () => fetch(url, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 30000,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  if (q.isLoading) return <div className="p-4"><Skeleton className="h-64 w-full"/></div>;
  if (q.isError) return <JrxErrorState title="Could not load recent errors" error={q.error} onRetry={() => q.refetch()} variant="card"/>;

  const errors = q.data?.errors ?? [];
  return (
    <div className="p-4 space-y-3" data-testid="ops-tab-recent-errors">
      <div className="flex items-center justify-between">
        <div className="text-sm">Last <strong>{errors.length}</strong> failed requests (4xx/5xx, 24h window)</div>
        <JurisdictionFilter />
      </div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs">
            <tr>
              <th className="p-2 text-left">When</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Method</th>
              <th className="p-2 text-left">Route</th>
              <th className="p-2 text-left">Provider/Model</th>
              <th className="p-2 text-left">Org</th>
              <th className="p-2 text-right">Latency</th>
              <th className="p-2 text-left">Trace</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e) => (
              <>
                <tr key={e.id} className="border-t hover:bg-slate-50">
                  <td className="p-2 text-xs whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                  <td className="p-2"><span className={`text-xs font-semibold ${e.statusCode >= 500 ? 'text-rose-700' : 'text-amber-700'}`}>{e.statusCode}</span></td>
                  <td className="p-2 text-xs">{e.method}</td>
                  <td className="p-2 font-mono text-xs">{e.route}</td>
                  <td className="p-2 text-xs">{e.provider ?? '—'} / {e.model ?? '—'}</td>
                  <td className="p-2 text-xs">{e.orgId ?? '—'}</td>
                  <td className="p-2 text-right text-xs">{e.latencyMs}ms</td>
                  <td className="p-2">
                    {e.error && (
                      <button
                        className="text-xs text-blue-600 underline"
                        onClick={() => setOpenId(openId === e.id ? null : e.id)}
                        data-testid={`error-trace-toggle-${e.id}`}
                      >
                        {openId === e.id ? 'Hide' : 'Show'}
                      </button>
                    )}
                  </td>
                </tr>
                {openId === e.id && e.error && (
                  <tr><td colSpan={8} className="p-3 bg-slate-900 text-rose-200 font-mono text-xs whitespace-pre-wrap">{e.error}</td></tr>
                )}
              </>
            ))}
            {errors.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">No errors in the last 24h. 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
