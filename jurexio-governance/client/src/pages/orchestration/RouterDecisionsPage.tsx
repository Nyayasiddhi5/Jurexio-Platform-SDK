import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Activity, RefreshCw, ServerCrash, Filter, Gauge, Hash, Network,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { Link } from 'wouter';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

/**
 * RouterDecisionsPage (T-DLR-12)
 *
 * Per-request drilldown over the persistent router decision-log
 * (`nv_schema.nv_router_decisions`, exposed via
 *  GET /api/jrx/observability/router-stats/persistent — admin only).
 *
 * Each row links to the audit-chain lineage page we shipped in Lane B
 * (T-DLR-04: GET /api/jrx/orchestration/lineage/:requestId), closing the
 * loop on "router → response → IronLedger" observability.
 */

interface AggregateRow {
  picked_provider: string;
  picked_model_id: string;
  total: number;
  successes: number;
  failures: number;
  avg_latency_ms: string | number | null;
  total_cost_usd: string | number | null;
  total_tokens_in: string | number | null;
  total_tokens_out: string | number | null;
}

interface RecentRow {
  id: number | string;
  ts: string;
  request_id: string | null;
  agent_id: string | null;
  tier: string | null;
  jurisdiction: string | null;
  task_kind: string | null;
  primary_model_id: string | null;
  picked_model_id: string | null;
  picked_provider: string | null;
  fallback_level: number | null;
  ok: boolean;
  latency_ms: number | null;
  cost_usd: number | string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error_message: string | null;
}

interface PersistentResponse {
  ok: boolean;
  filter?: Record<string, unknown>;
  aggregatesByModel?: AggregateRow[];
  recent?: RecentRow[];
  totalReturned?: number;
  error?: string;
}

const REFRESH_MS = 30_000;
const PROVIDERS = [
  'all', 'anthropic', 'openai', 'google', 'openrouter', 'groq',
  'mistral', 'deepseek', 'sarvam', 'bedrock', 'vertex', 'agentzero',
];

function fmtNum(n: number | string | null | undefined, digits = 0): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '—';
  return digits === 0 ? Math.round(v).toLocaleString() : v.toFixed(digits);
}

function fmtCost(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '$0.00';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return '$0.00';
  return `$${v < 0.01 ? v.toFixed(6) : v.toFixed(4)}`;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function RouterDecisionsPage() {
  const [provider, setProvider] = useState<string>('all');
  const [okFilter, setOkFilter] = useState<string>('all');
  const [model, setModel] = useState<string>('');
  const [sinceMin, setSinceMin] = useState<string>('60');
  const [limit, setLimit] = useState<string>('100');

  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (provider !== 'all') params.set('provider', provider);
    if (model) params.set('model', model);
    if (okFilter !== 'all') params.set('ok', okFilter);
    if (sinceMin && Number(sinceMin) > 0) {
      const since = new Date(Date.now() - Number(sinceMin) * 60_000).toISOString();
      params.set('since', since);
    }
    params.set('limit', limit || '100');
    const qs = params.toString();
    // Task #176 (B2): canonical path is /api/jrx/orchestration/router-decisions
    // (registry key ROUTER_DECISIONS). The aggregator response is a superset of
    // /observability/router-stats/persistent (recent + aggregatesByModel).
    return [`${p('ROUTER_DECISIONS')}${qs ? '?' + qs : ''}`];
  }, [provider, model, okFilter, sinceMin, limit]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PersistentResponse>({
    queryKey,
    queryFn: () => nvFetchJson<PersistentResponse>(queryKey[0] as string),
    refetchInterval: REFRESH_MS,
    staleTime: 5_000,
  });

  const rows = data?.recent ?? [];
  const aggregates = data?.aggregatesByModel ?? [];
  const totalCalls = aggregates.reduce((s, a) => s + (a.total ?? 0), 0);
  const totalFailures = aggregates.reduce((s, a) => s + (a.failures ?? 0), 0);
  const successRate = totalCalls > 0 ? ((totalCalls - totalFailures) / totalCalls) * 100 : null;
  const avgLatency = useMemo(() => {
    if (!aggregates.length) return null;
    const num = aggregates.reduce(
      (s, a) => s + Number(a.avg_latency_ms ?? 0) * (a.total ?? 0), 0,
    );
    const den = aggregates.reduce((s, a) => s + (a.total ?? 0), 0);
    return den > 0 ? num / den : null;
  }, [aggregates]);
  const totalCost = aggregates.reduce((s, a) => s + Number(a.total_cost_usd ?? 0), 0);

  return (
    <div
      className="min-h-screen p-8"
     
    >
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
              Router Decisions — Drilldown
            </h1>
            <p className="text-sm mt-1">
              Per-request audit log from <code>nv_router_decisions</code> · Each row links to its IronLedger lineage chain.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={isError ? 'destructive' : 'secondary'}
              className="text-xs"
              style={{
                background: isError ? '#7F1D1D' : 'rgba(212,160,23,0.15)',
                color: isError ? '#FECACA' : '#C7B15B',
                border: '1px solid rgba(212,160,23,0.3)',
              }}
            >
              {isError ? 'Endpoint unavailable' : isFetching ? 'Refreshing…' : 'Live'}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => refetch()} className="text-slate-900 hover:text-[#C7B15B]">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard icon={Network} label="Total decisions" value={fmtNum(totalCalls)} accent="#C7B15B" />
          <KpiCard
            icon={Gauge}
            label="Success rate"
            value={successRate === null ? '—' : `${successRate.toFixed(1)}%`}
            sub={successRate !== null && successRate < 95 ? 'below SLO' : undefined}
            accent={successRate !== null && successRate < 95 ? '#F87171' : '#34D399'}
          />
          <KpiCard
            icon={Activity}
            label="Avg latency"
            value={avgLatency === null ? '—' : `${fmtNum(avgLatency, 0)} ms`}
            accent="#C7B15B"
          />
          <KpiCard icon={Hash} label="Total cost" value={fmtCost(totalCost)} accent="#C7B15B" />
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm tracking-wide flex items-center gap-2 text-slate-900">
              <Filter className="h-4 w-4" /> Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-600">Provider</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="bg-white text-slate-900 border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-600">Model substring</label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-3-5"
                className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-600"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-600">Outcome</label>
              <Select value={okFilter} onValueChange={setOkFilter}>
                <SelectTrigger className="bg-white text-slate-900 border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="true">success</SelectItem>
                  <SelectItem value="false">failure</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-600">Window (min)</label>
              <Input
                value={sinceMin}
                onChange={(e) => setSinceMin(e.target.value)}
                placeholder="60"
                className="bg-white text-slate-900 border-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-600">Row limit</label>
              <Input
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="100"
                className="bg-white text-slate-900 border-slate-200"
              />
            </div>
          </CardContent>
        </Card>

        {/* Aggregates by model */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm tracking-wide text-slate-900">By model</CardTitle>
          </CardHeader>
          <CardContent>
            {aggregates.length === 0 ? (
              <EmptyState isLoading={isLoading} isError={isError} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200">
                    <TableHead className="text-slate-600">Provider</TableHead>
                    <TableHead className="text-slate-600">Model</TableHead>
                    <TableHead className="text-slate-600 text-right">Total</TableHead>
                    <TableHead className="text-slate-600 text-right">OK</TableHead>
                    <TableHead className="text-slate-600 text-right">Fail</TableHead>
                    <TableHead className="text-slate-600 text-right">Avg ms</TableHead>
                    <TableHead className="text-slate-600 text-right">Cost</TableHead>
                    <TableHead className="text-slate-600 text-right">Tokens in/out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregates.map((a, idx) => (
                    <TableRow key={`${a.picked_provider}/${a.picked_model_id}/${idx}`} className="border-slate-200">
                      <TableCell className="text-slate-700">{a.picked_provider ?? '—'}</TableCell>
                      <TableCell className="text-slate-700 font-mono text-xs">{a.picked_model_id ?? '—'}</TableCell>
                      <TableCell className="text-slate-700 text-right">{fmtNum(a.total)}</TableCell>
                      <TableCell className="text-emerald-300 text-right">{fmtNum(a.successes)}</TableCell>
                      <TableCell className="text-rose-300 text-right">{fmtNum(a.failures)}</TableCell>
                      <TableCell className="text-slate-700 text-right">{fmtNum(a.avg_latency_ms, 0)}</TableCell>
                      <TableCell className="text-slate-700 text-right">{fmtCost(a.total_cost_usd)}</TableCell>
                      <TableCell className="text-slate-600 text-right text-xs">
                        {fmtNum(a.total_tokens_in)} / {fmtNum(a.total_tokens_out)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent rows */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm tracking-wide text-slate-900 flex items-center justify-between">
              <span>Recent decisions</span>
              <span className="text-xs text-slate-700 font-normal">
                {rows.length > 0 ? `${rows.length} rows` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState isLoading={isLoading} isError={isError} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200">
                      <TableHead className="text-slate-600">When</TableHead>
                      <TableHead className="text-slate-600">Request</TableHead>
                      <TableHead className="text-slate-600">Agent</TableHead>
                      <TableHead className="text-slate-600">Tier</TableHead>
                      <TableHead className="text-slate-600">Jurisdiction</TableHead>
                      <TableHead className="text-slate-600">Picked model</TableHead>
                      <TableHead className="text-slate-600 text-right">Latency</TableHead>
                      <TableHead className="text-slate-600 text-right">Cost</TableHead>
                      <TableHead className="text-slate-600">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={String(r.id)} className="border-slate-200">
                        <TableCell className="text-slate-700 text-xs whitespace-nowrap">{relTime(r.ts)}</TableCell>
                        <TableCell className="text-xs">
                          {r.request_id ? (
                            <Link
                              href={`/orchestration/lineage/${encodeURIComponent(r.request_id)}`}
                              className="font-mono text-[#C7B15B] hover:underline"
                              title="Open IronLedger lineage chain for this request"
                            >
                              {r.request_id.slice(0, 8)}…
                            </Link>
                          ) : (
                            <span className="font-mono text-slate-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-700 text-xs">{r.agent_id ?? '—'}</TableCell>
                        <TableCell className="text-slate-700 text-xs">{r.tier ?? '—'}</TableCell>
                        <TableCell className="text-slate-700 text-xs">{r.jurisdiction ?? '—'}</TableCell>
                        <TableCell className="text-slate-700 text-xs font-mono">
                          {r.picked_provider ? `${r.picked_provider}/${r.picked_model_id ?? '—'}` : '—'}
                          {r.fallback_level && r.fallback_level > 0 ? (
                            <Badge
                              className="ml-2 text-[10px]"
                              style={{
                                background: 'rgba(251,191,36,0.15)',
                                color: '#FBBF24',
                                border: '1px solid rgba(251,191,36,0.3)',
                              }}
                            >
                              fallback#{r.fallback_level}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-slate-700 text-xs text-right">{fmtNum(r.latency_ms)}ms</TableCell>
                        <TableCell className="text-slate-700 text-xs text-right">{fmtCost(r.cost_usd)}</TableCell>
                        <TableCell>
                          {r.ok ? (
                            <Badge
                              className="text-[10px]"
                              style={{
                                background: 'rgba(52,211,153,0.15)',
                                color: '#34D399',
                                border: '1px solid rgba(52,211,153,0.3)',
                              }}
                            >
                              OK
                            </Badge>
                          ) : (
                            <Badge
                              className="text-[10px]"
                              style={{
                                background: 'rgba(248,113,113,0.15)',
                                color: '#F87171',
                                border: '1px solid rgba(248,113,113,0.3)',
                              }}
                              title={r.error_message ?? undefined}
                            >
                              FAIL
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent = '#C7B15B',
}: { icon: any; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium tracking-wide uppercase text-slate-600">{label}</CardTitle>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>{value}</div>
        {sub && <div className="text-xs mt-1 text-slate-700">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ isLoading, isError }: { isLoading: boolean; isError: boolean }) {
  if (isError) {
    return (
      <JrxErrorState
        title="Router-stats endpoint unavailable"
        description="Admin-only — requires the nv_router_decisions table."
        variant="card"
        size="sm"
      />
    );
  }
  if (isLoading) {
    return (
      <div className="p-4 space-y-2" data-testid="loading-router-decisions">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }
  return (
    <JrxEmptyState title="No decisions in the selected window" size="sm" />
  );
}
