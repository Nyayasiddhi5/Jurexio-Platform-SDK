import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Super Admin — Federated Tenant View (Gap #2)
 *
 * Session-15 v10 (2026-05-11). Closes Gap #2 from
 * `docs/audit/feature-matrix-and-status-2026-05-11.md` §2 — backend was
 * already wired (`src/routes/jrx-tenant-management-routes.ts` mounted at
 * `/api/jrx/tenants`), but no Console page aggregated the data.
 *
 * Federation pattern (per F-002 verification audit appendix):
 *   - Operator authenticates as `super_admin` via JWT (no SDK key in
 *     browser).
 *   - Calls JWT-protected `/api/jrx/tenants` + `/api/jrx/admin/health/full`
 *     directly (these accept the operator's bearer JWT via the canonical
 *     auth header — NV-AUTH-HEADER-001).
 *   - For per-tenant deep-dive (`/usage`, `/model-access`), the same
 *     route family is used; aggregation happens client-side from the
 *     un-filtered list response.
 *
 * Architecture compliance:
 *   - NV-ARCH-001: page is read-only — never bypasses the safety ring,
 *     never calls `/api/jrx/orchestrate` or any LLM-emitting route.
 *   - NV-AUTH-HEADER-001: relies on `Authorization: Bearer <jwt>` only;
 *     no `X-API-Key` is sent from the browser.
 *   - NV-WIRING-001: lazily imported + routed in `client/src/App.tsx`
 *     under `/superadmin/federated-tenants` with `minRole="super_admin"`.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import {
  Building2, Globe, Activity, AlertTriangle, CheckCircle2,
  RefreshCw, Search, Server, Shield, TrendingUp, Users,
} from 'lucide-react';

interface TenantRecord {
  id: string;
  name?: string;
  status?: 'active' | 'suspended' | 'pending' | string;
  tier?: string;
  deploymentModel?: string;
  data?: { dataResidencyRegion?: string };
  llm?: { defaultModel?: string; allowedModels?: string[] };
  createdAt?: string;
  organisationId?: string | number;
}

interface TenantListResponse {
  success: boolean;
  data: {
    tenants: TenantRecord[];
    total: number;
    active: number;
    byTier: Record<string, number>;
  };
}

interface UsageReport {
  tenantId: string;
  period?: { from: string; to: string };
  apiCalls?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  byPlatform?: Record<string, number>;
  byProvider?: Record<string, number>;
}

interface AdminHealthFull {
  status: string;
  uptimeSec?: number;
  components?: Record<string, { status: string; latencyMs?: number; detail?: string }>;
  byOrg?: Array<{ orgId: string | number; status: string; alerts?: number }>;
}

// Canonical: use the shared `apiRequest` helper from `@/lib/queryClient` —
// it reads the JWT from `getAuthToken()` (the actual key set
// by the AuthContext on login) and attaches `Authorization: Bearer <jwt>`
// per NV-AUTH-HEADER-001. Earlier draft used a non-existent `nyv.auth.token`
// key (caught in v10 architect review).
async function fetchJson<T>(url: string): Promise<T> {
  return (await apiRequest(url, 'GET')) as T;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-slate-50 text-slate-600 border-slate-200',
};

const TIER_BADGE: Record<string, string> = {
  solo: 'bg-slate-100 text-slate-700 border-slate-300',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
  government: 'bg-red-50 text-red-700 border-red-200',
  education: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function SuperAdminFederatedTenants() {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [filterRegion, setFilterRegion] = useState<string>('all');
  const [searchQ, setSearchQ] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const tenantsQ = useQuery<TenantListResponse>({
    queryKey: ['fed-tenants', filterStatus, filterTier, filterRegion],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filterStatus !== 'all') qs.set('status', filterStatus);
      if (filterTier !== 'all') qs.set('tier', filterTier);
      if (filterRegion !== 'all') qs.set('region', filterRegion);
      const suffix = qs.toString() ? `?${qs}` : '';
      return fetchJson<TenantListResponse>(`${NV_BASE}tenants${suffix}`);
    },
    staleTime: 15_000,
  });

  const healthQ = useQuery<AdminHealthFull>({
    queryKey: ['fed-admin-health'],
    queryFn: () => fetchJson<AdminHealthFull>(nv('admin/health/full')),
    staleTime: 10_000,
    retry: 1,
  });

  const usageQ = useQuery<{ success: boolean; data: UsageReport }>({
    queryKey: ['fed-tenant-usage', selectedTenantId],
    queryFn: () => fetchJson<{ success: boolean; data: UsageReport }>(`${NV_BASE}tenants/${selectedTenantId}/usage`),
    enabled: !!selectedTenantId,
    staleTime: 30_000,
  });

  const tenants = tenantsQ.data?.data.tenants ?? [];
  const stats = tenantsQ.data?.data;

  const filteredTenants = useMemo(() => {
    if (!searchQ.trim()) return tenants;
    const q = searchQ.toLowerCase();
    return tenants.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        (t.name ?? '').toLowerCase().includes(q) ||
        (t.tier ?? '').toLowerCase().includes(q) ||
        (t.data?.dataResidencyRegion ?? '').toLowerCase().includes(q),
    );
  }, [tenants, searchQ]);

  const regions = useMemo(() => {
    const s = new Set<string>();
    tenants.forEach((t) => t.data?.dataResidencyRegion && s.add(t.data.dataResidencyRegion));
    return Array.from(s).sort();
  }, [tenants]);

  const byRegion = useMemo(() => {
    const m: Record<string, number> = {};
    tenants.forEach((t) => {
      const r = t.data?.dataResidencyRegion ?? 'unknown';
      m[r] = (m[r] ?? 0) + 1;
    });
    return m;
  }, [tenants]);

  const byDeployment = useMemo(() => {
    const m: Record<string, number> = {};
    tenants.forEach((t) => {
      const d = t.deploymentModel ?? 'unknown';
      m[d] = (m[d] ?? 0) + 1;
    });
    return m;
  }, [tenants]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6" data-testid="page-federated-tenants">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Globe className="w-6 h-6 text-[#152448]" />
            Federated Tenant View
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Cross-tenant aggregation for super-admin operators. Read-only — no orchestration calls.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            tenantsQ.refetch();
            healthQ.refetch();
            if (selectedTenantId) usageQ.refetch();
          }}
          data-testid="button-refresh-fed-tenants"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${tenantsQ.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Aggregate KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="grid-aggregate-kpis">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Total Tenants</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-total-tenants">
                  {stats?.total ?? '—'}
                </p>
              </div>
              <Building2 className="w-8 h-8 text-[#152448]/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Active</p>
                <p className="text-2xl font-bold text-emerald-600 mt-1" data-testid="kpi-active-tenants">
                  {stats?.active ?? '—'}
                </p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Regions</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-regions">
                  {regions.length || '—'}
                </p>
              </div>
              <Globe className="w-8 h-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Platform Health</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    healthQ.data?.status === 'ok' || healthQ.data?.status === 'healthy'
                      ? 'text-emerald-600'
                      : healthQ.isError
                      ? 'text-amber-600'
                      : 'text-slate-900'
                  }`}
                  data-testid="kpi-platform-health"
                >
                  {healthQ.isLoading ? '…' : healthQ.data?.status ?? (healthQ.isError ? 'unknown' : '—')}
                </p>
              </div>
              <Activity className="w-8 h-8 text-[#152448]/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <Input
                placeholder="Search id / name / tier / region…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="pl-9"
                data-testid="input-search-tenants"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterTier} onValueChange={setFilterTier}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-tier">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="solo">Solo</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="government">Government</SelectItem>
                <SelectItem value="education">Education</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRegion} onValueChange={setFilterRegion}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-region">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Regions</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Body: tenant list (left) + drill-down (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tenant list */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              Tenants ({filteredTenants.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenantsQ.isLoading && (
              <div className="space-y-2 py-2" data-testid="state-loading-tenants">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            )}
            {tenantsQ.isError && (
              <div data-testid="state-error-tenants">
                <JrxErrorState
                  title="Could not load tenants"
                  error={tenantsQ.error}
                  onRetry={() => tenantsQ.refetch()}
                  variant="card"
                  size="sm"
                />
              </div>
            )}
            {tenantsQ.isSuccess && filteredTenants.length === 0 && (
              <div data-testid="state-empty-tenants">
                <JrxEmptyState
                  icon={Users}
                  title="No tenants match the current filters"
                  description="Adjust the filters above or invite a new tenant."
                  size="sm"
                />
              </div>
            )}
            <div className="divide-y divide-slate-100" data-testid="list-tenants">
              {filteredTenants.map((t) => {
                const isSelected = selectedTenantId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`w-full text-left py-3 px-2 -mx-2 rounded transition ${
                      isSelected ? 'bg-[#152448]/5 border-l-2 border-[#152448]' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedTenantId(t.id)}
                    data-testid={`row-tenant-${t.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{t.name ?? t.id}</p>
                        <p className="text-xs text-slate-700 mt-0.5">
                          {t.id} · {t.deploymentModel ?? 'unknown'} · {t.data?.dataResidencyRegion ?? '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {t.tier && (
                          <Badge variant="outline" className={TIER_BADGE[t.tier] ?? 'bg-slate-100 text-slate-700'}>
                            {t.tier}
                          </Badge>
                        )}
                        {t.status && (
                          <Badge variant="outline" className={STATUS_BADGE[t.status] ?? 'bg-slate-100 text-slate-700'}>
                            {t.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Drill-down */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Tenant Detail
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTenantId && (
              <p className="text-sm text-slate-700 py-8 text-center" data-testid="state-no-tenant-selected">
                Select a tenant to view its 30-day usage and model access.
              </p>
            )}
            {selectedTenantId && (
              <Tabs defaultValue="usage" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="usage" data-testid="tab-usage">
                    Usage
                  </TabsTrigger>
                  <TabsTrigger value="distribution" data-testid="tab-distribution">
                    Distribution
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="usage" className="mt-4 space-y-3">
                  {usageQ.isLoading && (
                    <div className="space-y-1.5"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
                  )}
                  {usageQ.isError && (
                    <div data-testid="state-error-usage">
                      <JrxErrorState
                        title="Usage unavailable"
                        error={usageQ.error}
                        onRetry={() => usageQ.refetch()}
                        variant="card"
                        size="sm"
                      />
                    </div>
                  )}
                  {usageQ.data?.data && (
                    <div className="space-y-2 text-xs" data-testid="block-usage-report">
                      <div className="flex justify-between">
                        <span className="text-slate-700">API calls (30d)</span>
                        <span className="font-mono text-slate-900">
                          {usageQ.data.data.apiCalls?.toLocaleString() ?? '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-700">Tokens in</span>
                        <span className="font-mono text-slate-900">
                          {usageQ.data.data.tokensIn?.toLocaleString() ?? '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-700">Tokens out</span>
                        <span className="font-mono text-slate-900">
                          {usageQ.data.data.tokensOut?.toLocaleString() ?? '—'}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100 pt-2">
                        <span className="text-slate-700">Cost (USD)</span>
                        <span className="font-mono font-bold text-[#152448]">
                          ${usageQ.data.data.costUsd?.toFixed(2) ?? '—'}
                        </span>
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="distribution" className="mt-4 space-y-3">
                  <div data-testid="block-by-tier">
                    <p className="text-xs font-medium text-slate-700 mb-2">By Tier</p>
                    {Object.entries(stats?.byTier ?? {}).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-700">{k}</span>
                        <span className="font-mono text-slate-900">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div data-testid="block-by-region">
                    <p className="text-xs font-medium text-slate-700 mb-2 mt-3">By Region</p>
                    {Object.entries(byRegion).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-700">{k}</span>
                        <span className="font-mono text-slate-900">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div data-testid="block-by-deployment">
                    <p className="text-xs font-medium text-slate-700 mb-2 mt-3">By Deployment Model</p>
                    {Object.entries(byDeployment).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-700">{k}</span>
                        <span className="font-mono text-slate-900">{v}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Federated platform health (cross-tenant) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            Cross-Tenant Platform Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthQ.isLoading && (
            <div className="space-y-1.5"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/3" /></div>
          )}
          {healthQ.isError && (
            <div data-testid="state-error-health">
              <JrxErrorState
                title="Health endpoint unavailable"
                error={healthQ.error}
                onRetry={() => healthQ.refetch()}
                variant="card"
                size="sm"
              />
            </div>
          )}
          {healthQ.data?.components && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="grid-health-components">
              {Object.entries(healthQ.data.components).map(([name, comp]) => (
                <div
                  key={name}
                  className={`text-xs p-2 rounded border ${
                    comp.status === 'ok' || comp.status === 'healthy'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}
                  data-testid={`health-component-${name}`}
                >
                  <p className="font-medium truncate">{name}</p>
                  <p className="opacity-70 mt-0.5">
                    {comp.status} {comp.latencyMs != null && `· ${comp.latencyMs}ms`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
