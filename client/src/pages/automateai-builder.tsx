import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_API, p } from '@/lib/jrx-api-paths';
/**
 * AutomateAI™ Builder — Visual Workflow Builder
 * Jurexio Enterprise Platform 312 | Legal Process Automation
 *
 * Features:
 *   - 8 AI decision gate types (drag-and-drop on canvas)
 *   - Workflow execution engine with DAG support
 *   - HITL ApprovalGate with real-time approval flow
 *   - Execution history with node-level drill-down
 *   - Gate type library with input/output schema
 */

import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Workflow, Plus, Play, Pause, Trash2, ChevronRight, Code,
  Brain, Shield, Globe, FileText, Users, ArrowRight, BarChart3,
  CheckCircle, XCircle, Loader2, Clock, AlertTriangle, Zap,
  Settings, Eye, RefreshCw, Activity, BookOpen, Layers
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvGovernanceBadge } from '@/components/NyvGovernanceBadge';

type GateType = 'LegalClassifier' | 'RiskScorer' | 'JurisdictionSelector' | 'ComplianceChecker' | 'DocumentDrafter' | 'ApprovalGate' | 'EscalationRouter' | 'OutcomePredictor';
type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';
type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused_approval';

interface WorkflowDef {
  workflowId: string;
  name: string;
  status: WorkflowStatus;
  nodes: Array<{ nodeId: string; type: GateType; name: string; position: { x: number; y: number } }>;
  jurisdiction: string;
  stats: { totalExecutions: number; successfulExecutions: number; avgExecutionMs: number };
}

interface Execution {
  executionId: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  totalMs?: number;
  nodeExecutions: Array<{
    nodeId: string;
    nodeName: string;
    gateType: string;
    status: string;
    decision?: string;
    confidence?: number;
    explanation?: string;
    latencyMs?: number;
    requiresApproval?: boolean;
  }>;
}

const GATE_META: Record<GateType, { icon: React.ReactNode; color: string; description: string; inputs: string[]; outputs: string[] }> = {
  LegalClassifier:      { icon: <BookOpen className="h-4 w-4" />,    color: 'text-blue-400 bg-blue-500/15 border-blue-500/30',     description: 'Classify matter type', inputs: ['text', 'document'], outputs: ['legalCategory', 'tags'] },
  RiskScorer:           { icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-400 bg-red-500/15 border-red-500/30',      description: 'Compute risk score', inputs: ['document', 'facts'], outputs: ['riskScore', 'riskLevel'] },
  JurisdictionSelector: { icon: <Globe className="h-4 w-4" />,        color: 'text-green-400 bg-green-500/15 border-green-500/30', description: 'Determine governing law', inputs: ['parties', 'contract'], outputs: ['jurisdiction', 'governingLaw'] },
  ComplianceChecker:    { icon: <Shield className="h-4 w-4" />,       color: 'text-purple-400 bg-purple-500/15 border-purple-500/30', description: 'Check regulatory frameworks', inputs: ['document', 'frameworks'], outputs: ['compliant', 'issues'] },
  DocumentDrafter:      { icon: <FileText className="h-4 w-4" />,     color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30', description: 'Generate legal documents', inputs: ['documentType', 'parties'], outputs: ['document', 'clauses'] },
  ApprovalGate:         { icon: <Users className="h-4 w-4" />,        color: 'text-orange-400 bg-orange-500/15 border-orange-500/30', description: 'HITL human checkpoint', inputs: ['approvers', 'deadline'], outputs: ['approved', 'approvedBy'] },
  EscalationRouter:     { icon: <ArrowRight className="h-4 w-4" />,   color: 'text-sky-400 bg-sky-500/15 border-sky-500/30',        description: 'Route to specialist', inputs: ['riskLevel', 'domain'], outputs: ['routedTo', 'priority'] },
  OutcomePredictor:     { icon: <Brain className="h-4 w-4" />,        color: 'text-pink-400 bg-pink-500/15 border-pink-500/30',     description: 'Predict legal outcomes', inputs: ['facts', 'jurisdiction'], outputs: ['outcomes', 'strategy'] },
};

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-500/20 text-green-400 border-green-500/30',
  draft:     'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  paused:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed:    'bg-red-500/20 text-red-400 border-red-500/30',
  running:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
  paused_approval: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

const EMPTY_WORKFLOW: WorkflowDef = {
  workflowId: '',
  name: 'No workflow selected',
  status: 'draft',
  nodes: [],
  jurisdiction: 'IN',
  stats: { totalExecutions: 0, successfulExecutions: 0, avgExecutionMs: 0 },
};

export default function AutomateAIBuilder() {
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [selectedWf, setSelectedWf] = useState<WorkflowDef | null>(EMPTY_WORKFLOW);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [activeTab, setActiveTab] = useState('builder');
  const [executing, setExecuting] = useState(false);
  const [showGateLib, setShowGateLib] = useState(false);
  const [newWfName, setNewWfName] = useState('');
  const [showNewWf, setShowNewWf] = useState(false);

  const wfQuery = useQuery<{ success: boolean; workflows: WorkflowDef[]; error?: string }>({
    queryKey: [p('AUTOMATEAI_WORKFLOWS')],
  });
  const wfLoading = wfQuery.isLoading;
  const wfError = wfQuery.error
    ? (wfQuery.error as Error).message
    : (wfQuery.data && wfQuery.data.success === false ? (wfQuery.data.error ?? 'Unexpected response') : null);

  useEffect(() => {
    if (wfQuery.data?.success && Array.isArray(wfQuery.data.workflows)) {
      setWorkflows(wfQuery.data.workflows);
      setSelectedWf((cur) => cur && cur.workflowId ? cur : (wfQuery.data!.workflows[0] ?? null));
    }
  }, [wfQuery.data]);

  const executeWorkflow = useCallback(async () => {
    if (!selectedWf) return;
    if (selectedWf.status !== 'active') {
      toast({ title: 'Cannot execute', description: 'Activate the workflow first.', variant: 'destructive' });
      return;
    }
    setExecuting(true);
    const execId = `EXEC-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const newExec: Execution = {
      executionId: execId,
      workflowId: selectedWf.workflowId,
      status: 'running',
      startedAt: new Date().toISOString(),
      nodeExecutions: [],
    };
    setExecutions((prev) => [newExec, ...prev]);
    setActiveTab('executions');

    try {
      const token = getAuthToken();
      const res = await fetch(`${NV_API.AUTOMATEAI.path}/workflows/${selectedWf.workflowId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ task: 'Workflow execution', jurisdiction: selectedWf.jurisdiction }),
      });
      const data = (await res.json()) as { execution?: Execution; error?: string };
      if (data.execution) {
        setExecutions((prev) => prev.map((e) => e.executionId === execId ? data.execution! : e));
        toast({ title: `Execution ${data.execution.status}`, description: `${data.execution.nodeExecutions?.length ?? 0} nodes processed` });
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      setExecutions((prev) => prev.map((e) => e.executionId === execId ? { ...e, status: 'failed' } : e));
      toast({
        title: 'Execution failed',
        description: `${message} — backend pending`,
        variant: 'destructive',
      });
    } finally {
      setExecuting(false);
    }
  }, [selectedWf, toast]);

  const toggleStatus = (wf: WorkflowDef) => {
    const newStatus: WorkflowStatus = wf.status === 'active' ? 'paused' : 'active';
    setWorkflows((prev) => prev.map((w) => w.workflowId === wf.workflowId ? { ...w, status: newStatus } : w));
    if (selectedWf?.workflowId === wf.workflowId) setSelectedWf((prev) => prev ? { ...prev, status: newStatus } : prev);
    toast({ title: newStatus === 'active' ? 'Workflow activated' : 'Workflow paused' });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
              <Workflow className="h-5 w-5 text-slate-900" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">AutomateAI™ Builder</h1>
              <p className="text-xs text-slate-700">Visual Legal Workflow Builder — 8 AI Decision Gates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NyvGovernanceBadge compact governance={{ risk_score: 40, risk_badge: 'YELLOW', risk_blocked: false, pattern_key: 'AUTOMATEAI', warnings: ['AI Workflow Automation — Automated legal actions require Maker-Checker review'], timestamp: new Date().toISOString() }} />
            <Badge variant="outline" className="border-orange-500/30 text-orange-400 text-xs" role="status">8 Gate Types</Badge>
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-xs" onClick={() => setShowNewWf(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />New Workflow
            </Button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar */}
        <div className="w-72 border-r border-slate-200 bg-white flex flex-col">
          <div className="p-3 border-b border-slate-200 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-700 uppercase tracking-wider">Workflows ({workflows.length})</p>
            <Button size="sm" variant="ghost" className="h-6 text-xs text-slate-600 hover:text-slate-900"
              onClick={() => setShowGateLib(!showGateLib)}>
              <Layers className="h-3 w-3 mr-1" />Gates
            </Button>
          </div>
          <ScrollArea className="flex-1" aria-label="Scrollable content">
            <div className="p-2 space-y-1">
              {wfLoading ? (
                <div className="space-y-2 p-2" data-testid="wf-loading">
                  {[0,1,2].map((i) => <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />)}
                </div>
              ) : wfError ? (
                <div className="p-6 text-center text-xs text-red-500" data-testid="wf-error">
                  <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-60" />
                  <p>Could not load workflows</p>
                  <p className="text-slate-600 mt-1">{wfError}</p>
                </div>
              ) : workflows.length === 0 ? (
                <NyvEmptyState
                  icon={Workflow}
                  title="No workflows yet"
                  description="Create your first AutomateAI workflow to chain agentic gates (intake, classification, draft, review, approval). Workflows you save will appear here."
                  size="sm"
                  variant="card"
                />
              ) : workflows.map((wf) => (
                <button key={wf.workflowId}
                  onClick={() => { setSelectedWf(wf); setActiveTab('builder'); }}
                  className={`w-full text-left p-3 rounded-lg transition-all ${
                    selectedWf?.workflowId === wf.workflowId
                      ? 'bg-orange-500/10 border border-orange-500/20'
                      : 'hover:bg-white border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-medium truncate">{wf.name}</p>
                    <Badge className={`text-xs border ${STATUS_COLORS[wf.status]} shrink-0`}>{wf.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span>{wf.nodes.length} nodes</span>
                    <span>·</span>
                    <span>{wf.stats.totalExecutions} runs</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedWf ? (
            <div className="flex-1 flex items-center justify-center text-slate-600 p-12 text-center">
              <div>
                <Workflow className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">{wfLoading ? 'Loading workflows…' : 'Select or create a workflow to begin.'}</p>
              </div>
            </div>
          ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
            <div className="border-b border-slate-200 bg-white px-4 flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{selectedWf.name}</h2>
                <Badge className={`text-xs border ${STATUS_COLORS[selectedWf.status]}`}>{selectedWf.status}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline"
                  className="border-slate-200 text-slate-600 hover:bg-white text-xs h-7"
                  onClick={() => toggleStatus(selectedWf)}>
                  {selectedWf.status === 'active' ? <><Pause className="h-3 w-3 mr-1" />Pause</> : <><Play className="h-3 w-3 mr-1" />Activate</>}
                </Button>
                <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-xs h-7"
                  onClick={executeWorkflow} disabled={executing || selectedWf.status !== 'active'}>
                  {executing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                  Execute
                </Button>
              </div>
            </div>

            <div className="border-b border-slate-200 bg-white px-4">
              <TabsList className="bg-transparent border-0 p-0 h-8 gap-1" aria-label="Navigation tabs">
                {[
                  { id: 'builder', label: 'Workflow', icon: <Workflow className="h-3.5 w-3.5" /> },
                  { id: 'executions', label: `Executions (${executions.length})`, icon: <Activity className="h-3.5 w-3.5" /> },
                  { id: 'stats', label: 'Stats', icon: <BarChart3 className="h-3.5 w-3.5" /> },
                ].map((t) => (
                  <TabsTrigger key={t.id} value={t.id}
                    className="text-xs h-8 data-[state=active]:bg-slate-100 text-slate-700 data-[state=active]:text-slate-900 rounded flex items-center gap-1.5 px-3">
                    {t.icon}{t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* BUILDER */}
            <TabsContent value="builder" className="flex-1 m-0 overflow-auto p-6">
              {/* Node Pipeline Visualization */}
              <div className="mb-6 p-4 bg-slate-100 rounded-xl border border-slate-200 overflow-x-auto">
                <p className="text-xs text-slate-600 mb-4 uppercase tracking-wider">Pipeline</p>
                <div className="flex items-center gap-2 min-w-max">
                  <div className="h-8 w-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-green-400" />
                  </div>
                  <div className="text-xs text-green-400 font-medium">START</div>
                  {selectedWf.nodes.map((node, i) => {
                    const meta = GATE_META[node.type];
                    return (
                      <div key={node.nodeId} className="flex items-center gap-2">
                        <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                        <div className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border min-w-[110px] ${meta.color}`}>
                          <div className="flex items-center gap-1.5">
                            {meta.icon}
                            <span className="text-xs font-semibold">{node.type.replace(/([A-Z])/g, ' $1').trim()}</span>
                          </div>
                          <span className="text-xs opacity-70">{node.name}</span>
                        </div>
                      </div>
                    );
                  })}
                  <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                  <div className="h-8 w-8 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-purple-400" />
                  </div>
                  <div className="text-xs text-purple-400 font-medium">END</div>
                </div>
              </div>

              {/* Node Details */}
              <div className="grid grid-cols-2 gap-4">
                {selectedWf.nodes.map((node) => {
                  const meta = GATE_META[node.type];
                  return (
                    <Card key={node.nodeId} className="bg-white border-slate-200">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`h-7 w-7 rounded-lg flex items-center justify-center border ${meta.color}`}>
                            {meta.icon}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{node.name}</p>
                            <p className="text-xs text-slate-600">{node.type}</p>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">{meta.description}</p>
                        <div className="space-y-1">
                          <div className="text-xs text-slate-600">Outputs: {meta.outputs.join(', ')}</div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* EXECUTIONS */}
            <TabsContent value="executions" className="flex-1 m-0 overflow-auto p-4">
              {executions.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-600">
                  <div className="text-center">
                    <Activity className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>No executions yet — click Execute to run this workflow</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {executions.map((exec) => (
                    <Card key={exec.executionId} className="bg-white border-slate-200">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-orange-400">{exec.executionId}</code>
                            <Badge className={`text-xs border ${STATUS_COLORS[exec.status]}`}>{exec.status}</Badge>
                          </div>
                          <div className="text-xs text-slate-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {exec.totalMs ? `${exec.totalMs}ms` : 'In progress...'}
                          </div>
                        </div>
                        {exec.nodeExecutions.length > 0 && (
                          <div className="space-y-2">
                            {exec.nodeExecutions.map((n, i) => (
                              <div key={i} className="flex items-center gap-3 text-xs">
                                {n.status === 'completed' ? <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" /> :
                                 n.status === 'failed' ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" /> :
                                 <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />}
                                <span className="text-slate-600 w-40 truncate">{n.nodeName}</span>
                                {n.decision && <Badge variant="outline" className="border-slate-200 text-slate-600" role="status">{n.decision}</Badge>}
                                {n.confidence && <span className="text-slate-600">{Math.round(n.confidence * 100)}%</span>}
                                {n.latencyMs && <span className="text-slate-600 ml-auto">{n.latencyMs}ms</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* STATS */}
            <TabsContent value="stats" className="flex-1 m-0 overflow-auto p-4">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total Runs', value: selectedWf.stats.totalExecutions, icon: <Activity className="h-5 w-5 text-orange-400" /> },
                  { label: 'Success Rate', value: selectedWf.stats.totalExecutions > 0 ? `${Math.round((selectedWf.stats.successfulExecutions / selectedWf.stats.totalExecutions) * 100)}%` : 'N/A', icon: <CheckCircle className="h-5 w-5 text-green-400" /> },
                  { label: 'Avg Duration', value: selectedWf.stats.avgExecutionMs > 0 ? `${selectedWf.stats.avgExecutionMs}ms` : 'N/A', icon: <Clock className="h-5 w-5 text-blue-400" /> },
                ].map((s) => (
                  <Card key={s.label} className="bg-white border-slate-200">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">{s.icon}<p className="text-xs text-slate-700">{s.label}</p></div>
                      <p className="text-2xl font-bold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
          )}
        </div>
      </div>

      {/* Gate Library Overlay */}
      {showGateLib && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowGateLib(false)}>
          <Card className="bg-white border-slate-200 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-slate-900">AI Gate Library</CardTitle>
              <CardDescription className="text-slate-700">8 AI decision gate types available</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {(Object.entries(GATE_META) as [GateType, (typeof GATE_META)[GateType]][]).map(([type, meta]) => (
                  <div key={type} className={`p-3 rounded-lg border ${meta.color}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {meta.icon}
                      <span className="text-sm font-semibold">{type}</span>
                    </div>
                    <p className="text-xs opacity-70 mb-2">{meta.description}</p>
                    <p className="text-xs opacity-50">→ {meta.outputs.join(', ')}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
