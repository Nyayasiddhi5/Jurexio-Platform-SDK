import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
import { useLocation } from 'wouter';
import PlatformLimitsPanel from '@/components/admin/PlatformLimitsPanel';
/**
 * Jurexio Super Admin — Platform Registry
 * Manages all 5 Jurexio ecosystem platforms.
 * Live-wired to /api/jrx/platforms
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Globe, Plus, RefreshCw, Settings, Key, Shield, BarChart3,
  CheckCircle2, AlertTriangle, XCircle, Cpu, Users, Layers,
  ChevronRight, Activity, Zap, Lock, Edit2, Power, Eye,
  Building2, Star, Sparkles, Bot, DollarSign, Clock,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { listLegalLastRuns } from '@/services/jrx-legal-last-runs';
import { Link } from 'wouter';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Platform {
  id: string;
  name: string;
  display_name: string;
  platform_type: string;
  tier: string;
  status: string;
  is_active: boolean;
  is_provisioned: boolean;
  environment: string;
  jurisdiction: string;
  jurisdictions: string[];
  modules_enabled: Record<string, boolean>;
  agents_allowed: string[];
  llm_config: Record<string, unknown>;
  rate_limits_config: Record<string, unknown>;
  contact_email: string | null;
  active_key_count?: number;
  usage_30d?: { request_count: number; total_tokens: number; total_cost_usd: number };
  created_at: string;
  updated_at: string;
}

// ─── Platform Type Labels ─────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { color: string; icon: string; badge: string }> = {
  'jurexio-citizen':                 { color: 'text-emerald-400', icon: '🏛️', badge: 'bg-emerald-500/20 text-emerald-700 border-emerald-200' },
  'nyayasiddhi-professional':   { color: 'text-blue-400',    icon: '⚖️', badge: 'bg-blue-500/20 text-blue-700 border-blue-200' },
  'nyayasiddhi-institution':    { color: 'text-purple-400',  icon: '🏢', badge: 'bg-purple-500/20 text-purple-700 border-purple-200' },
  'nyayasiddhi-ministry':       { color: 'text-red-400',     icon: '🏛', badge: 'bg-red-500/20 text-red-700 border-red-200' },
  'nyayasiddhi-academy':        { color: 'text-amber-400',   icon: '🎓', badge: 'bg-amber-500/20 text-amber-700 border-amber-200' },
  'custom':                     { color: 'text-slate-600',   icon: '🔧', badge: 'bg-slate-500/20 text-slate-700 border-slate-500/30' },
};

const MODULE_LABELS: Record<string, string> = {
  clawdbot: 'ClaWdBot™', openbot: 'OpenBot™', automateai: 'AutomateAI™',
  twindesk: 'TwinDesk™', skillshop: 'SkillShop™', nyayarag: 'NyayaRAG™',
  doc_intelligence: 'DocIntelligence™', voice_ai: 'VoiceAI™',
  hitl: 'HITL™', sdk_intelligence: 'SDK Intelligence™',
};

// ─── Platform Card ────────────────────────────────────────────────────────────

function PlatformCard({ platform, onSelect, isSelected }: { platform: Platform; onSelect: (p: Platform) => void; isSelected: boolean }) {
  const meta = PLATFORM_META[platform.platform_type] ?? PLATFORM_META.custom;
  const enabledModules = Object.entries(platform.modules_enabled ?? {}).filter(([, v]) => v).length;
  const totalModules = Object.keys(platform.modules_enabled ?? {}).length;

  return (
    <Card
      className={cn('cursor-pointer transition-all duration-150 hover:border-slate-300 bg-white', isSelected ? 'border-[#152448] ring-1 ring-[#152448]' : 'border-slate-200/50')}
      onClick={() => onSelect(platform)}
      role="button"
      tabIndex={0}
      aria-label={`Platform: ${platform.display_name}`}
      aria-selected={isSelected}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(platform); }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl" role="img" aria-label={platform.platform_type}>{meta.icon}</span>
            <div>
              <p className="font-semibold text-[#1A3A60] text-sm">{platform.display_name}</p>
              <Badge className={cn('text-[10px] mt-0.5', meta.badge)} aria-label={`Platform type: ${platform.platform_type}`}>{platform.platform_type}</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              className={cn('text-[10px]', platform.is_active ? 'bg-emerald-500/20 text-emerald-700 border-emerald-200' : 'bg-slate-500/20 text-slate-600 border-slate-300')}
              aria-label={`Status: ${platform.is_active ? 'Active' : 'Inactive'}`}
            >
              {platform.is_active ? 'Active' : 'Inactive'}
            </Badge>
            {platform.is_provisioned && (
              <Badge className="text-[10px] bg-blue-500/20 text-blue-700 border-blue-200" aria-label="Provisioned">Provisioned</Badge>
            )}
          </div>
        </div>
        <div className="space-y-2 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1"><Layers className="w-3 h-3" aria-hidden="true" />Modules</span>
            <span className="text-[#1A3A60] font-medium">{enabledModules}/{totalModules} enabled</span>
          </div>
          <Progress value={totalModules > 0 ? (enabledModules / totalModules) * 100 : 0} className="h-1" aria-label={`${enabledModules} of ${totalModules} modules enabled`} />
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1"><Key className="w-3 h-3" aria-hidden="true" />Active Keys</span>
            <span className="text-[#1A3A60] font-medium">{platform.active_key_count ?? 0}</span>
          </div>
          {platform.usage_30d && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" aria-hidden="true" />Requests (30d)</span>
              <span className="text-[#1A3A60] font-medium">{(platform.usage_30d.request_count ?? 0).toLocaleString()}</span>
            </div>
          )}
          <div className="flex items-center gap-1 flex-wrap pt-1">
            {(platform.jurisdictions ?? ['IN']).map(j => (
              <span key={j} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[9px] font-mono" aria-label={`Jurisdiction: ${j}`}>{j}</span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Create Platform Modal ────────────────────────────────────────────────────

function CreatePlatformModal({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', platform_type: 'custom', tier: 'pro', environment: 'sandbox', contact_email: '' });

  const createMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('platforms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(form),
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error ?? 'Failed'); }
      return resp.json();
    },
    onSuccess: (data) => {
      toast({ title: 'Platform registered', description: `${data.display_name ?? data.name} added to registry` });
      setOpen(false);
      onCreated();
    },
    onError: (err: Error) => toast({ title: 'Registration failed', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#152448] hover:bg-[#0a3580] text-white" aria-label="Register new platform">
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Register Platform
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white border-slate-200 max-w-md" aria-label="Register new platform">
        <DialogHeader>
          <DialogTitle className="text-[#152448]">Register New Platform</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="platform-name">Platform Name</Label>
            <Input id="platform-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. My Legal Platform" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Platform name" />
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="platform-type">Platform Type</Label>
            <Select value={form.platform_type} onValueChange={v => setForm(f => ({ ...f, platform_type: v }))}>
              <SelectTrigger id="platform-type" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select platform type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-100 border-slate-200">
                <SelectItem value="jurexio-citizen">Jurexio Citizen</SelectItem>
                <SelectItem value="nyayasiddhi-professional">Jurexio Professional™</SelectItem>
                <SelectItem value="nyayasiddhi-institution">Jurexio Institution™</SelectItem>
                <SelectItem value="nyayasiddhi-ministry">Jurexio Ministry™</SelectItem>
                <SelectItem value="nyayasiddhi-academy">Jurexio Academy™</SelectItem>
                <SelectItem value="custom">Custom Platform</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="platform-tier">Tier</Label>
            <Select value={form.tier} onValueChange={v => setForm(f => ({ ...f, tier: v }))}>
              <SelectTrigger id="platform-tier" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-100 border-slate-200">
                <SelectItem value="solo">Solo</SelectItem>
                <SelectItem value="plus">Plus</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="government">Government</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="platform-env">Environment</Label>
            <Select value={form.environment} onValueChange={v => setForm(f => ({ ...f, environment: v }))}>
              <SelectTrigger id="platform-env" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-100 border-slate-200">
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-700 text-xs" htmlFor="contact-email">Contact Email</Label>
            <Input id="contact-email" type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} placeholder="admin@example.com" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Contact email" />
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} className="w-full bg-[#152448] hover:bg-[#0a3580] text-white" aria-label="Submit platform registration">
            {createMutation.isPending ? 'Registering...' : 'Register Platform'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SuperAdminPlatformRegistry() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [selected, setSelected] = useState<Platform | null>(null);
  const tabFromUrl = new URLSearchParams(location.split('?')[1] || '').get('tab') ?? 'overview';
  const [activeTab, setActiveTab] = useState(tabFromUrl === 'limits' ? 'limits' : 'overview');

  useEffect(() => {
    const t = new URLSearchParams(location.split('?')[1] || '').get('tab');
    if (t === 'limits') setActiveTab('limits');
    else if (t && ['overview', 'modules', 'llm', 'limits', 'usage'].includes(t)) setActiveTab(t);
  }, [location]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['platforms'],
    queryFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('platforms'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`Unable to retrieve platforms (HTTP ${resp.status})`);
      return resp.json();
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}platforms/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ is_active }),
      });
      if (!resp.ok) throw new Error('Failed to update status');
      return resp.json();
    },
    onSuccess: () => { refetch(); toast({ title: 'Status updated' }); },
    onError: (err: Error) => toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  });

  const updateModulesMutation = useMutation({
    mutationFn: async ({ id, modules }: { id: string; modules: Record<string, boolean> }) => {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}platforms/${id}/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(modules),
      });
      if (!resp.ok) throw new Error('Failed to update modules');
      return resp.json();
    },
    onSuccess: () => { refetch(); if (selected) refetch(); toast({ title: 'Modules updated' }); },
    onError: (err: Error) => toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  });

  const platforms: Platform[] = data?.platforms ?? [];
  const totalActive = platforms.filter(p => p.is_active).length;
  const totalProvisioned = platforms.filter(p => p.is_provisioned).length;

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6 jrx-light-scope" aria-label="Super Admin Platform Registry">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-blue-900">
              <Globe className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">Platform Registry</h1>
            <Badge className="bg-red-500/20 text-red-700 border-red-200 text-xs">Super Admin</Badge>
          </div>
          <p className="text-sm text-slate-600">Manage all Jurexio ecosystem platforms — agents, modules, LLM routing, SDK keys</p>
          <p className="text-xs text-slate-500 mt-1">
            Cost &amp; limits:{' '}
            <Link href="/platform-config"><span className="underline text-[#152448]">open Platform Management</span></Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => refetch()} variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-100" aria-label="Refresh platform list">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </Button>
          <CreatePlatformModal onCreated={() => refetch()} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Platforms', value: platforms.length, icon: Globe, color: 'text-blue-400' },
          { label: 'Active', value: totalActive, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Provisioned', value: totalProvisioned, icon: Zap, color: 'text-purple-400' },
          { label: 'Production', value: platforms.filter(p => p.environment === 'production').length, icon: Shield, color: 'text-amber-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white border-slate-200/50" aria-label={`${label}: ${value}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={cn('w-8 h-8', color)} aria-hidden="true" />
              <div>
                <p className="text-2xl font-bold text-[#152448]">{value}</p>
                <p className="text-xs text-slate-600">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-white border-slate-200/50 mb-6" data-testid="legal-last-runs">
        <CardHeader className="py-3">
          <CardTitle className="text-sm text-[#152448]">Last Legal runs (this session)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {listLegalLastRuns().length === 0 ? (
            <p className="text-xs text-slate-500">Runs from Legal Chat, Live Testing, and Orch Hub appear here.</p>
          ) : (
            <ul className="text-xs space-y-1">
              {listLegalLastRuns().map((run) => (
                <li key={run.requestId} className="flex justify-between gap-2">
                  <Link href={`/orchestration/lineage/${encodeURIComponent(run.requestId)}`}>
                    <span className="underline font-mono">{run.requestId}</span>
                  </Link>
                  <span className="text-slate-500">{run.source}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Platform List */}
        <div className="space-y-2" role="list" aria-label="Registered platforms">
          {isLoading && (
            <div className="space-y-2" data-testid="loading-platforms">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {!isLoading && isError && (
            <JrxErrorState
              title="Unable to load platforms"
              description="The platform registry could not be retrieved."
              onRetry={() => refetch()}
              variant="card"
            />
          )}
          {!isLoading && !isError && platforms.length === 0 && (
            <JrxEmptyState
              icon={Globe}
              title="No platforms registered"
              description={'Click "Register Platform" to add the first one.'}
              variant="card"
            />
          )}
          {platforms.map(p => (
            <div key={p.id} role="listitem">
              <PlatformCard platform={p} onSelect={setSelected} isSelected={selected?.id === p.id} />
            </div>
          ))}
        </div>

        {/* Platform Detail */}
        <div className="md:col-span-2">
          {!selected ? (
            <Card className="bg-white border-slate-200/50 h-full flex items-center justify-center">
              <CardContent className="text-center py-12">
                <Globe className="w-10 h-10 text-slate-600 mx-auto mb-3" aria-hidden="true" />
                <p className="text-slate-600 text-sm">Select a platform to configure</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white border-slate-200/50">
              <CardHeader className="pb-3 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl" role="img" aria-label={selected.platform_type}>{PLATFORM_META[selected.platform_type]?.icon ?? '🔧'}</span>
                    <div>
                      <CardTitle className="text-[#152448] text-base">{selected.display_name}</CardTitle>
                      <p className="text-xs text-slate-600">{selected.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span>Active</span>
                      <Switch
                        checked={selected.is_active}
                        onCheckedChange={(v) => toggleStatusMutation.mutate({ id: selected.id, is_active: v })}
                        aria-label={`Toggle platform active status: currently ${selected.is_active ? 'active' : 'inactive'}`}
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setLocation(`/superadmin/platforms?tab=${v}`, { replace: true }); }}>
                  <TabsList className="bg-slate-100 mb-4">
                    <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                    <TabsTrigger value="modules" className="text-xs">Modules</TabsTrigger>
                    <TabsTrigger value="llm" className="text-xs">LLM Config</TabsTrigger>
                    <TabsTrigger value="limits" className="text-xs">Rate Limits</TabsTrigger>
                    <TabsTrigger value="usage" className="text-xs">Usage</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview">
                    <div className="space-y-3 text-xs">
                      {[
                        { label: 'Platform Type', value: selected.platform_type },
                        { label: 'Tier', value: selected.tier },
                        { label: 'Environment', value: selected.environment },
                        { label: 'Provisioned', value: selected.is_provisioned ? 'Yes' : 'No' },
                        { label: 'Active SDK Keys', value: String(selected.active_key_count ?? 0) },
                        { label: 'Contact', value: selected.contact_email ?? '—' },
                        { label: 'Jurisdictions', value: (selected.jurisdictions ?? ['IN']).join(', ') },
                        { label: 'Agents Allowed', value: (selected.agents_allowed ?? ['*']).includes('*') ? 'All registered agents' : `${selected.agents_allowed?.length ?? 0} agents` },
                        { label: 'Created', value: new Date(selected.created_at).toLocaleDateString() },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-200/50">
                          <span className="text-slate-600">{label}</span>
                          <span className="text-[#1A3A60] font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="modules">
                    <div className="space-y-2">
                      {Object.entries(MODULE_LABELS).map(([key, label]) => {
                        const enabled = (selected.modules_enabled ?? {})[key] ?? false;
                        return (
                          <div key={key} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-100/50 text-xs">
                            <div>
                              <p className="font-medium text-slate-800">{label}</p>
                              <p className="text-slate-700 text-[10px]">Module key: {key}</p>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(v) => updateModulesMutation.mutate({ id: selected.id, modules: { [key]: v } })}
                              aria-label={`Toggle ${label}: currently ${enabled ? 'enabled' : 'disabled'}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </TabsContent>

                  <TabsContent value="llm">
                    <div className="space-y-3 text-xs">
                      {Object.entries(selected.llm_config ?? {}).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between py-1.5 border-b border-slate-200/50">
                          <span className="text-slate-600">{key.replace(/_/g, ' ')}</span>
                          <span className="text-[#152448] font-mono">{String(val)}</span>
                        </div>
                      ))}
                      {!Object.keys(selected.llm_config ?? {}).length && (
                        <JrxEmptyState title="No LLM config set" description="This platform is using platform defaults." size="sm" />
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="limits">
                    <PlatformLimitsPanel
                      platformId={selected.id}
                      platformName={selected.display_name}
                      initialLimits={selected.rate_limits_config ?? {}}
                      onSaved={() => refetch()}
                    />
                  </TabsContent>

                  <TabsContent value="usage">
                    {selected.usage_30d ? (
                      <div className="space-y-3 text-xs">
                        {[
                          { label: 'Requests (30d)', value: (selected.usage_30d.request_count ?? 0).toLocaleString() },
                          { label: 'Total Tokens (30d)', value: (selected.usage_30d.total_tokens ?? 0).toLocaleString() },
                          { label: 'Total Cost (30d)', value: `$${Number(selected.usage_30d.total_cost_usd ?? 0).toFixed(4)}` },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-200/50">
                            <span className="text-slate-600">{label}</span>
                            <span className="text-[#1A3A60] font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <JrxEmptyState title="No usage data available yet" description="30-day usage metrics will appear here once requests have been made." size="sm" />
                    )}
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
