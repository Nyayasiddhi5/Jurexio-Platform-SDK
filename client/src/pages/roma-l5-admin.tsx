/**
 * ROMA L5 Admin Dashboard
 * Jurexio Enterprise Platform runtime
 *
 * Real-time visibility into:
 *   - Active agent registry (ROMA L5 metadata, GRPO scores, fallback rates)
 *   - 107 swarm topologies performance
 *   - GRPO reward episode tracking
 *   - Agent pruning controls
 *   - LLM model usage & cost by agent
 *   - Hallucination rate monitoring
 *   - 47-language routing statistics
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
// ─── TYPES ────────────────────────────────────────────────────────────────────

interface AgentMetric {
  agentId: string;
  agentKey: string;
  name: string;
  romaLevel: number;
  grpoScore: number;
  grpoTrend: 'up' | 'down' | 'stable';
  fallbackRate: number;
  hallucinationRate: number;
  avgLatencyMs: number;
  requestsToday: number;
  tokensToday: number;
  costToday: number;
  status: 'active' | 'pruned' | 'degraded' | 'training';
  lastUsed: string;
  practiceArea: string;
  jurisdiction: string[];
  llmModel: string;
}

interface SwarmMetric {
  topologyId: string;
  name: string;
  category: string;
  executions: number | null;
  avgLatencyMs: number;
  successRate: number;
  avgConsensusScore: number;
  costMultiplier: number;
}

interface LanguageStat {
  code: string;
  name: string;
  requests: number;
  sarvamRouted: number;
  avgLatencyMs: number;
}

interface RomeL5LiveStats {
  totalAgents?: number;
  activeAgents?: number;
  prunedAgents?: number;
  avgGrpoScore?: number;
  totalRequestsToday?: number;
  totalCostToday?: number;
  avgHallucinationRate?: number;
  topTopology?: string;
  topLanguage?: string;
  swarmTopologies?: number;
  supportedLanguages?: number;
  mcpToolsCatalog?: number;
  mcpToolsExecutable?: number;
}

interface AgentsQueryData {
  agents: AgentMetric[];
  meta?: { source?: string };
}

interface DashboardStats {
  totalAgents: number;
  activeAgents: number;
  prunedAgents: number;
  avgGrpoScore: number;
  totalRequestsToday: number;
  totalCostToday: number;
  avgHallucinationRate: number;
  topTopology: string;
  topLanguage: string;
}

// ─── MOCK DATA GENERATOR (demo without backend) ───────────────────────────────
// Removed 2026-08-23 — live data from /api/jrx/admin/roma-l5/* only (NV-NO-STUB-001).

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className={`rounded-xl p-4 border ${color} bg-white shadow-sm`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function GrpoBar({ score, trend }: { score: number; trend: string }) {
  const color = score >= 85 ? 'bg-green-500' : score >= 70 ? 'bg-yellow-400' : 'bg-red-400';
  const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-700">{score}</span>
      <span className={`text-xs ${trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>{arrow}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentMetric['status'] }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    pruned: 'bg-red-100 text-red-700',
    degraded: 'bg-yellow-100 text-yellow-700',
    training: 'bg-blue-100 text-blue-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>{status}</span>;
}

function RomaLevelBadge({ level }: { level: number }) {
  const colors = ['', 'bg-gray-200 text-gray-700', 'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-orange-100 text-orange-700', 'bg-emerald-100 text-emerald-700'];
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${colors[level] ?? colors[1]}`}>L{level}</span>;
}

// ─── LANGUAGE STATS FALLBACK (used when API is unavailable) ───────────────────

const LANGUAGE_STATS_FALLBACK: LanguageStat[] = [
  { code: 'hi', name: 'Hindi', requests: 1420, sarvamRouted: 1380, avgLatencyMs: 1240 },
  { code: 'ta', name: 'Tamil', requests: 680, sarvamRouted: 670, avgLatencyMs: 1320 },
  { code: 'te', name: 'Telugu', requests: 520, sarvamRouted: 510, avgLatencyMs: 1280 },
  { code: 'kn', name: 'Kannada', requests: 380, sarvamRouted: 370, avgLatencyMs: 1350 },
  { code: 'ml', name: 'Malayalam', requests: 290, sarvamRouted: 285, avgLatencyMs: 1410 },
  { code: 'bn', name: 'Bengali', requests: 240, sarvamRouted: 235, avgLatencyMs: 1290 },
  { code: 'gu', name: 'Gujarati', requests: 180, sarvamRouted: 175, avgLatencyMs: 1260 },
  { code: 'mr', name: 'Marathi', requests: 160, sarvamRouted: 155, avgLatencyMs: 1300 },
  { code: 'pa', name: 'Punjabi', requests: 120, sarvamRouted: 115, avgLatencyMs: 1350 },
  { code: 'ur', name: 'Urdu', requests: 90, sarvamRouted: 85, avgLatencyMs: 1420 },
  { code: 'ar', name: 'Arabic', requests: 72, sarvamRouted: 0, avgLatencyMs: 1850 },
  { code: 'fr', name: 'French', requests: 65, sarvamRouted: 0, avgLatencyMs: 1700 },
  { code: 'de', name: 'German', requests: 48, sarvamRouted: 0, avgLatencyMs: 1650 },
  { code: 'zh', name: 'Chinese', requests: 42, sarvamRouted: 0, avgLatencyMs: 1900 },
  { code: 'es', name: 'Spanish', requests: 38, sarvamRouted: 0, avgLatencyMs: 1680 },
  { code: 'ja', name: 'Japanese', requests: 34, sarvamRouted: 0, avgLatencyMs: 1920 },
  { code: 'ko', name: 'Korean', requests: 28, sarvamRouted: 0, avgLatencyMs: 1870 },
  { code: 'pt', name: 'Portuguese', requests: 25, sarvamRouted: 0, avgLatencyMs: 1690 },
  { code: 'ru', name: 'Russian', requests: 22, sarvamRouted: 0, avgLatencyMs: 1710 },
  { code: 'or', name: 'Odia', requests: 45, sarvamRouted: 42, avgLatencyMs: 1370 },
  { code: 'as', name: 'Assamese', requests: 30, sarvamRouted: 28, avgLatencyMs: 1380 },
  { code: 'ne', name: 'Nepali', requests: 18, sarvamRouted: 16, avgLatencyMs: 1390 },
  { code: 'si', name: 'Sinhala', requests: 12, sarvamRouted: 11, avgLatencyMs: 1400 },
  { code: 'sa', name: 'Sanskrit', requests: 8, sarvamRouted: 7, avgLatencyMs: 1450 },
];

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────

export default function RomaL5AdminDashboard() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'swarms' | 'grpo' | 'languages'>('overview');
  const [searchAgent, setSearchAgent] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRomaLevel, setFilterRomaLevel] = useState<string>('all');
  const [filterPracticeArea, setFilterPracticeArea] = useState<string>('all');
  const [sortBy, setSortBy] = useState<keyof AgentMetric>('grpoScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedAgent, setSelectedAgent] = useState<AgentMetric | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  // ── Live API Queries ──────────────────────────────────────────────────────

  const agentsQuery = useQuery<AgentsQueryData>({
    queryKey: ['roma-l5-agents'],
    queryFn: async () => {
      const res = await apiRequest(nv('admin/roma-l5/agents'));
      const json = await res.json();
      return {
        agents: (json.data?.agents ?? []) as AgentMetric[],
        meta: json.meta as { source?: string } | undefined,
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const statsQuery = useQuery<RomeL5LiveStats>({
    queryKey: ['roma-l5-stats'],
    queryFn: async () => {
      const res = await apiRequest(nv('admin/roma-l5/stats'));
      const json = await res.json();
      return json.data as RomeL5LiveStats;
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const swarmsQuery = useQuery<SwarmMetric[]>({
    queryKey: ['roma-l5-topologies'],
    queryFn: async () => {
      const res = await apiRequest(nv('admin/roma-l5/topologies'));
      const json = await res.json();
      return (json.data?.topologies ?? []) as SwarmMetric[];
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const langQuery = useQuery<LanguageStat[]>({
    queryKey: ['roma-l5-languages'],
    queryFn: async () => {
      const res = await apiRequest(nv('admin/roma-l5/language-stats'));
      const json = await res.json();
      return (json.data?.languages ?? []) as LanguageStat[];
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const grpoQuery = useQuery<{ episodes: { agentId?: string; rewardScore?: number }[]; total?: number }>({
    queryKey: ['roma-l5-grpo-episodes'],
    queryFn: async () => {
      const res = await apiRequest(`${nv('admin/roma-l5/grpo/episodes')}?limit=200`);
      const json = await res.json();
      return (json.data ?? { episodes: [], total: 0 }) as { episodes: { agentId?: string; rewardScore?: number }[]; total?: number };
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const agents: AgentMetric[] = agentsQuery.data?.agents ?? [];
  const agentMetaSource = agentsQuery.data?.meta?.source;
  const swarms: SwarmMetric[] = swarmsQuery.data ?? [];
  const languageStats: LanguageStat[] = langQuery.data ?? [];
  const liveStats = statsQuery.data;
  const grpoEpisodes = grpoQuery.data?.episodes ?? [];
  const grpoEpisodeTotal = grpoQuery.data?.total ?? grpoEpisodes.length;
  const topGrpoAgent = [...agents].sort((a, b) => b.grpoScore - a.grpoScore)[0];
  const sarvamLanguageCount = languageStats.filter(l => l.sarvamRouted > 0).length;
  const nonEnglishRequests = languageStats.filter(l => l.code !== 'en').reduce((s, l) => s + l.requests, 0);
  const avgTranslationLatency = languageStats.length
    ? Math.round(languageStats.reduce((s, l) => s + l.avgLatencyMs, 0) / languageStats.length)
    : null;

  // ── Prune / Restore mutations ─────────────────────────────────────────────

  const pruneMutation = useMutation({
    mutationFn: async (agentId: string) => {
      await apiRequest(`${NV_BASE}admin/roma-l5/agents/${agentId}/prune`, { method: 'POST', body: JSON.stringify({ reason: 'Manual prune from ROMA L5 dashboard' }), headers: { 'Content-Type': 'application/json' } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roma-l5-agents'] }),
  });

  const restoreMutation = useMutation({
    mutationFn: async (agentId: string) => {
      await apiRequest(`${NV_BASE}admin/roma-l5/agents/${agentId}/restore`, { method: 'POST' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roma-l5-agents'] }),
  });

  // Auto-refresh timestamp
  useEffect(() => {
    const interval = setInterval(() => setLastRefreshed(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  // Computed stats
  const stats: DashboardStats = React.useMemo(() => ({
    totalAgents: Number(liveStats?.totalAgents ?? agents.length),
    activeAgents: Number(liveStats?.activeAgents ?? agents.filter(a => a.status === 'active').length),
    prunedAgents: Number(liveStats?.prunedAgents ?? agents.filter(a => a.status === 'pruned').length),
    avgGrpoScore: Number(liveStats?.avgGrpoScore ?? (agents.length > 0 ? Math.round(agents.reduce((s, a) => s + a.grpoScore, 0) / agents.length) : 0)),
    totalRequestsToday: Number(liveStats?.totalRequestsToday ?? agents.reduce((s, a) => s + a.requestsToday, 0)),
    totalCostToday: Number(liveStats?.totalCostToday ?? Math.round(agents.reduce((s, a) => s + a.costToday, 0) * 100) / 100),
    avgHallucinationRate: Number(liveStats?.avgHallucinationRate ?? (agents.length > 0 ? Math.round(agents.reduce((s, a) => s + a.hallucinationRate, 0) / agents.length * 10) / 10 : 0)),
    topTopology: String(liveStats?.topTopology ?? '—'),
    topLanguage: String(liveStats?.topLanguage ?? '—'),
  }), [agents, liveStats]);

  // Filtered/sorted agents
  const filteredAgents = React.useMemo(() => {
    let list = [...agents];
    if (searchAgent) list = list.filter(a => a.name.toLowerCase().includes(searchAgent.toLowerCase()) || a.practiceArea.toLowerCase().includes(searchAgent.toLowerCase()) || a.agentKey.toLowerCase().includes(searchAgent.toLowerCase()));
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus);
    if (filterRomaLevel !== 'all') list = list.filter(a => a.romaLevel === Number(filterRomaLevel));
    if (filterPracticeArea !== 'all') list = list.filter(a => a.practiceArea === filterPracticeArea);
    list.sort((a, b) => {
      const av = a[sortBy]; const bv = b[sortBy];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'desc' ? bv - av : av - bv;
      return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
    return list;
  }, [agents, searchAgent, filterStatus, filterRomaLevel, filterPracticeArea, sortBy, sortDir]);

  const practiceAreas = [...new Set(agents.map(a => a.practiceArea))].sort();

  const handlePruneAgent = useCallback((agentId: string) => {
    pruneMutation.mutate(agentId);
  }, [pruneMutation]);

  const handleActivateAgent = useCallback((agentId: string) => {
    restoreMutation.mutate(agentId);
  }, [restoreMutation]);

  const handleSort = (col: keyof AgentMetric) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const GRPO_DISTRIBUTION = [
    { range: '90–99', count: agents.filter(a => a.grpoScore >= 90).length, color: 'bg-emerald-500' },
    { range: '80–89', count: agents.filter(a => a.grpoScore >= 80 && a.grpoScore < 90).length, color: 'bg-green-400' },
    { range: '70–79', count: agents.filter(a => a.grpoScore >= 70 && a.grpoScore < 80).length, color: 'bg-yellow-400' },
    { range: '60–69', count: agents.filter(a => a.grpoScore >= 60 && a.grpoScore < 70).length, color: 'bg-orange-400' },
    { range: '<60',   count: agents.filter(a => a.grpoScore < 60).length, color: 'bg-red-500' },
  ];

  const modelDistribution = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of agents) {
      const key = a.llmModel || 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [agents]);

  const LANGUAGE_STATS = languageStats;
  const registryTotal = Math.max(stats.totalAgents, 1);

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'agents', label: `Agents (${stats.activeAgents}/${stats.totalAgents})` },
    { id: 'swarms', label: 'Swarm Topologies' },
    { id: 'grpo', label: 'GRPO Analytics' },
    { id: 'languages', label: languageStats.length > 0 ? `${languageStats.length} Languages` : 'Languages' },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500 flex items-center justify-center">
            <span className="text-white text-xs font-black">L5</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-none">ROMA L5 Admin Dashboard</h1>
            <p className="text-xs text-gray-500 mt-0.5">Jurexio Enterprise Platform runtime — {stats.totalAgents} Agents · {liveStats?.swarmTopologies ?? swarms.length ?? '—'} Topologies · {liveStats?.supportedLanguages ?? languageStats.length ?? '—'} Languages</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Refreshed: {lastRefreshed.toLocaleTimeString('en-IN')}</span>
          {agentMetaSource === 'mock' ? (
            <span className="text-xs font-medium text-amber-600">Demo data (nv_agent_metrics empty)</span>
          ) : (
            <>
              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium text-green-600">Live</span>
            </>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-5 max-w-screen-2xl mx-auto">

        {/* ─── OVERVIEW TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
              <StatCard label="Total Agents" value={stats.totalAgents} sub="Active runtime registry" color="border-emerald-200" />
              <StatCard label="Active" value={stats.activeAgents} sub={`${stats.prunedAgents} pruned`} color="border-green-200" />
              <StatCard label="Avg GRPO Score" value={`${stats.avgGrpoScore}/100`} sub="Group Relative Policy Opt." color="border-blue-200" />
              <StatCard label="Requests Today" value={stats.totalRequestsToday.toLocaleString()} sub="All agents combined" color="border-purple-200" />
              <StatCard label="Cost Today" value={`$${stats.totalCostToday}`} sub="All LLM providers" color="border-yellow-200" />
              <StatCard label="Hallucination Rate" value={`${stats.avgHallucinationRate}%`} sub="Avg across agents" color="border-red-200" />
              <StatCard label="Swarm Topologies" value={Number(liveStats?.swarmTopologies ?? swarms.length) || '—'} sub="Catalog (mode-dispatch)" color="border-teal-200" />
              <StatCard label="Languages" value={Number(liveStats?.supportedLanguages ?? languageStats.length) || '—'} sub="Live routing stats" color="border-indigo-200" />
              <StatCard label="MCP Executable" value={Number(liveStats?.mcpToolsExecutable ?? 0)} sub={`of ${Number(liveStats?.mcpToolsCatalog ?? 0)} catalog`} color="border-slate-200" />
            </div>

            {/* GRPO Distribution */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">GRPO Score Distribution — {stats.totalAgents} Agents</h2>
              <div className="space-y-3">
                {GRPO_DISTRIBUTION.map(({ range, count, color }) => (
                  <div key={range} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">{range}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div className={`h-3 rounded-full ${color}`} style={{ width: `${(count / registryTotal) * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono font-semibold w-8 text-right">{count}</span>
                    <span className="text-xs text-gray-400 w-8">{Math.round((count / registryTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Swarm Topology Heatmap */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Swarm Topology Usage (Top 10)</h2>
              <div className="grid grid-cols-5 gap-2">
                {swarms.slice(0, 10).map(t => (
                  <div key={t.topologyId} className="rounded-lg p-3 bg-gray-50 border border-gray-100 hover:border-emerald-200 cursor-pointer transition-colors">
                    <div className="text-xs font-semibold text-gray-700 truncate">{t.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{t.category.replace('_', '-')}</div>
                    <div className="mt-2 text-sm font-bold text-emerald-600">{t.executions ?? '—'}</div>
                    <div className="text-[10px] text-gray-400">executions (telemetry)</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Model Usage */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-800 mb-4">LLM Model Distribution</h2>
                {modelDistribution.length === 0 ? (
                  <p className="text-xs text-gray-500">No agent model telemetry in this window.</p>
                ) : modelDistribution.map(([model, count]) => (
                  <div key={model} className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-600 w-36 truncate">{model}</span>
                    <div className="flex-1 bg-gray-100 rounded h-2">
                      <div className="h-2 rounded bg-emerald-500" style={{ width: `${(count / registryTotal) * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-800 mb-4">ROMA Level Distribution</h2>
                {[1,2,3,4,5].map(level => {
                  const count = agents.filter(a => a.romaLevel === level).length;
                  return (
                    <div key={level} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-600 w-16">ROMA L{level}</span>
                      <div className="flex-1 bg-gray-100 rounded h-2">
                        <div className="h-2 rounded bg-blue-500" style={{ width: `${(count / registryTotal) * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── AGENTS TAB ────────────────────────────────────────────────────── */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-center shadow-sm">
              <input
                type="text"
                placeholder="Search agents..."
                value={searchAgent}
                onChange={e => setSearchAgent(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:border-emerald-400 w-48"
              />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none">
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="degraded">Degraded</option>
                <option value="training">Training</option>
                <option value="pruned">Pruned</option>
              </select>
              <select value={filterRomaLevel} onChange={e => setFilterRomaLevel(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none">
                <option value="all">All ROMA Levels</option>
                {[1,2,3,4,5].map(l => <option key={l} value={l}>ROMA L{l}</option>)}
              </select>
              <select value={filterPracticeArea} onChange={e => setFilterPracticeArea(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none">
                <option value="all">All Practice Areas</option>
                {practiceAreas.map(pa => <option key={pa} value={pa}>{pa}</option>)}
              </select>
              <span className="text-xs text-gray-400 ml-auto">{filteredAgents.length} agents</span>
            </div>

            {/* Agent Detail Panel */}
            {selectedAgent && (
              <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">{selectedAgent.name}</h2>
                    <p className="text-xs text-gray-500">{selectedAgent.agentKey} · {selectedAgent.llmModel}</p>
                  </div>
                  <div className="flex gap-2">
                    {selectedAgent.status !== 'pruned' ? (
                      <button onClick={() => handlePruneAgent(selectedAgent.agentId)} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors">Prune Agent</button>
                    ) : (
                      <button onClick={() => handleActivateAgent(selectedAgent.agentId)} className="px-3 py-1.5 bg-green-50 text-green-600 border border-green-200 rounded-lg text-xs font-semibold hover:bg-green-100 transition-colors">Activate Agent</button>
                    )}
                    <button onClick={() => setSelectedAgent(null)} className="px-3 py-1.5 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-xs hover:bg-gray-100 transition-colors">Close</button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <StatCard label="GRPO Score" value={`${selectedAgent.grpoScore}/100`} color="border-emerald-200" />
                  <StatCard label="Fallback Rate" value={`${selectedAgent.fallbackRate}%`} color="border-yellow-200" />
                  <StatCard label="Hallucination Rate" value={`${selectedAgent.hallucinationRate}%`} color="border-red-200" />
                  <StatCard label="Avg Latency" value={`${selectedAgent.avgLatencyMs}ms`} color="border-blue-200" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <StatCard label="Requests Today" value={selectedAgent.requestsToday.toLocaleString()} color="border-purple-200" />
                  <StatCard label="Tokens Today" value={selectedAgent.tokensToday.toLocaleString()} color="border-teal-200" />
                  <StatCard label="Cost Today" value={`$${selectedAgent.costToday}`} color="border-orange-200" />
                </div>
              </div>
            )}

            {/* Agent Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {[
                        { key: 'agentId', label: 'Agent ID' },
                        { key: 'practiceArea', label: 'Practice Area' },
                        { key: 'status', label: 'Status' },
                        { key: 'romaLevel', label: 'ROMA' },
                        { key: 'grpoScore', label: 'GRPO Score' },
                        { key: 'fallbackRate', label: 'Fallback %' },
                        { key: 'hallucinationRate', label: 'Halluc %' },
                        { key: 'avgLatencyMs', label: 'Latency' },
                        { key: 'requestsToday', label: 'Req Today' },
                        { key: 'costToday', label: 'Cost Today' },
                        { key: 'llmModel', label: 'LLM' },
                        { key: 'lastUsed', label: 'Last Used' },
                      ].map(({ key, label }) => (
                        <th key={key} className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-800" onClick={() => handleSort(key as keyof AgentMetric)}>
                          {label} {sortBy === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredAgents.slice(0, 50).map(agent => (
                      <tr key={agent.agentId} className={`hover:bg-emerald-50 cursor-pointer transition-colors ${selectedAgent?.agentId === agent.agentId ? 'bg-emerald-50' : ''}`} onClick={() => setSelectedAgent(agent)}>
                        <td className="px-3 py-2 font-mono text-gray-700">{agent.agentId}</td>
                        <td className="px-3 py-2 text-gray-600">{agent.practiceArea}</td>
                        <td className="px-3 py-2"><StatusBadge status={agent.status} /></td>
                        <td className="px-3 py-2"><RomaLevelBadge level={agent.romaLevel} /></td>
                        <td className="px-3 py-2"><GrpoBar score={agent.grpoScore} trend={agent.grpoTrend} /></td>
                        <td className={`px-3 py-2 font-mono ${agent.fallbackRate > 10 ? 'text-red-600' : 'text-gray-600'}`}>{agent.fallbackRate}%</td>
                        <td className={`px-3 py-2 font-mono ${agent.hallucinationRate > 3 ? 'text-red-600' : 'text-gray-600'}`}>{agent.hallucinationRate}%</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{agent.avgLatencyMs}ms</td>
                        <td className="px-3 py-2 font-mono text-gray-700">{agent.requestsToday}</td>
                        <td className="px-3 py-2 font-mono text-gray-700">${agent.costToday}</td>
                        <td className="px-3 py-2 text-gray-500 truncate max-w-[100px]">{agent.llmModel}</td>
                        <td className="px-3 py-2 text-gray-400">{agent.lastUsed}</td>
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          {agent.status !== 'pruned' ? (
                            <button onClick={() => handlePruneAgent(agent.agentId)} className="text-red-500 hover:text-red-700 text-[10px] font-semibold px-2 py-0.5 rounded border border-red-200 hover:bg-red-50">Prune</button>
                          ) : (
                            <button onClick={() => handleActivateAgent(agent.agentId)} className="text-green-600 hover:text-green-700 text-[10px] font-semibold px-2 py-0.5 rounded border border-green-200 hover:bg-green-50">Activate</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredAgents.length > 50 && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                  Showing 50 of {filteredAgents.length} agents. Use filters to narrow results.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── SWARM TOPOLOGIES TAB ──────────────────────────────────────────── */}
        {activeTab === 'swarms' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Total Topologies" value={swarms.length || Number(liveStats?.swarmTopologies) || '—'} sub="Live topology catalog" color="border-teal-200" />
              <StatCard label="GRPO-Compatible" value={swarms.filter(s => s.category?.toLowerCase().includes('grpo')).length || '—'} sub="From live metrics" color="border-emerald-200" />
              <StatCard label="ROMA L5 Topologies" value={swarms.filter(s => s.category?.toLowerCase().includes('roma')).length || '—'} sub="ROMA L5 protocol" color="border-blue-200" />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Topology Performance (Live Data)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-gray-100">
                    <tr className="text-gray-400 uppercase tracking-wider">
                      <th className="px-3 py-2 text-left">Topology</th>
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-right">Executions</th>
                      <th className="px-3 py-2 text-right">Avg Latency</th>
                      <th className="px-3 py-2 text-right">Success Rate</th>
                      <th className="px-3 py-2 text-right">Consensus Score</th>
                      <th className="px-3 py-2 text-right">Cost ×</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {swarms.map(t => (
                      <tr key={t.topologyId} className="hover:bg-teal-50">
                        <td className="px-3 py-2 font-medium text-gray-800">{t.name}</td>
                        <td className="px-3 py-2 text-gray-500">{t.category}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.executions ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">{t.avgLatencyMs.toLocaleString()}ms</td>
                        <td className={`px-3 py-2 text-right font-mono ${t.successRate >= 95 ? 'text-green-600' : t.successRate >= 85 ? 'text-yellow-600' : 'text-red-500'}`}>{t.successRate}%</td>
                        <td className="px-3 py-2 text-right font-mono">{t.avgConsensusScore}</td>
                        <td className="px-3 py-2 text-right font-mono text-orange-600">{t.costMultiplier}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── GRPO ANALYTICS TAB ────────────────────────────────────────────── */}
        {activeTab === 'grpo' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Avg GRPO Score" value={`${stats.avgGrpoScore}/100`} sub="All active runtime agents" color="border-emerald-200" />
              <StatCard label="Top Agent" value={topGrpoAgent?.agentId ?? '—'} sub={`Score: ${topGrpoAgent?.grpoScore ?? '—'}`} color="border-green-200" />
              <StatCard label="GRPO Episodes Run" value={grpoEpisodeTotal ? grpoEpisodeTotal.toLocaleString() : '—'} sub="From episode history API" color="border-blue-200" />
              <StatCard label="Episode Agents" value={new Set(grpoEpisodes.map(e => e.agentId).filter(Boolean)).size || '—'} sub="Unique in sample" color="border-purple-200" />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">GRPO Score Distribution</h2>
              {GRPO_DISTRIBUTION.map(({ range, count, color }) => (
                <div key={range} className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-gray-500 w-16 text-right">{range}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className={`h-5 rounded-full ${color} flex items-center justify-end pr-2`} style={{ width: `${Math.max((count / registryTotal) * 100, 5)}%` }}>
                      {count > 5 && <span className="text-white text-[10px] font-bold">{count}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-8">{Math.round((count / registryTotal) * 100)}%</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Bottom 10 Agents by GRPO Score (Pruning Candidates)</h2>
              <div className="space-y-2">
                {[...agents].sort((a, b) => a.grpoScore - b.grpoScore).slice(0, 10).map(a => (
                  <div key={a.agentId} className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-4 py-2">
                    <div>
                      <span className="text-xs font-semibold text-gray-800">{a.agentId}</span>
                      <span className="text-xs text-gray-500 ml-2">{a.practiceArea}</span>
                    </div>
                    <GrpoBar score={a.grpoScore} trend={a.grpoTrend} />
                    <div className="flex gap-2">
                      <button onClick={() => handlePruneAgent(a.agentId)} className="text-[10px] font-semibold text-red-600 border border-red-200 px-2 py-0.5 rounded hover:bg-red-100">Prune</button>
                      <button className="text-[10px] font-semibold text-blue-600 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-100">Retrain</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── LANGUAGES TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'languages' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Total Languages" value={languageStats.length || Number(liveStats?.supportedLanguages) || '—'} sub="Live routing catalog" color="border-indigo-200" />
              <StatCard label="Sarvam AI Routed" value={sarvamLanguageCount || '—'} sub="Indian official languages" color="border-teal-200" />
              <StatCard label="Non-English Requests" value={nonEnglishRequests ? nonEnglishRequests.toLocaleString() : '—'} sub="Aggregated volume" color="border-purple-200" />
              <StatCard label="Avg Translation Latency" value={avgTranslationLatency != null ? `${avgTranslationLatency}ms` : '—'} sub="Across languages" color="border-yellow-200" />
            </div>

            {!languageStats.length && (
              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">Language stats loading or unavailable from /api/jrx/admin/roma-l5/language-stats.</div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">Language Request Volume (Today)</h2>
              <div className="space-y-2">
                {LANGUAGE_STATS.length ? LANGUAGE_STATS.map(l => (
                  <div key={l.code} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400 w-6 uppercase">{l.code}</span>
                    <span className="text-xs text-gray-700 w-24">{l.name}</span>
                    <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                      <div className="h-3 rounded bg-indigo-500" style={{ width: `${(l.requests / LANGUAGE_STATS[0].requests) * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono w-10 text-right text-gray-700">{l.requests}</span>
                    <span className={`text-xs w-20 text-right ${l.sarvamRouted > 0 ? 'text-teal-600' : 'text-gray-400'}`}>{l.sarvamRouted > 0 ? `${l.sarvamRouted} → Sarvam` : 'OpenRouter'}</span>
                    <span className="text-xs font-mono text-gray-400 w-16 text-right">{l.avgLatencyMs}ms</span>
                  </div>
                )) : null}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
