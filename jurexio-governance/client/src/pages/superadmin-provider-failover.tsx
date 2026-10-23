/**
 * Jurexio Super Admin — Provider Failover Dashboard (Gap #6)
 *
 * Session-15 v11/v11.1 (2026-05-11). Closes Gap #6 from
 * `docs/audit/feature-matrix-and-status-2026-05-11.md` §2 — backend data
 * already at `/api/jrx/observability/router-stats` (mounted in
 * `src/index.ts:763`), only a dedicated provider-failover UI was missing.
 *
 * v11.1 (architect catch): rewritten to match the ACTUAL backend contracts
 * exported by `src/services/intelligent-router/{router-stats,health-tracker}.ts`:
 *   - Aggregates:    { totalCalls, successRate, byModel, byTier, byTask,
 *                      byAgent, byJurisdiction, fallbackLevelDistribution }
 *   - DecisionRecord:{ ts:number, agentId, tier, jurisdiction, taskKind,
 *                      requestId, primaryModelId, pickedModelId,
 *                      pickedProvider, fallbackLevel:number, ok:boolean,
 *                      latencyMs, costUsd, tokensIn, tokensOut, errorMessage }
 *   - HealthSnapshot:{ modelId, ok, fail, failureRate, p50, p95,
 *                      healthScore, lastFailureAt, lastSuccessAt }
 *
 * Failover detection = `fallbackLevel > 0` on a decision (the canonical
 * router invariant: 0 = primary pick succeeded, ≥1 = N escalations along
 * the fallback chain). Errors = `ok === false`. Health = `failureRate` and
 * `healthScore` (model→provider via catalog lookup; the health snapshot
 * itself doesn't carry provider).
 *
 * Distinct from existing pages:
 *   - cost-optimizer.tsx       — token-cost ROI per provider.
 *   - superadmin-llm-budget.tsx — monthly $ caps and alerts.
 *   - lrm-router-dashboard.tsx — LRM jurisdiction routing.
 *   - **THIS PAGE**            — PROVIDER AVAILABILITY + FAILOVER EVENTS.
 *
 * Architecture compliance:
 *   - NV-ARCH-001: read-only — never calls /api/jrx/orchestrate.
 *   - NV-AUTH-HEADER-001: JWT via shared apiRequest from @/lib/queryClient.
 *   - NV-WIRING-001: lazy-imported + routed in client/src/App.tsx under
 *     /superadmin/provider-failover with minRole="super_admin".
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { JrxErrorState } from '@/components/JrxErrorState';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, AlertTriangle, CheckCircle2, GitBranch, RefreshCw,
  Server, Shield, TrendingDown, XCircle, Zap,
} from 'lucide-react';

import { nv } from '@/lib/jrx-api-paths';
// ─── Types — match backend exactly ──────────────────────────────────────────

interface Aggregates {
  totalCalls?: number;
  successRate?: number;
  byModel?: Record<string, number>;
  byTier?: Record<string, number>;
  byTask?: Record<string, number>;
  byAgent?: Record<string, number>;
  byJurisdiction?: Record<string, number>;
  fallbackLevelDistribution?: Record<string, number>;
}

interface HealthRow {
  modelId: string;
  ok: number;
  fail: number;
  failureRate: number;
  p50: number;
  p95: number;
  healthScore: number;
  lastFailureAt: number;
  lastSuccessAt: number;
}

interface RouterStatsRoot {
  ok: boolean;
  aggregates?: Aggregates;
  health?: HealthRow[];
  catalogSize?: number;
  providersAvailable?: Record<string, boolean>;
}

interface DecisionRecord {
  ts: number;
  agentId?: string;
  tier?: string;
  jurisdiction?: string;
  taskKind?: string;
  requestId?: string;
  primaryModelId: string;
  pickedModelId: string;
  pickedProvider?: string;
  fallbackLevel: number;
  ok: boolean;
  latencyMs: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  errorMessage?: string;
}

interface RecentResponse {
  ok: boolean;
  decisions: DecisionRecord[];
}

interface CatalogModel {
  id: string;
  provider: string;
  displayName?: string;
  legalQuality?: number;
  speedScore?: number;
  preferredFor?: string[];
  jurisdictionFit?: string[];
  providerAvailable: boolean;
  isFree?: boolean;
  isLatest?: boolean;
}

interface CatalogResponse {
  ok: boolean;
  models: CatalogModel[];
}

async function fetchJson<T>(url: string): Promise<T> {
  return (await apiRequest(url, 'GET')) as T;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  together: 'Together AI',
  cohere: 'Cohere',
  sarvam: 'Sarvam (Indic)',
  bedrock: 'AWS Bedrock',
  vertex: 'GCP Vertex',
  agentzero: 'AgentZero',
};

function formatTs(ts: number | undefined): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return '—';
  }
}

export default function SuperAdminProviderFailover() {
  const statsQ = useQuery<RouterStatsRoot>({
    queryKey: [nv('observability/router-stats')],
    queryFn: () => fetchJson<RouterStatsRoot>(nv('observability/router-stats')),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const recentQ = useQuery<RecentResponse>({
    queryKey: [nv('observability/router-stats/recent'), { limit: 100 }],
    queryFn: () => fetchJson<RecentResponse>(nv('observability/router-stats/recent?limit=100')),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const catalogQ = useQuery<CatalogResponse>({
    queryKey: [nv('observability/router-stats/catalog')],
    queryFn: () => fetchJson<CatalogResponse>(nv('observability/router-stats/catalog')),
    staleTime: 5 * 60_000,
  });

  const stats = statsQ.data;
  const decisions = recentQ.data?.decisions ?? [];
  const catalog = catalogQ.data?.models ?? [];

  // model → provider lookup (HealthSnapshot does not carry provider)
  const modelToProvider = useMemo(() => {
    const m = new Map<string, string>();
    catalog.forEach((c) => m.set(c.id, c.provider));
    return m;
  }, [catalog]);

  const providers = useMemo(() => {
    const map = stats?.providersAvailable ?? {};
    return Object.keys(PROVIDER_LABEL)
      .map((id) => ({ id, label: PROVIDER_LABEL[id], available: !!map[id] }))
      .sort((a, b) => Number(b.available) - Number(a.available) || a.label.localeCompare(b.label));
  }, [stats]);

  const totalProviders = providers.length;
  const availableProviders = providers.filter((p) => p.available).length;

  // Failover = fallbackLevel > 0 (canonical router invariant)
  const failoverDecisions = useMemo(
    () => decisions.filter((d) => (d.fallbackLevel ?? 0) > 0),
    [decisions],
  );
  const errorDecisions = useMemo(() => decisions.filter((d) => d.ok === false), [decisions]);

  const failoverByProvider = useMemo(() => {
    const m: Record<string, number> = {};
    failoverDecisions.forEach((d) => {
      const winner = d.pickedProvider ?? 'unknown';
      m[winner] = (m[winner] ?? 0) + 1;
    });
    return m;
  }, [failoverDecisions]);

  const failoverRatePct = decisions.length > 0
    ? (failoverDecisions.length / decisions.length) * 100
    : 0;
  const errorRatePct = decisions.length > 0
    ? (errorDecisions.length / decisions.length) * 100
    : 0;

  // Aggregate-level failover from fallbackLevelDistribution (lifetime, not just last 100)
  const aggFallbackLevels = stats?.aggregates?.fallbackLevelDistribution ?? {};
  const aggTotalCalls = stats?.aggregates?.totalCalls ?? 0;
  const aggFailoverCalls = Object.entries(aggFallbackLevels)
    .filter(([lvl]) => Number(lvl) > 0)
    .reduce((sum, [, n]) => sum + (Number(n) || 0), 0);
  const aggFailoverPct = aggTotalCalls > 0 ? (aggFailoverCalls / aggTotalCalls) * 100 : 0;
  const aggSuccessPct = (stats?.aggregates?.successRate ?? 0) * 100;

  const health = stats?.health ?? [];
  const unhealthyModels = useMemo(
    () => health.filter((h) => h.healthScore < 0.7 || h.failureRate > 0.2),
    [health],
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6" data-testid="page-provider-failover">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-[#152448]" />
            Provider Failover Dashboard
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Live LLM provider availability, model health, and recent failover events from the intelligent router.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            statsQ.refetch();
            recentQ.refetch();
            catalogQ.refetch();
          }}
          data-testid="button-refresh-failover"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${statsQ.isFetching || recentQ.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI tiles — lifetime aggregates from /router-stats.aggregates */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="grid-failover-kpis">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Providers Available</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-providers-available">
                  {statsQ.isLoading ? '…' : `${availableProviders}/${totalProviders}`}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">
                  {(stats?.catalogSize ?? 0)} models in catalog
                </p>
              </div>
              <Server className="w-8 h-8 text-[#152448]/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Total Calls</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-total-calls">
                  {aggTotalCalls.toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">last {decisions.length} in ring</p>
              </div>
              <Activity className="w-8 h-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Failover Rate</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    aggFailoverPct > 20 ? 'text-amber-600' : 'text-slate-900'
                  }`}
                  data-testid="kpi-failover-rate"
                >
                  {aggFailoverPct.toFixed(1)}%
                </p>
                <p className="text-[10px] text-slate-700 mt-1">
                  {aggFailoverCalls} of {aggTotalCalls} (lifetime)
                </p>
              </div>
              <GitBranch className="w-8 h-8 text-amber-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Success Rate</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    aggSuccessPct < 95 ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                  data-testid="kpi-success-rate"
                >
                  {aggSuccessPct.toFixed(2)}%
                </p>
                <p className="text-[10px] text-slate-700 mt-1">
                  errors in ring: {errorRatePct.toFixed(1)}%
                </p>
              </div>
              <TrendingDown className="w-8 h-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider availability matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Provider Availability ({availableProviders} of {totalProviders})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsQ.isError && (
            <div className="mb-3" data-testid="state-error-stats">
              <JrxErrorState
                title="Could not load router stats"
                error={statsQ.error}
                onRetry={() => statsQ.refetch()}
                variant="card"
                size="sm"
              />
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2" data-testid="grid-providers">
            {providers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 p-2 rounded border text-xs ${
                  p.available
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
                data-testid={`provider-${p.id}`}
              >
                {p.available ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-600 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.label}</p>
                  <p className="opacity-70">{p.id}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Lifetime fallback-level distribution from aggregates */}
          {Object.keys(aggFallbackLevels).length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100" data-testid="block-fallback-distribution">
              <p className="text-xs font-medium text-slate-700 mb-2">Lifetime fallback-level distribution</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                {Object.entries(aggFallbackLevels)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([lvl, n]) => (
                    <div
                      key={lvl}
                      className={`p-2 rounded border ${
                        Number(lvl) === 0
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                      data-testid={`fallback-level-${lvl}`}
                    >
                      <p className="font-medium">
                        Level {lvl} {Number(lvl) === 0 ? '(primary)' : `(fallback ${lvl})`}
                      </p>
                      <p className="font-mono">{n}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs: model health · recent failover · error events */}
      <Tabs defaultValue="health" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-2xl">
          <TabsTrigger value="health" data-testid="tab-health">
            Model Health ({health.length})
          </TabsTrigger>
          <TabsTrigger value="failover" data-testid="tab-failover">
            Failover Events ({failoverDecisions.length})
          </TabsTrigger>
          <TabsTrigger value="errors" data-testid="tab-errors">
            Error Events ({errorDecisions.length})
          </TabsTrigger>
        </TabsList>

        {/* Model health */}
        <TabsContent value="health" className="mt-4">
          <Card>
            <CardContent className="p-4">
              {statsQ.isLoading && (
                <div className="space-y-2 py-2" data-testid="state-loading-health">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              )}
              {health.length === 0 && !statsQ.isLoading && (
                <div data-testid="state-empty-health">
                  <JrxEmptyState
                    title="No model health data yet"
                    description="The router has not been exercised this process lifetime."
                    size="sm"
                  />
                </div>
              )}
              <div className="space-y-2" data-testid="list-model-health">
                {health.map((h) => {
                  const provider = modelToProvider.get(h.modelId) ?? 'unknown';
                  const healthy = h.healthScore >= 0.7 && h.failureRate <= 0.2;
                  return (
                    <div
                      key={h.modelId}
                      className="flex items-center gap-3 p-2 rounded border border-slate-200 bg-white text-xs"
                      data-testid={`health-row-${h.modelId}`}
                    >
                      {healthy ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{h.modelId}</p>
                        <p className="text-slate-700">{PROVIDER_LABEL[provider] ?? provider}</p>
                      </div>
                      <div className="w-32 flex-shrink-0">
                        <div className="flex justify-between text-[10px] text-slate-700 mb-0.5">
                          <span>Health</span>
                          <span>{(h.healthScore * 100).toFixed(0)}%</span>
                        </div>
                        <Progress value={h.healthScore * 100} className="h-1.5" />
                      </div>
                      <div className="w-24 text-right flex-shrink-0 font-mono text-[10px] text-slate-600">
                        <p>p50: {h.p50.toFixed(0)}ms</p>
                        <p>p95: {h.p95.toFixed(0)}ms</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          h.failureRate > 0.2
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }
                      >
                        {(h.failureRate * 100).toFixed(1)}% fail · {h.ok}/{h.ok + h.fail}
                      </Badge>
                    </div>
                  );
                })}
              </div>
              {unhealthyModels.length > 0 && (
                <p
                  className="text-xs text-amber-700 mt-3 flex items-center gap-2"
                  data-testid="warn-unhealthy-models"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {unhealthyModels.length} model{unhealthyModels.length > 1 ? 's' : ''} currently degraded
                  (healthScore &lt; 0.7 or failureRate &gt; 20%).
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Failover events */}
        <TabsContent value="failover" className="mt-4">
          <Card>
            <CardContent className="p-4">
              {failoverDecisions.length === 0 && (
                <p className="text-sm text-slate-700 py-8 text-center" data-testid="state-empty-failover">
                  No failover events in the last {decisions.length} decisions. All requests landed on first-choice model.
                </p>
              )}
              <div className="space-y-2" data-testid="list-failover">
                {failoverDecisions.slice(0, 50).map((d, i) => (
                  <div
                    key={`${d.ts}-${i}`}
                    className="p-2 rounded border border-amber-200 bg-amber-50/50 text-xs"
                    data-testid={`failover-row-${i}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Zap className="w-3 h-3 text-amber-600 flex-shrink-0" />
                        <span className="font-mono text-slate-700">{formatTs(d.ts)}</span>
                        <span className="font-medium text-slate-900 truncate">
                          {d.agentId ?? 'generic'} → {d.pickedProvider ?? '?'}/{d.pickedModelId}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                          fallback L{d.fallbackLevel}
                        </Badge>
                        <span className="font-mono text-slate-600">{d.latencyMs}ms</span>
                      </div>
                    </div>
                    {d.primaryModelId && d.primaryModelId !== d.pickedModelId && (
                      <p className="text-[10px] text-slate-600 mt-1 ml-5">
                        primary: <span className="font-mono">{d.primaryModelId}</span>
                        {' → picked: '}
                        <span className="font-mono text-emerald-700 font-medium">{d.pickedModelId}</span>
                        {d.tier && <> · tier: {d.tier}</>}
                        {d.jurisdiction && <> · jx: {d.jurisdiction}</>}
                      </p>
                    )}
                    {d.errorMessage && (
                      <p className="text-[10px] text-amber-700 mt-1 ml-5 truncate" title={d.errorMessage}>
                        {d.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {Object.keys(failoverByProvider).length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100" data-testid="block-failover-by-provider">
                  <p className="text-xs font-medium text-slate-700 mb-2">Failover winner by provider (last 100)</p>
                  <div className="space-y-1">
                    {Object.entries(failoverByProvider)
                      .sort(([, a], [, b]) => b - a)
                      .map(([prov, n]) => (
                        <div key={prov} className="flex justify-between text-xs">
                          <span className="text-slate-600">{PROVIDER_LABEL[prov] ?? prov}</span>
                          <span className="font-mono text-slate-900">{n}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Error events */}
        <TabsContent value="errors" className="mt-4">
          <Card>
            <CardContent className="p-4">
              {errorDecisions.length === 0 && (
                <p className="text-sm text-emerald-700 py-8 text-center" data-testid="state-empty-errors">
                  No error events in the last {decisions.length} decisions.
                </p>
              )}
              <div className="space-y-2" data-testid="list-errors">
                {errorDecisions.slice(0, 50).map((d, i) => (
                  <div
                    key={`${d.ts}-${i}`}
                    className="p-2 rounded border border-red-200 bg-red-50/50 text-xs"
                    data-testid={`error-row-${i}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <XCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
                        <span className="font-mono text-slate-700">{formatTs(d.ts)}</span>
                        <span className="font-medium text-slate-900 truncate">
                          {d.agentId ?? 'generic'} · {d.pickedProvider ?? '?'}/{d.pickedModelId}
                        </span>
                      </div>
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px]">
                        L{d.fallbackLevel} · {d.latencyMs}ms
                      </Badge>
                    </div>
                    {d.errorMessage && (
                      <p className="text-[10px] text-red-700 mt-1 ml-5 truncate" title={d.errorMessage}>
                        {d.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Catalog footer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            Model Catalog ({catalog.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-700 mb-3">
            Models registered in the intelligent router catalog. Greyed-out rows indicate the underlying provider is currently unavailable
            and the router will skip these candidates during selection.
          </p>
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto"
            data-testid="grid-catalog"
          >
            {catalog.map((m) => (
              <div
                key={m.id}
                className={`p-2 rounded border text-xs ${
                  m.providerAvailable
                    ? 'bg-white border-slate-200'
                    : 'bg-slate-50 border-slate-200 opacity-60'
                }`}
                data-testid={`catalog-${m.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-900 truncate">{m.displayName ?? m.id}</p>
                  {m.isLatest && (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                      latest
                    </Badge>
                  )}
                </div>
                <p className="text-slate-700 mt-0.5">{PROVIDER_LABEL[m.provider] ?? m.provider}</p>
                {(m.legalQuality !== undefined || m.speedScore !== undefined) && (
                  <div className="flex gap-3 mt-1 text-[10px] text-slate-600">
                    {m.legalQuality !== undefined && <span>legal: {m.legalQuality}</span>}
                    {m.speedScore !== undefined && <span>speed: {m.speedScore}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
