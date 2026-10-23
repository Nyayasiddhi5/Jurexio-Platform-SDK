/**
 * Customer Org Detail — per-firm 30-day usage rollup
 * (task-354, 2026-05-13; task-368, 2026-05-13: inline edit).
 *
 * Backed by GET /api/jrx/sdk/customer-orgs/:id/usage which returns the
 * customer org metadata plus an aggregated rollup over sdk_usage_metering
 * and sdk_api_request_logs (requests, tokens, cost, errors). Server enforces
 * cross-tenant isolation: 404 if the :id does not belong to the calling
 * platform.
 *
 * task-368: inline edit for display_name + tier + status (suspend / archive
 * / reactivate) flows through POST /api/jrx/sdk/customer-orgs (idempotent
 * upsert keyed on platform_id+external_ref). After a successful save the
 * usage query is invalidated so the metadata header reflects the new value.
 *
 * RBAC: same gate as the list page — platform_admin / super_admin layers
 * via isCustomerOrgPlatformAdmin().
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, Building2, AlertTriangle, RefreshCw, Activity,
  Coins, Hash, AlertOctagon, Clock, LineChart as LineChartIcon,
  Pencil, Check, X, Pause, Play, Archive,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE } from '@/lib/jrx-api-paths';

interface CustomerOrgMeta {
  id: number;
  external_ref: string;
  display_name: string;
  status: string;
  tier?: string;
  jurisdiction?: string;
  data_residency?: string;
}

interface UsageResponse {
  success: boolean;
  data?: {
    customer_org: CustomerOrgMeta;
    usage: {
      tokens_in: number;
      tokens_out: number;
      cost_usd: number;
      request_count: number;
      error_count: number;
    };
    generated_at: string;
  };
  error?: string;
  code?: string;
}

const TIER_OPTIONS = ['standard', 'pro', 'enterprise', 'trial'] as const;
const STATUS_OPTIONS = ['active', 'suspended', 'archived'] as const;

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200',
  archived:  'bg-slate-100 text-slate-600 border-slate-300',
};

async function fetchUsage(id: string): Promise<UsageResponse> {
  const token = getAuthToken();
  const resp = await fetch(`${NV_BASE}sdk/customer-orgs/${encodeURIComponent(id)}/usage`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await resp.json().catch(() => ({}))) as UsageResponse;
  if (!resp.ok || !json.success) {
    throw new Error(json.error ?? `HTTP ${resp.status}`);
  }
  return json;
}

interface DailyPoint {
  day: string;
  request_count: number;
  error_count: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

interface DailyResponse {
  success: boolean;
  data?: {
    customer_org_id: number;
    days: number;
    points: DailyPoint[];
    generated_at: string;
  };
  error?: string;
}

async function fetchDaily(id: string): Promise<DailyResponse> {
  const token = getAuthToken();
  const resp = await fetch(`${NV_BASE}sdk/customer-orgs/${encodeURIComponent(id)}/usage/daily?days=30`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await resp.json().catch(() => ({}))) as DailyResponse;
  if (!resp.ok || !json.success) {
    throw new Error(json.error ?? `HTTP ${resp.status}`);
  }
  return json;
}

function shortDay(d: string): string {
  // YYYY-MM-DD → MMM DD (e.g. May 13). Built without `new Date()` so
  // timezone shifts can't reassign the bucket the server already chose.
  const [, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = Number(m) - 1;
  return `${months[mi] ?? m} ${Number(day)}`;
}

interface DailyTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: Partial<DailyPoint> }>;
  label?: string;
}

function DailyTooltip({ active, payload, label }: DailyTooltipProps) {
  if (!active || !payload?.length) return null;
  const p: Partial<DailyPoint> = payload[0]?.payload ?? {};
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-xs shadow-md" data-testid="usage-daily-tooltip">
      <div className="font-semibold text-slate-900">{label ? shortDay(label) : ''}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-700">
        <span>Requests</span><span className="font-mono text-right">{p.request_count?.toLocaleString() ?? 0}</span>
        <span>Errors</span><span className="font-mono text-right text-rose-700">{p.error_count?.toLocaleString() ?? 0}</span>
        <span>Tokens in</span><span className="font-mono text-right">{p.tokens_in?.toLocaleString() ?? 0}</span>
        <span>Tokens out</span><span className="font-mono text-right">{p.tokens_out?.toLocaleString() ?? 0}</span>
        <span>Cost</span><span className="font-mono text-right">${(p.cost_usd ?? 0).toFixed(4)}</span>
      </div>
    </div>
  );
}

interface UpsertPatch {
  external_ref: string;
  display_name?: string;
  tier?: string;
  status?: typeof STATUS_OPTIONS[number];
}

interface ZodIssue {
  path?: unknown[];
  message?: string;
}

interface UpsertErrorBody {
  success?: boolean;
  error?: string;
  detail?: ZodIssue[];
}

async function upsertCustomerOrg(patch: UpsertPatch): Promise<void> {
  const token = getAuthToken();
  const resp = await fetch(`${NV_BASE}sdk/customer-orgs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(patch),
  });
  const json = (await resp.json().catch(() => ({}))) as UpsertErrorBody;
  if (!resp.ok || !json.success) {
    const detail: ZodIssue[] = Array.isArray(json.detail) ? json.detail : [];
    if (detail.length) {
      const msgs = detail.map((d) => {
        const path = Array.isArray(d.path) ? d.path.join('.') : '';
        return `${path || 'field'}: ${d.message ?? 'invalid'}`;
      });
      throw new Error(msgs.join('; '));
    }
    throw new Error(json.error ?? `HTTP ${resp.status}`);
  }
}

function fmtNum(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '0';
  return n.toLocaleString();
}

function fmtUsd(n: number | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

interface KpiProps {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  tone?: 'neutral' | 'warn';
  hint?: string;
  testid?: string;
}

function Kpi({ label, value, icon: Icon, tone = 'neutral', hint, testid }: KpiProps) {
  const ring = tone === 'warn' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white';
  const ic = tone === 'warn' ? 'text-amber-600' : 'text-[#152448]';
  return (
    <Card className={`border ${ring}`} data-testid={testid}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">{label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 leading-tight">{value}</div>
            {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
          </div>
          <div className={`shrink-0 rounded-lg bg-white p-2 ring-1 ring-inset ring-slate-200 ${ic}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface EditPanelProps {
  org: CustomerOrgMeta;
  onSaved: () => void;
}

function EditPanel({ org, onSaved }: EditPanelProps) {
  const [editingName, setEditingName] = React.useState(false);
  const [editingTier, setEditingTier] = React.useState(false);
  const [name, setName] = React.useState(org.display_name ?? '');
  const [tier, setTier] = React.useState(org.tier ?? 'standard');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Keep local form state in sync if a refetch swaps the org row underneath us.
  React.useEffect(() => {
    if (!editingName) setName(org.display_name ?? '');
    if (!editingTier) setTier(org.tier ?? 'standard');
  }, [org.display_name, org.tier, editingName, editingTier]);

  async function save(action: string, patch: Partial<UpsertPatch>) {
    setBusy(action);
    setErr(null);
    try {
      await upsertCustomerOrg({ external_ref: org.external_ref, ...patch });
      onSaved();
      setEditingName(false);
      setEditingTier(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-slate-200" data-testid="customer-org-edit-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-700">
          Manage customer organisation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Display name --------------------------------------------------- */}
        <div className="flex items-start gap-3">
          <div className="w-32 shrink-0 pt-2">
            <Label className="text-xs font-semibold text-slate-700">Display name</Label>
          </div>
          {editingName ? (
            <div className="flex-1 flex items-start gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-sm"
                aria-label="Display name"
                data-testid="customer-org-edit-name-input"
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => save('name', { display_name: name.trim() || undefined })}
                disabled={busy !== null || !name.trim()}
                data-testid="customer-org-edit-name-save"
                className="bg-[#152448] hover:bg-[#152448]/90 text-white"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditingName(false); setName(org.display_name ?? ''); setErr(null); }}
                disabled={busy !== null}
                aria-label="Cancel name edit"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm text-slate-900" data-testid="customer-org-edit-name-value">
                {org.display_name || org.external_ref}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingName(true)}
                disabled={busy !== null}
                aria-label="Edit display name"
                data-testid="customer-org-edit-name-button"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        {/* Tier ----------------------------------------------------------- */}
        <div className="flex items-start gap-3">
          <div className="w-32 shrink-0 pt-2">
            <Label className="text-xs font-semibold text-slate-700">Tier</Label>
          </div>
          {editingTier ? (
            <div className="flex-1 flex items-start gap-2">
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="text-sm w-44" data-testid="customer-org-edit-tier-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => save('tier', { tier })}
                disabled={busy !== null}
                data-testid="customer-org-edit-tier-save"
                className="bg-[#152448] hover:bg-[#152448]/90 text-white"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditingTier(false); setTier(org.tier ?? 'standard'); setErr(null); }}
                disabled={busy !== null}
                aria-label="Cancel tier edit"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2">
              <Badge variant="outline" className="text-xs" data-testid="customer-org-edit-tier-value">
                {org.tier ?? 'standard'}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingTier(true)}
                disabled={busy !== null}
                aria-label="Edit tier"
                data-testid="customer-org-edit-tier-button"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        {/* Status --------------------------------------------------------- */}
        <div className="flex items-start gap-3">
          <div className="w-32 shrink-0 pt-2">
            <Label className="text-xs font-semibold text-slate-700">Status</Label>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`${STATUS_COLORS[org.status] ?? STATUS_COLORS.active} text-xs`}
                data-testid="customer-org-edit-status-value"
              >
                {org.status || 'active'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => save('reactivate', { status: 'active' })}
                disabled={busy !== null || org.status === 'active'}
                data-testid="customer-org-status-reactivate"
              >
                <Play className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                Reactivate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => save('suspend', { status: 'suspended' })}
                disabled={busy !== null || org.status === 'suspended'}
                data-testid="customer-org-status-suspend"
                className="text-amber-700 border-amber-300 hover:bg-amber-50"
              >
                <Pause className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                Suspend
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => save('archive', { status: 'archived' })}
                disabled={busy !== null || org.status === 'archived'}
                data-testid="customer-org-status-archive"
                className="text-slate-600 border-slate-300 hover:bg-slate-50"
              >
                <Archive className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                Archive
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Status changes flow through <code className="px-1 bg-slate-100 rounded">POST /api/jrx/sdk/customer-orgs</code>
              {' '}(idempotent upsert keyed on <code className="px-1 bg-slate-100 rounded">platform_id + external_ref</code>).
            </p>
          </div>
        </div>

        {err && (
          <div
            className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
            data-testid="customer-org-edit-error"
          >
            {err}
          </div>
        )}
        {busy && (
          <p className="text-xs text-slate-500" data-testid="customer-org-edit-busy">
            Saving {busy}…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomerOrgDetailPage() {
  const [, params] = useRoute<{ id: string }>('/customer-orgs/:id');
  const [, navigate] = useLocation();
  const id = params?.id ?? '';
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<UsageResponse, Error>({
    queryKey: ['customer-org:usage', id],
    queryFn: () => fetchUsage(id),
    enabled: !!id,
    retry: false,
  });

  const daily = useQuery<DailyResponse, Error>({
    queryKey: ['customer-org:usage:daily', id],
    queryFn: () => fetchDaily(id),
    enabled: !!id,
    retry: false,
  });

  const org = data?.data?.customer_org;
  const usage = data?.data?.usage;
  const dailyPoints = daily.data?.data?.points ?? [];

  const onSaved = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['customer-org:usage', id] });
    queryClient.invalidateQueries({ queryKey: ['customer-orgs:list'] });
  }, [queryClient, id]);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto" data-testid="customer-org-detail-page">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/customer-orgs')}
          aria-label="Back to customer orgs list"
          data-testid="customer-org-back"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Customer Orgs
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetch(); daily.refetch(); }}
          disabled={isFetching || daily.isFetching}
          aria-label="Refresh usage rollup and daily series"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${(isFetching || daily.isFetching) ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-[#152448]/5 p-2 ring-1 ring-inset ring-[#152448]/20">
          <Building2 className="h-6 w-6 text-[#152448]" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          {isLoading ? (
            <Skeleton className="h-7 w-64" />
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900 truncate" data-testid="customer-org-name">
                {org?.display_name || org?.external_ref || 'Customer organisation'}
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-600 mt-0.5">
                <code className="font-mono">{org?.external_ref ?? '—'}</code>
                {org?.status && (
                  <Badge variant="outline" className="text-[10px]">{org.status}</Badge>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {isError ? (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          data-testid="customer-org-detail-error"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Could not load usage rollup
          </div>
          <p className="mt-1 text-xs">{error?.message ?? 'Unknown error'}</p>
        </div>
      ) : (
        <>
          {org && <EditPanel org={org} onSaved={onSaved} />}

          <h2 className="text-sm font-semibold text-slate-700 mt-2">
            Last 30-day usage rollup
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi
              label="Requests"
              value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(usage?.request_count)}
              icon={Activity}
              testid="kpi-requests"
            />
            <Kpi
              label="Tokens in"
              value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(usage?.tokens_in)}
              icon={Hash}
              testid="kpi-tokens-in"
            />
            <Kpi
              label="Tokens out"
              value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(usage?.tokens_out)}
              icon={Hash}
              testid="kpi-tokens-out"
            />
            <Kpi
              label="Cost (USD)"
              value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtUsd(usage?.cost_usd)}
              icon={Coins}
              testid="kpi-cost"
            />
            <Kpi
              label="Errors"
              value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(usage?.error_count)}
              icon={AlertOctagon}
              tone={usage && usage.error_count > 0 ? 'warn' : 'neutral'}
              testid="kpi-errors"
            />
          </div>

          <Card className="border-slate-200" data-testid="usage-daily-chart-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <LineChartIcon className="h-4 w-4 text-[#152448]" aria-hidden="true" />
                Daily usage — last 30 days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {daily.isLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : daily.isError ? (
                <div className="text-xs text-rose-700" data-testid="usage-daily-error">
                  Could not load daily series: {daily.error?.message ?? 'unknown error'}
                </div>
              ) : dailyPoints.length === 0 ? (
                <div className="text-xs text-slate-500">No usage recorded in the last 30 days.</div>
              ) : (
                <div className="h-[260px]" data-testid="usage-daily-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dailyPoints} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis
                        dataKey="day"
                        tickFormatter={shortDay}
                        tick={{ fontSize: 11, fill: '#475569' }}
                        interval="preserveStartEnd"
                        minTickGap={20}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11, fill: '#475569' }}
                        allowDecimals={false}
                        width={40}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: '#475569' }}
                        tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                        width={56}
                      />
                      <Tooltip content={<DailyTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        yAxisId="left"
                        dataKey="request_count"
                        name="Requests"
                        fill="#152448"
                        radius={[2, 2, 0, 0]}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cost_usd"
                        name="Cost (USD)"
                        stroke="#D97706"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Source</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600 space-y-1">
              <div>
                Endpoint: <code className="px-1 bg-slate-100 rounded">GET /api/jrx/sdk/customer-orgs/{id}/usage</code>
              </div>
              <div>
                Aggregated server-side from <code className="px-1 bg-slate-100 rounded">sdk_usage_metering</code> and
                {' '}<code className="px-1 bg-slate-100 rounded">sdk_api_request_logs</code>, filtered to
                <code className="px-1 mx-1 bg-slate-100 rounded">platform_id = your platform</code>
                so a key from another platform cannot read this row.
              </div>
              {data?.data?.generated_at && (
                <div className="flex items-center gap-1.5 text-slate-500">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Generated at {new Date(data.data.generated_at).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
