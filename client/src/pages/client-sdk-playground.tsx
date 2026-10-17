import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv, NV_API } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Play, Copy, Zap, Clock, Loader2, Terminal, History,
  RefreshCw, Bot, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { NyvPageShell } from '@/components/NyvPageShell';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import type { ExecutionOutcome } from '@/components/execution/ExecutionOutcomePanel';
import { streamQueenAguiForConsole } from '@/services/jrx-admin-agui-adapter';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';
import { pickDefaultOrchestrationModel, useNvModelCatalog } from '@/hooks/useNvModelCatalog';

interface PatternDef {
  id: string;
  name: string;
  route: string;
  path: string;
  method: string;
  description: string;
  legalUseCase?: string;
}

interface AgentRow {
  id: string;
  name: string;
  jurisdiction: string;
}

interface HistoryEntry {
  id: string;
  pattern: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  timestamp: string;
  requestBody: string;
  responseBody: string;
}

function routeToPath(route: string): string {
  const m = route.match(/POST\s+(\S+)/i);
  if (m) return m[1];
  const slug = route.split('/').pop() ?? 'react';
  return nv(`patterns/${slug}`);
}

function buildSampleBody(task: string, agentId: string, jurisdiction: string): Record<string, unknown> {
  return {
    task: task.length >= 10 ? task : `${task} — legal analysis under applicable statute.`,
    agentId,
    jurisdiction,
    maxIterations: 3,
  };
}

export default function ClientSdkPlayground() {
  const { toast } = useToast();
  const { data: catalogModels = [] } = useNvModelCatalog();
  const defaultModelId = useMemo(() => pickDefaultOrchestrationModel(catalogModels), [catalogModels]);

  const { data: patternList } = useQuery({
    queryKey: [nv('patterns/list')],
    queryFn: () => nvFetchJson<{ patterns: Array<{ id: string; name: string; route: string; description: string; legalUseCase?: string }>; totalPatterns: number }>(nv('patterns/list')),
  });

  const { data: agentsResp } = useQuery({
    queryKey: [NV_API.AGENTS.path],
    queryFn: async () => {
      const t = getAuthToken();
      const r = await fetch(NV_API.AGENTS.path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const agents: AgentRow[] = useMemo(() => {
    const raw = agentsResp?.data?.agents ?? agentsResp?.agents ?? agentsResp?.data ?? [];
    if (!Array.isArray(raw)) return [{ id: 'Q-001', name: 'Queen Orchestration Engine', jurisdiction: 'IN' }];
    return raw.slice(0, 200).map((a: Record<string, unknown>) => ({
      id: String(a.agent_id ?? a.id ?? a.agentId ?? ''),
      name: String(a.name ?? a.agent_name ?? a.id ?? 'Agent'),
      jurisdiction: String(a.jurisdiction ?? (Array.isArray(a.jurisdictionScope) ? (a.jurisdictionScope as string[])[0] : 'IN') ?? 'IN'),
    })).filter((a) => a.id);
  }, [agentsResp]);

  const patterns: PatternDef[] = useMemo(() => {
    const fromApi = patternList?.patterns ?? [];
    if (!fromApi.length) {
      return [{
        id: 'P01', name: 'ReAct', route: 'POST /api/jrx/patterns/react',
        path: nv('patterns/react'), method: 'POST',
        description: 'Reason + Act loop with tool use',
      }];
    }
    return fromApi.map((p) => ({
      id: p.id,
      name: p.name,
      route: p.route,
      path: routeToPath(p.route),
      method: 'POST',
      description: p.description,
      legalUseCase: p.legalUseCase,
    }));
  }, [patternList]);

  const [selectedPattern, setSelectedPattern] = useState<PatternDef | null>(null);
  const activePattern = selectedPattern ?? patterns[0] ?? null;

  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [jurisdiction, setJurisdiction] = useState('IN');
  const [executionMode, setExecutionMode] = useState<'pattern' | 'queen'>('queen');
  const [taskInput, setTaskInput] = useState('Research anticipatory bail under BNSS 2023 with leading SC precedents');

  const agentId = selectedAgentId || agents[0]?.id || 'Q-001';
  const requestBody = useMemo(
    () => JSON.stringify(buildSampleBody(taskInput, agentId, jurisdiction), null, 2),
    [taskInput, agentId, jurisdiction],
  );
  const [requestBodyEdit, setRequestBodyEdit] = useState('');
  const effectiveBody = requestBodyEdit || requestBody;

  const [responseBody, setResponseBody] = useState('');
  const [executionSteps, setExecutionSteps] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState('response');
  const [railEvents, setRailEvents] = useState<LegalChatTimelineEvent[]>([]);
  const [orchestrationId, setOrchestrationId] = useState<string | undefined>();
  const [railOutcome, setRailOutcome] = useState<ExecutionOutcome>({ status: 'idle', text: '' });

  const extractSteps = (parsed: Record<string, unknown>): unknown[] => {
    if (Array.isArray(parsed.iterations)) return parsed.iterations;
    if (Array.isArray(parsed.steps)) return parsed.steps;
    if (Array.isArray(parsed.executionTrace)) return parsed.executionTrace;
    if (parsed.reactTrace && Array.isArray((parsed.reactTrace as Record<string, unknown>).iterations)) {
      return (parsed.reactTrace as Record<string, unknown>).iterations as unknown[];
    }
    return [];
  };

  const executeRequest = useCallback(async () => {
    if (!activePattern) return;
    setLoading(true);
    setResponseBody('');
    setExecutionSteps([]);
    setRailEvents([]);
    setOrchestrationId(undefined);
    setRailOutcome({ status: 'streaming', text: '' });
    setStatusCode(null);
    const start = Date.now();

    try {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(effectiveBody);
      } catch {
        throw new Error('Invalid JSON in request body');
      }

      const token = getAuthToken() ?? '';
      const task = String(body.task ?? taskInput);

      if (executionMode === 'queen') {
        const streamed = await streamQueenAguiForConsole(
          {
            task,
            pattern: activePattern.id,
            agentId: String(body.agentId ?? agentId),
            jurisdiction: String(body.jurisdiction ?? jurisdiction),
          },
          (e) => {
            setRailEvents((prev) => {
              const idx = prev.findIndex((x) => x.step === e.step);
              if (idx === -1) return [...prev, e];
              const next = prev.slice();
              next[idx] = e;
              return next;
            });
            setOrchestrationId(e.orchestrationId);
          },
        );
        setRailOutcome(streamed.outcome);
        const elapsed = Date.now() - start;
        setLatencyMs(elapsed);
        setStatusCode(200);
        const payload = {
          mode: 'queen-ag-ui',
          orchestrationId: streamed.orchestrationId,
          pattern: activePattern.id,
          agentId: body.agentId ?? agentId,
          modelCatalogDefault: defaultModelId,
          answer: streamed.answer,
          timelineEvents: railEvents.length + 1,
        };
        const formatted = JSON.stringify(payload, null, 2);
        setResponseBody(formatted);
        setExecutionSteps([{ step: 'AG-UI Queen stream', status: 'completed', orchestrationId: streamed.orchestrationId }]);
        setHistory((prev) => [{
          id: crypto.randomUUID(),
          pattern: activePattern.id,
          method: 'POST',
          path: nv('stream'),
          statusCode: 200,
          latencyMs: elapsed,
          timestamp: new Date().toISOString(),
          requestBody: effectiveBody,
          responseBody: formatted,
        }, ...prev.slice(0, 19)]);
      } else {
        const res = await fetch(activePattern.path, {
          method: activePattern.method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const elapsed = Date.now() - start;
        setLatencyMs(elapsed);
        setStatusCode(res.status);
        const responseText = await res.text();
        let formatted = responseText;
        try {
          const parsed = JSON.parse(responseText) as Record<string, unknown>;
          formatted = JSON.stringify(parsed, null, 2);
          setExecutionSteps(extractSteps(parsed));
        } catch {
          /* plain text */
        }
        setResponseBody(formatted);
        setHistory((prev) => [{
          id: crypto.randomUUID(),
          pattern: activePattern.id,
          method: activePattern.method,
          path: activePattern.path,
          statusCode: res.status,
          latencyMs: elapsed,
          timestamp: new Date().toISOString(),
          requestBody: effectiveBody,
          responseBody: formatted,
        }, ...prev.slice(0, 19)]);
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      setLatencyMs(elapsed);
      setStatusCode(0);
      setResponseBody(JSON.stringify({ error: (err as Error).message, timestamp: new Date().toISOString() }, null, 2));
    } finally {
      setLoading(false);
      setActiveTab('response');
    }
  }, [activePattern, effectiveBody, executionMode, agentId, jurisdiction, taskInput, defaultModelId, railEvents.length]);

  if (!activePattern) {
    return (
      <NyvPageShell testId="page-client-sdk-playground" title="Client SDK Playground" description="Loading patterns…">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </NyvPageShell>
    );
  }

  return (
    <NyvPageShell
      testId="page-client-sdk-playground"
      title="@jurexio/client-sdk Playground"
      description={`Live pattern catalog (${patterns.length}) · agents from registry · models from SSoT`}
      className="!p-0 flex flex-col min-h-[calc(100vh-4rem)]"
      compact
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">{patterns.length} patterns</Badge>
          <Badge variant="outline" className="text-xs">{agents.length} agents</Badge>
          {defaultModelId && (
            <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700">
              default model: {defaultModelId}
            </Badge>
          )}
        </div>
      }
    >
      <div className="flex flex-1 overflow-hidden border border-border rounded-lg bg-card flex-col lg:flex-row">
        <div className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-border bg-muted/30 flex flex-col shrink-0 max-h-64 lg:max-h-none">
          <ScrollArea className="flex-1" aria-label="Pattern list">
            <div className="p-2 space-y-0.5">
              {patterns.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelectedPattern(p); setRequestBodyEdit(''); }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-sm ${
                    activePattern.id === p.id
                      ? 'bg-purple-50 border border-purple-200'
                      : 'text-muted-foreground hover:bg-muted border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded font-bold bg-purple-100 text-purple-700">{p.id}</span>
                    <span className="truncate font-medium">{p.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 pl-9 line-clamp-2">{p.description}</p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="border-b border-border bg-muted/20 px-4 py-3 flex flex-wrap items-end gap-3 shrink-0">
            <div className="space-y-1 min-w-[140px]">
              <Label className="text-xs">Agent</Label>
              <Select value={agentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      <span className="flex items-center gap-1"><Bot className="h-3 w-3" />{a.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[100px]">
              <Label className="text-xs">Jurisdiction</Label>
              <Select value={jurisdiction} onValueChange={setJurisdiction}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['IN', 'UK', 'US', 'EU', 'GC', 'SG', 'ALL'].map((j) => (
                    <SelectItem key={j} value={j} className="text-xs">{j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[160px]">
              <Label className="text-xs">Execution</Label>
              <Select value={executionMode} onValueChange={(v) => setExecutionMode(v as 'pattern' | 'queen')}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="queen" className="text-xs">Queen AG-UI (live trace)</SelectItem>
                  <SelectItem value="pattern" className="text-xs">Pattern API (direct)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <code className="flex-1 min-w-[200px] text-xs font-mono bg-muted px-2 py-1.5 rounded border truncate">
              {executionMode === 'queen' ? nv('stream') : activePattern.path}
            </code>
            <Button onClick={executeRequest} disabled={loading} className="bg-purple-600 hover:bg-purple-700 text-white shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="ml-2">{loading ? 'Running…' : 'Execute'}</span>
            </Button>
          </div>

          <div className="flex flex-1 overflow-hidden flex-col xl:flex-row min-h-0">
            <div className="xl:w-1/2 border-b xl:border-b-0 xl:border-r border-border flex flex-col min-h-[200px]">
              <div className="px-4 py-2 border-b flex justify-between items-center">
                <p className="text-xs font-medium text-muted-foreground uppercase">Task / Request JSON</p>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setRequestBodyEdit(requestBody)}>
                  <RefreshCw className="h-3 w-3 mr-1" />Reset
                </Button>
              </div>
              <Textarea
                value={requestBodyEdit || requestBody}
                onChange={(e) => setRequestBodyEdit(e.target.value)}
                className="flex-1 font-mono text-xs border-0 rounded-none resize-none min-h-[120px]"
                spellCheck={false}
              />
            </div>

            <div className="xl:w-1/2 flex flex-col min-h-[200px]">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
                <div className="px-4 py-2 border-b flex items-center justify-between shrink-0">
                  <TabsList className="h-7">
                    <TabsTrigger value="response" className="text-xs h-6">Response</TabsTrigger>
                    <TabsTrigger value="steps" className="text-xs h-6">Steps ({executionSteps.length || railEvents.length})</TabsTrigger>
                    <TabsTrigger value="history" className="text-xs h-6">History</TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-2">
                    {statusCode !== null && (
                      <Badge className={statusCode >= 200 && statusCode < 300 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}>
                        {statusCode}
                      </Badge>
                    )}
                    {latencyMs !== null && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />{latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>

                <TabsContent value="response" className="flex-1 m-0 overflow-hidden">
                  {responseBody ? (
                    <ScrollArea className="h-full p-4">
                      <pre className="font-mono text-xs whitespace-pre-wrap">{responseBody}</pre>
                    </ScrollArea>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground/50">
                      <Terminal className="h-10 w-10 opacity-30" />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="steps" className="flex-1 m-0 overflow-auto p-3 space-y-3">
                  {executionMode === 'queen' && railEvents.length > 0 && (
                    <ExecutionTraceRail
                      events={railEvents}
                      orchestrationId={orchestrationId}
                      title="Queen orchestration"
                      compact
                      outcome={railOutcome}
                    />
                  )}
                  {executionSteps.length > 0 && (
                    <div className="space-y-2">
                      {executionSteps.map((step, i) => (
                        <div key={i} className="border rounded-lg p-3 text-xs font-mono bg-muted/30">
                          <div className="flex items-center gap-1 text-purple-700 font-sans font-medium mb-1">
                            <ChevronRight className="h-3 w-3" />Step {i + 1}
                          </div>
                          <pre className="whitespace-pre-wrap">{JSON.stringify(step, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                  {!railEvents.length && !executionSteps.length && (
                    <p className="text-sm text-muted-foreground text-center py-8">Run Execute to see agent steps</p>
                  )}
                </TabsContent>

                <TabsContent value="history" className="flex-1 m-0 overflow-hidden">
                  <ScrollArea className="h-full p-3">
                    {history.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => { setResponseBody(h.responseBody); setStatusCode(h.statusCode); setActiveTab('response'); }}
                        className="w-full text-left p-3 mb-2 border rounded-lg hover:bg-muted/50 text-xs"
                      >
                        <span className="font-mono bg-purple-50 px-1 rounded">{h.pattern}</span>
                        <span className="ml-2">{h.statusCode}</span>
                        <span className="float-right">{h.latencyMs}ms</span>
                      </button>
                    ))}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>
    </NyvPageShell>
  );
}
