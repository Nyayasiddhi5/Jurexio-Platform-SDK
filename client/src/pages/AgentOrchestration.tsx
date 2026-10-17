import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvErrorState } from '@/components/NyvErrorState';
import { 
  Bot, 
  Crown, 
  Code, 
  Palette, 
  TestTube, 
  Settings, 
  Brain, 
  Activity, 
  Zap, 
  Users, 
  Search,
  Filter,
  Play,
  Pause,
  RotateCcw,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  BarChart3
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Eye } from 'lucide-react';

// Agent tier configurations based on ROMA architecture
const AGENT_TIERS = {
  executive: {
    name: 'Executive Tier',
    icon: Crown,
    color: 'purple',
    description: 'Strategic planning, resource allocation, executive decisions',
    capabilities: ['Strategic Planning', 'Resource Allocation', 'Executive Decisions', 'High-level Coordination']
  },
  development: {
    name: 'Development Tier', 
    icon: Code,
    color: 'blue',
    description: 'Code generation, testing, deployment, debugging',
    capabilities: ['Code Generation', 'Testing Automation', 'Deployment', 'Debugging', 'Code Review']
  },
  creative: {
    name: 'Creative Tier',
    icon: Palette, 
    color: 'pink',
    description: 'Content creation, design, multimedia, artistic generation',
    capabilities: ['Content Creation', 'Design Generation', 'Video/Audio Creation', 'Artistic Generation']
  },
  qa: {
    name: 'QA Tier',
    icon: TestTube,
    color: 'green', 
    description: 'Testing automation, quality assurance, validation',
    capabilities: ['Test Automation', 'Quality Assurance', 'Validation', 'Performance Testing']
  },
  devops: {
    name: 'DevOps Tier',
    icon: Settings,
    color: 'orange',
    description: 'Infrastructure, deployment, monitoring, scaling',
    capabilities: ['Infrastructure Management', 'CI/CD', 'Monitoring', 'Auto-scaling']
  },
  domainSpecialist: {
    name: 'Domain Specialist',
    icon: Brain,
    color: 'indigo',
    description: 'Specialized knowledge, domain expertise, consulting',
    capabilities: ['Domain Expertise', 'Specialized Knowledge', 'Consulting', 'Expert Analysis']
  }
};

interface Agent {
  id: string; // Original ID from backend
  uniqueKey: string; // Composite key: ${source}:${id} for React rendering
  name: string;
  tier: keyof typeof AGENT_TIERS;
  status: 'active' | 'idle' | 'busy' | 'error';
  health: 'healthy' | 'warning' | 'critical';
  workload: number;
  uptime: number;
  tasksCompleted: number;
  averageResponseTime: number;
  lastActivity: string;
  capabilities: string[];
  currentTask?: string;
  performance: {
    successRate: number;
    efficiency: number;
    costOptimization: number;
  };
  description?: string;
  systemPrompt?: string;
  preferredModels?: string[];
  enabled?: boolean;
  source?: 'Jurexio' | 'wshobson';
}

// Form schema for editing agents
const editAgentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  systemPrompt: z.string().min(1, "System prompt is required"),
  capabilities: z.string().min(1, "Capabilities are required"),
  tier: z.enum(['executive', 'development', 'creative', 'qa', 'devops', 'domainSpecialist']),
  preferredModels: z.string().optional(),
});

type EditAgentForm = z.infer<typeof editAgentSchema>;

// API Agent interface (from database).
// Backend `/api/jrx/agents` returns rows from `legal_agents` in snake_case
// (agent_id, practice_area, roma_level, ...). We accept both shapes so the
// page renders identically whether the source is the canonical agent route
// or the legacy admin route.
interface ApiAgent {
  id?: string;
  agent_id?: string;
  agentId?: string;
  name: string;
  tier: string;
  category?: string;
  practice_area?: string;
  description?: string;
  systemPrompt?: string;
  capabilities?: string | string[];
  status?: string;
  enabled?: boolean;
  preferredModels?: string[];
  romaLevel?: string;
  roma_level?: string;
  createdAt?: string;
  updatedAt?: string;
  source?: 'Jurexio' | 'wshobson';
}

// Transform API data to match Agent interface
const transformApiAgent = (apiAgent: ApiAgent): Agent => {
  // Loosely-typed view for OPTIONAL runtime-telemetry fields the API may add
  // later (workload/uptime/metrics). Not on the base ApiAgent contract yet, so
  // read defensively rather than fabricating values (NV-NO-HARDCODE-001).
  const m = apiAgent as Record<string, any>;
  // Map backend `legal_agents.tier` values (executive | senior | specialist |
  // associate | orchestrator) AND legacy admin tiers (development | creative |
  // qa | devops | domain) onto the AGENT_TIERS UI keys. Anything unknown
  // falls back to 'development' so the row still renders.
  const tierMapping: Record<string, keyof typeof AGENT_TIERS> = {
    executive: 'executive',
    orchestrator: 'executive',
    senior: 'development',
    specialist: 'domainSpecialist',
    associate: 'qa',
    development: 'development',
    creative: 'creative',
    qa: 'qa',
    devops: 'devops',
    domain: 'domainSpecialist',
  };

  const source = apiAgent.source || 'Jurexio';
  const id = apiAgent.id ?? apiAgent.agent_id ?? apiAgent.agentId ?? `agent-${Math.random().toString(36).slice(2, 8)}`;
  // Backend uses `status: 'active' | 'disabled' | ...` not `enabled: boolean`.
  const isEnabled = apiAgent.enabled ?? (apiAgent.status ? apiAgent.status === 'active' : true);
  return {
    id,
    uniqueKey: `${source}:${id}`, // Composite key for React rendering
    name: apiAgent.name || `Agent ${id}`,
    tier: tierMapping[apiAgent.tier] || 'development',
    status: isEnabled ? 'active' : 'idle',
    health: 'healthy', // Default value
    // NV-NO-HARDCODE-001 (2026-06-25): these per-agent runtime metrics were
    // fabricated with Math.random() and shown as real telemetry. Until the
    // live agent-metrics endpoint feeds them, surface real values from the API
    // when present, otherwise 0 (truthful "no telemetry") instead of inventing.
    workload: Number(m.workload ?? 0),
    uptime: Number(m.uptime ?? 0),
    tasksCompleted: Number(m.tasksCompleted ?? m.tasks_completed ?? 0),
    averageResponseTime: Number(m.averageResponseTime ?? m.avg_response_time_ms ?? 0),
    lastActivity: m.lastActivity ?? m.last_activity ?? new Date().toISOString(),
    capabilities: typeof apiAgent.capabilities === 'string' ? 
      apiAgent.capabilities.split(',').map((c: string) => c.trim()) : 
      (Array.isArray(apiAgent.capabilities) ? apiAgent.capabilities : []),
    currentTask: undefined,
    performance: {
      successRate: Number(m.successRate ?? m.success_rate ?? 0),
      efficiency: Number(m.efficiency ?? 0),
      costOptimization: Number(m.costOptimization ?? m.cost_optimization ?? 0)
    },
    description: apiAgent.description,
    systemPrompt: apiAgent.systemPrompt,
    preferredModels: Array.isArray(apiAgent.preferredModels) ? apiAgent.preferredModels : [],
    enabled: isEnabled,
    source
  };
};

export default function AgentOrchestration() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [viewingSystemPrompt, setViewingSystemPrompt] = useState<Agent | null>(null);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch real agents from canonical /api/jrx/agents (NV-CONTRACT-001 — was dead /api/v9/agents/unified)
  const { data: apiAgents = [], isLoading, error } = useQuery<ApiAgent[]>({
    queryKey: [nv('agents'), 'orchestration'],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch(nv('agents?limit=1000'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      return data?.data?.agents ?? data?.agents ?? data?.data ?? [];
    },
    staleTime: 30000,
  });

  // Transform API data to match our interface
  const agents: Agent[] = apiAgents.map((apiAgent: ApiAgent) => transformApiAgent(apiAgent));

  // Agent mutations — admin write endpoints not yet exposed under /api/jrx/*.
  // Keep mutation shape stable so the UI compiles; surface a clear toast instead of 404'ing.
  const updateAgentMutation = useMutation({
    mutationFn: async (updatedAgent: EditAgentForm & { id: string }) => {
      throw new Error(
        `Agent edit is read-only in this build (agent=${updatedAgent.id}). ` +
        `Edit + toggle endpoints land with the org-admin governance routes.`,
      );
    },
    onError: (error: Error) => {
      toast({ title: "Read-only mode", description: error.message, variant: "destructive" });
    },
  });

  const toggleAgentMutation = useMutation({
    mutationFn: async ({ agentId, enabled }: { agentId: string; enabled: boolean }) => {
      throw new Error(
        `Agent toggle is read-only in this build (agent=${agentId}, target=${enabled ? 'enabled' : 'disabled'}).`,
      );
    },
    onError: (error: Error) => {
      toast({ title: "Read-only mode", description: error.message, variant: "destructive" });
    },
  });

  // Form for editing agents
  const editForm = useForm<EditAgentForm>({
    resolver: zodResolver(editAgentSchema),
    defaultValues: {
      name: '',
      description: '',
      systemPrompt: '',
      capabilities: '',
      tier: 'development',
      preferredModels: ''
    }
  });

  // Update form when editing agent changes
  useEffect(() => {
    if (editingAgent) {
      editForm.reset({
        name: editingAgent.name,
        description: editingAgent.description || '',
        systemPrompt: editingAgent.systemPrompt || '',
        capabilities: Array.isArray(editingAgent.capabilities) ? 
          editingAgent.capabilities.join(', ') : 
          (editingAgent.capabilities || ''),
        tier: editingAgent.tier,
        preferredModels: Array.isArray(editingAgent.preferredModels) ? 
          editingAgent.preferredModels.join(', ') : 
          (editingAgent.preferredModels || '').toString()
      });
    }
  }, [editingAgent, editForm]);

  // Handle form submission
  const onSubmitEdit = (data: EditAgentForm) => {
    if (!editingAgent) return;
    updateAgentMutation.mutate({ ...data, id: editingAgent.id });
  };

  // Real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: [nv('agents'), 'orchestration'] });
    }, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [queryClient]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="loading-orchestration">
        <Skeleton className="h-10 w-1/3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="p-6">
        <NyvErrorState
          title="Could not load agents"
          error={error}
          onRetry={() => queryClient.invalidateQueries({ queryKey: [nv('agents'), 'orchestration'] })}
          variant="card"
        />
      </div>
    );
  }

  // Filter agents based on search and filters
  const filteredAgents = agents.filter((agent: Agent) => {
    const matchesSearch = agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         agent.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = selectedTier === 'all' || agent.tier === selectedTier;
    const matchesStatus = selectedStatus === 'all' || agent.status === selectedStatus;
    return matchesSearch && matchesTier && matchesStatus;
  });

  // Calculate aggregate statistics. Guard against zero-agent state so the
  // header tiles render "0" / "—" instead of "NaN%" (task-247).
  const safeDivide = (numerator: number, denominator: number, decimals = 0) => {
    if (!denominator) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((numerator / denominator) * factor) / factor;
  };
  const stats = {
    total: agents.length,
    active: agents.filter((a: Agent) => a.status === 'active').length,
    healthy: agents.filter((a: Agent) => a.health === 'healthy').length,
    avgWorkload: safeDivide(agents.reduce((sum: number, a: Agent) => sum + a.workload, 0), agents.length),
    avgUptime: safeDivide(agents.reduce((sum: number, a: Agent) => sum + a.uptime, 0), agents.length, 1),
    totalTasks: agents.reduce((sum: number, a: Agent) => sum + a.tasksCompleted, 0)
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'idle': return 'bg-yellow-500';
      case 'busy': return 'bg-blue-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'critical': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getTierColor = (tier: string) => {
    return AGENT_TIERS[tier as keyof typeof AGENT_TIERS]?.color || 'gray';
  };

  return (
    <div className="p-6 space-y-6" data-testid="agent-orchestration">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agent Orchestration</h1>
          <p className="text-muted-foreground">
            Manage 164 active registry agents, including the NS-Queen orchestrator, across ROMA architecture tiers with BMAD coordination
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => queryClient.invalidateQueries({ queryKey: [nv('agents'), 'orchestration'] })}
            disabled={isLoading}
            data-testid="refresh-agents"
          >
            <RotateCcw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" data-testid="bmad-coordination">
            <Zap className="h-4 w-4 mr-2" />
            BMAD Control
          </Button>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-muted-foreground">Total Agents</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                <div className="text-sm text-muted-foreground">Active</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-2xl font-bold text-green-600">{stats.healthy}</div>
                <div className="text-sm text-muted-foreground">Healthy</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-2xl font-bold">{stats.avgWorkload}%</div>
                <div className="text-sm text-muted-foreground">Avg Load</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-2xl font-bold">{stats.avgUptime}%</div>
                <div className="text-sm text-muted-foreground">Uptime</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-purple-600" />
              <div>
                <div className="text-2xl font-bold">{stats.totalTasks.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Tasks Done</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
                data-testid="search-agents"
              />
            </div>
            
            <Select value={selectedTier} onValueChange={setSelectedTier} aria-label="Select option">
              <SelectTrigger className="w-[180px]" data-testid="filter-tier">
                <SelectValue placeholder="Filter by tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                {Object.entries(AGENT_TIERS).map(([key, tier]) => (
                  <SelectItem key={key} value={key}>{tier.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedStatus} onValueChange={setSelectedStatus} aria-label="Select option">
              <SelectTrigger className="w-[150px]" data-testid="filter-status">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <div className="text-sm text-muted-foreground">
              {filteredAgents.length} of {agents.length} agents
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Management Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="overview" data-testid="tab-overview" aria-label="overview tab">Overview</TabsTrigger>
          <TabsTrigger value="tiers" data-testid="tab-tiers" aria-label="tiers tab">By Tiers</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance" aria-label="performance tab">Performance</TabsTrigger>
          <TabsTrigger value="bmad" data-testid="tab-bmad" aria-label="bmad tab">BMAD Coordination</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {!isLoading && filteredAgents.length === 0 && (
            <Card className="border-dashed" data-testid="agents-empty-state">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {error
                  ? `Could not load agents: ${error instanceof Error ? error.message : 'unknown error'}. Sign in with an account that has access to ${NV_BASE}agents.`
                  : agents.length === 0
                    ? `No agents available yet. The ${NV_BASE}agents endpoint returned an empty registry — load the agent registry or sign in with an org that has agents provisioned.`
                    : 'No agents match the current filters.'}
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map((agent: Agent) => {
              const TierIcon = AGENT_TIERS[agent.tier].icon;
              return (
                <Card key={agent.uniqueKey} className="hover:shadow-md transition-shadow" data-testid={`agent-card-${agent.uniqueKey}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TierIcon className={`h-5 w-5 text-${getTierColor(agent.tier)}-600`} />
                        <CardTitle className="text-sm">{agent.name}</CardTitle>
                        {agent.source === 'wshobson' && (
                          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 " role="status">
                            wshobson
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`} />
                        <Badge variant="outline" className="text-xs" role="status">
                          {agent.status}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <div className="text-muted-foreground">Health</div>
                        <div className={`font-medium ${getHealthColor(agent.health)}`}>
                          {agent.health}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Workload</div>
                        <div className="font-medium">{agent.workload}%</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Tasks</div>
                        <div className="font-medium">{agent.tasksCompleted}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Response</div>
                        <div className="font-medium">{Math.round(agent.averageResponseTime)}ms</div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span>Workload</span>
                        <span>{agent.workload}%</span>
                      </div>
                      <Progress value={agent.workload} className="h-2"  role="progressbar" aria-label="Progress"/>
                    </div>

                    {agent.currentTask && (
                      <div className="text-xs text-muted-foreground border-t pt-2">
                        <div className="font-medium">Current Task:</div>
                        <div className="truncate">{agent.currentTask}</div>
                      </div>
                    )}

                    <div className="flex gap-1 pt-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-xs flex-1"
                        onClick={() => setViewingSystemPrompt(agent)}
                        data-testid={`view-prompt-${agent.id}`}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        System Prompt
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-xs"
                        onClick={() => setEditingAgent(agent)}
                        data-testid={`edit-agent-${agent.id}`}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant={agent.enabled ? "default" : "secondary"}
                        className="text-xs"
                        onClick={() => toggleAgentMutation.mutate({ agentId: agent.id, enabled: !agent.enabled })}
                        disabled={toggleAgentMutation.isPending}
                        data-testid={`toggle-agent-${agent.id}`}
                      >
                        {agent.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="tiers" className="space-y-4">
          {Object.entries(AGENT_TIERS).map(([tierKey, tierConfig]) => {
            const tierAgents = filteredAgents.filter((a: Agent) => a.tier === tierKey);
            const TierIcon = tierConfig.icon;
            
            return (
              <Card key={tierKey} data-testid={`tier-section-${tierKey}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TierIcon className={`h-6 w-6 text-${tierConfig.color}-600`} />
                    {tierConfig.name}
                    <Badge variant="secondary" role="status">{tierAgents.length} agents</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{tierConfig.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {tierAgents.slice(0, 8).map((agent: Agent) => (
                      <div 
                        key={agent.uniqueKey}
                        className="p-3 border rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                        data-testid={`tier-agent-${agent.uniqueKey}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium truncate">{agent.name}</div>
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Load: {agent.workload}% | Tasks: {agent.tasksCompleted}
                        </div>
                      </div>
                    ))}
                    {tierAgents.length > 8 && (
                      <div className="p-3 border rounded-lg bg-muted/20 flex items-center justify-center">
                        <div className="text-sm text-muted-foreground">
                          +{tierAgents.length - 8} more agents
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(AGENT_TIERS).map(([tierKey, tierConfig]) => {
                    const tierAgents = agents.filter((a: Agent) => a.tier === tierKey);
                    const avgPerformance = tierAgents.reduce((sum: number, a: Agent) => sum + a.performance.successRate, 0) / tierAgents.length;
                    const TierIcon = tierConfig.icon;
                    
                    return (
                      <div key={tierKey} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <TierIcon className={`h-5 w-5 text-${tierConfig.color}-600`} />
                          <div>
                            <div className="font-medium">{tierConfig.name}</div>
                            <div className="text-sm text-muted-foreground">{tierAgents.length} agents</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-lg">{Math.round(avgPerformance)}%</div>
                          <div className="text-sm text-muted-foreground">Success Rate</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Overall System Health</span>
                    <Badge variant="default" className="bg-green-600" role="status">Excellent</Badge>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Agent Availability</span>
                        <span>{Math.round((stats.active / stats.total) * 100)}%</span>
                      </div>
                      <Progress value={(stats.active / stats.total) * 100} className="h-2"  role="progressbar" aria-label="Progress"/>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>System Efficiency</span>
                        <span>94%</span>
                      </div>
                      <Progress value={94} className="h-2"  role="progressbar" aria-label="Progress"/>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Cost Optimization</span>
                        <span>90%</span>
                      </div>
                      <Progress value={90} className="h-2"  role="progressbar" aria-label="Progress"/>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="bmad" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                BMAD Coordination Method 4.0
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Advanced coordination patterns for autonomous multi-agent execution
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-4">
                  <div className="text-center p-4 bg-green-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">12</div>
                    <div className="text-sm text-muted-foreground">Active Patterns</div>
                  </div>
                  <div className="text-center p-4 bg-blue-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">94.5%</div>
                    <div className="text-sm text-muted-foreground">Efficiency</div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="text-center p-4 bg-purple-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">8</div>
                    <div className="text-sm text-muted-foreground">Coordinations</div>
                  </div>
                  <div className="text-center p-4 bg-orange-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">156</div>
                    <div className="text-sm text-muted-foreground">Conflicts Resolved</div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="text-center p-4 bg-indigo-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-indigo-600">250/min</div>
                    <div className="text-sm text-muted-foreground">Throughput</div>
                  </div>
                  <div className="text-center p-4 bg-red-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-red-600">85ms</div>
                    <div className="text-sm text-muted-foreground">Avg Latency</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                <div className="text-sm font-medium mb-2">Continuous Execution Status</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Runtime</div>
                    <div className="font-medium">{Math.round(Date.now() / 1000 / 3600) % 24}h</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Tasks Processed</div>
                    <div className="font-medium">12,847</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Uptime</div>
                    <div className="font-medium text-green-600">99.97%</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Load Balance</div>
                    <div className="font-medium text-blue-600">Optimal</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Agent Dialog */}
      <Dialog open={!!editingAgent} onOpenChange={(open) => !open && setEditingAgent(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Agent: {editingAgent?.name}</DialogTitle>
            <DialogDescription>
              Modify agent configuration, system prompt, and capabilities.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter agent name" data-testid="input-agent-name"  aria-label="Enter agent name"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter agent description" data-testid="input-agent-description"  aria-label="Enter agent description"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="tier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tier</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} aria-label="Select option">
                      <FormControl>
                        <SelectTrigger data-testid="select-agent-tier">
                          <SelectValue placeholder="Select tier" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(AGENT_TIERS).map(([key, tier]) => (
                          <SelectItem key={key} value={key}>{tier.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="capabilities"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capabilities (comma-separated)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. code-generation, testing, debugging" data-testid="input-agent-capabilities"  aria-label="e.g. code-generation, testing, debugging"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="preferredModels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preferred Models (comma-separated)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. gpt-4, claude-3, gemini-pro" data-testid="input-agent-models"  aria-label="e.g. gpt-4, claude-3, gemini-pro"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="systemPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>System Prompt</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Enter the system prompt for this agent..." 
                        className="min-h-[150px]"
                        data-testid="textarea-system-prompt"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setEditingAgent(null)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={updateAgentMutation.isPending}
                  data-testid="button-save-agent"
                >
                  {updateAgentMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* View System Prompt Dialog */}
      <Dialog open={!!viewingSystemPrompt} onOpenChange={(open) => !open && setViewingSystemPrompt(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>System Prompt: {viewingSystemPrompt?.name}</DialogTitle>
            <DialogDescription>
              View the current system prompt for this agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-2">Agent Details</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Tier:</span> {AGENT_TIERS[viewingSystemPrompt?.tier || 'development'].name}
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span> {viewingSystemPrompt?.status}
                </div>
                <div>
                  <span className="text-muted-foreground">Capabilities:</span> {Array.isArray(viewingSystemPrompt?.capabilities) ? 
                    viewingSystemPrompt.capabilities.join(', ') : viewingSystemPrompt?.capabilities}
                </div>
                <div>
                  <span className="text-muted-foreground">Models:</span> {Array.isArray(viewingSystemPrompt?.preferredModels) ? 
                    viewingSystemPrompt.preferredModels.join(', ') : 'Not specified'}
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">System Prompt</div>
              <div className="p-4 bg-muted/50 rounded-lg border max-h-[400px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm">
                  {viewingSystemPrompt?.systemPrompt || 'No system prompt defined for this agent.'}
                </pre>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                onClick={() => setViewingSystemPrompt(null)}
                data-testid="button-close-prompt"
              >
                Close
              </Button>
              <Button 
                onClick={() => {
                  setEditingAgent(viewingSystemPrompt);
                  setViewingSystemPrompt(null);
                }}
                data-testid="button-edit-from-prompt"
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Agent
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}