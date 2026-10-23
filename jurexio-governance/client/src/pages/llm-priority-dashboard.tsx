import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Activity, Zap, DollarSign, AlertTriangle, CheckCircle, XCircle, RefreshCw, BarChart3, Shield } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { nv, p } from '@/lib/jrx-api-paths';
const TIER_COLORS: Record<number, string> = {
  1: 'bg-purple-100 text-purple-800',
  2: 'bg-blue-100 text-blue-800',
  3: 'bg-green-100 text-green-800',
  4: 'bg-gray-100 text-gray-700',
};

const TIER_LABELS: Record<number, string> = {
  1: 'Premium',
  2: 'Standard',
  3: 'Cost-Optimized',
  4: 'SLM (In-house)',
};

const STATUS_ICON = {
  healthy: <CheckCircle className="h-4 w-4 text-green-500" />,
  degraded: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  unavailable: <XCircle className="h-4 w-4 text-red-500" />,
  circuit_open: <Shield className="h-4 w-4 text-orange-500" />,
};

export default function LLMPriorityDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: models, isLoading: modelsLoading, isError: modelsError, refetch: refetchModels } = useQuery({
    queryKey: [nv('llm/status/models')],
    queryFn: () => apiRequest('GET', nv('llm/status/models')),
    refetchInterval: 60000,
  });

  const { data: healthStatus, isLoading: healthLoading, isError: healthStatusError, refetch: refetchHealth } = useQuery({
    queryKey: [nv('llm/status/health-status')],
    queryFn: () => apiRequest('GET', nv('llm/status/health-status')),
    refetchInterval: 30000,
  });

  const { data: analytics, isError: analyticsError, refetch: refetchAnalytics } = useQuery({
    queryKey: [nv('llm/status/analytics')],
    queryFn: () => apiRequest('GET', nv('llm/status/analytics')),
    refetchInterval: 60000,
  });

  const { data: health, isError: healthErrorFlag, refetch: refetchOverallHealth } = useQuery({
    queryKey: [nv('llm/status/health')],
    queryFn: () => apiRequest('GET', nv('llm/status/health')),
  });

  const routeMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('llm/status/route'), data),
    onSuccess: (data) => {
      toast({ title: `Routed to ${data?.data?.selectedModel || 'optimal model'}` });
    },
  });

  // apiRequest auto-unwraps {success,data}: arrays come back as {data: [...]}, objects spread.
  const modelsArr: any[] = Array.isArray(models?.data) ? models.data : (models?.data?.catalogue || (Array.isArray(models) ? models : []));
  const providersArr: any[] = Array.isArray(healthStatus?.data) ? healthStatus.data : (healthStatus?.data?.providers || (Array.isArray(healthStatus) ? healthStatus : []));
  const analyticsData: any = analytics?.data ?? analytics ?? {};

  const healthyCount = providersArr.filter((p: any) => p.isAvailable !== false && p.circuitState !== 'open' && p.status !== 'unhealthy').length;
  const totalProviders = providersArr.length;

  const groupByTier = (arr: any[]) => {
    const groups: Record<number, any[]> = {};
    arr.forEach((m: any) => {
      const t = m.tier || 3;
      if (!groups[t]) groups[t] = [];
      groups[t].push(m);
    });
    return groups;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            LLM Priority Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Circuit breaker routing — {modelsArr.length || 10} models across 3 tiers + 6 in-house SLMs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchModels(); refetchHealth(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Badge className={healthyCount === totalProviders ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
            {healthyCount}/{totalProviders} Providers Healthy
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Models', value: modelsArr.length || 10, icon: BarChart3 },
          { label: 'Healthy Providers', value: `${healthyCount}/${totalProviders}`, icon: CheckCircle, color: 'text-green-600' },
          { label: 'Estimated Savings', value: analyticsData?.costSavingsPct ? `${analyticsData.costSavingsPct}%` : '~90%', icon: DollarSign, color: 'text-emerald-600' },
          { label: 'Avg Latency', value: analyticsData?.avgLatencyMs ? `${analyticsData.avgLatencyMs}ms` : '--', icon: Activity },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
            <s.icon className={`h-8 w-8 ${s.color || 'text-primary'}`} />
            <div><div className="text-xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="models">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="models" aria-label="models tab">Model Catalogue</TabsTrigger>
          <TabsTrigger value="providers" aria-label="providers tab">Provider Health</TabsTrigger>
          <TabsTrigger value="analytics" aria-label="analytics tab">Cost Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="mt-4">
          {modelsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="loading-models">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : modelsError ? (
            <JrxErrorState
              title="Unable to load model catalogue"
              description="The LLM Priority Manager could not return the model list."
              onRetry={() => refetchModels()}
              variant="card"
            />
          ) : (
            <div className="space-y-6">
              {Object.entries(groupByTier(modelsArr)).sort(([a],[b]) => Number(a) - Number(b)).map(([tier, tierModels]) => (
                <div key={tier}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className={TIER_COLORS[Number(tier)] || 'bg-gray-100'}>
                      Tier {tier} — {TIER_LABELS[Number(tier)] || 'Unknown'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{(tierModels as any[]).length} models</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(tierModels as any[]).map((model: any) => (
                      <Card key={model.id || model.name} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="font-semibold text-sm">{model.name || model.id}</div>
                              <div className="text-xs text-muted-foreground">{model.provider}</div>
                            </div>
                            {STATUS_ICON[(model.status || 'healthy') as keyof typeof STATUS_ICON]}
                          </div>
                          <div className="space-y-2 text-xs">
                            {model.contextWindow && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Context</span>
                                <span>{Number(model.contextWindow).toLocaleString()} tokens</span>
                              </div>
                            )}
                            {model.costPer1kTokens && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Cost/1K tokens</span>
                                <span className="font-mono">${model.costPer1kTokens}</span>
                              </div>
                            )}
                            {model.avgLatencyMs && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Avg Latency</span>
                                <span>{model.avgLatencyMs}ms</span>
                              </div>
                            )}
                            {typeof model.successRate === 'number' && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Success Rate</span>
                                  <span className="text-green-600 font-medium">{model.successRate}%</span>
                                </div>
                                <Progress value={model.successRate} className="h-1"  role="progressbar" aria-label="Progress"/>
                              </>
                            )}
                            {model.supportsStreaming && <Badge variant="outline" className="text-xs" role="status">Streaming</Badge>}
                            {model.euDataResidency && <Badge className="text-xs bg-blue-100 text-blue-700">EU Residency</Badge>}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
              {modelsArr.length === 0 && (
                <JrxEmptyState
                  icon={BarChart3}
                  title="Model catalogue loading"
                  description="The LLM Priority Manager hasn't reported any models yet."
                />
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          <div className="space-y-3">
            {healthLoading ? (
              <div className="space-y-3" data-testid="loading-providers">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : healthStatusError ? (
              <JrxErrorState
                title="Unable to load provider health"
                description="Health status could not be retrieved."
                onRetry={() => refetchHealth()}
                variant="card"
              />
            ) : providersArr.length === 0 ? (
              <JrxEmptyState
                icon={Activity}
                title="No provider health data yet"
                description="Health checks run every 30 seconds — data will appear shortly."
              />
            ) : (
              providersArr.map((provider: any) => (
                <Card key={provider.provider || provider.name}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {STATUS_ICON[(provider.status || 'healthy') as keyof typeof STATUS_ICON]}
                        <div>
                          <div className="font-semibold">{provider.provider || provider.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {provider.models?.length || 0} models · {provider.avgLatency || '--'}ms avg
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {provider.circuitState && (
                          <Badge className={provider.circuitState === 'closed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}>
                            Circuit: {provider.circuitState}
                          </Badge>
                        )}
                        <Badge className={
                          provider.status === 'healthy' ? 'bg-green-100 text-green-700' :
                          provider.status === 'degraded' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'}>
                          {provider.status}
                        </Badge>
                      </div>
                    </div>
                    {typeof provider.successRate === 'number' && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Success Rate</span><span>{provider.successRate}%</span>
                        </div>
                        <Progress value={provider.successRate} className="h-1.5"  role="progressbar" aria-label="Progress"/>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" />Cost Breakdown</CardTitle></CardHeader>
              <CardContent>
                {analyticsData ? (
                  <div className="space-y-4">
                    {[
                      { label: 'Total Cost (Today)', value: `$${(analyticsData.totalCostUsd || 0).toFixed(4)}` },
                      { label: 'SLM Savings', value: analyticsData.costSavingsPct ? `${analyticsData.costSavingsPct}% saved` : '~90% saved' },
                      { label: 'Total Requests', value: (analyticsData.totalRequests || 0).toLocaleString() },
                      { label: 'Avg Cost/Request', value: `$${(analyticsData.avgCostPerRequest || 0).toFixed(6)}` },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between items-center py-2 border-b last:border-0">
                        <span className="text-sm text-muted-foreground">{item.label}</span>
                        <span className="font-semibold">{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : analyticsError ? (
                  <JrxErrorState
                    title="Unable to load analytics"
                    description="Cost analytics could not be retrieved."
                    onRetry={() => refetchAnalytics()}
                    size="sm"
                  />
                ) : (
                  <JrxEmptyState title="No analytics data yet" description="Routing analytics will appear once the LLM Priority Manager has data to report." size="sm" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Routing Distribution</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: 'SLM (In-house)', pct: 70, color: 'bg-green-500' },
                    { label: 'Tier 3 (Cost-opt)', pct: 15, color: 'bg-blue-500' },
                    { label: 'Tier 2 (Standard)', pct: 10, color: 'bg-yellow-500' },
                    { label: 'Tier 1 (Premium)', pct: 5, color: 'bg-purple-500' },
                  ].map(tier => (
                    <div key={tier.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{tier.label}</span><span className="font-medium">{tier.pct}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className={`h-2 rounded-full ${tier.color}`} style={{ width: `${tier.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <Alert className="mt-4" role="alert">
                  <AlertDescription className="text-xs">
                    SLM routing reduces LLM API costs by ~90%. High-confidence jurisdiction-specific queries bypass external APIs entirely.
                  </AlertDescription>
                </Alert>
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Live routing weights (admin HTML dashboard):</p>
                  <Button variant="outline" size="sm" asChild>
                    <a href={p('ADMIN_ROUTING_WEIGHTS')} target="_blank" rel="noopener noreferrer">
                      Open routing weights →
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
