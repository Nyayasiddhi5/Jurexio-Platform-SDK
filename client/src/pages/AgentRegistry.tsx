import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeader, getAuthToken } from '@/lib/jrx-auth-token';
import { clearAuthSession } from '@/lib/auth-session';
import { 
  Search, 
  Plus, 
  Filter, 
  MoreVertical, 
  Power, 
  PowerOff, 
  Edit, 
  Trash2, 
  Shield, 
  Activity,
  Star,
  Brain,
  Layers,
  Settings,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Network,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import AgentEditModal from '@/components/admin/AgentEditModal';
import AgentPerformanceModal from '@/components/admin/AgentPerformanceModal';
import AgentDeleteDialog from '@/components/admin/AgentDeleteDialog';

import { NV_BASE } from '@/lib/jrx-api-paths';
// Types for agents based on our schema
interface Agent {
  id: string;
  agentId: string;
  name: string;
  description: string;
  tier: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  romaLevel?: string;
  category: string;
  specialization: string;
  capabilities: string[];
  status: 'available' | 'degraded' | 'disabled' | 'active' | 'inactive' | 'maintenance' | 'deprecated';
  isAvailable: boolean;
  version: string;
  skillsets: string[];
  policies: Record<string, any>;
  performanceMetrics: Record<string, any>;
  quantumReady?: boolean;
  jurisdictionScope?: string[];
  // Fleet metadata surfaced by /api/jrx/agents.
  preferredModels?: string[];
  fallbackModels?: string[];
  practiceArea?: string;
  lastInvokedAt?: string | null;
  avgLatencyMs?: number | null;
  createdAt: string;
  updatedAt: string;
}

const AGENT_TIERS = [
  { value: 'L1', label: 'L1 - Basic', bgColor: '#999', textColor: '#FFFFFF', description: 'Simple task execution' },
  { value: 'L2', label: 'L2 - Intermediate', bgColor: '#152448', textColor: '#FFFFFF', description: 'Multi-step workflows' },
  { value: 'L3', label: 'L3 - Advanced', bgColor: '#152448', textColor: '#FFFFFF', description: 'Complex reasoning' },
  { value: 'L4', label: 'L4 - Expert', bgColor: '#C7B15B', textColor: '#152448', description: 'Autonomous operations' },
  { value: 'L5', label: 'L5 - Quantum-Ready', bgColor: '#6B21A8', textColor: '#FFFFFF', description: 'ROMA L5 — Autonomous, Quantum-Ready, GRPO' }
];

const AGENT_CATEGORIES = [
  'development', 'content', 'analysis', 'automation', 'integration', 
  'monitoring', 'security', 'optimization', 'communication', 'creative'
];

// Backend probe emits available/degraded/disabled. Legacy keys retained
// for backwards compatibility with any non-probe callers.
const STATUS_COLORS = {
  available: '#1C7A4F',
  degraded: '#C7B15B',
  disabled: '#999',
  active: '#1C7A4F',
  inactive: '#999',
  maintenance: '#C7B15B',
  deprecated: '#dc2626'
};

const STATUS_ICONS = {
  available: CheckCircle,
  degraded: Clock,
  disabled: XCircle,
  active: CheckCircle,
  inactive: XCircle,
  maintenance: Clock,
  deprecated: AlertTriangle
};

export default function AgentRegistry() {
  const [searchTerm, setSearchTerm] = useState('');
  // Radix Select v1+ throws on empty-string SelectItem values, which crashed
  // the whole page (caught by ErrorBoundary) before any agent data could render.
  // Use the sentinel 'all' for the "no filter" option and translate it back to
  // an empty querystring param when calling /api/jrx/agents.
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>('all');
  const [galleryTab, setGalleryTab] = useState<'fleet' | 'swarms'>('fleet');
  const [currentPage, setCurrentPage] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  // Modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [performanceModalOpen, setPerformanceModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('edit');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch agents from canonical /api/jrx/agents (NV-CONTRACT-001 — replaces dead /api/admin/agents)
  const { data: agentsData, isLoading, error, refetch } = useQuery({
    queryKey: [
      'agents',
      {
        search: searchTerm,
        tier: selectedTier,
        category: selectedCategory,
        status: selectedStatus,
        jurisdiction: selectedJurisdiction,
        limit: 20,
        offset: currentPage * 20,
      },
    ],
    queryFn: async ({ queryKey }) => {
      const [, filters] = queryKey as [string, Record<string, unknown>];
      const params = new URLSearchParams();
      if (filters.search) params.append('search', String(filters.search));
      if (filters.tier && filters.tier !== 'all') params.append('tier', String(filters.tier));
      if (filters.category && filters.category !== 'all') params.append('practiceArea', String(filters.category));
      if (filters.status && filters.status !== 'all') params.append('status', String(filters.status));
      if (filters.jurisdiction && filters.jurisdiction !== 'all') params.append('jurisdiction', String(filters.jurisdiction));
      params.append('limit', String(filters.limit ?? 20));
      params.append('offset', String(filters.offset ?? 0));

      const token = getAuthToken();
      if (!token) {
        clearAuthSession();
        throw new Error('Not signed in — please log in again (HTTP 401)');
      }
      const response = await fetch(`${NV_BASE}agents?${params}`, {
        headers: { ...getAuthHeader(), Accept: 'application/json' },
        credentials: 'include',
      });
      if (response.status === 401) {
        clearAuthSession();
        throw new Error('Session expired — please log in again (HTTP 401)');
      }
      if (!response.ok) throw new Error(`Failed to fetch agents (HTTP ${response.status})`);
      const json = await response.json();
      // Normalise envelope (backend returns { success, data: [...] } OR { data: { agents, total } })
      const rawAgents: any[] = json?.data?.agents ?? json?.agents ?? (Array.isArray(json?.data) ? json.data : []);
      const total = json?.data?.total ?? json?.total ?? rawAgents.length;
      const counts = json?.data?.counts ?? null;
      const globalCounts = json?.data?.globalCounts ?? counts;
      const registryTotal = json?.data?.registryTotal ?? total;
      // Backend returns snake_case from legal_agents table — map to the camelCase Agent shape this page renders.
      const agents = rawAgents.map((a: any) => ({
        id: a.id ?? a.agent_id ?? a.agentId,
        agentId: a.agent_id ?? a.agentId ?? a.id,
        name: a.name ?? 'Unnamed agent',
        description: a.description ?? a.practice_area ?? a.subcategory ?? '',
        tier: a.tier ?? 'L1',
        romaLevel: a.roma_level ?? a.romaLevel,
        category: a.category ?? a.practice_area ?? 'general',
        specialization: a.specialization ?? a.legal_specialization ?? '',
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : (typeof a.capabilities === 'string' ? a.capabilities.split(',').map((s: string) => s.trim()) : []),
        status: a.status ?? 'active',
        isAvailable: (a.is_available ?? a.isAvailable ?? (a.status ? a.status === 'active' : true)),
        version: a.version ?? '1.0.0',
        skillsets: Array.isArray(a.skillsets) ? a.skillsets : [],
        policies: a.policies ?? {},
        performanceMetrics: a.performance_metrics ?? a.performanceMetrics ?? {},
        quantumReady: a.quantum_ready ?? a.quantumReady,
        jurisdictionScope: Array.isArray(a.jurisdiction) ? a.jurisdiction : (a.jurisdiction ? [a.jurisdiction] : (a.jurisdictionScope ?? [])),
        // Real fleet metadata for the row UI.
        preferredModels: Array.isArray(a.preferred_models ?? a.preferredModels) ? (a.preferred_models ?? a.preferredModels) : [],
        fallbackModels: Array.isArray(a.fallback_models ?? a.fallbackModels) ? (a.fallback_models ?? a.fallbackModels) : [],
        practiceArea: a.practice_area ?? a.practiceArea ?? '',
        lastInvokedAt: a.last_invoked_at ?? a.lastInvokedAt ?? null,
        avgLatencyMs: a.avg_latency_ms ?? a.avgLatencyMs ?? null,
        createdAt: a.created_at ?? a.createdAt ?? '',
        updatedAt: a.updated_at ?? a.updatedAt ?? '',
      }));
      return { agents, total, counts, globalCounts, registryTotal };
    },
  });

  const { data: swarmData, isLoading: swarmsLoading } = useQuery({
    queryKey: ['swarm-topologies', { limit: 24 }],
    queryFn: async () => {
      const token = getAuthToken();
      if (!token) {
        clearAuthSession();
        throw new Error('Not signed in — please log in again (HTTP 401)');
      }
      const response = await fetch(`${NV_BASE}swarm/topologies?limit=24`, {
        headers: { ...getAuthHeader(), Accept: 'application/json' },
        credentials: 'include',
      });
      if (response.status === 401) {
        clearAuthSession();
        throw new Error('Session expired — please log in again (HTTP 401)');
      }
      if (!response.ok) throw new Error(`Failed to fetch swarms (HTTP ${response.status})`);
      const json = await response.json();
      const topologies = json?.data?.topologies ?? json?.topologies ?? (Array.isArray(json?.data) ? json.data : []);
      const stats = json?.data?.stats ?? json?.stats ?? null;
      return { topologies, stats, total: json?.data?.total ?? topologies.length };
    },
    enabled: galleryTab === 'swarms',
  });

  // Toggle agent enable/disable — admin write endpoint not yet exposed under /api/jrx/*.
  // Keep the mutation shape stable so the UI compiles; show a clear message instead of 404'ing.
  const toggleAgentMutation = useMutation({
    mutationFn: async ({ agentId, enabled }: { agentId: string; enabled: boolean }) => {
      throw new Error(
        `Admin agent toggle is read-only in this build (agent=${agentId}, target=${enabled ? 'enabled' : 'disabled'}). ` +
        `The write endpoint will land with the org-admin governance routes.`,
      );
    },
    onError: (error: Error) => {
      toast({
        title: 'Read-only mode',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleToggleAgent = (agent: Agent) => {
    toggleAgentMutation.mutate({
      agentId: agent.agentId,
      enabled: !agent.isAvailable
    });
  };

  const handleEditAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setEditMode('edit');
    setEditModalOpen(true);
  };

  const handleCreateAgent = () => {
    setSelectedAgent(null);
    setEditMode('create');
    setEditModalOpen(true);
  };

  const handleViewPerformance = (agent: Agent) => {
    setSelectedAgent(agent);
    setPerformanceModalOpen(true);
  };

  const handleDeleteAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setDeleteDialogOpen(true);
  };

  const closeModals = () => {
    setEditModalOpen(false);
    setPerformanceModalOpen(false);
    setDeleteDialogOpen(false);
    setSelectedAgent(null);
  };

  const getTierInfo = (tier: string) => {
    return AGENT_TIERS.find(t => t.value === tier) || AGENT_TIERS[0];
  };

  const getStatusIcon = (status: string) => {
    const IconComponent = STATUS_ICONS[status as keyof typeof STATUS_ICONS] || CheckCircle;
    return IconComponent;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-3" data-testid="loading-agent-registry">
        <Skeleton className="h-10 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <NyvErrorState
          title="Could not load agents"
          error={error}
          onRetry={() => refetch()}
          variant="card"
        />
      </div>
    );
  }

  const agents = agentsData?.agents || [];
  const totalCount = agentsData?.total || 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground" data-testid="page-title">Agent Gallery</h1>
          <p className="text-muted-foreground" data-testid="text-registry-summary">
            Browse {agentsData?.registryTotal ?? '—'} agents and swarm topologies — ROMA L5 · Quantum-Ready · GRPO
          </p>
          {agentsData?.counts && (
            // Chips render filter-aware counts ("FILTERED / TOTAL").
            <div className="flex flex-wrap gap-2 mt-2" data-testid="status-count-chips">
              <Badge variant="outline" className="text-xs" role="status" data-testid="chip-status-available">
                Available: <span className="ml-1 font-semibold text-green-700">{agentsData.counts.byStatus?.available ?? 0}</span>
                <span className="ml-1 text-muted-foreground">/ {agentsData.globalCounts?.byStatus?.available ?? agentsData.counts.byStatus?.available ?? 0}</span>
              </Badge>
              <Badge variant="outline" className="text-xs" role="status" data-testid="chip-status-degraded">
                Degraded: <span className="ml-1 font-semibold text-amber-700">{agentsData.counts.byStatus?.degraded ?? 0}</span>
                <span className="ml-1 text-muted-foreground">/ {agentsData.globalCounts?.byStatus?.degraded ?? agentsData.counts.byStatus?.degraded ?? 0}</span>
              </Badge>
              <Badge variant="outline" className="text-xs" role="status" data-testid="chip-status-disabled">
                Disabled: <span className="ml-1 font-semibold text-slate-700">{agentsData.counts.byStatus?.disabled ?? 0}</span>
                <span className="ml-1 text-muted-foreground">/ {agentsData.globalCounts?.byStatus?.disabled ?? agentsData.counts.byStatus?.disabled ?? 0}</span>
              </Badge>
              {['IN','UK','US','EU','SG','GC','ALL'].map(j => {
                const filteredN = agentsData.counts.byJurisdiction?.[j];
                const totalN = agentsData.globalCounts?.byJurisdiction?.[j];
                if (!filteredN && !totalN) return null;
                return (
                  <Badge key={j} variant="secondary" className="text-xs" role="status" data-testid={`chip-jurisdiction-${j}`}>
                    {j}: {filteredN ?? 0}
                    <span className="ml-1 text-muted-foreground">/ {totalN ?? filteredN ?? 0}</span>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            data-testid="button-toggle-view"
          >
            <Layers className="w-4 h-4 mr-2" />
            {viewMode === 'grid' ? 'List View' : 'Grid View'}
          </Button>
          <Button onClick={handleCreateAgent} data-testid="button-create-agent">
            <Plus className="w-4 h-4 mr-2" />
            Create Agent
          </Button>
        </div>
      </div>

      <Tabs value={galleryTab} onValueChange={(v) => setGalleryTab(v as 'fleet' | 'swarms')}>
        <TabsList>
          <TabsTrigger value="fleet">Agent fleet</TabsTrigger>
          <TabsTrigger value="swarms">Swarm topologies</TabsTrigger>
        </TabsList>

        <TabsContent value="swarms" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="w-4 h-4" />
                Swarm catalog
                {swarmData?.stats?.total != null && (
                  <Badge variant="outline" className="ml-2">{swarmData.stats.total} topologies</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {swarmsLoading && <Skeleton className="h-24 w-full" />}
              {!swarmsLoading && (swarmData?.topologies?.length ?? 0) === 0 && (
                <NyvEmptyState title="No swarm topologies" description="Probe GET /api/jrx/swarm/topologies with operator JWT or SDK key." />
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(swarmData?.topologies ?? []).map((t: any) => (
                  <div key={t.id ?? t.topologyId} className="p-3 border rounded-lg">
                    <p className="font-medium text-sm">{t.name ?? t.id}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.description ?? t.pattern ?? 'Multi-agent swarm'}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(t.jurisdictions ?? t.jurisdiction ?? ['ALL']).toString().split(',').slice(0, 3).map((j: string) => (
                        <Badge key={j} variant="secondary" className="text-[10px]">{j.trim()}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fleet" className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
            </div>
            
            <Select value={selectedTier} onValueChange={setSelectedTier} aria-label="Select option">
              <SelectTrigger className="w-40" data-testid="select-tier">
                <SelectValue placeholder="ROMA Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                {AGENT_TIERS.map(tier => (
                  <SelectItem key={tier.value} value={tier.value}>
                    {tier.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedCategory} onValueChange={setSelectedCategory} aria-label="Select option">
              <SelectTrigger className="w-40" data-testid="select-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {AGENT_CATEGORIES.map(category => (
                  <SelectItem key={category} value={category}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedStatus} onValueChange={setSelectedStatus} aria-label="Select option">
              <SelectTrigger className="w-32" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="degraded">Degraded</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction} aria-label="Select option">
              <SelectTrigger className="w-36" data-testid="select-jurisdiction">
                <SelectValue placeholder="Jurisdiction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Jurisdictions</SelectItem>
                <SelectItem value="IN">India (IN)</SelectItem>
                <SelectItem value="US">United States (US)</SelectItem>
                <SelectItem value="UK">United Kingdom (UK)</SelectItem>
                <SelectItem value="EU">European Union (EU)</SelectItem>
                <SelectItem value="SG">Singapore (SG)</SelectItem>
                <SelectItem value="GC">GCC (GC)</SelectItem>
                <SelectItem value="ALL_JURISDICTION">All-jurisdiction (ALL)</SelectItem>
              </SelectContent>
            </Select>

            {(searchTerm || selectedTier !== 'all' || selectedCategory !== 'all' || selectedStatus !== 'all' || selectedJurisdiction !== 'all') && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedTier('all');
                  setSelectedCategory('all');
                  setSelectedStatus('all');
                  setSelectedJurisdiction('all');
                }}
                data-testid="button-clear-filters"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {AGENT_TIERS.map(tier => {
          // task-336: drive these cards from the backend aggregates
          // (`counts.byRomaLevelStatus` filter-aware numerator over
          // `globalCounts.byRomaLevel` registry-wide denominator). The
          // previous `agents.filter(a => a.tier === tier.value)` derivation
          // never matched anything: the registry's `tier` field carries
          // executive/senior/specialist/associate/orchestrator, while the
          // L1–L5 values these cards label live in `romaLevel`. So every
          // card collapsed to 0/0 regardless of which page was loaded.
          const filteredTierStatus = agentsData?.counts?.byRomaLevelStatus?.[tier.value];
          const globalTierTotal = agentsData?.globalCounts?.byRomaLevel?.[tier.value];
          const hasAggregates =
            !!agentsData?.globalCounts?.byRomaLevel &&
            typeof globalTierTotal === 'number';
          // Numerator is strictly `status === 'available'` to match the
          // header "Available: N / N" chip (counts.byStatus.available).
          // Degraded agents are excluded so the cards do not overstate
          // availability.
          const availableCount = filteredTierStatus?.available ?? 0;
          const totalCount = hasAggregates ? globalTierTotal : null;
          const display = hasAggregates
            ? `${availableCount}/${totalCount}`
            : '—/—';

          return (
            <Card key={tier.value} data-testid={`tier-card-${tier.value}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{tier.label}</p>
                    <p className="text-2xl font-bold" data-testid={`tier-count-${tier.value}`}>{display}</p>
                    <p className="text-xs text-muted-foreground">{tier.description}</p>
                  </div>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tier.bgColor }}></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Agents Grid/List */}
      <div className={viewMode === 'grid' 
        ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" 
        : "space-y-4"
      }>
        {agents.map((agent: Agent) => {
          const tierInfo = getTierInfo(agent.tier);
          const StatusIcon = getStatusIcon(agent.status);
          
          return (
            <Card key={agent.agentId} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <CardTitle className="text-lg" data-testid={`text-agent-name-${agent.agentId}`}>
                        {agent.name}
                      </CardTitle>
                      <Badge 
                        variant="outline" 
                        className="font-semibold border-transparent"
                        style={{ backgroundColor: tierInfo.bgColor, color: tierInfo.textColor ?? '#FFFFFF' }}
                        data-testid={`badge-tier-${agent.agentId}`}
                       role="status">
                        {agent.tier}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2" data-testid={`text-description-${agent.agentId}`}>
                      {agent.description}
                    </p>
                    <div className="flex items-center gap-2">
                      <StatusIcon className="w-4 h-4 text-white rounded-full p-0.5" style={{ backgroundColor: STATUS_COLORS[agent.status as keyof typeof STATUS_COLORS] }} />
                      <span className="text-xs capitalize">{agent.status}</span>
                      <Badge variant="secondary" className="text-xs" role="status">
                        {agent.category}
                      </Badge>
                    </div>
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" data-testid={`button-menu-${agent.agentId}`}>
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem 
                        onClick={() => handleEditAgent(agent)}
                        data-testid={`button-edit-${agent.agentId}`}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Edit Agent
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleEditAgent(agent)}
                        data-testid={`button-configure-${agent.agentId}`}
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        Configure
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleViewPerformance(agent)}
                        data-testid={`button-monitor-${agent.agentId}`}
                      >
                        <Activity className="w-4 h-4 mr-2" />
                        Monitor Performance
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        style={{ color: '#dc2626' }}
                        onClick={() => handleDeleteAgent(agent)}
                        data-testid={`button-delete-${agent.agentId}`}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Agent
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {/* Capabilities */}
                  <div>
                    <h4 className="text-sm font-medium mb-1">Capabilities</h4>
                    <div className="flex flex-wrap gap-1">
                      {(agent.capabilities || []).slice(0, 3).map((capability, index) => (
                        <Badge key={index} variant="outline" className="text-xs" role="status">
                          {capability}
                        </Badge>
                      ))}
                      {agent.capabilities && agent.capabilities.length > 3 && (
                        <Badge variant="outline" className="text-xs" role="status">
                          +{agent.capabilities.length - 3} more
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Jurisdiction scope tags. */}
                  {agent.jurisdictionScope && agent.jurisdictionScope.length > 0 && (
                    <div data-testid={`row-jurisdiction-${agent.agentId}`}>
                      <h4 className="text-sm font-medium mb-1">Jurisdiction scope</h4>
                      <div className="flex flex-wrap gap-1">
                        {agent.jurisdictionScope.map((j, i) => (
                          <Badge key={i} variant="secondary" className="text-xs" role="status">{j}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preferred model preference. */}
                  {agent.preferredModels && agent.preferredModels.length > 0 && (
                    <div data-testid={`row-preferred-models-${agent.agentId}`}>
                      <h4 className="text-sm font-medium mb-1">Preferred models</h4>
                      <div className="flex flex-wrap gap-1">
                        {agent.preferredModels.slice(0, 3).map((m, i) => (
                          <Badge key={i} variant="outline" className="text-xs font-mono" role="status">{m}</Badge>
                        ))}
                        {agent.preferredModels.length > 3 && (
                          <Badge variant="outline" className="text-xs" role="status">
                            +{agent.preferredModels.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Last invoked + avg latency from the probe. */}
                  <div className="flex justify-between items-center text-xs text-muted-foreground" data-testid={`row-fleet-meta-${agent.agentId}`}>
                    <span>
                      Last invoked:{' '}
                      <span className="font-medium">
                        {agent.lastInvokedAt
                          ? new Date(agent.lastInvokedAt).toLocaleString()
                          : 'Never'}
                      </span>
                    </span>
                    <span>
                      Avg latency:{' '}
                      <span className="font-medium">
                        {agent.avgLatencyMs != null
                          ? `${Math.round(agent.avgLatencyMs)} ms`
                          : '—'}
                      </span>
                    </span>
                  </div>

                  {/* Version & Specialization */}
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {agent.specialization || agent.practiceArea}
                    </span>
                    <span className="text-muted-foreground">
                      v{agent.version}
                    </span>
                  </div>

                  {/* Enable/Disable Toggle */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex items-center gap-2">
                      {agent.isAvailable ? (
                        <Power className="w-4 h-4" style={{ color: '#1C7A4F' }} />
                      ) : (
                        <PowerOff className="w-4 h-4" style={{ color: '#999' }} />
                      )}
                      <span className="text-sm">
                        {agent.isAvailable ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                    
                    <Button 
                      variant={agent.isAvailable ? 'destructive' : 'default'}
                      size="sm"
                      onClick={() => handleToggleAgent(agent)}
                      disabled={toggleAgentMutation.isPending}
                      data-testid={`button-toggle-${agent.agentId}`}
                    >
                      {toggleAgentMutation.isPending ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" role="status" aria-label="Loading"></div>
                      ) : agent.isAvailable ? (
                        <>
                          <PowerOff className="w-4 h-4 mr-1" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Power className="w-4 h-4 mr-1" />
                          Enable
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalCount > 20 && (
        <div className="flex justify-center items-center gap-2 pt-4">
          <Button 
            variant="outline" 
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage + 1} of {Math.ceil(totalCount / 20)}
          </span>
          <Button 
            variant="outline" 
            size="sm"
            disabled={(currentPage + 1) * 20 >= totalCount}
            onClick={() => setCurrentPage(prev => prev + 1)}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      )}

      {/* Empty State */}
      {agents.length === 0 && (
        <NyvEmptyState
          icon={Brain}
          title="No agents found"
          description={searchTerm || selectedTier !== 'all' || selectedCategory !== 'all' || selectedStatus !== 'all'
            ? 'Try adjusting your filters to see more agents.'
            : 'Get started by creating your first agent.'}
          cta={{ label: 'Create Agent', onClick: handleCreateAgent }}
        />
      )}

        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AgentEditModal
        agentId={selectedAgent?.agentId || null}
        isOpen={editModalOpen}
        onClose={closeModals}
        mode={editMode}
      />

      <AgentPerformanceModal
        agentId={selectedAgent?.agentId || null}
        agentName={selectedAgent?.name}
        isOpen={performanceModalOpen}
        onClose={closeModals}
      />

      <AgentDeleteDialog
        agentId={selectedAgent?.agentId || null}
        agentName={selectedAgent?.name}
        isOpen={deleteDialogOpen}
        onClose={closeModals}
      />
    </div>
  );
}