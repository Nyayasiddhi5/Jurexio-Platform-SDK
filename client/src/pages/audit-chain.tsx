/**
 * Audit Chain UI — Demo G1A (task-297, 2026-05-13).
 *
 * Reads the local pg-hashchain ledger via GET /api/jrx/audit/chain. Adds:
 *   - URL-persisted ?jurisdiction=US|IN|EU|UK|GC|SG|ALL filter.
 *   - Click-through detail drawer showing full request context, model/provider,
 *     latency, token counts, and chain-link verification status (computed
 *     server-side via /api/jrx/audit/chain/:id).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { CheckCircle2, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { nv } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';

// task-344 (2026-05-13): cryptographic-verification panel folded in as a tab.
// Legacy /hash-chain and /hash-chain-audit routes redirect to /audit-chain?tab=hash-chain.
const HashChainAuditPanel = lazy(() => import('./hash-chain-audit'));

const VALID_TABS = ['records', 'hash-chain'] as const;
type AuditTab = (typeof VALID_TABS)[number];

function readTabFromUrl(): AuditTab {
  if (typeof window === 'undefined') return 'records';
  const t = (new URL(window.location.href).searchParams.get('tab') ?? 'records') as AuditTab;
  return (VALID_TABS as readonly string[]).includes(t) ? t : 'records';
}

type ChainRecord = {
  id: string | number;
  orgId?: string | null;
  sdkKey?: string | null;
  agentId?: string | null;
  jurisdiction?: string | null;
  pattern?: string | null;
  eventType?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  model?: string | null;
  provider?: string | null;
  latencyMs?: number | null;
  tokensUsed?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  riskScore?: number | null;
  riskBadge?: string | null;
  blocked?: boolean | null;
  traceId?: string | null;
  requestId?: string | null;
  inputHash?: string | null;
  outputHash?: string | null;
  previousHash?: string | null;
  recordHash?: string | null;
  metadata?: any;
  createdAt?: string;
};

type ChainResp = {
  success?: boolean;
  data?: { records?: ChainRecord[]; total?: number; limit?: number; offset?: number; scope?: any; provider?: string };
};

type DetailResp = {
  success?: boolean;
  data?: { record?: ChainRecord; verified?: boolean; expectedHash?: string };
};

const JURISDICTIONS = ['ALL', 'US', 'IN', 'EU', 'UK', 'GC', 'SG'] as const;

function shortHash(h?: string | null): string {
  if (!h) return '—';
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-6)}` : h;
}

function readJurisdictionFromUrl(): string {
  if (typeof window === 'undefined') return 'ALL';
  const u = new URL(window.location.href);
  const j = (u.searchParams.get('jurisdiction') ?? 'ALL').toUpperCase();
  return (JURISDICTIONS as readonly string[]).includes(j) ? j : 'ALL';
}

export default function AuditChainPage() {
  const [jurisdiction, setJurisdiction] = useState<string>(readJurisdictionFromUrl);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [tab, setTab] = useState<AuditTab>(readTabFromUrl);

  // Persist jurisdiction + tab in the URL so the screenshot links in the demo
  // (?jurisdiction=US, ?jurisdiction=IN, ?tab=hash-chain) are reproducible.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (jurisdiction === 'ALL') u.searchParams.delete('jurisdiction');
    else u.searchParams.set('jurisdiction', jurisdiction);
    if (tab === 'records') u.searchParams.delete('tab');
    else u.searchParams.set('tab', tab);
    window.history.replaceState(null, '', u.toString());
  }, [jurisdiction, tab]);

  const q = useQuery<ChainResp>({
    queryKey: ['audit-chain', jurisdiction],
    queryFn: async () => {
      const token = getAuthToken();
      const qs = new URLSearchParams({ limit: '200' });
      if (jurisdiction !== 'ALL') qs.set('jurisdiction', jurisdiction);
      const r = await fetch(nv(`audit/chain?${qs.toString()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`audit/chain ${r.status} ${r.statusText}`);
      return r.json();
    },
    refetchInterval: 30000,
  });

  const detailQ = useQuery<DetailResp>({
    queryKey: ['audit-chain-detail', selectedId],
    enabled: selectedId !== null,
    queryFn: async () => {
      const token = getAuthToken();
      const r = await fetch(nv(`audit/chain/${encodeURIComponent(String(selectedId))}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`audit/chain detail ${r.status} ${r.statusText}`);
      return r.json();
    },
  });

  const records = q.data?.data?.records ?? [];
  const total = q.data?.data?.total ?? 0;

  // Lightweight client-side chain-link sanity check: each row's previousHash
  // should match the recordHash of the immediately-newer row (rows are
  // returned newest-first).
  const broken: Array<string | number> = [];
  for (let i = records.length - 1; i > 0; i--) {
    const newer = records[i - 1];
    const older = records[i];
    if (newer.previousHash && older.recordHash && newer.previousHash !== older.recordHash) {
      broken.push(newer.id);
    }
  }
  const intact = records.length > 0 && broken.length === 0;
  const detail = detailQ.data?.data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-audit-chain">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            Audit Chain
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hash-chained audit log from <code className="font-mono text-xs">nv_pattern_audit_log</code>{' '}
            (local pg-hashchain provider). Each record's
            <code className="font-mono text-xs">previousHash</code> is verified against the prior record's
            <code className="font-mono text-xs">recordHash</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'records' && (
            <>
              <Select value={jurisdiction} onValueChange={setJurisdiction}>
                <SelectTrigger className="w-32 h-9 text-xs" data-testid="select-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JURISDICTIONS.map((j) => (
                    <SelectItem key={j} value={j} className="text-xs">{j === 'ALL' ? 'All jurisdictions' : j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-refresh-audit-chain">
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AuditTab)} className="space-y-4">
        <TabsList data-testid="audit-chain-tabs">
          <TabsTrigger value="records" data-testid="tab-records">Recent Records</TabsTrigger>
          <TabsTrigger value="hash-chain" data-testid="tab-hash-chain">Hash-Chain Verification</TabsTrigger>
        </TabsList>

        <TabsContent value="hash-chain" className="space-y-4">
          <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-1/3 mb-4" /><Skeleton className="h-64 w-full" /></div>}>
            <HashChainAuditPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="records" className="space-y-4">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-audit-total">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total records ({jurisdiction})</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{total.toLocaleString()}</p></CardContent>
        </Card>
        <Card data-testid="card-audit-shown">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Loaded (latest)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{records.length.toLocaleString()}</p></CardContent>
        </Card>
        <Card data-testid="card-audit-integrity">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Chain integrity</CardTitle></CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : intact ? (
              <p className="text-2xl font-bold text-emerald-600 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Intact</p>
            ) : (
              <p className="text-2xl font-bold text-red-600">{broken.length} break{broken.length === 1 ? '' : 's'}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {q.isError && (
        <JrxErrorState
          title="Could not load audit chain"
          error={q.error}
          onRetry={() => q.refetch()}
          variant="card"
        />
      )}

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent records</CardTitle>
          <Badge variant="outline">/api/jrx/audit/chain {jurisdiction !== 'ALL' && `· ${jurisdiction}`}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="p-2">Time</th>
                  <th className="p-2">Jur.</th>
                  <th className="p-2">Agent / SDK</th>
                  <th className="p-2">Route</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">prev → hash</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`}><td colSpan={6} className="p-2"><Skeleton className="h-6 w-full" /></td></tr>
                  ))
                ) : records.length === 0 ? (
                  <tr><td colSpan={6} className="p-0"><JrxEmptyState title="No audit records yet" description="Make some authenticated calls (or run scripts/jrx-seed-audit-chain-demo.ts) to populate the hash-chain audit log." size="sm" /></td></tr>
                ) : records.map((r) => (
                  <tr
                    key={String(r.id)}
                    className={`border-b hover:bg-muted/30 cursor-pointer ${broken.includes(r.id) ? 'bg-red-50 ' : ''}`}
                    data-testid={`row-audit-${r.id}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                    <td className="p-2 text-xs"><Badge variant="outline" className="text-[10px]">{r.jurisdiction || '—'}</Badge></td>
                    <td className="p-2 text-xs">
                      <div className="font-medium">{r.agentId || '—'}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.sdkKey || '—'}</div>
                    </td>
                    <td className="p-2 font-mono text-xs truncate max-w-xs" title={`${r.method ?? ''} ${r.route ?? ''}`}>{r.method ? `${r.method} ` : ''}{r.route || '—'}</td>
                    <td className="p-2 text-right">{r.statusCode ?? '—'}{r.blocked ? <span className="ml-1 text-red-600 text-[10px]">BLK</span> : null}</td>
                    <td className="p-2 font-mono text-xs">
                      <span className="text-muted-foreground">{shortHash(r.previousHash)}</span>
                      <span className="mx-1">→</span>
                      <span>{shortHash(r.recordHash)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

        </TabsContent>
      </Tabs>

      {/* Detail drawer */}
      <Sheet open={selectedId !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="drawer-audit-detail">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {detail?.verified ? (
                <span className="flex items-center gap-2 text-emerald-600 text-sm"><CheckCircle2 className="w-4 h-4" /> Hash verified</span>
              ) : detailQ.isLoading ? (
                <span className="text-sm text-muted-foreground">Loading…</span>
              ) : (
                <span className="flex items-center gap-2 text-red-600 text-sm"><ShieldAlert className="w-4 h-4" /> Hash mismatch</span>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Audit record <code className="font-mono">{String(selectedId ?? '')}</code>
            </SheetDescription>
          </SheetHeader>

          {detailQ.isLoading ? (
            <div className="space-y-2 mt-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detail?.record ? (
            <div className="space-y-4 mt-4 text-sm">
              <DetailRow k="Time"          v={detail.record.createdAt ? new Date(detail.record.createdAt).toLocaleString() : '—'} />
              <DetailRow k="Jurisdiction"  v={detail.record.jurisdiction || '—'} />
              <DetailRow k="Org"           v={detail.record.orgId || '—'} />
              <DetailRow k="Agent"         v={detail.record.agentId || '—'} />
              <DetailRow k="SDK key"       v={detail.record.sdkKey || '—'} mono />
              <DetailRow k="Route"         v={`${detail.record.method ?? ''} ${detail.record.route ?? ''}`.trim() || '—'} mono />
              <DetailRow k="Status"        v={`${detail.record.statusCode ?? '—'}${detail.record.blocked ? '  (blocked)' : ''}`} />
              <DetailRow k="Model"         v={detail.record.model || '—'} mono />
              <DetailRow k="Provider"      v={detail.record.provider || '—'} />
              <DetailRow k="Latency"       v={detail.record.latencyMs != null ? `${detail.record.latencyMs} ms` : '—'} />
              <DetailRow k="Tokens"        v={`${detail.record.tokensUsed ?? 0} (in ${detail.record.tokensIn ?? 0} / out ${detail.record.tokensOut ?? 0})`} />
              <DetailRow k="Risk"          v={`${detail.record.riskBadge ?? '—'} (${(detail.record.riskScore ?? 0).toFixed(2)})`} />
              <DetailRow k="Trace ID"      v={detail.record.traceId || '—'} mono />
              <DetailRow k="Request ID"    v={detail.record.requestId || '—'} mono />
              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground mb-1">Hash chain</div>
                <div className="font-mono text-xs break-all">
                  prev: {detail.record.previousHash || '—'}
                </div>
                <div className="font-mono text-xs break-all">
                  rec:  {detail.record.recordHash || '—'}
                </div>
                <div className={`font-mono text-xs break-all ${detail.verified ? 'text-emerald-700' : 'text-red-700'}`}>
                  exp:  {detail.expectedHash || '—'}
                </div>
              </div>
              {detail.record.metadata ? (
                <div className="pt-2 border-t">
                  <div className="text-xs text-muted-foreground mb-1">Metadata</div>
                  <pre className="font-mono text-[10px] bg-muted/50 rounded p-2 overflow-x-auto">{JSON.stringify(detail.record.metadata, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 text-sm text-muted-foreground">Record not found.</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 items-baseline">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className={`col-span-2 ${mono ? 'font-mono text-xs break-all' : 'text-sm'}`}>{v}</div>
    </div>
  );
}
