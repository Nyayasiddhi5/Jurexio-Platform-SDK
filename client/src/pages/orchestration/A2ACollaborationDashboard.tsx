import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Activity, Network, RefreshCw, Share2, GitBranch, ShieldCheck, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

/**
 * A2ACollaborationDashboard (Task #170)
 *
 * Surfaces live agent-to-agent collaboration state from the orchestration
 * telemetry endpoints already mounted under `/api/jrx/orchestration/*`:
 *
 *   - GET {orchestration}/protocols   — protocol registry rows
 *     (filtered to A2A / MCP / ROMA / Parlant / collaboration protocols)
 *   - GET {orchestration}/dashboard   — protocol active/total counts + agents
 *   - GET {orchestration}/chains      — recent agent-chain sessions
 *     (each chain step = one agent-to-agent handoff)
 *
 * The collaboration event timeline is derived from the same orchestration
 * sources (chain creation events + protocol activation events) so this page
 * stays inside the `/orchestration/*` contract surface.
 *
 * Visual conventions follow CAMDashboardPage / RouterDecisionsPage: light
 * palette (`bg-slate-50` shell, white cards, slate-700 body), Merriweather
 * Display headings, brand-gold (`#C7B15B`) accent, dark-navy (`#152448`)
 * callouts. NO dark-mode variants per replit.md product decision (2026-05-12).
 */

const REFRESH_MS = 30_000;

interface ProtocolRow {
  id?: string | number;
  protocol_name?: string;
  protocol_version?: string;
  status?: string;
  health_status?: string;
  activated_at?: string | null;
  last_health_check?: string | null;
  config_json?: Record<string, unknown> | null;
  depends_on?: string[] | string | null;
}

interface ChainRow {
  id: number;
  name: string;
  description?: string;
  step_count?: number;
  user_id?: string;
  created_at?: string;
}

interface DashboardPayload {
  protocols?: { total?: number; active?: number };
  usage?: { totalRequests?: number; activeSessions?: number };
  totalAgents?: number;
}

/** Discriminated record for the cross-source collaboration timeline. */
type TimelineEvent =
  | {
      kind: 'chain';
      id: string;
      title: string;
      detail: string;
      at?: string;
      ok: true;
    }
  | {
      kind: 'protocol';
      id: string;
      title: string;
      detail: string;
      at?: string;
      ok: boolean;
    };

/** Normalise the queryClient envelope. Object responses are spread by
 *  apiRequest into the React-Query cache; array responses come through as
 *  `{ data: [...] }` because Array values can't be spread. */
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

const COLLAB_PROTOCOL_HINTS = [
  'a2a', 'mcp', 'roma', 'parlant', 'bmad',
  'collab', 'handoff', 'negotiat', 'agent', 'cap_',
];

function isCollabProtocol(name?: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return COLLAB_PROTOCOL_HINTS.some((h) => n.includes(h));
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

export default function A2ACollaborationDashboard() {
  const protocolsQ = useQuery<ProtocolRow[] | { data: ProtocolRow[] }>({
    queryKey: [p('ORCHESTRATION_PROTOCOLS')],
    queryFn: () => nvFetchJson<ProtocolRow[] | { data: ProtocolRow[] }>(p('ORCHESTRATION_PROTOCOLS')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });
  const chainsQ = useQuery<ChainRow[] | { data: ChainRow[] }>({
    queryKey: [p('ORCHESTRATION_CHAINS')],
    queryFn: () => nvFetchJson<ChainRow[] | { data: ChainRow[] }>(p('ORCHESTRATION_CHAINS')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });
  const dashQ = useQuery<DashboardPayload>({
    queryKey: [p('ORCHESTRATION_DASH')],
    queryFn: () => nvFetchJson<DashboardPayload>(p('ORCHESTRATION_DASH')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const protocols = unwrapArray<ProtocolRow>(protocolsQ.data);
  const chains = unwrapArray<ChainRow>(chainsQ.data);

  const collabProtocols = useMemo(
    () => protocols.filter((pr) => isCollabProtocol(pr.protocol_name)),
    [protocols],
  );
  const activeProtocols = collabProtocols.filter((pr) => (pr.status || '').toLowerCase() === 'active');

  // Each multi-step chain represents an active agent-to-agent collaboration.
  const collabSessions = useMemo(
    () => chains.filter((c) => (c.step_count ?? 0) > 1),
    [chains],
  );

  // Timeline is derived from the orchestration sources we already pull —
  // chain creation events (each is an A2A session bootstrap) merged with
  // protocol activation events. Sorted newest-first. This keeps the page
  // strictly inside the /orchestration/* contract surface.
  const collabEvents = useMemo<TimelineEvent[]>(() => {
    const fromChains: TimelineEvent[] = collabSessions.map((c) => ({
      kind: 'chain',
      id: `chain-${c.id}`,
      title: c.name || `chain #${c.id}`,
      detail: `${c.step_count ?? 0} steps · chain #${c.id}`,
      at: c.created_at,
      ok: true,
    }));
    const fromProtocols: TimelineEvent[] = collabProtocols
      .filter((pr) => !!pr.activated_at)
      .map((pr) => ({
        kind: 'protocol',
        id: `proto-${pr.id ?? pr.protocol_name}`,
        title: `${pr.protocol_name ?? 'protocol'} activated`,
        detail: `${pr.protocol_version ?? ''} · ${pr.health_status ?? pr.status ?? '—'}`,
        at: pr.activated_at ?? undefined,
        ok: (pr.status || '').toLowerCase() === 'active',
      }));
    const all = [...fromChains, ...fromProtocols];
    all.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });
    return all;
  }, [collabSessions, collabProtocols]);

  const dashData = dashQ.data;
  const protocolsTotalDash = dashData?.protocols?.total ?? collabProtocols.length;
  const protocolsActiveDash = dashData?.protocols?.active ?? activeProtocols.length;
  const activeSessions = dashData?.usage?.activeSessions ?? collabSessions.length;
  const totalAgents = dashData?.totalAgents ?? 0;

  const anyError = protocolsQ.isError || chainsQ.isError || dashQ.isError;
  const anyLoading = protocolsQ.isLoading || chainsQ.isLoading || dashQ.isLoading;

  function refreshAll() {
    protocolsQ.refetch();
    chainsQ.refetch();
    dashQ.refetch();
  }

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-3xl font-bold text-[#152448]"
              style={{ fontFamily: 'Merriweather, serif' }}
              data-testid="page-title-a2a"
            >
              A2A Collaboration
            </h1>
            <p className="text-sm mt-1 text-slate-600">
              Live agent-to-agent sessions, active inter-agent protocols, and the
              orchestration event timeline.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              data-testid="a2a-status-badge"
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
              data-testid="a2a-refresh-btn"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Network}
            label="Active sessions"
            value={activeSessions}
            sub={`${chains.length} chains tracked`}
          />
          <StatCard
            icon={Share2}
            label="Active protocols"
            value={protocolsActiveDash}
            sub={`${protocolsTotalDash} registered`}
            accent="#15803D"
          />
          <StatCard
            icon={GitBranch}
            label="Multi-agent chains"
            value={collabSessions.length}
            sub="≥ 2 handoff steps"
          />
          <StatCard
            icon={ShieldCheck}
            label="Charter agents"
            value={totalAgents}
            sub="§23 governed"
            accent="#152448"
          />
        </div>

        {/* Active inter-agent protocols */}
        <Card>
          <CardHeader>
            <CardTitle className="text-slate-900 flex items-center gap-2">
              <Share2 className="h-4 w-4" style={{ color: '#C7B15B' }} />
              Inter-agent protocols
            </CardTitle>
            <CardDescription>
              Protocols enabling agent-to-agent message routing, negotiation, and handoff.
              Sourced from <code className="text-xs">nv_schema.protocol_registry</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {protocolsQ.isLoading ? (
              <div className="space-y-2" data-testid="loading-a2a-protocols">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : protocolsQ.isError ? (
              <JrxErrorState title="Protocol registry unavailable" size="sm" />
            ) : collabProtocols.length === 0 ? (
              <JrxEmptyState
                title="No inter-agent protocols registered"
                description="Bootstrap ROMA / MCP via POST {orchestration}/protocols/roma/initialize"
                size="sm"
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200">
                      <TableHead className="text-slate-600">Protocol</TableHead>
                      <TableHead className="text-slate-600">Version</TableHead>
                      <TableHead className="text-slate-600">Status</TableHead>
                      <TableHead className="text-slate-600">Health</TableHead>
                      <TableHead className="text-slate-600">Activated</TableHead>
                      <TableHead className="text-slate-600">Depends on</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {collabProtocols.map((pr) => {
                      const status = (pr.status || 'unknown').toLowerCase();
                      const isActive = status === 'active';
                      const deps: string[] = Array.isArray(pr.depends_on)
                        ? pr.depends_on
                        : typeof pr.depends_on === 'string'
                          ? (() => { try { const v = JSON.parse(pr.depends_on); return Array.isArray(v) ? v : []; } catch { return []; } })()
                          : [];
                      return (
                        <TableRow key={String(pr.id ?? pr.protocol_name)} className="border-slate-200" data-testid={`a2a-protocol-row-${pr.protocol_name}`}>
                          <TableCell className="text-slate-900 font-medium">{pr.protocol_name ?? '—'}</TableCell>
                          <TableCell className="text-slate-700 text-xs font-mono">{pr.protocol_version ?? '—'}</TableCell>
                          <TableCell>
                            <Badge
                              className="text-[10px]"
                              style={
                                isActive
                                  ? { background: 'rgba(34,197,94,0.15)', color: '#15803D', border: '1px solid rgba(34,197,94,0.3)' }
                                  : { background: 'rgba(148,163,184,0.15)', color: '#475569', border: '1px solid rgba(148,163,184,0.3)' }
                              }
                            >
                              {status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-700 text-xs">{pr.health_status ?? '—'}</TableCell>
                          <TableCell className="text-slate-700 text-xs">{relTime(pr.activated_at)}</TableCell>
                          <TableCell className="text-slate-600 text-xs font-mono">
                            {deps.length ? deps.join(', ') : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active sessions + Event timeline (two columns) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2">
                <GitBranch className="h-4 w-4" style={{ color: '#C7B15B' }} />
                Active agent-to-agent sessions
              </CardTitle>
              <CardDescription>
                Multi-step agent chains from <code className="text-xs">nv_schema.agent_chains</code>.
                Each step = one agent handoff.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chainsQ.isLoading ? (
                <div className="space-y-2" data-testid="loading-a2a-sessions">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : chainsQ.isError ? (
                <JrxErrorState title="Chains endpoint unavailable" size="sm" />
              ) : collabSessions.length === 0 ? (
                <JrxEmptyState
                  title="No multi-agent sessions in window"
                  description="Sessions appear once a chain with ≥ 2 steps executes."
                  size="sm"
                />
              ) : (
                <div className="space-y-3" data-testid="a2a-sessions-list">
                  {collabSessions.slice(0, 10).map((c) => (
                    <Link
                      key={c.id}
                      href={`/orchestration/cam?chain=${c.id}`}
                      className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-[#C7B15B] transition-colors"
                      data-testid={`a2a-session-${c.id}`}
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
                          <div className="text-[11px] text-slate-700 mt-1 flex items-center gap-2">
                            <Clock className="h-3 w-3" /> {relTime(c.created_at)}
                            {c.user_id ? <span className="font-mono">· user:{c.user_id.slice(0, 12)}</span> : null}
                          </div>
                        </div>
                        <Badge
                          className="text-[10px] whitespace-nowrap"
                          style={{
                            background: 'rgba(212,160,23,0.15)',
                            color: '#B48907',
                            border: '1px solid rgba(212,160,23,0.3)',
                          }}
                        >
                          {c.step_count ?? 0} steps
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Event timeline (orchestration-derived) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2">
                <Activity className="h-4 w-4" style={{ color: '#C7B15B' }} />
                Recent collaboration events
              </CardTitle>
              <CardDescription>
                Chain bootstraps and protocol activations from the
                <code className="text-xs"> /orchestration/chains</code> +
                <code className="text-xs"> /orchestration/protocols</code> feeds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(chainsQ.isLoading || protocolsQ.isLoading) ? (
                <div className="space-y-2" data-testid="loading-a2a-timeline">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : (chainsQ.isError && protocolsQ.isError) ? (
                <JrxErrorState title="Orchestration timeline unavailable" size="sm" />
              ) : collabEvents.length === 0 ? (
                <JrxEmptyState title="No recent collaboration events" size="sm" />
              ) : (
                <div className="space-y-2" data-testid="a2a-timeline-list">
                  {collabEvents.slice(0, 12).map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                      data-testid={`a2a-event-${e.id}`}
                    >
                      <div
                        className="h-2 w-2 mt-1.5 rounded-full flex-shrink-0"
                        style={{ background: e.ok ? '#22C55E' : '#F87171' }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-xs font-medium text-slate-900 truncate" title={e.title}>
                            {e.title}
                          </span>
                          <span className="text-[10px] text-slate-700 whitespace-nowrap">{relTime(e.at)}</span>
                        </div>
                        <div className="text-[11px] text-slate-700 truncate font-mono">
                          {e.kind} · {e.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="text-xs text-center pt-4 text-slate-700">
          Auto-refresh every 30s ·{' '}
          <Link href="/orchestration/bmad" className="text-[#B48907] hover:underline">
            BMAD workflows →
          </Link>
        </div>

        {anyLoading && !anyError && (
          <div className="sr-only" aria-live="polite">Loading collaboration telemetry…</div>
        )}
      </div>
    </div>
  );
}
