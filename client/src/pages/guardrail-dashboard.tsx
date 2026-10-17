import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Guardrail Monitor Dashboard — Super Admin
 * Shows blocked requests, guardrail hit rate, blocked content categories,
 * recent guardrail events and model safety posture.
 * Jurexio Enterprise Platform 1.0.0
 */

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  ChevronRight, BarChart3, Activity, Clock, Zap, Eye, MinusCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Demo G1A (task-297): jurisdiction filter persisted in the URL.
const JURISDICTIONS = ['ALL', 'US', 'IN', 'EU', 'UK', 'GC', 'SG'] as const;
function readJurisdictionFromUrl(): string {
  if (typeof window === 'undefined') return 'ALL';
  const u = new URL(window.location.href);
  const j = (u.searchParams.get('jurisdiction') ?? 'ALL').toUpperCase();
  return (JURISDICTIONS as readonly string[]).includes(j) ? j : 'ALL';
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuardrailEvent {
  id: string;
  timestamp: string;
  endpoint: string;
  trigger: 'prompt' | 'response';
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  // task-297: 'not_applicable' is the third state — passed === null on the row.
  // Rendered grey, NOT red, and excluded from the headline pass rate denominator.
  action: 'blocked' | 'flagged' | 'modified' | 'passed' | 'not_applicable';
  passed?: boolean | null;
  org_id?: string;
  user_role?: string;
  details: string;
}

interface GuardrailStats {
  total_requests_24h: number;
  blocked_24h: number;
  flagged_24h: number;
  not_applicable_24h?: number;
  evaluated_24h?: number;
  passed_24h?: number;
  pass_rate: number | null;
  top_categories: Array<{ category: string; count: number; pct: number; evaluated?: number; total?: number }>;
  by_endpoint: Array<{ endpoint: string; blocked: number; total: number }>;
  by_severity: { low: number; medium: number; high: number; critical: number };
  recent_events: GuardrailEvent[];
  trend_14d?: Array<{ day: string; passed: number; failed: number; not_applicable: number; total: number; pass_rate: number | null }>;
  last_updated: string;
}

// ─── Empty/zero stats fallback (NV-NO-HARDCODE-001, 2026-06-25) ───────────────
// Previously this returned fabricated demo numbers (4821 requests, fake events,
// invented PII/injection incidents) that were merged into the live response and
// shown as real guardrail telemetry. Per the no-hardcoded-data requirement the
// fallback is now a true EMPTY state: zeros + empty arrays, so the page renders
// a clean "no guardrail activity yet" view until the audit endpoint returns
// real data (GET /api/jrx/audit/guardrail-stats).
function buildEmptyStats(): GuardrailStats {
  return {
    total_requests_24h: 0,
    blocked_24h: 0,
    flagged_24h: 0,
    pass_rate: null,
    top_categories: [],
    by_endpoint: [],
    by_severity: { low: 0, medium: 0, high: 0, critical: 0 },
    recent_events: [],
    last_updated: new Date().toISOString(),
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { color: 'text-red-700', bg: 'bg-red-50 border-red-200', dot: 'bg-red-500', bar: 'bg-red-500' },
  high:     { color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', dot: 'bg-orange-500', bar: 'bg-orange-500' },
  medium:   { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-400', bar: 'bg-amber-400' },
  low:      { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', dot: 'bg-blue-400', bar: 'bg-blue-400' },
};

const ACTION_CONFIG: Record<string, { color: string; Icon: typeof XCircle }> = {
  blocked:        { color: 'text-red-600',     Icon: XCircle },
  flagged:        { color: 'text-amber-600',   Icon: AlertTriangle },
  modified:       { color: 'text-blue-600',    Icon: Eye },
  passed:         { color: 'text-emerald-600', Icon: CheckCircle2 },
  // task-297: NULL `passed` → grey "not applicable" bucket, not a red fail.
  not_applicable: { color: 'text-slate-700',   Icon: MinusCircle },
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GuardrailDashboard() {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [jurisdiction, setJurisdiction] = useState<string>(readJurisdictionFromUrl);
  // NV-NO-HARDCODE-001 (2026-06-25): fallback is now a true empty/zero state
  // (no fabricated demo telemetry). Real numbers come from the live query below.
  const [stats] = useState<GuardrailStats>(() => buildEmptyStats());

  // task-297: persist jurisdiction in URL so /console/guardrail-monitor?jurisdiction=US deep-links.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (jurisdiction === 'ALL') u.searchParams.delete('jurisdiction');
    else u.searchParams.set('jurisdiction', jurisdiction);
    window.history.replaceState(null, '', u.toString());
  }, [jurisdiction]);

  const { data: liveData, isLoading, refetch } = useQuery({
    queryKey: ['guardrail-stats', jurisdiction],
    queryFn: async () => {
      const token = getAuthToken();
      const qs = jurisdiction === 'ALL' ? '' : `?jurisdiction=${jurisdiction}`;
      const res = await fetch(nv(`audit/guardrail-stats${qs}`), {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    retry: 0,
    refetchInterval: 30000,
  });

  // NV-UI-FIX-2026-05-13: defensively merge live envelope with the mock so
  // a partial response (missing recent_events / by_severity) never crashes
  // the .filter / .map calls below.
  const live = (liveData?.data ?? liveData ?? null) as Partial<GuardrailStats> | null;
  const displayStats: GuardrailStats = {
    ...stats,
    ...(live ?? {}),
    recent_events: (live?.recent_events && Array.isArray(live.recent_events)) ? live.recent_events : stats.recent_events,
    by_severity:   { ...stats.by_severity, ...(live?.by_severity ?? {}) },
    top_categories: Array.isArray(live?.top_categories) ? live!.top_categories : stats.top_categories,
    by_endpoint:   Array.isArray(live?.by_endpoint)   ? live!.by_endpoint   : stats.by_endpoint,
    trend_14d:     Array.isArray(live?.trend_14d)     ? live!.trend_14d     : stats.trend_14d,
  };
  // task-297: pass-rate denominator is evaluated rows only (passed !== null).
  // The backend already returns pass_rate = passed / (passed + failed); we
  // defensively recompute on the client too in case stale mock data leaks in.
  const evaluated = displayStats.evaluated_24h ?? Math.max(0, (displayStats.total_requests_24h ?? 0) - (displayStats.not_applicable_24h ?? 0));
  const headlineRate = evaluated > 0
    ? (displayStats.pass_rate ?? ((displayStats.passed_24h ?? 0) / evaluated))
    : 0;
  const passRate = Math.round(headlineRate * 100 * 100) / 100;
  const blockRate = Math.max(0, 100 - passRate).toFixed(2);
  const naCount = displayStats.not_applicable_24h ?? 0;

  const filteredEvents = displayStats.recent_events.filter((e: GuardrailEvent) => {
    if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-700 mb-2">
          <Shield className="w-3.5 h-3.5" /> Super Admin
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#C7B15B]">Guardrail Monitor</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
              <Shield className="w-6 h-6 text-[#C7B15B]" /> AI Guardrail Monitor
            </h1>
            <p className="text-slate-600 mt-1 text-sm">Real-time view of guardrail enforcement — blocked prompts, flagged responses, and safety posture</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse inline-block" />
              Guardrails Active
            </Badge>
            <Select value={jurisdiction} onValueChange={setJurisdiction}>
              <SelectTrigger className="bg-white border-slate-200 text-xs h-8 w-32" data-testid="select-jurisdiction-guardrail">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {JURISDICTIONS.map((j) => (
                  <SelectItem key={j} value={j} className="text-xs">{j === 'ALL' ? 'All jurisdictions' : j}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-700 hover:text-slate-800 text-xs">
              <RefreshCw className={cn('w-3.5 h-3.5 mr-1', isLoading && 'animate-spin')} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Row — task-297: pass-rate excludes "not applicable" rows from the
          denominator so a NULL `passed` no longer drags the demo to 0%. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: `Requests (24h${jurisdiction === 'ALL' ? '' : ' · ' + jurisdiction})`, value: displayStats.total_requests_24h.toLocaleString(), icon: Activity, color: 'text-blue-600' },
          { label: 'Blocked',        value: displayStats.blocked_24h,        icon: XCircle,       color: 'text-red-600' },
          { label: 'Flagged',        value: displayStats.flagged_24h,        icon: AlertTriangle, color: 'text-amber-600' },
          { label: 'Not applicable', value: naCount,                          icon: MinusCircle,   color: 'text-slate-700' },
          { label: 'Pass Rate',      value: `${passRate}%`,                   icon: CheckCircle2,  color: 'text-emerald-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white border-slate-200 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-700 mb-1">{label}</p>
                  <p className={cn('text-2xl font-black', color)}>{value}</p>
                </div>
                <Icon className={cn('w-5 h-5 mt-0.5', color)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pass rate bar */}
      <Card className="bg-white border-slate-200 shadow-sm mb-6">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-700 font-medium">Overall safety pass rate (24h)</span>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-emerald-600 font-bold">{passRate}% pass</span>
              <span className="text-red-600">{blockRate}% blocked</span>
            </div>
          </div>
          <div className="relative h-3 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
              style={{ width: `${passRate}%` }} />
            <div className="absolute right-0 top-0 h-full bg-red-500 rounded-full transition-all duration-700"
              style={{ width: `${blockRate}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-700">
            <span>Last refreshed: {new Date(displayStats.last_updated).toLocaleTimeString()}</span>
            {liveData ? <span className="text-emerald-600">● Live data</span> : <span className="text-amber-600">● Demo data — connect audit log endpoint</span>}
          </div>
        </CardContent>
      </Card>

      {/* 14-day trend — task-297. Renders /audit/guardrail-stats.trend_14d as a
          stacked-bar timeline (pass / fail / NA) plus the per-day pass-rate
          line on top. Pass-rate is computed over evaluated rows only
          (passed + failed) so NA bars never deflate the headline. */}
      <Card className="bg-white border-slate-200 shadow-sm mb-6" data-testid="card-guardrail-trend-14d">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#C7B15B]" /> Pass-rate trend — last 14 days
            {jurisdiction !== 'ALL' && <Badge variant="outline" className="text-[10px]">{jurisdiction}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const trend = displayStats.trend_14d ?? [];
            if (trend.length === 0) return <p className="text-xs text-slate-700">No trend data yet.</p>;
            const maxTotal = Math.max(1, ...trend.map((d) => d.total));
            const avg = (() => {
              const totalP = trend.reduce((a, d) => a + d.passed, 0);
              const totalF = trend.reduce((a, d) => a + d.failed, 0);
              return totalP + totalF > 0 ? (totalP / (totalP + totalF)) * 100 : 0;
            })();
            return (
              <>
                <div className="flex items-end gap-1 h-32 mb-2" role="img" aria-label="14-day guardrail pass-rate trend">
                  {trend.map((d) => {
                    const totalH = (d.total / maxTotal) * 100;
                    const passH  = d.total > 0 ? (d.passed / d.total) * totalH : 0;
                    const failH  = d.total > 0 ? (d.failed / d.total) * totalH : 0;
                    const naH    = d.total > 0 ? (d.not_applicable / d.total) * totalH : 0;
                    const pct    = d.pass_rate == null ? '—' : `${Math.round(d.pass_rate * 100)}%`;
                    const day    = new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    return (
                      <div key={d.day} className="flex-1 flex flex-col-reverse items-stretch group relative" title={`${day}: ${d.passed} pass / ${d.failed} fail / ${d.not_applicable} N-A · ${pct}`}>
                        <div className="bg-emerald-500" style={{ height: `${passH}%` }} />
                        <div className="bg-red-500"     style={{ height: `${failH}%` }} />
                        <div className="bg-slate-300"   style={{ height: `${naH}%` }}   />
                        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-slate-700 whitespace-nowrap">{day.split(' ')[1]}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-6 text-[11px] text-slate-600">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-emerald-500" /> Passed</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-red-500" />     Failed</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-slate-300" />   Not applicable</span>
                  <span className="ml-auto font-medium text-slate-700">14-day pass-rate (evaluated only): <span className="text-emerald-700 font-bold">{avg.toFixed(1)}%</span></span>
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Top Categories */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#C7B15B]" /> Block Categories
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {displayStats.top_categories.map((cat: { category: string; count: number; pct: number }) => (
              <div key={cat.category}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-700">{cat.category}</span>
                  <span className="text-xs font-bold text-[#C7B15B]">{cat.count} · {cat.pct}%</span>
                </div>
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[#C7B15B] rounded-full" style={{ width: `${cat.pct}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* By Endpoint */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" /> Block Rate by Endpoint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {displayStats.by_endpoint.map((ep: { endpoint: string; blocked: number; total: number }) => {
              const rate = ((ep.blocked / ep.total) * 100).toFixed(1);
              return (
                <div key={ep.endpoint}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-slate-600 truncate">{ep.endpoint}</span>
                    <span className="text-xs font-bold text-red-600 flex-shrink-0 ml-2">{ep.blocked} ({rate}%)</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(parseFloat(rate) * 10, 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* By Severity */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" /> Severity Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(Object.entries(displayStats.by_severity) as [string, number][]).reverse().map(([severity, count]) => {
              const cfg = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG];
              const total = Object.values(displayStats.by_severity as Record<string, number>).reduce((a, b) => a + b, 0);
              const pct = Math.round((count / total) * 100);
              return (
                <div key={severity}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} />
                    <span className="text-xs text-slate-700 capitalize flex-1">{severity}</span>
                    <span className={cn('text-xs font-bold', cfg.color)}>{count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', cfg.bar)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Recent Events */}
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#C7B15B]" /> Recent Guardrail Events ({filteredEvents.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="bg-white border-slate-200 text-xs h-7 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="all" className="text-xs">All severities</SelectItem>
                  <SelectItem value="critical" className="text-xs">Critical</SelectItem>
                  <SelectItem value="high" className="text-xs">High</SelectItem>
                  <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                  <SelectItem value="low" className="text-xs">Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="bg-white border-slate-200 text-xs h-7 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="all" className="text-xs">All actions</SelectItem>
                  <SelectItem value="blocked" className="text-xs">Blocked</SelectItem>
                  <SelectItem value="flagged" className="text-xs">Flagged</SelectItem>
                  <SelectItem value="modified" className="text-xs">Modified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <NyvEmptyState icon={Shield} title="No events match filters" description="Adjust severity or action filters to see more events." size="sm" />
          ) : (
            <div className="space-y-2">
              {filteredEvents.map((event: GuardrailEvent) => {
                const sev = SEVERITY_CONFIG[event.severity];
                const { Icon: ActionIcon, color: actionColor } = ACTION_CONFIG[event.action];
                return (
                  <div key={event.id} className={cn('p-3 rounded-lg border', sev.bg)}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ActionIcon className={cn('w-4 h-4 flex-shrink-0', actionColor)} />
                        <span className={cn('text-xs font-bold uppercase', actionColor)}>{event.action}</span>
                        <Badge variant="outline" className={cn('border text-[10px]', sev.bg, sev.color)}>
                          {event.severity}
                        </Badge>
                        <span className="text-xs text-slate-600">{event.category}</span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-slate-700">{timeAgo(event.timestamp)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-700 mb-1.5">
                      <span className="font-mono">{event.endpoint}</span>
                      <span>·</span>
                      <span className="capitalize">{event.trigger}</span>
                      {event.org_id && <><span>·</span><span>{event.org_id}</span></>}
                      {event.user_role && <><span>·</span><span className="capitalize">{event.user_role}</span></>}
                    </div>
                    <p className="text-xs text-slate-700">{event.details}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
