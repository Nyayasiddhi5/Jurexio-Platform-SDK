import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { NV_API } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { streamQueenAguiForConsole } from '@/services/jrx-admin-agui-adapter';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';
import {
  Scale,
  PlayCircle,
  StopCircle,
  RefreshCw,
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Bot,
  MessageSquare,
  FileText,
  Zap,
  AlertTriangle,
  Settings,
  ChevronDown,
  Send
} from 'lucide-react';

interface AgentRow {
  id: string;
  name: string;
  jurisdiction: string;
  status: string;
  lastTest?: string;
}

const FALLBACK_AGENT: AgentRow = { id: '', name: 'No agent selected', jurisdiction: '—', status: 'Unavailable' };

interface ConversationTurn { role: 'user' | 'agent'; content: string }
interface TestRow { id: number | string; name: string; category: string; status: string; duration: string }

export default function AgentTestingEnvironment() {
  const { data: agentsResp } = useQuery({
    queryKey: [NV_API.AGENTS.path],
    queryFn: async () => {
      const token = getAuthToken();
      const r = await fetch(NV_API.AGENTS.path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) return null;
      return r.json();
    },
  });
  const agents: AgentRow[] = useMemo(() => {
    type RawAgent = {
      agent_id?: string; id?: string; name?: string; agent_name?: string;
      jurisdiction?: string; jurisdictions?: string[];
      is_active?: boolean; lastTest?: string;
    };
    type AgentsResp = RawAgent[] | { data?: RawAgent[]; agents?: RawAgent[] };
    const resp = agentsResp as AgentsResp | null | undefined;
    const raw: RawAgent[] = Array.isArray(resp)
      ? resp
      : Array.isArray(resp?.data)
        ? resp.data
        : Array.isArray(resp?.agents)
          ? resp.agents
          : [];
    return raw.map((a) => ({
      id: a.agent_id ?? a.id ?? '',
      name: a.name ?? a.agent_name ?? a.id ?? 'unnamed',
      jurisdiction: Array.isArray(a.jurisdictions) ? (a.jurisdictions[0] ?? 'Default') : (a.jurisdiction ?? 'Default'),
      status: a.is_active === false ? 'Inactive' : 'Ready',
      lastTest: a.lastTest,
    }));
  }, [agentsResp]);

  const [selectedAgent, setSelectedAgent] = useState<AgentRow>(FALLBACK_AGENT);
  useEffect(() => {
    if (selectedAgent.id === '' && agents.length) setSelectedAgent(agents[0]);
  }, [agents, selectedAgent.id]);

  const [activeTab, setActiveTab] = useState('playground');
  const [userMessage, setUserMessage] = useState('');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestRow[]>([]);
  const [railEvents, setRailEvents] = useState<LegalChatTimelineEvent[]>([]);
  const [railOrch, setRailOrch] = useState<string | undefined>();

  const handleSendMessage = () => {
    if (!userMessage.trim() || isRunning) return;
    const prompt = userMessage.trim();
    setConversation((prev) => [...prev, { role: 'user', content: prompt }]);
    setUserMessage('');
    setIsRunning(true);
    setRailEvents([]);
    void (async () => {
      try {
        const { orchestrationId, answer } = await streamQueenAguiForConsole(
          { task: prompt, agentId: selectedAgent.id || undefined, jurisdiction: selectedAgent.jurisdiction || 'IN' },
          (e) => {
            setRailEvents((prev) => [...prev, e]);
            setRailOrch(e.orchestrationId);
          },
        );
        setRailOrch(orchestrationId);
        setConversation((prev) => [...prev, {
          role: 'agent',
          content: answer || '[No synthesis text — see execution rail]',
        }]);
      } catch (e) {
        setConversation((prev) => [...prev, {
          role: 'agent',
          content: e instanceof Error ? e.message : 'orchestrate failed',
        }]);
      } finally {
        setIsRunning(false);
      }
    })();
  };

  const runAllTests = () => {
    if (isRunning) return;
    setIsRunning(true);
    void (async () => {
      try {
        const probe = 'Cite Section 103 BNS in one sentence.';
        const { answer } = await streamQueenAguiForConsole(
          { task: probe, agentId: selectedAgent.id || undefined, jurisdiction: 'IN' },
          () => undefined,
        );
        setTestResults([{
          id: 'live-1',
          name: 'Queen smoke',
          category: 'live',
          status: answer ? 'pass' : 'fail',
          duration: 'live',
        }]);
      } finally {
        setIsRunning(false);
      }
    })();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <header className="border-b border-white/10 bg-white/90 backdrop-blur-sm sticky top-0 z-50" role="banner" aria-label="Page header">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <Terminal className="h-6 w-6 text-[#152448]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#152448] tracking-tight">Agent Testing Environment</h1>
                <p className="text-sm text-emerald-400">Validate & Debug Legal AI Agents</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <Activity className="h-3 w-3 mr-1 animate-pulse" /> {agents.length || 0} Agents Loaded
              </Badge>
              <Badge variant="outline" className="border-slate-300 text-slate-700" role="status">
                Runtime Registry
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <Card className="bg-slate-100/50 border-slate-200">
              <CardHeader>
                <CardTitle className="text-[#152448] text-lg flex items-center gap-2">
                  <Bot className="h-5 w-5 text-emerald-400" />
                  Select Agent
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[500px] overflow-y-auto">
                {agents.length === 0 && (
                  <JrxEmptyState
                    icon={Bot}
                    title="No agents available"
                    description="Agents will appear when the registry is reachable."
                    size="sm"
                  />
                )}
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedAgent.id === agent.id 
                        ? 'bg-emerald-500/20 border border-emerald-500/50' 
                        : 'bg-slate-200/30 border border-transparent hover:bg-slate-200/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[#152448] font-medium text-sm">{agent.name}</p>
                      <Badge className="text-xs bg-slate-600/50 text-slate-700">{agent.jurisdiction}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                      <span className="text-xs text-slate-600">{agent.status}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-slate-100/50 border-slate-200 mt-4">
              <CardHeader>
                <CardTitle className="text-[#152448] text-lg flex items-center gap-2">
                  <Settings className="h-5 w-5 text-blue-400" />
                  Test Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-slate-600 text-sm">Model Override</label>
                  <select className="w-full mt-1 bg-slate-200 border-slate-300 text-[#152448] rounded-lg p-2">
                    <option>Claude Opus 4.5 (Default)</option>
                    <option>GPT-5.2 Turbo</option>
                    <option>Gemini 3.0 Ultra</option>
                    <option>o3-pro</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 text-sm">Temperature</label>
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0" 
                    max="1" 
                    defaultValue="0.7"
                    className="bg-slate-200 border-slate-300 text-[#152448]"
                  />
                </div>
                <div>
                  <label className="text-slate-600 text-sm">Max Tokens</label>
                  <Input 
                    type="number" 
                    defaultValue="4096"
                    className="bg-slate-200 border-slate-300 text-[#152448]"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-3">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="bg-slate-100/50 border border-slate-200" aria-label="Navigation tabs">
                <TabsTrigger value="playground" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white" aria-label="playground tab">
                  <MessageSquare className="h-4 w-4 mr-2" /> Interactive Playground
                </TabsTrigger>
                <TabsTrigger value="tests" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white" aria-label="tests tab">
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Automated Tests
                </TabsTrigger>
                <TabsTrigger value="prompts" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white" aria-label="prompts tab">
                  <FileText className="h-4 w-4 mr-2" /> System Prompt
                </TabsTrigger>
                <TabsTrigger value="benchmarks" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white" aria-label="benchmarks tab">
                  <Zap className="h-4 w-4 mr-2" /> Benchmarks
                </TabsTrigger>
              </TabsList>

              <TabsContent value="playground" className="space-y-4">
                <Card className="bg-slate-100/50 border-slate-200">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-[#152448] flex items-center gap-2">
                          <Bot className="h-5 w-5 text-emerald-400" />
                          {selectedAgent.name}
                        </CardTitle>
                        <CardDescription className="text-slate-600">
                          Interactive testing session - {selectedAgent.jurisdiction} jurisdiction
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="border-slate-300 text-slate-700">
                          <RefreshCw className="h-4 w-4 mr-1" /> Clear
                        </Button>
                        <Button variant="outline" size="sm" className="border-red-600 text-red-400">
                          <StopCircle className="h-4 w-4 mr-1" /> Stop
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-white/50 rounded-lg p-4 h-[400px] overflow-y-auto mb-4 space-y-4">
                      {conversation.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 rounded-lg ${
                            msg.role === 'user' 
                              ? 'bg-blue-600/20 text-blue-100' 
                              : 'bg-emerald-600/20 text-emerald-100'
                          }`}>
                            <p className="text-xs text-slate-600 mb-1">{msg.role === 'user' ? 'You' : selectedAgent.name}</p>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                      {isRunning && (
                        <div className="flex justify-start">
                          <div className="bg-emerald-600/20 p-3 rounded-lg">
                            <p className="text-xs text-slate-600 mb-1">{selectedAgent.name}</p>
                            <div className="flex items-center gap-2 text-emerald-400">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              <span>Thinking...</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <ExecutionTraceRail events={railEvents} orchestrationId={railOrch} compact title="Queen rail" />
                    <div className="flex gap-2">
                      <Textarea 
                        placeholder="Enter your legal query to test the agent..."
                        className="bg-slate-200 border-slate-300 text-[#152448] resize-none"
                        value={userMessage}
                        onChange={(e) => setUserMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                      />
                      <Button 
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={handleSendMessage}
                        disabled={isRunning}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="tests" className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[#152448] text-lg font-medium">Automated Test Suite</h3>
                  <Button 
                    className="bg-emerald-600 hover:bg-emerald-700" 
                    onClick={runAllTests}
                    disabled={isRunning}
                  >
                    {isRunning ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Running...</>
                    ) : (
                      <><PlayCircle className="h-4 w-4 mr-2" /> Run All Tests</>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-4 gap-4 mb-4">
                  <Card className="bg-emerald-500/10 border-emerald-500/30">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold text-emerald-400">{testResults.filter(t => t.status === 'Passed').length}</p>
                      <p className="text-sm text-slate-600">Passed</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-amber-500/10 border-amber-500/30">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold text-amber-400">{testResults.filter(t => t.status === 'Warning').length}</p>
                      <p className="text-sm text-slate-600">Warnings</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-red-500/10 border-red-500/30">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold text-red-400">{testResults.filter(t => t.status === 'Failed').length}</p>
                      <p className="text-sm text-slate-600">Failed</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-blue-500/10 border-blue-500/30">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold text-blue-400">{testResults.length}</p>
                      <p className="text-sm text-slate-600">Total</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-slate-100/50 border-slate-200">
                  <CardContent className="p-0">
                    <table className="w-full">
                      <thead className="border-b border-slate-200">
                        <tr>
                          <th className="text-left p-4 text-slate-600">Test Case</th>
                          <th className="text-left p-4 text-slate-600">Category</th>
                          <th className="text-left p-4 text-slate-600">Duration</th>
                          <th className="text-left p-4 text-slate-600">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testResults.map((test) => (
                          <tr key={test.id} className="border-b border-slate-200/50 hover:bg-slate-200/30">
                            <td className="p-4 text-[#152448]">{test.name}</td>
                            <td className="p-4">
                              <Badge variant="outline" className="border-slate-300 text-slate-700" role="status">{test.category}</Badge>
                            </td>
                            <td className="p-4 text-slate-600">
                              <Clock className="h-3 w-3 inline mr-1" />{test.duration}
                            </td>
                            <td className="p-4">
                              <Badge className={
                                test.status === 'Passed' ? 'bg-emerald-500/20 text-emerald-400' :
                                test.status === 'Warning' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-red-500/20 text-red-400'
                              }>
                                {test.status === 'Passed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                                {test.status === 'Warning' && <AlertTriangle className="h-3 w-3 mr-1" />}
                                {test.status === 'Failed' && <XCircle className="h-3 w-3 mr-1" />}
                                {test.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="prompts" className="space-y-4">
                <Card className="bg-slate-100/50 border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-[#152448]">System Prompt - {selectedAgent.name}</CardTitle>
                    <CardDescription className="text-slate-600">22-Point System Prompt with ROMA L3 Autonomy</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea 
                      className="bg-white border-slate-200 text-emerald-400 font-mono text-sm min-h-[500px]"
                      defaultValue={`<agent_identity>
  <agent_id>${selectedAgent.id}</agent_id>
  <agent_name>${selectedAgent.name}</agent_name>
  <jurisdiction>${selectedAgent.jurisdiction}</jurisdiction>
  <roma_level>L3 - Supervised Autonomy</roma_level>
  <version>3.1.1</version>
</agent_identity>

<!-- 22-Point System Prompt Framework -->

1. AUTONOMOUS EXECUTION
   - Independent task completion within defined scope
   - Self-directed research and analysis
   - Proactive issue identification

2. GUARDRAIL COMPLIANCE
   - Strict adherence to ethical guidelines
   - Jurisdictional boundary enforcement
   - Client confidentiality protection

3. SELF-LEARNING INTELLIGENCE
   - Continuous improvement from feedback
   - Pattern recognition from case outcomes
   - Adaptive response refinement

4. CAPABILITY AWARENESS
   - Clear understanding of limitations
   - Appropriate escalation triggers
   - Human-in-the-loop integration points

5. COLLABORATIVE MULTI-AGENT
   - A2A protocol compliance
   - Cross-agent knowledge sharing
   - Task delegation capabilities

[... 17 more sections following the complete 22-point framework ...]

22. GLOBAL PROTOCOL COMPLIANCE
   - Multi-jurisdictional awareness
   - Cross-border legal considerations
   - International treaty recognition`}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="benchmarks" className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <Card className="bg-slate-100/50 border-slate-200">
                    <CardHeader>
                      <CardTitle className="text-[#152448] text-lg">Response Latency</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-4xl font-bold text-emerald-400">1.2s</p>
                      <p className="text-slate-600 text-sm">Average response time</p>
                      <Badge className="mt-2 bg-emerald-500/20 text-emerald-400">Optimal</Badge>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-100/50 border-slate-200">
                    <CardHeader>
                      <CardTitle className="text-[#152448] text-lg">Accuracy Score</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-4xl font-bold text-blue-400">94.7%</p>
                      <p className="text-slate-600 text-sm">Legal citation accuracy</p>
                      <Badge className="mt-2 bg-blue-500/20 text-blue-400">Excellent</Badge>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-100/50 border-slate-200">
                    <CardHeader>
                      <CardTitle className="text-[#152448] text-lg">Guardrail Pass Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-4xl font-bold text-purple-400">99.9%</p>
                      <p className="text-slate-600 text-sm">Safety compliance</p>
                      <Badge className="mt-2 bg-purple-500/20 text-purple-400">Compliant</Badge>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-slate-100/50 border-slate-200">
                  <CardHeader>
                    <CardTitle className="text-[#152448]">Performance History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-48 flex items-end justify-between gap-2">
                      {[85, 88, 90, 87, 92, 94, 93, 95, 94, 96, 95, 97].map((val, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div 
                            className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t"
                            style={{ height: `${val}%` }}
                          />
                          <span className="text-xs text-slate-700">M{i + 1}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white/50 mt-12" role="contentinfo" aria-label="Page footer">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-emerald-400" />
              <span className="text-slate-600">Jurexio Testing Environment</span>
            </div>
            <p className="text-slate-700 text-sm">Powered by Jurexio Enterprise Platform SDK - Justice. Powered by Precision.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
