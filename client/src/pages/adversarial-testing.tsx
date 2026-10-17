import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Shield, Play, AlertTriangle, CheckCircle, XCircle, BarChart3, RefreshCw, Target } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { formatDistanceToNow } from 'date-fns';
import { p } from '@/lib/jrx-api-paths';

// Task #176 (B2): /history and /stats are aliases of the canonical
// /api/jrx/adversarial aggregator (registry key ADVERSARIAL).
const ADV_HISTORY = `${p('ADVERSARIAL')}/history`;
const ADV_STATS = `${p('ADVERSARIAL')}/stats`;
const ADV_TEST = `${p('ADVERSARIAL')}/test`;

const ATTACK_TYPES = [
  { id: 'jailbreak', label: 'Jailbreak', desc: 'Tests resistance to prompt injection / role manipulation attacks.' },
  { id: 'prompt_injection', label: 'Prompt Injection', desc: 'Attempts to override system instructions via user input.' },
  { id: 'pii_extraction', label: 'PII Extraction', desc: 'Tests whether PII from vault can be extracted via social engineering.' },
  { id: 'hallucination_induction', label: 'Hallucination Induction', desc: 'Tries to force false statute citations or fabricated case law.' },
  { id: 'bias_amplification', label: 'Bias Amplification', desc: 'Attempts to amplify gender, cultural, or jurisdiction bias.' },
  { id: 'context_poisoning', label: 'Context Poisoning', desc: 'Injects malicious content in chat history / RAG documents.' },
  { id: 'instruction_override', label: 'Instruction Override', desc: 'Attempts to override jurisdiction or compliance constraints.' },
  { id: 'data_exfiltration', label: 'Data Exfiltration', desc: 'Tests if confidential matter data can be extracted.' },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
  pass: 'bg-blue-100 text-blue-800',
};

export default function AdversarialTesting() {
  const { toast } = useToast();
  const [attackType, setAttackType] = useState('jailbreak');
  const [agentKey, setAgentKey] = useState('senior-legal-advisor');
  const [customPayload, setCustomPayload] = useState('');
  const [intensity, setIntensity] = useState('standard');
  const [lastResult, setLastResult] = useState<any>(null);

  const { data: testHistory, isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: [ADV_HISTORY],
    queryFn: () => apiRequest('GET', ADV_HISTORY),
    refetchInterval: 60000,
  });

  const { data: stats } = useQuery({
    queryKey: [ADV_STATS],
    queryFn: () => apiRequest('GET', ADV_STATS),
  });

  const runTest = useMutation({
    mutationFn: (data: any) => apiRequest('POST', ADV_TEST, data),
    onSuccess: (data) => {
      setLastResult(data?.data);
      refetchHistory();
      toast({ title: data?.data?.passed ? 'Test passed — system is resilient' : '⚠️ Test found vulnerability', variant: data?.data?.passed ? 'default' : 'destructive' });
    },
    onError: () => toast({ title: 'Test execution failed', variant: 'destructive' }),
  });

  const handleRunTest = () => {
    runTest.mutate({ attackType, agentKey, customPayload: customPayload || undefined, intensity });
  };

  const historyArr = testHistory?.data?.tests || [];
  const passRate = stats?.data?.passRate || 0;
  const totalTests = stats?.data?.totalTests || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Adversarial Testing Suite
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            10-step safety pipeline validation — 8 attack vectors × 3 intensities
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalTests > 0 && (
            <div className="text-right">
              <div className="text-2xl font-bold text-green-600">{passRate}%</div>
              <div className="text-xs text-muted-foreground">Pass Rate ({totalTests} tests)</div>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats?.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Tests Run', value: stats.data.totalTests || 0, icon: Target },
            { label: 'Tests Passed', value: stats.data.passed || 0, icon: CheckCircle, color: 'text-green-600' },
            { label: 'Vulnerabilities Found', value: stats.data.vulnerabilities || 0, icon: AlertTriangle, color: 'text-orange-600' },
            { label: 'Critical Findings', value: stats.data.critical || 0, icon: XCircle, color: 'text-red-600' },
          ].map(s => (
            <Card key={s.label}><CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-8 w-8 ${s.color || 'text-primary'}`} />
              <div><div className="text-2xl font-bold">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Configuration */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Play className="h-4 w-4" />Configure & Run Test</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Attack Type</Label>
              <Select value={attackType} onValueChange={setAttackType} aria-label="Select option">
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ATTACK_TYPES.map(a => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {ATTACK_TYPES.find(a => a.id === attackType)?.desc}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Target Agent</Label>
                <Input value={agentKey} onChange={e => setAgentKey(e.target.value)} className="mt-1" placeholder="agent-key" />
              </div>
              <div>
                <Label>Intensity</Label>
                <Select value={intensity} onValueChange={setIntensity} aria-label="Select option">
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light (5 probes)</SelectItem>
                    <SelectItem value="standard">Standard (20 probes)</SelectItem>
                    <SelectItem value="intensive">Intensive (50 probes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Custom Attack Payload (optional)</Label>
              <Textarea value={customPayload} onChange={e => setCustomPayload(e.target.value)}
                placeholder="Paste a specific adversarial prompt to test..." rows={3} className="mt-1" />
            </div>

            <Button onClick={handleRunTest} disabled={runTest.isPending} className="w-full">
              {runTest.isPending
                ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running attack simulation...</>
                : <><Play className="h-4 w-4 mr-2" />Run Adversarial Test</>}
            </Button>

            {runTest.isPending && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground text-center">Executing adversarial probes through 10-step safety pipeline...</div>
                <Progress value={undefined} className="h-1.5 animate-pulse"  role="progressbar" aria-label="Progress"/>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Last Result */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" />Last Test Result</CardTitle></CardHeader>
          <CardContent>
            {lastResult ? (
              <div className="space-y-4">
                <div className={`flex items-center gap-3 p-4 rounded-lg ${lastResult.passed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  {lastResult.passed
                    ? <CheckCircle className="h-8 w-8 text-green-600" />
                    : <XCircle className="h-8 w-8 text-red-600" />}
                  <div>
                    <div className={`text-lg font-bold ${lastResult.passed ? 'text-green-700' : 'text-red-700'}`}>
                      {lastResult.passed ? 'ALL GUARDRAILS HELD' : 'VULNERABILITY DETECTED'}
                    </div>
                    <div className="text-sm">{lastResult.attackType} · {lastResult.agentKey}</div>
                  </div>
                </div>

                {lastResult.findings && lastResult.findings.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Findings</h4>
                    <div className="space-y-2">
                      {lastResult.findings.map((f: any, idx: number) => (
                        <div key={idx} className="text-sm flex items-start gap-2">
                          <Badge className={`text-xs flex-shrink-0 ${SEVERITY_COLORS[f.severity]}`}>{f.severity}</Badge>
                          <span>{f.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {lastResult.guardrailsTriggered && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Guardrails Triggered</h4>
                    <div className="flex flex-wrap gap-1">
                      {lastResult.guardrailsTriggered.map((g: string) => (
                        <Badge key={g} className="bg-blue-100 text-blue-700 text-xs">{g}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  {lastResult.probesRun && <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Probes Run</span><span>{lastResult.probesRun}</span></div>}
                  {lastResult.probesPassed && <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Probes Passed</span><span className="text-green-600">{lastResult.probesPassed}</span></div>}
                  {lastResult.severity && <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Max Severity</span><Badge className={`text-xs ${SEVERITY_COLORS[lastResult.severity]}`}>{lastResult.severity}</Badge></div>}
                  {lastResult.latencyMs && <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Duration</span><span>{lastResult.latencyMs}ms</span></div>}
                </div>

                {lastResult.recommendation && (
                  <Alert variant={lastResult.passed ? 'default' : 'destructive'} role="alert">
                    <AlertDescription className="text-sm">{lastResult.recommendation}</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <Shield className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-muted-foreground">Run a test to see results here.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Test History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Test History</CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetchHistory()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-64" aria-label="Scrollable content">
            {historyLoading ? (
                <div className="p-4 space-y-2" data-testid="loading-history">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : historyArr.length === 0 ? (
                <JrxEmptyState icon={Shield} title="No test history yet" description="Run an attack simulation to populate this list." size="sm" />
              ) : (
                <div className="divide-y text-sm">
                  {historyArr.map((test: any, idx: number) => (
                    <div key={test.id || idx} className="p-3 hover:bg-muted/50 flex items-center gap-3">
                      {test.passed ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize">{(test.attackType || '').replace(/_/g,' ')}</span>
                          <Badge variant="outline" className="text-xs" role="status">{test.agentKey}</Badge>
                          {test.severity && <Badge className={`text-xs ${SEVERITY_COLORS[test.severity]}`}>{test.severity}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{test.probesRun} probes · {test.probesPassed} passed</div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {test.createdAt ? formatDistanceToNow(new Date(test.createdAt), { addSuffix: true }) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
