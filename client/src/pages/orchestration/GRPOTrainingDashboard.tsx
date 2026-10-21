/**
 * Jurexio — GRPO Training Dashboard (Gap #10)
 *
 * Session-15 v12 (2026-05-11). Rebuild of the prior 16-LOC "Coming in next
 * release" stub at this same path. Closes Gap #10 in
 * `docs/audit/feature-matrix-and-status-2026-05-11.md` §2.
 *
 * Wired against REAL JWT-auth backend endpoints (verified by direct read of
 * route handlers — NV-CONTRACT-001 / NV-OWNERSHIP-001 discipline; no
 * fabricated field names):
 *
 *   GET  /api/jrx/phase5/grpo/stats?agentKey=&limit=
 *        → src/routes/jrx-phase5-routes.ts:476
 *        → { success, data:{ description, topAgents[], feedbackAnalysis|{message}, generatedAt } }
 *
 *   GET  /api/jrx/phase5/grpo/suggestions?agentKey=
 *        → src/routes/jrx-phase5-routes.ts:496
 *        → { success, data: <generateImprovementSuggestions output> }
 *
 *   GET  /api/jrx/admin/roma-l5/grpo/episodes?limit=
 *        → src/routes/jrx-roma-l5-admin-routes.ts:181 (admin role required)
 *        → { success, data:{ episodes:[{episodeId,agentId,rewardScore,groupSize,
 *                                       taskType,jurisdiction,model,latencyMs,createdAt}], total }, meta }
 *
 *   POST /api/jrx/patterns/grpo
 *        → src/routes/jrx-patterns-routes.ts:1768
 *        → body: { task, jurisdiction, agentId?, outputId?, outputContent?,
 *                   advocateScores:{legalAccuracy,citationQuality,practicalUsability,
 *                                   jurisdictionPrecision,riskAssessmentAccuracy,completeness} }
 *        → response: { pattern, traceId, agentId, outputId, advocateScores,
 *                      rewardFunction:{formula,rawReward,normalizedReward},
 *                      policyUpdateApplied, policyUpdateDetails, cumulativeStats:{
 *                        totalEpisodes,totalResponses,averageReward,totalPolicyUpdates,
 *                        preferencePairsStored,currentPolicy,lastUpdateTimestamp,
 *                        rewardTrendLastN[] }, ... }
 *
 * The SDK-key-protected `/api/jrx/gateway/optimization/grpo/{policy,stats,
 * dimensions}` endpoints are intentionally NOT consumed here — Console is
 * JWT-only. Live policy + cumulative stats are surfaced via the response
 * envelope of POST /patterns/grpo (which calls the same singleton).
 *
 * Architecture compliance:
 *   - NV-ARCH-001: read-mostly. The single mutating call (POST /patterns/grpo)
 *     is an intentional advocate-feedback submission, not an LLM-emitting
 *     orchestration call — it traverses the existing pattern safety pipeline.
 *   - NV-AUTH-HEADER-001: every request via shared apiRequest from
 *     @/lib/queryClient (JWT in Authorization header).
 *   - NV-WIRING-001: already routed in client/src/App.tsx (no wiring change).
 *   - Forward-compat with Playwright suite: every interactive element
 *     carries data-testid.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import {
  Activity, AlertTriangle, BarChart3, Brain, CheckCircle2, ChevronRight,
  Lightbulb, RefreshCw, Send, Sparkles, Target, TrendingUp, XCircle,
} from 'lucide-react';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
import { useNvRegistryMeta } from '@/hooks/useNvRegistryMeta';
// ─── Types — match backend exactly ──────────────────────────────────────────

interface TopAgent {
  agentKey?: string;
  agentId?: string;
  averageReward?: number;
  totalRuns?: number;
  successRate?: number;
  // Backend shape is inferred via `getTopPerformingAgents` — keep loose
  // and render whatever fields are present.
  [key: string]: unknown;
}

// NOTE: shared `apiRequest` in @/lib/queryClient auto-unwraps the
// {success,data} envelope and throws on {success:false}. So query data
// is already the INNER `data` object (or array). The POST handler at
// /api/jrx/patterns/grpo does NOT use the {success,data} envelope — it
// returns the response object directly — so the mutation type is the
// full envelope as documented.
interface StatsData {
  description?: string;
  topAgents?: TopAgent[];
  feedbackAnalysis?: { message?: string } | Record<string, unknown> | null;
  generatedAt?: string;
}

type SuggestionsData = (Record<string, unknown> & {
  suggestions?: Array<string | { text?: string; rationale?: string; priority?: string }>;
}) | Array<string | { text?: string; rationale?: string; priority?: string }>;

interface SdkGrpoStats {
  totalEpisodes?: number;
  totalResponses?: number;
  averageReward?: number;
  totalPolicyUpdates?: number;
  preferencePairsStored?: number;
  currentPolicy?: unknown;
  lastUpdateTimestamp?: string;
  rewardTrendLastN?: number[];
}

interface SdkGrpoPolicy {
  version?: string;
  dimensions?: string[];
  [key: string]: unknown;
}

interface Episode {
  episodeId: string;
  agentId: string;
  rewardScore: number;
  groupSize: number;
  taskType: string;
  jurisdiction: string;
  model: string;
  latencyMs: number;
  createdAt: string;
}
interface EpisodesData { episodes?: Episode[]; total?: number }

interface AdvocateScores {
  legalAccuracy: number;
  citationQuality: number;
  practicalUsability: number;
  jurisdictionPrecision: number;
  riskAssessmentAccuracy: number;
  completeness: number;
}

interface FeedbackResponse {
  pattern?: string;
  traceId?: string;
  agentId?: string;
  outputId?: string;
  advocateScores?: AdvocateScores;
  rewardFunction?: { formula: string; rawReward: number; normalizedReward: string };
  policyUpdateApplied?: boolean;
  policyUpdateDetails?: Record<string, unknown>;
  cumulativeStats?: {
    totalEpisodes: number;
    totalResponses: number;
    averageReward: number;
    totalPolicyUpdates: number;
    preferencePairsStored: number;
    currentPolicy?: { temperature?: number; topP?: number; frequencyPenalty?: number; presencePenalty?: number };
    lastUpdateTimestamp?: string | null;
    rewardTrendLastN?: number[];
  };
  patternDescription?: string;
  performanceMs?: number;
  error?: unknown;
}

const SCORE_KEYS: Array<keyof AdvocateScores> = [
  'legalAccuracy',
  'citationQuality',
  'practicalUsability',
  'jurisdictionPrecision',
  'riskAssessmentAccuracy',
  'completeness',
];

const SCORE_LABEL: Record<keyof AdvocateScores, string> = {
  legalAccuracy:           'Legal Accuracy',
  citationQuality:         'Citation Quality',
  practicalUsability:      'Practical Usability',
  jurisdictionPrecision:   'Jurisdiction Precision',
  riskAssessmentAccuracy:  'Risk-Assessment Accuracy',
  completeness:            'Completeness',
};

// Reward formula = (acc·0.4) + (cit·0.3) + (use·0.2) + (jx·0.1) — only the
// first four are weighted by the backend; risk + completeness are recorded
// for future weighting.
function computeRewardPreview(s: AdvocateScores): number {
  return (s.legalAccuracy * 0.4 + s.citationQuality * 0.3 + s.practicalUsability * 0.2 + s.jurisdictionPrecision * 0.1) / 10;
}

import { JRX_JURISDICTION_PICKER_CODES } from '@/constants/jrx-jurisdictions';
const JURISDICTIONS = [...JRX_JURISDICTION_PICKER_CODES, 'Default'] as const;

function fmtPct(n: number | undefined, digits = 1): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}
function fmtNum(n: number | undefined, digits = 0): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function fmtTs(iso: string | undefined | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function GRPOTrainingDashboard() {
  const [agentKey, setAgentKey] = useState<string>('');
  const [activeAgentKey, setActiveAgentKey] = useState<string>('');
  const { totalAgents, registryVersion } = useNvRegistryMeta();

  // SDK optimization singleton (JWT via sdkGatewayAuth internal bypass)
  const sdkGrpoStatsQ = useQuery<SdkGrpoStats>({
    queryKey: [nv('v1/sdk/optimization/grpo/stats')],
    queryFn: () => apiRequest(nv('v1/sdk/optimization/grpo/stats'), 'GET') as Promise<SdkGrpoStats>,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const sdkGrpoPolicyQ = useQuery<SdkGrpoPolicy>({
    queryKey: [nv('v1/sdk/optimization/grpo/policy')],
    queryFn: () => apiRequest(nv('v1/sdk/optimization/grpo/policy'), 'GET') as Promise<SdkGrpoPolicy>,
    staleTime: 30_000,
    retry: false,
  });

  // ── Stats (top agents + optional per-agent feedback) ────────────────────
  const statsQ = useQuery<StatsData>({
    queryKey: [nv('phase5/grpo/stats'), { agentKey: activeAgentKey, limit: 20 }],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '20' });
      if (activeAgentKey) qs.set('agentKey', activeAgentKey);
      return apiRequest(`${NV_BASE}phase5/grpo/stats?${qs.toString()}`, 'GET') as Promise<StatsData>;
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  // ── Suggestions (per-agent only) ────────────────────────────────────────
  const suggestionsQ = useQuery<SuggestionsData>({
    queryKey: [nv('phase5/grpo/suggestions'), { agentKey: activeAgentKey }],
    queryFn: () =>
      apiRequest(
        `${NV_BASE}phase5/grpo/suggestions?agentKey=${encodeURIComponent(activeAgentKey)}`,
        'GET',
      ) as Promise<SuggestionsData>,
    enabled: !!activeAgentKey,
    staleTime: 30_000,
  });

  // ── Episodes (admin-only — handler returns 403 otherwise) ───────────────
  const episodesQ = useQuery<EpisodesData>({
    queryKey: [nv('admin/roma-l5/grpo/episodes'), { limit: 50 }],
    queryFn: () =>
      apiRequest(nv('admin/roma-l5/grpo/episodes?limit=50'), 'GET') as Promise<EpisodesData>,
    staleTime: 30_000,
    retry: false, // suppress retry storm on 403
  });

  // ── Submit feedback (POST /patterns/grpo) ───────────────────────────────
  const [task, setTask] = useState<string>('Review the doctrine of frustration in the supplied contract clause.');
  const [jurisdiction, setJurisdiction] = useState<typeof JURISDICTIONS[number]>('IN');
  const [feedbackAgentId, setFeedbackAgentId] = useState<string>('');
  const [outputContent, setOutputContent] = useState<string>('');
  const [scores, setScores] = useState<AdvocateScores>({
    legalAccuracy: 8,
    citationQuality: 8,
    practicalUsability: 7,
    jurisdictionPrecision: 8,
    riskAssessmentAccuracy: 8,
    completeness: 7,
  });

  const submitMutation = useMutation<FeedbackResponse, Error, void>({
    mutationFn: async () =>
      (await apiRequest(nv('patterns/grpo'), 'POST', {
        task,
        jurisdiction,
        agentId: feedbackAgentId || undefined,
        outputContent: outputContent || undefined,
        advocateScores: scores,
      })) as FeedbackResponse,
    onSuccess: () => {
      // refresh leaderboard so new submission counts toward stats
      queryClient.invalidateQueries({ queryKey: [nv('phase5/grpo/stats')] });
    },
  });

  const lastResult = submitMutation.data;
  const cumulative = lastResult?.cumulativeStats ?? sdkGrpoStatsQ.data;
  const livePolicy = sdkGrpoPolicyQ.data;

  // ── Derived ─────────────────────────────────────────────────────────────
  // apiRequest already unwrapped {success,data} → these are the inner shapes.
  const topAgents = statsQ.data?.topAgents ?? [];
  const feedbackAnalysis = statsQ.data?.feedbackAnalysis ?? null;
  const feedbackAnalysisHasData =
    !!feedbackAnalysis && typeof feedbackAnalysis === 'object' && !('message' in feedbackAnalysis);

  const episodes = episodesQ.data?.episodes ?? [];
  const episodesForbidden = !!(episodesQ.error as any) && /403|forbidden|admin/i.test(String((episodesQ.error as any)?.message ?? ''));

  const rewardPreview = useMemo(() => computeRewardPreview(scores), [scores]);

  const trend = cumulative?.rewardTrendLastN ?? [];
  const trendMax = trend.length ? Math.max(...trend, 0.0001) : 1;

  // suggestionsRaw is whatever generateImprovementSuggestions() returned
  // (post-envelope-unwrap). Normalize: array → list directly, object →
  // look for .suggestions, else render raw as fallback.
  const suggestionsRaw = suggestionsQ.data;
  const suggestionList: Array<{ text: string; rationale?: string; priority?: string }> = useMemo(() => {
    const arr = Array.isArray(suggestionsRaw)
      ? suggestionsRaw
      : (suggestionsRaw && typeof suggestionsRaw === 'object' && 'suggestions' in suggestionsRaw
          ? (suggestionsRaw as { suggestions?: unknown }).suggestions
          : undefined);
    if (!Array.isArray(arr)) return [];
    return arr.map((s) =>
      typeof s === 'string'
        ? { text: s }
        : { text: (s as any)?.text ?? '(unnamed suggestion)', rationale: (s as any)?.rationale, priority: (s as any)?.priority },
    );
  }, [suggestionsRaw]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6" data-testid="page-grpo-training">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-[#152448]" />
            GRPO Training Dashboard
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Group Relative Policy Optimization — advocate-feedback RLHF loop for the {totalAgents}-agent v{registryVersion} registry
            (P21, 7-axis reward, Bradley-Terry ranking). Live policy via <code className="text-xs">{nv('v1/sdk/optimization/grpo/stats')}</code>.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            statsQ.refetch();
            episodesQ.refetch();
            sdkGrpoStatsQ.refetch();
            sdkGrpoPolicyQ.refetch();
            if (activeAgentKey) suggestionsQ.refetch();
          }}
          data-testid="button-refresh-grpo"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${statsQ.isFetching || episodesQ.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI tiles — populated after first feedback POST (live singleton stats) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="grid-grpo-kpis">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Total Episodes</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-total-episodes">
                  {fmtNum(cumulative?.totalEpisodes)}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">
                  {cumulative?.totalResponses !== undefined
                    ? `${fmtNum(cumulative.totalResponses)} responses scored`
                    : 'submit feedback to populate'}
                </p>
              </div>
              <Activity className="w-8 h-8 text-[#152448]/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Average Reward</p>
                <p
                  className={`text-2xl font-bold mt-1 ${
                    cumulative?.averageReward !== undefined
                      ? cumulative.averageReward >= 0.7
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                      : 'text-slate-900'
                  }`}
                  data-testid="kpi-avg-reward"
                >
                  {cumulative?.averageReward !== undefined ? cumulative.averageReward.toFixed(3) : '—'}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">threshold: 0.700</p>
              </div>
              <TrendingUp className="w-8 h-8 text-emerald-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Policy Updates</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-policy-updates">
                  {fmtNum(cumulative?.totalPolicyUpdates)}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">
                  policy v{livePolicy?.version ?? '—'} · last: {fmtTs(cumulative?.lastUpdateTimestamp ?? undefined)}
                </p>
              </div>
              <Brain className="w-8 h-8 text-purple-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-700 uppercase tracking-wide">Preference Pairs</p>
                <p className="text-2xl font-bold text-slate-900 mt-1" data-testid="kpi-pref-pairs">
                  {fmtNum(cumulative?.preferencePairsStored)}
                </p>
                <p className="text-[10px] text-slate-700 mt-1">Bradley-Terry ranking corpus</p>
              </div>
              <BarChart3 className="w-8 h-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reward trend strip */}
      {trend.length > 0 && (
        <Card data-testid="card-reward-trend">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Reward Trend — last {trend.length} episodes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-20">
              {trend.map((r, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t ${r >= 0.7 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  style={{ height: `${(r / trendMax) * 100}%` }}
                  title={r.toFixed(3)}
                  data-testid={`trend-bar-${i}`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-slate-700">
              <span>oldest</span>
              <span>most recent</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="leaderboard" className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-3xl">
          <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">
            Leaderboard ({topAgents.length})
          </TabsTrigger>
          <TabsTrigger value="episodes" data-testid="tab-episodes">
            Episodes ({episodes.length})
          </TabsTrigger>
          <TabsTrigger value="agent" data-testid="tab-agent">
            Per-Agent
          </TabsTrigger>
          <TabsTrigger value="submit" data-testid="tab-submit">
            Submit Feedback
          </TabsTrigger>
        </TabsList>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Performing Agents</CardTitle>
              <p className="text-xs text-slate-700">{statsQ.data?.description ?? '—'}</p>
            </CardHeader>
            <CardContent>
              {statsQ.isLoading && (
                <div className="space-y-2 py-2" data-testid="state-loading-stats">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              )}
              {statsQ.isError && (
                <div data-testid="state-error-stats">
                  <JrxErrorState
                    title="Could not load GRPO stats"
                    error={statsQ.error}
                    onRetry={() => statsQ.refetch()}
                    variant="card"
                    size="sm"
                  />
                </div>
              )}
              {!statsQ.isLoading && topAgents.length === 0 && !statsQ.isError && (
                <div data-testid="state-empty-leaderboard">
                  <JrxEmptyState
                    icon={BarChart3}
                    title="No agent performance data yet"
                    description="Submit advocate feedback (Submit tab) to populate."
                    size="sm"
                  />
                </div>
              )}
              <div className="space-y-2" data-testid="list-leaderboard">
                {topAgents.map((a, i) => {
                  const key = (a.agentKey as string) ?? (a.agentId as string) ?? `row-${i}`;
                  const reward = a.averageReward as number | undefined;
                  const runs = a.totalRuns as number | undefined;
                  const success = a.successRate as number | undefined;
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 p-2 rounded border border-slate-200 bg-white text-xs"
                      data-testid={`agent-row-${key}`}
                    >
                      <span className="w-6 text-center font-mono text-slate-600">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{key}</p>
                        {runs !== undefined && (
                          <p className="text-slate-700">{fmtNum(runs)} runs</p>
                        )}
                      </div>
                      {reward !== undefined && (
                        <div className="w-32 flex-shrink-0">
                          <div className="flex justify-between text-[10px] text-slate-700 mb-0.5">
                            <span>reward</span>
                            <span>{reward.toFixed(3)}</span>
                          </div>
                          <Progress value={Math.min(reward * 100, 100)} className="h-1.5" />
                        </div>
                      )}
                      {success !== undefined && (
                        <Badge
                          variant="outline"
                          className={
                            success >= 0.9
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : success >= 0.7
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-red-50 text-red-700 border-red-200'
                          }
                        >
                          {fmtPct(success)} success
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAgentKey(key);
                          setActiveAgentKey(key);
                        }}
                        data-testid={`button-drill-${key}`}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Episodes (admin only) */}
        <TabsContent value="episodes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent GRPO Episodes</CardTitle>
              <p className="text-xs text-slate-700">
                Per-episode runs from <code className="text-[10px]">nv_grpo_episodes</code> (admin role required).
              </p>
            </CardHeader>
            <CardContent>
              {episodesForbidden && (
                <div
                  className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700 flex items-start gap-2 mb-3"
                  data-testid="state-episodes-forbidden"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Admin role required to view episodes.</p>
                    <p className="mt-1 text-xs">
                      The other tabs (Leaderboard, Per-Agent, Submit) work for any senior_analyst+ role.
                    </p>
                  </div>
                </div>
              )}
              {episodesQ.isLoading && (
                <div className="space-y-2 py-2" data-testid="state-loading-episodes">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              )}
              {!episodesQ.isLoading && !episodesForbidden && episodes.length === 0 && (
                <div data-testid="state-empty-episodes">
                  <JrxEmptyState
                    title="No episodes recorded yet"
                    description="GRPO training episodes will appear here as agents run."
                    size="sm"
                  />
                </div>
              )}
              <div className="space-y-1" data-testid="list-episodes">
                {episodes.map((e) => (
                  <div
                    key={e.episodeId}
                    className="flex items-center gap-3 p-2 rounded border border-slate-200 bg-white text-xs"
                    data-testid={`episode-row-${e.episodeId}`}
                  >
                    <Badge
                      variant="outline"
                      className={
                        e.rewardScore >= 0.7
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }
                    >
                      r={e.rewardScore.toFixed(2)}
                    </Badge>
                    <span className="font-mono text-slate-600 truncate flex-1 min-w-0">{e.agentId}</span>
                    <Badge variant="outline" className="text-[10px]">{e.taskType}</Badge>
                    <Badge variant="outline" className="text-[10px]">{e.jurisdiction}</Badge>
                    <span className="text-slate-700 truncate max-w-[120px]" title={e.model}>{e.model}</span>
                    <span className="font-mono text-slate-700">{e.latencyMs}ms</span>
                    <span className="text-slate-600 text-[10px]">{fmtTs(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Per-agent drill */}
        <TabsContent value="agent" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                Per-Agent Drill-Down
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={agentKey}
                  onChange={(e) => setAgentKey(e.target.value)}
                  placeholder="agent key (e.g. jrx-agent-001)"
                  className="text-sm"
                  data-testid="input-agent-key"
                />
                <Button
                  onClick={() => setActiveAgentKey(agentKey)}
                  disabled={!agentKey.trim()}
                  data-testid="button-load-agent"
                >
                  Load
                </Button>
              </div>

              {!activeAgentKey && (
                <p className="text-sm text-slate-700 py-8 text-center" data-testid="state-agent-no-selection">
                  Pick an agent from the leaderboard or enter an agent key above.
                </p>
              )}

              {activeAgentKey && (
                <>
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium text-slate-700 mb-2">
                      Feedback analysis · <code>{activeAgentKey}</code>
                    </p>
                    {statsQ.isFetching && (
                      <div className="space-y-1.5" data-testid="state-loading-feedback">
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    )}
                    {!statsQ.isFetching && !feedbackAnalysisHasData && (
                      <p className="text-xs text-slate-700" data-testid="state-empty-feedback">
                        {(feedbackAnalysis as { message?: string } | null)?.message
                          ?? 'No feedback data for this agent.'}
                      </p>
                    )}
                    {feedbackAnalysisHasData && (
                      <pre
                        className="text-[10px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto max-h-64"
                        data-testid="block-feedback-analysis"
                      >
                        {JSON.stringify(feedbackAnalysis, null, 2)}
                      </pre>
                    )}
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-2">
                      <Sparkles className="w-3 h-3" />
                      Improvement suggestions
                    </p>
                    {suggestionsQ.isFetching && (
                      <div className="space-y-1.5" data-testid="state-loading-suggestions">
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    )}
                    {!suggestionsQ.isFetching && suggestionList.length === 0 && !suggestionsQ.isError && (
                      <p className="text-xs text-slate-700" data-testid="state-empty-suggestions">
                        No suggestions returned.
                      </p>
                    )}
                    {suggestionsQ.isError && (
                      <p className="text-xs text-red-600" data-testid="state-error-suggestions">
                        {(suggestionsQ.error as Error)?.message}
                      </p>
                    )}
                    <div className="space-y-1" data-testid="list-suggestions">
                      {suggestionList.map((s, i) => (
                        <div
                          key={i}
                          className="text-xs p-2 rounded border border-slate-200 bg-white"
                          data-testid={`suggestion-${i}`}
                        >
                          <div className="flex items-start gap-2">
                            {s.priority && (
                              <Badge variant="outline" className="text-[10px]">{s.priority}</Badge>
                            )}
                            <span className="text-slate-900">{s.text}</span>
                          </div>
                          {s.rationale && (
                            <p className="text-[10px] text-slate-700 mt-1 ml-1">{s.rationale}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    {suggestionsRaw && suggestionList.length === 0 && (
                      <pre
                        className="text-[10px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto max-h-48 mt-2"
                        data-testid="block-suggestions-raw"
                      >
                        {JSON.stringify(suggestionsRaw, null, 2)}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Submit feedback */}
        <TabsContent value="submit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="w-4 h-4" />
                Submit Advocate Feedback
              </CardTitle>
              <p className="text-xs text-slate-700">
                Score an agent output on six axes. The reward is computed by{' '}
                <code className="text-[10px]">(acc·0.4 + cit·0.3 + use·0.2 + jx·0.1) / 10</code>{' '}
                and the policy updates if reward ≥ 0.7.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs" htmlFor="grpo-task">Task</Label>
                  <Textarea
                    id="grpo-task"
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    rows={2}
                    className="text-sm"
                    data-testid="input-task"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs" htmlFor="grpo-jx">Jurisdiction</Label>
                    <select
                      id="grpo-jx"
                      value={jurisdiction}
                      onChange={(e) => setJurisdiction(e.target.value as typeof JURISDICTIONS[number])}
                      className="w-full h-9 border border-slate-200 rounded px-2 text-sm bg-white"
                      data-testid="select-jurisdiction"
                    >
                      {JURISDICTIONS.map((j) => (
                        <option key={j} value={j}>{j}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="grpo-agent">Agent ID</Label>
                    <Input
                      id="grpo-agent"
                      value={feedbackAgentId}
                      onChange={(e) => setFeedbackAgentId(e.target.value)}
                      placeholder="optional"
                      className="text-sm h-9"
                      data-testid="input-feedback-agent-id"
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs" htmlFor="grpo-output">Output content (optional)</Label>
                <Textarea
                  id="grpo-output"
                  value={outputContent}
                  onChange={(e) => setOutputContent(e.target.value)}
                  rows={3}
                  placeholder="Paste the agent output you are scoring (used by GRPO group evaluation)…"
                  className="text-sm"
                  data-testid="input-output-content"
                />
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-slate-700 mb-2">Advocate scores (1–10)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {SCORE_KEYS.map((k) => (
                    <div key={k} className="flex items-center gap-3 p-2 rounded border border-slate-200">
                      <Label className="text-xs flex-1 min-w-0 truncate" htmlFor={`grpo-score-${k}`}>
                        {SCORE_LABEL[k]}
                      </Label>
                      <Input
                        id={`grpo-score-${k}`}
                        type="number"
                        min={1}
                        max={10}
                        step={0.5}
                        value={scores[k]}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) {
                            setScores((s) => ({ ...s, [k]: Math.max(1, Math.min(10, n)) }));
                          }
                        }}
                        className="w-20 h-8 text-sm"
                        data-testid={`score-${k}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 p-2 rounded bg-slate-50 text-xs">
                  <span className="text-slate-600">Computed reward (preview)</span>
                  <span
                    className={`font-mono font-bold ${
                      rewardPreview >= 0.7 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                    data-testid="text-reward-preview"
                  >
                    {rewardPreview.toFixed(3)} ({(rewardPreview * 100).toFixed(1)}%) ·{' '}
                    {rewardPreview >= 0.7 ? 'policy-update eligible' : 'below threshold'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending || !task.trim()}
                  data-testid="button-submit-feedback"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {submitMutation.isPending ? 'Submitting…' : 'Submit feedback'}
                </Button>
                {submitMutation.isError && (
                  <span className="text-xs text-red-600 flex items-center gap-1" data-testid="state-error-submit">
                    <XCircle className="w-3 h-3" /> {(submitMutation.error as Error)?.message}
                  </span>
                )}
                {submitMutation.isSuccess && (
                  <span className="text-xs text-emerald-700 flex items-center gap-1" data-testid="state-success-submit">
                    <CheckCircle2 className="w-3 h-3" /> Submitted (trace {lastResult?.traceId?.slice(0, 12)}…)
                  </span>
                )}
              </div>

              {lastResult && (
                <div className="border-t border-slate-100 pt-3 space-y-2" data-testid="block-last-result">
                  <p className="text-xs font-medium text-slate-700">Latest result</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 rounded bg-slate-50">
                      <p className="text-slate-700">Reward</p>
                      <p className="font-mono font-bold">{lastResult.rewardFunction?.rawReward.toFixed(3)}</p>
                    </div>
                    <div className="p-2 rounded bg-slate-50">
                      <p className="text-slate-700">Normalized</p>
                      <p className="font-mono font-bold">{lastResult.rewardFunction?.normalizedReward}</p>
                    </div>
                    <div className="p-2 rounded bg-slate-50">
                      <p className="text-slate-700">Policy update</p>
                      <p className={`font-mono font-bold ${lastResult.policyUpdateApplied ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {lastResult.policyUpdateApplied ? 'APPLIED' : 'QUARANTINED'}
                      </p>
                    </div>
                    <div className="p-2 rounded bg-slate-50">
                      <p className="text-slate-700">Latency</p>
                      <p className="font-mono font-bold">{lastResult.performanceMs}ms</p>
                    </div>
                  </div>
                  <details className="text-xs">
                    <summary
                      className="cursor-pointer text-slate-600 hover:text-slate-900"
                      data-testid="toggle-full-response"
                    >
                      Full response envelope
                    </summary>
                    <pre className="text-[10px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto max-h-64 mt-2">
                      {JSON.stringify(lastResult, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer note */}
      <p className="text-[10px] text-slate-600 text-center">
        GRPO P21 · 7-axis reward (legal_accuracy, citation, usability, jurisdiction, risk, completeness, weighted) ·
        Bradley-Terry preference ranking · Policy update threshold 0.7 · 164 agents across IN/UK/US/EU/GC/SG.
      </p>
    </div>
  );
}
