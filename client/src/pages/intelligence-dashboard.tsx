import { getAuthToken } from '@/lib/jrx-auth-token';
/**
 * Jurexio Intelligence Dashboard — E1 Frontend Consumer
 * Calls POST /api/jrx/v1/sdk/intelligence/dashboard-insights
 */

import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NV_API } from '@/lib/jrx-api-paths';
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Clock, Briefcase, Scale, BarChart3, Activity, RefreshCw,
  ChevronRight, Star, Shield, Zap, FileText, Target,
  Users, DollarSign, Calendar, ArrowUpRight, ArrowDownRight,
  Sparkles, Info,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardInsight {
  summary: string;
  key_metrics: {
    active_cases: number;
    hearings_this_week: number;
    deadlines_7d: number;
    risk_alerts: number;
    avg_case_health: number;
    revenue_trend: string;
  };
  urgent_actions: Array<{ action: string; priority: 'critical' | 'high' | 'medium'; deadline: string }>;
  top_risks: Array<{ case: string; risk: string; score: number }>;
  performance_insights: string[];
  jurisdiction_activity: Record<string, number>;
  ai_recommendations: string[];
  generated_at: string;
  tokens_used: number;
}

interface FirmData {
  firm_name: string;
  active_cases: number;
  pending_hearings: number;
  overdue_tasks: number;
  revenue_ytd_inr: number;
  jurisdiction: string;
}

// Firm snapshot is fetched from /api/jrx/v1/sdk/intelligence/firm-snapshot
// (task-199: derives the caller's real firm metrics from nv_cases /
// nv_hearing_metadata / nv_invoices). When the caller has no organization
// context (or the org has no cases yet), the endpoint returns data:null
// and we render an empty state below.

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon: Icon, trend, color = 'text-blue-400', subtitle,
}: {
  label: string; value: string | number; icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral'; color?: string; subtitle?: string;
}) {
  return (
    <Card className="bg-white border-slate-200" aria-label={`${label}: ${value}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className="text-2xl font-bold text-[#152448]">{value}</p>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className={cn('p-2 rounded-lg bg-slate-50', color)}>
            <Icon className="w-4 h-4" aria-hidden="true" />
          </div>
        </div>
        {trend && (
          <div className={cn('flex items-center gap-1 mt-2 text-xs', trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400')}>
            {trend === 'up' && <ArrowUpRight className="w-3 h-3" aria-hidden="true" />}
            {trend === 'down' && <ArrowDownRight className="w-3 h-3" aria-hidden="true" />}
            {trend === 'up' ? 'Trending up' : trend === 'down' ? 'Needs attention' : 'Stable'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceDashboard() {
  const { toast } = useToast();
  const [insight, setInsight] = useState<DashboardInsight | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const firmSnapshotQuery = useQuery<FirmData | null>({
    queryKey: [NV_API.INTEL_FIRM_SNAPSHOT.path],
    queryFn: async () => {
      const token = getAuthToken();
      // Task #337 (2026-05-13): firm-snapshot is mounted under sdkGatewayAuth
      // (which has a JWT-bypass for INTERNAL_JWT_ROLES, but only when a JWT
      // is actually present). Sending BOTH headers makes the call robust:
      //   • Console session  → JWT bypass picks up Bearer token
      //   • Standalone NSP   → X-API-Key resolves the SDK app context
      // The SDK key is stashed in localStorage by the platform-v5 admin
      // bootstrap (`nyv.admin.sdkKey`); fall back gracefully when missing.
      const sdkKey =
        (typeof localStorage !== 'undefined' && localStorage.getItem('nyv.admin.sdkKey')) || '';
      const resp = await fetch(NV_API.INTEL_FIRM_SNAPSHOT.path, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(sdkKey ? { 'X-API-Key': sdkKey } : {}),
        },
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as { firm?: FirmData; data?: FirmData } | FirmData | null;
      if (!data) return null;
      if ('firm' in data && data.firm) return data.firm;
      if ('data' in data && data.data) return data.data;
      if ('firm_name' in (data as FirmData)) return data as FirmData;
      return null;
    },
    retry: false,
  });

  const firmData = firmSnapshotQuery.data ?? null;

  const insightMutation = useMutation({
    mutationFn: async () => {
      // NV-UAT-DEFAULT-ORG-001: don't hard-block on missing firm data —
      // pass an empty stub so the LRM still produces a useful demo briefing.
      const safeFirm = firmData ?? { firm_name: 'Demo Firm (org_id=1)', jurisdiction: 'IN', active_cases: 0, pending_hearings: 0, overdue_tasks: 0, revenue_ytd_inr: 0 } as FirmData;
      const token = getAuthToken();
      const resp = await fetch(NV_API.INTEL_DASHBOARD_INSIGHTS.path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          firm_data: safeFirm,
          jurisdiction: safeFirm.jurisdiction,
          date: new Date().toISOString(),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: (data) => {
      setInsight(data.intelligence ?? data);
      setLastRefreshed(new Date().toLocaleTimeString());
      toast({ title: 'Intelligence refreshed', description: 'Dashboard insights updated with latest AI analysis' });
    },
    onError: (err: Error) => {
      toast({ title: 'Intelligence failed', description: err.message, variant: 'destructive' });
    },
  });

  const priorityColor: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-amber-50 text-amber-700 border-amber-200',
    medium: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="Intelligence Dashboard">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-blue-700">
              <Brain className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">Intelligence Dashboard</h1>
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">E1 · AI Insights</Badge>
          </div>
          <p className="text-sm text-slate-400">Morning briefing powered by Jurexio AI — legal intelligence for your firm</p>
          {lastRefreshed && <p className="text-xs text-slate-500 mt-1">Last refreshed: {lastRefreshed}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => insightMutation.mutate()}
            disabled={insightMutation.isPending}
            className="bg-[#152448] hover:bg-[#0a3580] text-white"
            aria-label="Refresh intelligence insights"
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', insightMutation.isPending && 'animate-spin')} aria-hidden="true" />
            {insightMutation.isPending ? 'Analysing...' : 'Generate Insights'}
          </Button>
        </div>
      </div>

      {/* Narrative Banner — only when firm snapshot is wired */}
      {firmData && (
        <Card className="bg-gradient-to-r from-[#152448] to-blue-800 border-none mb-6">
          <CardContent className="p-4">
            <p className="text-blue-100 text-sm leading-relaxed">
              <span className="text-[#C7B15B] font-semibold">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}.</span>{' '}
              {firmData.firm_name} has <span className="text-white font-semibold">{firmData.active_cases} active cases</span> with{' '}
              <span className="text-white font-semibold">{firmData.pending_hearings} hearings</span> this week.
              {firmData.overdue_tasks > 0 && <> <span className="text-amber-300 font-semibold">{firmData.overdue_tasks} overdue task{firmData.overdue_tasks !== 1 ? 's' : ''}</span> need attention.</>}
              {' '}Click <strong className="text-[#C7B15B]">Generate Insights</strong> for your AI-powered briefing.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Firm snapshot — real metrics when wired, EmptyState until then */}
      {firmData ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <MetricCard label="Active Cases" value={firmData.active_cases} icon={Briefcase} color="text-blue-400" trend="neutral" />
          <MetricCard label="Hearings This Week" value={firmData.pending_hearings} icon={Calendar} color="text-purple-400" trend="up" />
          <MetricCard label="Overdue Tasks" value={firmData.overdue_tasks} icon={AlertTriangle} color="text-amber-400" trend="down" />
          <MetricCard label="Revenue YTD" value={`₹${(firmData.revenue_ytd_inr / 100000).toFixed(1)}L`} icon={DollarSign} color="text-emerald-400" trend="up" />
        </div>
      ) : (
        <div className="mb-6">
          <NyvEmptyState
            icon={Briefcase}
            title="Firm snapshot warming up"
            description="The dashboard is connected to your organisation. Live firm metrics (active cases, hearings this week, overdue tasks, revenue YTD) appear here once the org has matter / hearing / invoice rows. Click 'Generate Insights' anyway — the LRM will produce a briefing from the available demo data."
            variant="card"
          />
        </div>
      )}

      {/* AI Insight Panel */}
      {!insight && !insightMutation.isPending && (
        <Card className="bg-white border-slate-200 mb-6">
          <CardContent className="p-8 text-center">
            <div className="flex items-center justify-center mb-4">
              <div className="p-4 rounded-full bg-slate-100">
                <Sparkles className="w-8 h-8 text-[#C7B15B]" aria-hidden="true" />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-[#152448] mb-2">Ready for AI Analysis</h3>
            <p className="text-slate-400 text-sm mb-4">Click "Generate Insights" to generate your morning briefing using Jurexio E1 Intelligence</p>
            <p className="text-xs text-slate-500">Powered by ROMA L5 agents · Legal knowledge across 6 jurisdictions</p>
          </CardContent>
        </Card>
      )}

      {insightMutation.isPending && (
        <Card className="bg-white border-slate-200 mb-6">
          <CardContent className="p-8 text-center">
            <div className="flex items-center justify-center mb-4">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-[#152448] border-t-[#C7B15B]" />
            </div>
            <p className="text-[#1A3A60] text-sm font-medium">Jurexio is analysing your firm data...</p>
            <p className="text-slate-500 text-xs mt-1">ROMA L5 agents processing · Legal intelligence synthesising</p>
          </CardContent>
        </Card>
      )}

      {insight && (
        <div className="space-y-4">
          {/* AI Summary */}
          <Card className="bg-white border-[#152448]/20 border">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-[#C7B15B]" aria-hidden="true" />
                <CardTitle className="text-sm font-semibold text-[#1A3A60]">AI Morning Briefing</CardTitle>
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs ml-auto">
                  <CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />Live Intelligence
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-[#2A4A70] text-sm leading-relaxed">{insight.summary}</p>
              {insight.tokens_used && (
                <p className="text-xs text-slate-600 mt-2">
                  <Zap className="w-3 h-3 inline mr-1" aria-hidden="true" />
                  {insight.tokens_used.toLocaleString()} tokens consumed
                </p>
              )}
            </CardContent>
          </Card>

          {/* Key Metrics from AI */}
          {insight.key_metrics && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <MetricCard label="AI: Active Cases" value={insight.key_metrics.active_cases} icon={Briefcase} color="text-blue-400" />
              <MetricCard label="Hearings This Week" value={insight.key_metrics.hearings_this_week} icon={Calendar} color="text-purple-400" />
              <MetricCard label="Deadlines (7d)" value={insight.key_metrics.deadlines_7d} icon={Clock} color="text-amber-400" />
              <MetricCard label="Risk Alerts" value={insight.key_metrics.risk_alerts} icon={AlertTriangle} color="text-red-400" />
              <MetricCard label="Avg Case Health" value={`${insight.key_metrics.avg_case_health}%`} icon={Activity} color="text-emerald-400" />
              <MetricCard label="Revenue Trend" value={insight.key_metrics.revenue_trend ?? 'Stable'} icon={TrendingUp} color="text-cyan-400" />
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {/* Urgent Actions */}
            {insight.urgent_actions?.length > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#1A3A60] flex items-center gap-2">
                    <Target className="w-4 h-4 text-amber-400" aria-hidden="true" /> Urgent Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {insight.urgent_actions.map((action, i) => (
                    <div key={i} className={cn('p-2.5 rounded-lg border text-xs', priorityColor[action.priority] ?? 'bg-slate-50 text-[#2A4A70] border-slate-200')}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{action.action}</p>
                        <Badge className={cn('text-[9px] flex-shrink-0', priorityColor[action.priority] ?? '')} aria-label={`Priority: ${action.priority}`}>
                          {action.priority}
                        </Badge>
                      </div>
                      {action.deadline && <p className="text-slate-500 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" />{action.deadline}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Top Risks */}
            {insight.top_risks?.length > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#1A3A60] flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" aria-hidden="true" /> Case Risk Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {insight.top_risks.map((risk, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-[#152448] truncate">{risk.case}</p>
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', risk.score >= 70 ? 'bg-red-50 text-red-700' : risk.score >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700')} aria-label={`Risk score: ${risk.score}`}>
                          {risk.score}
                        </span>
                      </div>
                      <p className="text-slate-400">{risk.risk}</p>
                      <Progress value={risk.score} className="h-1 mt-1.5" aria-label={`Risk progress: ${risk.score}%`} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* AI Recommendations */}
          {insight.ai_recommendations?.length > 0 && (
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-[#1A3A60] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#C7B15B]" aria-hidden="true" /> AI Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {insight.ai_recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 text-xs text-[#2A4A70]">
                      <ChevronRight className="w-3.5 h-3.5 text-[#C7B15B] mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
