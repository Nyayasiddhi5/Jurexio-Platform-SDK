import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Globe, Zap, Activity, GitBranch, Shield, TrendingUp, RefreshCw, Play } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { nv } from '@/lib/jrx-api-paths';
const JURISDICTIONS = [
  { code: 'IN', name: 'India', slm: 'NS-SLM-IND', color: 'bg-orange-100 text-orange-800' },
  { code: 'UK', name: 'United Kingdom', slm: 'NS-SLM-UK', color: 'bg-blue-100 text-blue-800' },
  { code: 'US', name: 'United States', slm: 'NS-SLM-US', color: 'bg-red-100 text-red-800' },
  { code: 'GC', name: 'GCC', slm: 'NS-SLM-GCC', color: 'bg-emerald-100 text-emerald-800' },
  { code: 'EU', name: 'European Union', slm: 'NS-SLM-EU', color: 'bg-indigo-100 text-indigo-800' },
  { code: 'SG', name: 'Singapore', slm: 'NS-SLM-SG', color: 'bg-pink-100 text-pink-800' },
  { code: 'DEFAULT', name: 'Cross-Jurisdiction', slm: 'NS-LRM-DEFAULT', color: 'bg-slate-100 text-slate-800' },
];

export default function LRMRouterDashboard() {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState('all');
  const [routingResult, setRoutingResult] = useState<any>(null);

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: [nv('lrm/health')],
    queryFn: () => apiRequest('GET', nv('lrm/health')),
    refetchInterval: 30000,
  });

  const { data: slmBindings } = useQuery({
    queryKey: [nv('lrm/slm-bindings')],
    queryFn: () => apiRequest('GET', nv('lrm/slm-bindings')),
  });

  const { data: detectResult, isLoading: detecting, refetch: runDetect } = useQuery({
    queryKey: [nv('lrm/detect-jurisdiction'), query],
    queryFn: () => query ? apiRequest('POST', nv('lrm/detect-jurisdiction'), { query }) : Promise.resolve(null),
    enabled: false,
  });

  const routeMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('lrm/route'), data),
    onSuccess: (data) => {
      setRoutingResult(data?.data);
      toast({ title: 'Query Routed', description: `Routed to ${data?.data?.routedTo || 'LRM'} with ${data?.data?.confidence}% confidence` });
    },
    onError: () => toast({ title: 'Routing Error', variant: 'destructive' }),
  });

  const handleRoute = () => {
    if (!query.trim()) { toast({ title: 'Enter a query first', variant: 'destructive' }); return; }
    routeMutation.mutate({ query, jurisdiction: selectedJurisdiction && selectedJurisdiction !== 'all' ? selectedJurisdiction : undefined, agentKey: 'legal-research-specialist' });
  };

  const handleDetect = () => {
    if (!query.trim()) { toast({ title: 'Enter a query first', variant: 'destructive' }); return; }
    runDetect();
  };

  const confidenceColor = (c: number) => c >= 85 ? 'text-green-600' : c >= 70 ? 'text-yellow-600' : 'text-red-600';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" />
            NS LRM + SLM Router
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Two-tier jurisdiction routing — 6 SLMs + NS LRM synthesis engine</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchHealth()} disabled={healthLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${healthLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Jurisdiction SLM Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {JURISDICTIONS.map(j => (
          <Card key={j.code} className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedJurisdiction(j.code === selectedJurisdiction ? 'all' : j.code)}>
            <CardContent className="p-3 text-center">
              <div className={`text-lg font-bold px-2 py-1 rounded mb-1 inline-block ${j.color}`}>{j.code}</div>
              <div className="text-xs font-medium truncate">{j.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{j.slm}</div>
              {selectedJurisdiction === j.code && <Badge className="mt-1 text-xs">Selected</Badge>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Route Query Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Play className="h-4 w-4" />Route a Query</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Enter your legal query here... (e.g., 'What are the DPDPA compliance requirements for data processors under the new Indian privacy law?')"
              value={query}
              onChange={e => setQuery(e.target.value)}
              rows={5}
              className="resize-none"
            />
            <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction} aria-label="Select option">
              <SelectTrigger>
                <SelectValue placeholder="Force jurisdiction (optional — auto-detected if empty)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Auto-detect</SelectItem>
                {JURISDICTIONS.map(j => <SelectItem key={j.code} value={j.code}>{j.code} — {j.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button onClick={handleRoute} disabled={routeMutation.isPending} className="flex-1">
                {routeMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                Route Query
              </Button>
              <Button variant="outline" onClick={handleDetect} disabled={detecting}>
                <Globe className="h-4 w-4 mr-2" />
                Detect
              </Button>
            </div>

            {/* Routing Result */}
            {routingResult && (
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Routing Decision</span>
                  <Badge variant={routingResult.routedTo?.includes('SLM') ? 'default' : 'secondary'}>
                    {routingResult.routedTo || 'LRM'}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Confidence</span>
                    <span className={`font-bold ${confidenceColor(routingResult.confidence || 0)}`}>
                      {routingResult.confidence || 0}%
                    </span>
                  </div>
                  <Progress value={routingResult.confidence || 0} className="h-2"  role="progressbar" aria-label="Progress"/>
                </div>
                {routingResult.detectedJurisdiction && (
                  <div className="text-sm flex justify-between">
                    <span>Detected Jurisdiction</span>
                    <Badge variant="outline" role="status">{routingResult.detectedJurisdiction}</Badge>
                  </div>
                )}
                {routingResult.slmBinding && (
                  <div className="text-sm flex justify-between">
                    <span>SLM Binding</span>
                    <code className="text-xs bg-background px-2 py-0.5 rounded">{routingResult.slmBinding}</code>
                  </div>
                )}
                {routingResult.reasoning && (
                  <Alert role="alert">
                    <AlertDescription className="text-xs">{routingResult.reasoning}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Health + SLM Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" />Router Health</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="health">
              <TabsList className="w-full" aria-label="Navigation tabs">
                <TabsTrigger value="health" className="flex-1" aria-label="health tab">Health</TabsTrigger>
                <TabsTrigger value="bindings" className="flex-1" aria-label="bindings tab">SLM Bindings</TabsTrigger>
              </TabsList>
              <TabsContent value="health" className="mt-4 space-y-3">
                {healthLoading ? (
                  <div className="space-y-2" data-testid="loading-health">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
                  </div>
                ) : health?.data ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                      <span className="font-medium">LRM Router Online</span>
                      <Badge className="ml-auto">{health.data.status || 'healthy'}</Badge>
                    </div>
                    {health.data.architecture && (
                      <div className="text-sm text-muted-foreground">{health.data.architecture}</div>
                    )}
                    {Object.entries(health.data).filter(([k]) => !['status','architecture'].includes(k)).slice(0,8).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-sm py-1 border-b last:border-0">
                        <span className="text-muted-foreground capitalize">{key.replace(/_/g,' ')}</span>
                        <span className="font-medium">{String(val)}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <JrxErrorState
                    title="Health check unavailable"
                    description="The LRM Router did not return a health payload. Try refreshing."
                    onRetry={() => refetchHealth()}
                    variant="card"
                    size="sm"
                  />
                )}
              </TabsContent>
              <TabsContent value="bindings" className="mt-4">
                <ScrollArea className="h-64" aria-label="Scrollable content">
                  {slmBindings?.data ? (
                    <div className="space-y-2">
                      {Object.entries(slmBindings.data).map(([jurisdiction, binding]) => (
                        <div key={jurisdiction} className="flex items-center justify-between p-2 bg-muted rounded">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" role="status">{jurisdiction.toUpperCase()}</Badge>
                            <span className="text-sm">{JURISDICTIONS.find(j => j.code === jurisdiction.toUpperCase())?.name || jurisdiction}</span>
                          </div>
                          <code className="text-xs bg-background px-2 py-1 rounded">{String(binding)}</code>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="loading-bindings">
                      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Routing Logic Legend */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" />Routing Decision Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: '≥ 85% Confidence', route: 'Direct SLM', desc: 'Routes to jurisdiction-specific SLM. Lowest cost, fastest response (~90% of queries).', color: 'border-green-200 bg-green-50' },
              { label: '70–85% Confidence', route: 'LRM Synthesis', desc: 'NS LRM synthesises across multiple SLMs. Balanced accuracy and cost.', color: 'border-yellow-200 bg-yellow-50' },
              { label: '< 70% Confidence', route: 'Global LLM (PII-Redacted)', desc: 'Routes to Claude 4.5/GPT-4.1 with all PII redacted first. Maximum accuracy.', color: 'border-red-200 bg-red-50' },
            ].map(tier => (
              <div key={tier.label} className={`rounded-lg border p-4 ${tier.color}`}>
                <div className="font-semibold text-sm mb-1">{tier.label}</div>
                <div className="font-bold mb-2">{tier.route}</div>
                <div className="text-xs text-muted-foreground">{tier.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
