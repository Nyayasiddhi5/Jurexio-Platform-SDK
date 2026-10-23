/**
 * Identity Extraction — user extraction history (2026-05-28).
 * Backend: GET /api/jrx/identity/extractions
 */
import { useQuery } from '@tanstack/react-query';
import { IdCard, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';

type Extraction = {
  id: number;
  documentType?: string;
  status?: string;
  confidence?: number;
  createdAt?: string;
  created_at?: string;
  extractedFields?: Record<string, unknown>;
};

async function jget<T>(url: string): Promise<T> {
  const t = getAuthToken();
  const r = await fetch(url, { credentials: 'include', headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function IdentityExtraction() {
  const q = useQuery({
    queryKey: ['identity-extractions'],
    queryFn: () => jget<{ data: Extraction[] }>(p('IDENTITY_EXTRACTIONS')),
  });

  const rows = q.data?.data ?? [];

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-identity-extraction">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <IdCard className="w-6 h-6" /> Identity Extraction
          </h1>
          <p className="text-sm text-slate-600 mt-1">Government-ID field extraction with PII-safe review workflow.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent extractions</CardTitle></CardHeader>
        <CardContent className="p-0">
          {q.isLoading && <div className="p-4"><Skeleton className="h-32" /></div>}
          {!q.isLoading && rows.length === 0 && (
            <p className="p-4 text-sm text-slate-600">No extractions yet. POST /api/jrx/identity/extract with documentId + documentType.</p>
          )}
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">ID</th>
                  <th className="text-left px-4 py-2">Document type</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Confidence</th>
                  <th className="text-left px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{r.id}</td>
                    <td className="px-4 py-2">{r.documentType ?? '—'}</td>
                    <td className="px-4 py-2"><Badge variant="outline">{r.status ?? 'pending'}</Badge></td>
                    <td className="px-4 py-2">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                    <td className="px-4 py-2 text-xs">{new Date(r.createdAt ?? r.created_at ?? '').toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
