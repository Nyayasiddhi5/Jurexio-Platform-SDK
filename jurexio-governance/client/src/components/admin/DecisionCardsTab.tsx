import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  CheckCircle, XCircle, AlertTriangle, Clock, MessageSquare, Bot, ThumbsUp, ThumbsDown,
  Edit3, Eye, History, TrendingUp, DollarSign, Users, Activity, RefreshCw, Loader2
} from "lucide-react";

interface DecisionCard {
  id: string;
  type: 'approval' | 'review' | 'escalation' | 'intervention';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  title: string;
  summary: string;
  context: { agent: string; department: string; workflow: string; triggeredAt: string; };
  proposedAction: { type: string; description: string; impact: string; estimatedCost?: number; };
  rationale: string;
  confidenceScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  alternatives?: { id: string; description: string; confidence: number; }[];
}

export default function DecisionCardsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCard, setSelectedCard] = useState<DecisionCard | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const { data: pendingData, isLoading: loadingPending } = useQuery({
    queryKey: ['/api/orchestration/pending-approvals', 'admin'],
    queryFn: async () => {
      const res = await fetch('/api/orchestration/pending-approvals?approverId=admin');
      if (!res.ok) return { executions: [] };
      return res.json();
    },
    refetchInterval: 10000,
  });

  const decisions: DecisionCard[] = (pendingData?.executions || []).map((exec: any) => ({
    id: exec.id || exec.executionId,
    type: exec.workflowType || 'approval',
    priority: exec.priority || 'medium',
    status: exec.status || 'pending',
    title: exec.title || exec.taskName || 'Pending Decision',
    summary: exec.description || exec.summary || '',
    context: {
      agent: exec.agentId || exec.initiatorAgentId || 'System',
      department: exec.department || 'General',
      workflow: exec.workflowId || exec.workflowType || 'workflow',
      triggeredAt: exec.createdAt || new Date().toISOString(),
    },
    proposedAction: {
      type: exec.actionType || 'action',
      description: exec.proposedAction?.description || exec.description || '',
      impact: exec.proposedAction?.impact || exec.impact || '',
      estimatedCost: exec.proposedAction?.estimatedCost || exec.estimatedCost,
    },
    rationale: exec.rationale || exec.reason || '',
    confidenceScore: exec.confidence || exec.confidenceScore || 0.7,
    riskLevel: exec.riskLevel || 'medium',
    alternatives: exec.alternatives || [],
  }));

  const submitDecisionMutation = useMutation({
    mutationFn: async ({ executionId, decision, feedback }: { executionId: string; decision: string; feedback?: string }) => {
      return apiRequest('POST', `/api/orchestration/workflow-executions/${executionId}/decide`, {
        decision,
        deciderId: 'admin',
        feedback,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orchestration/pending-approvals'] });
    },
  });

  const pendingCount = decisions.filter(d => d.status === 'pending').length;
  const criticalCount = decisions.filter(d => d.status === 'pending' && d.priority === 'critical').length;

  const handleDecision = (cardId: string, decision: 'approved' | 'rejected') => {
    submitDecisionMutation.mutate(
      { executionId: cardId, decision, feedback: feedbackText || undefined },
      {
        onSuccess: () => {
          toast({
            title: decision === 'approved' ? 'Decision Approved' : 'Decision Rejected',
            description: 'The decision has been logged for learning',
          });
          setSelectedCard(null);
          setShowDetailDialog(false);
          setFeedbackText('');
        },
        onError: () => {
          toast({
            title: 'Error',
            description: 'Failed to submit decision. Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const getPriorityColor = (priority: string) => ({
    low: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    high: 'bg-orange-100 text-orange-800',
    critical: 'bg-red-100 text-red-800 animate-pulse',
  }[priority] || 'bg-gray-100');

  const getTypeIcon = (type: string) => {
    const icons: Record<string, any> = { approval: CheckCircle, review: Eye, escalation: AlertTriangle, intervention: Edit3 };
    const Icon = icons[type] || CheckCircle;
    return <Icon className="h-4 w-4" />;
  };

  const formatTimeAgo = (dateString: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">HITL Decision Cards</h2>
          <p className="text-sm text-muted-foreground">Human-in-the-Loop approval workflows with confidence-based escalation</p>
        </div>
        <div className="flex gap-2">
          {criticalCount > 0 && (
            <Badge variant="destructive" className="animate-pulse" data-testid="badge-critical">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {criticalCount} Critical
            </Badge>
          )}
          <Badge variant="outline" data-testid="badge-pending">
            <Clock className="h-3 w-3 mr-1" />
            {pendingCount} Pending
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {decisions.filter(d => d.status === 'pending').map(card => (
          <Card key={card.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => { setSelectedCard(card); setShowDetailDialog(true); }} data-testid={`card-decision-${card.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Badge className={getPriorityColor(card.priority)} data-testid={`badge-priority-${card.id}`}>{card.priority}</Badge>
                <span className="text-xs text-muted-foreground" data-testid={`text-time-${card.id}`}>{formatTimeAgo(card.context.triggeredAt)}</span>
              </div>
              <CardTitle className="text-base mt-2 flex items-center gap-2" data-testid={`text-title-${card.id}`}>
                {getTypeIcon(card.type)}
                {card.title}
              </CardTitle>
              <CardDescription data-testid={`text-summary-${card.id}`}>{card.summary}</CardDescription>
            </CardHeader>
            <CardContent className="pb-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Bot className="h-3 w-3" />
                <span data-testid={`text-agent-${card.id}`}>{card.context.agent}</span>
                <span>•</span>
                <span data-testid={`text-dept-${card.id}`}>{card.context.department}</span>
              </div>
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Confidence</span>
                  <span className={card.confidenceScore >= 0.9 ? 'text-green-600' : card.confidenceScore >= 0.7 ? 'text-yellow-600' : 'text-red-600'}>
                    {(card.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>
                <Progress value={card.confidenceScore * 100} className="h-1" />
              </div>
            </CardContent>
            <CardFooter className="pt-2">
              <div className="flex gap-2 w-full">
                <Button size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); handleDecision(card.id, 'approved'); }} data-testid={`button-card-approve-${card.id}`}>
                  <ThumbsUp className="h-3 w-3 mr-1" />
                  Approve
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={(e) => { e.stopPropagation(); handleDecision(card.id, 'rejected'); }} data-testid={`button-card-reject-${card.id}`}>
                  <ThumbsDown className="h-3 w-3 mr-1" />
                  Reject
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>

      {decisions.filter(d => d.status !== 'pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent Decisions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {decisions.filter(d => d.status !== 'pending').map(card => (
                <div key={card.id} className="flex items-center justify-between p-2 bg-muted rounded" data-testid={`row-history-${card.id}`}>
                  <span className="text-sm" data-testid={`text-history-title-${card.id}`}>{card.title}</span>
                  <Badge variant={card.status === 'approved' ? 'default' : 'destructive'} data-testid={`badge-history-status-${card.id}`}>{card.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl">
          {selectedCard && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getTypeIcon(selectedCard.type)}
                  {selectedCard.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-sm mb-1">Summary</h4>
                  <p className="text-sm text-muted-foreground">{selectedCard.summary}</p>
                </div>
                <div>
                  <h4 className="font-medium text-sm mb-1">Proposed Action</h4>
                  <p className="text-sm text-muted-foreground">{selectedCard.proposedAction.description}</p>
                  {selectedCard.proposedAction.estimatedCost && (
                    <p className="text-sm mt-1"><DollarSign className="h-3 w-3 inline" /> Estimated Cost: ${selectedCard.proposedAction.estimatedCost.toLocaleString()}</p>
                  )}
                </div>
                <div>
                  <h4 className="font-medium text-sm mb-1">Rationale</h4>
                  <p className="text-sm text-muted-foreground">{selectedCard.rationale}</p>
                </div>
                {selectedCard.alternatives && selectedCard.alternatives.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-1">Alternatives</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {selectedCard.alternatives.map(alt => (
                        <li key={alt.id}>• {alt.description} ({(alt.confidence * 100).toFixed(0)}% confidence)</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <h4 className="font-medium text-sm mb-1">Feedback (Optional)</h4>
                  <Textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="Add feedback for learning..." data-testid="textarea-feedback" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleDecision(selectedCard.id, 'rejected')} data-testid="button-dialog-reject">
                  <ThumbsDown className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button onClick={() => handleDecision(selectedCard.id, 'approved')} data-testid="button-dialog-approve">
                  <ThumbsUp className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
