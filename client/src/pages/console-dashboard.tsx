/**
 * ConsoleDashboard — Jurexio Console landing page (task-158, 2026-05-12)
 *
 * Replaces the previous "log straight into a hub" experience with a proper
 * landing page summarising:
 *   - System health (gateway + LLM providers + self-healing)
 *   - Active agents (count + jurisdiction breakdown)
 *   - Pending HITL approvals
 *   - Recent activity (org-scoped ring buffer)
 *   - Quick actions (chat / docs / orchestrate / sdk hub)
 *
 * All data comes from existing /api/jrx/* endpoints — no new server work:
 *   GET /api/jrx/health
 *   GET /api/jrx/healing/health
 *   GET /api/jrx/registry/agents?limit=1
 *   GET /api/jrx/hitl/stats
 *   GET /api/jrx/activity/recent
 *   GET /api/jrx/protocols
 *
 * Failed widgets degrade gracefully (skeleton -> "—") so a single 404 never
 * breaks the page.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, Bot, ShieldCheck, Workflow, MessageSquare, FileSearch,
  Code2, Cpu, AlertTriangle, CheckCircle2, Clock, ArrowUpRight, Sparkles,
  GitBranch, Database, Server, Layers, Search, Newspaper,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { navigateExternalOrConsole } from '@/lib/jrx-console-routes';

import { nv } from '@/lib/jrx-api-paths';
import PartnerSmokePanel from '@/components/admin/PartnerSmokePanel';
import { hasAccess, type RoleLevel } from '@/lib/rbac-registry';
import { NV_REGISTRY_DEFAULTS } from '@/hooks/useNvRegistryMeta';
import { NyvPageShell } from '@/components/NyvPageShell';
import { extractModelCatalogRows } from '@/hooks/useNvModelCatalog';
// ── tiny fetch helper that swallows errors so one 404 doesn't break the page ─
async function safeGet<T = any>(url: string): Promise<T | null> {
  try { return (await apiRequest(url)) as T; } catch { return null; }
}

// ── KPI card ────────────────────────────────────────────────────────────────
interface KpiProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ElementType;
  tone?: 'ok' | 'warn' | 'bad' | 'neutral';
  loading?: boolean;
}

const toneRing: Record<NonNullable<KpiProps['tone']>, string> = {
  ok:      'border-emerald-200 bg-emerald-50/50',
  warn:    'border-amber-200 bg-amber-50/50',
  bad:     'border-rose-200 bg-rose-50/50',
  neutral: 'border-slate-200 bg-white',
};

const toneIcon: Record<NonNullable<KpiProps['tone']>, string> = {
  ok:      'text-emerald-600',
  warn:    'text-amber-600',
  bad:     'text-rose-600',
  neutral: 'text-royal-blue',
};

function Kpi({ label, value, hint, icon: Icon, tone = 'neutral', loading }: KpiProps) {
  return (
    <Card className={`border ${toneRing[tone]} shadow-sm`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">{label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 leading-tight">
              {loading ? <Skeleton className="h-7 w-20" /> : value}
            </div>
            {hint && <div className="mt-1 text-xs text-slate-700">{hint}</div>}
          </div>
          <div className={`shrink-0 rounded-lg bg-white p-2 ring-1 ring-inset ring-slate-200 ${toneIcon[tone]}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Quick action tile ───────────────────────────────────────────────────────
function QuickAction({
  label, description, icon: Icon, to, onNavigate,
}: { label: string; description: string; icon: React.ElementType; to: string; onNavigate: (p: string) => void }) {
  return (
    <button
      onClick={() => navigateExternalOrConsole(to, onNavigate)}
      className="group flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-[#152448]/40 hover:shadow-sm"
    >
      <div className="rounded-md bg-[#152448]/5 p-2 text-[#152448]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">
          {label}
          <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
        </div>
        <div className="text-xs text-slate-700">{description}</div>
      </div>
    </button>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtNum(n: unknown): string {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString();
  return String(v);
}

function timeAgo(iso?: string | number | null): string {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!isFinite(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Project Status Card (NEW 2026-05-12) ────────────────────────────────────
// Shows the user where their project stands: version, build hash, environment,
// agents loaded, providers wired, deployment freshness. Pulls from the data
// already fetched on the dashboard — zero new server work.
interface ProjectStatusCardProps {
  health: any;
  agentTotal: unknown;
  providerCount: unknown;
  protocolCount: unknown;
  healingOk: boolean;
}

function ProjectStatusCard({ health, agentTotal, providerCount, protocolCount, healingOk }: ProjectStatusCardProps) {
  const buildHash = (typeof document !== 'undefined'
    ? Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="/assets/index-"]'))
        .map(s => s.src.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1])
        .find(Boolean)
    : '') ?? '';
  const version =
    health?.agents?.registryVersion ??
    health?.registryVersion ??
    health?.platformVersion ??
    health?.version ??
    NV_REGISTRY_DEFAULTS.platformVersion;
  const agentsLoaded =
    health?.agents?.totalAgents ??
    health?.totalAgents ??
    agentTotal ??
    NV_REGISTRY_DEFAULTS.totalAgents;
  const env = health?.environment ?? health?.env ?? 'replit-dev';
  const uptime = health?.uptime ?? health?.uptimeSec;
  const fmtUptime = (s: unknown) => {
    const n = Number(s);
    if (!isFinite(n)) return '—';
    if (n < 60) return `${Math.round(n)}s`;
    if (n < 3600) return `${Math.round(n / 60)}m`;
    if (n < 86400) return `${Math.round(n / 3600)}h`;
    return `${Math.round(n / 86400)}d`;
  };

  const rows: Array<{ label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'neutral' }> = [
    { label: 'Platform version', value: <span className="font-mono text-xs">{version}</span> },
    { label: 'Environment',      value: <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{env}</Badge> },
    { label: 'Console build',    value: <span className="font-mono text-xs">{buildHash || '—'}</span> },
    { label: 'Gateway uptime',   value: fmtUptime(uptime), tone: 'ok' },
    { label: 'Agents loaded',    value: fmtNum(agentsLoaded) },
    { label: 'LLM providers',    value: fmtNum(providerCount) },
    { label: 'Protocols loaded', value: fmtNum(protocolCount) },
    { label: 'Self-healing',     value: healingOk ? 'Active' : 'Watch', tone: healingOk ? 'ok' : 'warn' },
  ];

  const toneClass: Record<NonNullable<typeof rows[number]['tone']>, string> = {
    ok: 'text-emerald-700',
    warn: 'text-amber-700',
    neutral: 'text-slate-700',
  };

  return (
    <Card className="border-slate-200 shadow-sm" data-testid="card-project-status">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-[#152448]" aria-hidden="true" />
            Project Status
          </CardTitle>
          <p className="text-xs text-slate-700">Where your Jurexio deployment stands right now</p>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {rows.map(r => (
            <div key={r.label} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{r.label}</span>
              <span className={`text-sm font-medium ${r.tone ? toneClass[r.tone] : 'text-slate-700'}`}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function ConsoleDashboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const displayName = (user as { name?: string; email?: string } | null)?.name
    ?? (user as { email?: string } | null)?.email ?? 'Operator';

  const governance = useQuery({
    queryKey: [nv('governance/gate8/status')],
    queryFn: () => safeGet<any>(nv('governance/gate8/status')),
    refetchInterval: 120_000,
  });

  const health = useQuery({
    queryKey: [nv('health')],
    queryFn: () => safeGet<any>(nv('health')),
    refetchInterval: 30_000,
  });

  const healing = useQuery({
    queryKey: [nv('healing/health')],
    queryFn: () => safeGet<any>(nv('healing/health')),
    refetchInterval: 60_000,
  });

  const agents = useQuery({
    queryKey: [nv('registry/agents?limit=1')],
    queryFn: () => safeGet<any>(nv('registry/agents?limit=1')),
    refetchInterval: 5 * 60_000,
  });

  const hitl = useQuery({
    queryKey: [nv('hitl/stats')],
    queryFn: () => safeGet<any>(nv('hitl/stats')),
    refetchInterval: 30_000,
  });

  const activity = useQuery({
    queryKey: [nv('activity/recent?limit=8')],
    queryFn: () => safeGet<any>(nv('activity/recent?limit=8')),
    refetchInterval: 20_000,
  });

  const protocols = useQuery({
    queryKey: [nv('protocols')],
    queryFn: () => safeGet<any>(nv('protocols')),
    refetchInterval: 5 * 60_000,
  });

  const platformHealth = useQuery({
    queryKey: [nv('admin/platform-health')],
    queryFn: () => safeGet<any>(nv('admin/platform-health')),
    refetchInterval: 60_000,
  });

  const adminStats = useQuery({
    queryKey: [nv('admin/stats')],
    queryFn: () => safeGet<any>(nv('admin/stats')),
    refetchInterval: 120_000,
  });

  const modelCatalog = useQuery({
    queryKey: [nv('models')],
    queryFn: () => safeGet<any>(nv('models')),
    refetchInterval: 5 * 60_000,
  });

  const liveModelIds = useMemo(() => {
    const rows = extractModelCatalogRows(modelCatalog.data);
    return rows.slice(0, 8).map((m) => m.id);
  }, [modelCatalog.data]);
  const catalogModelCount = useMemo(
    () => extractModelCatalogRows(modelCatalog.data).length,
    [modelCatalog.data],
  );

  // Derive KPIs (defensive — endpoints have varied response shapes over time)
  const gatewayOk = (health.data?.status ?? health.data?.ok ?? '').toString().toLowerCase().includes('ok')
                 || health.data?.status === 'healthy'
                 || health.data?.healthy === true;
  const providerCount = Array.isArray(health.data?.providers) ? health.data.providers.length
                      : (health.data?.providers?.active ?? health.data?.providers?.count);
  const agentTotal = health.data?.agents?.totalAgents
                  ?? health.data?.totalAgents
                  ?? agents.data?.total
                  ?? agents.data?.pagination?.total
                  ?? (Array.isArray(agents.data?.agents) ? agents.data.agents.length : undefined)
                  ?? (Array.isArray(agents.data) ? agents.data.length : undefined)
                  ?? NV_REGISTRY_DEFAULTS.totalAgents;
  const hitlPending = hitl.data?.pending ?? hitl.data?.pendingCount ?? hitl.data?.stats?.pending;
  const protocolCount = Array.isArray(protocols.data?.protocols) ? protocols.data.protocols.length
                      : protocols.data?.count;
  const healingOk = healing.data?.healthy === true || healing.data?.status === 'ok' || healing.data?.status === 'healthy';
  const gate8Enforcement = governance.data?.data?.sampleEvaluation?.enforcement ?? governance.data?.sampleEvaluation?.enforcement;
  const piiVaultOk = governance.data?.data?.routes?.piiVaultStatus != null;
  const platformRows = (platformHealth.data?.platforms ?? platformHealth.data?.data?.platforms ?? []) as Array<{ status?: string }>;
  const platformsTotal = platformRows.length;
  const platformsOnline = platformRows
    .filter((p) => p.status === 'online' || p.status === 'healthy').length;
  const role = (user?.role ?? 'user') as RoleLevel;
  const showPartnerSmoke = hasAccess(role, 'developer');
  const apiCalls30d = adminStats.data?.usage?.requests ?? adminStats.data?.data?.usage?.requests;

  const recent: Array<{ id?: string; type?: string; message?: string; ts?: string | number; severity?: string }> =
    Array.isArray(activity.data?.events) ? activity.data.events
    : Array.isArray(activity.data?.items) ? activity.data.items
    : Array.isArray(activity.data) ? activity.data
    : [];

  return (
    <NyvPageShell
      className="./jrx-light-scope mx-auto max-w-7xl"
      title={`Welcome back, ${displayName}`}
      description="Live snapshot of platform health, Instant Search, Legal Feed, and approvals. SDK 5.0.7 · NSP/NYM best-outcome on orchestrate."
      actions={
        <Badge variant="outline" className="gap-1 border-border bg-card text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Auto-refresh 30s
        </Badge>
      }
    >

        {/* ── KPI row ──────────────────────────────────────────────────── */}
        <section
          aria-label="Key performance indicators"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Kpi
            label="Gateway"
            value={gatewayOk ? 'Healthy' : (health.data ? 'Degraded' : '—')}
            hint={providerCount !== undefined ? `${fmtNum(providerCount)} LLM providers wired` : 'LLM providers'}
            icon={gatewayOk ? CheckCircle2 : AlertTriangle}
            tone={gatewayOk ? 'ok' : (health.data ? 'warn' : 'neutral')}
            loading={health.isLoading}
          />
          <Kpi
            label="Active Agents"
            value={fmtNum(agentTotal)}
            hint="Active v5.1.0 runtime registry"
            icon={Bot}
            tone="neutral"
            loading={agents.isLoading}
          />
          <Kpi
            label="HITL Pending"
            value={fmtNum(hitlPending)}
            hint="Approvals waiting on a human"
            icon={ShieldCheck}
            tone={Number(hitlPending) > 0 ? 'warn' : 'ok'}
            loading={hitl.isLoading}
          />
          <Kpi
            label="Self-Healing"
            value={healingOk ? 'OK' : (healing.data ? 'Watch' : '—')}
            hint={protocolCount !== undefined ? `${fmtNum(protocolCount)} protocols loaded` : 'Circuit breakers nominal'}
            icon={Activity}
            tone={healingOk ? 'ok' : (healing.data ? 'warn' : 'neutral')}
            loading={healing.isLoading}
          />
        </section>

        <section aria-label="Governance posture" className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-700 gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Gate 8 JRX: {governance.isLoading ? '…' : (gate8Enforcement || '—')}
          </Badge>
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-700 gap-1">
            <Database className="h-3 w-3" aria-hidden="true" />
            PII Vault route: {piiVaultOk ? 'live' : '—'}
          </Badge>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 gap-1">
            <Layers className="h-3 w-3" aria-hidden="true" />
            Platforms: {platformHealth.isLoading ? '…' : (platformsTotal ? `${platformsOnline}/${platformsTotal} operational` : '—')}
          </Badge>
          {apiCalls30d != null && (
            <Badge variant="outline" className="border-slate-200 bg-white text-slate-700 gap-1">
              <Server className="h-3 w-3" aria-hidden="true" />
              API calls (30d): {fmtNum(apiCalls30d)}
            </Badge>
          )}
        </section>

        {showPartnerSmoke && (
          <section aria-label="Partner integration smoke">
            <PartnerSmokePanel />
          </section>
        )}

        {/* ── Two-column main grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Recent activity ─ 2/3 */}
          <Card className="lg:col-span-2 border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Recent activity</CardTitle>
                <p className="text-xs text-slate-700">Last events across your organisation</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigateExternalOrConsole('/live-activity-feed', navigate)}
              >
                Open feed
                <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {activity.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : recent.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-700">
                  No activity yet — kick off an orchestration or open a document.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recent.slice(0, 8).map((ev, i) => {
                    const sev = (ev.severity ?? '').toLowerCase();
                    const dot =
                      sev === 'error' || sev === 'critical' ? 'bg-rose-500'
                      : sev === 'warn' || sev === 'warning' ? 'bg-amber-500'
                      : 'bg-emerald-500';
                    return (
                      <li key={ev.id ?? i} className="flex items-center justify-between gap-3 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                          <span className="truncate text-sm text-slate-800">
                            {ev.message ?? ev.type ?? 'event'}
                          </span>
                          {ev.type && ev.message && (
                            <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-700">
                              {ev.type}
                            </Badge>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-slate-600">{timeAgo(ev.ts)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Quick actions ─ 1/3 */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick actions</CardTitle>
              <p className="text-xs text-slate-700">Jump straight to the work</p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <QuickAction
                label="Instant Search"
                description="SC/HC caselaw FTS · statutes · 1950–2026"
                icon={Search}
                to="/instant-search"
                onNavigate={navigate}
              />
              <QuickAction
                label="Live Legal Feed"
                description="RSS digest · Auto-RAG · web search on orchestrate"
                icon={Newspaper}
                to="/legal-intelligence-feed"
                onNavigate={navigate}
              />
              <QuickAction
                label="Open chat"
                description="Talk to the legal assistant"
                icon={MessageSquare}
                to="/chat"
                onNavigate={navigate}
              />
              <QuickAction
                label="Upload a document"
                description="OCR + extract + classify"
                icon={FileSearch}
                to="/document-ai-hub"
                onNavigate={navigate}
              />
              <QuickAction
                label="Run an orchestration"
                description="Queen multi-agent · best-outcome"
                icon={Workflow}
                to="/orchestration"
                onNavigate={navigate}
              />
              <QuickAction
                label="Knowledge Plane"
                description="NyayaSearch federation + SSO"
                icon={Database}
                to="/nys-knowledge-plane"
                onNavigate={navigate}
              />
              <QuickAction
                label="SDK & API"
                description="client-sdk 5.0.7 · Instant Search"
                icon={Code2}
                to="/sdk-hub?tab=overview"
                onNavigate={navigate}
              />
            </CardContent>
          </Card>
        </div>

        {/* ── Project Status panel (2026-05-12 restoration) ───────────── */}
        <ProjectStatusCard
          health={health.data}
          agentTotal={agentTotal}
          providerCount={providerCount}
          protocolCount={protocolCount}
          healingOk={healingOk}
        />

        {/* ── Health & approvals row ──────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">LLM providers</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/llm-priority')}
              >
                Routing
                <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {health.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : Array.isArray(health.data?.providers) && health.data.providers.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {health.data.providers.map((p: any, i: number) => {
                    const name = typeof p === 'string' ? p : (p.name ?? p.provider ?? `provider-${i}`);
                    const ok = typeof p === 'string' ? true : (p.healthy ?? p.status === 'ok' ?? true);
                    return (
                      <Badge
                        key={`${name}-${i}`}
                        variant="outline"
                        className={ok
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-rose-200 bg-rose-50 text-rose-700'}
                      >
                        <Cpu className="mr-1 h-3 w-3" aria-hidden="true" />
                        {name}
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-slate-700">
                    Provider list unavailable — check <span className="font-mono">/api/jrx/health</span>.
                  </p>
                  {catalogModelCount > 0 && (
                    <p className="text-xs text-slate-600">
                      Live catalog: {fmtNum(catalogModelCount)} models routed via intelligent-router.
                    </p>
                  )}
                </div>
              )}
              {liveModelIds.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {liveModelIds.map((id) => (
                    <Badge key={id} variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 font-mono text-[10px]">
                      {id}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Approvals on you</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate('/my-approvals')}
              >
                Review queue
                <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {hitl.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="rounded-lg bg-amber-50 p-3 text-amber-600 ring-1 ring-inset ring-amber-200">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{fmtNum(hitlPending)}</div>
                    <div className="text-xs text-slate-700">
                      Decisions waiting · avg SLA {hitl.data?.avgSlaSec ? `${Math.round(hitl.data.avgSlaSec / 60)}m` : '—'}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
    </NyvPageShell>
  );
}
