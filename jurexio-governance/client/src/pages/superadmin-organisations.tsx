import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Super Admin — Organisation Management
 * Full CRUD for all registered organisations.
 * Live-wired to /api/jrx/tenants + /api/jrx/sdk/applications
 */

import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Building2, Plus, RefreshCw, Search, Users, Key, BarChart3,
  CheckCircle2, AlertTriangle, XCircle, Shield, Clock,
  ChevronRight, Activity, Globe, Star, Settings,
  CreditCard, Lock, Power, Edit2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface Organisation {
  id: number;
  name: string;
  description: string | null;
  plan: string;
  tier: string;
  isActive?: boolean;
  is_active?: boolean;
  maxMembers?: number;
  max_members?: number;
  createdAt?: string;
  created_at?: string;
  userCount?: number;
  member_count?: number;
  platform_count?: number;
  monthly_spend_usd?: number;
  api_calls_30d?: number;
  cost_30d_usd?: number;
}

function orgActive(o: Organisation): boolean {
  return o.isActive ?? o.is_active ?? false;
}
function orgCreatedAt(o: Organisation): string | undefined {
  return o.createdAt ?? o.created_at;
}
function orgMembers(o: Organisation): number {
  return o.userCount ?? o.member_count ?? 0;
}
function orgMaxMembers(o: Organisation): number {
  return o.maxMembers ?? o.max_members ?? 0;
}

const TIER_COLORS: Record<string, string> = {
  solo: 'bg-slate-500/20 text-slate-700 border-slate-500/30',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
  government: 'bg-red-50 text-red-700 border-red-200',
  education: 'bg-amber-50 text-amber-700 border-amber-200',
};

function OrgRow({ org, onSelect, isSelected }: { org: Organisation; onSelect: (o: Organisation) => void; isSelected: boolean }) {
  return (
    <div
      className={cn('flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all text-xs', isSelected ? 'bg-[#152448]/30 border border-[#152448]/60' : 'bg-slate-100/50 border border-slate-200/40 hover:border-slate-300')}
      onClick={() => onSelect(org)}
      role="row"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`Organisation: ${org.name}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(org); }}
    >
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#152448] to-blue-900 flex items-center justify-center flex-shrink-0">
        <Building2 className="w-4 h-4 text-[#C7B15B]" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-semibold text-slate-800 truncate">{org.name}</p>
          <Badge className={cn('text-[9px] flex-shrink-0', TIER_COLORS[org.tier] ?? TIER_COLORS.pro)} aria-label={`Tier: ${org.tier}`}>{org.tier}</Badge>
        </div>
        <div className="flex items-center gap-3 text-slate-700 mt-0.5">
          <span className="flex items-center gap-0.5"><Users className="w-2.5 h-2.5" aria-hidden="true" />{orgMembers(org)} members</span>
          <span className="flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" aria-hidden="true" />{org.platform_count ?? 0} platforms</span>
          {org.api_calls_30d != null && (
            <span className="flex items-center gap-0.5"><BarChart3 className="w-2.5 h-2.5" aria-hidden="true" />{Number(org.api_calls_30d).toLocaleString()} calls</span>
          )}
          {org.cost_30d_usd != null && (
            <span className="flex items-center gap-0.5 text-amber-600"><CreditCard className="w-2.5 h-2.5" aria-hidden="true" />${Number(org.cost_30d_usd).toFixed(2)}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className={cn('w-1.5 h-1.5 rounded-full', orgActive(org) ? 'bg-emerald-400' : 'bg-slate-500')} aria-label={orgActive(org) ? 'Active' : 'Inactive'} />
        <span className="text-slate-700 text-[10px]">{orgCreatedAt(org) ? new Date(orgCreatedAt(org)!).toLocaleDateString() : '—'}</span>
      </div>
    </div>
  );
}

function CreateOrgModal({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', tier: 'pro', max_members: '50' });

  const createMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('enterprise/admin/organizations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          name: form.name,
          tier: form.tier,
          settings: { description: form.description, max_members: parseInt(form.max_members, 10) || 50 },
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? 'Failed to create organisation'); }
      return resp.json();
    },
    onSuccess: () => {
      toast({ title: 'Organisation created', description: `${form.name} onboarded successfully` });
      setOpen(false);
      onCreated();
    },
    onError: (err: Error) => toast({ title: 'Creation failed', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#152448] hover:bg-[#0a3580] text-white" aria-label="Onboard new organisation">
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Onboard Org
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white border-slate-200 max-w-md" aria-label="Onboard new organisation">
        <DialogHeader>
          <DialogTitle className="text-[#152448]">Onboard Organisation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="org-name">Organisation Name</Label>
            <Input id="org-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Singh & Associates" className="bg-white border-slate-300 text-[#1A3A60] mt-1" aria-label="Organisation name" />
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="org-desc">Description</Label>
            <Input id="org-desc" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Law firm, court, university..." className="bg-white border-slate-300 text-[#1A3A60] mt-1" aria-label="Organisation description" />
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="org-tier">Tier</Label>
            <Select value={form.tier} onValueChange={v => setForm(f => ({ ...f, tier: v }))}>
              <SelectTrigger id="org-tier" className="bg-white border-slate-300 text-[#1A3A60] mt-1" aria-label="Select organisation tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                <SelectItem value="solo">Solo</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="government">Government</SelectItem>
                <SelectItem value="education">Education</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="max-members">Max Members</Label>
            <Input id="max-members" type="number" value={form.max_members} onChange={e => setForm(f => ({ ...f, max_members: e.target.value }))} className="bg-white border-slate-300 text-[#1A3A60] mt-1" aria-label="Maximum number of members" />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} className="w-full bg-[#152448] hover:bg-[#0a3580] text-white" aria-label="Create organisation">
            {createMutation.isPending ? 'Creating...' : 'Create Organisation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SuperAdminOrganisations() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Organisation | null>(null);
  const [tierFilter, setTierFilter] = useState('all');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['superadmin-orgs'],
    queryFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('admin/orgs'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`Unable to retrieve organisations (HTTP ${resp.status})`);
      return resp.json();
    },
  });

  const { data: platformsData, isLoading: platformsLoading } = useQuery({
    queryKey: ['superadmin-org-platforms', selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('platforms'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!resp.ok) throw new Error(`Platforms HTTP ${resp.status}`);
      return resp.json();
    },
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['superadmin-analytics'],
    enabled: !!selected,
    queryFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('analytics'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!resp.ok) return null;
      return resp.json();
    },
  });

  const orgPlatforms = (platformsData?.platforms ?? []).filter(
    (p: { org_id?: number | string; organization_id?: number | string }) =>
      String(p.org_id ?? p.organization_id ?? '') === String(selected?.id ?? ''),
  );
  const analytics = analyticsData?.data ?? analyticsData;

  const suspendMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}enterprise/admin/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ isActive: is_active }),
      });
      if (!resp.ok) throw new Error('Failed to update status');
      return resp.json();
    },
    onSuccess: () => { refetch(); toast({ title: 'Status updated' }); },
    onError: (err: Error) => toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  });

  // API returns { success, data: { tenants: [...] } } — handle all possible shapes safely
  const _rawList = data?.data?.orgs ?? data?.data?.tenants ?? data?.data?.organizations ?? data?.organizations ?? data?.tenants ?? (Array.isArray(data) ? data : []);
  const orgs: Organisation[] = (Array.isArray(_rawList) ? _rawList : []).filter((o: Organisation) => {
    if (!o || typeof o !== 'object') return false;
    const matchSearch = !search || (o.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchTier = tierFilter === 'all' || o.tier === tierFilter;
    return matchSearch && matchTier;
  });

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="Super Admin Organisation Management">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-indigo-900">
              <Building2 className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">Organisation Management</h1>
            <Badge className="bg-red-50 text-red-700 border-red-200 text-xs">Super Admin</Badge>
          </div>
          <p className="text-sm text-slate-600">Onboard, configure, and manage all Jurexio subscriber organisations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => refetch()} variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-100" aria-label="Refresh organisation list">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </Button>
          <CreateOrgModal onCreated={() => refetch()} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Orgs', value: data?.data?.stats?.total ?? data?.data?.total ?? orgs.length, icon: Building2, color: 'text-blue-400' },
          { label: 'Active', value: data?.data?.stats?.active ?? data?.data?.active ?? orgs.filter((o: Organisation) => orgActive(o)).length, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Enterprise', value: orgs.filter((o: Organisation) => o.tier === 'enterprise').length, icon: Star, color: 'text-purple-400' },
          { label: 'Government', value: orgs.filter((o: Organisation) => o.tier === 'government').length, icon: Shield, color: 'text-red-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white border-slate-200" aria-label={`${label}: ${value}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={cn('w-7 h-7', color)} aria-hidden="true" />
              <div>
                <p className="text-2xl font-bold text-[#152448]">{value}</p>
                <p className="text-xs text-slate-600">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Left: List */}
        <div className="space-y-3">
          {/* Search + Filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search orgs..."
                className="pl-8 bg-white border-slate-300 text-[#1A3A60] text-xs"
                aria-label="Search organisations"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-28 bg-white border-slate-300 text-[#1A3A60] text-xs" aria-label="Filter by tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="solo">Solo</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="government">Government</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isLoading && (
            <div className="space-y-2" data-testid="loading-organisations">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {!isLoading && isError && (
            <JrxErrorState
              title="Unable to load organisations"
              description="The organisation list could not be retrieved."
              onRetry={() => refetch()}
              variant="card"
            />
          )}
          {!isLoading && !isError && orgs.length === 0 && (
            <JrxEmptyState icon={Building2} title="No organisations found" description="Try adjusting filters or invite a new organisation." />
          )}
          <div className="space-y-2" role="list" aria-label="Organisation list">
            {orgs.map(org => (
              <div key={org.id} role="listitem">
                <OrgRow org={org} onSelect={setSelected} isSelected={selected?.id === org.id} />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Detail */}
        <div className="md:col-span-2">
          {!selected ? (
            <Card className="bg-white border-slate-200 h-full flex items-center justify-center">
              <CardContent className="text-center py-12">
                <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-3" aria-hidden="true" />
                <p className="text-slate-600 text-sm">Select an organisation to view details</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-slate-900 text-base">{selected.name}</CardTitle>
                    <p className="text-xs text-slate-700 mt-0.5">{selected.description ?? 'No description'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cn('text-xs', TIER_COLORS[selected.tier] ?? TIER_COLORS.pro)} aria-label={`Tier: ${selected.tier}`}>{selected.tier}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn('text-xs border', orgActive(selected) ? 'border-red-200 text-red-400 hover:bg-red-500/10' : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10')}
                      onClick={() => suspendMutation.mutate({ id: selected.id, is_active: !orgActive(selected) })}
                      aria-label={orgActive(selected) ? 'Suspend organisation' : 'Reactivate organisation'}
                    >
                      <Power className="w-3 h-3 mr-1" aria-hidden="true" />
                      {orgActive(selected) ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <Tabs defaultValue="details">
                  <TabsList className="bg-slate-100 mb-4">
                    <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                    <TabsTrigger value="platforms" className="text-xs">Platforms</TabsTrigger>
                    <TabsTrigger value="billing" className="text-xs">Billing</TabsTrigger>
                  </TabsList>
                  <TabsContent value="details">
                    <div className="space-y-2 text-xs">
                      {[
                        { label: 'Organisation ID', value: String(selected.id) },
                        { label: 'Plan', value: selected.plan ?? selected.tier },
                        { label: 'Status', value: orgActive(selected) ? 'Active' : 'Suspended' },
                        { label: 'Max Members', value: String(orgMaxMembers(selected)) },
                        { label: 'Member Count', value: String(orgMembers(selected)) },
                        { label: 'Platforms', value: String(selected.platform_count ?? 0) },
                        { label: 'Created', value: orgCreatedAt(selected) ? new Date(orgCreatedAt(selected)!).toLocaleDateString('en-IN') : '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-200/50">
                          <span className="text-slate-700">{label}</span>
                          <span className="text-slate-900 font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="platforms">
                    {platformsLoading ? (
                      <p className="text-center py-8 text-slate-600 text-sm">Loading platforms…</p>
                    ) : orgPlatforms.length === 0 ? (
                      <JrxEmptyState title="No platforms" description="No platform apps are registered for this organisation yet." />
                    ) : (
                      <div className="space-y-2">
                        {orgPlatforms.map((p: { id: string; display_name?: string; name?: string; platform_type?: string; tier?: string; is_active?: boolean }) => (
                          <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-200 text-xs">
                            <div>
                              <p className="font-medium text-slate-900">{p.display_name ?? p.name ?? p.platform_type}</p>
                              <p className="text-slate-600">{p.platform_type ?? p.id} · {p.tier ?? '—'}</p>
                            </div>
                            <Badge variant={p.is_active === false ? 'secondary' : 'default'}>
                              {p.is_active === false ? 'inactive' : 'active'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="billing">
                    <div className="space-y-2 text-xs">
                      {[
                        { label: 'Monthly Spend', value: selected.monthly_spend_usd ? `$${selected.monthly_spend_usd.toFixed(2)}` : (analytics?.totalCostUsd ? `$${Number(analytics.totalCostUsd).toFixed(2)}` : 'Not tracked yet') },
                        { label: 'Billing Tier', value: selected.tier },
                        { label: '30d API Calls', value: analyticsLoading ? 'Loading…' : (analytics?.totalRequests != null ? Number(analytics.totalRequests).toLocaleString('en-IN') : 'Not tracked yet') },
                        { label: '30d Tokens', value: analytics?.totalTokens != null ? Number(analytics.totalTokens).toLocaleString('en-IN') : 'Not tracked yet' },
                        { label: 'Est. 30d Cost', value: analytics?.totalCostUsd != null ? `$${Number(analytics.totalCostUsd).toFixed(2)}` : 'Not tracked yet' },
                        { label: 'Data source', value: analytics ? 'GET /api/jrx/analytics (platform-wide)' : 'No telemetry in this environment' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-200">
                          <span className="text-[#4A6A90]">{label}</span>
                          <span className="text-[#1A3A60] font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
