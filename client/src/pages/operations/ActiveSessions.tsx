/**
 * Active Sessions tab — Task #302 (Operations Hub).
 * Backend: GET /api/jrx/operations/active-sessions (analyst+; 30s refetch).
 */
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvErrorState } from '@/components/NyvErrorState';
import { p } from '@/lib/jrx-api-paths';
import { useOpsJurisdiction } from './useOpsJurisdiction';

type Session = {
  keyPrefix: string; orgId: string | null; route: string | null;
  provider: string | null; model: string | null; latencyMs: number;
  jurisdiction: string | null; ts: string;
};
type Resp = {
  sessions: Session[];
  counts: { total: number; distinctKeys: number; distinctOrgs: number };
  windowMinutes: number; jurisdiction: string; generatedAt: string;
};

const PATH = p('OPS_ACTIVE_SESSIONS');

export default function ActiveSessions() {
  const { jurisdiction, JurisdictionFilter } = useOpsJurisdiction();
  const url = jurisdiction === 'ALL' ? PATH : `${PATH}?jurisdiction=${jurisdiction}`;
  const q = useQuery<Resp>({
    queryKey: [PATH, jurisdiction],
    queryFn: () => fetch(url, { credentials: 'include' }).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (q.isLoading) return <div className="p-4 space-y-3"><Skeleton className="h-10 w-full"/><Skeleton className="h-64 w-full"/></div>;
  if (q.isError) return <NyvErrorState title="Could not load active sessions" error={q.error} onRetry={() => q.refetch()} variant="card"/>;

  const d = q.data;
  return (
    <div className="p-4 space-y-4" data-testid="ops-tab-active-sessions">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-4 text-sm">
          <div data-testid="active-sessions-total"><strong>{d?.counts.total ?? 0}</strong> sessions (last {d?.windowMinutes ?? 5}m)</div>
          <div><strong>{d?.counts.distinctKeys ?? 0}</strong> unique keys</div>
          <div><strong>{d?.counts.distinctOrgs ?? 0}</strong> unique orgs</div>
        </div>
        <JurisdictionFilter />
      </div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs">
            <tr>
              <th className="text-left p-2">When</th>
              <th className="text-left p-2">Key</th>
              <th className="text-left p-2">Org</th>
              <th className="text-left p-2">Route</th>
              <th className="text-left p-2">Provider</th>
              <th className="text-left p-2">Model</th>
              <th className="text-right p-2">Latency</th>
              <th className="text-left p-2">Jur</th>
            </tr>
          </thead>
          <tbody>
            {(d?.sessions ?? []).map((s, i) => (
              <tr key={i} className="border-t">
                <td className="p-2 text-xs whitespace-nowrap">{new Date(s.ts).toLocaleTimeString()}</td>
                <td className="p-2 font-mono text-xs">{s.keyPrefix}</td>
                <td className="p-2 text-xs">{s.orgId ?? '—'}</td>
                <td className="p-2 font-mono text-xs">{s.route}</td>
                <td className="p-2 text-xs">{s.provider}</td>
                <td className="p-2 font-mono text-xs">{s.model}</td>
                <td className="p-2 text-right text-xs">{s.latencyMs}ms</td>
                <td className="p-2 text-xs">{s.jurisdiction ?? '—'}</td>
              </tr>
            ))}
            {(d?.sessions ?? []).length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground text-sm">No active sessions in the last 5 minutes.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
