/**
 * @deprecated Use SDK Hub (`/sdk-hub?tab=overview`) — legacy deep-link surface.
 * `/sdk-hub/legacy` shows a migration banner; this file remains for hub tab embed.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { apiRequest } from '@/lib/queryClient';
import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';
import {
  nvAgentCount, nvAsArray, nvHealthStatus, nvJurisdictionsFromStatutesSummary,
} from '@/lib/jrx-console-data';
import {
  Brain, Bot, Globe, Shield, Zap, Database, Server, Network, FileText,
  Layers, BarChart3, TrendingUp, CheckCircle, AlertTriangle, Clock, Activity,
  Code, Workflow, Sparkles, Monitor, Gauge, Eye, Lock, Key, Bell, Package,
  Users, Building2, Gavel, Award, BookOpen, ChevronRight, Settings, LogOut,
  Scale, Star, Cpu, Target, ChevronDown, ChevronUp, ExternalLink, LayoutDashboard,
  GitBranch, Mic, FileOutput, Scan, FlaskConical, LineChart, Palette, Webhook,
  ScrollText, BookMarked, Boxes, Cable, DollarSign, CreditCard, MapPin, Radio,
  Fingerprint, Archive, Aperture, Anchor, Orbit, Binary, Wand2, Route, Search
} from 'lucide-react';

import { nv, p } from '@/lib/jrx-api-paths';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { useNvModelCatalog } from '@/hooks/useNvModelCatalog';
// task-168: surface tokens promoted to the light demo theme.
// Semantic accent colours (blue/gold/emerald) are preserved as brand navy/
// gold so KPI icons, chart nodes, route labels, and progress bars keep their
// meaning on the new white surfaces. Only the page-background / card / border
// roles were flipped to light values.
const C = {
  blue: '#152448',     // brand navy — accent (icons, charts, KPI chips, routes)
  navy: '#F8FAFC',     // page background (was #0E1830)
  indigo: '#F1F5F9',   // subtle background tint (was #152448)
  gold: '#B48907',     // darker gold for AA contrast on white
  goldLight: '#C7B15B',
  emerald: '#1C7A4F',
  white: '#0F172A',    // primary slate text (was '#FFFFFF')
  glass: '#FFFFFF',          // panel surface (was rgba(255,255,255,0.06))
  glassBorder: '#E2E8F0',    // panel border (was rgba(255,255,255,0.12))
  goldGlass: 'rgba(212,160,23,0.12)',
  goldBorder: 'rgba(180,137,7,0.35)',
};

const NAV_SECTIONS = [
  {
    label: 'PLATFORM HUBS', icon: LayoutDashboard,
    items: [
      { label: 'Enterprise Console', path: '/dashboard', icon: Monitor },
      { label: 'SDK Developer Console', path: '/sdk-console', icon: Code },
      { label: 'Jurexio Citizen Chat', path: '/chat?tab=legal', icon: Users },
      { label: 'Institutional', path: '/institutional', icon: Building2 },
      { label: 'Governance™', path: '/governance', icon: ScrollText },
      { label: 'SDK API Playground', path: '/sdk-playground', icon: Webhook },
    ]
  },
  {
    label: 'AGENT INTELLIGENCE', icon: Brain,
    items: [
      { label: 'Agent Gallery', path: '/agent-registry', icon: Bot },
      { label: 'Matter Vault', path: '/matter-vault', icon: Archive },
      { label: 'Digital Twin (TwinDesk)', path: '/digital-twin-creator', icon: Users },
      { label: 'ROMA L5 Admin', path: '/roma-l5-admin', icon: Star },
      { label: 'Agent Flows Dashboard', path: '/agent-flows', icon: GitBranch },
      { label: '✦ Create Agent (22 Patterns)', path: '/agent-wizard', icon: Wand2 },
      { label: '✦ Agent Live Testing', path: '/agent-live-testing', icon: FlaskConical },
      { label: 'GRPO Training', path: '/orchestration/grpo', icon: Target },
      { label: 'A2A Collaboration', path: '/orchestration/a2a', icon: Network },
      { label: 'Orchestration', path: '/orchestration', icon: Workflow },
      { label: 'Architect Builder', path: '/architect', icon: Wand2 },
    ]
  },
  {
    label: 'LEGAL OPERATIONS', icon: Gavel,
    items: [
      { label: 'LRM Router', path: '/lrm-dashboard', icon: Route },
      { label: 'Regulatory Monitor', path: '/regulatory', icon: Radio },
      { label: 'Enforcement', path: '/enforcement', icon: Shield },
    ]
  },
  {
    label: 'AI OPERATIONS', icon: Sparkles,
    items: [
      { label: 'Model Catalog', path: '/model-catalog', icon: Package },
      { label: 'CAM Memory', path: '/orchestration/memory', icon: Database },
      { label: 'BMAD Workflow', path: '/orchestration/bmad', icon: Layers },
      { label: 'Policy Console', path: '/orchestration/policies', icon: ScrollText },
      { label: 'HITL Decisions', path: '/decision-cards', icon: Eye },
      { label: 'Skills Library', path: '/skills', icon: BookMarked },
    ]
  },
  {
    label: 'SECURITY & COMPLIANCE', icon: Shield,
    items: [
      { label: 'Hash Chain Audit', path: '/hash-chain', icon: Fingerprint },
      { label: 'Adversarial Testing', path: '/adversarial', icon: FlaskConical },
      { label: 'Model Drift Monitor', path: '/drift-monitor', icon: LineChart },
      { label: 'LLM Priority', path: '/llm-priority', icon: Gauge },
      { label: 'RBAC Console', path: '/rbac-console', icon: Lock },
    ]
  },
  {
    label: 'DEVELOPER SDK', icon: Code,
    items: [
      { label: '✦ SDK Testing Console', path: '/sdk-testing', icon: FlaskConical },
      { label: '✦ Platform Management', path: '/platform-management', icon: Gauge },
      { label: 'SDK Downloads', path: '/sdk-downloads', icon: Package },
      { label: 'White Label Admin', path: '/white-label', icon: Palette },
      { label: 'Org Admin', path: '/org-admin', icon: Building2 },
      { label: 'Digital Twin', path: '/digital-twin', icon: Aperture },
      { label: 'Multimodal Studio', path: '/multimodal', icon: Mic },
    ]
  },
  {
    label: 'ANALYTICS', icon: BarChart3,
    items: [
      { label: 'Live Activity Feed', path: '/live-activity-feed', icon: Activity },
      { label: 'Orchestration Stats', path: '/orchestration-dashboard', icon: BarChart3 },
      { label: 'Agent Activity', path: '/agent-activity', icon: Scan },
      { label: 'AI Quality Test', path: '/p1-ai-quality', icon: Award },
    ]
  },
];

const PLATFORMS = [
  { id: './jrx-sdk', name: 'Jurexio Enterprise Platform SDK', tagline: 'Global Legal Operating System', icon: Brain, color: C.blue, badge: 'CORE', pct: 95, path: '/dashboard' },
  { id: 'jurexio-citizen', name: 'Jurexio Citizen', tagline: 'Citizen Legal Assistance', icon: Users, color: C.emerald, badge: 'BETA', pct: 88, path: '/jurexio-citizen' },
  { id: 'nsp', name: 'NS Professional™', tagline: 'Practice Management OS', icon: Gavel, color: C.gold, badge: 'LIVE', pct: 90, path: '/sdk-console' },
  { id: 'nsi', name: 'NS Institutional™', tagline: 'Enterprise Legal Governance', icon: Building2, color: '#2A4A96', badge: 'BETA', pct: 70, path: '/institutional' },
  { id: 'nsg', name: 'NS Governance™', tagline: 'Sovereign Regulatory AI', icon: ScrollText, color: '#6B2FA0', badge: 'ALPHA', pct: 65, path: '/governance' },
];


const COMPLIANCE_COLORS = [C.blue, C.emerald, '#1A3A96', '#C0521E', '#6B2FA0', '#2A8A6A', '#B06A20', '#3A6A9A'];

type ComplianceQuickRow = { name: string; domain: string; score: number; color: string; controls: number; status: string };

function mapComplianceQuick(payload: unknown): ComplianceQuickRow[] {
  const fws = Array.isArray((payload as { frameworks?: unknown[] })?.frameworks)
    ? (payload as { frameworks: unknown[] }).frameworks
    : [];
  if (!fws.length) return [];
  return fws.slice(0, 8).map((raw, i) => {
    const f = raw as Record<string, unknown>;
    const counts = (f.counts ?? {}) as Record<string, number>;
    const pass = Number(counts.PASS ?? 0);
    const partial = Number(counts.PARTIAL ?? 0);
    const fail = Number(counts.FAIL ?? 0);
    const assessed = pass + partial + fail;
    const score = assessed > 0 ? Math.round((pass / assessed) * 100) : 0;
    const status = fail > 0 ? 'Gap' : partial > 0 ? 'Partial' : assessed > 0 ? 'Compliant' : 'In progress';
    return {
      name: String(f.longName ?? f.name ?? f.framework ?? 'Framework'),
      domain: String(f.domain ?? 'Compliance'),
      score,
      color: COMPLIANCE_COLORS[i % COMPLIANCE_COLORS.length],
      controls: assessed,
      status,
    };
  });
}

/** Removed static compliance matrix — live data from GET /api/jrx/compliance/iso only. */

/** Live model rows — merged from GET /api/jrx/models + health/full provider latency. */
function buildLlmProviderRows(
  catalog: Array<{ id: string; name: string; provider: string; tier: string }>,
  healthByProvider: Map<string, Record<string, unknown>>,
) {
  const byProvider = new Map<string, typeof catalog>();
  for (const m of catalog) {
    const key = m.provider.toLowerCase();
    const list = byProvider.get(key) ?? [];
    list.push(m);
    byProvider.set(key, list);
  }
  if (!byProvider.size) return [];
  return Array.from(byProvider.entries()).map(([provider, models]) => {
    const live = healthByProvider.get(provider);
    const status = String(live?.status ?? live?.state ?? 'unknown').toLowerCase();
    const top = models.sort((a, b) => a.id.localeCompare(b.id))[0];
    return {
      name: top?.name ?? provider,
      provider,
      tier: top?.tier ?? '—',
      status: status.includes('healthy') || status === 'active' || status === 'ok' || status === 'available' ? 'active' : status,
      latencyLabel: fmtMs(live?.avgLatencyMs ?? live?.latencyMs ?? live?.p50Ms),
      errorLabel: fmtPct(Number(live?.errorRate ?? live?.error_rate ?? 0) <= 1 ? Number(live?.errorRate ?? live?.error_rate ?? 0) * 100 : live?.errorRate ?? live?.error_rate),
    };
  });
}

const RAG_PIPELINE_STEPS = [
  { step: '1. Query Analysis', detail: 'Intent classification + jurisdiction detection' },
  { step: '2. Hybrid Retrieval', detail: 'BM25 + dense embeddings + MMR reranking' },
  { step: '3. Cross-Encoder Rerank', detail: 'Top-k narrowing with relevance scores' },
  { step: '4. Context Assembly', detail: 'Statute snippets + precedents + commentary' },
  { step: '5. Hallucination Guard', detail: 'Citation verification + confidence scoring' },
  { step: '6. PII Redaction', detail: 'DPDPA-compliant anonymisation' },
];

function fmtMs(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? `${Math.round(n)}ms` : '—';
}

function fmtPct(v: unknown, digits = 1): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

function Pulse({ color = C.emerald }: { color?: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
    </span>
  );
}

function KpiCard({ label, value, sub, icon: Icon, color, onClick }: any) {
  return (
    <div
      onClick={onClick}
      className="rounded-xl p-4 cursor-pointer group transition-all duration-200 hover:scale-105"
      style={{ background: C.glass, border: `1px solid ${C.glassBorder}`, backdropFilter: 'blur(12px)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className="h-4.5 w-4.5" style={{ color }} />
        </div>
        <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: C.gold }} />
      </div>
      <div className="text-2xl font-bold text-foreground mb-0.5" style={{ fontFamily: 'Merriweather, serif' }}>{value}</div>
      <div className="text-xs text-muted-foreground leading-tight">{label}</div>
      {sub && <div className="text-xs mt-1.5 font-medium" style={{ color }}>{sub}</div>}
    </div>
  );
}

function NavItem({ item, isActive, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 group"
      style={{
        background: isActive ? C.goldGlass : 'transparent',
        border: isActive ? `1px solid ${C.goldBorder}` : '1px solid transparent',
      }}
    >
      <item.icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: isActive ? C.gold : '#475569' }} />
      <span className="text-xs font-medium truncate" style={{ color: isActive ? C.gold : '#475569' }}>
        {item.label}
      </span>
    </button>
  );
}

export default function JurexioSDKHub() {
  const [location, setLocation] = useLocation();
  const isLegacyRoute = location.includes('/sdk-hub/legacy');
  const embeddedInSdkHub = location.startsWith('/sdk-hub') && !isLegacyRoute;
  const { user, logout } = useAuth() as any;
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedSections, setExpandedSections] = useState<string[]>(['PLATFORM HUBS', 'AGENT INTELLIGENCE']);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sidebarOpen, setSidebarOpen] = useState(!embeddedInSdkHub);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: healthData } = useQuery({
    queryKey: [nv('health')],
    queryFn: () => apiRequest(nv('health')),
    refetchInterval: 15000,
    retry: false,
  });

  const { data: agentData } = useQuery({
    queryKey: [nv('agents')],
    queryFn: () => apiRequest(nv('agents')),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: swarmStats } = useQuery({
    queryKey: [nv('swarm/stats')],
    queryFn: () => apiRequest(nv('swarm/stats')),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: usageData } = useQuery({
    queryKey: [nv('usage/summary')],
    queryFn: () => apiRequest(nv('usage/summary')),
    refetchInterval: 60000,
    retry: false,
  });

  const { data: contextData } = useQuery({
    queryKey: [nv('context/strategies')],
    queryFn: () => apiRequest(nv('context/strategies')),
    retry: false,
  });

  const { data: statutesSummaryRaw } = useQuery({
    queryKey: [nv('statutes/_summary')],
    queryFn: () => apiRequest(nv('statutes/_summary')),
    staleTime: 60000,
    retry: false,
  });

  const { data: registryAgentsRaw } = useQuery({
    queryKey: [nv('registry/agents')],
    queryFn: () => apiRequest(`${nv('registry/agents')}?limit=500`),
    staleTime: 120000,
    retry: false,
  });

  const { data: complianceIso } = useQuery({
    queryKey: [nv('compliance/iso')],
    queryFn: () => apiRequest(nv('compliance/iso')),
    staleTime: 120000,
    retry: false,
  });

  const { data: mcpCatalogData } = useQuery({
    queryKey: [nv('jrx-legal-tools/catalog'), 'hub-summary'],
    queryFn: () => apiRequest(`${nv('jrx-legal-tools/catalog')}?limit=1`),
    staleTime: 120000,
    retry: false,
  });

  const { data: adminStats } = useQuery({
    queryKey: [p('ADMIN_STATS')],
    queryFn: () => apiRequest(p('ADMIN_STATS')),
    staleTime: 60000,
    retry: false,
  });

  const { data: languagesData } = useQuery({
    queryKey: [nv('languages/list')],
    queryFn: () => apiRequest(nv('languages/list')),
    staleTime: 300000,
    retry: false,
  });

  const { data: healthFullRaw } = useQuery({
    queryKey: [p('HEALTH_FULL'), 'sdk-hub'],
    queryFn: () => apiRequest(p('HEALTH_FULL')),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: grpoCompliance } = useQuery({
    queryKey: [p('GRPO'), 'sdk-hub'],
    queryFn: () => apiRequest(p('GRPO')),
    staleTime: 60_000,
    retry: false,
  });

  const { data: grpoStatsRaw } = useQuery({
    queryKey: [nv('phase5/grpo/stats'), 'sdk-hub'],
    queryFn: () => apiRequest(`${nv('phase5/grpo/stats')}?limit=8`),
    staleTime: 60_000,
    retry: false,
  });

  const { data: camStatsRaw } = useQuery({
    queryKey: [p('CAM_STATS'), 'sdk-hub'],
    queryFn: () => apiRequest(p('CAM_STATS')),
    staleTime: 60_000,
    retry: false,
  });

  const { data: governanceSurface } = useQuery({
    queryKey: [p('GOVERNANCE_SURFACE'), 'sdk-hub'],
    queryFn: () => apiRequest(p('GOVERNANCE_SURFACE')),
    staleTime: 60_000,
    retry: false,
  });

  const { data: modelCatalog = [] } = useNvModelCatalog();

  const navigate = (path: string) => setLocation(path);

  const toggleSection = (label: string) => {
    setExpandedSections(prev =>
      prev.includes(label) ? prev.filter(s => s !== label) : [...prev, label]
    );
  };

  const systemStatus = nvHealthStatus(healthData);
  const totalAgents = nvAgentCount(agentData, healthData);
  const registryAgents = nvAsArray(registryAgentsRaw?.agents ?? registryAgentsRaw);
  const jurisdictions = nvJurisdictionsFromStatutesSummary(statutesSummaryRaw);
  const jurisdictionCount = jurisdictions.filter(j => j.statutes > 0).length || jurisdictions.length;
  const totalTopologies = swarmStats?.total || JRX_REGISTRY_RUNTIME.topologyCatalog;
  const complianceRows = useMemo(() => {
    const live = mapComplianceQuick(complianceIso);
    return live.length ? live : [];
  }, [complianceIso]);
  const mcpToolCount = Number(mcpCatalogData?.catalogTotal ?? mcpCatalogData?.total ?? 0);
  const languageCount = Number(
    languagesData?.count
    ?? (Array.isArray(languagesData?.languages) ? languagesData.languages.length : 0)
    ?? (Array.isArray(languagesData) ? languagesData.length : 0),
  );
  const llmProviderCount = nvAsArray(
    healthData?.services?.llm_providers?.configuredProviders
    ?? healthData?.services?.llm_providers?.providers
    ?? healthData?.providers,
  ).length;
  const topologyCategories = useMemo(() => {
    const bc = swarmStats?.byCategory as Record<string, number> | undefined;
    if (!bc || !Object.keys(bc).length) return [];
    const palette = [C.blue, C.emerald, C.gold, '#2A4A96', '#6B2FA0', '#C0521E', '#2A8A6A', '#3A6A9A', '#B06A20'];
    return Object.entries(bc)
      .filter(([, count]) => count > 0)
      .map(([name, count], i) => ({
        name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        count,
        color: palette[i % palette.length],
        desc: 'Live swarm registry',
      }));
  }, [swarmStats]);
  const practiceAreas = useMemo(() => {
    const summary = (registryAgentsRaw as { practiceAreaSummary?: Record<string, number> })?.practiceAreaSummary;
    const palette = [C.blue, '#6B2FA0', C.emerald, C.gold, '#C0521E', '#2A8A6A', '#3A6A9A', '#B06A20', '#8B3A8B', '#1A6A7A', '#7A4A1A', '#4A7A1A'];
    let rows: [string, number][];
    if (summary && Object.keys(summary).length) {
      rows = Object.entries(summary);
    } else {
      const buckets: Record<string, number> = {};
      for (const a of registryAgents) {
        const pa = String((a as { practice_area?: string; category?: string }).practice_area
          ?? (a as { category?: string }).category ?? 'General');
        buckets[pa] = (buckets[pa] ?? 0) + 1;
      }
      rows = Object.entries(buckets);
    }
    return rows
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([area, count], i) => ({ area, count, color: palette[i % palette.length] }));
  }, [registryAgentsRaw, registryAgents]);
  const practiceAreaCount = practiceAreas.length || JRX_REGISTRY_RUNTIME.practiceAreas;
  const monthlyApiCalls = usageData?.request_count ?? usageData?.total_requests ?? adminStats?.api_calls_30d ?? adminStats?.monthly_api_calls;
  const apiClientCount = adminStats?.active_api_keys ?? adminStats?.api_clients;
  const orgCount = adminStats?.organizations ?? adminStats?.orgs;
  const healthServices = (healthFullRaw as { services?: Record<string, unknown> })?.services ?? healthFullRaw;
  const llmHealthByProvider = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    const rows = nvAsArray(
      (healthServices as { llm_providers?: { health?: unknown[] } })?.llm_providers?.health,
    );
    for (const row of rows) {
      const id = String((row as { provider?: string; id?: string }).provider
        ?? (row as { id?: string }).id ?? '').toLowerCase();
      if (id) map.set(id, row as Record<string, unknown>);
    }
    return map;
  }, [healthServices]);
  const llmProviderRows = useMemo(
    () => buildLlmProviderRows(modelCatalog, llmHealthByProvider),
    [modelCatalog, llmHealthByProvider],
  );
  const securityKpis = useMemo(() => {
    const surface = governanceSurface as {
      guardrails?: { passRate?: number };
      guardrail_pass_rate?: number;
      incidents?: { open?: number };
      hitl?: { pending?: number };
      hitl_pending?: number;
    } | undefined;
    const passRate = Number(surface?.guardrails?.passRate ?? surface?.guardrail_pass_rate ?? 1);
    const score = Math.min(100, Math.round(passRate * 100));
    const openIncidents = Number(surface?.incidents?.open ?? 0);
    const hitlPending = Number(surface?.hitl?.pending ?? surface?.hitl_pending ?? 0);
    return [
      { label: 'Guardrail Pass Rate', value: `${score}/100`, color: score >= 90 ? C.emerald : C.gold, icon: Shield },
      { label: 'Open Incidents', value: String(openIncidents), color: openIncidents ? C.gold : C.emerald, icon: AlertTriangle },
      { label: 'HITL Pending', value: String(hitlPending), color: hitlPending ? C.gold : C.emerald, icon: Eye },
      { label: 'Audit Chain', value: 'SHA-256', color: C.blue, icon: Lock },
    ];
  }, [governanceSurface]);
  const ragRetrieval = (healthServices as { rag_retrieval?: Record<string, unknown> })?.rag_retrieval ?? {};
  const ragCorpus = (healthServices as { rag?: Record<string, unknown> })?.rag ?? {};
  const contextStrategies = nvAsArray(
    (contextData as { strategies?: unknown[] })?.strategies
    ?? (contextData as { data?: { strategies?: unknown[] } })?.data?.strategies,
  );
  const contextLayersLive = useMemo(() => {
    if (!contextStrategies.length) return [];
    const palette = [C.blue, C.emerald, C.gold, '#2A4A96', '#6B2FA0', '#C0521E', '#2A8A6A', '#3A6A9A'];
    return contextStrategies.slice(0, 8).map((s, i) => {
      const row = s as { name?: string; id?: string; description?: string; tokenBudget?: number };
      const tokens = Number(row.tokenBudget ?? 0);
      return {
        name: row.name ?? row.id ?? `Strategy ${i + 1}`,
        tokens,
        pct: tokens > 0 ? Math.min(100, Math.round((tokens / 14000) * 100)) : 0,
        color: palette[i % palette.length],
        detail: row.description,
      };
    });
  }, [contextStrategies]);
  const grpoTopAgents = useMemo(() => {
    const rows = nvAsArray(
      (grpoStatsRaw as { topAgents?: unknown[] })?.topAgents
      ?? (grpoStatsRaw as { data?: { topAgents?: unknown[] } })?.data?.topAgents,
    );
    return rows.slice(0, 8).map((a) => {
      const row = a as { agentName?: string; agentKey?: string; avgReward?: number; reward?: number; delta?: number };
      const score = Number(row.avgReward ?? row.reward ?? 0);
      return {
        agent: row.agentName ?? row.agentKey ?? 'Agent',
        score: score <= 1 ? Math.round(score * 100) : Math.round(score),
        delta: row.delta != null ? `${Number(row.delta) >= 0 ? '+' : ''}${Number(row.delta).toFixed(1)}` : '—',
        color: C.blue,
      };
    });
  }, [grpoStatsRaw]);
  const qualityKpis = useMemo(() => {
    const runs = (grpoCompliance as { training_runs?: Record<string, unknown> })?.training_runs ?? {};
    const surface = governanceSurface as Record<string, unknown> | undefined;
    const completed = Number(runs.completed ?? 0);
    const failed = Number(runs.failed ?? 0);
    const passRate = completed + failed > 0 ? (completed / (completed + failed)) * 100 : null;
    return [
      { label: 'GRPO Runs Completed', value: completed ? String(completed) : '—', color: C.emerald, icon: Target, sub: runs.last_run_at ? `Last ${String(runs.last_run_at).slice(0, 10)}` : 'Live /api/jrx/compliance/grpo' },
      { label: 'Policy Snapshots', value: String((grpoCompliance as { policy_snapshots?: { total?: number } })?.policy_snapshots?.total ?? '—'), color: C.blue, icon: CheckCircle, sub: 'GRPO policy registry' },
      { label: 'HITL Pending', value: String(surface?.hitl_pending ?? surface?.pending_hitl ?? '—'), color: C.gold, icon: Eye, sub: 'Governance surface' },
      { label: 'GRPO Pass Rate', value: passRate != null ? fmtPct(passRate) : '—', color: '#6B2FA0', icon: FlaskConical, sub: 'Completed vs failed runs' },
    ];
  }, [grpoCompliance, governanceSurface]);
  const llmOpsMetrics = useMemo(() => {
    const req = (healthServices as { requests?: { p50Ms?: number; p95Ms?: number } })?.requests ?? {};
    const cache = (healthServices as { prompt_cache?: { llm_prompt_cache?: { hitRate?: number } } })?.prompt_cache?.llm_prompt_cache ?? {};
    return [
      { label: 'Gateway p50', value: fmtMs(req.p50Ms), color: C.gold, icon: Clock },
      { label: 'Gateway p95', value: fmtMs(req.p95Ms), color: C.emerald, icon: TrendingUp },
      { label: 'RAG Chunks', value: String(ragCorpus.total_chunks ?? ragCorpus.totalChunks ?? '—'), color: C.blue, icon: Database },
      { label: 'Prompt Cache Hit', value: cache.hitRate != null ? fmtPct(Number(cache.hitRate) <= 1 ? Number(cache.hitRate) * 100 : cache.hitRate) : '—', color: '#6B2FA0', icon: Database },
    ];
  }, [healthServices, ragCorpus]);
  const camMemoryTiles = useMemo(() => {
    const s = camStatsRaw as Record<string, unknown> | undefined;
    if (!s || !Object.keys(s).length) return [];
    return [
      { layer: 'CAM Entries', desc: 'Indexed memory rows', capacity: String(s.totalEntries ?? s.entries ?? '—'), ttl: String(s.lastUpdated ?? 'Live'), color: C.gold },
      { layer: 'Pending Reviews', desc: 'HITL review queue', capacity: String(s.pendingReviews ?? s.pending ?? '—'), ttl: 'Rolling', color: C.blue },
      { layer: 'Approved Actions', desc: 'Audit-chained approvals', capacity: String(s.approved ?? '—'), ttl: 'Permanent', color: C.emerald },
      { layer: 'Rejected Actions', desc: 'Blocked CAM writes', capacity: String(s.rejected ?? '—'), ttl: 'Permanent', color: '#6B2FA0' },
    ];
  }, [camStatsRaw]);
  const footerStatusLabel = systemStatus === 'OPERATIONAL'
    ? 'All systems operational'
    : systemStatus === 'DEGRADED'
      ? 'Degraded — check health dashboard'
      : 'Checking platform health…';
  const footerStatusColor = systemStatus === 'OPERATIONAL' ? C.emerald : systemStatus === 'DEGRADED' ? C.gold : '#6b7280';

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'agents', label: 'Agent Intelligence', icon: Brain },
    { id: 'legal', label: 'Legal Infrastructure', icon: Gavel },
    { id: 'llm', label: 'LLM Operations', icon: Zap },
    { id: 'security', label: 'Security & Compliance', icon: Shield },
    { id: 'context', label: 'Context & Memory', icon: Layers },
    { id: 'sdk', label: 'SDK Gateway', icon: Code },
    { id: 'quality', label: 'AI Quality', icon: FlaskConical },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: C.navy }}>
      {isLegacyRoute && (
        <div className="flex-shrink-0 bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 flex items-center justify-between">
          <span>This is the legacy SDK Hub view — use the consolidated <strong>SDK Hub</strong> instead.</span>
          <button
            type="button"
            onClick={() => setLocation('/sdk-hub?tab=overview')}
            className="underline font-semibold text-[#152448] hover:opacity-80"
          >
            Open SDK Hub →
          </button>
        </div>
      )}

      {/* ── TOP HEADER (standalone legacy hub only — tab embed uses SDKHub shell) ── */}
      {!embeddedInSdkHub && (
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: C.glassBorder, background: '#FFFFFF', backdropFilter: 'blur(20px)' }} role="banner" aria-label="Page header">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(p => !p)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Layers className="h-4 w-4 text-muted-foreground" />
          </button>
          <img src="/nyayasiddhi-icon.png" alt="Jurexio" className="h-9 w-9 object-contain" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Jurexio Enterprise SDK Hub</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-mono font-bold" style={{ background: C.goldGlass, color: C.gold, border: `1px solid ${C.goldBorder}` }}>SDK v5.0.7</span>
            </div>
            <div className="text-xs" style={{ color: C.gold, fontFamily: 'serif' }}>Justice. Powered by Precision.</div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={{
                background: activeTab === tab.id ? C.goldGlass : 'transparent',
                color: activeTab === tab.id ? C.gold : '#475569',
                border: activeTab === tab.id ? `1px solid ${C.goldBorder}` : '1px solid transparent',
              }}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
            <Pulse color={systemStatus === 'OPERATIONAL' ? C.emerald : '#E4A010'} />
            <span className="text-xs font-mono font-bold" style={{ color: systemStatus === 'OPERATIONAL' ? C.emerald : '#E4A010' }}>{systemStatus}</span>
          </div>
          <div className="hidden sm:block text-xs text-muted-foreground font-mono">{currentTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })}</div>
          <button
            onClick={() => logout ? logout() : null}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-muted"
            style={{ color: '#475569' }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{user?.name?.split(' ')[0] || 'User'}</span>
          </button>
        </div>
      </header>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
        {sidebarOpen && !embeddedInSdkHub && (
          <aside className="flex-shrink-0 w-52 border-r overflow-y-auto flex flex-col" style={{ borderColor: C.glassBorder, background: '#FFFFFF', backdropFilter: 'blur(12px)' }} aria-label="Supplementary content">
            <div className="flex-1 py-3 px-2 space-y-1">
              {NAV_SECTIONS.map(section => (
                <div key={section.label}>
                  <button
                    onClick={() => toggleSection(section.label)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded text-left"
                  >
                    <span className="text-xs font-bold tracking-wider" style={{ color: '#64748B' }}>{section.label}</span>
                    {expandedSections.includes(section.label)
                      ? <ChevronUp className="h-3 w-3" style={{ color: '#64748B' }} />
                      : <ChevronDown className="h-3 w-3" style={{ color: '#64748B' }} />
                    }
                  </button>
                  {expandedSections.includes(section.label) && (
                    <div className="space-y-0.5 mb-1">
                      {section.items.map(item => (
                        <NavItem
                          key={item.path}
                          item={item}
                          isActive={false}
                          onClick={() => navigate(item.path)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex-shrink-0 p-3 border-t" style={{ borderColor: C.glassBorder }}>
              <div className="text-xs text-center mb-1" style={{ color: '#64748B' }}>Jurexio Legaltech LLP</div>
              <div className="text-xs text-center" style={{ color: 'rgba(212,160,23,0.5)' }}>© 2026 · GLAM™ OS</div>
            </div>
          </aside>
        )}

        {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 max-w-none">

            {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {/* KPI Row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <KpiCard label="ROMA L5 Agents" value={totalAgents} sub="v2 Registry · Active" icon={Brain} color={C.gold} onClick={() => navigate('/agent-registry')} />
                  <KpiCard label="Swarm Topologies" value={totalTopologies} sub="9 Categories" icon={Network} color={C.blue} onClick={() => navigate('/orchestration')} />
                  <KpiCard label="Jurisdictions" value={jurisdictionCount} sub="IN·UK·GCC·EU·US·SG" icon={Globe} color={C.emerald} onClick={() => navigate('/regulatory')} />
                  <KpiCard label="Languages" value={languageCount || '—'} sub="Live catalog" icon={Orbit} color="#6B2FA0" onClick={() => navigate('/lrm-dashboard')} />
                  <KpiCard label="MCP Tools" value={mcpToolCount || '—'} sub="Catalog total" icon={Cable} color="#C0521E" onClick={() => navigate('/sdk-console')} />
                  <KpiCard label="LLM Providers" value={llmProviderCount || '—'} sub="Configured" icon={Cpu} color="#2A8A6A" onClick={() => navigate('/model-catalog')} />
                </div>

                {/* 5+1 Platform Status Cards */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Jurexio Ecosystem Platforms</h2>
                    <span className="text-xs" style={{ color: '#475569' }}>6 platforms · Global Legal Operating System</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {PLATFORMS.map(p => (
                      <div
                        key={p.id}
                        onClick={() => navigate(p.path)}
                        className="rounded-xl p-3.5 cursor-pointer group hover:scale-105 transition-all duration-200"
                        style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${p.color}22` }}>
                            <p.icon className="h-4 w-4" style={{ color: p.color }} />
                          </div>
                          <span className="text-xs px-1.5 py-0.5 rounded font-mono font-bold" style={{ background: `${p.color}20`, color: p.color }}>
                            {p.badge}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-foreground mb-0.5 truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground mb-2 truncate">{p.tagline}</div>
                        {!embeddedInSdkHub ? (
                          <>
                            <div className="relative h-1 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                              <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${p.pct}%`, background: p.color }} />
                            </div>
                            <div className="text-xs mt-1 font-mono font-bold" style={{ color: p.color }}>{p.pct}%</div>
                          </>
                        ) : (
                          <div className="text-xs mt-1 text-muted-foreground">Bundled on gateway — see Dashboard › Platform Health</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Metrics Row: LLM + Compliance */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* LLM Status */}
                  <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>LLM Provider Matrix</h3>
                      <button onClick={() => navigate('/model-catalog')} className="text-xs flex items-center gap-1" style={{ color: C.gold }}>
                        View all <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {llmProviderRows.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Pulse color={p.status === 'active' ? C.emerald : C.gold} />
                          <span className="text-xs text-muted-foreground flex-1">{p.name}</span>
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: p.status === 'active' ? 'rgba(28,122,79,0.2)' : 'rgba(212,160,23,0.15)', color: p.status === 'active' ? C.emerald : C.gold }}>
                            {p.tier}
                          </span>
                          <span className="text-xs font-mono text-muted-foreground">{p.latencyLabel}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Compliance Quick View */}
                  <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Compliance Matrix</h3>
                      <button onClick={() => setActiveTab('security')} className="text-xs flex items-center gap-1" style={{ color: C.gold }}>
                        Full view <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {complianceRows.length ? complianceRows.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: '#FFFFFF' }}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${c.color}20` }}>
                            <span className="text-xs font-bold" style={{ color: c.color }}>{c.score}%</span>
                          </div>
                          <div>
                            <div className="text-xs font-bold text-muted-foreground leading-tight">{c.name}</div>
                            <div className="text-xs" style={{ color: c.score >= 90 ? C.emerald : C.gold }}>{c.status}</div>
                          </div>
                        </div>
                      )) : (
                        <div className="col-span-2">
                          <JrxEmptyState title="No compliance evidence yet" description="Run POST /api/jrx/compliance/iso/refresh to populate framework posture." />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>Quick Access — Core Workflows</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                    {[
                      { label: 'Instant Search', icon: Search, path: '/instant-search', color: C.gold },
                      { label: 'Live Legal Feed', icon: Globe, path: '/legal-intelligence-feed', color: C.blue },
                      { label: 'Agent Registry', icon: Bot, path: '/agent-registry', color: C.blue },
                      { label: 'GRPO Training', icon: Target, path: '/orchestration/grpo', color: C.gold },
                      { label: 'Agent Flows', icon: GitBranch, path: '/agent-flows', color: '#6B2FA0' },
                      { label: 'AI Legal Chat', icon: Users, path: '/legal-chat', color: '#C0521E' },
                      { label: 'Central Intelligence', icon: Target, path: '/intelligence/dashboard', color: '#2A8A6A' },
                      { label: 'SDK Playground', icon: Webhook, path: '/sdk-playground', color: '#3A6A9A' },
                      { label: 'HITL Decisions', icon: Eye, path: '/decision-cards', color: '#B06A20' },
                    ].map((a, i) => (
                      <button
                        key={i}
                        onClick={() => navigate(a.path)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:scale-105 transition-all duration-200"
                        style={{ background: `${a.color}15`, border: `1px solid ${a.color}25` }}
                      >
                        <a.icon className="h-5 w-5" style={{ color: a.color }} />
                        <span className="text-xs text-center text-muted-foreground leading-tight">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── AGENT INTELLIGENCE TAB ───────────────────────────── */}
            {activeTab === 'agents' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Agent Intelligence — ROMA L5 Registry</h2>
                  <div className="flex gap-2">
                    <button onClick={() => navigate('/agent-registry')} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: C.goldGlass, color: C.gold, border: `1px solid ${C.goldBorder}` }}>
                      Open Agent Registry
                    </button>
                    <button onClick={() => navigate('/roma-l5-admin')} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: C.glass, color: '#475569', border: `1px solid ${C.glassBorder}` }}>
                      ROMA L5 Admin
                    </button>
                  </div>
                </div>

                {/* Topology Categories */}
                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>{totalTopologies} Swarm Topology Categories</h3>
                  {topologyCategories.length ? (
                    <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
                      {topologyCategories.map((t, i) => (
                        <div key={i} className="rounded-xl p-3 text-center" style={{ background: `${t.color}15`, border: `1px solid ${t.color}25` }}>
                          <div className="text-2xl font-bold mb-0.5" style={{ color: t.color, fontFamily: 'Merriweather, serif' }}>{t.count}</div>
                          <div className="text-xs font-bold text-muted-foreground">{t.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{t.desc}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <JrxEmptyState title="Topology breakdown unavailable" description="Swarm stats will populate when the registry is loaded." />
                  )}
                </div>

                {/* Agent Practice Areas */}
                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>{totalAgents} Agents · {practiceAreaCount} Practice Areas</h3>
                  {practiceAreas.length ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {practiceAreas.map((a, i) => (
                        <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ background: '#FFFFFF' }}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${a.color}20` }}>
                            <span className="text-sm font-bold" style={{ color: a.color }}>{a.count}</span>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-muted-foreground">{a.area}</div>
                            <div className="h-1 w-16 rounded-full mt-1" style={{ background: '#E2E8F0' }}>
                              <div className="h-1 rounded-full" style={{ width: `${Math.min(100, (a.count / Math.max(...practiceAreas.map(p => p.count), 1)) * 100)}%`, background: a.color }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <JrxEmptyState title="No practice-area breakdown" description="Agent registry data is loading or empty." />
                  )}
                </div>

                {/* Orchestration Links */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: 'A2A Collaboration Protocol', desc: 'Agent-to-Agent Google standard communication mesh', icon: Network, path: '/orchestration/a2a', color: C.blue },
                    { label: 'GRPO Training Dashboard', desc: 'Group Relative Policy Optimization for the 164-agent runtime registry', icon: Target, path: '/orchestration/grpo', color: C.gold },
                    { label: 'BMAD Workflow Visualizer', desc: 'Breakthrough Method Agentic Decomposition pipelines', icon: GitBranch, path: '/orchestration/bmad', color: C.emerald },
                  ].map((item, i) => (
                    <div
                      key={i}
                      onClick={() => navigate(item.path)}
                      className="rounded-xl p-4 cursor-pointer hover:scale-105 transition-all duration-200"
                      style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}
                    >
                      <item.icon className="h-6 w-6 mb-2" style={{ color: item.color }} />
                      <div className="text-sm font-bold text-foreground mb-1" style={{ fontFamily: 'Merriweather, serif' }}>{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── LEGAL INFRASTRUCTURE TAB ─────────────────────────── */}
            {activeTab === 'legal' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Legal Infrastructure — 6 Jurisdictions</h2>
                  <button onClick={() => navigate('/regulatory')} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: C.goldGlass, color: C.gold, border: `1px solid ${C.goldBorder}` }}>
                    Regulatory Monitor
                  </button>
                </div>

                {/* Jurisdiction Cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {jurisdictions.map(j => (
                    <div key={j.code} className="rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/statutes-citations')} style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                      <div className="text-3xl mb-2">{j.flag}</div>
                      <div className="text-sm font-bold text-foreground mb-0.5">{j.code}</div>
                      <div className="text-xs text-muted-foreground mb-2">{j.name}</div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Statutes</span>
                          <span className="text-xs font-bold" style={{ color: C.gold }}>{j.statutes.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Pulse color={j.active ? C.emerald : '#94A3B8'} />
                          <span className="text-xs" style={{ color: j.active ? C.emerald : '#94A3B8' }}>{j.active ? 'Active' : 'Pending'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Platform Feature Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'AI Legal Chat', desc: 'Central jurisdiction-aware legal Q&A across all 6 SLMs + NS LRM orchestration', icon: Users, path: '/legal-chat', color: C.blue, stats: '6 jurisdictions · 47 languages' },
                    { label: 'Central Intelligence', desc: 'Cross-jurisdiction intelligence hub — research, classify, predict, sentiment, translate', icon: Target, path: '/intelligence/dashboard', color: C.emerald, stats: '6 capabilities · realtime' },
                    { label: 'Agent Registry', desc: '164 governed legal agents in the active v5.1.0 runtime registry', icon: Bot, path: '/agent-registry', color: C.gold, stats: '164 agents · v5.1.0 runtime' },
                    { label: 'LRM Router', desc: 'Legal Resource Management — 47-language intelligent routing engine', icon: Route, path: '/lrm-dashboard', color: '#6B2FA0', stats: '47 languages · Auto-detect' },
                  ].map((item, i) => (
                    <div
                      key={i}
                      onClick={() => navigate(item.path)}
                      className="rounded-xl p-4 cursor-pointer hover:scale-105 transition-all duration-200"
                      style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${item.color}20` }}>
                        <item.icon className="h-5 w-5" style={{ color: item.color }} />
                      </div>
                      <div className="text-sm font-bold text-foreground mb-1" style={{ fontFamily: 'Merriweather, serif' }}>{item.label}</div>
                      <div className="text-xs text-muted-foreground mb-2">{item.desc}</div>
                      <div className="text-xs font-mono px-2 py-0.5 rounded inline-block" style={{ background: `${item.color}15`, color: item.color }}>{item.stats}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── LLM OPERATIONS TAB ───────────────────────────────── */}
            {activeTab === 'llm' && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>
                  LLM Operations — {llmProviderRows.length} providers · live health
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>Active LLM Providers</h3>
                    <div className="space-y-2.5">
                      {llmProviderRows.map((p, i) => (
                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: '#FFFFFF' }}>
                          <Pulse color={p.status === 'active' ? C.emerald : C.gold} />
                          <div className="flex-1">
                            <div className="text-xs font-medium text-muted-foreground">{p.name}</div>
                            <div className="text-xs text-muted-foreground">{p.tier} · {p.status}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-mono" style={{ color: C.gold }}>{p.latencyLabel}</div>
                            <div className="text-xs text-muted-foreground">{p.errorLabel} err</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                      <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>Gateway Latency & RAG</h3>
                      {!healthFullRaw ? (
                        <JrxEmptyState title="Health metrics loading" description="Open Model Catalog or retry when /api/jrx/admin/health/full responds." />
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {llmOpsMetrics.map((m, i) => (
                            <div key={i} className="rounded-xl p-3" style={{ background: '#FFFFFF' }}>
                              <m.icon className="h-4 w-4 mb-1" style={{ color: m.color }} />
                              <div className="text-lg font-bold" style={{ color: m.color }}>{m.value}</div>
                              <div className="text-xs text-muted-foreground">{m.label}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: 'LLM Priority Dashboard', desc: 'Configure provider priorities, cost thresholds, fallback chains', icon: Gauge, path: '/llm-priority', color: C.blue },
                    { label: 'Model Catalog', desc: `${llmProviderCount || llmProviderRows.length} providers · capability matrix · jurisdiction routing`, icon: Package, path: '/model-catalog', color: C.gold },
                    { label: 'Drift Monitoring', desc: 'Statistical drift detection · alert thresholds · retraining triggers', icon: LineChart, path: '/drift-monitor', color: C.emerald },
                  ].map((item, i) => (
                    <div key={i} onClick={() => navigate(item.path)} className="rounded-xl p-4 cursor-pointer hover:scale-105 transition-all" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                      <item.icon className="h-5 w-5 mb-2" style={{ color: item.color }} />
                      <div className="text-sm font-bold text-foreground mb-1">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── SECURITY & COMPLIANCE TAB ────────────────────────── */}
            {activeTab === 'security' && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Security & Compliance — ISO 42001 · 27001 · SOC2 · DPDPA · GDPR</h2>

                {/* Security Posture */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {securityKpis.map((m, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                      <m.icon className="h-5 w-5 mb-2" style={{ color: m.color }} />
                      <div className="text-xl font-bold mb-0.5" style={{ color: m.color, fontFamily: 'Merriweather, serif' }}>{m.value}</div>
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* Compliance Matrix */}
                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>Full Compliance Matrix</h3>
                  {complianceRows.length ? (
                    <div className="space-y-3">
                      {complianceRows.map((c, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-32 flex-shrink-0">
                            <div className="text-xs font-bold text-muted-foreground">{c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.domain}</div>
                          </div>
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${c.score}%`, background: c.color }} />
                          </div>
                          <div className="w-12 text-right text-xs font-bold font-mono" style={{ color: c.color }}>{c.score}%</div>
                          <div className="w-20 text-right">
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${c.color}20`, color: c.color }}>{c.status}</span>
                          </div>
                          <div className="w-16 text-right text-xs text-muted-foreground">{c.controls} ctrl</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <JrxEmptyState title="Compliance evidence not loaded" description="Populate via compliance ISO refresh or open Super Admin Compliance." />
                  )}
                </div>

                {/* Security Pipeline */}
                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>Security Chain-of-Thought Pipeline</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { node: 'Input', color: C.blue },
                      { node: 'PII Detection (DPDPA §10)', color: C.emerald },
                      { node: 'PII Redaction (UK/EU GDPR)', color: C.emerald },
                      { node: 'Context Engineering', color: C.blue },
                      { node: 'ROMA L5 Router', color: C.gold },
                      { node: 'LLM Processing (ISO 42001)', color: C.gold },
                      { node: 'RAG + Hallucination Guard', color: '#6B2FA0' },
                      { node: 'HITL Gate (conf < 0.85)', color: '#C0521E' },
                      { node: 'SHA-256 Hash Chain (SOC2)', color: C.blue },
                      { node: 'Secure Output', color: C.emerald },
                    ].map((n, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ background: `${n.color}20`, color: n.color, border: `1px solid ${n.color}30` }}>
                          {n.node}
                        </div>
                        {i < 9 && <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Hash Chain Audit', path: '/hash-chain', icon: Fingerprint, color: C.blue, desc: 'SHA-256 tamper-evident audit trail' },
                    { label: 'Adversarial Testing', path: '/adversarial', icon: FlaskConical, color: C.gold, desc: 'Red-team, prompt injection, jailbreak detection' },
                    { label: 'HITL Decision Cards', path: '/decision-cards', icon: Eye, color: C.emerald, desc: 'Human-in-the-loop review queue' },
                  ].map((item, i) => (
                    <div key={i} onClick={() => navigate(item.path)} className="rounded-xl p-4 cursor-pointer hover:scale-105 transition-all" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                      <item.icon className="h-5 w-5 mb-2" style={{ color: item.color }} />
                      <div className="text-sm font-bold text-foreground mb-1">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── CONTEXT & MEMORY TAB ─────────────────────────────── */}
            {activeTab === 'context' && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>Context Engineering & Memory Management — Parlant v10</h2>

                {/* Context Layers */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>Context Strategies — live catalog</h3>
                    {contextLayersLive.length ? (
                      <div className="space-y-2.5">
                        {contextLayersLive.map((l, i) => (
                          <div key={i}>
                            <div className="flex justify-between mb-1">
                              <span className="text-xs text-muted-foreground">{l.name}</span>
                              <span className="text-xs font-mono font-bold" style={{ color: l.color }}>{l.tokens ? `${l.tokens.toLocaleString()} tok` : '—'}</span>
                            </div>
                            {l.pct > 0 && (
                              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                                <div className="h-full rounded-full" style={{ width: `${l.pct}%`, background: l.color }} />
                              </div>
                            )}
                            {l.detail && <div className="text-xs text-muted-foreground mt-1">{l.detail}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <JrxEmptyState title="No context strategies yet" description="GET /api/jrx/context/strategies returns Parlant optimization presets when authenticated." />
                    )}
                  </div>

                  <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>RAG Pipeline — live retrieval stats</h3>
                    <div className="space-y-2.5">
                      {RAG_PIPELINE_STEPS.map((r, i) => (
                        <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg" style={{ background: '#FFFFFF' }}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold" style={{ background: `${C.blue}40`, color: C.gold }}>
                            {i + 1}
                          </div>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-muted-foreground">{r.step}</div>
                            <div className="text-xs text-muted-foreground">{r.detail}</div>
                          </div>
                          <div className="text-xs font-mono flex-shrink-0" style={{ color: C.emerald }}>
                            {i === 1 ? fmtMs(ragRetrieval.avgLatencyMs ?? ragRetrieval.p50Ms) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 p-2 rounded-lg text-xs flex justify-between" style={{ background: 'rgba(28,122,79,0.1)' }}>
                      <span style={{ color: C.emerald }}>Corpus chunks</span>
                      <span className="font-mono font-bold" style={{ color: C.emerald }}>{String(ragCorpus.total_chunks ?? ragCorpus.totalChunks ?? '—')}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>CAM Memory — live stats</h3>
                  {camMemoryTiles.length ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {camMemoryTiles.map((m, i) => (
                        <div key={i} className="rounded-xl p-3" style={{ background: `${m.color}15`, border: `1px solid ${m.color}25` }}>
                          <div className="text-xs font-bold mb-1" style={{ color: m.color }}>{m.layer}</div>
                          <div className="text-xs text-muted-foreground mb-2">{m.desc}</div>
                          <div className="text-xs text-muted-foreground">Count: <span style={{ color: m.color }}>{m.capacity}</span></div>
                          <div className="text-xs text-muted-foreground">Updated: <span style={{ color: m.color }}>{m.ttl}</span></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <JrxEmptyState title="CAM stats unavailable" description="Open CAM Memory Browser or check GET /api/jrx/cam/stats." />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => navigate('/orchestration/memory')} className="p-4 rounded-xl text-left transition-all hover:scale-105" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <Database className="h-5 w-5 mb-2" style={{ color: C.gold }} />
                    <div className="text-sm font-bold text-foreground">CAM Memory Browser</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Browse, search and manage all memory layers</div>
                  </button>
                  <button onClick={() => navigate('/orchestration/policies')} className="p-4 rounded-xl text-left transition-all hover:scale-105" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                    <ScrollText className="h-5 w-5 mb-2" style={{ color: C.emerald }} />
                    <div className="text-sm font-bold text-foreground">Policy Management</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Context policies, retrieval rules, memory governance</div>
                  </button>
                </div>
              </div>
            )}

            {/* ── SDK GATEWAY TAB ──────────────────────────────────── */}
            {activeTab === 'sdk' && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>SDK Gateway — {mcpToolCount || '—'} MCP Tools · API Management · Multi-Org</h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'MCP Tools Live', value: mcpToolCount ? String(mcpToolCount) : '—', color: C.blue, icon: Cable },
                    { label: 'API Clients', value: apiClientCount != null ? String(apiClientCount) : '—', color: C.gold, icon: Key },
                    { label: 'Monthly API Calls', value: monthlyApiCalls != null ? Number(monthlyApiCalls).toLocaleString() : '—', color: C.emerald, icon: Activity },
                    { label: 'Organizations', value: orgCount != null ? String(orgCount) : '—', color: '#6B2FA0', icon: Building2 },
                  ].map((m, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                      <m.icon className="h-5 w-5 mb-2" style={{ color: m.color }} />
                      <div className="text-2xl font-bold mb-0.5" style={{ color: m.color, fontFamily: 'Merriweather, serif' }}>{m.value}</div>
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* MCP Tool Categories */}
                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>MCP Tool Catalog</h3>
                  {mcpToolCount > 0 ? (
                    <p className="text-xs text-muted-foreground mb-3">{mcpToolCount} tools in catalog — open SDK Console for category breakdown.</p>
                  ) : (
                    <JrxEmptyState title="MCP catalog loading" description="Tool categories appear when /api/jrx/jrx-legal-tools/catalog responds." />
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: 'SDK API Playground', desc: 'Interactive endpoint testing, request builder, live responses', icon: Webhook, path: '/sdk-playground', color: C.blue },
                    { label: 'SDK Downloads', desc: 'NPM packages, Python SDK, REST client, OpenAPI spec', icon: Package, path: '/sdk-downloads', color: C.gold },
                    { label: 'White Label Admin', desc: 'Brand themes, custom domains, org-specific SDK config', icon: Palette, path: '/white-label', color: C.emerald },
                  ].map((item, i) => (
                    <div key={i} onClick={() => navigate(item.path)} className="rounded-xl p-4 cursor-pointer hover:scale-105 transition-all" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                      <item.icon className="h-5 w-5 mb-2" style={{ color: item.color }} />
                      <div className="text-sm font-bold text-foreground mb-1">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── AI QUALITY TAB ───────────────────────────────────── */}
            {activeTab === 'quality' && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Merriweather, serif' }}>AI Quality & Operations — Drift · Adversarial · Hallucination</h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {qualityKpis.map((m, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                      <m.icon className="h-5 w-5 mb-2" style={{ color: m.color }} />
                      <div className="text-2xl font-bold mb-0.5" style={{ color: m.color, fontFamily: 'Merriweather, serif' }}>{m.value}</div>
                      <div className="text-xs text-muted-foreground mb-0.5">{m.label}</div>
                      <div className="text-xs" style={{ color: m.color }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl p-4" style={{ background: C.glass, border: `1px solid ${C.glassBorder}` }}>
                  <h3 className="text-sm font-bold text-foreground mb-3" style={{ fontFamily: 'Merriweather, serif' }}>GRPO Training — live leaderboard</h3>
                  {grpoTopAgents.length ? (
                    <div className="space-y-3">
                      {grpoTopAgents.map((a, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-40 text-xs text-muted-foreground truncate">{a.agent}</div>
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, a.score)}%`, background: a.color }} />
                          </div>
                          <div className="w-12 text-right text-xs font-bold font-mono" style={{ color: a.color }}>{a.score}</div>
                          <div className="w-12 text-right text-xs" style={{ color: C.emerald }}>{a.delta}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <JrxEmptyState title="No GRPO leaderboard yet" description="Submit feedback via GRPO Training or wait for /api/jrx/phase5/grpo/stats to populate." />
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Model Drift Monitor', desc: 'Statistical drift detection · KL divergence · PSI · alerts', icon: LineChart, path: '/drift-monitor', color: C.blue },
                    { label: 'Adversarial Testing Suite', desc: 'Prompt injection · jailbreak · roleplay attacks · red-team', icon: FlaskConical, path: '/adversarial', color: C.gold },
                    { label: 'P1 AI Quality Test', desc: 'End-to-end quality benchmarks · jurisdiction accuracy', icon: Award, path: '/p1-ai-quality', color: C.emerald },
                  ].map((item, i) => (
                    <div key={i} onClick={() => navigate(item.path)} className="rounded-xl p-4 cursor-pointer hover:scale-105 transition-all" style={{ background: `${item.color}15`, border: `1px solid ${item.color}25` }}>
                      <item.icon className="h-5 w-5 mb-2" style={{ color: item.color }} />
                      <div className="text-sm font-bold text-foreground mb-1">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      {/* ── FOOTER STATUS BAR ────────────────────────────────────── */}
      <footer className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-t" style={{ borderColor: C.glassBorder, background: '#FFFFFF' }} role="contentinfo" aria-label="Page footer">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Pulse color={footerStatusColor} />
            <span className="text-xs text-muted-foreground">{footerStatusLabel}</span>
          </div>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{totalAgents} agents · {totalTopologies} topologies · {mcpToolCount || '—'} MCP tools</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Jurexio Enterprise Platform SDK v5.0.7 · Instant Search + Legal Feed · Platform v5.0.0</span>
          <span className="text-xs" style={{ color: C.gold, fontFamily: 'serif' }}>Justice. Powered by Precision.</span>
        </div>
      </footer>
    </div>
  );
}
