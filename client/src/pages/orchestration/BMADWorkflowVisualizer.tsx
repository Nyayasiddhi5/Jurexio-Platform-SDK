import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity, ChevronRight, Layers, RefreshCw, Workflow, Sparkles, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

/**
 * BMADWorkflowVisualizer (Task #170)
 *
 * Visualises the BMAD methodology (Business · Methodology · AI · Development)
 * as four sequential roles —  Analyst → Architect → Developer → QA — and
 * surfaces:
 *
 *   - The five canonical BMAD templates registered server-side
 *     (GET {orchestration}/bmad/templates).
 *   - Live in-flight BMAD runs derived from `nv_schema.agent_chains` rows
 *     whose name was auto-stamped by `runBMADWorkflow` /
 *     `formCluster` (`BMAD: …` or `BMAD Cluster …`).
 *   - Per-run navigable links into the Chain Audit Manager (CAM) dashboard
 *     scoped to that chain id.
 *
 * Visual conventions follow CAMDashboardPage / RouterDecisionsPage: light
 * palette, Merriweather headings, brand-gold (#C7B15B) accents,
 * dark-navy (#152448) callouts. NO `dark:` variants per the
 * 2026-05-12 light-only product decision.
 */

const REFRESH_MS = 30_000;

interface BMADStep {
  agentKey: string;
  role: string;
  description?: string;
}

interface BMADTemplate {
  id: string;
  name: string;
  description?: string;
  steps: BMADStep[];
}

interface ChainRow {
  id: number;
  name: string;
  description?: string;
  step_count?: number;
  user_id?: string;
  created_at?: string;
}

const ROLE_STAGES: Array<{ role: string; label: string; pillar: string; tint: string }> = [
  { role: 'analyst',   label: 'Analyst',   pillar: 'Business',    tint: '#152448' },
  { role: 'architect', label: 'Architect', pillar: 'Methodology', tint: '#1F4FA0' },
  { role: 'developer', label: 'Developer', pillar: 'AI',          tint: '#B48907' },
  { role: 'qa',        label: 'QA',        pillar: 'Development', tint: '#15803D' },
];

function unwrapArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const inner = (raw as { data?: unknown }).data;
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

function relTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function StatCard({
  icon: Icon, label, value, sub, accent = '#C7B15B',
}: { icon: LucideIcon; label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium tracking-wide uppercase text-slate-600">{label}</CardTitle>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
          {value}
        </div>
        {sub && <div className="text-xs mt-1 text-slate-700">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function BMADWorkflowVisualizer() {
  const templatesQ = useQuery<BMADTemplate[] | { data: BMADTemplate[] }>({
    queryKey: [p('BMAD_TEMPLATES')],
    queryFn: () => nvFetchJson<BMADTemplate[] | { data: BMADTemplate[] }>(p('BMAD_TEMPLATES')),
    refetchInterval: REFRESH_MS,
    staleTime: 30_000,
  });
  const chainsQ = useQuery<ChainRow[] | { data: ChainRow[] }>({
    queryKey: [p('ORCHESTRATION_CHAINS')],
    queryFn: () => nvFetchJson<ChainRow[] | { data: ChainRow[] }>(p('ORCHESTRATION_CHAINS')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const templates = unwrapArray<BMADTemplate>(templatesQ.data);
  const chains = unwrapArray<ChainRow>(chainsQ.data);

  // BMAD chains are stamped by the server with a "BMAD: <template>" or
  // "BMAD Cluster [JURIS]" prefix. Anything else is an arbitrary user chain.
  const bmadRuns = useMemo(
    () => chains.filter((c) => /^BMAD[\s:]/i.test(c.name || '')),
    [chains],
  );

  const runsByTemplate = useMemo(() => {
    const map = new Map<string, ChainRow[]>();
    for (const r of bmadRuns) {
      const m = (r.name || '').match(/^BMAD:\s*(.+)$/i);
      const key = m?.[1]?.trim() ?? 'Cluster';
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [bmadRuns]);

  const anyError = templatesQ.isError || chainsQ.isError;

  function refreshAll() {
    templatesQ.refetch();
    chainsQ.refetch();
  }

  // CAM (Chain Audit Manager) is the live, role-gated drilldown destination
  // for a chain. Chain IDs are NOT requestIDs, so we must NOT link to
  // /orchestration/lineage/:requestId — that route validates the format and
  // would 400/404 on a chain id.
  const runHref = (chainId: number) => `/orchestration/cam?chain=${chainId}`;

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-3xl font-bold text-[#152448]"
              style={{ fontFamily: 'Merriweather, serif' }}
              data-testid="page-title-bmad"
            >
              BMAD Workflow Visualizer
            </h1>
            <p className="text-sm mt-1 text-slate-600">
              Business · Methodology · AI · Development — four-stage agent
              decomposition for legal workflows. Live counts and in-flight runs
              from the orchestration layer.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              data-testid="bmad-status-badge"
              style={
                anyError
                  ? { background: 'rgba(255,107,107,0.18)', color: '#B91C1C', border: '1px solid rgba(248,113,113,0.4)' }
                  : { background: 'rgba(28,122,79,0.18)', color: '#15803D', border: '1px solid rgba(34,197,94,0.4)' }
              }
            >
              {anyError ? 'Degraded' : 'Live'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshAll}
              className="text-slate-700 hover:text-[#C7B15B]"
              data-testid="bmad-refresh-btn"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Layers}   label="Templates"        value={templates.length} sub="Server-registered" />
          <StatCard icon={Workflow} label="In-flight runs"   value={bmadRuns.length}  sub={`${chains.length} total chains`} accent="#15803D" />
          <StatCard icon={Sparkles} label="Pipeline stages"  value={ROLE_STAGES.length} sub="B · M · A · D"     accent="#152448" />
          <StatCard icon={Users}    label="Templates active" value={runsByTemplate.size} sub="With ≥ 1 run"     />
        </div>

        {/* Methodology stage diagram */}
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <Workflow className="h-4 w-4" style={{ color: '#C7B15B' }} />
              BMAD pipeline stages
            </CardTitle>
            <CardDescription>
              Every BMAD template decomposes into these four sequential roles.
              Each stage maps to one BMAD pillar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-2 overflow-x-auto"
              data-testid="bmad-stage-diagram"
            >
              {ROLE_STAGES.map((stage, i) => (
                <div key={stage.role} className="flex items-center gap-2 flex-shrink-0">
                  <div
                    className="rounded-lg border bg-white px-4 py-3 min-w-[140px]"
                    style={{ borderColor: stage.tint }}
                    data-testid={`bmad-stage-${stage.role}`}
                  >
                    <div
                      className="text-[11px] uppercase tracking-wider font-semibold"
                      style={{ color: stage.tint }}
                    >
                      {stage.pillar}
                    </div>
                    <div
                      className="text-base font-bold text-slate-900"
                      style={{ fontFamily: 'Merriweather, serif' }}
                    >
                      {stage.label}
                    </div>
                    <div className="text-[11px] text-slate-700 mt-0.5">role: <code>{stage.role}</code></div>
                  </div>
                  {i < ROLE_STAGES.length - 1 && (
                    <ChevronRight className="h-5 w-5 text-slate-300 hidden md:block" aria-hidden />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Templates with embedded run counts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <Layers className="h-4 w-4" style={{ color: '#C7B15B' }} />
              Templates &amp; in-flight runs
            </CardTitle>
            <CardDescription>
              Canonical BMAD templates from <code className="text-xs">/orchestration/bmad/templates</code>{' '}
              cross-joined with live chains stamped <code>BMAD: &lt;template&gt;</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {templatesQ.isLoading ? (
              <div className="space-y-3" data-testid="loading-bmad-templates">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : templatesQ.isError ? (
              <JrxErrorState title="BMAD templates endpoint unavailable" size="sm" />
            ) : templates.length === 0 ? (
              <JrxEmptyState title="No BMAD templates registered" size="sm" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="bmad-templates-list">
                {templates.map((t) => {
                  const runs = runsByTemplate.get(t.name) ?? [];
                  return (
                    <div
                      key={t.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"
                      data-testid={`bmad-template-${t.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className="text-base font-semibold text-[#152448]"
                            style={{ fontFamily: 'Merriweather, serif' }}
                          >
                            {t.name}
                          </div>
                          <div className="text-[11px] text-slate-700 font-mono">{t.id}</div>
                        </div>
                        <Badge
                          className="text-[10px] whitespace-nowrap"
                          style={
                            runs.length > 0
                              ? { background: 'rgba(34,197,94,0.15)', color: '#15803D', border: '1px solid rgba(34,197,94,0.3)' }
                              : { background: 'rgba(148,163,184,0.15)', color: '#475569', border: '1px solid rgba(148,163,184,0.3)' }
                          }
                          data-testid={`bmad-template-runs-${t.id}`}
                        >
                          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
                        </Badge>
                      </div>

                      {t.description && (
                        <div className="text-xs text-slate-600">{t.description}</div>
                      )}

                      {/* Step pipeline */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(t.steps ?? []).map((s, i) => {
                          const stage = ROLE_STAGES.find((rs) => rs.role === s.role);
                          const tint = stage?.tint ?? '#475569';
                          return (
                            <span key={`${s.agentKey}-${i}`} className="flex items-center gap-1.5">
                              <span
                                className="text-[10px] font-mono px-2 py-0.5 rounded-md border"
                                style={{ color: tint, borderColor: tint, background: `${tint}10` }}
                                title={s.description || `${s.role}: ${s.agentKey}`}
                              >
                                {s.role}: {s.agentKey}
                              </span>
                              {i < (t.steps?.length ?? 0) - 1 && (
                                <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden />
                              )}
                            </span>
                          );
                        })}
                      </div>

                      {/* Recent runs (top 3), each navigable into CAM. */}
                      {runs.length > 0 && (
                        <div className="pt-2 mt-2 border-t border-slate-100 space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-slate-700 mb-1">
                            Recent runs
                          </div>
                          {runs.slice(0, 3).map((r) => (
                            <Link
                              key={r.id}
                              href={runHref(r.id)}
                              className="flex items-center justify-between text-xs text-slate-700 hover:text-[#B48907] hover:underline"
                              data-testid={`bmad-run-${r.id}`}
                            >
                              <span className="font-mono">chain #{r.id}</span>
                              <span className="text-[11px] text-slate-700">
                                {(r.step_count ?? 0)} steps · {relTime(r.created_at)}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Multi-jurisdiction BMAD clusters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: '#C7B15B' }} />
              Cross-border BMAD clusters
            </CardTitle>
            <CardDescription>
              Multi-jurisdiction clusters formed via{' '}
              <code className="text-xs">POST /bmad/cluster/form</code> (GAP-011).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const clusters = bmadRuns.filter((c) => /^BMAD\s+Cluster/i.test(c.name || ''));
              if (chainsQ.isError) {
                return <JrxErrorState title="Chains endpoint unavailable" size="sm" />;
              }
              if (chainsQ.isLoading) {
                return (
                  <div className="space-y-2" data-testid="loading-bmad-clusters">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                );
              }
              if (clusters.length === 0) {
                return (
                  <JrxEmptyState
                    title="No cross-border clusters in window"
                    description="Form one via POST {orchestration}/bmad/cluster/form."
                    size="sm"
                  />
                );
              }
              return (
                <div className="space-y-2" data-testid="bmad-clusters-list">
                  {clusters.slice(0, 8).map((c) => (
                    <Link
                      key={c.id}
                      href={runHref(c.id)}
                      className="block rounded-md border border-slate-200 bg-white p-3 hover:border-[#C7B15B] transition-colors"
                      data-testid={`bmad-cluster-${c.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate" title={c.name}>
                            {c.name}
                          </div>
                          {c.description && (
                            <div className="text-xs text-slate-700 truncate" title={c.description}>
                              {c.description}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-700 mt-1">
                            chain #{c.id} · {relTime(c.created_at)}
                          </div>
                        </div>
                        <Badge
                          className="text-[10px] whitespace-nowrap"
                          style={{
                            background: 'rgba(10,42,102,0.10)',
                            color: '#152448',
                            border: '1px solid rgba(10,42,102,0.25)',
                          }}
                        >
                          {c.step_count ?? 0} stages
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <div className="text-xs text-center pt-4 text-slate-700">
          Auto-refresh every 30s ·{' '}
          <Link href="/orchestration/a2a" className="text-[#B48907] hover:underline">
            ← A2A collaboration
          </Link>
        </div>
      </div>
    </div>
  );
}
