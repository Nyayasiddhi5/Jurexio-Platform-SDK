import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Database } from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';

import { nv } from '@/lib/jrx-api-paths';
type Ns = {
  id: string; name: string; description: string;
  embedding_model: string; dimensions: number;
  document_count: number; vector_count: number; total_tokens: number;
  is_default: boolean; metadata: any;
};

const J = ['IN', 'US', 'UK', 'EU', 'SG', 'GC'] as const;

export default function RagKnowledgeBase() {
  const [data, setData] = useState<Ns[]>([]);
  const [tab, setTab] = useState<string>('IN');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getAuthToken();
    const tryFetch = (url: string) => fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.error === 'org_context_required') return null;
        return j;
      });
    // Try plain first; fall back to ?org_id=1 (super_admin path) for users without org binding.
    (async () => {
      const j = (await tryFetch(nv('rag/collections?limit=200'))) ?? (await tryFetch(nv('rag/collections?limit=200&org_id=1')));
      const list = (j?.collections ?? j?.data ?? j?.items ?? []) as any[];
      setData(list.map(r => ({
        ...r,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata ?? {}),
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(
    () => data.filter(n => (n.metadata?.jurisdiction ?? 'IN') === tab),
    [data, tab],
  );
  const totals = useMemo(() => {
    const docs = data.reduce((s, n) => s + (n.document_count ?? 0), 0);
    const vecs = data.reduce((s, n) => s + (n.vector_count ?? 0), 0);
    const toks = data.reduce((s, n) => s + (n.total_tokens ?? 0), 0);
    return { docs, vecs, toks };
  }, [data]);

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-rag-knowledge-base">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Database className="w-6 h-6" /> RAG Knowledge Base
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          GraphRAG namespaces across six jurisdictions — embeddings, document counts, retrieval namespaces.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-sm text-slate-700">Documents</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-slate-900">{totals.docs.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-slate-700">Vectors</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-slate-900">{totals.vecs.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-slate-700">Tokens indexed</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-slate-900">{totals.toks.toLocaleString()}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Namespaces ({data.length})</CardTitle></CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>{J.map(j => <TabsTrigger key={j} value={j} data-testid={`tab-${j}`}>{j}</TabsTrigger>)}</TabsList>
            {J.map(j => (
              <TabsContent key={j} value={j} className="mt-4">
                {loading && <p className="text-sm text-slate-700">Loading…</p>}
                {!loading && filtered.length === 0 && <p className="text-sm text-slate-700">No namespaces in this jurisdiction.</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  {filtered.map(n => (
                    <div key={n.id} className="border border-slate-200 rounded-lg p-4 bg-white" data-testid={`ns-${n.name}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{n.name}</p>
                          <p className="text-xs text-slate-700 mt-0.5">{n.embedding_model} · {n.dimensions}-d</p>
                        </div>
                        {n.is_default && <Badge variant="default">default</Badge>}
                      </div>
                      <p className="text-sm text-slate-600 mt-2">{n.description}</p>
                      <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                        <div><p className="text-slate-600">Docs</p><p className="font-semibold text-slate-900">{(n.document_count ?? 0).toLocaleString()}</p></div>
                        <div><p className="text-slate-600">Vectors</p><p className="font-semibold text-slate-900">{(n.vector_count ?? 0).toLocaleString()}</p></div>
                        <div><p className="text-slate-600">Tokens</p><p className="font-semibold text-slate-900">{(n.total_tokens ?? 0).toLocaleString()}</p></div>
                      </div>
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
