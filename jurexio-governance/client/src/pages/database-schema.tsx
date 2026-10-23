/**
 * Database Schema browser — pg_catalog table list (2026-05-28).
 * Backend: GET /api/jrx/db/schema (super_admin)
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';

type TableRow = { schema: string; table: string; columns: number };

type SchemaResp = {
  success: boolean;
  total_tables: number;
  schemas: Record<string, number>;
  tables: TableRow[];
  generatedAt: string;
};

async function jget<T>(url: string): Promise<T> {
  const t = getAuthToken();
  const r = await fetch(url, { credentials: 'include', headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function DatabaseSchema() {
  const [q, setQ] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('all');

  const query = useQuery({
    queryKey: ['db-schema'],
    queryFn: () => jget<SchemaResp>(p('DB_SCHEMA')),
  });

  const schemas = Object.keys(query.data?.schemas ?? {});
  const filtered = useMemo(() => {
    let rows = query.data?.tables ?? [];
    if (schemaFilter !== 'all') rows = rows.filter(r => r.schema === schemaFilter);
    const needle = q.toLowerCase();
    if (needle) rows = rows.filter(r => `${r.schema}.${r.table}`.toLowerCase().includes(needle));
    return rows;
  }, [query.data, q, schemaFilter]);

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-database-schema">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-6 h-6" /> Database Schema
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {query.data?.total_tables ?? '—'} tables across {schemas.length} schemas (information_schema).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${query.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={schemaFilter === 'all' ? 'default' : 'outline'} onClick={() => setSchemaFilter('all')}>All</Button>
        {schemas.map(s => (
          <Button key={s} size="sm" variant={schemaFilter === s ? 'default' : 'outline'} onClick={() => setSchemaFilter(s)}>
            {s} ({query.data?.schemas[s]})
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Tables</CardTitle>
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tables…" className="max-w-xs" />
        </CardHeader>
        <CardContent className="p-0">
          {query.isLoading && <div className="p-4"><Skeleton className="h-32" /></div>}
          {query.isError && (
            <p className="p-4 text-sm text-amber-800">Schema browser requires super_admin role (403 otherwise).</p>
          )}
          {!query.isLoading && !query.isError && (
            <div className="max-h-[560px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">Schema</th>
                    <th className="text-left px-4 py-2">Table</th>
                    <th className="text-right px-4 py-2">Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={`${r.schema}.${r.table}`} className="border-t border-slate-100">
                      <td className="px-4 py-2"><Badge variant="outline">{r.schema}</Badge></td>
                      <td className="px-4 py-2 font-mono text-xs">{r.table}</td>
                      <td className="px-4 py-2 text-right">{r.columns}</td>
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
