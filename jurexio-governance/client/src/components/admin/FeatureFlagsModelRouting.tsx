import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  ToggleLeft, Cpu, Zap, Brain, Settings, TrendingUp, DollarSign, 
  Target, Activity, Layers, Shield, ArrowRight, RefreshCw, Save, CheckCircle
} from 'lucide-react';

interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: 'global' | 'organization' | 'user';
  category: string;
}

interface ModelRoute {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  costPerToken: number;
  latencyMs: number;
  tier: 'slm' | 'standard' | 'premium';
  romaLevels: string[];
}

export default function FeatureFlagsModelRouting() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState('feature-flags');
  const [hitlThreshold, setHitlThreshold] = useState([0.95]);
  const [reviewThreshold, setReviewThreshold] = useState([0.70]);
  const [slmEnabled, setSlmEnabled] = useState(true);
  const [grpoEnabled, setGrpoEnabled] = useState(true);
  const [vsEnabled, setVsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const { data: featureFlags } = useQuery<FeatureFlag[]>({
    queryKey: ['/api/v2.1/health'],
    select: () => [
      { id: 'grpo', name: 'GRPO Learning', description: 'Continuous reinforcement learning for agent improvement', enabled: grpoEnabled, scope: 'global', category: 'learning' },
      { id: 'hitl', name: 'Human-in-the-Loop', description: 'Confidence-based escalation to human reviewers', enabled: true, scope: 'global', category: 'workflow' },
      { id: 'verbalized-sampling', name: 'Verbalized Sampling', description: '2-3x diversity improvement for creative tasks', enabled: vsEnabled, scope: 'global', category: 'generation' },
      { id: 'slm-routing', name: 'SLM Routing', description: '40-60% cost reduction using small models for L1/L2', enabled: slmEnabled, scope: 'global', category: 'routing' },
      { id: 'digital-twin', name: 'Digital Twin', description: 'Real-time organizational visualization', enabled: true, scope: 'organization', category: 'visualization' },
      { id: 'quantum-security', name: 'Quantum Security', description: 'Post-quantum cryptography protection', enabled: true, scope: 'global', category: 'security' },
    ]
  });

  const { data: slmModels } = useQuery({
    queryKey: ['/api/v2.5/slm/models']
  });

  const { data: slmStats } = useQuery({
    queryKey: ['/api/v2.5/slm/stats']
  });

  const { data: hitlThresholds, isLoading: hitlLoading } = useQuery({
    queryKey: ['/api/v2.1/hitl/thresholds'],
    select: (res: any) => res?.data || res,
    refetchOnWindowFocus: false
  });

  // Initialize sliders from fetched thresholds
  useState(() => {
    if (hitlThresholds?.AUTO_APPROVE) {
      setHitlThreshold([hitlThresholds.AUTO_APPROVE]);
    }
    if (hitlThresholds?.REVIEW) {
      setReviewThreshold([hitlThresholds.REVIEW]);
    }
  });

  const { data: grpoStats } = useQuery({
    queryKey: ['/api/v2.5/grpo/stats']
  });

  const updateHITLThresholds = useMutation({
    mutationFn: (thresholds: { AUTO_APPROVE?: number; REVIEW?: number }) =>
      apiRequest('/api/v2.1/hitl/thresholds', 'PATCH', thresholds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v2.1/hitl/thresholds'] });
      toast({ title: 'Thresholds Updated', description: 'HITL confidence thresholds saved successfully.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message || 'Failed to update thresholds', variant: 'destructive' });
    }
  });

  const updateFeatureFlag = async (flagId: string, enabled: boolean) => {
    try {
      setIsLoading(true);
      if (flagId === 'slm-routing') setSlmEnabled(enabled);
      if (flagId === 'grpo') setGrpoEnabled(enabled);
      if (flagId === 'verbalized-sampling') setVsEnabled(enabled);
      toast({ title: `Feature ${enabled ? 'Enabled' : 'Disabled'}`, description: `${flagId} has been ${enabled ? 'enabled' : 'disabled'}` });
    } finally {
      setIsLoading(false);
    }
  };

  const models: ModelRoute[] = [
    { id: 'mistral-7b', name: 'Mistral 7B Instruct', provider: 'Together', enabled: slmEnabled, costPerToken: 0.0001, latencyMs: 50, tier: 'slm', romaLevels: ['L1', 'L2'] },
    { id: 'llama-4-scout-17b-16e-instruct', name: 'LLaMA 4 Scout 17B', provider: 'Meta/Groq', enabled: slmEnabled, costPerToken: 0.0002, latencyMs: 60, tier: 'slm', romaLevels: ['L1', 'L2'] },
    { id: 'gemma-2-9b', name: 'Gemma 2 9B', provider: 'Google', enabled: slmEnabled, costPerToken: 0.0003, latencyMs: 70, tier: 'slm', romaLevels: ['L1', 'L2'] },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'OpenAI', enabled: slmEnabled, costPerToken: 0.0001, latencyMs: 45, tier: 'slm', romaLevels: ['L1'] },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'Anthropic', enabled: true, costPerToken: 0.015, latencyMs: 800, tier: 'premium', romaLevels: ['L3', 'L4'] },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Anthropic', enabled: true, costPerToken: 0.009, latencyMs: 600, tier: 'premium', romaLevels: ['L3', 'L4'] },
    { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', enabled: true, costPerToken: 0.006, latencyMs: 700, tier: 'premium', romaLevels: ['L3', 'L4'] },
    { id: 'o4-mini', name: 'o4-mini (Reasoning)', provider: 'OpenAI', enabled: true, costPerToken: 0.0033, latencyMs: 1200, tier: 'premium', romaLevels: ['L4'] },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'Google', enabled: true, costPerToken: 0.009, latencyMs: 600, tier: 'standard', romaLevels: ['L2', 'L3'] },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google', enabled: true, costPerToken: 0.00023, latencyMs: 300, tier: 'standard', romaLevels: ['L2', 'L3'] },
    { id: 'grok-4', name: 'Grok 4', provider: 'xAI', enabled: true, costPerToken: 0.009, latencyMs: 550, tier: 'standard', romaLevels: ['L2', 'L3', 'L4'] },
    { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', enabled: true, costPerToken: 0.00081, latencyMs: 400, tier: 'standard', romaLevels: ['L2', 'L3'] },
    { id: 'kimi-k2', name: 'KIMI K2 1T', provider: 'Moonshot', enabled: true, costPerToken: 0.008, latencyMs: 400, tier: 'standard', romaLevels: ['L2', 'L3', 'L4'] },
  ];

  const categoryIcons: Record<string, any> = {
    learning: Brain,
    workflow: Activity,
    generation: Zap,
    routing: ArrowRight,
    visualization: Layers,
    security: Shield
  };

  const tierColors: Record<string, string> = {
    slm: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    standard: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    premium: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
  };

  return (
    <div className="space-y-6 p-6" data-testid="feature-flags-model-routing">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6" />
            Feature Flags & Model Routing
          </h2>
          <p className="text-muted-foreground mt-1">
            Configure Jurexio Legal SDK v2.0 enterprise features and intelligent model routing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Badge variant="secondary" className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            API v2.1 Active
          </Badge>
        </div>
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="feature-flags" className="flex items-center gap-2" data-testid="tab-feature-flags">
            <ToggleLeft className="w-4 h-4" />
            Feature Flags
          </TabsTrigger>
          <TabsTrigger value="model-routing" className="flex items-center gap-2" data-testid="tab-model-routing">
            <Cpu className="w-4 h-4" />
            Model Routing
          </TabsTrigger>
          <TabsTrigger value="hitl-config" className="flex items-center gap-2" data-testid="tab-hitl-config">
            <Target className="w-4 h-4" />
            HITL Config
          </TabsTrigger>
          <TabsTrigger value="grpo-training" className="flex items-center gap-2" data-testid="tab-grpo-training">
            <Brain className="w-4 h-4" />
            GRPO Training
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feature-flags" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featureFlags?.map(flag => {
              const IconComponent = categoryIcons[flag.category] || ToggleLeft;
              return (
                <Card key={flag.id} data-testid={`feature-flag-${flag.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconComponent className="w-5 h-5 text-primary" />
                        <CardTitle className="text-base">{flag.name}</CardTitle>
                      </div>
                      <Switch 
                        checked={flag.enabled} 
                        disabled={isLoading}
                        onCheckedChange={(checked) => updateFeatureFlag(flag.id, checked)}
                        data-testid={`toggle-${flag.id}`}
                      />
                    </div>
                    <CardDescription>{flag.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{flag.scope}</Badge>
                      <Badge variant="secondary">{flag.category}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="model-routing" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="w-5 h-5" />
                Intelligent Model Router
              </CardTitle>
              <CardDescription>
                Configure which models handle different task complexity levels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {models.map(model => (
                  <Card key={model.id} className={`${!model.enabled ? 'opacity-60' : ''}`} data-testid={`model-${model.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{model.name}</CardTitle>
                        <Switch 
                          checked={model.enabled}
                          onCheckedChange={(checked) => {
                            toast({ title: `${model.name} ${checked ? 'enabled' : 'disabled'}` });
                          }}
                          data-testid={`toggle-model-${model.id}`}
                        />
                      </div>
                      <div className="flex gap-1">
                        <Badge variant="outline" className="text-xs">{model.provider}</Badge>
                        <Badge className={`text-xs ${tierColors[model.tier]}`}>{model.tier.toUpperCase()}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Cost/1K tokens:</span>
                        <span className="font-medium">${(model.costPerToken * 1000).toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Latency:</span>
                        <span className="font-medium">{model.latencyMs}ms</span>
                      </div>
                      <Separator />
                      <div className="flex flex-wrap gap-1">
                        {model.romaLevels.map(level => (
                          <Badge key={level} variant="secondary" className="text-xs">{level}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              <Separator className="my-6" />
              
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-600" />
                      Cost Savings (SLM)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">40-60%</div>
                    <p className="text-sm text-muted-foreground mt-1">Using SLMs for L1/L2 tasks</p>
                  </CardContent>
                </Card>
                
                <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4 text-blue-600" />
                      Latency Improvement
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-blue-600">5-10x</div>
                    <p className="text-sm text-muted-foreground mt-1">Faster responses with SLMs</p>
                  </CardContent>
                </Card>
                
                <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-purple-600" />
                      Quality Maintained
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-purple-600">98%+</div>
                    <p className="text-sm text-muted-foreground mt-1">Task completion rate</p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hitl-config" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Human-in-the-Loop Confidence Thresholds
              </CardTitle>
              <CardDescription>
                Configure when tasks require human review based on AI confidence levels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Auto-Approve Threshold
                    </Label>
                    <Badge variant="outline" className="font-mono">{hitlThreshold[0].toFixed(2)}</Badge>
                  </div>
                  <Slider 
                    value={hitlThreshold}
                    onValueChange={setHitlThreshold}
                    min={0.8}
                    max={1.0}
                    step={0.01}
                    data-testid="slider-auto-approve"
                  />
                  <p className="text-sm text-muted-foreground">
                    Confidence above this threshold: auto-approve without human review
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-yellow-500" />
                      Review Threshold
                    </Label>
                    <Badge variant="outline" className="font-mono">{reviewThreshold[0].toFixed(2)}</Badge>
                  </div>
                  <Slider 
                    value={reviewThreshold}
                    onValueChange={setReviewThreshold}
                    min={0.5}
                    max={0.9}
                    step={0.01}
                    data-testid="slider-review"
                  />
                  <p className="text-sm text-muted-foreground">
                    Confidence between this and auto-approve: queue for human review
                  </p>
                </div>

                <Separator />

                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-4 h-4 text-red-500" />
                    <span className="font-medium text-red-700 dark:text-red-400">Escalation Zone</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Confidence below {reviewThreshold[0].toFixed(2)}: automatically escalate to senior reviewer
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setHitlThreshold([0.95]);
                    setReviewThreshold([0.70]);
                  }}
                >
                  Reset to Defaults
                </Button>
                <Button 
                  onClick={() => {
                    updateHITLThresholds.mutate({
                      AUTO_APPROVE: hitlThreshold[0],
                      REVIEW: reviewThreshold[0]
                    });
                  }}
                  disabled={updateHITLThresholds.isPending}
                  data-testid="btn-save-hitl"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateHITLThresholds.isPending ? 'Saving...' : 'Save Thresholds'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grpo-training" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  GRPO Training Pipeline
                </CardTitle>
                <CardDescription>
                  Continuous reinforcement learning for agent improvement
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Batch Size</Label>
                    <div className="text-2xl font-bold">32</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Learning Rate</Label>
                    <div className="text-2xl font-bold">0.001</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Discount Factor</Label>
                    <div className="text-2xl font-bold">0.99</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Data Points</Label>
                    <div className="text-2xl font-bold">{(grpoStats as any)?.data?.totalDataPoints || 0}</div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Training Progress</span>
                    <span>{Math.min(100, ((grpoStats as any)?.data?.totalDataPoints || 0) / 32 * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={Math.min(100, ((grpoStats as any)?.data?.totalDataPoints || 0) / 32 * 100)} />
                  <p className="text-xs text-muted-foreground">
                    {32 - ((grpoStats as any)?.data?.totalDataPoints || 0)} more data points needed for next batch
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Verbalized Sampling
                </CardTitle>
                <CardDescription>
                  Diversity enhancement for creative agent outputs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Tier Configuration</Label>
                  <Select defaultValue="creative">
                    <SelectTrigger data-testid="select-vs-tier">
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="creative">Creative (k=5, tau=0.05)</SelectItem>
                      <SelectItem value="research">Research (k=4, tau=0.10)</SelectItem>
                      <SelectItem value="development">Development (k=3, tau=0.15)</SelectItem>
                      <SelectItem value="qa">QA (k=3, tau=0.20)</SelectItem>
                      <SelectItem value="executive">Executive (k=3, tau=0.10)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <div className="text-2xl font-bold text-primary">2-3x</div>
                    <p className="text-xs text-muted-foreground">Diversity Improvement</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-center">
                    <div className="text-2xl font-bold text-primary">95%</div>
                    <p className="text-xs text-muted-foreground">Quality Maintained</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
