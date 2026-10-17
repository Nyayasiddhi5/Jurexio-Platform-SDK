import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Activity, AlertTriangle, CheckCircle, TrendingUp, TrendingDown, RefreshCw, Play, BellOff, Database } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { formatDistanceToNow } from 'date-fns';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
export default function ModelDriftMonitor() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modelId, setModelId] = useState('');
  const [metricName, setMetricName] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [baselineModelId, setBaselineModelId] = useState('');
  const [baselineMetrics, setBaselineMetrics] = useState('{"accuracy": 0.87, "latency_ms": 1200, "hallucination_rate": 0.05}');

  const { data: driftReport, isLoading: reportLoading, refetch: refetchReport } = useQuery({
    queryKey: [nv('drift/report')],
    queryFn: () => apiRequest('GET', nv('drift/report')),
    refetchInterval: 60000,
  });

  const { data: driftStatus, refetch: refetchStatus } = useQuery({
    queryKey: [nv('drift/status')],
    queryFn: () => apiRequest('GET', nv('drift/status')),
    refetchInterval: 30000,
  });

  const checkDrift = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('drift/check'), data),
    onSuccess: (data) => {
      setCheckResult(data?.data);
      refetchReport();
      toast({ title: data?.data?.hasDrift ? '⚠️ Drift detected' : 'No significant drift', variant: data?.data?.hasDrift ? 'destructive' : 'default' });
    },
    onError: () => toast({ title: 'Drift check failed', variant: 'destructive' }),
  });

  const createBaseline = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('phase4/drift/baseline'), data),
    onSuccess: () => {
      refetchReport();
      toast({ title: 'Baseline created successfully' });
    },
    onError: () => toast({ title: 'Failed to create baseline', variant: 'destructive' }),
  });

  const acknowledgeAlert = useMutation({
    mutationFn: (alertId: string) => apiRequest('POST', `${NV_BASE}phase4/drift/alerts/${alertId}/acknowledge`, {}),
    onSuccess: () => {
      refetchReport();
      toast({ title: 'Alert acknowledged' });
    },
  });

  const handleCheck = () => {
    if (!modelId.trim()) { toast({ title: 'Model ID is required', variant: 'destructive' }); return; }
    checkDrift.mutate({ modelId, metricName: metricName || undefined, currentValue: currentValue ? parseFloat(currentValue) : undefined });
  };

  const handleCreateBaseline = () => {
    if (!baselineModelId.trim()) { toast({ title: 'Model ID is required', variant: 'destructive' }); return; }
    try {
      const metrics = JSON.parse(baselineMetrics);
      createBaseline.mutate({ modelId: baselineModelId, baselineMetrics: metrics });
    } catch {
      toast({ title: 'Invalid JSON for baseline metrics', variant: 'destructive' });
    }
  };

  const report = driftReport?.data;
  const status = driftStatus?.data;
  const overallHealth = status?.overallHealth || 'healthy';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Model Drift Monitor
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time statistical drift detection across all LLM model tiers</p>
          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-slate-700 max-w-3xl">
            <strong className="text-slate-900">Purpose.</strong> Catches silent quality regressions in production LLMs.
            For every model tier (gemini-2.5-flash, gpt-4o-mini, claude-3-haiku, sarvam-m…) we compute rolling
            <em> p50/p95 latency</em> and a <em>24h vs prior-24h accuracy delta</em> from <code className="bg-white px-1 rounded">nv_agent_performance</code>.
            Use <em>Run Drift Check</em> (right) to compare a current metric against a stored baseline; use
            <em> Create Baseline</em> to snapshot today's accuracy/latency/hallucination rate for a model
            so future drift can be measured against it.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={
            overallHealth === 'healthy' ? 'bg-green-100 text-green-700' :
            overallHealth === 'warning' ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'}>
            {overallHealth === 'healthy' ? <CheckCircle className="h-3 w-3 mr-1 inline" /> : <AlertTriangle className="h-3 w-3 mr-1 inline" />}
            {overallHealth.toUpperCase()}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => { refetchReport(); refetchStatus(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Status Strip */}
      {report?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Active Alerts', value: report.summary.activeAlerts || 0, icon: AlertTriangle, color: report.summary.activeAlerts > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'Drift Rate', value: report.summary.driftRate || '0%', icon: TrendingUp, color: 'text-primary' },
            { label: 'Total Checks', value: report.summary.totalChecks || 0, icon: Activity, color: 'text-muted-foreground' },
            { label: 'Baselines', value: report.summary.totalBaselines || 0, icon: Database, color: 'text-muted-foreground' },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-8 w-8 ${s.color}`} />
              <div><div className="text-xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="check">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="check" aria-label="check tab"><Play className="h-4 w-4 mr-1" />Drift Check</TabsTrigger>
          <TabsTrigger value="alerts" aria-label="alerts tab"><AlertTriangle className="h-4 w-4 mr-1" />Alerts {report?.summary?.activeAlerts > 0 && <Badge className="ml-1">{report.summary.activeAlerts}</Badge>}</TabsTrigger>
          <TabsTrigger value="baselines" aria-label="baselines tab"><Database className="h-4 w-4 mr-1" />Baselines</TabsTrigger>
          <TabsTrigger value="history" aria-label="history tab">History</TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Run Drift Check</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div><Label>Model ID *</Label>
                  <Input value={modelId} onChange={e => setModelId(e.target.value)} placeholder="e.g., gpt-4o, ns-slm-ind-v2" className="mt-1" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Metric Name (optional)</Label>
                    <Input value={metricName} onChange={e => setMetricName(e.target.value)} placeholder="accuracy" className="mt-1" /></div>
                  <div><Label>Current Value</Label>
                    <Input type="number" step="0.001" value={currentValue} onChange={e => setCurrentValue(e.target.value)} placeholder="0.85" className="mt-1" /></div>
                </div>
                <Button onClick={handleCheck} disabled={checkDrift.isPending} className="w-full">
                  {checkDrift.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Check for Drift
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Last Check Result</CardTitle></CardHeader>
              <CardContent>
                {checkResult ? (
                  <div className="space-y-3">
                    <div className={`flex items-center gap-3 p-3 rounded-lg ${checkResult.hasDrift ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
                      {checkResult.hasDrift ? <TrendingDown className="h-6 w-6 text-orange-600" /> : <CheckCircle className="h-6 w-6 text-green-600" />}
                      <div>
                        <div className={`font-bold ${checkResult.hasDrift ? 'text-orange-700' : 'text-green-700'}`}>
                          {checkResult.hasDrift ? `${checkResult.driftedMetrics} metric(s) drifted` : 'No Significant Drift'}
                        </div>
                        <div className="text-xs text-muted-foreground">{checkResult.totalMetrics} metrics checked</div>
                      </div>
                    </div>
                    <ScrollArea className="h-40" aria-label="Scrollable content">
                      <div className="space-y-2">
                        {(checkResult.results || []).map((r: any, i: number) => (
                          <div key={i} className={`p-2 rounded text-xs ${r.drifted ? 'bg-orange-50' : 'bg-muted'}`}>
                            <div className="flex justify-between font-medium">
                              <span>{r.metric}</span>
                              <Badge className={r.drifted ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'} variant="outline" role="status">
                                {r.drifted ? `${r.driftPct}% drift` : 'stable'}
                              </Badge>
                            </div>
                            <div className="flex justify-between text-muted-foreground mt-1">
                              <span>Baseline: {r.baseline}</span>
                              <span>Current: {r.current}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    {checkResult.recommendation && (
                      <Alert role="alert"><AlertDescription className="text-xs">{checkResult.recommendation}</AlertDescription></Alert>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p className="text-muted-foreground text-sm">Run a drift check to see results.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-80" aria-label="Scrollable content">
                {reportLoading ? (
                  <div className="p-4 space-y-2" data-testid="loading-alerts">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : (report?.activeAlerts || []).length === 0 ? (
                  <NyvEmptyState
                    icon={CheckCircle}
                    title="No active drift alerts"
                    description="Drift checks run continuously — alerts will surface here when triggered."
                  />
                ) : (
                    <div className="divide-y">
                      {(report?.activeAlerts || []).map((alert: any) => (
                        <div key={alert.id} className="p-4 hover:bg-muted/50 flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs" role="status">{alert.model_id}</Badge>
                              <Badge className="bg-orange-100 text-orange-700 text-xs">{alert.severity}</Badge>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {alert.created_at ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true }) : ''}
                              </span>
                            </div>
                            <p className="text-sm">{alert.message}</p>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => acknowledgeAlert.mutate(alert.id)}>
                            <BellOff className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="baselines" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Create Baseline</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div><Label>Model ID *</Label>
                  <Input value={baselineModelId} onChange={e => setBaselineModelId(e.target.value)} placeholder="e.g., gpt-4o-2026-04" className="mt-1" /></div>
                <div><Label>Baseline Metrics (JSON)</Label>
                  <textarea value={baselineMetrics} onChange={e => setBaselineMetrics(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono h-28 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                </div>
                <Button onClick={handleCreateBaseline} disabled={createBaseline.isPending} className="w-full">
                  {createBaseline.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
                  Create Baseline Snapshot
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Existing Baselines</CardTitle></CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64" aria-label="Scrollable content">
                  {(report?.baselines || []).length === 0 ? (
                    <NyvEmptyState title="No baselines yet" description="Capture a baseline above to start drift detection for a model." size="sm" />
                  ) : (
                    <div className="divide-y">
                      {(report?.baselines || []).map((b: any) => (
                        <div key={b.id} className="p-3 text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs" role="status">{b.model_id}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {b.created_at ? formatDistanceToNow(new Date(b.created_at), { addSuffix: true }) : ''}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {Object.keys(b.baseline_metrics || {}).join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-80" aria-label="Scrollable content">
                {(report?.recentChecks || []).length === 0 ? (
                  <NyvEmptyState title="No check history yet" description="Drift checks will appear here once they run." size="sm" />
                ) : (
                  <div className="divide-y text-sm">
                    {(report?.recentChecks || []).map((check: any, idx: number) => (
                      <div key={check.id || idx} className="p-3 flex items-center gap-3">
                        {check.has_drift
                          ? <TrendingDown className="h-4 w-4 text-orange-500" />
                          : <TrendingUp className="h-4 w-4 text-green-500" />}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{check.model_id}</span>
                            <Badge className={check.has_drift ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'} variant="outline" role="status">
                              {check.has_drift ? 'drifted' : 'stable'}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{check.metrics_checked} metrics · {check.check_type}</div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {check.checked_at ? formatDistanceToNow(new Date(check.checked_at), { addSuffix: true }) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
