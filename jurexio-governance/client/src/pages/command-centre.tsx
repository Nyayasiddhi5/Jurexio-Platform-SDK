/**
 * @deprecated Superseded by console-dashboard.tsx + Operations/Intelligence hubs.
 * Retained for deep-link compatibility only — do not add new panels here.
 */
import React, { useState, useMemo } from 'react';
import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Phase5Section } from '../components/command-centre/phase5-section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '@/lib/jrx-auth-token';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  LayoutDashboard, Bot, Brain, Cpu, Globe, Shield, Activity, Settings,
  Search, Plus, Power, PowerOff,
  BarChart3, TrendingUp, CheckCircle, AlertTriangle, Clock, Zap, Database,
  Server, Network, FileText, Layers, DollarSign, Play, RotateCcw,
  ChevronRight, ChevronLeft, Users, Building2, Gavel, Award, BookOpen,
  Code, Workflow, Sparkles, Monitor, Gauge, Eye, ThumbsUp, ThumbsDown,
  AlertCircle, XCircle, Scan, Mic, FileOutput, FlaskConical, LineChart,
  Lock, Key, Bell, Package, Webhook, CreditCard, Palette, Link, Trash2,
  UserPlus, BookMarked, Boxes, Cable, AlarmClock, Megaphone, Mail,
  ToggleLeft, Sliders, Globe2, Plug, FolderOpen,
  Inbox, MoreHorizontal, Download, Upload, Filter, ExternalLink, Star,
  PlusCircle, Copy, Send, Phone, CheckSquare, Tag, Target
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
const COLORS = {
  royalBlue: '#152448',
  deepNavy: '#152448',
  midBlue: '#2B384C',
  gold: '#C7B15B',
  lightGold: '#E4B027',
  emerald: '#1C7A4F',
  darkEmerald: '#2C8A5F',
  darkBlue: '#0E1830',
};

const CHART_COLORS = [COLORS.royalBlue, COLORS.gold, COLORS.emerald, COLORS.deepNavy, COLORS.midBlue, COLORS.lightGold, COLORS.darkEmerald, COLORS.darkBlue];

const PLATFORMS = [
  {
    id: './jrx-sdk', name: 'Jurexio SDK', fullName: 'Jurexio SDK — developer tools & platform API',
    desc: 'AI Backbone · ROMA L5 Agents · Multi-LLM Routing · 6 Jurisdictions',
    route: '/api/jurexio', icon: Brain, color: COLORS.royalBlue, healthPath: nv('health'),
    consolePath: null as string | null, standalonePort: null as string | null, badge: 'CURRENT',
    completion: 95, category: 'Core SDK',
    pending: ['Production deployment', 'Performance load testing', 'SDK v2 documentation'],
  },
  {
    id: 'jurexio-citizen', name: 'Jurexio Citizen', fullName: 'Jurexio Citizen — Citizen Legal Assistance Platform',
    desc: 'AI-powered legal help for citizens · Case intake · Lawyer discovery · 22 Languages',
    route: '/api/jurexio-citizen', icon: Users, color: COLORS.emerald, healthPath: '/api/jurexio-citizen/health',
    consolePath: '/console/jurexio-citizen', standalonePort: null, badge: 'BETA',
    completion: 88, category: 'Citizen Services',
    pending: ['Mobile app (Flutter)', '22-language translation completion', 'Lawyer marketplace integration'],
  },
  {
    id: 'nsp', name: 'Jurexio Professional™', fullName: 'Jurexio Professional — Practice Management OS',
    desc: 'Complete practice management · Cases · Documents · AI Research · Time & Billing',
    route: '/ns/v1', icon: Gavel, color: COLORS.gold, healthPath: '/ns/v1/healthz',
    consolePath: '/console/nyayasiddhi-professional', standalonePort: '5001', badge: 'LIVE',
    completion: 90, category: 'Legal Practice',
    pending: ['Mobile app (Flutter) completion', 'Stripe subscription production keys', 'Offline sync capability'],
  },
  {
    id: 'nsi', name: 'Jurexio Institutional™', fullName: 'Jurexio Institutional — Enterprise Legal Governance',
    desc: 'Enterprise legal governance · Ethical walls · Matter lifecycle · Multi-branch · SSO',
    route: '/api/nyayasiddhi-institutional', icon: Building2, color: COLORS.deepNavy, healthPath: '/api/nyayasiddhi-institutional/health',
    consolePath: '/console/institutional', standalonePort: '5001', badge: 'BETA',
    completion: 70, category: 'Enterprise',
    pending: ['Ethical wall enforcement engine', 'SSO/SAML integration', 'Multi-jurisdiction billing', 'On-premise deployment mode'],
  },
  {
    id: 'nsg', name: 'Jurexio Ministry™', fullName: 'Jurexio Ministry — AI & Regulatory Governance',
    desc: 'AI model governance · DPDPA compliance · Enforcement monitoring · Regulatory audit chain',
    route: '/api/jurexio/governance', icon: Shield, color: COLORS.midBlue, healthPath: nv('health'),
    consolePath: '/console/enforcement', standalonePort: null, badge: 'BETA',
    completion: 65, category: 'Governance',
    pending: ['Dedicated governance portal UI', 'WORM audit chain implementation', 'Regulatory API integrations'],
  },
  {
    id: 'ns-academy', name: 'Jurexio Academy™', fullName: 'Jurexio Academy — Legal Intelligence Training',
    desc: 'AI-powered legal training · CLE certifications · CPD management · Draft simulation',
    route: '/api/nyayasiddhi-academy', icon: BookOpen, color: COLORS.lightGold, healthPath: '/api/nyayasiddhi-academy/health',
    consolePath: '/console/academy', standalonePort: null, badge: 'IN PROGRESS',
    completion: 55, category: 'Education',
    pending: ['Course content library', 'Certification engine', 'CPD tracking system', 'AI mentor fine-tuning', 'Bar Council integration'],
  },
];

/** Maps command-centre platform ids → nv_sdk_applications.platform_type */
const PLATFORM_REGISTRY_ALIAS: Record<string, string> = {
  'jurexio-citizen': 'jurexio-citizen',
  nsp: 'nyayasiddhi-professional',
  nsi: 'nyayasiddhi-institution',
  nsg: 'nyayasiddhi-ministry',
  'ns-academy': 'nyayasiddhi-academy',
};

const SIDEBAR_GROUPS = [
  {
    group: 'Core Platform',
    items: [
      { id: 'overview', label: 'Command Overview', icon: LayoutDashboard },
      { id: 'users', label: 'User Management', icon: Users },
      { id: 'tenants', label: 'Tenant & Billing', icon: CreditCard },
      { id: 'platforms', label: 'Platform Control', icon: Monitor },
    ],
  },
  {
    group: 'AI Intelligence',
    items: [
      { id: 'agents', label: 'AI Agents Studio', icon: Bot },
      { id: 'models', label: 'LLM Management', icon: Brain },
      { id: 'orchestration', label: 'Orchestration Suite', icon: Workflow },
      { id: 'knowledge', label: 'Knowledge Base', icon: BookMarked },
      { id: 'tools', label: 'Tools & Protocols', icon: Code },
    ],
  },
  {
    group: 'Developer Tools',
    items: [
      { id: 'api-lab', label: 'API Lab', icon: FlaskConical },
      { id: 'connectors', label: 'Connectors Hub', icon: Plug },
      { id: 'developer', label: 'Developer Portal', icon: Code },
      { id: 'platform', label: 'Platform Publishing', icon: Globe },
    ],
  },
  {
    group: 'Analytics & Monitoring',
    items: [
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
      { id: 'observability', label: 'Observability', icon: Activity },
      { id: 'alerts', label: 'Alerting Engine', icon: Bell },
    ],
  },
  {
    group: 'Governance & Security',
    items: [
      { id: 'compliance', label: 'DPDPA & Compliance', icon: Shield },
      { id: 'governance', label: 'AI Governance', icon: Lock },
      { id: 'settings', label: 'System Config', icon: Settings },
    ],
  },
  {
    group: 'Advanced AI',
    items: [
      { id: 'phase4', label: 'Phase 4 – Advanced AI', icon: Sparkles },
      { id: 'phase5', label: 'Phase 5 – Next-Gen AI', icon: Zap },
    ],
  },
];

const SIDEBAR_SECTIONS = SIDEBAR_GROUPS.flatMap(g => g.items);

function safeArr(d: any): any[] { return Array.isArray(d) ? d : (d?.data && Array.isArray(d.data) ? d.data : []); }
function safeObj(d: any): any { return d?.data || d || {}; }
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function CommandCentre() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeSection, setActiveSection] = useState('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const token = typeof localStorage !== 'undefined' ? (getAuthToken()) : '';
  const [searchQuery, setSearchQuery] = useState('');
  const [agentTierFilter, setAgentTierFilter] = useState('all');
  const [agentStatusFilter, setAgentStatusFilter] = useState('all');

  const fetchApi = async (url: string) => {
    try {
      return await apiRequest(url);
    } catch (e: any) {
      // Propagate rate-limit / overload errors so react-query's retry policy
      // (no-retry on 429) + error-aware refetchInterval below can throttle the
      // poller. This is what stops the overview 429 polling storm (D-5): when a
      // poll is rate-limited the query enters error state and backs off instead
      // of continuing to fire at the short cadence. Other errors stay soft (null)
      // to preserve the existing empty-state rendering everywhere else.
      if (e?.status === 429 || e?.status === 503) throw e;
      return null;
    }
  };

  // Error-aware poll cadence: keep the normal interval while healthy, but back
  // off hard (≥2min) once a poll is rate-limited/erroring so the console stops
  // self-throttling. Pairs with queryClient's Retry-After-honouring retryDelay.
  const pollMs = (base: number) => (query: any) =>
    query?.state?.error ? Math.min(Math.max(base * 4, 120_000), 300_000) : base;

  // Health must be resilient: `/api/jrx/health` returns 503 (not 200) when ANY
  // sub-service is degraded, which would make `apiRequest` throw and leave the
  // header badge stuck on "Connecting…". Read the body regardless of status so
  // the badge reflects the live state (healthy / degraded / unhealthy).
  const fetchHealth = async (url: string) => {
    try {
      const headers: Record<string, string> = {};
      const t = getAuthToken();
      if (t) headers['Authorization'] = `Bearer ${t}`;
      const res = await fetch(url, { headers, credentials: 'include' });
      // Back off on rate-limit (the 15s health poller is a top storm contributor):
      // throw so the error-aware interval slows it down and Retry-After is honoured.
      if (res.status === 429) {
        const err: any = new Error('rate_limited');
        err.status = 429;
        const ra = res.headers.get('Retry-After');
        if (ra) { const s = Number(ra); err.retryAfterMs = Number.isFinite(s) ? s * 1000 : Math.max(0, new Date(ra).getTime() - Date.now()); }
        throw err;
      }
      const json = await res.json().catch(() => null);
      if (!json) return null;
      return (json && typeof json === 'object' && 'data' in json && 'success' in json) ? (json as any).data : json;
    } catch (e: any) {
      if (e?.status === 429) throw e;
      return null;
    }
  };

  const { data: nvDashboard } = useQuery({
    queryKey: [nv('dashboard')],
    queryFn: () => fetchApi(nv('dashboard')),
    refetchInterval: pollMs(30000),
    placeholderData: (prev: any) => prev,
  });

  const { data: nvHealth, isLoading: healthLoading } = useQuery({
    queryKey: [nv('health')],
    queryFn: () => fetchHealth(nv('health')),
    refetchInterval: pollMs(15000),
    placeholderData: (prev: any) => prev,
  });

  const { data: sdkDashboard } = useQuery({
    queryKey: [nv('admin/stats'), 'sdk-dashboard'],
    queryFn: () => fetchApi(nv('admin/stats')),
    refetchInterval: pollMs(30000),
    placeholderData: (prev: any) => prev,
  });

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: [nv('registry/agents'), searchQuery, agentTierFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500' });
      if (agentTierFilter !== 'all') params.append('tier', agentTierFilter);
      return fetchApi(`${NV_BASE}registry/agents?${params}`);
    },
    refetchInterval: pollMs(60000),
    placeholderData: (prev: any) => prev,
  });

  const { data: providersData, isLoading: providersLoading, isError: providersError, refetch: refetchProviders } = useQuery({
    queryKey: [nv('providers')],
    queryFn: () => fetchApi(nv('providers')),
    enabled: activeSection === 'models' || activeSection === 'overview',
  });

  const { data: modelsData } = useQuery({
    queryKey: [nv('models')],
    queryFn: () => fetchApi(nv('models')),
    enabled: activeSection === 'models',
  });

  const { data: llmStatus } = useQuery({
    queryKey: [nv('llm/status')],
    queryFn: () => fetchApi(nv('llm/status')),
    enabled: activeSection === 'models' || activeSection === 'overview',
    refetchInterval: pollMs(30000),
    placeholderData: (prev: any) => prev,
  });

  const { data: toolsData } = useQuery({
    queryKey: [nv('tools')],
    queryFn: () => fetchApi(nv('tools')),
    enabled: activeSection === 'tools' || activeSection === 'overview',
  });

  const { data: analyticsData } = useQuery({
    queryKey: [nv('sdk/analytics')],
    queryFn: () => fetchApi(nv('sdk/analytics')),
    enabled: activeSection === 'analytics',
  });

  const { data: settingsData, isLoading: settingsLoading, isError: settingsError, refetch: refetchSettings } = useQuery({
    queryKey: [nv('admin/feature-flags')],
    queryFn: () => fetchApi(nv('admin/feature-flags')),
    enabled: activeSection === 'settings',
  });

  const { data: protocolsData } = useQuery({
    queryKey: [nv('protocols')],
    queryFn: () => fetchApi(nv('protocols')),
    enabled: activeSection === 'orchestration' || activeSection === 'overview',
  });

  const { data: hitlStats } = useQuery({
    queryKey: [nv('hitl/stats')],
    queryFn: () => fetchApi(nv('hitl/stats')),
    enabled: activeSection === 'orchestration' || activeSection === 'overview',
  });

  const { data: hitlPending } = useQuery({
    queryKey: [nv('hitl/pending')],
    queryFn: () => fetchApi(nv('hitl/pending')),
    enabled: activeSection === 'orchestration',
  });

  const { data: feedbackStats } = useQuery({
    queryKey: [nv('feedback/stats')],
    queryFn: () => fetchApi(nv('feedback/stats')),
    enabled: activeSection === 'orchestration' || activeSection === 'overview',
  });

  const { data: healingHealth } = useQuery({
    queryKey: [nv('healing/health')],
    queryFn: () => fetchApi(nv('healing/health')),
    enabled: activeSection === 'observability' || activeSection === 'overview',
  });

  const { data: healingStats } = useQuery({
    queryKey: [nv('healing/stats')],
    queryFn: () => fetchApi(nv('healing/stats')),
    enabled: activeSection === 'observability',
  });

  const { data: circuitBreakers } = useQuery({
    queryKey: [nv('healing/circuit-breakers')],
    queryFn: () => fetchApi(nv('healing/circuit-breakers')),
    enabled: activeSection === 'observability',
  });

  const { data: agentMetrics } = useQuery({
    queryKey: [nv('agent/metrics')],
    queryFn: () => fetchApi(nv('agent/metrics')),
    enabled: activeSection === 'observability' || activeSection === 'agents',
  });

  const { data: modelGovernance } = useQuery({
    queryKey: [nv('model-governance')],
    queryFn: () => fetchApi(nv('model-governance')),
    enabled: activeSection === 'governance',
  });

  const { data: complianceEvidence } = useQuery({
    queryKey: [nv('compliance/evidence')],
    queryFn: () => fetchApi(nv('compliance/evidence')),
    enabled: activeSection === 'governance',
  });

  const { data: incidentsData } = useQuery({
    queryKey: [nv('incidents')],
    queryFn: () => fetchApi(nv('incidents')),
    enabled: activeSection === 'governance',
  });

  const { data: guardrailsStats } = useQuery({
    queryKey: [nv('audit/guardrail-stats')],
    queryFn: () => fetchApi(nv('audit/guardrail-stats')),
    staleTime: 30000,
    refetchOnMount: 'always',
    refetchInterval: activeSection === 'governance' || activeSection === 'compliance' ? 30000 : false,
  });

  const { data: memoryStats } = useQuery({
    queryKey: [nv('memory/stats')],
    queryFn: () => fetchApi(nv('memory/stats')),
    enabled: activeSection === 'observability',
  });

  const { data: toolsHistory } = useQuery({
    queryKey: [nv('tools/history')],
    queryFn: () => fetchApi(nv('tools/history')),
    enabled: activeSection === 'tools',
  });

  const { data: usageStats } = useQuery({
    queryKey: [nv('usage/stats')],
    queryFn: () => fetchApi(nv('usage/stats?tenantId=system&days=30')),
    enabled: activeSection === 'analytics',
  });

  const { data: p4VectorStats } = useQuery({
    queryKey: [nv('vector/stats')],
    queryFn: () => fetchApi(nv('vector/stats')),
    enabled: activeSection === 'phase4',
  });
  const { data: p4SandboxStatus } = useQuery({
    queryKey: [nv('tools/sandbox/status')],
    queryFn: () => fetchApi(nv('tools/sandbox/status')),
    enabled: activeSection === 'phase4',
  });
  const { data: p4VisionCaps } = useQuery({
    queryKey: [nv('vision/capabilities')],
    queryFn: () => fetchApi(nv('vision/capabilities')),
    enabled: activeSection === 'phase4',
  });
  const { data: p4VoiceStatus } = useQuery({
    queryKey: [nv('voice/status')],
    queryFn: () => fetchApi(nv('voice/status')),
    enabled: activeSection === 'phase4',
  });
  const { data: p4OfficeStatus } = useQuery({
    queryKey: [nv('office/status')],
    queryFn: () => fetchApi(nv('office/status')),
    enabled: activeSection === 'phase4',
  });
  const { data: p4Experiments } = useQuery({
    queryKey: [nv('experiments')],
    queryFn: () => fetchApi(nv('experiments')),
    enabled: activeSection === 'phase4',
  });
  const { data: p4DriftStatus } = useQuery({
    queryKey: [nv('drift/status')],
    queryFn: () => fetchApi(nv('drift/status')),
    enabled: activeSection === 'phase4',
  });

  const { data: adminUsersData, refetch: refetchUsers, isLoading: usersLoading, isError: usersError } = useQuery({
    queryKey: [nv('admin/users')],
    queryFn: () => fetchApi(nv('admin/users?limit=100')),
    enabled: activeSection === 'users',
    refetchOnWindowFocus: false,
  });

  const { data: adminOrgsData, refetch: refetchOrgs, isLoading: orgsLoading, isError: orgsError } = useQuery({
    queryKey: [nv('admin/orgs')],
    queryFn: () => fetchApi(nv('admin/orgs')),
    enabled: activeSection === 'tenants',
    refetchOnWindowFocus: false,
  });

  const { data: adminStatsData } = useQuery({
    queryKey: [nv('admin/stats')],
    queryFn: () => fetchApi(nv('admin/stats')),
    staleTime: 60000,
    refetchInterval: pollMs(120000),
    placeholderData: (prev: any) => prev,
  });

  const { data: apiKeysData } = useQuery({
    queryKey: [nv('admin/api-keys')],
    queryFn: () => fetchApi(nv('admin/api-keys')),
    enabled: activeSection === 'developer',
  });

  const { data: platformHealthData } = useQuery({
    queryKey: [nv('admin/platform-health')],
    queryFn: () => fetchApi(nv('admin/platform-health')),
    refetchInterval: pollMs(30000),
    placeholderData: (prev: any) => prev,
  });

  const { data: mcpCatalogData } = useQuery({
    queryKey: [nv('jrx-legal-tools/catalog'), 'summary'],
    queryFn: () => fetchApi(nv('jrx-legal-tools/catalog?limit=1')),
    refetchInterval: pollMs(120000),
    placeholderData: (prev: any) => prev,
  });

  const { data: livePlatformsData } = useQuery({
    queryKey: [nv('platforms')],
    queryFn: () => fetchApi(nv('platforms')),
    refetchInterval: pollMs(60000),
    placeholderData: (prev: any) => prev,
  });

  // Knowledge Plane + tenant RAG — Command Centre Knowledge tab (no hardcoded corpus KPIs)
  const { data: nysStatuteCoverage } = useQuery({
    queryKey: [nv('knowledge/statutes/embedding/coverage')],
    queryFn: () => fetchApi(nv('knowledge/statutes/embedding/coverage')),
    enabled: activeSection === 'knowledge' || activeSection === 'overview',
    staleTime: 60000,
    refetchInterval: pollMs(120000),
    placeholderData: (prev: any) => prev,
  });
  const { data: nysCaselawStats } = useQuery({
    queryKey: [nv('knowledge/caselaw/stats')],
    queryFn: () => fetchApi(nv('knowledge/caselaw/stats')),
    enabled: activeSection === 'knowledge' || activeSection === 'overview',
    staleTime: 60000,
    refetchInterval: pollMs(120000),
    placeholderData: (prev: any) => prev,
  });
  const { data: nysPlaneHealth } = useQuery({
    queryKey: [nv('knowledge/plane/health')],
    queryFn: () => fetchApi(nv('knowledge/plane/health')),
    enabled: activeSection === 'knowledge' || activeSection === 'overview',
    staleTime: 30000,
    refetchInterval: pollMs(60000),
    placeholderData: (prev: any) => prev,
  });
  const { data: ragCollectionsData } = useQuery({
    queryKey: [nv('rag/collections')],
    queryFn: () => fetchApi(nv('rag/collections')),
    enabled: activeSection === 'knowledge',
    staleTime: 60000,
    placeholderData: (prev: any) => prev,
  });

  const hitlDecision = useMutation({
    mutationFn: async ({ reviewId, decision, reason }: { reviewId: string; decision: string; reason?: string }) => {
      return apiRequest(`${NV_BASE}hitl/${reviewId}/decision`, 'POST', { decision, reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('hitl/pending')] });
      qc.invalidateQueries({ queryKey: [nv('hitl/stats')] });
      toast({ title: 'HITL Decision', description: 'Review decision recorded.' });
    },
  });

  const resolveIncident = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`${NV_BASE}incidents/${id}/resolve`, 'PUT', { resolution: 'Resolved via Command Centre' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('incidents')] });
      toast({ title: 'Incident Resolved' });
    },
  });

  const toggleSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      return apiRequest(nv(`admin/feature-flags/${key}`), 'PATCH', { value, enabled: value });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('admin/feature-flags')] });
      toast({ title: 'Setting Updated' });
    },
  });

  const syncManifest = useMutation({
    mutationFn: async () => {
      return apiRequest(nv('admin/agents/sync-manifest'), 'POST');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('registry/agents')] });
      toast({ title: 'Success', description: 'Agent manifest synced.' });
    },
  });

  const toggleAgent = useMutation({
    mutationFn: async (agentId: string) => {
      return apiRequest(`${NV_BASE}admin/agents/${agentId}/toggle`, 'PATCH');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [nv('registry/agents')] }),
  });

  const dash = safeObj(nvDashboard);
  const sdk = safeObj(sdkDashboard);
  const health = safeObj(nvHealth);
  const registryData = safeObj(agentsData);
  const agents = registryData.agents || [];
  const runtimeRegistryTotal = health?.agents?.totalAgents ?? health?.totalAgents ?? null;
  const runtimeRegistryVersion = health?.agents?.registryVersion ?? health?.registryVersion ?? null;
  // Prefer the live v5.1.0 runtime registry exposed by /api/jrx/health. Older
  // dashboards and registry endpoints may still reflect flattened DB-era counts.
  const totalAgents =
    runtimeRegistryTotal ||
    dash?.agents?.total ||
    sdk?.agents?.total ||
    registryData.totalAvailable ||
    agents.length ||
    0;
  // Prefer global enabled count over registry-filtered active count, otherwise the
  // KPI uses live registry stats (164 runtime agents; 1042 is archived backup only).
  // returns the DEFAULT jurisdiction. Fall back to local count only if no global.
  const totalEnabled = dash?.agents?.enabled ?? sdk?.agents?.enabled ?? null;
  const activeAgents =
    totalEnabled ??
    (agents.length > 0
      ? agents.filter((a: any) => a.status === 'active' || !a.status).length
      : totalAgents);
  const providers = safeArr(providersData);
  const models = safeArr(modelsData);
  const llm = safeObj(llmStatus);
  const llmProvidersList = safeArr(llmStatus);
  const tools = safeObj(toolsData);
  const mcpCatalogTotal = Number(mcpCatalogData?.catalogTotal ?? mcpCatalogData?.total ?? 0);
  const mcpExecutableTotal = Number(mcpCatalogData?.executableTotal ?? 0);
  const livePlatformCount = Array.isArray(livePlatformsData?.platforms) ? livePlatformsData.platforms.length : 0;
  const statuteCov = safeObj((nysStatuteCoverage as any)?.data ?? nysStatuteCoverage);
  const caselawStatsLive = safeObj((nysCaselawStats as any)?.data ?? nysCaselawStats);
  const planeHealthLive = safeObj(nysPlaneHealth);
  const caselawEmbedCov = safeObj(caselawStatsLive.embeddingCoverage);
  const ragCollectionsList: any[] = Array.isArray(ragCollectionsData)
    ? ragCollectionsData
    : safeArr((ragCollectionsData as any)?.collections ?? (ragCollectionsData as any)?.data ?? ragCollectionsData);
  const analytics = safeObj(analyticsData);
  const protocols = safeArr(protocolsData);
  const hitlS = safeObj(hitlStats);
  const hitlP = safeArr(hitlPending);
  const feedS = safeObj(feedbackStats);
  const healH = safeObj(healingHealth);
  const healS = safeObj(healingStats);
  const circuits = safeArr(circuitBreakers);
  const agentM = safeArr(agentMetrics);
  const govRules = safeArr(modelGovernance?.data ?? modelGovernance);
  const compliance = safeArr(
    complianceEvidence?.data?.items
    ?? complianceEvidence?.data?.evidence
    ?? complianceEvidence?.data
    ?? complianceEvidence,
  );
  const incidents = safeArr(incidentsData?.data ?? incidentsData);
  const guardrails = safeObj(guardrailsStats?.data ?? guardrailsStats);
  const memStats = safeObj(memoryStats);
  const settingsList = safeArr(settingsData);
  const toolsHist = safeArr(toolsHistory);
  const usage = safeObj(usageStats);
  const features = dash.features || {};

  const adminStats = safeObj(adminStatsData);
  const adminUsers = safeObj(adminUsersData);
  const adminOrgs = safeObj(adminOrgsData);
  const realUsers: any[] = adminUsers.users || [];
  const realOrgs: any[] = adminOrgs.orgs || [];
  const userStatsCounts = adminUsers.stats || adminStats.users || adminStatsData?.users || {};
  const orgStatsCounts = adminOrgs.stats || adminStats.orgs || adminStatsData?.orgs || {};
  const platformsHealth: any[] = safeArr(platformHealthData).length
    ? safeArr(platformHealthData)
    : (platformHealthData as any)?.platforms || [];

  const registryPlatformRows: any[] = Array.isArray(livePlatformsData?.platforms)
    ? livePlatformsData.platforms
    : safeArr(livePlatformsData);

  const mergedPlatforms = useMemo(() => PLATFORMS.map(p => {
    const ph = platformsHealth.find((h: any) => h.id === p.id);
    const regType = PLATFORM_REGISTRY_ALIAS[p.id] ?? p.id;
    const reg = registryPlatformRows.find((r: any) =>
      String(r.platform_type ?? '') === regType
      || String(r.id ?? '') === regType);
    const modules = reg?.modules_enabled;
    let modulePct: number | null = null;
    if (modules && typeof modules === 'object') {
      const keys = Object.keys(modules as Record<string, boolean>);
      if (keys.length) {
        modulePct = Math.round((keys.filter(k => (modules as Record<string, boolean>)[k]).length / keys.length) * 100);
      }
    }
    const tier = reg?.tier ? String(reg.tier).toUpperCase() : p.badge;
    return {
      ...p,
      badge: tier,
      completion: modulePct,
      hasLiveRegistry: Boolean(reg),
      liveStatus: ph?.status as string | undefined,
      pending: reg ? [] : p.pending,
    };
  }), [platformsHealth, registryPlatformRows]);

  const apiKeys: any[] = safeObj(apiKeysData).keys || [];

  const filteredAgents = agents.filter((a: any) => {
    if (searchQuery && !a.name?.toLowerCase().includes(searchQuery.toLowerCase()) && !a.id?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (agentStatusFilter !== 'all' && a.status !== agentStatusFilter) return false;
    return true;
  });

  const agentsByTier = agents.reduce((acc: Record<string, number>, a: any) => {
    const tier = a.tier || 'unclassified';
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  const agentsByCategory = agents.reduce((acc: Record<string, number>, a: any) => {
    const cat = a.category || a.practiceArea || 'general';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const tierChartData = Object.entries(registryData.tierSummary || agentsByTier).map(([name, value]) => ({ name, value }));
  const categoryChartData = Object.entries(registryData.practiceAreaSummary || agentsByCategory).slice(0, 10).map(([name, value]) => ({ name: name.length > 15 ? name.substring(0, 15) + '...' : name, value }));

  // Legacy console charts grouped agents by flattened jurisdiction totals.
  // The v5.1.0 runtime registry now loads one 164-agent active set with an
  // optional jurisdiction overlay — fallbacks use JRX_REGISTRY_RUNTIME constants.
  const ALLOWED_JURISDICTIONS = ['IN', 'UK', 'US', 'GC', 'EU', 'SG', 'DEFAULT'] as const;
  const JURISDICTION_LABELS: Record<string, string> = {
    IN: 'India',
    UK: 'United Kingdom',
    US: 'United States',
    GC: 'GCC',
    EU: 'European Union',
    SG: 'Singapore',
    DEFAULT: 'Cross-Jurisdiction',
  };

  const agentsByJurisdictionRaw = agents.reduce((acc: Record<string, number>, a: any) => {
    // Field can be `jurisdiction` (DB schema, text[]) or `jurisdictions` (registry shape)
    const raw = a.jurisdiction ?? a.jurisdictions;
    const list: string[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    list.forEach((j: string) => {
      const key = String(j).toUpperCase();
      if (ALLOWED_JURISDICTIONS.includes(key as any)) {
        acc[key] = (acc[key] || 0) + 1;
      }
    });
    return acc;
  }, {});

  // Fall back to a single runtime-registry bucket when the payload does not
  // expose per-jurisdiction metadata.
  const hasJurisdictionData = Object.keys(agentsByJurisdictionRaw).length > 0;
  const jurisdictionChartData = hasJurisdictionData
    ? Object.entries(agentsByJurisdictionRaw)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([code, count]) => ({ name: JURISDICTION_LABELS[code] ?? code, agents: count as number }))
    // Fallback: render the active runtime set instead of the stale flattened split.
    : (totalAgents > 0
        ? [
            { name: 'Runtime Registry', agents: totalAgents },
          ]
        : []);

  const renderOverview = () => {
    const providerCount = providers.length || sdk?.providers?.total || llmProvidersList.length || 0;
    const toolCount = mcpCatalogTotal || tools?.summary?.totalTools || sdk?.tools?.total || JRX_REGISTRY_RUNTIME.mcpTools;
    const platformCount = livePlatformCount || mergedPlatforms.length;
    const onlinePlatforms = platformsHealth.filter(
      (ph: any) => ph?.status === 'online' || ph?.status === 'healthy' || ph?.status === 'operational',
    ).length;
    const openIncidents = dash.openIncidents ?? 0;
    const feedbackCount = feedS.total ?? feedS.totalFeedback ?? 0;
    const hitlPendingCount = hitlS.pending ?? hitlS.pendingReviews ?? 0;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card style={{ borderLeft: `4px solid ${COLORS.gold}` }}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Total Agents</p>
                  <p className="text-3xl font-bold" style={{ color: COLORS.royalBlue }}>{totalAgents}</p>
                  <p className="text-xs text-green-600">{activeAgents} active</p>
                </div>
                <Bot className="w-10 h-10" style={{ color: COLORS.gold }} />
              </div>
            </CardContent>
          </Card>

          <Card style={{ borderLeft: `4px solid ${COLORS.emerald}` }}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">LLM Providers</p>
                  <p className="text-3xl font-bold" style={{ color: COLORS.royalBlue }}>{providerCount}</p>
                  <p className="text-xs text-green-600">{sdk?.providers?.healthy || providerCount} healthy</p>
                </div>
                <Brain className="w-10 h-10" style={{ color: COLORS.emerald }} />
              </div>
            </CardContent>
          </Card>

          <Card style={{ borderLeft: `4px solid ${COLORS.royalBlue}` }}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Tools</p>
                  <p className="text-3xl font-bold" style={{ color: COLORS.royalBlue }}>{toolCount}</p>
                  <p className="text-xs text-green-600">{tools?.summary?.categories || sdk?.tools?.categories || 28} categories</p>
                </div>
                <Code className="w-10 h-10" style={{ color: COLORS.royalBlue }} />
              </div>
            </CardContent>
          </Card>

          <Card style={{ borderLeft: `4px solid ${COLORS.deepNavy}` }}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Platforms</p>
                  <p className="text-3xl font-bold" style={{ color: COLORS.royalBlue }}>{platformCount}</p>
                  <p className="text-xs" style={{ color: onlinePlatforms > 0 ? COLORS.emerald : '#6B7280' }}>
                    {onlinePlatforms > 0 ? `${onlinePlatforms} operational` : 'In ecosystem'}
                  </p>
                </div>
                <Monitor className="w-10 h-10" style={{ color: COLORS.deepNavy }} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold" style={{ color: COLORS.royalBlue }}>Product surfaces</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Agent Gallery', path: '/agent-registry', desc: '164-agent fleet + 107 swarm topologies', icon: Bot },
              { label: 'Matter Vault', path: '/matter-vault', desc: 'EDJ batch ingest + playbook review', icon: FolderOpen },
              { label: 'Digital Twin', path: '/digital-twin-creator', desc: 'TwinDesk personas + simulation', icon: Users },
              { label: 'NYS Knowledge', path: '/nys-knowledge-plane', desc: 'Federated statutes + caselaw', icon: BookOpen },
            ].map((item) => (
              <a
                key={item.path}
                href={`/console${item.path}`}
                className="p-3 rounded-lg border hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <item.icon className="w-4 h-4" style={{ color: COLORS.royalBlue }} />
                  <span className="text-sm font-medium" style={{ color: COLORS.royalBlue }}>{item.label}</span>
                </div>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </a>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: COLORS.royalBlue }}>Agents by Tier</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={tierChartData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {tierChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: COLORS.royalBlue }}>Agents by Jurisdiction</CardTitle>
            </CardHeader>
            <CardContent>
              {jurisdictionChartData.length === 0 ? (
                <div className="h-[250px] flex flex-col items-center justify-center text-gray-400 text-xs">
                  <Globe className="w-8 h-8 mb-2 opacity-40" />
                  No jurisdiction data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={jurisdictionChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="agents" fill={COLORS.royalBlue} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Users', value: adminStats.users?.total ?? userStatsCounts.total ?? realUsers.length ?? adminStatsData?.users?.total ?? 0, sub: `${adminStats.users?.admins ?? userStatsCounts.admins ?? 0} admins`, icon: Users, color: COLORS.royalBlue },
            { label: 'Organizations', value: adminStats.orgs?.total ?? orgStatsCounts.total ?? 0, sub: `${adminStats.orgs?.active ?? orgStatsCounts.active ?? 0} active`, icon: Building2, color: COLORS.deepNavy },
            { label: 'API Calls (30d)', value: fmt(adminStats.usage?.requests ?? 0), sub: `₹${Number(adminStats.usage?.cost ?? 0).toFixed(2)} cost`, icon: BarChart3, color: COLORS.emerald },
            { label: 'Tokens Used (30d)', value: fmt(adminStats.usage?.tokens ?? 0), sub: 'Total token volume', icon: Zap, color: COLORS.gold },
          ].map(s => (
            <Card key={s.label} style={{ borderLeft: `3px solid ${s.color}` }}>
              <CardContent className="p-3 flex items-center gap-3">
                <s.icon className="w-6 h-6 shrink-0" style={{ color: s.color }} />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">{s.label}</p>
                  <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[10px] text-gray-400">{s.sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold" style={{ color: COLORS.royalBlue }}>Platform Status</CardTitle>
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setActiveSection('platforms')}>
              <Monitor className="w-3 h-3 mr-1" /> Full View
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {mergedPlatforms.map(p => {
                const phEntry = platformsHealth.find((ph: any) => ph.id === p.id);
                const gatewayOk = health?.status === 'healthy' || health?.status === 'operational';
                const st = phEntry?.status ?? (gatewayOk ? 'online' : 'checking');
                const stColor = st === 'online' || st === 'healthy' || st === 'operational'
                  ? COLORS.emerald
                  : st === 'degraded' ? COLORS.gold : st === 'offline' ? '#EF4444' : p.badge === 'ROADMAP' ? '#9CA3AF' : '#9CA3AF';
                const stLabel = (st === 'healthy' || st === 'operational') ? 'online' : (st || (p.badge === 'ROADMAP' ? 'planned' : 'checking'));
                return (
                  <div key={p.id} className="p-2 rounded-lg border flex flex-col items-center gap-1.5 text-center cursor-pointer hover:bg-gray-50"
                    style={{ borderColor: p.color + '30' }}
                    onClick={() => setActiveSection('platforms')}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: p.color + '15' }}>
                      <p.icon className="w-4 h-4" style={{ color: p.color }} />
                    </div>
                    <p className="text-[10px] font-semibold leading-tight" style={{ color: COLORS.royalBlue }}>{p.name}</p>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stColor }} />
                      <span className="text-[9px]" style={{ color: stColor }}>{stLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-gray-500 uppercase">NV Orchestration Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Status', value: health?.status || 'healthy', color: COLORS.emerald },
                { label: 'Version', value: runtimeRegistryVersion || health?.version || '—', color: COLORS.royalBlue },
                { label: 'AI Maturity', value: `${dash.aiMaturityScore ?? health?.aiMaturityScore ?? '—'}/100`, color: COLORS.gold },
                { label: 'PII Patterns', value: String(dash.piiPatternsActive ?? health?.piiPatterns ?? '—'), color: COLORS.emerald },
                { label: 'Open Incidents', value: String(openIncidents), color: openIncidents > 0 ? '#EF4444' : COLORS.emerald },
                { label: 'HITL Pending', value: String(hitlPendingCount), color: hitlPendingCount > 0 ? COLORS.gold : COLORS.emerald },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{m.label}</span>
                  <Badge variant="outline" style={{ borderColor: m.color, color: m.color }} role="status">{m.value}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-gray-500 uppercase">Active Features</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Hallucination Detection', on: features.hallucinationDetection as boolean | undefined },
                { label: 'HITL Checkpoints', on: features.hitlCheckpoints as boolean | undefined },
                { label: 'Citation Verification', on: features.citationVerification as boolean | undefined },
                { label: 'Bias Detection', on: features.biasDetection as boolean | undefined },
                { label: 'PII Vault', on: features.piiVault as boolean | undefined },
                { label: 'Model Governance', on: features.modelGovernance as boolean | undefined },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{s.label}</span>
                  <Badge className={
                    s.on === true ? 'bg-green-50 text-green-700 border-green-200'
                      : s.on === false ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                  } variant="outline" role="status">
                    {s.on === true ? <><CheckCircle className="w-3 h-3 mr-1" /> active</>
                      : s.on === false ? <><AlertTriangle className="w-3 h-3 mr-1" /> off</>
                        : <>— unknown</>}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-gray-500 uppercase">Protocol Suite</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {protocols.length > 0 ? protocols.slice(0, 6).map((p: any) => (
                <div key={p.name || p.id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{p.name}</span>
                  <Badge variant={p.status === 'active' ? 'default' : 'secondary'} className="text-xs"
                    style={p.status === 'active' ? { backgroundColor: COLORS.emerald } : {}}>
                    {p.status || 'active'}
                  </Badge>
                </div>
              )) : [
                { label: 'MCP (Model Context)', count: mcpExecutableTotal || toolCount },
                { label: 'A2A (Agent-to-Agent)', count: 'Active' },
                { label: 'AG-UI (Agent GUI)', count: 'Active' },
                { label: 'ROMA (Runtime)', count: 'Active' },
                { label: 'BMAD (Workflow)', count: 'Active' },
                { label: 'Tools Registry', count: `${tools?.summary?.totalTools || JRX_REGISTRY_RUNTIME.mcpTools} tools` },
              ].map(p => (
                <div key={p.label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{p.label}</span>
                  <Badge variant="secondary" className="text-xs" role="status">{p.count}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderAgentOps = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: COLORS.royalBlue + '20' }}>
        <p className="text-xs text-gray-500">AI Agents Studio — {totalAgents || '—'} agents registered across 8 tiers</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/console/agents'}>
            <ExternalLink className="w-3 h-3" /> Open Full Registry
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/console/agent-activity'}>
            <ExternalLink className="w-3 h-3" /> Agent Activity
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Search agents..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
        </div>
        <Select value={agentTierFilter} onValueChange={setAgentTierFilter} aria-label="Select option">
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="L1">L1 Basic</SelectItem>
            <SelectItem value="L2">L2 Intermediate</SelectItem>
            <SelectItem value="L3">L3 Advanced</SelectItem>
            <SelectItem value="L4">L4 Expert</SelectItem>
          </SelectContent>
        </Select>
        <Select value={agentStatusFilter} onValueChange={setAgentStatusFilter} aria-label="Select option">
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => syncManifest.mutate()} disabled={syncManifest.isPending} style={{ background: COLORS.royalBlue }}>
          <RotateCcw className={`w-4 h-4 mr-1 ${syncManifest.isPending ? 'animate-spin' : ''}`} /> Sync Manifest
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Total Agents</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.royalBlue }}>{totalAgents}</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Active</p>
            <p className="text-2xl font-bold text-green-600">{activeAgents}</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Tiers</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.royalBlue }}>{Object.keys(registryData.tierSummary || agentsByTier).length}</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.deepNavy}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Practice Areas</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.deepNavy }}>{Object.keys(registryData.practiceAreaSummary || agentsByCategory).length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Agent Distribution by Tier</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={tierChartData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {tierChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Top Practice Areas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill={COLORS.gold} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Agent Registry ({filteredAgents.length} of {totalAgents})</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]" aria-label="Scrollable content">
            <div className="space-y-2">
              {agentsLoading ? (
                <div className="space-y-2" data-testid="loading-cc-agents">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : filteredAgents.length === 0 ? (
                <JrxEmptyState icon={Bot} title="No agents found" description="Try adjusting your filters above." size="sm" />
              ) : (
                filteredAgents.slice(0, 50).map((agent: any, idx: number) => (
                  <div key={`${agent.id}:${idx}`} className="flex items-center justify-between p-2 rounded border hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: agent.status === 'active' || !agent.status ? COLORS.emerald : '#999' }}>
                        {(agent.name || 'A').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" style={{ color: COLORS.royalBlue }}>{agent.name || agent.id}</p>
                        <p className="text-xs text-gray-500 truncate">{agent.description || agent.practiceArea || agent.category || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {agent.tier && <Badge variant="outline" className="text-[10px]" role="status">{agent.tier}</Badge>}
                      {agent.romaLevel && <Badge variant="outline" className="text-[10px]" role="status">ROMA {agent.romaLevel}</Badge>}
                      <Badge variant={agent.status === 'active' || !agent.status ? 'default' : 'secondary'} className="text-[10px]" style={agent.status === 'active' || !agent.status ? { backgroundColor: COLORS.emerald } : {}}>
                        {agent.status || 'active'}
                      </Badge>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => toggleAgent.mutate(agent.id)}>
                        {agent.status === 'active' || !agent.status ? <Power className="w-3.5 h-3.5 text-green-600" /> : <PowerOff className="w-3.5 h-3.5 text-gray-400" />}
                      </Button>
                    </div>
                  </div>
                ))
              )}
              {filteredAgents.length > 50 && (
                <div className="text-center py-2 text-xs text-gray-400">Showing 50 of {filteredAgents.length} agents</div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  const renderModels = () => {
    const providerChain = llmProvidersList.length > 0 ? llmProvidersList : (llm?.providers || []);
    const modelCount = models.length || 750;
    const providerCount = providers.length || providerChain.length || 23;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">LLM Providers</p>
              <p className="text-3xl font-bold" style={{ color: COLORS.royalBlue }}>{providerCount}</p>
              <p className="text-xs text-gray-500">{providers.filter((p: any) => p.enabled || p.status === 'healthy').length || providerCount} enabled</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">Available Models</p>
              <p className="text-3xl font-bold" style={{ color: COLORS.gold }}>{modelCount}</p>
              <p className="text-xs text-gray-500">{models.filter((m: any) => m.is_recommended).length || 0} recommended</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">Fallback Chain</p>
              <p className="text-3xl font-bold" style={{ color: COLORS.emerald }}>6</p>
              <p className="text-xs text-gray-500">Priority-ordered failover</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>LLM Provider Priority Chain</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {providersLoading ? (
                <div className="space-y-2 py-2" data-testid="loading-providers-cc">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : providersError ? (
                <JrxErrorState
                  title="Unable to load providers"
                  description="The provider list could not be retrieved."
                  onRetry={() => refetchProviders()}
                  size="sm"
                />
              ) : (providerChain.length === 0 && providers.length === 0) ? (
                <JrxEmptyState title="No providers configured yet" description="Connect an LLM provider to populate the failover chain." size="sm" />
              ) : (
                (providerChain.length > 0 ? providerChain : providers).slice(0, 10).map((p: any, i: number) => (
                  <div key={p.id || p.name || i} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: i < 2 ? COLORS.emerald : COLORS.midBlue }}>
                      P{i + 1}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold" style={{ color: COLORS.royalBlue }}>{p.name}</p>
                      <p className="text-xs text-gray-500">{p.description || (p.models && Array.isArray(p.models) ? p.models.join(', ') : p.category || '')}</p>
                    </div>
                    <Badge variant={p.status === 'available' || p.status === 'healthy' || p.enabled ? 'default' : 'secondary'}
                      style={p.status === 'available' || p.status === 'healthy' || p.enabled ? { backgroundColor: COLORS.emerald } : {}}>
                      {p.status || (p.enabled ? 'healthy' : 'disabled')}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {models.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Available Models ({models.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]" aria-label="Scrollable content">
                <div className="space-y-1">
                  {models.slice(0, 30).map((m: any, i: number) => (
                    <div key={m.model_id || i} className="flex items-center justify-between p-2 rounded border text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate" style={{ color: COLORS.royalBlue }}>{m.name || m.model_id}</p>
                        <p className="text-xs text-gray-500">{m.provider_name} · ctx: {m.context_window ? fmt(m.context_window) : '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.is_recommended && <Badge className="text-[10px] bg-yellow-50 text-yellow-700 border-yellow-200" variant="outline" role="status">★</Badge>}
                        {m.input_cost_per_1k && <span className="text-[10px] text-gray-400">${m.input_cost_per_1k}/1K</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const renderPlatforms = () => {
    const getStandaloneUrl = (port: string | null) => {
      if (!port) return null;
      const origin = window.location.origin;
      if (origin.match(/:\d+$/)) return origin.replace(/:\d+$/, `:${port}`);
      const replMatch = origin.match(/^(https?:\/\/)(\d+)(-.+)$/);
      if (replMatch) return `${replMatch[1]}${port}${replMatch[3]}`;
      return `${origin}:${port}`;
    };

    const healthMap: Record<string, string> = {};
    platformsHealth.forEach((ph: any) => { healthMap[ph.id] = ph.status; });

    const badgeColor: Record<string, string> = {
      'CURRENT': COLORS.royalBlue, 'LIVE': COLORS.emerald, 'BETA': COLORS.gold,
      'IN PROGRESS': COLORS.midBlue, 'ROADMAP': '#9CA3AF',
    };

    const totalCompleted = mergedPlatforms.reduce((s, p) => s + (p.hasLiveRegistry ? (p.completion ?? 0) : 0), 0);
    const registryCount = mergedPlatforms.filter(p => p.hasLiveRegistry).length;
    const avgCompletion = registryCount ? Math.round(totalCompleted / registryCount) : null;
    const onlineCount = platformsHealth.filter((p: any) => p.status === 'online').length;

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Platforms', value: mergedPlatforms.length, sub: 'In ecosystem', color: COLORS.royalBlue },
            { label: 'Online Now', value: onlineCount || '—', sub: 'Health-checked every 30s', color: COLORS.emerald },
            { label: 'Registry Modules', value: avgCompletion != null ? `${avgCompletion}%` : '—', sub: registryCount ? `${registryCount} in DB registry` : 'Awaiting registry', color: COLORS.gold },
            { label: 'Total AI Agents', value: String(totalAgents || '—'), sub: 'Deployed across platforms', color: COLORS.midBlue },
          ].map(s => (
            <Card key={s.label} style={{ borderLeft: `3px solid ${s.color}` }}>
              <CardContent className="p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-2xl font-bold mt-0.5" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[10px] text-gray-400">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-3">
          {mergedPlatforms.map(p => {
            const liveStatus = healthMap[p.id] ?? p.liveStatus;
            const isCurrentPlatform = p.id === './jrx-sdk';
            const statusColor = liveStatus === 'online' ? COLORS.emerald
              : liveStatus === 'degraded' ? COLORS.gold
              : liveStatus === 'offline' ? '#EF4444' : '#9CA3AF';
            const statusLabel = liveStatus || (isCurrentPlatform ? 'online' : p.badge === 'ROADMAP' ? 'planned' : 'checking');
            const standaloneUrl = getStandaloneUrl(p.standalonePort);
            const bc = badgeColor[p.badge] || '#9CA3AF';
            const completionColor = p.completion == null ? '#9CA3AF' : p.completion >= 85 ? COLORS.emerald : p.completion >= 65 ? COLORS.gold : COLORS.midBlue;

            return (
              <Card key={p.id} className="hover:shadow-md transition-shadow border-l-4"
                style={{ borderLeftColor: p.color }}>
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: p.color + '15' }}>
                      <p.icon className="w-6 h-6" style={{ color: p.color }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-base" style={{ color: COLORS.royalBlue }}>{p.name}</h3>
                            <Badge className="text-[10px] px-1.5" style={{ background: bc }}>{p.badge}</Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5" style={{ borderColor: statusColor, color: statusColor }} role="status">
                              <div className="w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: statusColor }} />
                              {statusLabel}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 text-gray-400" role="status">{p.category}</Badge>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5 font-medium">{p.fullName}</p>
                          <p className="text-xs text-gray-500 mt-1">{p.desc}</p>
                        </div>

                        <div className="flex flex-col gap-1.5 items-end shrink-0">
                          {isCurrentPlatform ? (
                            <Badge className="text-[10px] px-2" style={{ background: COLORS.royalBlue }}>
                              You are here
                            </Badge>
                          ) : p.consolePath ? (
                            <Button size="sm" className="h-7 text-xs gap-1.5"
                              style={{ background: p.color }}
                              onClick={() => { window.location.href = p.consolePath!; }}>
                              <ChevronRight className="w-3 h-3" /> Open Dashboard
                            </Button>
                          ) : null}
                          {standaloneUrl && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                              onClick={() => window.open(standaloneUrl, '_blank')}>
                              <ExternalLink className="w-3 h-3" /> Open Standalone App
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wide">
                            {p.hasLiveRegistry ? 'Modules Enabled (registry)' : 'Development Completion'}
                          </span>
                          <span className="text-[11px] font-bold" style={{ color: completionColor }}>
                            {p.completion != null ? `${p.completion}%` : '—'}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${p.completion ?? 0}%`, background: completionColor }} />
                        </div>
                      </div>

                      {p.pending.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Pending to Publish</p>
                          <div className="flex flex-wrap gap-1.5">
                            {p.pending.map((task, i) => (
                              <span key={i} className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded px-2 py-0.5">
                                {task}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-2 flex items-center gap-3">
                        <p className="text-[10px] text-gray-400">
                          API: <code className="bg-gray-100 px-1 rounded font-mono">{p.route}</code>
                        </p>
                        <p className="text-[10px] text-gray-400">
                          Health: <code className="bg-gray-100 px-1 rounded font-mono">{p.healthPath}</code>
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  const renderOrchestration = () => {
    const pipelineSteps = [
      'PII Redaction', 'Compliance Check', 'Agent Resolution', 'Tier-Based Routing',
      'Prompt Enhancement', 'RealLLMService', 'Response Engineering',
      'Hallucination Detection', 'Citation Verification', 'Bias Audit',
      'HITL Review', 'Explainability', 'Memory Save', 'Output Compliance'
    ];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: COLORS.royalBlue + '20' }}>
          <p className="text-xs text-gray-500">14-step AI orchestration pipeline with real-time governance</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/console/decision-cards'}>
              <ExternalLink className="w-3 h-3" /> HITL Decision Cards
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/console/model-catalog'}>
              <ExternalLink className="w-3 h-3" /> Model Catalog
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">HITL Pending</p>
              <p className="text-2xl font-bold" style={{ color: COLORS.gold }}>{hitlS.pending ?? hitlS.pendingReviews ?? 0}</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">HITL Approved</p>
              <p className="text-2xl font-bold text-green-600">{hitlS.approved ?? hitlS.approvedReviews ?? 0}</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Feedback Total</p>
              <p className="text-2xl font-bold" style={{ color: COLORS.royalBlue }}>{feedS.total ?? feedS.totalFeedback ?? 0}</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.deepNavy}` }}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Protocols</p>
              <p className="text-2xl font-bold" style={{ color: COLORS.deepNavy }}>{protocols.length || dash.protocols?.total || 5}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>AI Pipeline — callJurexio() Flow</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {pipelineSteps.map((step, i) => (
                <div key={step} className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] whitespace-nowrap" style={{ borderColor: i < 7 ? COLORS.emerald : COLORS.gold, color: i < 7 ? COLORS.emerald : COLORS.gold }} role="status">
                    {i + 1}. {step}
                  </Badge>
                  {i < 13 && <ChevronRight className="w-3 h-3 text-gray-300" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {hitlP.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>HITL Pending Reviews ({hitlP.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[250px]" aria-label="Scrollable content">
                <div className="space-y-2">
                  {hitlP.map((review: any) => (
                    <div key={review.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: COLORS.royalBlue }}>{review.taskType || review.type || 'Review'}</p>
                        <p className="text-xs text-gray-500 truncate">{review.agentId || review.agent || '—'} · {review.reason || 'Pending review'}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-green-600 border-green-300" onClick={() => hitlDecision.mutate({ reviewId: review.id, decision: 'approve' })}>
                          <ThumbsUp className="w-3 h-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-300" onClick={() => hitlDecision.mutate({ reviewId: review.id, decision: 'reject' })}>
                          <ThumbsDown className="w-3 h-3 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Registered Protocols ({protocols.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {protocols.length > 0 ? protocols.map((p: any) => (
                <div key={p.name || p.id} className="p-2 rounded border">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium" style={{ color: COLORS.royalBlue }}>{p.name}</p>
                    <Badge variant={p.status === 'active' ? 'default' : 'secondary'} className="text-[10px]"
                      style={p.status === 'active' ? { backgroundColor: COLORS.emerald } : {}}>
                      {p.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500">{p.description || p.type || ''}</p>
                </div>
              )) : (
                ['MCP — Model Context Protocol', 'A2A — Agent-to-Agent', 'AG-UI — Agent GUI Protocol', 'ROMA — Runtime Agent Mgmt', 'BMAD — Build-Measure-Act-Decide'].map(name => (
                  <div key={name} className="p-2 rounded border">
                    <p className="text-sm font-medium" style={{ color: COLORS.royalBlue }}>{name}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Safety & Guardrails</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { name: 'Hallucination Detection', on: features.hallucinationDetection ?? true },
                { name: 'Citation Verification', on: features.citationVerification ?? true },
                { name: 'Bias Detection', on: features.biasDetection ?? true },
                { name: 'HITL Review', on: features.hitlCheckpoints ?? true },
                { name: 'PII Vault', on: features.piiVault ?? true },
                { name: 'Prompt Injection Detection', on: true },
                { name: 'Explainability', on: features.explainability ?? true },
                { name: 'Consent Management', on: features.consentManagement ?? true },
              ].map(s => (
                <div key={s.name} className="flex items-center justify-between p-2 rounded border">
                  <span className="text-sm">{s.name}</span>
                  <Badge variant="outline" className="text-[10px]" style={{ borderColor: s.on ? COLORS.emerald : COLORS.gold, color: s.on ? COLORS.emerald : COLORS.gold }} role="status">
                    {s.on ? 'active' : 'inactive'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderObservability = () => {
    const healingHealthy = healH?.status === 'healthy' || !healH?.status;
    const cbCount = circuits.length || 0;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: COLORS.royalBlue + '20' }}>
          <p className="text-xs text-gray-500">Real-time platform observability with self-healing and circuit breakers</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/live-activity-feed'}>
              <ExternalLink className="w-3 h-3" /> Open Live Activity Feed
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <Activity className="w-8 h-8" style={{ color: COLORS.emerald }} />
              <div>
                <p className="text-xs text-gray-500">Self-Healing</p>
                <p className="text-xl font-bold" style={{ color: healingHealthy ? COLORS.emerald : '#EF4444' }}>{healingHealthy ? 'Healthy' : 'Degraded'}</p>
              </div>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <Network className="w-8 h-8" style={{ color: COLORS.royalBlue }} />
              <div>
                <p className="text-xs text-gray-500">Circuit Breakers</p>
                <p className="text-xl font-bold" style={{ color: COLORS.royalBlue }}>{cbCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <Database className="w-8 h-8" style={{ color: COLORS.gold }} />
              <div>
                <p className="text-xs text-gray-500">Memory Entries</p>
                <p className="text-xl font-bold" style={{ color: COLORS.gold }}>{memStats?.total ?? dash.memoryEntries ?? 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.deepNavy}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <FileText className="w-8 h-8" style={{ color: COLORS.deepNavy }} />
              <div>
                <p className="text-xs text-gray-500">RAG Documents</p>
                <p className="text-xl font-bold" style={{ color: COLORS.deepNavy }}>{dash.ragDocuments ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {circuits.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Circuit Breaker States</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {circuits.map((cb: any, i: number) => (
                  <div key={cb.name || i} className="flex items-center justify-between p-2 rounded border">
                    <span className="text-xs text-gray-700">{cb.name || cb.service}</span>
                    <Badge variant="outline" className="text-[10px]"
                      style={{ borderColor: cb.state === 'closed' ? COLORS.emerald : cb.state === 'open' ? '#EF4444' : COLORS.gold,
                               color: cb.state === 'closed' ? COLORS.emerald : cb.state === 'open' ? '#EF4444' : COLORS.gold }} role="status">
                      {cb.state}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {agentM.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Agent Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[250px]" aria-label="Scrollable content">
                <div className="space-y-1">
                  {agentM.slice(0, 20).map((m: any, i: number) => (
                    <div key={m.agentId || i} className="flex items-center justify-between p-2 rounded border text-sm">
                      <span className="font-medium truncate" style={{ color: COLORS.royalBlue }}>{m.agentId || m.name}</span>
                      <div className="flex items-center gap-2">
                        {m.avgResponseTime && <span className="text-[10px] text-gray-400">{m.avgResponseTime}ms</span>}
                        {m.totalInvocations != null && <Badge variant="secondary" className="text-[10px]" role="status">{m.totalInvocations} calls</Badge>}
                        {m.successRate != null && <Badge variant="outline" className="text-[10px]" style={{ borderColor: COLORS.emerald, color: COLORS.emerald }} role="status">{m.successRate}%</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Self-Healing Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(healS).filter(([k]) => k !== 'success' && k !== 'data').map(([key, val]) => (
              <div key={key} className="flex items-center justify-between p-2 rounded border">
                <span className="text-sm text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span>
                <Badge variant="secondary" className="text-xs" role="status">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</Badge>
              </div>
            ))}
            {Object.keys(healS).filter(k => k !== 'success' && k !== 'data').length === 0 && (
              <div className="text-center py-4 text-gray-400 text-sm">Self-healing system operational — no events to report</div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderGovernance = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Governance Rules</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.royalBlue }}>{govRules.length || 0}</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Compliance Evidence</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.gold }}>{compliance.length || 0}</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.midBlue}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Audit Events (24h)</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.midBlue }}>
              {guardrails.total_requests_24h ?? guardrails.evaluated_24h ?? 0}
            </p>
            <p className="text-[10px] text-gray-500">
              Pass rate {Math.round((guardrails.pass_rate ?? 0) * 100)}%
              {guardrails.source ? ` · ${guardrails.source}` : ''}
            </p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${incidents.length > 0 ? '#EF4444' : COLORS.emerald}` }}>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Open Incidents</p>
            <p className="text-2xl font-bold" style={{ color: incidents.length > 0 ? '#EF4444' : COLORS.emerald }}>{incidents.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      {(guardrails.recent_events?.length ?? 0) > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              Recent Governance &amp; SDK Activity ({guardrails.recent_events.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]" aria-label="Recent audit events">
              <div className="space-y-2 text-xs">
                {guardrails.recent_events.slice(0, 12).map((ev: any) => (
                  <div key={ev.id} className="flex items-center justify-between p-2 rounded border">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono truncate">{ev.endpoint ?? ev.category}</p>
                      <p className="text-gray-500 truncate">{ev.details ?? ev.action}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] ml-2 shrink-0" role="status">
                      {ev.action ?? ev.category}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <p className="text-[10px] text-gray-500 mt-2">
              Full tamper-evident chain: Console → Governance &amp; Compliance → Audit Chain
              {guardrails.source ? ` · source: ${guardrails.source}` : ''}
            </p>
          </CardContent>
        </Card>
      ) : (guardrails.total_requests_24h ?? guardrails.evaluated_24h ?? 0) > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              Live SDK &amp; Safety Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              {(guardrails.total_requests_24h ?? guardrails.evaluated_24h ?? 0).toLocaleString()} events in the last 7 days
              {guardrails.source ? ` (${guardrails.source})` : ''}. Open Audit Chain for the full event stream.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {govRules.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Model Governance Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {govRules.map((r: any, i: number) => (
              <div key={r.id || i} className="flex items-center justify-between p-2 rounded border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: COLORS.royalBlue }}>{r.name || r.rule || r.title}</p>
                  <p className="text-xs text-gray-500 truncate">{r.description || r.details || ''}</p>
                </div>
                <Badge variant="outline" className="text-[10px]" style={{ borderColor: r.active !== false ? COLORS.emerald : COLORS.gold }} role="status">
                  {r.active !== false ? 'Enforced' : 'Disabled'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>CTO Guardrail Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { rule: 'No AI Legal Advice (Jurexio Citizen)', active: true },
              { rule: 'No Visible Lawyer Ratings', active: true },
              { rule: 'No Notice Drafting', active: true },
              { rule: 'No Bail Advice', active: true },
              { rule: 'No Marketplace Browsing', active: true },
              { rule: 'PII Redaction Enforcement', active: true },
              { rule: 'Prompt Injection Detection', active: true },
              { rule: 'LLM via Agent Registry Only', active: true },
            ].map(r => (
              <div key={r.rule} className="flex items-center justify-between p-2 rounded border">
                <span className="text-sm">{r.rule}</span>
                <Badge className="bg-red-50 text-red-700 border-red-200" variant="outline" role="status">Enforced</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              {incidents.length > 0 ? `Incidents (${incidents.length})` : 'Incidents'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {incidents.length > 0 ? (
              <ScrollArea className="h-[280px]" aria-label="Scrollable content">
                <div className="space-y-2">
                  {incidents.map((inc: any, i: number) => (
                    <div key={inc.id || i} className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium" style={{ color: COLORS.royalBlue }}>{inc.title || inc.type || 'Incident'}</p>
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: inc.severity === 'critical' ? '#EF4444' : COLORS.gold }} role="status">
                          {inc.severity || 'medium'}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{inc.description || ''}</p>
                      {inc.status !== 'resolved' && (
                        <Button size="sm" variant="outline" className="mt-2 h-6 text-xs" onClick={() => resolveIncident.mutate(inc.id)}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Resolve
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-300" />
                <p className="text-sm">No open incidents</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {compliance.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Compliance Evidence ({compliance.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {compliance.slice(0, 10).map((e: any, i: number) => (
                <div key={e.id || i} className="p-2 rounded border text-sm">
                  <p className="font-medium" style={{ color: COLORS.royalBlue }}>{e.framework || e.type}</p>
                  <p className="text-xs text-gray-500">{e.description || e.evidence || ''}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderTools = () => {
    const categories = tools?.categories || [];
    const totalTools = tools?.summary?.totalTools || 0;
    const catCount = tools?.summary?.categories || categories.length;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">Registered Tools</p>
              <p className="text-3xl font-bold" style={{ color: COLORS.royalBlue }}>{totalTools}</p>
              <p className="text-xs text-gray-500">{catCount} categories</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">Protocols</p>
              <p className="text-3xl font-bold" style={{ color: COLORS.gold }}>{protocols.length || 5}</p>
              <p className="text-xs text-gray-500">{protocols.filter((p: any) => p.status === 'active').length || protocols.length} active</p>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">Tool Executions</p>
              <p className="text-3xl font-bold" style={{ color: COLORS.emerald }}>{toolsHist.length || 0}</p>
              <p className="text-xs text-gray-500">Recent history</p>
            </CardContent>
          </Card>
        </div>

        {categories.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Tool Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {categories.map((t: any) => (
                  <div key={t.category} className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold" style={{ color: COLORS.royalBlue }}>{t.category}</p>
                      <Badge variant="secondary" className="text-[10px]" role="status">{t.tools} tools</Badge>
                    </div>
                    <p className="text-xs text-gray-500">{t.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {toolsHist.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Recent Tool Executions</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px]" aria-label="Scrollable content">
                <div className="space-y-1">
                  {toolsHist.slice(0, 15).map((t: any, i: number) => (
                    <div key={t.id || i} className="flex items-center justify-between p-2 rounded border text-sm">
                      <span className="font-medium truncate" style={{ color: COLORS.royalBlue }}>{t.toolName || t.tool}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant={t.status === 'success' ? 'default' : 'secondary'} className="text-[10px]"
                          style={t.status === 'success' ? { backgroundColor: COLORS.emerald } : {}}>
                          {t.status}
                        </Badge>
                        {t.duration && <span className="text-[10px] text-gray-400">{t.duration}ms</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const renderAnalytics = () => {
    const totals = analytics?.totals || {};
    const trends = analytics?.trends || [];
    const byProvider = analytics?.byProvider || [];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: COLORS.royalBlue + '20' }}>
          <p className="text-xs text-gray-500">Usage analytics, cost optimization, and token consumption trends</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/console/agent-activity'}>
              <ExternalLink className="w-3 h-3" /> Agent Activity Dashboard
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => window.location.href = '/live-activity-feed'}>
              <ExternalLink className="w-3 h-3" /> Live Activity Feed
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <Zap className="w-8 h-8" style={{ color: COLORS.gold }} />
              <div>
                <p className="text-xs text-gray-500">Total Tokens</p>
                <p className="text-xl font-bold" style={{ color: COLORS.royalBlue }}>{fmt(totals.tokens || sdk?.usage?.totalTokens || 0)}</p>
              </div>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <TrendingUp className="w-8 h-8" style={{ color: COLORS.emerald }} />
              <div>
                <p className="text-xs text-gray-500">Total Requests</p>
                <p className="text-xl font-bold" style={{ color: COLORS.royalBlue }}>{fmt(totals.requests || sdk?.usage?.requests || 0)}</p>
              </div>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <DollarSign className="w-8 h-8" style={{ color: COLORS.royalBlue }} />
              <div>
                <p className="text-xs text-gray-500">Total Cost</p>
                <p className="text-xl font-bold" style={{ color: COLORS.royalBlue }}>${(totals.cost || sdk?.usage?.totalCost || 0).toFixed(2)}</p>
              </div>
            </CardContent>
          </Card>
          <Card style={{ borderLeft: `3px solid ${COLORS.deepNavy}` }}>
            <CardContent className="p-3 flex items-center gap-3">
              <Clock className="w-8 h-8" style={{ color: COLORS.deepNavy }} />
              <div>
                <p className="text-xs text-gray-500">Avg Response</p>
                <p className="text-xl font-bold" style={{ color: COLORS.royalBlue }}>{totals.avgResponseTime || 1.2}s</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {trends.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Usage Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(v: any) => typeof v === 'number' ? fmt(v) : v} />
                  <Area type="monotone" dataKey="tokens" stroke={COLORS.royalBlue} fill={COLORS.royalBlue + '20'} />
                  <Area type="monotone" dataKey="requests" stroke={COLORS.gold} fill={COLORS.gold + '20'} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {byProvider.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Usage by Provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={byProvider}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="provider" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(v: any) => typeof v === 'number' ? fmt(v) + ' tokens' : v} />
                  <Bar dataKey="tokens" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Platform Token Budget Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={[
                { platform: 'Jurexio Citizen', budget: 500000 },
                { platform: 'NS Prof', budget: 200000 },
                { platform: 'NS Inst', budget: 1000000 },
                { platform: 'NS Governance', budget: 2000000 },
                { platform: 'NS Academy', budget: 300000 },
                { platform: 'Auto SDK', budget: 100000 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmt(v)} />
                <Tooltip formatter={(v: any) => typeof v === 'number' ? fmt(v) + ' tokens' : v} />
                <Bar dataKey="budget" fill={COLORS.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Platform Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: 'Platform Version', value: runtimeRegistryVersion || health?.version || 'v5.1.0' },
            { label: 'Backend', value: 'Express.js + TypeScript' },
            { label: 'Database', value: 'PostgreSQL (Neon-backed)' },
            { label: 'ORM', value: 'Drizzle ORM' },
            { label: 'Agents', value: `${totalAgents} across ${Object.keys(registryData.practiceAreaSummary || agentsByCategory).length} practice areas` },
            { label: 'LLM Providers', value: `${providers.length || '—'} with 6-model fallback` },
            { label: 'Tools', value: `${tools?.summary?.totalTools || JRX_REGISTRY_RUNTIME.mcpTools} across ${tools?.summary?.categories || JRX_REGISTRY_RUNTIME.mcpCategories} categories` },
            { label: 'Protocols', value: `${protocols.length || '—'} registered` },
            { label: 'AI Maturity', value: `${dash.aiMaturityScore ?? '—'}/100` },
            { label: 'NV Endpoints', value: `${health?.totalEndpoints || '—'}` },
            { label: 'Auth', value: 'JWT (4h access + 30d refresh)' },
            { label: 'Security', value: 'Helmet, CORS, Rate Limiting, PII Redaction' },
          ].map(c => (
            <div key={c.label} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-600">{c.label}</span>
              <span className="text-sm font-medium" style={{ color: COLORS.royalBlue }}>{c.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {settingsList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Feature Toggles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {settingsList.map((s: any) => (
              <div key={s.key} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-600">{s.label || s.key}</span>
                <Switch checked={s.value} onCheckedChange={(v) => toggleSetting.mutate({ key: s.key, value: v })} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>NV Orchestration Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {settingsLoading ? (
              <div className="col-span-full grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="loading-features">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : settingsError ? (
              <div className="col-span-full">
                <JrxErrorState
                  title="Unable to load orchestration features"
                  onRetry={() => refetchSettings()}
                  size="sm"
                />
              </div>
            ) : Object.keys(features).length === 0 ? (
              <div className="col-span-full">
                <JrxEmptyState title="No orchestration features reported" description="Settings have not advertised any feature flags." size="sm" />
              </div>
            ) : (
              Object.entries(features).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 p-2 rounded border">
                  {val ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}
                  <span className="text-xs capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderPhase4 = () => {
    const vs = safeObj(p4VectorStats);
    const sb = safeObj(p4SandboxStatus);
    const vi = safeObj(p4VisionCaps);
    const vo = safeObj(p4VoiceStatus);
    const of_ = safeObj(p4OfficeStatus);
    const ex = safeArr(p4Experiments);
    const dr = safeObj(p4DriftStatus);
    const healthColor = (s: string) => s === 'healthy' ? COLORS.emerald : s === 'degraded' ? '#EAB308' : s === 'critical' ? '#EF4444' : '#6B7280';
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-7 gap-3">
          {[
            { label: 'Vector Search', icon: Search, value: vs.totalSearches ?? 0, sub: `${vs.collectionsCount ?? 0} collections` },
            { label: 'Tool Sandbox', icon: Code, value: sb.totalExecutions ?? 0, sub: `${sb.availableTools ?? 0} tools` },
            { label: 'Vision (GPT-4o)', icon: Scan, value: vi.stats?.totalAnalyses ?? 0, sub: `${vi.capabilities?.length ?? 0} capabilities` },
            { label: 'Voice', icon: Mic, value: vo.totalSessions ?? 0, sub: `${vo.languageCount ?? 0} languages` },
            { label: 'Office/DOCX', icon: FileOutput, value: of_.documentsGenerated ?? 0, sub: `${of_.templatesCount ?? 0} templates` },
            { label: 'A/B Experiments', icon: FlaskConical, value: ex.length, sub: `${ex.filter((e: any) => e.status === 'running').length} running` },
            { label: 'Drift Detection', icon: LineChart, value: dr.totalChecks ?? 0, sub: dr.overallHealth ?? 'healthy' },
          ].map((item, i) => (
            <Card key={i} className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
              <CardContent className="p-3 text-center">
                <item.icon className="w-5 h-5 mx-auto mb-1" style={{ color: COLORS.royalBlue }} />
                <div className="text-lg font-bold" style={{ color: COLORS.royalBlue }}>{fmt(Number(item.value))}</div>
                <div className="text-[10px] font-medium" style={{ color: COLORS.deepNavy }}>{item.label}</div>
                <div className="text-[9px] text-gray-400 mt-0.5">{item.sub}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><Search className="w-4 h-4" /> pgvector Search</div>
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span>Total Searches</span><Badge variant="outline" role="status">{vs.totalSearches ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Avg Latency</span><Badge variant="outline" role="status">{vs.avgLatencyMs ?? 0}ms</Badge></div>
              <div className="flex justify-between"><span>Collections</span><Badge variant="outline" role="status">{vs.collectionsCount ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Index Type</span><Badge variant="outline" role="status">HNSW</Badge></div>
              <div className="flex justify-between"><span>Metric</span><Badge variant="outline" role="status">Cosine Similarity</Badge></div>
              {Object.entries(vs.searchTypes || {}).map(([k, v]: [string, any]) => (
                <div key={k} className="flex justify-between"><span className="capitalize">{k}</span><Badge variant="secondary" role="status">{v}</Badge></div>
              ))}
            </CardContent>
          </Card>

          <Card className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><Code className="w-4 h-4" /> MCP Tool Sandbox</div>
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span>Status</span>
                <Badge style={{ backgroundColor: sb.healthy ? COLORS.emerald : '#EF4444', color: 'white' }}>{sb.healthy ? 'Healthy' : 'Degraded'}</Badge>
              </div>
              <div className="flex justify-between"><span>Available Tools</span><Badge variant="outline" role="status">{sb.availableTools ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Total Executions</span><Badge variant="outline" role="status">{sb.totalExecutions ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Success Rate</span><Badge variant="outline" role="status">{sb.successRate ?? 100}%</Badge></div>
              <div className="flex justify-between"><span>Avg Execution Time</span><Badge variant="outline" role="status">{sb.avgExecutionTimeMs ?? 0}ms</Badge></div>
              <div className="flex justify-between"><span>Isolation</span><Badge variant="outline" role="status">VM2 Sandbox</Badge></div>
            </CardContent>
          </Card>

          <Card className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><Scan className="w-4 h-4" /> Multimodal Vision</div>
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span>Analyses</span><Badge variant="outline" role="status">{vi.stats?.totalAnalyses ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Avg Latency</span><Badge variant="outline" role="status">{vi.stats?.avgLatencyMs ?? 0}ms</Badge></div>
              <div className="flex justify-between"><span>Avg Tokens</span><Badge variant="outline" role="status">{vi.stats?.avgTokens ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Primary Model</span><Badge variant="outline" role="status">GPT-4o</Badge></div>
              {(vi.capabilities || []).slice(0, 4).map((c: any, i: number) => (
                <div key={i} className="flex justify-between"><span className="capitalize">{c.type?.replace(/_/g, ' ')}</span>
                  <Badge variant="secondary" className="text-[9px]" role="status">{c.models?.join(', ')}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><Mic className="w-4 h-4" /> Voice Integration</div>
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span>Total Sessions</span><Badge variant="outline" role="status">{vo.totalSessions ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Languages</span><Badge variant="outline" role="status">{vo.languageCount ?? 0}</Badge></div>
              {Object.entries(vo.providers || {}).map(([k, v]: [string, any]) => (
                <div key={k} className="flex justify-between">
                  <span className="capitalize">{v.name || k}</span>
                  <Badge style={{ backgroundColor: v.available ? COLORS.emerald : '#9CA3AF', color: 'white' }} className="text-[9px]">
                    {v.available ? 'Active' : 'Not Set'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><FileOutput className="w-4 h-4" /> Office / DOCX</div>
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span>Documents Generated</span><Badge variant="outline" role="status">{of_.documentsGenerated ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Templates</span><Badge variant="outline" role="status">{of_.templatesCount ?? 0}</Badge></div>
              <div className="flex justify-between"><span>Formats</span><Badge variant="outline" role="status">{(of_.formatsSupported || []).join(', ')}</Badge></div>
              <div className="flex justify-between"><span>Categories</span><Badge variant="outline" role="status">{(of_.categories || []).length}</Badge></div>
              <div className="flex justify-between"><span>Status</span>
                <Badge style={{ backgroundColor: of_.available ? COLORS.emerald : '#9CA3AF', color: 'white' }}>{of_.available ? 'Available' : 'Offline'}</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Agent A/B Testing</div>
            </CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between"><span>Total Experiments</span><Badge variant="outline" role="status">{ex.length}</Badge></div>
              <div className="flex justify-between"><span>Running</span><Badge variant="outline" role="status">{ex.filter((e: any) => e.status === 'running').length}</Badge></div>
              <div className="flex justify-between"><span>Completed</span><Badge variant="outline" role="status">{ex.filter((e: any) => e.status === 'completed').length}</Badge></div>
              <div className="flex justify-between"><span>Draft</span><Badge variant="outline" role="status">{ex.filter((e: any) => e.status === 'draft').length}</Badge></div>
              <div className="flex justify-between"><span>Statistical Test</span><Badge variant="outline" role="status">Z-Test (p&lt;0.05)</Badge></div>
              <div className="flex justify-between"><span>Scoring</span><Badge variant="outline" role="status">Quality 60% + Success 30% + Latency 10%</Badge></div>
            </CardContent>
          </Card>

          <Card className="col-span-2 border" style={{ borderColor: COLORS.royalBlue + '20' }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>
              <div className="flex items-center gap-2"><LineChart className="w-4 h-4" /> Model Drift Detection</div>
            </CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-3 text-xs">
                <div className="text-center p-2 rounded" style={{ backgroundColor: COLORS.royalBlue + '08' }}>
                  <div className="text-lg font-bold" style={{ color: COLORS.royalBlue }}>{dr.baselinesCount ?? 0}</div>
                  <div className="text-gray-500">Baselines</div>
                </div>
                <div className="text-center p-2 rounded" style={{ backgroundColor: COLORS.royalBlue + '08' }}>
                  <div className="text-lg font-bold" style={{ color: COLORS.royalBlue }}>{dr.totalChecks ?? 0}</div>
                  <div className="text-gray-500">Checks</div>
                </div>
                <div className="text-center p-2 rounded" style={{ backgroundColor: dr.activeAlerts > 0 ? '#FEF2F2' : COLORS.royalBlue + '08' }}>
                  <div className="text-lg font-bold" style={{ color: dr.activeAlerts > 0 ? '#EF4444' : COLORS.royalBlue }}>{dr.activeAlerts ?? 0}</div>
                  <div className="text-gray-500">Active Alerts</div>
                </div>
                <div className="text-center p-2 rounded" style={{ backgroundColor: COLORS.royalBlue + '08' }}>
                  <div className="text-lg font-bold" style={{ color: COLORS.royalBlue }}>{((dr.latestDriftScore ?? 0) * 100).toFixed(1)}%</div>
                  <div className="text-gray-500">Drift Score</div>
                </div>
                <div className="text-center p-2 rounded" style={{ backgroundColor: COLORS.royalBlue + '08' }}>
                  <div className="text-lg font-bold" style={{ color: healthColor(dr.overallHealth || 'healthy') }}>{(dr.overallHealth || 'Healthy').toUpperCase()}</div>
                  <div className="text-gray-500">Health</div>
                </div>
              </div>
              {(dr.recentChecks || []).length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-xs font-medium text-gray-500 mb-1">Recent Checks</div>
                  {(dr.recentChecks || []).slice(0, 5).map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b" style={{ borderColor: '#f0f0f0' }}>
                      <span className="text-gray-500">{new Date(c.checked_at).toLocaleString()}</span>
                      <Badge variant={c.drift_detected ? 'destructive' : 'outline'} className="text-[9px]">
                        {c.drift_detected ? 'Drift Detected' : 'Normal'} ({(Number(c.drift_score || 0) * 100).toFixed(1)}%)
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderUsers = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: userStatsCounts.total ?? realUsers.length ?? 0, icon: Users, color: COLORS.royalBlue },
          { label: 'Active Today', value: userStatsCounts.activeToday ?? 0, icon: Activity, color: COLORS.emerald },
          { label: 'Admins / Super Admins', value: userStatsCounts.admins ?? 0, icon: Lock, color: COLORS.gold },
          { label: 'Roles Active', value: [...new Set(realUsers.map((u: any) => u.role))].length || 0, icon: Key, color: COLORS.midBlue },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4 flex items-center gap-3">
              <c.icon className="w-6 h-6" style={{ color: c.color }} />
              <div>
                <p className="text-xs text-gray-500 uppercase">{c.label}</p>
                <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>User Directory ({realUsers.length} users)</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refetchUsers()}><RotateCcw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button size="sm" className="h-7 text-xs" style={{ background: COLORS.royalBlue }}><UserPlus className="w-3 h-3 mr-1" />Invite User</Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]" aria-label="Scrollable content">
            <div className="space-y-2">
              {usersLoading ? (
                <div className="space-y-2 p-2" data-testid="loading-cc-users">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : usersError ? (
                <JrxErrorState
                  title="Unable to load users"
                  description="The user directory could not be retrieved."
                  onRetry={() => refetchUsers()}
                  size="sm"
                />
              ) : realUsers.length === 0 ? (
                <JrxEmptyState title="No users yet" description="Invite your first user to get started." size="sm" />
              ) : realUsers.map((u: any, i: number) => (
                <div key={u.id || i} className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: u.role === 'super_admin' ? COLORS.gold : COLORS.royalBlue }}>
                      {(u.name || u.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{u.name || 'Unknown'}</p>
                      <p className="text-xs text-gray-500">{u.email} · {u.subscriptionPlan || 'free'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize" role="status">{u.role?.replace('_', ' ')}</Badge>
                    <Badge variant={u.status === 'active' ? 'default' : 'secondary'} className="text-xs capitalize"
                      style={u.status === 'active' ? { background: COLORS.emerald } : {}}>
                      {u.status || 'active'}
                    </Badge>
                    <span className="text-xs text-gray-400">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('en-IN') : 'Never'}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>RBAC Permission Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-semibold text-gray-600">Module</th>
                  {['Super Admin', 'Admin', 'Manager', 'Analyst', 'API User', 'Read-Only'].map(r => (
                    <th key={r} className="py-2 px-2 font-semibold text-gray-600 text-center whitespace-nowrap">{r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { module: 'Command Centre', perms: [true, true, true, true, false, true] },
                  { module: 'User Management', perms: [true, true, false, false, false, false] },
                  { module: 'AI Agents', perms: [true, true, true, true, true, false] },
                  { module: 'LLM Management', perms: [true, true, true, false, false, false] },
                  { module: 'Knowledge Base', perms: [true, true, true, true, true, false] },
                  { module: 'API Lab', perms: [true, true, true, true, true, false] },
                  { module: 'Analytics', perms: [true, true, true, true, false, true] },
                  { module: 'Compliance', perms: [true, true, false, false, false, false] },
                  { module: 'Billing', perms: [true, true, false, false, false, false] },
                  { module: 'System Config', perms: [true, false, false, false, false, false] },
                  { module: 'Alerts', perms: [true, true, true, false, false, false] },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 font-medium text-gray-700">{row.module}</td>
                    {row.perms.map((allowed, j) => (
                      <td key={j} className="py-2 px-2 text-center">
                        {allowed
                          ? <CheckCircle className="w-4 h-4 mx-auto" style={{ color: COLORS.emerald }} />
                          : <XCircle className="w-4 h-4 mx-auto text-gray-200" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderKnowledge = () => {
    const statuteTotal = Number(statuteCov.total ?? 0);
    const statutePct = Number(statuteCov.coveragePct ?? 0);
    const statuteSlo = String(statuteCov.slo?.overallStatus ?? '—');
    const caselawTotal = Number(caselawStatsLive.totalDocuments ?? caselawEmbedCov.total ?? 0);
    const caselawPct = Number(caselawEmbedCov.coveragePct ?? 0);
    const caselawEmbedded = Number(caselawEmbedCov.embedded ?? 0);
    const embedScopes = Array.isArray(caselawStatsLive.embedding) ? caselawStatsLive.embedding : [];
    const scScope = embedScopes.find((s: any) => String(s?.scope || '').toLowerCase() === 'sc');
    const hcScope = embedScopes.find((s: any) => String(s?.scope || '').toLowerCase() === 'hc');
    const scEmbedded = Number(scScope?.totalEmbedded ?? 0);
    const hcEmbedded = Number(hcScope?.totalEmbedded ?? 0);
    const caselawReadyNote =
      caselawPct >= 99
        ? 'Vector SLO met'
        : 'FTS+Athena ready · vector backfill SLO (multi-day)';
    const planeOn = planeHealthLive.flag === true || planeHealthLive.upstream?.ok === true;
    const planeCircuit = String(planeHealthLive.client?.circuit ?? planeHealthLive.circuit ?? '—');
    const cachedAt = statuteCov.cachedAt || caselawEmbedCov.cachedAt || null;
    const corpusRows = [
      {
        name: 'NYS Statutes (nyvapp) · India-ready',
        docs: statuteTotal ? statuteTotal.toLocaleString() : '—',
        status: statuteSlo === 'ok' || statutePct >= 99 ? 'India SLO ok' : statuteSlo,
        detail: `Embed ${statutePct}% · Knowledge Plane`,
        type: 'Global',
      },
      {
        name: 'NYS Caselaw judgments (RDS)',
        docs: caselawTotal ? caselawTotal.toLocaleString() : '—',
        status: caselawPct >= 99 ? 'SLO ok' : 'Backfill SLO',
        detail: `FTS searchable · vectors ${caselawEmbedded.toLocaleString()} (${caselawPct}% overall)${scEmbedded || hcEmbedded ? ` · SC ${scEmbedded.toLocaleString()} · HC ${hcEmbedded.toLocaleString()}` : ''}`,
        type: 'Global',
      },
      ...ragCollectionsList.slice(0, 8).map((c: any) => ({
        name: String(c.name || c.collection || c.namespace || c.id || 'RAG collection'),
        docs: String(c.documentCount ?? c.doc_count ?? c.documents ?? c.count ?? '—'),
        status: String(c.status || 'Indexed'),
        detail: String(c.lastIndexedAt || c.updatedAt || c.jurisdiction || 'Tenant RAG'),
        type: 'Tenant',
      })),
    ];
    return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-700">
        Live Knowledge Plane{planeOn ? ' · ON' : ' · checking'} · circuit {planeCircuit}
        {cachedAt ? ` · as of ${new Date(cachedAt).toLocaleString()}` : ''}.
        India statutes/acts are product-ready when statute embed is 100%; caselaw global vector % is an <strong>ops backfill SLO</strong> (not “GA blocked” — FTS + Athena + hybrid still serve search).
        Open <a href="/nys-knowledge-plane" className="underline font-medium">NYS Knowledge Plane</a> for IN probes & SSO launchpad.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Statute sections', value: statuteTotal ? statuteTotal.toLocaleString() : '—', sub: `Embed ${statutePct}% · India product-ready when SLO ok`, color: COLORS.royalBlue },
          { label: 'Caselaw documents', value: caselawTotal ? caselawTotal.toLocaleString() : '—', sub: `${caselawReadyNote} · ${caselawPct}% vector backfill SLO`, color: COLORS.gold },
          { label: 'Tenant RAG collections', value: String(ragCollectionsList.length || '—'), sub: 'Org-scoped namespaces', color: COLORS.emerald },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
              <p className="text-xs text-gray-500">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Knowledge surfaces (live)</CardTitle>
          <Button size="sm" className="h-7 text-xs" style={{ background: COLORS.royalBlue }} onClick={() => { window.location.href = '/rag-knowledge-base'; }}>
            <Upload className="w-3 h-3 mr-1" />RAG console
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {corpusRows.length === 0 ? (
              <JrxEmptyState title="No knowledge surfaces yet" description="Knowledge Plane proxies or tenant RAG collections will appear here." size="sm" />
            ) : corpusRows.map((kb, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <BookMarked className="w-5 h-5" style={{ color: COLORS.royalBlue }} />
                  <div>
                    <p className="text-sm font-medium">{kb.name}</p>
                    <p className="text-xs text-gray-500">{kb.docs} · {kb.detail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs" role="status">{kb.type}</Badge>
                  <Badge className="text-xs" style={{ background: COLORS.emerald }}>{kb.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Retrieval stack</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Global corpus', value: 'NYS Knowledge Plane (nyayasearch)' },
              { label: 'Statute search', value: 'Hybrid FTS + vector RRF' },
              { label: 'Caselaw search', value: 'FTS live · vector backfill in progress' },
              { label: 'Tenant RAG', value: 'Qdrant / pgvector namespaces' },
              { label: 'Agent grounding', value: 'Knowledge Plane → RAG → memory → LLM' },
              { label: 'Plane health', value: planeOn ? `OK · ${planeCircuit}` : 'Checking…' },
            ].map(c => (
              <div key={c.label} className="flex justify-between py-1 border-b border-gray-50 text-xs">
                <span className="text-gray-500">{c.label}</span>
                <span className="font-medium text-right max-w-[60%]" style={{ color: COLORS.royalBlue }}>{c.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Federation probes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">
              Use the Knowledge Plane hub for Auto-RAG / statutes / caselaw / Athena probes with live JRX proxies.
            </p>
            <Button size="sm" className="w-full text-xs" style={{ background: COLORS.royalBlue }} onClick={() => { window.location.href = '/nys-knowledge-plane'; }}>
              <Search className="w-3 h-3 mr-1" />Open Knowledge Plane hub
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
    );
  };

  const renderConnectors = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        MCP integrations are managed on the live <a href="/tools-mcp" className="underline font-medium">Tools & MCP</a> console —
        {mcpCatalogTotal > 0
          ? ` ${mcpCatalogTotal} catalog tools, ${mcpExecutableTotal} executable (HTTP 501 for catalog-only).`
          : ' loading catalog counts…'}
        The connector marketplace below is a product roadmap reference, not live connection status.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'MCP Catalog', value: String(mcpCatalogTotal || '—'), color: COLORS.royalBlue },
          { label: 'Executable handlers', value: String(mcpExecutableTotal || '—'), color: COLORS.emerald },
          { label: 'Catalog-only', value: mcpCatalogTotal ? String(Math.max(0, mcpCatalogTotal - mcpExecutableTotal)) : '—', color: COLORS.gold },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {[
        {
          category: 'Legal Databases',
          connectors: [
            { name: 'eCourts India API', status: 'available', desc: 'Real-time case status and court orders' },
            { name: 'Indian Kanoon', status: 'available', desc: 'Judgment and order search API' },
            { name: 'SCC Online', status: 'available', desc: 'Supreme Court Cases database' },
            { name: 'National Judicial Data Grid (NJDG)', status: 'available', desc: 'Case tracking across courts' },
          ]
        },
        {
          category: 'Communication',
          connectors: [
            { name: 'WhatsApp Business API', status: 'connected', desc: 'Legal notifications and chatbot' },
            { name: 'SendGrid Email', status: 'available', desc: 'Transactional email delivery' },
            { name: 'Twilio SMS', status: 'available', desc: 'SMS alerts and OTP' },
            { name: 'Slack', status: 'available', desc: 'Team notifications and alerts' },
          ]
        },
        {
          category: 'Document Management',
          connectors: [
            { name: 'Google Drive', status: 'connected', desc: 'Document sync and storage' },
            { name: 'OneDrive / SharePoint', status: 'available', desc: 'Microsoft document management' },
            { name: 'AWS S3', status: 'available', desc: 'Object storage for documents' },
          ]
        },
        {
          category: 'Identity & Payments',
          connectors: [
            { name: 'Google OAuth', status: 'connected', desc: 'SSO for web applications' },
            { name: 'Razorpay', status: 'connected', desc: 'Payment gateway (live keys configured)' },
            { name: 'DigiLocker India', status: 'available', desc: 'Government document verification' },
            { name: 'Aadhaar eKYC', status: 'available', desc: 'Identity verification' },
          ]
        },
      ].map(cat => (
        <Card key={cat.category}>
          <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>{cat.category}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {cat.connectors.map((conn, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Plug className="w-4 h-4" style={{ color: conn.status === 'connected' ? COLORS.emerald : COLORS.midBlue }} />
                    <div>
                      <p className="text-xs font-medium">{conn.name}</p>
                      <p className="text-xs text-gray-400">{conn.desc}</p>
                    </div>
                  </div>
                  <Badge className="text-xs shrink-0" style={{ background: conn.status === 'connected' ? COLORS.emerald : '#e5e7eb', color: conn.status === 'connected' ? 'white' : '#6b7280' }}>
                    {conn.status === 'connected' ? 'Connected' : 'Available'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Webhook Event Center</CardTitle>
          <Button size="sm" className="h-7 text-xs" style={{ background: COLORS.royalBlue }}><PlusCircle className="w-3 h-3 mr-1" />Add Webhook</Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            {[
              { event: 'agent.completed', target: 'https://api.lawfirmalpha.com/jrx-hook', status: 'Active', last: '2 min ago' },
              { event: 'compliance.alert', target: 'https://ops.wizardstech.in/alerts', status: 'Active', last: '1h ago' },
            ].map((wh, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded border">
                <div>
                  <Badge variant="outline" className="text-[10px] mr-2" role="status">{wh.event}</Badge>
                  <span className="text-gray-500">{wh.target}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">Last: {wh.last}</span>
                  <Badge style={{ background: COLORS.emerald }} className="text-[10px]">{wh.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderApiLab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card style={{ borderLeft: `3px solid ${COLORS.royalBlue}` }}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase">Total Endpoints</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.royalBlue }}>{health?.totalEndpoints || 153}</p>
            <p className="text-xs text-gray-500">NV API routes</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.gold}` }}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase">Requests Today</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.gold }}>1,284,329</p>
            <p className="text-xs text-gray-500">+18.2% vs yesterday</p>
          </CardContent>
        </Card>
        <Card style={{ borderLeft: `3px solid ${COLORS.emerald}` }}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 uppercase">Success Rate</p>
            <p className="text-2xl font-bold" style={{ color: COLORS.emerald }}>99.3%</p>
            <p className="text-xs text-gray-500">P99 latency: 2.1s</p>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>API Explorer</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 text-xs">
              {[
                { group: 'Authentication', endpoints: ['POST /auth/login', 'POST /auth/refresh', 'DELETE /auth/revoke'] },
                { group: 'NV Core', endpoints: ['POST /nv/run', 'POST /nv/stream', 'GET /nv/health'] },
                { group: 'Agents', endpoints: ['GET /nv/agents', 'POST /nv/agents/chain', 'POST /nv/orchestrate'] },
                { group: 'Documents', endpoints: ['POST /nv/vision/analyze', 'POST /nv/office/generate'] },
                { group: 'Phase 4', endpoints: ['POST /nv/vector/search', 'POST /nv/mcp/execute', 'GET /nv/drift/status'] },
                { group: 'Phase 5', endpoints: ['POST /nv/workflow/run', 'POST /nv/predict/outcome', 'GET /nv/marketplace'] },
              ].map((grp, i) => (
                <div key={i} className="border rounded p-2">
                  <p className="font-semibold text-gray-700 mb-1">{grp.group}</p>
                  {grp.endpoints.map((ep, j) => (
                    <p key={j} className="text-gray-500 pl-2 py-0.5 hover:text-blue-600 cursor-pointer truncate">{ep}</p>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Request Builder</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Select defaultValue="POST" aria-label="Select option">
                <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder={`http://localhost:3001${NV_BASE}health`} className="h-8 text-xs flex-1"  aria-label={`http://localhost:3001${NV_BASE}health`}/>
              <Button size="sm" className="h-8 text-xs px-4" style={{ background: COLORS.royalBlue }}>Send</Button>
            </div>
            <div className="bg-gray-900 text-green-400 rounded p-3 font-mono text-xs min-h-[120px]">
              <p className="text-gray-500 mb-2">{'// Request body (JSON)'}</p>
              <p>{'{'}</p>
              <p className="pl-4">"query": "Explain Section 420 IPC",</p>
              <p className="pl-4">"agentId": "legal-research-pro",</p>
              <p className="pl-4">"jurisdiction": "IN"</p>
              <p>{'}'}</p>
            </div>
            <div className="bg-gray-50 rounded p-3 font-mono text-xs min-h-[80px]">
              <p className="text-gray-400">{'// Response will appear here after sending request'}</p>
              <p className="text-green-600 font-medium">GET /api/jrx/health → 200 OK · 12ms</p>
              <p>{'{"success":true,"data":{"status":"operational","version":"v4.1.1","uptime":...'}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs"><Copy className="w-3 h-3 mr-1" />Copy as cURL</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs"><Download className="w-3 h-3 mr-1" />Save to Collection</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs"><ExternalLink className="w-3 h-3 mr-1" />Open Full Lab</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderTenants = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Organizations', value: orgStatsCounts.total ?? realOrgs.length, color: COLORS.royalBlue, sub: 'Registered tenants' },
          { label: 'Active Orgs', value: orgStatsCounts.active ?? realOrgs.filter((o: any) => o.isActive).length, color: COLORS.emerald, sub: 'Currently active' },
          { label: 'Total Users', value: userStatsCounts.total ?? 0, color: COLORS.gold, sub: 'Across all orgs' },
          { label: 'Platforms', value: livePlatformCount || mergedPlatforms.length || 0, color: COLORS.midBlue, sub: 'Connected platforms' },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
              <p className="text-xs text-gray-400">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Organization Directory ({realOrgs.length} orgs)</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refetchOrgs()}><RotateCcw className="w-3 h-3 mr-1" />Refresh</Button>
            <Button size="sm" className="h-7 text-xs" style={{ background: COLORS.royalBlue }}><PlusCircle className="w-3 h-3 mr-1" />Onboard Org</Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]" aria-label="Scrollable content">
            <div className="space-y-2">
              {orgsLoading ? (
                <div className="space-y-2 p-2" data-testid="loading-cc-orgs">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : orgsError ? (
                <JrxErrorState
                  title="Unable to load organizations"
                  description="The organization directory could not be retrieved."
                  onRetry={() => refetchOrgs()}
                  size="sm"
                />
              ) : realOrgs.length === 0 ? (
                <JrxEmptyState title="No organizations yet" description="Onboard your first organization to populate this directory." size="sm" />
              ) : realOrgs.map((t: any, i: number) => (
                <div key={t.id || i} className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-6 h-6 shrink-0" style={{ color: COLORS.royalBlue }} />
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.userCount} users · {t.industry || 'Legal'} · {t.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize" role="status">{t.plan || 'core'}</Badge>
                    <Badge style={{ background: t.isActive ? COLORS.emerald : '#9CA3AF' }} className="text-xs text-white">
                      {t.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <span className="text-xs text-gray-400">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-IN') : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { name: 'Jurexio Core', price: '₹4,999/mo', features: ['Full ROMA L5 agent registry', '100K API calls/mo', '5GB KB storage', 'Email support'], color: COLORS.midBlue },
          { name: 'Jurexio Enterprise', price: '₹24,999/mo', features: ['Priority LLM routing', 'Unlimited agents', '1M API calls/mo', '50GB KB', '24/7 SLA support'], color: COLORS.royalBlue },
          { name: 'Enterprise+', price: 'Custom', features: ['Dedicated infrastructure', 'Unlimited everything', 'Custom SLA', 'White-label ready', 'Compliance officer'], color: COLORS.gold },
        ].map(plan => (
          <Card key={plan.name} style={{ borderTop: `3px solid ${plan.color}` }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm" style={{ color: plan.color }}>{plan.name}</CardTitle>
              <p className="text-lg font-bold" style={{ color: plan.color }}>{plan.price}</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                    <CheckCircle className="w-3 h-3" style={{ color: plan.color }} />{f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderAlerts = () => {
    const openIncidents = incidents.filter((i: any) => {
      const s = String(i.status || i.state || '').toLowerCase();
      return !s || s === 'open' || s === 'active' || s === 'firing' || s === 'investigating';
    });
    const resolvedIncidents = incidents.filter((i: any) => {
      const s = String(i.status || i.state || '').toLowerCase();
      return s === 'resolved' || s === 'closed';
    });
    const critical = openIncidents.filter((i: any) => String(i.severity || i.level || '').toLowerCase().includes('crit')).length;
    const warn = openIncidents.length - critical;
    return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Alerts', value: String(openIncidents.length), color: openIncidents.length ? '#EF4444' : COLORS.emerald, sub: `${critical} critical, ${Math.max(0, warn)} warnings` },
          { label: 'Resolved (listed)', value: String(resolvedIncidents.length), color: COLORS.emerald, sub: 'From incidents API' },
          { label: 'HITL pending', value: String(hitlP.length || hitlS.pending || 0), color: COLORS.royalBlue, sub: 'Human review queue' },
          { label: 'Guardrail events', value: String(guardrails.total ?? guardrails.events ?? guardrails.count ?? '—'), color: COLORS.gold, sub: 'Safety ring' },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
              <p className="text-xs text-gray-400">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Active / recent incidents</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {openIncidents.length === 0 && incidents.length === 0 ? (
              <JrxEmptyState title="No open incidents" description="Live incident feed is empty — platform health is clear." size="sm" />
            ) : (openIncidents.length ? openIncidents : incidents).slice(0, 12).map((alert: any, i: number) => {
              const sev = String(alert.severity || alert.level || 'INFO').toUpperCase();
              const color = sev.includes('CRIT') ? '#EF4444' : sev.includes('WARN') ? COLORS.gold : COLORS.midBlue;
              const Icon = sev.includes('CRIT') ? AlertCircle : AlertTriangle;
              return (
              <div key={alert.id || i} className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5" style={{ color }} />
                  <div>
                    <Badge className="text-[10px] mr-2" style={{ background: color }}>{sev}</Badge>
                    <span className="text-sm">{alert.message || alert.title || alert.summary || 'Incident'}</span>
                    <p className="text-xs text-gray-400">{alert.createdAt || alert.age || alert.updatedAt || ''}</p>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Ops note</CardTitle></CardHeader>
        <CardContent className="text-xs text-gray-600 space-y-2">
          <p>Alert rule catalogs and notification channel wiring are managed via ops runbooks — this tab shows live incidents / HITL / guardrail counts from gateway APIs, not mock demo alerts.</p>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { window.location.href = '/platform-health'; }}>Open Platform Health</Button>
        </CardContent>
      </Card>
    </div>
    );
  };

  const renderDeveloper = () => {
    const keyRows = apiKeys.slice(0, 20);
    return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'API Keys Issued', value: String(keyRows.length || apiKeys.length || '—'), color: COLORS.royalBlue },
          { label: 'Registry agents', value: String(totalAgents || JRX_REGISTRY_RUNTIME.totalAgents), color: COLORS.gold },
          { label: 'MCP catalog tools', value: String(mcpCatalogTotal || JRX_REGISTRY_RUNTIME.mcpTools), color: COLORS.emerald },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>API Key Management</CardTitle>
            <Button size="sm" className="h-7 text-xs" style={{ background: COLORS.royalBlue }} onClick={() => { window.location.href = '/console/platform-management'; }}>
              <PlusCircle className="w-3 h-3 mr-1" />Manage keys
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {keyRows.length === 0 ? (
                <JrxEmptyState title="No API keys listed" description="Keys appear here from /api/jrx/admin/api-keys when available for your role." size="sm" />
              ) : keyRows.map((k: any, i: number) => (
                <div key={k.id || i} className="p-3 rounded border">
                  <div className="flex justify-between">
                    <p className="text-xs font-medium">{k.name || k.label || k.platform || `Key ${i + 1}`}</p>
                    <Badge variant="outline" className="text-[10px]" role="status">{k.scope || k.status || 'active'}</Badge>
                  </div>
                  <p className="font-mono text-xs text-gray-400 mt-1">{k.keyPreview || k.prefix || k.key_prefix || 'nv_****'}</p>
                  <p className="text-xs text-gray-400">Last used: {k.lastUsedAt || k.last_used_at || k.updatedAt || '—'}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Developer portals</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs text-gray-600">
            <p>SDK Hub, API Tester, and partner smoke use live gateway + Knowledge Plane — not sandbox mock counters.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { window.location.href = '/jurexio-sdk-hub'; }}>SDK Hub</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { window.location.href = '/sdk-testing-console'; }}>SDK Testing</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { window.location.href = '/nys-knowledge-plane'; }}>Knowledge Plane</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    );
  };

  const renderPlatformPublishing = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Live Platforms', value: String(livePlatformCount || mergedPlatforms.length || 0), sub: 'From /api/jrx/platforms', color: COLORS.royalBlue },
          { label: 'Registry agents', value: String(totalAgents || JRX_REGISTRY_RUNTIME.totalAgents), sub: 'Runtime ROMA L5', color: COLORS.emerald },
          { label: 'Organizations', value: String(orgStatsCounts.total ?? realOrgs.length ?? 0), sub: 'Registered tenants', color: COLORS.gold },
        ].map(c => (
          <Card key={c.label} style={{ borderLeft: `3px solid ${c.color}` }}>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
              <p className="text-xs text-gray-400">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>Live Platform Integrations</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {registryPlatformRows.length === 0 ? (
              <JrxEmptyState title="No platforms registered" description="Platforms from /api/jrx/platforms will appear here." size="sm" />
            ) : registryPlatformRows.map((p: any, i: number) => (
              <div key={p.id || i} className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium">{p.display_name || p.name || p.platform_type}</p>
                  <p className="text-xs text-gray-500">{p.platform_type} · {p.tier || '—'} · {Array.isArray(p.jurisdictions) ? p.jurisdictions.join(', ') : (p.jurisdiction || '—')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="text-xs" style={{ background: (p.is_active || p.status === 'active') ? COLORS.emerald : COLORS.gold }}>
                    {p.status || (p.is_active ? 'Live' : 'Inactive')}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm" style={{ color: COLORS.royalBlue }}>White-label / org tenants</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {realOrgs.slice(0, 6).length === 0 ? (
              <JrxEmptyState title="No orgs yet" description="Seed demo tenants to populate org structure." size="sm" />
            ) : realOrgs.slice(0, 6).map((wl: any, i: number) => (
              <div key={wl.id || i} className="p-3 rounded border space-y-1">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium">{wl.name}</p>
                  <Badge className="text-xs" style={{ background: wl.isActive ? COLORS.emerald : '#9CA3AF' }}>{wl.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                <p className="text-xs text-gray-500">{wl.slug} · {wl.plan || 'core'} · {wl.userCount ?? 0} users</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const sectionRenderers: Record<string, () => React.ReactElement> = {
    overview: renderOverview,
    users: renderUsers,
    agents: renderAgentOps,
    models: renderModels,
    knowledge: renderKnowledge,
    connectors: renderConnectors,
    'api-lab': renderApiLab,
    analytics: renderAnalytics,
    compliance: renderGovernance,
    tenants: renderTenants,
    alerts: renderAlerts,
    settings: renderSettings,
    developer: renderDeveloper,
    platform: renderPlatformPublishing,
    platforms: renderPlatforms,
    orchestration: renderOrchestration,
    observability: renderObservability,
    governance: renderGovernance,
    tools: renderTools,
    phase4: renderPhase4,
    phase5: () => <Phase5Section token={token} />,
  };

  const currentSection = SIDEBAR_SECTIONS.find(s => s.id === activeSection);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8f9fc' }}>
      {/* ─── v5.0.1 (Phase B): inner sidebar removed, replaced by horizontal tab strip ───
          The outer JrxSidebar.tsx is the single source of truth for app navigation.
          activeSection state preserved; all sectionRenderers untouched. */}
      <header className="border-b bg-white flex items-center justify-between px-4 h-14 shrink-0" style={{ borderColor: COLORS.royalBlue + '15' }} role="banner">
        <div className="flex items-center gap-3 min-w-0">
          {currentSection && <currentSection.icon className="w-5 h-5 shrink-0" style={{ color: COLORS.royalBlue }} />}
          <h2 className="text-lg font-bold truncate" style={{ color: COLORS.royalBlue }}>{currentSection?.label || 'Command Centre'}</h2>
          <span className="text-[10px] text-gray-400 hidden md:inline">Jurexio Governance · Jurexio SDK {health?.version || 'v5.0.7'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(() => {
            const hs = health?.status;
            const isHealthy = hs === 'healthy';
            const isDegraded = hs === 'degraded' || hs === 'unhealthy';
            const color = isHealthy ? COLORS.emerald : isDegraded ? COLORS.gold : !hs && healthLoading ? '#9CA3AF' : '#EF4444';
            const dot = isHealthy ? 'bg-green-500' : isDegraded ? 'bg-amber-500' : !hs && healthLoading ? 'bg-gray-400' : 'bg-red-500';
            const label = isHealthy
              ? 'System Healthy'
              : isDegraded
                ? `System ${hs.charAt(0).toUpperCase() + hs.slice(1)}`
                : hs
                  ? String(hs)
                  : healthLoading
                    ? 'Connecting…'
                    : 'Unreachable';
            return (
              <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }} role="status">
                <div className={`w-1.5 h-1.5 rounded-full mr-1 ${dot}`} />
                {label}
              </Badge>
            );
          })()}
          <Badge variant="outline" className="text-xs" role="status">{totalAgents} Agents</Badge>
        </div>
      </header>

      <nav className="border-b bg-white px-2 py-1 overflow-x-auto shrink-0" style={{ borderColor: COLORS.royalBlue + '15' }} aria-label="Command Centre sections">
        <div className="flex gap-1 min-w-max">
          {SIDEBAR_GROUPS.map(group => (
            <div key={group.group} className="flex items-center gap-1 px-2 border-r last:border-r-0" style={{ borderColor: COLORS.royalBlue + '15' }}>
              <span className="text-[9px] font-bold uppercase tracking-wider mr-1" style={{ color: COLORS.gold }}>{group.group}</span>
              {group.items.map(section => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                    style={isActive ? { color: COLORS.royalBlue, boxShadow: `inset 0 -2px 0 ${COLORS.gold}` } : { color: '#555' }}
                    title={section.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <section.icon className="w-3.5 h-3.5 shrink-0" style={isActive ? { color: COLORS.royalBlue } : {}} />
                    <span>{section.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <main className="flex-1 overflow-auto p-4">
        {sectionRenderers[activeSection]?.() || <div className="text-gray-400">Section not found</div>}
      </main>
    </div>
  );
}
