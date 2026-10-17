import { getAuthToken } from '@/lib/jrx-auth-token';
/**
 * HITL Decision Cards Interface
 * Human-in-the-Loop Approval Workflows with Decision Cards
 * 
 * Features:
 * - Structured decision cards with context
 * - Confidence-based escalation
 * - Multi-level approvals
 * - Learning loop integration
 * - Decision history and audit trail
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NV_BASE, nv, p } from '@/lib/jrx-api-paths';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  MessageSquare,
  Bot,
  User,
  ThumbsUp,
  ThumbsDown,
  Edit3,
  Eye,
  History,
  TrendingUp,
  Shield,
  Zap,
  Brain,
  FileText,
  DollarSign,
  Users,
  Activity,
  RefreshCw
} from "lucide-react";

interface DecisionCard {
  id: string;
  type: 'approval' | 'review' | 'escalation' | 'intervention';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'modified' | 'expired';
  title: string;
  summary: string;
  context: {
    agent: string;
    agentAvatar?: string;
    department: string;
    workflow: string;
    triggeredAt: string;
    expiresAt?: string;
  };
  proposedAction: {
    type: string;
    description: string;
    impact: string;
    estimatedCost?: number;
    estimatedTime?: string;
  };
  rationale: string;
  confidenceScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  alternatives?: {
    id: string;
    description: string;
    confidence: number;
  }[];
  relatedDecisions?: string[];
  metadata?: Record<string, any>;
}

interface DecisionHistory {
  id: string;
  cardId: string;
  decision: 'approved' | 'rejected' | 'modified';
  decidedBy: string;
  decidedAt: string;
  feedback?: string;
  modifications?: string;
}

export default function HITLDecisionCards() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCard, setSelectedCard] = useState<DecisionCard | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [modificationText, setModificationText] = useState('');
  const [showModifyDialog, setShowModifyDialog] = useState(false);
  // Fetch HITL queue from DB. Queue endpoint defaults to status=pending; we
  // pass status=all so the page can render the 4-status mix demanded by the
  // demo (pending / approved / rejected / modified). The default page size
  // (50) clips to 30+ seeded fixtures, so we also bump limit to 100.
  // queryClient auto-unwraps the {success,data} envelope, so `pendingData`
  // here is the inner data object: { items, total, limit, offset }.
  interface HitlQueueItem {
    id: string;
    requestId: string;
    agentId: string;
    decision: string | null;
    requestedAt: string;
    requestedBy: string | null;
    tenantId: string | null;
    status: string;
    riskLevel: string;
    reviewerId: string | null;
    slaDeadline: string | null;
    reviewedAt: string | null;
  }
  interface HitlQueuePayload { items?: HitlQueueItem[]; total?: number; limit?: number; offset?: number }
  const { data: pendingData, isLoading: pendingLoading, refetch: refetchPending } = useQuery<HitlQueuePayload>({
    queryKey: [`${p('HITL_QUEUE')}?status=all&limit=100`],
    // Back off to 2 min after an error (e.g. 429/Retry-After) instead of hammering at 15s.
    refetchInterval: (query) => (query.state.error ? 120000 : 15000),
    retry: false,
  });

  // Fetch HITL stats from /api/jrx/hitl/stats (NvHITLService.getReviewStats).
  // queryClient auto-unwraps the {success,data} envelope, so `statsData` here
  // is the inner data object — counts may arrive as numeric strings from pg,
  // so we always coerce via Number() at the read site.
  interface HitlTrendBucket { day: string; total: number; approved: number; rejected: number; modified: number; pending: number }
  interface HitlStats {
    pending?: number | string;
    approved?: number | string;
    rejected?: number | string;
    modified?: number | string;
    total?: number | string;
    avg_review_hours?: number | string | null;
    avg_review_hours_last_7d?: number | string | null;
    trend7d?: HitlTrendBucket[];
  }
  // Task #314 — the SSE stream below pushes fresh stats the moment a reviewer
  // approves/rejects/modifies a card, so we drop the polling interval to a
  // 5-min safety net (covers a dropped EventSource, browser tab throttling,
  // or a server-side restart that loses the in-memory event bus).
  const { data: statsData, refetch: refetchStats } = useQuery<HitlStats>({
    queryKey: [nv('hitl/stats')],
    refetchInterval: 300000,
  });
  const stats: HitlStats = statsData ?? {};
  const trend7d: HitlTrendBucket[] = Array.isArray(stats.trend7d) ? stats.trend7d : [];

  // Task #314 — Subscribe to /api/jrx/hitl/stats/stream so the four stat tiles
  // and the 7-day sparkline update without waiting for the polling interval.
  // The server emits a `hitl-stats` event with the same payload shape as
  // /hitl/stats every time a row in nv_schema.hitl_reviews changes status.
  // Honors a tenant filter when the page is scoped to one (US/IN today).
  const tenantFilter: string | undefined = undefined;
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const token = getAuthToken();
    if (!token) return;
    const params = new URLSearchParams({ token });
    if (tenantFilter) params.set('tenantId', tenantFilter);
    const url = `${nv('hitl/stats/stream')}?${params.toString()}`;
    let es: EventSource | null = null;
    try { es = new EventSource(url); } catch { return; }
    const onStats = (ev: MessageEvent) => {
      try {
        const payload: HitlStats = JSON.parse(ev.data);
        // Push straight into the react-query cache so all readers re-render
        // immediately. The /hitl/stats poll keeps running as a safety net.
        queryClient.setQueryData([nv('hitl/stats')], payload);
        // A change to stats also implies the queue list moved (a new pending
        // row, or a pending row transitioned to approved/rejected/modified).
        queryClient.invalidateQueries({ queryKey: [`${p('HITL_QUEUE')}?status=all&limit=100`] });
      } catch { /* ignore malformed frame */ }
    };
    es.addEventListener('hitl-stats', onStats as EventListener);
    return () => {
      try { es?.removeEventListener('hitl-stats', onStats as EventListener); } catch { /* ignore */ }
      try { es?.close(); } catch { /* ignore */ }
    };
  }, [queryClient, tenantFilter]);

  // Project a /api/jrx/hitl/queue HitlQueueItem into the page's DecisionCard
  // shape. Tenant id is jurisdiction (US/IN per Task #301 seed). Risk level is
  // mapped 1:1 onto card priority since the backend only persists low/med/high.
  function queueItemToDecisionCard(raw: HitlQueueItem): DecisionCard {
    const priority: DecisionCard['priority'] =
      raw.riskLevel === 'critical' ? 'critical'
      : raw.riskLevel === 'high' ? 'high'
      : raw.riskLevel === 'low' ? 'low'
      : 'medium';
    const status: DecisionCard['status'] =
      raw.status === 'approved' ? 'approved'
      : raw.status === 'rejected' ? 'rejected'
      : raw.status === 'modified' ? 'modified'
      : 'pending';
    return {
      id: raw.id,
      type: 'review',
      priority,
      status,
      title: `${raw.agentId || 'Legal AI'} review`,
      summary: `Request ${raw.requestId?.slice(0, 12) || raw.id.slice(0, 12)} — ${raw.riskLevel || 'medium'} risk`,
      context: {
        agent: raw.agentId || 'Legal AI',
        department: raw.tenantId || 'Legal',
        workflow: 'orchestration',
        triggeredAt: raw.requestedAt,
        expiresAt: raw.slaDeadline ?? undefined,
      },
      proposedAction: {
        type: 'analysis',
        description: `Risk: ${raw.riskLevel || 'medium'} · Tenant: ${raw.tenantId || '—'}`,
        impact: priority,
        estimatedTime: '5 minutes',
      },
      rationale: 'Agent confidence below threshold — human review required.',
      confidenceScore: 0.65,
      // DecisionCard.riskLevel only allows low|medium|high; collapse 'critical'
      // (a card priority bucket) onto 'high' for the risk dimension.
      riskLevel: priority === 'critical' ? 'high' : priority,
      alternatives: [],
      metadata: { tenantId: raw.tenantId, requestId: raw.requestId },
    };
  }

  // Items returned by /hitl/queue carry both the raw queue card and (when
  // status≠pending) the decided record. The backend's /hitl/stats does NOT
  // include a decisions list, so we derive history from the same items —
  // anything with a non-pending status is a recorded decision.
  const items: HitlQueueItem[] = Array.isArray(pendingData?.items) ? pendingData.items : [];
  const apiDecisions: DecisionCard[] = items.map(queueItemToDecisionCard);
  const apiHistory: DecisionHistory[] = items
    .filter(i => i.status !== 'pending')
    .map(i => ({
      id: `hist-${i.id}`,
      cardId: i.id,
      decision: (i.status as DecisionHistory['decision']),
      decidedBy: i.reviewerId || 'System',
      decidedAt: i.reviewedAt || i.requestedAt,
    }));

  const [localOverrides, setLocalOverrides] = useState<Record<string, DecisionCard['status']>>({});
  const decisions = apiDecisions.map(d => ({
    ...d,
    status: localOverrides[d.id] || d.status,
  }));
  const history = apiHistory;

  const pendingCount = decisions.filter(d => d.status === 'pending').length;
  const criticalCount = decisions.filter(d => d.status === 'pending' && d.priority === 'critical').length;

  // Submit decision mutation (persists to DB)
  const decisionMutation = useMutation({
    mutationFn: async ({ cardId, decision, feedback, modifications }: {
      cardId: string; decision: string; feedback?: string; modifications?: string
    }) => {
      return fetch(`${NV_BASE}hitl/${cardId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ decision, notes: feedback, modifiedOutput: modifications }),
      }).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [p('HITL_QUEUE')] });
      queryClient.invalidateQueries({ queryKey: [nv('hitl/stats')] });
      refetchPending();
      refetchStats();
    },
  });

  const handleDecision = (cardId: string, decision: 'approved' | 'rejected' | 'modified', feedback?: string, modifications?: string) => {
    // Optimistic local update
    setLocalOverrides(prev => ({ ...prev, [cardId]: decision }));

    // Persist to DB
    decisionMutation.mutate({ cardId, decision, feedback, modifications });

    toast({
      title: decision === 'approved' ? 'Decision Approved' : decision === 'rejected' ? 'Decision Rejected' : 'Decision Modified',
      description: `The decision has been ${decision} and logged for learning`,
    });

    setSelectedCard(null);
    setFeedbackText('');
    setModificationText('');
    setShowModifyDialog(false);
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'bg-green-100 text-green-800 border-green-200',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      high: 'bg-orange-100 text-orange-800 border-orange-200',
      critical: 'bg-red-100 text-red-800 border-red-200',
    };
    return colors[priority] || colors.medium;
  };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, any> = {
      approval: CheckCircle,
      review: Eye,
      escalation: AlertTriangle,
      intervention: Edit3,
    };
    const Icon = icons[type] || CheckCircle;
    return <Icon className="h-4 w-4" />;
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.9) return 'text-green-600';
    if (score >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Decision Cards</h1>
          <p className="text-muted-foreground">
            Human-in-the-Loop approval workflows with intelligent escalation
          </p>
        </div>
        <div className="flex items-center gap-4">
          {criticalCount > 0 && (
            <Badge variant="destructive" className="animate-pulse" data-testid="badge-critical-count" role="status">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {criticalCount} Critical
            </Badge>
          )}
          <Badge variant="outline" data-testid="badge-pending-count" role="status">
            <Clock className="h-3 w-3 mr-1" />
            {pendingCount} Pending
          </Badge>
          <Button variant="outline" size="sm" data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <Activity className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-blue-700">Pending Decisions</p>
                <p className="text-2xl font-bold text-blue-900">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200" data-testid="card-hitl-approved">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500 rounded-lg">
                <CheckCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-green-700">Approved (total)</p>
                <p className="text-2xl font-bold text-green-900">
                  {Number(stats.approved ?? history.filter(h => h.decision === 'approved').length) || 0}
                </p>
                <p className="text-[11px] text-green-700/80">
                  Rejected: {Number(stats.rejected ?? 0)} · Modified: {Number(stats.modified ?? 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500 rounded-lg">
                <Brain className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm text-purple-700">Avg Confidence</p>
                <p className="text-2xl font-bold text-purple-900">
                  {decisions.length === 0
                    ? '—'
                    : `${Math.round((decisions.reduce((acc, d) => acc + d.confidenceScore, 0) / decisions.length) * 100)}%`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200" data-testid="card-hitl-trend">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500 rounded-lg">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-orange-700">Avg time-to-decision (7d)</p>
                <p className="text-2xl font-bold text-orange-900">
                  {(() => {
                    const h = Number(stats.avg_review_hours_last_7d ?? stats.avg_review_hours ?? 0);
                    return h > 0 ? `${h.toFixed(1)}h` : '—';
                  })()}
                </p>
                {trend7d.length > 0 && (() => {
                  const max = Math.max(1, ...trend7d.map(d => Number(d.total) || 0));
                  return (
                    <div className="flex items-end gap-0.5 h-7 mt-1" data-testid="hitl-trend-sparkline" aria-label="7-day decision-volume trend">
                      {trend7d.map((d) => (
                        <div key={d.day}
                          title={`${d.day}: ${d.total} decisions`}
                          className="w-3 bg-orange-500/70 rounded-sm"
                          style={{ height: `${Math.max(8, ((Number(d.total) || 0) / max) * 100)}%` }}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="pending" data-testid="tab-pending" aria-label="pending tab">
            Pending ({pendingCount})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history" aria-label="history tab">
            History
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics" aria-label="analytics tab">
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {decisions.filter(d => d.status === 'pending').map((card) => (
              <Card 
                key={card.id} 
                className={`cursor-pointer hover:shadow-lg transition-all ${selectedCard?.id === card.id ? 'ring-2 ring-violet-500' : ''}`}
                onClick={() => setSelectedCard(card)}
                data-testid={`card-decision-${card.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(card.type)}
                      <Badge className={getPriorityColor(card.priority)}>
                        {card.priority}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTimeAgo(card.context.triggeredAt)}
                    </span>
                  </div>
                  <CardTitle className="text-lg">{card.title}</CardTitle>
                  <CardDescription>{card.summary}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{card.context.agent}</p>
                      <p className="text-xs text-muted-foreground">{card.context.department} • {card.context.workflow}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className={`font-medium ${getConfidenceColor(card.confidenceScore)}`}>
                        {Math.round(card.confidenceScore * 100)}%
                      </span>
                    </div>
                    <Progress value={card.confidenceScore * 100} className="h-2"  role="progressbar" aria-label="Progress"/>
                  </div>
                  
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium mb-1">Proposed Action</p>
                    <p className="text-sm text-muted-foreground">{card.proposedAction.description}</p>
                    {card.proposedAction.estimatedCost && (
                      <div className="flex items-center gap-1 mt-2 text-sm">
                        <DollarSign className="h-3 w-3" />
                        <span>${card.proposedAction.estimatedCost.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button 
                    className="flex-1" 
                    onClick={(e) => { e.stopPropagation(); handleDecision(card.id, 'approved', 'Approved as recommended'); }}
                    data-testid={`button-approve-${card.id}`}
                  >
                    <ThumbsUp className="h-4 w-4 mr-2" />
                    Approve
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={(e) => { e.stopPropagation(); setSelectedCard(card); setShowModifyDialog(true); }}
                    data-testid={`button-modify-${card.id}`}
                  >
                    <Edit3 className="h-4 w-4 mr-2" />
                    Modify
                  </Button>
                  <Button 
                    variant="destructive" 
                    className="flex-1"
                    onClick={(e) => { e.stopPropagation(); handleDecision(card.id, 'rejected', 'Rejected - needs revision'); }}
                    data-testid={`button-reject-${card.id}`}
                  >
                    <ThumbsDown className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          
          {decisions.filter(d => d.status === 'pending').length === 0 && (
            <Card className="py-12">
              <CardContent className="flex flex-col items-center justify-center text-center">
                <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
                <h3 className="text-lg font-semibold">All Caught Up!</h3>
                <p className="text-muted-foreground">No pending decisions require your attention</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <ScrollArea className="h-[600px]" aria-label="Scrollable content">
            <div className="space-y-3">
              {history.map((item) => (
                <Card key={item.id} data-testid={`card-history-${item.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {item.decision === 'approved' && <CheckCircle className="h-5 w-5 text-green-500" />}
                        {item.decision === 'rejected' && <XCircle className="h-5 w-5 text-red-500" />}
                        {item.decision === 'modified' && <Edit3 className="h-5 w-5 text-yellow-500" />}
                        <div>
                          <p className="font-medium">Decision {item.decision}</p>
                          <p className="text-sm text-muted-foreground">
                            by {item.decidedBy} • {formatTimeAgo(item.decidedAt)}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" role="status">{item.cardId}</Badge>
                    </div>
                    {item.feedback && (
                      <div className="mt-3 p-2 bg-gray-50 rounded text-sm">
                        <p className="text-muted-foreground">{item.feedback}</p>
                      </div>
                    )}
                    {item.modifications && (
                      <div className="mt-2 p-2 bg-yellow-50 rounded text-sm">
                        <p className="text-yellow-800 ">{item.modifications}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Decision Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <span>Approved</span>
                    </div>
                    <span className="font-medium">68%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <span>Modified</span>
                    </div>
                    <span className="font-medium">22%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <span>Rejected</span>
                    </div>
                    <span className="font-medium">10%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Response Time</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <p className="text-4xl font-bold text-violet-600">4.2h</p>
                  <p className="text-sm text-muted-foreground">Average response time</p>
                  <div className="mt-4 flex items-center justify-center gap-2 text-green-600">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-sm">18% faster than last week</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Learning Impact</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Auto-approval eligible</span>
                      <span>45%</span>
                    </div>
                    <Progress value={45} className="h-2"  role="progressbar" aria-label="Progress"/>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Confidence improvement</span>
                      <span>+12%</span>
                    </div>
                    <Progress value={62} className="h-2"  role="progressbar" aria-label="Progress"/>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Escalation reduction</span>
                      <span>-28%</span>
                    </div>
                    <Progress value={72} className="h-2"  role="progressbar" aria-label="Progress"/>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showModifyDialog} onOpenChange={setShowModifyDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Modify Decision</DialogTitle>
            <DialogDescription>
              Provide modifications to the proposed action
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Modifications</label>
              <Textarea
                placeholder="Describe your modifications..."
                value={modificationText}
                onChange={(e) => setModificationText(e.target.value)}
                rows={4}
                data-testid="textarea-modifications"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Feedback for Learning</label>
              <Textarea
                placeholder="Add feedback to help improve future decisions..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={2}
                data-testid="textarea-feedback"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModifyDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (selectedCard) {
                  handleDecision(selectedCard.id, 'modified', feedbackText, modificationText);
                }
              }}
              data-testid="button-submit-modification"
            >
              Submit Modification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
