/**
 * Customer Orgs — partner-platform view of downstream customer firms
 * (task-354, 2026-05-13; task-368, 2026-05-13: add-org dialog).
 *
 * Lists every nv_customer_organizations row that belongs to the calling
 * platform (NSP / NSI / …). Backed by GET /api/jrx/sdk/customer-orgs which
 * filters server-side by sdkContext.applicationId and is auth-gated to
 * customer-orgs:admin scope (or super_admin).
 *
 * Click-through navigates to /console/customer-orgs/:id (detail/usage page).
 *
 * task-368: an "Add customer org" dialog drives POST /api/jrx/sdk/customer-orgs
 * (idempotent upsert). On success the new row is invalidated into the list
 * query and the dialog closes; Zod validation errors from the backend are
 * surfaced inline next to the offending field.
 *
 * RBAC: gated to platform_admin / super_admin layers via
 *   isCustomerOrgPlatformAdmin() — see lib/rbac-customer-orgs.ts.
 *
 * NV-CONTRACT-001: path imported from nv-api-paths via NV_BASE.
 * NV-DOC-001: page TSX, no new md.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Building2, RefreshCw, Search, ChevronRight, AlertTriangle,
  Globe, Layers, Plus,
} from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE } from '@/lib/jrx-api-paths';

interface CustomerOrg {
  id: number;
  platform_id: number;
  external_ref: string;
  display_name: string;
  jurisdiction: string;
  tier: string;
  data_residency: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  /** task-354: server-derived MAX(sdk_api_request_logs.created_at), falling back to updated_at when the firm has no traffic yet. */
  last_seen_at?: string | null;
}

interface ListResponse {
  success: boolean;
  data?: { items: CustomerOrg[]; total: number; limit: number; offset: number };
  error?: string;
  code?: string;
}

const TIER_COLORS: Record<string, string> = {
  standard:   'bg-slate-100 text-slate-700 border-slate-300',
  pro:        'bg-blue-50 text-blue-700 border-blue-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
  trial:      'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200',
  archived:  'bg-slate-100 text-slate-600 border-slate-300',
};

const TIER_OPTIONS = ['standard', 'pro', 'enterprise', 'trial'] as const;
const JURISDICTION_OPTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC'] as const;
const DATA_RESIDENCY_OPTIONS = ['IN', 'UK', 'US', 'EU', 'SG'] as const;

async function fetchCustomerOrgs(): Promise<ListResponse> {
  const token = getAuthToken();
  const resp = await fetch(`${NV_BASE}sdk/customer-orgs?limit=200`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await resp.json().catch(() => ({}))) as ListResponse;
  if (!resp.ok || !json.success) {
    throw new Error(json.error ?? `HTTP ${resp.status}`);
  }
  return json;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

interface AddDialogProps {
  onCreated: () => void;
}

type FormField =
  | 'external_ref'
  | 'platform_id'
  | 'display_name'
  | 'jurisdiction'
  | 'tier'
  | 'data_residency';

const FORM_FIELDS: ReadonlySet<FormField> = new Set([
  'external_ref',
  'platform_id',
  'display_name',
  'jurisdiction',
  'tier',
  'data_residency',
]);

interface MePlatform {
  id: number;
  app_name: string;
  app_type: string;
  jurisdiction: string | null;
}

interface MePlatformsResponse {
  success: boolean;
  data?: { items: MePlatform[] };
  error?: string;
}

async function fetchMePlatforms(): Promise<MePlatform[]> {
  const token = getAuthToken();
  const resp = await fetch(`${NV_BASE}sdk/customer-orgs/me/platforms`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = (await resp.json().catch(() => ({}))) as MePlatformsResponse;
  if (!resp.ok || !json.success) {
    throw new Error(json.error ?? `HTTP ${resp.status}`);
  }
  return json.data?.items ?? [];
}

function isFormField(v: unknown): v is FormField {
  return typeof v === 'string' && FORM_FIELDS.has(v as FormField);
}

type FieldErrors = Partial<Record<FormField, string>> & { _form?: string };

interface ZodIssue {
  path?: unknown[];
  message?: string;
}

interface UpsertErrorBody {
  success?: boolean;
  error?: string;
  detail?: ZodIssue[];
}

function AddCustomerOrgDialog({ onCreated }: AddDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [form, setForm] = React.useState({
    external_ref: '',
    // task-385: empty string = "no product picked yet". The submit
    // handler refuses to POST until this is a positive integer, and
    // the Select intentionally has no default option so a user has to
    // make an explicit choice (the silent backend fallback is gone too).
    platform_id: '' as string,
    display_name: '',
    jurisdiction: 'IN',
    tier: 'standard',
    data_residency: 'IN',
  });

  // task-385: load the platforms (= SKU rows in sdk_applications) the
  // caller may bind a customer to. Without a non-empty list the form is
  // blocked from submission — onboarding without a product picked is
  // exactly the regression this task closes.
  const platformsQ = useQuery<MePlatform[], Error>({
    queryKey: ['customer-orgs:me-platforms'],
    queryFn: fetchMePlatforms,
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });
  const platforms = platformsQ.data ?? [];

  // Auto-select when there is exactly one platform — the user still
  // sees the picker (locked) so the binding is never invisible, but
  // they don't have to click through a one-option dropdown.
  React.useEffect(() => {
    if (
      open &&
      platforms.length === 1 &&
      form.platform_id === ''
    ) {
      setForm((f) => ({ ...f, platform_id: String(platforms[0].id) }));
    }
  }, [open, platforms, form.platform_id]);

  function reset() {
    setForm({
      external_ref: '',
      platform_id: '',
      display_name: '',
      jurisdiction: 'IN',
      tier: 'standard',
      data_residency: 'IN',
    });
    setErrors({});
    setSubmitting(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const fieldErrors: FieldErrors = {};
    if (!form.external_ref.trim()) {
      fieldErrors.external_ref = 'External ref is required.';
    }
    const platformIdNum = Number(form.platform_id);
    if (!Number.isInteger(platformIdNum) || platformIdNum <= 0) {
      fieldErrors.platform_id =
        'Pick which product (SDK application) the customer was sold.';
    }
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      return;
    }
    setSubmitting(true);
    try {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/customer-orgs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          external_ref: form.external_ref.trim(),
          platform_id: platformIdNum,
          display_name: form.display_name.trim() || undefined,
          jurisdiction: form.jurisdiction || undefined,
          tier: form.tier || undefined,
          data_residency: form.data_residency || undefined,
        }),
      });
      const json = (await resp.json().catch(() => ({}))) as UpsertErrorBody & { success?: boolean };
      if (!resp.ok || !json.success) {
        // Surface Zod field errors when present.
        const detail: ZodIssue[] = Array.isArray(json.detail) ? json.detail : [];
        if (detail.length) {
          const next: FieldErrors = {};
          for (const issue of detail) {
            const path = Array.isArray(issue.path) ? issue.path[0] : undefined;
            const msg = issue.message ?? 'invalid';
            if (isFormField(path)) {
              next[path] = msg;
            } else {
              next._form = (next._form ? next._form + ' ' : '') + msg;
            }
          }
          setErrors(next);
        } else {
          setErrors({ _form: json.error ?? `HTTP ${resp.status}` });
        }
        return;
      }
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setErrors({ _form: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-[#152448] hover:bg-[#152448]/90 text-white"
          data-testid="customer-orgs-add"
        >
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Add customer org
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white border-slate-200 max-w-md" aria-label="Add customer organisation">
        <DialogHeader>
          <DialogTitle className="text-[#152448]">Add customer organisation</DialogTitle>
          <DialogDescription className="text-xs text-slate-600">
            Onboards a downstream customer firm against your SDK platform. The
            create call is idempotent — re-submitting the same external ref
            updates the existing row instead of creating a duplicate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" data-testid="customer-org-add-form">
          {/* task-385: product / SKU picker. Required, no default option. */}
          <div className="space-y-1">
            <Label htmlFor="platform_id" className="text-xs">
              Product (SDK application) <span className="text-rose-600">*</span>
            </Label>
            {platformsQ.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : platformsQ.isError ? (
              <div
                className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
                data-testid="customer-org-add-error-platform-id"
              >
                Could not load your products: {platformsQ.error?.message ?? 'unknown error'}
              </div>
            ) : platforms.length === 0 ? (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
                data-testid="customer-org-add-no-platforms"
              >
                Your account has no SDK applications yet — onboarding is blocked
                until at least one product is provisioned.
              </div>
            ) : (
              <Select
                value={form.platform_id}
                onValueChange={(v) => setForm({ ...form, platform_id: v })}
              >
                <SelectTrigger
                  id="platform_id"
                  className="text-xs"
                  data-testid="customer-org-add-platform-id"
                  aria-invalid={!!errors.platform_id}
                  aria-required="true"
                >
                  <SelectValue placeholder="Select a product…" />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.app_name} <span className="text-slate-400">· {p.app_type}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-slate-500">
              Which Jurexio SKU did this customer purchase? Required —
              cross-product onboarding is rejected by the API.
            </p>
            {errors.platform_id && (
              <p
                className="text-xs text-rose-700"
                data-testid="customer-org-add-error-platform-id-msg"
              >
                {errors.platform_id}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="external_ref" className="text-xs">
              External ref <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="external_ref"
              value={form.external_ref}
              onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
              placeholder="e.g. acme-legal-001"
              required
              data-testid="customer-org-add-external-ref"
              aria-invalid={!!errors.external_ref}
            />
            <p className="text-[11px] text-slate-500">
              Stable identifier from your system. 1–128 chars of letters,
              digits, or <code>. _ : @ -</code>.
            </p>
            {errors.external_ref && (
              <p className="text-xs text-rose-700" data-testid="customer-org-add-error-external-ref">
                {errors.external_ref}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="display_name" className="text-xs">Display name</Label>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Acme Legal LLP"
              data-testid="customer-org-add-display-name"
              aria-invalid={!!errors.display_name}
            />
            {errors.display_name && (
              <p className="text-xs text-rose-700">{errors.display_name}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Jurisdiction</Label>
              <Select
                value={form.jurisdiction}
                onValueChange={(v) => setForm({ ...form, jurisdiction: v })}
              >
                <SelectTrigger className="text-xs" data-testid="customer-org-add-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JURISDICTION_OPTIONS.map((j) => (
                    <SelectItem key={j} value={j}>{j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.jurisdiction && (
                <p className="text-xs text-rose-700">{errors.jurisdiction}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tier</Label>
              <Select
                value={form.tier}
                onValueChange={(v) => setForm({ ...form, tier: v })}
              >
                <SelectTrigger className="text-xs" data-testid="customer-org-add-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.tier && (
                <p className="text-xs text-rose-700">{errors.tier}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data residency</Label>
              <Select
                value={form.data_residency}
                onValueChange={(v) => setForm({ ...form, data_residency: v })}
              >
                <SelectTrigger className="text-xs" data-testid="customer-org-add-data-residency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_RESIDENCY_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.data_residency && (
                <p className="text-xs text-rose-700">{errors.data_residency}</p>
              )}
            </div>
          </div>

          {errors._form && (
            <div
              className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
              data-testid="customer-org-add-error"
            >
              {errors._form}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setOpen(false); reset(); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-[#152448] hover:bg-[#152448]/90 text-white"
              disabled={submitting}
              data-testid="customer-org-add-submit"
            >
              {submitting ? 'Adding…' : 'Add customer org'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomerOrgsPage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = React.useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ListResponse, Error>({
    queryKey: ['customer-orgs:list'],
    queryFn: fetchCustomerOrgs,
    retry: false,
  });

  const items = data?.data?.items ?? [];
  const filtered = items.filter((o) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      o.display_name?.toLowerCase().includes(f) ||
      o.external_ref?.toLowerCase().includes(f) ||
      o.jurisdiction?.toLowerCase().includes(f) ||
      o.tier?.toLowerCase().includes(f)
    );
  });

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto" data-testid="customer-orgs-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-[#152448]" aria-hidden="true" />
            Customer Organisations
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Downstream customer firms onboarded against your SDK platform. Click a row for the
            30-day usage rollup.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddCustomerOrgDialog
            onCreated={() => {
              queryClient.invalidateQueries({ queryKey: ['customer-orgs:list'] });
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh customer orgs list"
            data-testid="customer-orgs-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-semibold text-slate-700">
              {isLoading ? 'Loading…' : `${filtered.length} of ${items.length} customer org${items.length === 1 ? '' : 's'}`}
            </CardTitle>
            <div className="ml-auto relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                placeholder="Filter by name, ref, jurisdiction…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-8 text-xs w-72"
                data-testid="customer-orgs-filter"
                aria-label="Filter customer orgs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : isError ? (
            <div
              className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
              data-testid="customer-orgs-error"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Could not load customer orgs
              </div>
              <p className="mt-1 text-xs">{error?.message ?? 'Unknown error'}</p>
              <p className="mt-2 text-xs text-rose-700">
                This page is gated to partner-platform admins (SDK key with
                <code className="mx-1 px-1 bg-rose-100 rounded">customer-orgs:admin</code>scope)
                and Jurexio super-admins. If you believe you should have access,
                check your platform key scopes.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600"
              data-testid="customer-orgs-empty"
            >
              <Building2 className="h-8 w-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
              {items.length === 0
                ? 'No customer organisations onboarded yet. Click "Add customer org" to register a downstream firm.'
                : 'No customer orgs match your filter.'}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Customer firm</th>
                    <th className="text-left px-3 py-2 font-semibold">External ref</th>
                    <th className="text-left px-3 py-2 font-semibold">Jurisdiction</th>
                    <th className="text-left px-3 py-2 font-semibold">Tier</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                    <th className="text-left px-3 py-2 font-semibold">Last seen</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filtered.map((o) => (
                    <tr
                      key={o.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => navigate(`/customer-orgs/${o.id}`)}
                      data-testid={`customer-org-row-${o.id}`}
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        {o.display_name || o.external_ref}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                        {o.external_ref}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 text-slate-700 text-xs">
                          <Globe className="h-3 w-3 text-slate-400" aria-hidden="true" />
                          {o.jurisdiction || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className={`${TIER_COLORS[o.tier] ?? TIER_COLORS.standard} text-xs`}>
                          {o.tier || 'standard'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className={`${STATUS_COLORS[o.status] ?? STATUS_COLORS.active} text-xs`}>
                          {o.status || 'active'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {fmtDate(o.last_seen_at ?? o.updated_at)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <ChevronRight className="h-4 w-4 text-slate-400 inline" aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <Layers className="h-3 w-3" aria-hidden="true" />
        Backend: <code className="px-1 bg-slate-100 rounded">GET /api/jrx/sdk/customer-orgs</code> ·
        Filtered server-side to your platform_id.
      </p>
    </div>
  );
}
