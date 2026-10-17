/**
 * Web Scraping Targets — allowlisted regulatory sources (2026-05-28).
 * Backend: GET /api/jrx/tools/scrape/allowlist + /rate-limiter
 */
import { useQuery } from '@tanstack/react-query';
import { Globe, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';

type Source = { host: string; jurisdiction: string; label: string; rateLimit?: number; tier?: string };

async function jget<T>(url: string): Promise<T> {
  const t = getAuthToken();
  const r = await fetch(url, { credentials: 'include', headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function WebScrapingTargets() {
  const allowQ = useQuery({
    queryKey: ['scrape-allowlist'],
    queryFn: () => jget<{ sources: Source[]; count: number }>(p('SCRAPE_ALLOWLIST')),
  });
  const rateQ = useQuery({
    queryKey: ['scrape-rate-limiter'],
    queryFn: () => jget<{ buckets: Record<string, unknown> }>(p('SCRAPE_RATE_LIMITER')),
  });

  const sources = allowQ.data?.sources ?? [];

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-web-scraping-targets">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Globe className="w-6 h-6" /> Web Scraping Targets
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {allowQ.data?.count ?? sources.length} allowlisted regulatory monitor sources.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { allowQ.refetch(); rateQ.refetch(); }} disabled={allowQ.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${allowQ.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Allowlisted sources</CardTitle></CardHeader>
        <CardContent className="p-0">
          {allowQ.isLoading && <div className="p-4"><Skeleton className="h-32" /></div>}
          {!allowQ.isLoading && (
            <table className="w-full text-sm" data-testid="table-scrape-sources">
              <thead className="bg-slate-50 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Host</th>
                  <th className="text-left px-4 py-2">Label</th>
                  <th className="text-left px-4 py-2">Jurisdiction</th>
                  <th className="text-right px-4 py-2">Rate limit</th>
                  <th className="text-left px-4 py-2">Tier</th>
                </tr>
              </thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.host} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{s.host}</td>
                    <td className="px-4 py-2">{s.label}</td>
                    <td className="px-4 py-2"><Badge variant="outline">{s.jurisdiction}</Badge></td>
                    <td className="px-4 py-2 text-right">{s.rateLimit ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{s.tier ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {rateQ.data && (
        <Card>
          <CardHeader><CardTitle className="text-base">Rate limiter buckets</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs bg-slate-100 p-3 rounded overflow-x-auto">{JSON.stringify(rateQ.data.buckets, null, 2)}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
