import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Scale, Search } from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';

import { nv } from '@/lib/jrx-api-paths';
type Statute = {
  id: string | number;
  act_title?: string; act_short_title?: string; section_title?: string;
  section_number: string;
  jurisdiction: string; practice_area: string;
  effective_date?: string; is_repealed?: boolean;
  section_excerpt?: string; summary?: string;
};

const J = ['IN', 'US', 'UK', 'EU', 'SG', 'GC'] as const;

export default function StatutesCitations() {
  const [data, setData] = useState<Statute[]>([]);
  const [summary, setSummary] = useState<{ byJurisdiction: any[]; total: number } | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<string>('IN');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getAuthToken();
    const h = t ? { Authorization: `Bearer ${t}` } : {};
    Promise.all([
      fetch(nv('statutes?limit=500'), { headers: h }).then(r => r.ok ? r.json() : {}),
      fetch(nv('statutes/_summary'), { headers: h }).then(r => r.ok ? r.json() : null),
    ]).then(([list, sum]) => {
      setData((list.statutes ?? list.data ?? list.items ?? []) as Statute[]);
      if (sum) setSummary({ byJurisdiction: sum.by_jurisdiction ?? sum.byJurisdiction ?? [], total: sum.total ?? 0 });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => data.filter(s => s.jurisdiction === tab && (q === '' || (s.act_title ?? s.section_title ?? '').toLowerCase().includes(q.toLowerCase()) || s.section_number?.toLowerCase().includes(q.toLowerCase()))),
    [data, q, tab],
  );

  const countsByJ = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of summary?.byJurisdiction ?? []) m[r.jurisdiction] = r.count ?? r.c ?? 0;
    if (Object.keys(m).length === 0) for (const s of data) m[s.jurisdiction] = (m[s.jurisdiction] ?? 0) + 1;
    return m;
  }, [summary, data]);

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-statutes-citations">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-6 h-6" /> Statutes & Citations
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {summary?.total ?? data.length} statute sections across six jurisdictions, with full citation graph.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Statutes</CardTitle>
          <div className="relative w-72">
            <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-600" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search section number or title…" className="pl-8" data-testid="input-statute-search" />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {J.map(j => (
                <TabsTrigger key={j} value={j} data-testid={`tab-${j}`}>
                  {j} <span className="ml-1.5 text-xs opacity-60">({countsByJ[j] ?? 0})</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {J.map(j => (
              <TabsContent key={j} value={j} className="mt-4">
                {loading && <p className="text-sm text-slate-700">Loading…</p>}
                {!loading && filtered.length === 0 && <p className="text-sm text-slate-700">No matching statutes.</p>}
                <div className="space-y-2">
                  {filtered.map(s => (
                    <div key={String(s.id)} className="border border-slate-200 rounded-lg p-3 bg-white flex items-start justify-between gap-3" data-testid={`statute-${s.id}`}>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {s.act_short_title ?? s.act_title ?? ''} {s.section_number}{s.section_title ? ` — ${s.section_title}` : ''}
                        </p>
                        <p className="text-xs text-slate-700">{s.practice_area ?? 'general'}{s.effective_date ? ` · effective ${String(s.effective_date).slice(0, 10)}` : ''}</p>
                        {(s.section_excerpt ?? s.summary) && <p className="text-xs text-slate-600 mt-1 line-clamp-2">{s.section_excerpt ?? s.summary}</p>}
                      </div>
                      {s.is_repealed && <Badge variant="destructive">repealed</Badge>}
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
