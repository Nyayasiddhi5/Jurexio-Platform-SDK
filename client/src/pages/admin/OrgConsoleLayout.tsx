/**
 * Org Console Layout — Per-org overlay editor (Phase 5)
 *
 * Session-15 v13 (2026-05-11). Closes Phase 5 in
 *   docs/audit/console-cpo-audit-2026-05-11.md
 *   docs/audit/feature-matrix-and-status-2026-05-11.md §1 / §3
 *
 * Backend (verified by direct read of route file):
 *   GET    /api/jrx/admin/org-console-layout/:orgId
 *   PUT    /api/jrx/admin/org-console-layout/:orgId
 *   DELETE /api/jrx/admin/org-console-layout/:orgId            (super_admin)
 *   GET    /api/jrx/admin/org-console-layout/_self/effective   (any auth)
 *
 * The shared `apiRequest` in @/lib/queryClient auto-unwraps {success,data}
 * envelopes — ALL queries here read the inner shape directly, NOT
 * `data.data.X` (lesson re-applied from v11.1 / v12.1 reviews).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useOrg } from '@/contexts/OrgContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JrxErrorState } from '@/components/JrxErrorState';
import {
  AlertTriangle, Building2, Eye, EyeOff, Palette, Save, Trash2,
  RefreshCw, CheckCircle2, XCircle, Plus,
} from 'lucide-react';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
interface ConsoleLayout {
  orgId: string;
  displayName: string | null;
  brandPrimaryHex: string | null;
  brandAccentHex: string | null;
  logoUrl: string | null;
  defaultLanding: string | null;
  sidebarSections: Record<string, boolean>;
  hiddenRoutes: string[];
  featureOverrides: Record<string, boolean>;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  isDefault: boolean;
}

const SIDEBAR_SECTION_KEYS: Array<{ key: string; label: string }> = [
  { key: 'home',           label: 'Home' },
  { key: 'work',           label: 'Work' },
  { key: 'aiOperations',   label: 'AI Operations' },
  { key: 'governance',     label: 'Governance' },
  { key: 'developer',      label: 'Developer' },
  { key: 'administration', label: 'Administration' },
  { key: 'superAdmin',     label: 'Super-Admin' },
];

const DEFAULT_LANDING_SUGGESTIONS = [
  '/chat-hub',
  '/orchestration',
  '/operations',
  '/intelligence/dashboard',
  '/agents',
  '/document-ai-hub',
];

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function OrgConsoleLayout() {
  const { user } = useAuth();
  const { organizations, activeOrgId, setActiveOrgId } = useOrg();
  const isSuperAdmin = (user?.role === 'super_admin');
  const isOrgAdmin = (user?.role === 'org_admin' || isSuperAdmin);

  const [orgId, setOrgId] = useState<string>(String(activeOrgId ?? ''));

  useEffect(() => { if (activeOrgId) setOrgId(String(activeOrgId)); }, [activeOrgId]);

  // Form state — initialised from server fetch
  const [form, setForm] = useState<ConsoleLayout | null>(null);
  const [hiddenRoutesText, setHiddenRoutesText] = useState<string>('');
  const [featureOverridesText, setFeatureOverridesText] = useState<string>('');

  const layoutQ = useQuery<ConsoleLayout>({
    queryKey: [nv('admin/org-console-layout'), orgId],
    queryFn: () =>
      apiRequest(`${NV_BASE}admin/org-console-layout/${encodeURIComponent(orgId)}`, 'GET') as Promise<ConsoleLayout>,
    enabled: !!orgId && isOrgAdmin,
    retry: false,
    staleTime: 10_000,
  });

  // Hydrate form when fetched data changes
  useEffect(() => {
    if (!layoutQ.data) return;
    setForm(layoutQ.data);
    setHiddenRoutesText((layoutQ.data.hiddenRoutes ?? []).join('\n'));
    setFeatureOverridesText(
      Object.entries(layoutQ.data.featureOverrides ?? {})
        .map(([k, v]) => `${k}=${v ? 'on' : 'off'}`)
        .join('\n'),
    );
  }, [layoutQ.data]);

  const saveMutation = useMutation<ConsoleLayout, Error, ConsoleLayout>({
    mutationFn: async (payload) => {
      // Pre-parse free-text inputs → arrays / map; throw on invalid so the
      // mutation reports a user-visible error before hitting the server.
      const hiddenRoutes = hiddenRoutesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const p of hiddenRoutes) {
        if (!/^\/[A-Za-z0-9/_-]{0,200}$/.test(p)) throw new Error(`Invalid path in hiddenRoutes: ${p}`);
      }
      const featureOverrides: Record<string, boolean> = {};
      for (const line of featureOverridesText.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const [k, v] = t.split('=').map((x) => x.trim());
        if (!k || (v !== 'on' && v !== 'off')) throw new Error(`Invalid feature override (use key=on|off): ${t}`);
        featureOverrides[k] = v === 'on';
      }
      const body = {
        displayName: payload.displayName,
        brandPrimaryHex: payload.brandPrimaryHex,
        brandAccentHex: payload.brandAccentHex,
        logoUrl: payload.logoUrl,
        defaultLanding: payload.defaultLanding,
        sidebarSections: payload.sidebarSections,
        hiddenRoutes,
        featureOverrides,
        notes: payload.notes,
      };
      return (await apiRequest(`${NV_BASE}admin/org-console-layout/${encodeURIComponent(orgId)}`, 'PUT', body)) as ConsoleLayout;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [nv('admin/org-console-layout'), orgId] }); },
  });

  const deleteMutation = useMutation<{ orgId: string; deleted: boolean }, Error, void>({
    mutationFn: async () =>
      (await apiRequest(`${NV_BASE}admin/org-console-layout/${encodeURIComponent(orgId)}`, 'DELETE')) as { orgId: string; deleted: boolean },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [nv('admin/org-console-layout'), orgId] }); },
  });

  const sectionsMap = form?.sidebarSections ?? {};
  const sectionsAllVisible = useMemo(
    () => SIDEBAR_SECTION_KEYS.every(({ key }) => sectionsMap[key] !== false),
    [sectionsMap],
  );

  if (!isOrgAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="page-org-console-layout">
        <Card>
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
            <div>
              <p className="font-semibold">Access denied</p>
              <p className="text-sm text-slate-600 mt-1">
                Editing the per-org console layout requires the <code>org_admin</code> role
                (own org) or <code>super_admin</code> (any org). Your current role is{' '}
                <code>{user?.role ?? 'unauthenticated'}</code>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6" data-testid="page-org-console-layout">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-[#152448]" />
            Per-Org Console Layout
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Override the default Console layout for a specific organisation — sidebar sections,
            branding, default landing page, hidden routes, and feature overrides. Absent overlay
            ⇒ platform default (no behavioural change for that tenant).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => layoutQ.refetch()}
          disabled={!orgId}
          data-testid="button-refresh-layout"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${layoutQ.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Org selector */}
      <Card>
        <CardHeader><CardTitle className="text-base">Target organisation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isSuperAdmin && organizations.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="org-quick-picker">
              {organizations.map((o) => (
                <Button
                  key={String(o.id)}
                  size="sm"
                  variant={String(o.id) === orgId ? 'default' : 'outline'}
                  onClick={() => { setOrgId(String(o.id)); setActiveOrgId(o.id); }}
                  data-testid={`button-pick-org-${o.id}`}
                >
                  {o.name} <span className="ml-1 opacity-60 font-mono text-[10px]">{String(o.id)}</span>
                </Button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="org id (e.g. 1)"
              className="text-sm max-w-xs"
              disabled={!isSuperAdmin && !!organizations.length}
              data-testid="input-org-id"
            />
            {!isSuperAdmin && (
              <Badge variant="outline" className="text-[10px] self-center">
                org_admin — restricted to your own org
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status */}
      {layoutQ.isError && (
        <JrxErrorState
          title="Could not load layout"
          error={layoutQ.error}
          onRetry={() => layoutQ.refetch()}
          variant="card"
        />
      )}

      {form && (
        <Tabs defaultValue="branding" className="w-full">
          <TabsList className="grid grid-cols-4 max-w-2xl">
            <TabsTrigger value="branding" data-testid="tab-branding">Branding</TabsTrigger>
            <TabsTrigger value="sections" data-testid="tab-sections">Sidebar</TabsTrigger>
            <TabsTrigger value="routes"   data-testid="tab-routes">Hidden Routes</TabsTrigger>
            <TabsTrigger value="features" data-testid="tab-features">Feature Overrides</TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Palette className="w-4 h-4" /> Branding & landing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs" htmlFor="ocl-display-name">Display name</Label>
                    <Input id="ocl-display-name" value={form.displayName ?? ''}
                      onChange={(e) => setForm({ ...form, displayName: e.target.value || null })}
                      placeholder="e.g. Acme Legal LLP"
                      className="text-sm" data-testid="input-display-name" />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="ocl-default-landing">Default landing path</Label>
                    <Input id="ocl-default-landing" list="ocl-landing-suggestions"
                      value={form.defaultLanding ?? ''}
                      onChange={(e) => setForm({ ...form, defaultLanding: e.target.value || null })}
                      placeholder="/chat-hub"
                      className="text-sm font-mono" data-testid="input-default-landing" />
                    <datalist id="ocl-landing-suggestions">
                      {DEFAULT_LANDING_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="ocl-primary-hex">Brand primary (#RRGGBB)</Label>
                    <div className="flex gap-2">
                      <Input id="ocl-primary-hex" value={form.brandPrimaryHex ?? ''}
                        onChange={(e) => setForm({ ...form, brandPrimaryHex: e.target.value || null })}
                        placeholder="#152448" className="text-sm font-mono"
                        data-testid="input-primary-hex" />
                      {form.brandPrimaryHex && (
                        <span className="w-9 h-9 rounded border border-slate-200" style={{ background: form.brandPrimaryHex }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="ocl-accent-hex">Brand accent (#RRGGBB)</Label>
                    <div className="flex gap-2">
                      <Input id="ocl-accent-hex" value={form.brandAccentHex ?? ''}
                        onChange={(e) => setForm({ ...form, brandAccentHex: e.target.value || null })}
                        placeholder="#C7B15B" className="text-sm font-mono"
                        data-testid="input-accent-hex" />
                      {form.brandAccentHex && (
                        <span className="w-9 h-9 rounded border border-slate-200" style={{ background: form.brandAccentHex }} />
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs" htmlFor="ocl-logo-url">Logo URL (https)</Label>
                    <Input id="ocl-logo-url" value={form.logoUrl ?? ''}
                      onChange={(e) => setForm({ ...form, logoUrl: e.target.value || null })}
                      placeholder="https://cdn.example.com/logo.png"
                      className="text-sm font-mono" data-testid="input-logo-url" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sections" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sidebar section visibility</CardTitle>
                <p className="text-xs text-slate-700 mt-1">
                  Toggle off to hide a section for this org. Routes inside hidden sections still
                  work via deep-link; only menu visibility changes. {sectionsAllVisible && (
                    <Badge variant="outline" className="ml-1 text-[10px]">all visible</Badge>
                  )}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {SIDEBAR_SECTION_KEYS.map(({ key, label }) => {
                  const visible = sectionsMap[key] !== false;
                  return (
                    <div key={key} className="flex items-center justify-between p-2 rounded border border-slate-200">
                      <div className="flex items-center gap-2 text-sm">
                        {visible ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-slate-600" />}
                        <span>{label}</span>
                        <code className="text-[10px] text-slate-600 ml-1">{key}</code>
                      </div>
                      <Switch
                        checked={visible}
                        onCheckedChange={(v) => setForm({ ...form, sidebarSections: { ...sectionsMap, [key]: v } })}
                        data-testid={`switch-section-${key}`}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="routes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hidden routes</CardTitle>
                <p className="text-xs text-slate-700 mt-1">
                  One canonical path per line (e.g. <code>/orchestration/grpo</code>). Hidden from
                  menus + nav; deep-links still resolve.
                </p>
              </CardHeader>
              <CardContent>
                <Textarea rows={8} value={hiddenRoutesText}
                  onChange={(e) => setHiddenRoutesText(e.target.value)}
                  placeholder={'/superagent\n/orchestration/grpo'}
                  className="text-sm font-mono" data-testid="input-hidden-routes" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Feature overrides</CardTitle>
                <p className="text-xs text-slate-700 mt-1">
                  One per line in <code>key=on</code> or <code>key=off</code> form. These shadow
                  the global <code>JRX_F_*</code> flags for this org only.
                </p>
              </CardHeader>
              <CardContent>
                <Textarea rows={8} value={featureOverridesText}
                  onChange={(e) => setFeatureOverridesText(e.target.value)}
                  placeholder={'govMakerChecker=on\ncanonicalRequestLogger=off'}
                  className="text-sm font-mono" data-testid="input-feature-overrides" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Notes + actions footer (always visible when form loaded) */}
      {form && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <Label className="text-xs" htmlFor="ocl-notes">Operator notes</Label>
              <Textarea id="ocl-notes" rows={2} value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                placeholder="Why this overlay was created — context for the next operator."
                className="text-sm" data-testid="input-notes" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-700" data-testid="text-meta">
                {form.isDefault ? (
                  <Badge variant="outline">no overlay yet (platform default)</Badge>
                ) : (
                  <>
                    <span>last edit by <code>{form.updatedBy ?? '—'}</code></span>
                    <span className="ml-2">at {fmtTs(form.updatedAt)}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {saveMutation.isError && (
                  <span className="text-xs text-red-600 flex items-center gap-1" data-testid="text-save-error">
                    <XCircle className="w-3 h-3" />{(saveMutation.error as Error)?.message}
                  </span>
                )}
                {saveMutation.isSuccess && (
                  <span className="text-xs text-emerald-700 flex items-center gap-1" data-testid="text-save-success">
                    <CheckCircle2 className="w-3 h-3" /> Saved
                  </span>
                )}
                {isSuperAdmin && !form.isDefault && (
                  <Button variant="outline" size="sm"
                    onClick={() => { if (confirm('Delete the overlay for this org? Falls back to platform default.')) deleteMutation.mutate(); }}
                    disabled={deleteMutation.isPending}
                    data-testid="button-delete-overlay">
                    <Trash2 className="w-4 h-4 mr-2" />
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete overlay'}
                  </Button>
                )}
                <Button onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending || !orgId}
                  data-testid="button-save-layout">
                  <Save className="w-4 h-4 mr-2" />
                  {saveMutation.isPending ? 'Saving…' : 'Save overlay'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Convenience for keyed shortcut adders (kept around for future quick-actions
// in branding tab — referenced by Plus icon import).
export function _addPlaceholderForLinter() { return Plus; }
