/**
 * Jurisdiction Mapping — live registry browser (2026-05-28).
 * Backend: GET /api/jrx/jurisdiction/registries/stats + /registries/agents
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Map, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';

type RegistryStats = {
  totalAgents?: number;
  jurisdictions?: Array<{ code: string; name?: string; agentCount?: number; count?: number }>;
  data?: { totalAgents?: number; jurisdictions?: RegistryStats['jurisdictions'] };
};

type AgentRow = {
  id: string;
  name: string;
  jurisdiction: string;
  tier?: string;
  module?: string;
  practiceArea?: string;
  status?: string;
};

async function jget<T>(url: string): Promise<T> {
  const t = getAuthToken();
  const r = await fetch(url, { credentials: 'include', headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function JurisdictionMapping() {
  const [q, setQ] = useState('');
  const statsQ = useQuery({ queryKey: ['jurisdiction-stats'], queryFn: () => jget<RegistryStats>(p('JURISDICTION_REGISTRY_STATS')) });
  const agentsQ = useQuery({ queryKey: ['jurisdiction-agents'], queryFn: () => jget<{ data?: AgentRow[] }>(p('JURISDICTION_REGISTRY_AGENTS')) });

  const stats = statsQ.data?.data ?? statsQ.data;
  const agents = agentsQ.data?.data ?? [];
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    if (!needle) return agents.slice(0, 200);
    return agents.filter(a =>
      a.name?.toLowerCase().includes(needle) ||
      a.id?.toLowerCase().includes(needle) ||
      a.jurisdiction?.toLowerCase().includes(needle),
    ).slice(0, 200);
  }, [agents, q]);

  const byJur = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents) m.set(a.jurisdiction, (m.get(a.jurisdiction) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [agents]);

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-jurisdiction-mapping">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Map className="w-6 h-6" /> Jurisdiction Mapping
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {stats?.totalAgents ?? agents.length} agents across {byJur.length} jurisdiction registries.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { statsQ.refetch(); agentsQ.refetch(); }} disabled={statsQ.isFetching || agentsQ.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${statsQ.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        {(statsQ.isLoading ? Array.from({ length: 4 }) : byJur.slice(0, 8)).map((row, i) => (
          <Card key={typeof row === 'object' ? row[0] : i}>
            <CardContent className="p-4">
              {statsQ.isLoading ? <Skeleton className="h-10" /> : (
                <>
                  <div className="text-xs text-slate-600">{row[0]}</div>
                  <div className="text-xl font-bold">{row[1]}</div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Agent capability matrix</CardTitle>
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter agents…" className="max-w-xs" data-testid="input-jurisdiction-search" />
        </CardHeader>
        <CardContent className="p-0">
          {agentsQ.isLoading && <div className="p-4"><Skeleton className="h-32" /></div>}
          {!agentsQ.isLoading && (
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">Agent</th>
                    <th className="text-left px-4 py-2">Jurisdiction</th>
                    <th className="text-left px-4 py-2">Tier</th>
                    <th className="text-left px-4 py-2">Practice</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs">{a.name || a.id}</td>
                      <td className="px-4 py-2"><Badge variant="outline">{a.jurisdiction}</Badge></td>
                      <td className="px-4 py-2">{a.tier ?? '—'}</td>
                      <td className="px-4 py-2 text-xs">{a.practiceArea ?? a.module ?? '—'}</td>
                      <td className="px-4 py-2 text-xs">{a.status ?? 'active'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
