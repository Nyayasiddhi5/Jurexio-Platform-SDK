import { getAuthToken } from '@/lib/jrx-auth-token';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';
/**
 * TwinDesk™ — Customer Digital Twin Creator
 * Jurexio Enterprise Platform 312 | Legal Professional Digital Twins
 *
 * Features:
 *   - Create legal professional digital twins (5 personas)
 *   - Monte Carlo scenario simulation
 *   - Real-time chat with twin persona
 *   - Benchmark scoring across 5 dimensions
 *   - Outcome probability breakdown
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NyvGovernanceBadge } from '@/components/NyvGovernanceBadge';
import {
  Brain, Plus, MessageSquare, BarChart3, Play, Trash2,
  Users, Shield, Briefcase, Scale, Bot, Send, Loader2,
  CheckCircle, TrendingUp, TrendingDown, Clock, AlertTriangle,
  ChevronRight, Activity, Target, Zap, Star, RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type Persona = 'managing-partner' | 'senior-litigator' | 'compliance-head' | 'corporate-counsel' | 'custom';
type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';

interface TwinProfile {
  twinId: string;
  name: string;
  persona: Persona;
  expertise: string;
  jurisdiction: string;
  yearsExperience: number;
  riskTolerance: RiskTolerance;
  philosophy?: string;
  strengths: string[];
  simulationCount: number;
  createdAt: string;
}

interface SimulationResult {
  scenarioId: string;
  scenario: string;
  task: string;
  outcomes: Array<{ description: string; probability: number; timeline?: string; financialImpact?: { min: number; max: number; currency: string } }>;
  recommendation: string;
  twinOpinion: string;
  confidence: number;
  simulatedAt: string;
}

interface ChatMessage {
  role: 'user' | 'twin';
  content: string;
  timestamp: string;
  recommendations?: string[];
}

interface BenchmarkResult {
  overallScore: number;
  dimensions: Array<{ name: string; score: number; benchmark: number }>;
  completedAt: string;
}

const PERSONA_META: Record<Persona, { icon: React.ReactNode; color: string; label: string; tagline: string }> = {
  'managing-partner':  { icon: <Briefcase className="h-5 w-5" />,   color: 'from-blue-600 to-indigo-700',   label: 'Managing Partner', tagline: 'Commercial-first, settlement-oriented' },
  'senior-litigator':  { icon: <Scale className="h-5 w-5" />,        color: 'from-red-600 to-rose-700',      label: 'Senior Litigator', tagline: 'Aggressive, discovery-first' },
  'compliance-head':   { icon: <Shield className="h-5 w-5" />,       color: 'from-green-600 to-emerald-700', label: 'Chief Compliance Officer', tagline: 'Prevention-first, regulatory expert' },
  'corporate-counsel': { icon: <Users className="h-5 w-5" />,        color: 'from-purple-600 to-violet-700', label: 'Corporate Counsel', tagline: 'Commercially pragmatic, deal-focused' },
  'custom':            { icon: <Brain className="h-5 w-5" />,         color: 'from-orange-600 to-amber-700',  label: 'Custom Persona', tagline: 'Fully configurable' },
};

const RISK_COLORS: Record<RiskTolerance, string> = {
  conservative: 'text-green-400 bg-green-500/15 border-green-500/30',
  moderate:     'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  aggressive:   'text-red-400 bg-red-500/15 border-red-500/30',
};

const EMPTY_TWIN: TwinProfile = {
  twinId: '',
  name: 'No twin available',
  persona: 'managing-partner',
  expertise: '—',
  jurisdiction: 'IN',
  yearsExperience: 0,
  riskTolerance: 'moderate',
  philosophy: '',
  strengths: [],
  simulationCount: 0,
  createdAt: new Date().toISOString(),
};

const SCENARIO_PRESETS = [
  { label: 'Hostile Takeover Defence', value: 'hostile-takeover', task: 'Our board has received a hostile takeover bid at 20% premium. What is our legal strategy?' },
  { label: 'Data Breach Response', value: 'data-breach', task: 'A critical data breach has exposed 2 million customer records. What are our immediate legal obligations under DPDPA 2023?' },
  { label: 'Joint Venture Dispute', value: 'jv-dispute', task: 'Our JV partner has breached the JVA by competing directly. What are our legal options and likely outcomes?' },
  { label: 'Employment Class Action', value: 'employment-class', task: 'Former employees are organizing a class action for unpaid ESOPs. Assess our exposure and recommended strategy.' },
];

export default function DigitalTwinCreator() {
  const { toast } = useToast();
  const [twins, setTwins] = useState<TwinProfile[]>([]);
  const [twinsLoading, setTwinsLoading] = useState(true);
  const [twinsError, setTwinsError] = useState<string | null>(null);
  const [selectedTwin, setSelectedTwin] = useState<TwinProfile>(EMPTY_TWIN);
  const [activeTab, setActiveTab] = useState('profile');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState(SCENARIO_PRESETS[0].value);
  const [showCreate, setShowCreate] = useState(false);
  const [newTwinName, setNewTwinName] = useState('');
  const [newPersona, setNewPersona] = useState<Persona>('managing-partner');
  const [newExpertise, setNewExpertise] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const twinsQuery = useQuery<{ success: boolean; twins: TwinProfile[]; error?: string }>({
    queryKey: [p('TWINDESK_TWINS')],
    queryFn: () => nvFetchJson<{ success: boolean; twins: TwinProfile[]; error?: string }>(p('TWINDESK_TWINS')),
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (twinsQuery.isLoading) {
      setTwinsLoading(true);
      return;
    }
    setTwinsLoading(false);
    if (twinsQuery.error) {
      setTwinsError((twinsQuery.error as Error).message);
      return;
    }
    if (twinsQuery.data?.success && Array.isArray(twinsQuery.data.twins)) {
      setTwins(twinsQuery.data.twins);
      if (twinsQuery.data.twins.length > 0) {
        setSelectedTwin((cur) => cur.twinId ? cur : twinsQuery.data!.twins[0]);
      }
    } else if (twinsQuery.data) {
      setTwinsError(twinsQuery.data.error ?? 'Unexpected response');
    }
  }, [twinsQuery.data, twinsQuery.error, twinsQuery.isLoading]);

  const runSimulation = useCallback(async () => {
    const scenarioObj = SCENARIO_PRESETS.find((s) => s.value === selectedScenario)!;
    setSimulating(true);
    setSimResult(null);

    try {
      const token = getAuthToken();
      const res = await fetch(p('TWINDESK_SIMULATE').replace(':twinId', selectedTwin.twinId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scenario: scenarioObj.label, task: scenarioObj.task }),
      });
      const data = await res.json();
      if (data.success) {
        setSimResult(data.simulation);
      } else {
        toast({
          title: 'Simulation failed',
          description: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      toast({
        title: 'Simulation failed',
        description: err instanceof Error ? err.message : 'Network error',
        variant: 'destructive',
      });
    } finally {
      setSimulating(false);
    }
  }, [selectedTwin, selectedScenario]);

  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: 'user', content: chatInput, timestamp: new Date().toISOString() };
    setChatMessages((prev) => [...prev, userMsg]);
    const sentText = chatInput;
    setChatInput('');
    setChatLoading(true);

    try {
      const token = getAuthToken();
      const res = await fetch(p('TWINDESK_CHAT').replace(':twinId', selectedTwin.twinId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: sentText, sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        setSessionId(data.sessionId);
        setChatMessages((prev) => [...prev, {
          role: 'twin',
          content: data.response,
          timestamp: new Date().toISOString(),
          recommendations: data.recommendations,
        }]);
      } else {
        toast({
          title: 'Twin chat failed',
          description: typeof data.error === 'string' ? data.error : 'Unexpected response',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      toast({
        title: 'Twin chat failed',
        description: err instanceof Error ? err.message : 'Network error',
        variant: 'destructive',
      });
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, selectedTwin, sessionId]);

  const runBenchmark = async () => {
    setBenchmarking(true);
    try {
      const token = getAuthToken();
      const res = await fetch(p('TWINDESK_BENCHMARK').replace(':twinId', selectedTwin.twinId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setBenchmark(data);
      } else {
        toast({
          title: 'Benchmark failed',
          description: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      toast({
        title: 'Benchmark failed',
        description: err instanceof Error ? err.message : 'Network error',
        variant: 'destructive',
      });
    } finally {
      setBenchmarking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Brain className="h-5 w-5 text-slate-900" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">TwinDesk™</h1>
              <p className="text-xs text-slate-700">Customer Legal Digital Twin Product — Jurexio Enterprise Platform 312</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-xs" role="status">{twins.length} Twins</Badge>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-xs" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Create Twin
            </Button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Twin List */}
        <div className="w-72 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-200">
            <p className="text-xs text-slate-700 uppercase tracking-wider px-1">Digital Twins ({twins.length})</p>
          </div>
          <ScrollArea className="flex-1" aria-label="Scrollable content">
            <div className="p-2 space-y-1">
              {twinsLoading ? (
                <div className="space-y-2 p-2" data-testid="twins-loading">
                  {[0,1,2].map((i) => <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />)}
                </div>
              ) : twinsError ? (
                <div className="p-6 text-center text-xs text-red-500" data-testid="twins-error">
                  <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-60" />
                  <p>Could not load twins</p>
                  <p className="text-slate-600 mt-1">{twinsError}</p>
                </div>
              ) : twins.length === 0 ? (
                <NyvEmptyState
                  icon={Brain}
                  title="No digital twins yet"
                  description="Create your first legal professional twin to run scenario simulations, chat with the persona and benchmark its judgement."
                  size="sm"
                  variant="card"
                  cta={{ label: 'Create First Twin', onClick: () => setShowCreate(true) }}
                />
              ) : null}
              {twins.map((twin) => {
                const meta = PERSONA_META[twin.persona];
                return (
                  <button key={twin.twinId}
                    onClick={() => { setSelectedTwin(twin); setSimResult(null); setChatMessages([]); setSessionId(undefined); setActiveTab('profile'); }}
                    className={`w-full text-left p-3 rounded-lg transition-all ${
                      selectedTwin.twinId === twin.twinId
                        ? 'bg-purple-500/10 border border-purple-500/20'
                        : 'hover:bg-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${meta.color} flex items-center justify-center shrink-0`}>
                        {meta.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{twin.name}</p>
                        <p className="text-xs text-slate-600">{meta.label}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs border ${RISK_COLORS[twin.riskTolerance]}`}>
                        {twin.riskTolerance}
                      </Badge>
                      <span className="text-xs text-slate-600">{twin.simulationCount} sims</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
            <div className="border-b border-slate-200 bg-white px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-7 w-7 rounded-lg bg-gradient-to-br ${PERSONA_META[selectedTwin.persona].color} flex items-center justify-center`}>
                  {PERSONA_META[selectedTwin.persona].icon}
                </div>
                <div>
                  <h2 className="text-sm font-semibold">{selectedTwin.name}</h2>
                  <p className="text-xs text-slate-600">{PERSONA_META[selectedTwin.persona].tagline}</p>
                </div>
              </div>
            </div>
            <div className="border-b border-slate-200 bg-white px-4">
              <TabsList className="bg-transparent border-0 p-0 h-8 gap-1" aria-label="Navigation tabs">
                {[
                  { id: 'profile', label: 'Profile', icon: <Users className="h-3.5 w-3.5" /> },
                  { id: 'simulate', label: 'Simulate', icon: <Target className="h-3.5 w-3.5" /> },
                  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-3.5 w-3.5" /> },
                  { id: 'benchmark', label: 'Benchmark', icon: <BarChart3 className="h-3.5 w-3.5" /> },
                ].map((t) => (
                  <TabsTrigger key={t.id} value={t.id}
                    className="text-xs h-8 data-[state=active]:bg-slate-100 text-slate-700 data-[state=active]:text-slate-900 rounded flex items-center gap-1.5 px-3">
                    {t.icon}{t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* PROFILE */}
            <TabsContent value="profile" className="flex-1 m-0 overflow-auto p-5">
              <div className="max-w-2xl space-y-4">
                <div className={`h-24 rounded-xl bg-gradient-to-r ${PERSONA_META[selectedTwin.persona].color} bg-opacity-20 flex items-center gap-5 px-6`}>
                  <div className="h-14 w-14 rounded-xl bg-slate-200 flex items-center justify-center">
                    {PERSONA_META[selectedTwin.persona].icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{selectedTwin.name}</h3>
                    <p className="text-sm opacity-80">{PERSONA_META[selectedTwin.persona].label} · {selectedTwin.jurisdiction}</p>
                    <p className="text-xs opacity-60">{selectedTwin.yearsExperience} years · {selectedTwin.expertise}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-700 mb-1">Risk Tolerance</p>
                      <Badge className={`border ${RISK_COLORS[selectedTwin.riskTolerance]}`}>{selectedTwin.riskTolerance}</Badge>
                    </CardContent>
                  </Card>
                  <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-700 mb-1">Total Simulations</p>
                      <p className="text-xl font-bold">{selectedTwin.simulationCount}</p>
                    </CardContent>
                  </Card>
                </div>
                {selectedTwin.philosophy && (
                  <Card className="bg-white border-slate-200">
                    <CardContent className="p-4">
                      <p className="text-xs text-slate-700 mb-2">Legal Philosophy</p>
                      <p className="text-sm text-slate-700 italic">"{selectedTwin.philosophy}"</p>
                    </CardContent>
                  </Card>
                )}
                <Card className="bg-white border-slate-200">
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-700 mb-2">Core Strengths</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedTwin.strengths.map((s) => (
                        <Badge key={s} variant="outline" className="border-purple-500/30 text-purple-300 text-xs" role="status">{s}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* SIMULATE */}
            <TabsContent value="simulate" className="flex-1 m-0 overflow-auto p-5">
              <div className="max-w-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <Select value={selectedScenario} onValueChange={setSelectedScenario} aria-label="Select option">
                    <SelectTrigger className="bg-slate-100 border-slate-200 text-slate-900 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {SCENARIO_PRESETS.map((s) => (
                        <SelectItem key={s.value} value={s.value} className="text-slate-900 hover:bg-slate-100">{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={runSimulation} disabled={simulating} className="bg-purple-600 hover:bg-purple-700">
                    {simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    <span className="ml-2">Simulate</span>
                  </Button>
                </div>

                {SCENARIO_PRESETS.find((s) => s.value === selectedScenario)?.task && (
                  <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-600">
                    <strong className="text-slate-700">Scenario:</strong> {SCENARIO_PRESETS.find((s) => s.value === selectedScenario)?.task}
                  </div>
                )}

                {simResult && (
                  <div className="space-y-4">
                    <NyvGovernanceBadge compact governance={{
                      risk_score: Math.round((1 - simResult.confidence) * 60),
                      risk_badge: simResult.confidence >= 0.85 ? 'GREEN' : simResult.confidence >= 0.70 ? 'YELLOW' : 'RED',
                      risk_blocked: false,
                      pattern_key: 'TWINDESK',
                      warnings: ['Digital Twin™ simulations are probabilistic projections, not legal advice. Outcomes require qualified advocate review.'],
                      audit_hash: simResult.scenarioId,
                      timestamp: simResult.simulatedAt,
                    }} />
                    <Card className="bg-purple-500/10 border-purple-500/20">
                      <CardContent className="p-4">
                        <p className="text-xs text-purple-400 mb-1 font-medium">Twin Opinion ({Math.round(simResult.confidence * 100)}% confidence)</p>
                        <p className="text-sm text-slate-700">{simResult.twinOpinion}</p>
                      </CardContent>
                    </Card>

                    <div className="space-y-2">
                      <p className="text-xs text-slate-700 uppercase tracking-wider">Monte Carlo Outcomes</p>
                      {simResult.outcomes.map((outcome, i) => (
                        <div key={i} className="p-3 bg-white border border-slate-200 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium">{outcome.description}</p>
                            <Badge className={`${outcome.probability > 0.45 ? 'bg-green-500/20 text-green-400' : outcome.probability > 0.25 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'} border-0`}>
                              {Math.round(outcome.probability * 100)}%
                            </Badge>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full">
                            <div className="h-1.5 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
                              style={{ width: `${outcome.probability * 100}%` }} />
                          </div>
                          {outcome.timeline && <p className="text-xs text-slate-600 mt-1">Timeline: {outcome.timeline}</p>}
                          {outcome.financialImpact && (
                            <p className="text-xs text-slate-600 mt-0.5">
                              Financial impact: ₹{(outcome.financialImpact.min / 100000).toFixed(0)}L – ₹{(outcome.financialImpact.max / 10000000).toFixed(1)}Cr
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* CHAT */}
            <TabsContent value="chat" className="flex-1 m-0 flex flex-col overflow-hidden p-4 gap-3">
              <div className="flex items-center gap-2 p-2 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-300">
                <Brain className="h-3.5 w-3.5 shrink-0" />
                Chatting with <strong>{selectedTwin.name}</strong> ({selectedTwin.persona} · {selectedTwin.riskTolerance} risk profile)
              </div>
              <ScrollArea className="flex-1 bg-slate-100 rounded-lg border border-slate-200 p-4" aria-label="Scrollable content">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm">
                    <div className="text-center">
                      <Brain className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      <p>Ask {selectedTwin.name} for legal advice</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                          msg.role === 'user'
                            ? 'bg-purple-600 text-slate-50'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          <p>{msg.content}</p>
                          {msg.recommendations && (
                            <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                              {msg.recommendations.map((r, j) => (
                                <p key={j} className="text-xs text-slate-600 flex items-center gap-1">
                                  <ChevronRight className="h-3 w-3 shrink-0" />{r}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-slate-100 rounded-xl px-4 py-3 border border-slate-200">
                          <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </ScrollArea>
              <div className="flex items-center gap-2">
                <Input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                  placeholder={`Ask ${selectedTwin.name}...`}
                  className="bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
                <Button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </TabsContent>

            {/* BENCHMARK */}
            <TabsContent value="benchmark" className="flex-1 m-0 overflow-auto p-5">
              <div className="max-w-lg space-y-4">
                <Button onClick={runBenchmark} disabled={benchmarking} className="bg-purple-600 hover:bg-purple-700">
                  {benchmarking ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Benchmarking...</> : <><BarChart3 className="h-4 w-4 mr-2" />Run Benchmark</>}
                </Button>
                {benchmark && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                      <div className="h-16 w-16 rounded-full border-4 border-purple-500 flex items-center justify-center">
                        <span className="text-xl font-bold text-purple-300">{benchmark.overallScore}</span>
                      </div>
                      <div>
                        <p className="text-lg font-bold">Overall Score</p>
                        <p className="text-sm text-slate-700">Compared against industry benchmark</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {benchmark.dimensions.map((d) => (
                        <div key={d.name}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-600">{d.name}</span>
                            <span className="font-medium text-purple-300">{d.score} <span className="text-slate-600">/ {d.benchmark} benchmark</span></span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full">
                            <div className={`h-2 rounded-full ${d.score >= d.benchmark ? 'bg-gradient-to-r from-purple-500 to-indigo-500' : 'bg-gradient-to-r from-orange-500 to-red-500'}`}
                              style={{ width: `${d.score}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Create Twin Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="bg-white border-slate-200 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-slate-900">Create Digital Twin</CardTitle>
              <CardDescription className="text-slate-700">Configure your legal professional twin</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-slate-600 text-sm">Twin Name *</Label>
                <Input value={newTwinName} onChange={(e) => setNewTwinName(e.target.value)}
                  placeholder="e.g. Arjun Mehta — Partner Twin"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Persona</Label>
                <Select value={newPersona} onValueChange={(v) => setNewPersona(v as Persona)}>
                  <SelectTrigger className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    {(Object.keys(PERSONA_META) as Persona[]).map((p) => (
                      <SelectItem key={p} value={p} className="text-slate-900 hover:bg-slate-100">{PERSONA_META[p].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-600 text-sm">Area of Expertise *</Label>
                <Input value={newExpertise} onChange={(e) => setNewExpertise(e.target.value)}
                  placeholder="e.g. M&A and Cross-Border Disputes"
                  className="mt-1.5 bg-slate-100 border-slate-200 text-slate-900 placeholder:text-slate-600" />
              </div>
            </CardContent>
            <div className="flex gap-3 px-6 pb-6">
              <Button variant="outline" className="flex-1 border-slate-200 text-slate-600" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1 bg-purple-600 hover:bg-purple-700" onClick={async () => {
                if (!newTwinName || !newExpertise) return;
                try {
                  const token = getAuthToken();
                  const res = await fetch(p('TWINDESK_TWINS'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      name: newTwinName,
                      persona: newPersona,
                      expertise: newExpertise,
                      jurisdiction: 'IN',
                      yearsExperience: 15,
                      riskTolerance: 'moderate',
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok || !data.success) {
                    const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
                    toast({ title: 'Twin creation failed', description: msg, variant: 'destructive' });
                    return;
                  }
                  setTwins((prev) => [...prev, data.twin]);
                  setSelectedTwin(data.twin);
                  setShowCreate(false);
                  setNewTwinName('');
                  setNewExpertise('');
                  toast({ title: 'Twin created', description: `${data.twin.name} is ready for simulation.` });
                } catch (err: unknown) {
                  toast({ title: 'Twin creation failed', description: err instanceof Error ? err.message : 'Network error', variant: 'destructive' });
                }
              }}>Create Twin</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
