import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  Bot, Settings, Zap, Shield, Search, Save, ChevronRight, Brain, Sparkles, 
  Users, Globe, Layers, Network, ToggleLeft, AlertTriangle, Lock, Languages,
  Target, Workflow, MessageSquare, Cpu, TrendingUp, CircleDot, Check, X
} from 'lucide-react';

interface EnhancedAgentConfig {
  agentId: string;
  name: string;
  tier: string;
  romaLevel: string;
  systemPrompt: any;
  modelSelection: any;
  groupAssignment: any;
  protocols: any;
  guardrails: any;
  operationMode: any;
  languages: string[];
  outcomeTypes: string[];
}

export default function EnhancedAgentConfigPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<EnhancedAgentConfig | null>(null);
  const [activeConfigTab, setActiveConfigTab] = useState('model');

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/nyayavigya-admin/enhanced-configs/stats']
  });

  const { data: configsData, isLoading: configsLoading, refetch } = useQuery({
    queryKey: ['/api/nyayavigya-admin/enhanced-configs', { tier: tierFilter !== 'all' ? tierFilter : undefined }]
  });

  const { data: protocolOptions } = useQuery({
    queryKey: ['/api/nyayavigya-admin/protocol-options']
  });

  const { data: languageOptions } = useQuery({
    queryKey: ['/api/nyayavigya-admin/language-options']
  });

  const { data: guardrailsOptions } = useQuery({
    queryKey: ['/api/nyayavigya-admin/guardrails-options']
  });

  const { data: operationModeOptions } = useQuery({
    queryKey: ['/api/nyayavigya-admin/operation-mode-options']
  });

  const { data: modelModeOptions } = useQuery({
    queryKey: ['/api/nyayavigya-admin/model-selection-modes']
  });

  const updateModelSelectionMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      apiRequest(`/api/nyayavigya-admin/enhanced-configs/${agentId}/model-selection`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya-admin/enhanced-configs'] });
      toast({ title: 'Model Selection Updated', description: 'Agent model configuration saved.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const updateGroupAssignmentMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      apiRequest(`/api/nyayavigya-admin/enhanced-configs/${agentId}/group-assignment`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya-admin/enhanced-configs'] });
      toast({ title: 'Group Assignment Updated', description: 'Agent group configuration saved.' });
    }
  });

  const updateProtocolsMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      apiRequest(`/api/nyayavigya-admin/enhanced-configs/${agentId}/protocols`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya-admin/enhanced-configs'] });
      toast({ title: 'Protocols Updated', description: 'Agent protocol configuration saved.' });
    }
  });

  const updateGuardrailsMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      apiRequest(`/api/nyayavigya-admin/enhanced-configs/${agentId}/guardrails`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya-admin/enhanced-configs'] });
      toast({ title: 'Guardrails Updated', description: 'Agent guardrails configuration saved.' });
    }
  });

  const updateOperationModeMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: any }) =>
      apiRequest(`/api/nyayavigya-admin/enhanced-configs/${agentId}/operation-mode`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/nyayavigya-admin/enhanced-configs'] });
      toast({ title: 'Operation Mode Updated', description: 'Agent operation mode saved.' });
    }
  });

  const stats = statsData?.data || { total: 0, byTier: {}, byRomaLevel: {}, byGroup: {}, byModelMode: {}, byOperationMode: {} };
  const configs = configsData?.data?.configs || [];
  const protocols = protocolOptions?.data?.protocols || [];
  const languages = languageOptions?.data?.supportedLanguages || [];
  const guardrailsOpts = guardrailsOptions?.data || {};
  const operationModes = operationModeOptions?.data?.modes || [];
  const modelModes = modelModeOptions?.data?.modes || [];

  const filteredConfigs = configs.filter((c: EnhancedAgentConfig) => {
    const matchesSearch = c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         c.agentId?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = groupFilter === 'all' || c.groupAssignment?.groupId === groupFilter;
    return matchesSearch && matchesGroup;
  });

  const sectorGroups = [
    'sector-financial', 'sector-marketing', 'sector-sales', 'sector-content',
    'sector-logistics', 'sector-hr', 'sector-technology', 'sector-legal',
    'sector-operations', 'sector-customer-success', 'sector-product', 'sector-research'
  ];

  const getTierColor = (tier: string) => {
    const colors: Record<string, string> = {
      executive: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      domain: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      creative: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
      development: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      qa: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      devops: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200'
    };
    return colors[tier] || 'bg-gray-100 text-gray-800';
  };

  const getRomaColor = (level: string) => {
    const colors: Record<string, string> = {
      L4: 'bg-indigo-600 text-white',
      L3: 'bg-indigo-500 text-white',
      L2: 'bg-indigo-400 text-white',
      L1: 'bg-indigo-300 text-indigo-900'
    };
    return colors[level] || 'bg-gray-200 text-gray-800';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card data-testid="card-enhanced-agents-total">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Configured Agents</CardTitle>
            <Bot className="w-4 h-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">Full enhanced configuration</p>
          </CardContent>
        </Card>

        <Card data-testid="card-auto-mode-agents">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Auto Mode</CardTitle>
            <Sparkles className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.byModelMode?.auto || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Intelligent routing</p>
          </CardContent>
        </Card>

        <Card data-testid="card-autonomous-agents">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Autonomous</CardTitle>
            <Zap className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.byOperationMode?.autonomous || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Self-directed L3/L4</p>
          </CardContent>
        </Card>

        <Card data-testid="card-group-agents">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Group Mode</CardTitle>
            <Users className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.byOperationMode?.group || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Collaborative L2/L3</p>
          </CardContent>
        </Card>

        <Card data-testid="card-sector-groups">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Sector Groups</CardTitle>
            <Layers className="w-4 h-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{Object.keys(stats.byGroup || {}).length}</div>
            <p className="text-xs text-muted-foreground mt-1">Active industry groups</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                Enhanced Agent Configuration
              </CardTitle>
              <CardDescription>
                Configure system prompts, model selection, groups, protocols, guardrails, and operation modes
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={tierFilter} onValueChange={(v) => { setTierFilter(v); refetch(); }}>
                <SelectTrigger className="w-36" data-testid="select-tier-filter">
                  <SelectValue placeholder="Filter by tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  <SelectItem value="executive">Executive</SelectItem>
                  <SelectItem value="domain">Domain</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="creative">Creative</SelectItem>
                  <SelectItem value="qa">QA</SelectItem>
                  <SelectItem value="devops">DevOps</SelectItem>
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-40" data-testid="select-group-filter">
                  <SelectValue placeholder="Filter by group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {sectorGroups.map(g => (
                    <SelectItem key={g} value={g}>{g.replace('sector-', '').replace('-', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                  data-testid="input-search-enhanced-agents"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {configsLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {filteredConfigs.slice(0, 50).map((config: EnhancedAgentConfig) => (
                  <div
                    key={config.agentId}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedAgent(config)}
                    data-testid={`card-enhanced-agent-${config.agentId}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="font-medium">{config.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className={`text-xs ${getTierColor(config.tier)}`}>
                            {config.tier}
                          </Badge>
                          <Badge className={`text-xs ${getRomaColor(config.romaLevel)}`}>
                            {config.romaLevel}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {config.modelSelection?.mode || 'auto'}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {config.operationMode?.defaultMode || 'autonomous'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground">
                        {config.groupAssignment?.groupId?.replace('sector-', '') || 'unassigned'}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedAgent} onOpenChange={() => setSelectedAgent(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              Enhanced Configuration: {selectedAgent?.name}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              <Badge className={getTierColor(selectedAgent?.tier || '')}>{selectedAgent?.tier}</Badge>
              <Badge className={getRomaColor(selectedAgent?.romaLevel || '')}>{selectedAgent?.romaLevel}</Badge>
              <span className="text-muted-foreground">•</span>
              <span>Configure model routing, groups, protocols, guardrails, and operation modes</span>
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeConfigTab} onValueChange={setActiveConfigTab} className="mt-4">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="model" className="flex items-center gap-1">
                <Cpu className="w-4 h-4" />
                Model
              </TabsTrigger>
              <TabsTrigger value="group" className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                Group
              </TabsTrigger>
              <TabsTrigger value="protocols" className="flex items-center gap-1">
                <Network className="w-4 h-4" />
                Protocols
              </TabsTrigger>
              <TabsTrigger value="guardrails" className="flex items-center gap-1">
                <Shield className="w-4 h-4" />
                Guardrails
              </TabsTrigger>
              <TabsTrigger value="operation" className="flex items-center gap-1">
                <Workflow className="w-4 h-4" />
                Operation
              </TabsTrigger>
            </TabsList>

            <TabsContent value="model" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Model Selection Configuration
                  </CardTitle>
                  <CardDescription>
                    Configure how this agent selects LLM models for tasks
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Selection Mode</Label>
                      <Select 
                        defaultValue={selectedAgent?.modelSelection?.mode || 'auto'}
                        onValueChange={(mode) => {
                          if (selectedAgent) {
                            updateModelSelectionMutation.mutate({
                              agentId: selectedAgent.agentId,
                              data: { mode }
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="mt-2" data-testid="select-model-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto (Intelligent Routing)</SelectItem>
                          <SelectItem value="defined">Defined (Per Task Type)</SelectItem>
                          <SelectItem value="selected">Selected (Fixed Model)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Auto: Jurexio selects best model by task • Defined: Admin specifies per task • Selected: Use fixed model
                      </p>
                    </div>

                    <div>
                      <Label>Cost Priority</Label>
                      <Select 
                        defaultValue={selectedAgent?.modelSelection?.costPriority || 'balanced'}
                        onValueChange={(costPriority) => {
                          if (selectedAgent) {
                            updateModelSelectionMutation.mutate({
                              agentId: selectedAgent.agentId,
                              data: { costPriority }
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="mt-2" data-testid="select-cost-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lowest">Lowest Cost</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="quality-first">Quality First</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedAgent?.modelSelection?.mode === 'selected' && (
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                      <div>
                        <Label>Selected Provider</Label>
                        <Select defaultValue={selectedAgent?.modelSelection?.selectedProvider || ''}>
                          <SelectTrigger className="mt-2">
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI</SelectItem>
                            <SelectItem value="anthropic">Anthropic</SelectItem>
                            <SelectItem value="google">Google</SelectItem>
                            <SelectItem value="groq">Groq</SelectItem>
                            <SelectItem value="deepseek">DeepSeek</SelectItem>
                            <SelectItem value="together">Together AI</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Selected Model</Label>
                        <Input 
                          defaultValue={selectedAgent?.modelSelection?.selectedModel || ''}
                          placeholder="e.g., gpt-4.1, claude-opus-4-6"
                          className="mt-2"
                        />
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Monthly Budget Tracking
                    </h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Budget Limit</p>
                        <p className="font-medium">${selectedAgent?.modelSelection?.budgetLimit?.toFixed(2) || 'No limit'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Current Usage</p>
                        <p className="font-medium">${selectedAgent?.modelSelection?.currentUsage?.toFixed(2) || '0.00'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Remaining</p>
                        <p className="font-medium text-green-600">
                          ${((selectedAgent?.modelSelection?.budgetLimit || 0) - (selectedAgent?.modelSelection?.currentUsage || 0)).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="group" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Group Assignment & Hierarchy
                  </CardTitle>
                  <CardDescription>
                    Assign agent to sector groups and define hierarchy relationships
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Sector Group</Label>
                      <Select 
                        defaultValue={selectedAgent?.groupAssignment?.groupId || ''}
                        onValueChange={(groupId) => {
                          if (selectedAgent) {
                            updateGroupAssignmentMutation.mutate({
                              agentId: selectedAgent.agentId,
                              data: { groupId }
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="mt-2" data-testid="select-sector-group">
                          <SelectValue placeholder="Select group" />
                        </SelectTrigger>
                        <SelectContent>
                          {sectorGroups.map(g => (
                            <SelectItem key={g} value={g}>
                              {g.replace('sector-', '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Role in Group</Label>
                      <Select 
                        defaultValue={selectedAgent?.groupAssignment?.role || 'member'}
                        onValueChange={(role) => {
                          if (selectedAgent) {
                            updateGroupAssignmentMutation.mutate({
                              agentId: selectedAgent.agentId,
                              data: { role }
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="mt-2" data-testid="select-group-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="head">Head (L4 Orchestrator)</SelectItem>
                          <SelectItem value="specialist">Specialist (L3 Expert)</SelectItem>
                          <SelectItem value="support">Support (L2 Assistant)</SelectItem>
                          <SelectItem value="member">Member (L1-L2 Contributor)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Hierarchy Level</Label>
                      <Input 
                        type="number"
                        min={1}
                        max={5}
                        defaultValue={selectedAgent?.groupAssignment?.hierarchyLevel || 3}
                        className="mt-2"
                      />
                      <p className="text-xs text-muted-foreground mt-1">1 = Top executive, 5 = Entry level</p>
                    </div>
                    <div>
                      <Label>Reports To (Agent ID)</Label>
                      <Input 
                        defaultValue={selectedAgent?.groupAssignment?.reportsTo || ''}
                        placeholder="e.g., cfo-head"
                        className="mt-2"
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Coordination Settings</Label>
                    <div className="grid grid-cols-3 gap-4 mt-2">
                      <div className="flex items-center space-x-2">
                        <Switch 
                          id="can-delegate"
                          defaultChecked={selectedAgent?.groupAssignment?.coordination?.canDelegate ?? true}
                        />
                        <Label htmlFor="can-delegate" className="text-sm">Can Delegate</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch 
                          id="can-escalate"
                          defaultChecked={selectedAgent?.groupAssignment?.coordination?.canEscalate ?? true}
                        />
                        <Label htmlFor="can-escalate" className="text-sm">Can Escalate</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch 
                          id="can-collaborate"
                          defaultChecked={selectedAgent?.groupAssignment?.coordination?.canCollaborate ?? true}
                        />
                        <Label htmlFor="can-collaborate" className="text-sm">Can Collaborate</Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="protocols" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Network className="w-4 h-4" />
                    Communication Protocols
                  </CardTitle>
                  <CardDescription>
                    Configure A2A, MCP, AG-UI, and OpenAgent protocol settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {protocols.map((protocol: any) => (
                      <div key={protocol.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{protocol.id.toUpperCase()}</Badge>
                            <span className="font-medium">{protocol.name}</span>
                          </div>
                          <Switch 
                            defaultChecked={selectedAgent?.protocols?.[protocol.id]?.enabled ?? protocol.id === 'a2a'}
                            onCheckedChange={(enabled) => {
                              if (selectedAgent) {
                                updateProtocolsMutation.mutate({
                                  agentId: selectedAgent.agentId,
                                  data: { [protocol.id]: { enabled } }
                                });
                              }
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{protocol.description}</p>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  <div>
                    <Label>Messaging Configuration</Label>
                    <div className="grid grid-cols-3 gap-4 mt-2">
                      <div>
                        <Label className="text-sm text-muted-foreground">Message Format</Label>
                        <Select defaultValue={selectedAgent?.protocols?.messaging?.format || 'structured'}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="structured">Structured JSON</SelectItem>
                            <SelectItem value="natural">Natural Language</SelectItem>
                            <SelectItem value="hybrid">Hybrid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm text-muted-foreground">Retry Policy</Label>
                        <Select defaultValue={selectedAgent?.protocols?.messaging?.retryPolicy || 'exponential'}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Retry</SelectItem>
                            <SelectItem value="linear">Linear Backoff</SelectItem>
                            <SelectItem value="exponential">Exponential Backoff</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm text-muted-foreground">Timeout (seconds)</Label>
                        <Input 
                          type="number"
                          defaultValue={selectedAgent?.protocols?.messaging?.timeout || 30}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="guardrails" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Safety Guardrails
                  </CardTitle>
                  <CardDescription>
                    Configure Parlant compliance, anti-hallucination, security, and content filtering
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <CircleDot className="w-4 h-4 text-blue-600" />
                          <span className="font-medium">Parlant Compliance</span>
                        </div>
                        <Switch 
                          defaultChecked={selectedAgent?.guardrails?.parlantCompliance ?? true}
                          onCheckedChange={(parlantCompliance) => {
                            if (selectedAgent) {
                              updateGuardrailsMutation.mutate({
                                agentId: selectedAgent.agentId,
                                data: { parlantCompliance }
                              });
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span className="font-medium">Anti-Hallucination</span>
                        </div>
                        <Switch 
                          defaultChecked={selectedAgent?.guardrails?.antiHallucination ?? true}
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-red-600" />
                          <span className="font-medium">PII Protection</span>
                        </div>
                        <Switch 
                          defaultChecked={selectedAgent?.guardrails?.piiProtection ?? true}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label>Content Filtering Level</Label>
                        <Select defaultValue={selectedAgent?.guardrails?.contentFiltering || 'standard'}>
                          <SelectTrigger className="mt-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="minimal">Minimal</SelectItem>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="strict">Strict</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label>Fact-Checking Level</Label>
                        <Select defaultValue={selectedAgent?.guardrails?.factCheckingLevel || 'standard'}>
                          <SelectTrigger className="mt-2">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="basic">Basic</SelectItem>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="rigorous">Rigorous</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label>Quality Threshold (%)</Label>
                        <Input 
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={selectedAgent?.guardrails?.qualityThreshold || 85}
                          className="mt-2"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Custom Security Rules (JSON)</Label>
                    <Textarea
                      defaultValue={JSON.stringify(selectedAgent?.guardrails?.securityRules || [], null, 2)}
                      className="mt-2 font-mono text-sm min-h-[100px]"
                      placeholder='[{"rule": "no-external-apis", "action": "block"}]'
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="operation" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Workflow className="w-4 h-4" />
                    Operation Mode & Availability
                  </CardTitle>
                  <CardDescription>
                    Configure autonomous, standalone, group, or supervised operation modes
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Default Operation Mode</Label>
                      <Select 
                        defaultValue={selectedAgent?.operationMode?.defaultMode || 'autonomous'}
                        onValueChange={(defaultMode) => {
                          if (selectedAgent) {
                            updateOperationModeMutation.mutate({
                              agentId: selectedAgent.agentId,
                              data: { defaultMode }
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="mt-2" data-testid="select-operation-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operationModes.map((mode: any) => (
                            <SelectItem key={mode.id} value={mode.id}>
                              {mode.name} ({mode.romaLevels})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Priority (1-10)</Label>
                      <Input 
                        type="number"
                        min={1}
                        max={10}
                        defaultValue={selectedAgent?.operationMode?.priority || 5}
                        className="mt-2"
                        onChange={(e) => {
                          if (selectedAgent) {
                            updateOperationModeMutation.mutate({
                              agentId: selectedAgent.agentId,
                              data: { priority: parseInt(e.target.value) }
                            });
                          }
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">Higher = more priority in task queue</p>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4" />
                      Allowed Operation Modes
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {['autonomous', 'standalone', 'group', 'supervised'].map(mode => (
                        <div key={mode} className="flex items-center space-x-2 p-2 border rounded">
                          <Switch 
                            id={`mode-${mode}`}
                            defaultChecked={selectedAgent?.operationMode?.allowedModes?.includes(mode) ?? true}
                          />
                          <Label htmlFor={`mode-${mode}`} className="text-sm capitalize">{mode}</Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        Task Availability
                      </Label>
                      <div className="flex items-center space-x-2 mt-2">
                        <Switch 
                          id="available-all-tasks"
                          defaultChecked={selectedAgent?.operationMode?.availability?.forAllTasks ?? true}
                        />
                        <Label htmlFor="available-all-tasks" className="text-sm">Available for all tasks</Label>
                      </div>
                    </div>

                    <div>
                      <Label className="flex items-center gap-2">
                        <Languages className="w-4 h-4" />
                        Supported Languages
                      </Label>
                      <div className="text-sm text-muted-foreground mt-2">
                        {selectedAgent?.languages?.length || 0} languages configured
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setSelectedAgent(null)} data-testid="button-close-config">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
