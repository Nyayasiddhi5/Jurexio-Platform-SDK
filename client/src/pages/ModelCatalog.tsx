import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Activity, DollarSign, Zap, Globe, Eye, Settings, Filter, Search, Plus, BarChart3, TrendingUp, Clock, Shield, Database, Sparkles, Inbox } from 'lucide-react';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { NyvEmptyState } from '@/components/NyvEmptyState';

import { nv } from '@/lib/jrx-api-paths';
interface LLMProvider {
  providerId: string;
  name: string;
  description: string;
  type: string;
  models: any[];
  status: string;
  costTier: string;
  qualityScore: number;
  latencyMs: number;
  supportedRegions: string[];
  capabilities: any;
  rateLimit: any;
  pricing: any;
  documentation: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreativeModel {
  modelId: string;
  name: string;
  description: string;
  provider: string;
  modelType: string;
  capabilities: string[];
  supportedFormats: string[];
  maxResolution: string;
  costPerMinute: number;
  averageProcessingTime: number;
  qualityRating: number;
  isActive: boolean;
}

interface ProviderMetrics {
  providerId: string;
  modelId?: string;
  metricType: string;
  value: number;
  timestamp: string;
}

export default function ModelCatalog() {
  const [activeTab, setActiveTab] = useState('providers');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [addProviderDialogOpen, setAddProviderDialogOpen] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: '',
    description: '',
    type: 'language-model',
    costTier: 'medium',
    documentation: ''
  });
  const { toast } = useToast();

  // Fetch from canonical /api/jrx/models. Response envelope is
  // `{ success, data: { models: [...], stats: {...} } }`; queryClient
  // auto-unwraps {success,data} so we get `{ models, stats }`.
  const { data: catalog = { models: [], stats: null }, isLoading: providersLoading, isError: catalogError, refetch: refetchCatalog } = useQuery<{
    models: any[];
    stats: any | null;
  }>({
    queryKey: [nv('models'), { search: searchTerm }],
    queryFn: async () => {
      const r: any = await apiRequest(nv('models'));
      // /api/jrx/models returns { success, data: rows[] }. apiRequest unwraps the
      // envelope, then re-wraps the array as { data: rows[] }, so the live shape
      // here is `r.data === rows[]`. Keep the other branches for resilience.
      const models =
        (Array.isArray(r?.models) && r.models) ||
        (Array.isArray(r?.data?.models) && r.data.models) ||
        (Array.isArray(r?.data) && r.data) ||
        (Array.isArray(r) && r) ||
        [];
      const stats = r?.stats ?? r?.data?.stats ?? null;
      return { models, stats };
    },
    staleTime: 30000,
    // Keep the last good catalog visible during refetch/backoff so a transient
    // 429 doesn't blank the grid into the "no entries" empty-state (D-6).
    placeholderData: (prev: any) => prev,
  });
  const rawModels: any[] = catalog.models ?? [];
  const stats: any = catalog.stats ?? {};

  // Provider readiness matrix — NV-PROVIDER-READINESS-001. Reads the new
  // GET /api/jrx/models/providers surface (allowed + inactive providers, live
  // status, env-var NAME requirements, model counts). Degrades to [] on error.
  interface ProviderReadiness {
    id: string;
    status: 'allowed' | 'inactive';
    available: boolean;
    configured: boolean;
    requiresEnv: string[];
    modelCount: number;
  }
  const { data: readiness = { providers: [] as ProviderReadiness[], summary: null as any, notes: null as any } } = useQuery<{
    providers: ProviderReadiness[];
    summary: any;
    notes: any;
  }>({
    queryKey: [nv('models/providers')],
    queryFn: async () => {
      const r: any = await apiRequest(nv('models/providers'));
      const data = r?.data ?? r ?? {};
      return {
        providers: Array.isArray(data.providers) ? data.providers : [],
        summary: data.summary ?? null,
        notes: data.notes ?? null,
      };
    },
    staleTime: 30000,
    placeholderData: (prev: any) => prev,
  });
  const readinessProviders: ProviderReadiness[] = readiness.providers ?? [];

  // Treat vision/speech/embedding models AND any model exposing
  // capabilities.supportsVision / supportsAudio as the "creative" surface.
  // Everything else is a language model and feeds the providers tab.
  const isCreative = (m: any): boolean => {
    const t = String(m?.type ?? '').toLowerCase();
    if (t === 'vision' || t === 'speech' || t === 'embedding' || t === 'image' || t === 'video' || t === 'audio') return true;
    const c = m?.capabilities ?? {};
    return Boolean(c.supportsVision || c.supportsAudio);
  };
  const creativeRaw = rawModels.filter(isCreative);
  const llmRaw = rawModels.filter((m) => !isCreative(m));

  // Build LLMProvider[] view-model from non-creative models. Aggregate avg
  // quality (cap at 5), avg latency, dominant cost tier, and exposed regions.
  const providers: LLMProvider[] = (() => {
    const byProvider = new Map<string, any>();
    for (const m of llmRaw) {
      // /api/jrx/models emits snake_case (provider_id, provider_name, is_active);
      // keep the camelCase fallbacks for any in-process/registry-shaped callers.
      const pid = m.providerId || m.provider || m.provider_id || 'unknown';
      const pname = m.provider_name || m.providerName || pid;
      const inactive = m.isActive === false || m.is_active === false;
      if (!byProvider.has(pid)) {
        byProvider.set(pid, {
          id: pid,
          providerId: pid,
          name: pname,
          description: `${pname} models`,
          type: 'language-model',
          status: inactive ? 'offline' : 'active',
          costTier: 'medium',
          documentation: '',
          modelCount: 0,
          isActive: !inactive,
          qualityScore: 0,
          latencyMs: 0,
          avgLatency: 0,
          models: [] as string[],
          supportedRegions: new Set<string>(),
          _qSum: 0, _qN: 0, _lSum: 0, _lN: 0,
          _tierCounts: {} as Record<string, number>,
        });
      }
      const entry = byProvider.get(pid)!;
      entry.modelCount += 1;
      const label = m.name || m.displayName || m.model_id || m.id;
      if (label) entry.models.push(label);
      const q = Number(m?.routing?.qualityScore ?? m?.qualityScore ?? 0);
      if (Number.isFinite(q) && q > 0) { entry._qSum += q; entry._qN += 1; }
      const l = Number(m?.health?.timeoutMs ?? m?.latencyMs ?? 0);
      if (Number.isFinite(l) && l > 0) { entry._lSum += l; entry._lN += 1; }
      const inCost = Number(m?.cost?.costPer1kInputTokens ?? m?.input_cost_per_1k ?? 0);
      const tier = m?.costTier
        || (inCost === 0 ? 'free'
          : inCost < 0.001 ? 'low'
          : inCost < 0.01  ? 'medium' : 'high');
      entry._tierCounts[tier] = (entry._tierCounts[tier] ?? 0) + 1;
      for (const j of (m?.capabilities?.supportedJurisdictions ?? [])) entry.supportedRegions.add(String(j));
    }
    return Array.from(byProvider.values()).map((e: any) => {
      const dominantTier = Object.entries(e._tierCounts).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] || 'medium';
      return {
        ...e,
        qualityScore: e._qN ? Math.min(5, Math.round((e._qSum / e._qN) * 10) / 10) : 0,
        latencyMs: e._lN ? Math.round(e._lSum / e._lN) : 0,
        avgLatency: e._lN ? Math.round(e._lSum / e._lN) : 0,
        costTier: dominantTier,
        supportedRegions: Array.from(e.supportedRegions as Set<string>),
      };
    });
  })();

  // Creative models — sourced from /api/jrx/models filtered to vision/speech.
  const creativeModels: CreativeModel[] = creativeRaw.map((m: any) => ({
    modelId: String(m.id ?? m.modelId ?? m.providerModelId ?? m.displayName ?? 'model'),
    name: String(m.displayName ?? m.id ?? 'Model'),
    description: String(m.description ?? `${m.provider ?? 'unknown'} ${m.type ?? 'creative'} model`),
    provider: String(m.provider ?? m.providerId ?? 'unknown'),
    modelType: String(m.type ?? 'vision'),
    capabilities: [
      m?.capabilities?.supportsVision && 'vision',
      m?.capabilities?.supportsAudio && 'audio',
      m?.capabilities?.supportsStreaming && 'streaming',
      m?.capabilities?.supportsToolCalling && 'tools',
    ].filter(Boolean) as string[],
    supportedFormats: [],
    maxResolution: m?.capabilities?.maxOutputTokens ? `${m.capabilities.maxOutputTokens} tok` : 'n/a',
    costPerMinute: Number(m?.cost?.costPer1kOutputTokens ?? 0),
    averageProcessingTime: Number(m?.health?.timeoutMs ?? 0),
    qualityRating: Math.min(5, Math.round(Number(m?.routing?.qualityScore ?? 0) * 10) / 10),
    isActive: m?.isActive !== false,
  }));
  const modelsLoading = providersLoading;

  // Provider metrics — live catalog stats from GET /api/jrx/models (telemetry via /analytics when wired).
  const metricsLoading = false;

  // All write mutations — admin endpoints not yet exposed under /api/jrx/*.
  const toggleProviderMutation = useMutation({
    mutationFn: async ({ providerId }: { providerId: string; isActive: boolean }) => {
      throw new Error(`Provider toggle is read-only (provider=${providerId}, admin write endpoint pending).`);
    },
    onError: (e: Error) => toast({ title: 'Read-only mode', description: e.message, variant: 'destructive' }),
  });

  const toggleModelMutation = useMutation({
    mutationFn: async ({ modelId }: { modelId: string; isActive: boolean }) => {
      throw new Error(`Model toggle is read-only (model=${modelId}, admin write endpoint pending).`);
    },
    onError: (e: Error) => toast({ title: 'Read-only mode', description: e.message, variant: 'destructive' }),
  });

  const createProviderMutation = useMutation({
    mutationFn: async (_providerData: typeof newProvider) => {
      throw new Error('Provider creation is read-only (admin write endpoint pending).');
    },
    onSuccess: () => {
      setAddProviderDialogOpen(false);
      setNewProvider({
        name: '',
        description: '',
        type: 'language-model',
        costTier: 'medium',
        documentation: ''
      });
      toast({ title: 'Provider created successfully' });
    },
    onError: (e: Error) => {
      toast({ title: 'Read-only mode', description: e.message, variant: 'destructive' });
    }
  });

  const handleCreateProvider = () => {
    if (!newProvider.name || !newProvider.description) {
      toast({ title: 'Please fill in required fields', variant: 'destructive' });
      return;
    }
    createProviderMutation.mutate(newProvider);
  };

  const filteredProviders = providers.filter(provider => {
    const matchesSearch = provider.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         provider.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedType === 'all' || provider.type === selectedType;
    const matchesStatus = selectedStatus === 'all' || provider.status === selectedStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const filteredCreativeModels = creativeModels.filter(model => {
    return model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           model.provider.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getStatusStyle = (status: string): React.CSSProperties => {
    switch (status) {
      case 'active': return { backgroundColor: '#1C7A4F' };
      case 'degraded': return { backgroundColor: '#C7B15B' };
      case 'offline': return { backgroundColor: '#cc3333' };
      default: return { backgroundColor: '#999' };
    }
  };

  const getCostTierStyle = (tier: string): React.CSSProperties => {
    switch (tier) {
      case 'free': return { backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F' };
      case 'low': return { backgroundColor: 'rgba(10, 42, 102, 0.15)', color: '#152448' };
      case 'medium': return { backgroundColor: 'rgba(212, 160, 23, 0.15)', color: '#C7B15B' };
      case 'high': return { backgroundColor: 'rgba(204, 51, 51, 0.15)', color: '#cc3333' };
      default: return { backgroundColor: 'rgba(153, 153, 153, 0.15)', color: '#666' };
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: '#152448' }}>Model Catalog</h1>
          <p className="mt-2" style={{ color: '#666' }}>
            Manage 25 wired LLM providers (15 allowed + 10 promotable), 500+ models, and creative AI capabilities
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" data-testid="button-refresh">
            <Activity className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={addProviderDialogOpen} onOpenChange={setAddProviderDialogOpen}>
            <DialogTrigger asChild aria-label="Open dialog">
              <Button size="sm" data-testid="button-add-provider">
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" data-testid="dialog-add-provider">
              <DialogHeader>
                <DialogTitle>Add LLM Provider</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="provider-name">Provider Name *</Label>
                  <Input
                    id="provider-name"
                    placeholder="e.g., OpenAI, Anthropic"
                    value={newProvider.name}
                    onChange={(e) => setNewProvider(prev => ({ ...prev, name: e.target.value }))}
                    data-testid="input-provider-name"
                  />
                </div>
                
                <div>
                  <Label htmlFor="provider-description">Description *</Label>
                  <Textarea
                    id="provider-description"
                    placeholder="Brief description of the provider's capabilities"
                    value={newProvider.description}
                    onChange={(e) => setNewProvider(prev => ({ ...prev, description: e.target.value }))}
                    data-testid="textarea-provider-description"
                  />
                </div>
                
                <div>
                  <Label htmlFor="provider-type">Provider Type</Label>
                  <Select 
                    value={newProvider.type} 
                    onValueChange={(value) => setNewProvider(prev => ({ ...prev, type: value }))}
                  >
                    <SelectTrigger data-testid="select-provider-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="language-model">Language Model</SelectItem>
                      <SelectItem value="image-generation">Image Generation</SelectItem>
                      <SelectItem value="speech-synthesis">Speech Synthesis</SelectItem>
                      <SelectItem value="multimodal">Multimodal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="provider-cost-tier">Cost Tier</Label>
                  <Select 
                    value={newProvider.costTier} 
                    onValueChange={(value) => setNewProvider(prev => ({ ...prev, costTier: value }))}
                  >
                    <SelectTrigger data-testid="select-cost-tier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="low">Low Cost</SelectItem>
                      <SelectItem value="medium">Medium Cost</SelectItem>
                      <SelectItem value="high">High Cost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="provider-documentation">Documentation URL</Label>
                  <Input
                    id="provider-documentation"
                    placeholder="https://provider-docs.com/api"
                    value={newProvider.documentation}
                    onChange={(e) => setNewProvider(prev => ({ ...prev, documentation: e.target.value }))}
                    data-testid="input-provider-documentation"
                  />
                </div>
                
                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={() => setAddProviderDialogOpen(false)}
                    variant="outline"
                    className="flex-1"
                    data-testid="button-cancel-provider"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateProvider}
                    disabled={createProviderMutation.isPending || !newProvider.name || !newProvider.description}
                    className="flex-1"
                    data-testid="button-create-provider"
                  >
                    {createProviderMutation.isPending ? 'Creating...' : 'Create Provider'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4" style={{ color: '#999' }} />
                <Input
                  placeholder="Search providers, models, or capabilities..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Select value={selectedType} onValueChange={setSelectedType} aria-label="Select option">
              <SelectTrigger className="w-48" data-testid="select-type">
                <SelectValue placeholder="Provider Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="llm">Language Models</SelectItem>
                <SelectItem value="vision">Vision</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="multimodal">Multimodal</SelectItem>
                <SelectItem value="creative">Creative</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedStatus} onValueChange={setSelectedStatus} aria-label="Select option">
              <SelectTrigger className="w-48" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="degraded">Degraded</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5" aria-label="Navigation tabs">
          <TabsTrigger value="providers" data-testid="tab-providers" aria-label="providers tab">LLM Providers</TabsTrigger>
          <TabsTrigger value="readiness" data-testid="tab-readiness" aria-label="readiness tab">Readiness</TabsTrigger>
          <TabsTrigger value="creative" data-testid="tab-creative" aria-label="creative tab">Creative Models</TabsTrigger>
          <TabsTrigger value="metrics" data-testid="tab-metrics" aria-label="metrics tab">Performance</TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-overview" aria-label="overview tab">Overview</TabsTrigger>
        </TabsList>

        {/* LLM Providers Tab */}
        <TabsContent value="providers" className="space-y-4">
          {providersLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-4 rounded w-3/4 mb-4" style={{ backgroundColor: '#ddd' }}></div>
                    <div className="h-3 rounded w-1/2 mb-2" style={{ backgroundColor: '#ddd' }}></div>
                    <div className="h-3 rounded w-2/3" style={{ backgroundColor: '#ddd' }}></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredProviders.length === 0 ? (
            <Card data-testid="empty-providers"><CardContent className="p-2">
              <NyvEmptyState
                icon={Database}
                title={
                  rawModels.length === 0 && catalogError
                    ? 'Model registry temporarily unreachable'
                    : rawModels.length === 0
                      ? 'No models registered'
                      : 'No providers match your filters'}
                description={
                  rawModels.length === 0 && catalogError
                    ? 'The catalog request failed (likely rate-limited). It will retry automatically — or retry now.'
                    : rawModels.length === 0
                      ? 'The dynamic model registry returned no entries. Check that /api/jrx/models is reachable and that providers are configured.'
                      : 'Try clearing the search box or switching the type/status filters back to "All".'}
                size="md"
                variant="card"
                cta={(rawModels.length === 0 && catalogError)
                  ? { label: 'Retry', onClick: () => { void refetchCatalog(); } }
                  : undefined}
              />
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProviders.map((provider) => (
                <Card key={provider.providerId} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={getStatusStyle(provider.status)}></div>
                        <CardTitle className="text-lg" data-testid={`text-provider-${provider.providerId}`}>
                          {provider.name}
                        </CardTitle>
                      </div>
                      <Switch
                        checked={provider.isActive}
                        onCheckedChange={(checked) => 
                          toggleProviderMutation.mutate({ providerId: provider.providerId, isActive: checked })
                        }
                        data-testid={`switch-provider-${provider.providerId}`}
                      />
                    </div>
                    <p className="text-sm" style={{ color: '#666' }} data-testid={`text-description-${provider.providerId}`}>
                      {provider.description}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Type:</span>
                        <Badge variant="outline" data-testid={`badge-type-${provider.providerId}`} role="status">
                          {provider.type}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Cost Tier:</span>
                        <Badge style={getCostTierStyle(provider.costTier)} data-testid={`badge-cost-${provider.providerId}`}>
                          {provider.costTier}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Quality:</span>
                        <div className="flex items-center gap-1">
                          <span data-testid={`text-quality-${provider.providerId}`}>{provider.qualityScore}/5</span>
                          <div className="flex">
                            {[...Array(5)].map((_, i) => (
                              <div
                                key={i}
                                className="w-2 h-2 rounded-full mr-1"
                                style={{ backgroundColor: i < provider.qualityScore ? '#C7B15B' : '#ddd' }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Latency:</span>
                        <span className="flex items-center gap-1" data-testid={`text-latency-${provider.providerId}`}>
                          <Clock className="h-3 w-3" />
                          {provider.latencyMs}ms
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Models:</span>
                        <span data-testid={`text-models-count-${provider.providerId}`}>
                          {provider.models?.length || 0} available
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Regions:</span>
                        <span data-testid={`text-regions-${provider.providerId}`}>
                          {provider.supportedRegions?.length || 0} regions
                        </span>
                      </div>
                    </div>
                    <Separator className="my-4" />
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="sm" data-testid={`button-view-${provider.providerId}`}>
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      <Button variant="outline" size="sm" data-testid={`button-config-${provider.providerId}`}>
                        <Settings className="h-4 w-4 mr-2" />
                        Configure
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Provider Readiness Tab — NV-PROVIDER-READINESS-001 */}
        <TabsContent value="readiness" className="space-y-4">
          {readiness.summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold" style={{ color: '#152448' }} data-testid="text-readiness-total">{readiness.summary.total}</div>
                <div className="text-xs" style={{ color: '#666' }}>Providers wired</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold" style={{ color: '#1C7A4F' }} data-testid="text-readiness-live">{readiness.summary.live}</div>
                <div className="text-xs" style={{ color: '#666' }}>Live (key/flag set)</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold" style={{ color: '#152448' }}>{readiness.summary.allowed}</div>
                <div className="text-xs" style={{ color: '#666' }}>Allowed (routable)</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold" style={{ color: '#999' }}>{readiness.summary.inactive}</div>
                <div className="text-xs" style={{ color: '#666' }}>Inactive (promotable)</div>
              </CardContent></Card>
            </div>
          )}
          {readiness.notes?.bedrock && (
            <Card style={{ borderColor: '#C7B15B' }}>
              <CardContent className="p-4 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5" style={{ color: '#C7B15B' }} />
                <div className="text-sm" style={{ color: '#666' }}>
                  <span className="font-semibold" style={{ color: '#152448' }}>AWS Bedrock: </span>
                  {readiness.notes.bedrock}
                </div>
              </CardContent>
            </Card>
          )}
          {readinessProviders.length === 0 ? (
            <Card><CardContent className="p-2">
              <NyvEmptyState
                icon={Database}
                title="Provider readiness unavailable"
                description="GET /api/jrx/models/providers returned no data. Confirm the gateway is reachable."
                size="md"
                variant="card"
              />
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {readinessProviders.map((p) => (
                <Card key={p.id} className="hover:shadow-lg transition-shadow" data-testid={`readiness-${p.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.available ? '#1C7A4F' : (p.status === 'allowed' ? '#C7B15B' : '#999') }} />
                        <CardTitle className="text-base">{p.id}</CardTitle>
                      </div>
                      <Badge style={p.available
                        ? { backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F' }
                        : { backgroundColor: 'rgba(153, 153, 153, 0.15)', color: '#666' }}>
                        {p.available ? 'LIVE' : 'READY'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: '#666' }}>Routing:</span>
                      <Badge variant="outline">{p.status === 'allowed' ? 'allowed' : 'inactive'}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: '#666' }}>Catalog models:</span>
                      <span>{p.modelCount}</span>
                    </div>
                    <div className="text-sm">
                      <span style={{ color: '#666' }}>Requires env:</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.requiresEnv.length === 0
                          ? <span className="text-xs" style={{ color: '#1C7A4F' }}>none (always-on)</span>
                          : p.requiresEnv.map((k) => (
                            <Badge key={k} variant="outline" className="text-[10px] font-mono">{k}</Badge>
                          ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Creative Models Tab */}
        <TabsContent value="creative" className="space-y-4">
          {modelsLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="h-4 rounded w-3/4 mb-4" style={{ backgroundColor: '#ddd' }}></div>
                    <div className="h-3 rounded w-1/2 mb-2" style={{ backgroundColor: '#ddd' }}></div>
                    <div className="h-3 rounded w-2/3" style={{ backgroundColor: '#ddd' }}></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredCreativeModels.length === 0 ? (
            <Card data-testid="empty-creative"><CardContent className="p-2">
              <NyvEmptyState
                icon={Sparkles}
                title={creativeRaw.length === 0 ? 'No creative models registered' : 'No creative models match your filters'}
                description={creativeRaw.length === 0
                  ? 'No vision/speech/embedding models are exposed under /api/jrx/models. Register vision/audio-capable models in the dynamic model registry to see them here.'
                  : 'Try clearing the search box.'}
                size="md"
                variant="card"
              />
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredCreativeModels.map((model) => (
                <Card key={model.modelId} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg" data-testid={`text-model-${model.modelId}`}>
                        {model.name}
                      </CardTitle>
                      <Switch
                        checked={model.isActive}
                        onCheckedChange={(checked) => 
                          toggleModelMutation.mutate({ modelId: model.modelId, isActive: checked })
                        }
                        data-testid={`switch-model-${model.modelId}`}
                      />
                    </div>
                    <p className="text-sm" style={{ color: '#666' }} data-testid={`text-model-description-${model.modelId}`}>
                      {model.description}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Provider:</span>
                        <Badge variant="outline" data-testid={`badge-provider-${model.modelId}`} role="status">
                          {model.provider}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Type:</span>
                        <Badge data-testid={`badge-model-type-${model.modelId}`}>
                          {model.modelType}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Quality:</span>
                        <div className="flex items-center gap-1">
                          <span data-testid={`text-model-quality-${model.modelId}`}>{model.qualityRating}/5</span>
                          <div className="flex">
                            {[...Array(5)].map((_, i) => (
                              <div
                                key={i}
                                className="w-2 h-2 rounded-full mr-1"
                                style={{ backgroundColor: i < model.qualityRating ? '#C7B15B' : '#ddd' }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Cost:</span>
                        <span data-testid={`text-cost-${model.modelId}`}>
                          ${model.costPerMinute}/min
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Max Resolution:</span>
                        <span data-testid={`text-resolution-${model.modelId}`}>
                          {model.maxResolution}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span style={{ color: '#666' }}>Capabilities:</span>
                        <span data-testid={`text-capabilities-${model.modelId}`}>
                          {model.capabilities?.length || 0} features
                        </span>
                      </div>
                    </div>
                    <Separator className="my-4" />
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="sm" data-testid={`button-test-${model.modelId}`}>
                        <Zap className="h-4 w-4 mr-2" />
                        Test Model
                      </Button>
                      <Button variant="outline" size="sm" data-testid={`button-model-config-${model.modelId}`}>
                        <Settings className="h-4 w-4 mr-2" />
                        Configure
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Performance Metrics Tab */}
        <TabsContent value="metrics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: '#666' }}>
                  Active Providers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" style={{ color: '#1C7A4F' }} data-testid="text-active-providers">
                  {providers.filter(p => p.isActive).length}
                </div>
                <p className="text-xs" style={{ color: '#999' }}>of {providers.length} total</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: '#666' }}>
                  Avg Response Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" style={{ color: '#152448' }} data-testid="text-avg-response">
                  {Math.round(providers.reduce((acc, p) => acc + p.latencyMs, 0) / providers.length || 0)}ms
                </div>
                <p className="text-xs" style={{ color: '#999' }}>registry timeout proxy (not live telemetry)</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: '#666' }}>
                  Total Models
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" style={{ color: '#152448' }} data-testid="text-total-models">
                  {Number(stats?.totalModels ?? rawModels.length)}
                </div>
                <p className="text-xs" style={{ color: '#999' }}>
                  {Number(stats?.enabledModels ?? rawModels.filter((m) => m.isActive !== false).length)} enabled
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium" style={{ color: '#666' }}>
                  Cost Efficiency
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" style={{ color: '#C7B15B' }} data-testid="text-cost-efficiency">
                  {((providers.filter(p => p.costTier === 'low').length / providers.length) * 100).toFixed(0)}%
                </div>
                <p className="text-xs" style={{ color: '#999' }}>low-cost providers</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Provider Performance Dashboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!stats?.byProvider && !stats?.byType) ? (
                <NyvEmptyState
                  icon={BarChart3}
                  title="No registry stats available"
                  description="The /api/jrx/models endpoint did not return a stats payload. Provider/type distribution will appear here once the registry exposes stats."
                  size="md"
                  variant="inline"
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="stats-distribution">
                  <div>
                    <div className="text-sm font-semibold mb-3" style={{ color: '#152448' }}>By Provider</div>
                    <div className="space-y-2">
                      {Object.entries(stats?.byProvider ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, v]) => {
                        const max = Math.max(...Object.values(stats?.byProvider ?? { _: 1 }).map((n) => Number(n)));
                        const pct = max > 0 ? (Number(v) / max) * 100 : 0;
                        return (
                          <div key={k} data-testid={`stat-provider-${k}`}>
                            <div className="flex items-center justify-between text-xs">
                              <span style={{ color: '#666' }}>{k}</span>
                              <span style={{ color: '#152448', fontWeight: 600 }}>{String(v)}</span>
                            </div>
                            <div className="h-2 rounded mt-1" style={{ backgroundColor: '#eee' }}>
                              <div className="h-2 rounded" style={{ width: `${pct}%`, backgroundColor: '#152448' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-3" style={{ color: '#1C7A4F' }}>By Type</div>
                    <div className="space-y-2">
                      {Object.entries(stats?.byType ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, v]) => {
                        const max = Math.max(...Object.values(stats?.byType ?? { _: 1 }).map((n) => Number(n)));
                        const pct = max > 0 ? (Number(v) / max) * 100 : 0;
                        return (
                          <div key={k} data-testid={`stat-type-${k}`}>
                            <div className="flex items-center justify-between text-xs">
                              <span style={{ color: '#666' }}>{k}</span>
                              <span style={{ color: '#1C7A4F', fontWeight: 600 }}>{String(v)}</span>
                            </div>
                            <div className="h-2 rounded mt-1" style={{ backgroundColor: '#eee' }}>
                              <div className="h-2 rounded" style={{ width: `${pct}%`, backgroundColor: '#1C7A4F' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Global Provider Network
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-sm" style={{ color: '#666' }}>
                    Coverage across major regions with optimized routing
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 rounded-lg" style={{ backgroundColor: 'rgba(10, 42, 102, 0.08)' }}>
                      <div className="text-2xl font-bold" style={{ color: '#152448' }} data-testid="text-us-providers">
                        {providers.filter(p => p.supportedRegions?.includes('us-east-1')).length}
                      </div>
                      <div className="text-sm" style={{ color: '#666' }}>US Providers</div>
                    </div>
                    <div className="text-center p-4 rounded-lg" style={{ backgroundColor: 'rgba(28, 122, 79, 0.08)' }}>
                      <div className="text-2xl font-bold" style={{ color: '#1C7A4F' }} data-testid="text-eu-providers">
                        {providers.filter(p => p.supportedRegions?.includes('eu-west-1')).length}
                      </div>
                      <div className="text-sm" style={{ color: '#666' }}>EU Providers</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security & Compliance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">SOC 2 Compliant</span>
                    <Badge variant="outline" style={{ backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F' }} role="status">
                      ✓ Verified
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">GDPR Compliant</span>
                    <Badge variant="outline" style={{ backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F' }} role="status">
                      ✓ Verified
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Data Encryption</span>
                    <Badge variant="outline" style={{ backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F' }} role="status">
                      ✓ AES-256
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">API Security</span>
                    <Badge variant="outline" style={{ backgroundColor: 'rgba(28, 122, 79, 0.15)', color: '#1C7A4F' }} role="status">
                      ✓ OAuth 2.0
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Platform Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold" style={{ color: '#152448' }} data-testid="text-provider-count">
                    {providers.length}
                  </div>
                  <div className="text-sm" style={{ color: '#666' }}>LLM Providers</div>
                  <div className="text-xs mt-1" style={{ color: '#999' }}>
                    Including OpenAI, Anthropic, Google, and more
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold" style={{ color: '#1C7A4F' }} data-testid="text-model-count">
                    {providers.reduce((acc, p) => acc + (p.models?.length || 0), 0)}
                  </div>
                  <div className="text-sm" style={{ color: '#666' }}>Available Models</div>
                  <div className="text-xs mt-1" style={{ color: '#999' }}>
                    Text, vision, audio, and multimodal
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold" style={{ color: '#152448' }} data-testid="text-creative-count">
                    {creativeModels.length}
                  </div>
                  <div className="text-sm" style={{ color: '#666' }}>Creative Models</div>
                  <div className="text-xs mt-1" style={{ color: '#999' }}>
                    Video, music, and image generation
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}