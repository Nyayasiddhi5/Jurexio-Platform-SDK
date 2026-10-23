import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Activity, Brain, Users, AlertTriangle, ShieldCheck, Gauge,
  Heart, Zap, Network, Eye, ScrollText, RefreshCw,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';

import { nv } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';
interface DashboardPayload {
  aiMaturityScore: number;
  piiPatternsActive: number;
  totalAgents: number;
  usage?: { totalRequests?: number; activeSessions?: number; tokensUsed?: number };
  feedback?: { total?: number; positive?: number; negative?: number; avgRating?: number };
  hitl?: { pending?: number; approved?: number; rejected?: number };
  topAgents?: Array<{ agentId?: string; name?: string; requests?: number; avgLatencyMs?: number; successRate?: number }>;
  protocols?: { total?: number; active?: number };
  openIncidents?: number;
}

// Mirrors `SelfHealingMLService.getStats()` return shape — see
// src/services/self-healing-ml-service.ts:750.
interface HealingStats {
  totalFailures?: number;
  totalRecoveries?: number;
  recoveryRate?: number;            // 0..1
  averageRecoveryTimeMs?: number;
  activeCircuitBreakers?: number;
  openCircuitBreakers?: number;
  componentHealthSummary?: Record<string, string>;
  strategyEffectiveness?: Record<string, number>;
  degradedComponents?: string[];
  lastFailureTimestamp?: string | null;
  uptimePercentage?: number;        // 0..100
}

// Mirrors `GuardrailManager.getStats()` — see
// src/middleware/jrx-guardrails-enforcement.ts:320.
interface GuardrailStats {
  totalViolations?: number;
  violationsByType?: Record<string, number>;
  lastViolation?: { type?: string; timestamp?: string } | null;
  startedAt?: string;
}

interface RoutingWeight {
  agentId: string;
  tier: string;
  jurisdictionMatch: number;
  tierProximity: number;
  successRate: number;
  latencyFactor: number;
  concurrencyPenalty: number;
  jurisdictionOutcome: number;
  composite: number;                // weighted ranking score
}

// Mirrors GET /api/jrx/orchestration/routing/weights — see
// src/routes/jrx-orchestration-routes.ts:644.
interface RoutingPayload {
  query?: { capability?: string; jurisdiction?: string; preferredTier?: number; limit?: number };
  summary?: {
    trackedAgents?: number;
    totalActiveExecutions?: number;
    avgSuccessRate?: number | null;
    avgP95LatencyMs?: number | null;
  };
  weights?: RoutingWeight[];
}

interface HealthPayload {
  status: string;
  version?: string;
  uptime?: number;
  services?: {
    agents?: {
      status: string;
      totalAgents: number;
      registeredInMemory?: number;
      jurisdictions: number;
      practiceAreas: number;
      registryFormat?: string;
      registryVersion?: string;
      section23Coverage?: number;
      byJurisdiction?: Record<string, number>;
    };
  };
}

const REFRESH_MS = 30_000;

function StatCard({
  icon: Icon, label, value, sub, accent = '#C7B15B',
}: { icon: any; label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium tracking-wide uppercase">{label}</CardTitle>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>{value}</div>
        {sub && <div className="text-xs mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function CAMDashboardPage() {
  const { data: dash, isLoading: dashLoading, isError: dashError, refetch: refetchDash } = useQuery<DashboardPayload>({
    queryKey: [nv('orchestration/dashboard')],
    queryFn: () => nvFetchJson<DashboardPayload>(nv('orchestration/dashboard')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const { data: health, isError: healthError } = useQuery<HealthPayload>({
    queryKey: [nv('health')],
    queryFn: () => nvFetchJson<HealthPayload>(nv('health')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });
  const agents = health?.services?.agents;

  const { data: healing, isError: healingError } = useQuery<HealingStats>({
    queryKey: [nv('orchestration/healing/stats')],
    queryFn: () => nvFetchJson<HealingStats>(nv('orchestration/healing/stats')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const { data: guardrails, isError: guardrailsError } = useQuery<GuardrailStats>({
    queryKey: [nv('orchestration/guardrails/stats')],
    queryFn: () => nvFetchJson<GuardrailStats>(nv('orchestration/guardrails/stats')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  const { data: routing, isError: routingError } = useQuery<RoutingPayload>({
    queryKey: [nv('orchestration/routing/weights')],
    queryFn: () => nvFetchJson<RoutingPayload>(nv('orchestration/routing/weights')),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  });

  // Aggregate degraded state — any widget endpoint failing flips the badge.
  const anyError = dashError || healthError || healingError || guardrailsError || routingError;

  const totalAgents = agents?.totalAgents ?? dash?.totalAgents ?? 0;
  const inMemory = agents?.registeredInMemory ?? 0;
  const activeSessions = dash?.usage?.activeSessions ?? 0;
  const totalRequests = dash?.usage?.totalRequests ?? 0;
  const hitlPending = dash?.hitl?.pending ?? 0;
  const incidents = dash?.openIncidents ?? 0;
  const aiMaturity = dash?.aiMaturityScore ?? 0;
  const piiPatterns = dash?.piiPatternsActive ?? 0;
  const protocolsActive = dash?.protocols?.active ?? 0;
  const protocolsTotal = dash?.protocols?.total ?? 0;
  const topAgents = dash?.topAgents ?? [];
  const byJur = agents?.byJurisdiction ?? {};

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
              Ops dashboard
            </h1>
            <p className="text-sm mt-1">
              Orchestration ops (healing, guardrails, routing weights) — not CAM 2.0 telemetry. See tab CAM 2.0.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              style={
                anyError
                  ? { background: 'rgba(255,107,107,0.18)', color: '#FF6B6B', border: '1px solid rgba(255,107,107,0.3)' }
                  : { background: 'rgba(28,122,79,0.18)', color: '#3FD78B', border: '1px solid rgba(63,215,139,0.3)' }
              }
              data-testid="cam-status-badge"
            >
              {anyError ? 'Degraded' : 'Live'}
            </Badge>
            <button
              onClick={() => refetchDash()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: 'rgba(212,160,23,0.15)', color: '#C7B15B', border: '1px solid rgba(212,160,23,0.3)' }}
              data-testid="cam-refresh-btn"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard icon={Users} label="Total Agents" value={totalAgents} sub={`${inMemory} loaded in-memory`} />
          <StatCard icon={Activity} label="Active Sessions" value={activeSessions} sub={`${totalRequests.toLocaleString()} requests`} />
          <StatCard icon={Eye} label="HITL Pending" value={hitlPending} sub="Awaiting human review" accent="#3FD78B" />
          <StatCard icon={AlertTriangle} label="Open Incidents" value={incidents} sub="Resolved within SLA" accent={incidents > 0 ? '#FF6B6B' : '#3FD78B'} />
          <StatCard icon={Brain} label="AI Maturity" value={`${aiMaturity}%`} sub="Composite score" />
          <StatCard icon={ShieldCheck} label="PII Patterns" value={piiPatterns} sub="DLP rules active" accent="#3FD78B" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2"><Zap className="h-4 w-4" style={{ color: '#C7B15B' }} /> Top Agents (Last 24h)</CardTitle>
              <CardDescription>Highest-volume legal agents by request count</CardDescription>
            </CardHeader>
            <CardContent>
              {dashLoading && (
                <div className="space-y-2" data-testid="loading-top-agents">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              )}
              {!dashLoading && topAgents.length === 0 && (
                <JrxEmptyState title="No agent traffic recorded in window" size="sm" />
              )}
              {!dashLoading && topAgents.length > 0 && (
                <div className="space-y-3">
                  {topAgents.slice(0, 8).map((a, i) => (
                    <div key={a.agentId ?? i} className="flex items-center justify-between text-sm">
                      <div className="flex flex-col">
                        <span className="text-slate-900 font-medium">{a.name || a.agentId || `Agent ${i + 1}`}</span>
                        <span className="text-xs">
                          {(a.requests ?? 0).toLocaleString()} req · {a.avgLatencyMs ?? '—'}ms avg
                        </span>
                      </div>
                      <Badge style={{ background: 'rgba(212,160,23,0.15)', color: '#C7B15B', border: '1px solid rgba(212,160,23,0.3)' }}>
                        {Math.round((a.successRate ?? 0) * 100)}% ok
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2"><Network className="h-4 w-4" style={{ color: '#C7B15B' }} /> Jurisdiction Coverage</CardTitle>
              <CardDescription>Agents per jurisdiction (§23 charter)</CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(byJur).length === 0 && (
                <JrxEmptyState title="Registry warming up" description="Jurisdiction coverage will appear once the agent registry reports in." size="sm" />
              )}
              <div className="space-y-3">
                {Object.entries(byJur).map(([j, n]) => {
                  const pct = totalAgents ? Math.round((n / totalAgents) * 100) : 0;
                  return (
                    <div key={j}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-900 font-medium">{j}</span>
                        <span>{n} ({pct}%)</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2"><Heart className="h-4 w-4" style={{ color: '#3FD78B' }} /> Self-Healing</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1" data-testid="cam-healing-card">
              {healingError ? (
                <JrxErrorState title="Stats endpoint unavailable" size="sm" />
              ) : (
                <>
                  <div>Failures: <span className="text-slate-900">{healing?.totalFailures ?? 0}</span></div>
                  <div>Recoveries: <span className="text-slate-900">{healing?.totalRecoveries ?? 0}</span></div>
                  <div>Recovery rate: <span className="text-slate-900">{((healing?.recoveryRate ?? 1) * 100).toFixed(1)}%</span></div>
                  <div>Avg recovery: <span className="text-slate-900">{Math.round(healing?.averageRecoveryTimeMs ?? 0)}ms</span></div>
                  <div>Circuit breakers: <span className="text-slate-900">{healing?.activeCircuitBreakers ?? 0}</span> <span className="text-xs" style={{ color: (healing?.openCircuitBreakers ?? 0) > 0 ? '#FF6B6B' : '#94A3B8' }}>({healing?.openCircuitBreakers ?? 0} open)</span></div>
                  <div>Uptime: <span className="text-slate-900">{(healing?.uptimePercentage ?? 100).toFixed(2)}%</span></div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2"><Gauge className="h-4 w-4" style={{ color: '#C7B15B' }} /> Guardrails</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1" data-testid="cam-guardrails-card">
              {guardrailsError ? (
                <JrxErrorState title="Stats endpoint unavailable" size="sm" />
              ) : (
                <>
                  <div>Total violations: <span className="text-slate-900">{guardrails?.totalViolations ?? 0}</span></div>
                  <div>Tracked since: <span className="text-slate-900 text-xs">{guardrails?.startedAt ? new Date(guardrails.startedAt).toLocaleString() : '—'}</span></div>
                  <div>Last violation: <span className="text-slate-900 text-xs">{guardrails?.lastViolation?.timestamp ? new Date(guardrails.lastViolation.timestamp).toLocaleString() : 'none'}</span></div>
                  {guardrails?.violationsByType && Object.keys(guardrails.violationsByType).length > 0 && (
                    <div className="pt-2 border-t mt-2">
                      {Object.entries(guardrails.violationsByType).slice(0, 4).map(([type, count]) => (
                        <div key={type} className="flex justify-between text-xs">
                          <span>{type}</span><span className="text-slate-900">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-slate-900 flex items-center gap-2"><ScrollText className="h-4 w-4" style={{ color: '#C7B15B' }} /> Routing Policy</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1" data-testid="cam-routing-card">
              {routingError ? (
                <JrxErrorState title="Stats endpoint unavailable" size="sm" />
              ) : (
                <>
                  <div>Tracked agents: <span className="text-slate-900">{routing?.summary?.trackedAgents ?? 0}</span></div>
                  <div>Active executions: <span className="text-slate-900">{routing?.summary?.totalActiveExecutions ?? 0}</span></div>
                  <div>Avg success: <span className="text-slate-900">{routing?.summary?.avgSuccessRate != null ? `${(routing.summary.avgSuccessRate * 100).toFixed(1)}%` : '—'}</span></div>
                  <div>P95 latency: <span className="text-slate-900">{routing?.summary?.avgP95LatencyMs ?? '—'}{routing?.summary?.avgP95LatencyMs != null ? 'ms' : ''}</span></div>
                  <div>Protocols: <span className="text-slate-900">{protocolsActive}/{protocolsTotal}</span></div>
                  {routing?.weights && routing.weights.length > 0 && (
                    <div className="pt-2 border-t mt-2 space-y-0.5">
                      <div className="text-xs uppercase tracking-wide">Top routes</div>
                      {routing.weights.slice(0, 5).map((w) => (
                        <div key={w.agentId} className="flex justify-between text-xs">
                          <span className="truncate max-w-[60%]" title={w.agentId}>{w.agentId}</span>
                          <span className="text-slate-900">{(w.composite * 100).toFixed(0)}% (T{w.tier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="text-xs text-center pt-4">
          Registry {agents?.registryVersion ?? '—'} ({agents?.registryFormat ?? '—'}) · §23 coverage: {agents?.section23Coverage ?? 0}/{totalAgents} · Auto-refresh every 30s
        </div>
      </div>
    </div>
  );
}
