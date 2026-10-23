import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  DollarSign, Users, Play, Pause, CheckCircle, Clock, AlertTriangle, 
  FileText, Briefcase, TrendingUp, ArrowRight
} from "lucide-react";

interface WorkflowStep {
  id: string;
  name: string;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  category: 'finance' | 'hr';
  status: 'active' | 'paused' | 'completed';
  steps: WorkflowStep[];
  lastRun?: string;
  successRate: number;
}

const financeWorkflows: Workflow[] = [
  {
    id: 'quote-to-cash', name: 'Quote-to-Cash', description: 'End-to-end revenue cycle from quote to payment', category: 'finance', status: 'active', successRate: 94,
    steps: [
      { id: 's1', name: 'Generate Quote', agent: 'Sales Agent', status: 'completed', duration: 15 },
      { id: 's2', name: 'Review Pricing', agent: 'Pricing Analyst', status: 'completed', duration: 30 },
      { id: 's3', name: 'Create Contract', agent: 'Contract Agent', status: 'running', duration: 45 },
      { id: 's4', name: 'Process Payment', agent: 'Billing Agent', status: 'pending' },
      { id: 's5', name: 'Revenue Recognition', agent: 'CFO Agent', status: 'pending' },
    ],
  },
  {
    id: 'budget-approval', name: 'Budget Approval', description: 'Multi-level budget approval workflow', category: 'finance', status: 'active', successRate: 88,
    steps: [
      { id: 's1', name: 'Submit Request', agent: 'Department Manager', status: 'completed', duration: 10 },
      { id: 's2', name: 'Initial Review', agent: 'Financial Analyst', status: 'completed', duration: 25 },
      { id: 's3', name: 'Manager Approval', agent: 'Finance Manager', status: 'running', duration: 15 },
      { id: 's4', name: 'CFO Approval', agent: 'CFO Agent', status: 'pending' },
    ],
  },
  {
    id: 'expense-management', name: 'Expense Management', description: 'Automated expense tracking and approval', category: 'finance', status: 'active', successRate: 96,
    steps: [
      { id: 's1', name: 'Submit Expense', agent: 'Employee', status: 'completed', duration: 5 },
      { id: 's2', name: 'Policy Check', agent: 'Compliance Agent', status: 'completed', duration: 10 },
      { id: 's3', name: 'Manager Approval', agent: 'Expense Manager', status: 'completed', duration: 20 },
      { id: 's4', name: 'Reimbursement', agent: 'Accounting Agent', status: 'running', duration: 15 },
    ],
  },
];

const hrWorkflows: Workflow[] = [
  {
    id: 'recruitment', name: 'Recruitment Pipeline', description: 'End-to-end candidate recruitment process', category: 'hr', status: 'active', successRate: 82,
    steps: [
      { id: 's1', name: 'Source Candidates', agent: 'Recruiter Agent', status: 'completed', duration: 60 },
      { id: 's2', name: 'Resume Screening', agent: 'Screening Agent', status: 'completed', duration: 30 },
      { id: 's3', name: 'Initial Interview', agent: 'Interview Coordinator', status: 'running', duration: 45 },
      { id: 's4', name: 'Technical Assessment', agent: 'Technical Evaluator', status: 'pending' },
      { id: 's5', name: 'Final Interview', agent: 'Hiring Manager', status: 'pending' },
      { id: 's6', name: 'Offer Generation', agent: 'HR Manager', status: 'pending' },
    ],
  },
  {
    id: 'onboarding', name: 'Employee Onboarding', description: 'New hire onboarding automation', category: 'hr', status: 'active', successRate: 95,
    steps: [
      { id: 's1', name: 'Document Collection', agent: 'Onboarding Agent', status: 'completed', duration: 20 },
      { id: 's2', name: 'System Access Setup', agent: 'IT Agent', status: 'completed', duration: 30 },
      { id: 's3', name: 'Training Assignment', agent: 'L&D Agent', status: 'running', duration: 15 },
      { id: 's4', name: 'Buddy Assignment', agent: 'Culture Agent', status: 'pending' },
    ],
  },
  {
    id: 'performance-review', name: 'Performance Review', description: 'Quarterly performance evaluation cycle', category: 'hr', status: 'paused', successRate: 78,
    steps: [
      { id: 's1', name: 'Self Assessment', agent: 'Employee', status: 'completed', duration: 30 },
      { id: 's2', name: 'Peer Feedback', agent: 'Feedback Collector', status: 'completed', duration: 45 },
      { id: 's3', name: 'Manager Review', agent: 'Manager Agent', status: 'pending' },
      { id: 's4', name: 'Calibration', agent: 'HR Director', status: 'pending' },
    ],
  },
];

export default function WorkflowsTab() {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<'finance' | 'hr'>('finance');

  const workflows = selectedCategory === 'finance' ? financeWorkflows : hrWorkflows;

  const getStatusColor = (status: string) => ({
    pending: 'bg-gray-100 text-gray-800',
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
  }[status] || 'bg-gray-100');

  const getStepProgress = (steps: WorkflowStep[]) => {
    const completed = steps.filter(s => s.status === 'completed').length;
    return (completed / steps.length) * 100;
  };

  const toggleWorkflow = (workflowId: string) => {
    toast({ title: 'Workflow Updated', description: `Workflow status toggled` });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Domain Workflows</h2>
          <p className="text-sm text-muted-foreground">Pre-built enterprise workflow automation for Finance and HR</p>
        </div>
      </div>

      <Tabs value={selectedCategory} onValueChange={(v: any) => setSelectedCategory(v)}>
        <TabsList>
          <TabsTrigger value="finance" data-testid="tab-finance">
            <DollarSign className="w-4 h-4 mr-1" />
            Finance Workflows
          </TabsTrigger>
          <TabsTrigger value="hr" data-testid="tab-hr">
            <Users className="w-4 h-4 mr-1" />
            HR Workflows
          </TabsTrigger>
        </TabsList>

        <TabsContent value={selectedCategory} className="mt-4">
          <div className="grid gap-4">
            {workflows.map(workflow => (
              <Card key={workflow.id} data-testid={`card-workflow-${workflow.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {selectedCategory === 'finance' ? (
                        <div className="p-2 bg-green-100 rounded-lg">
                          <DollarSign className="h-5 w-5 text-green-600" />
                        </div>
                      ) : (
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <Users className="h-5 w-5 text-purple-600" />
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-base">{workflow.name}</CardTitle>
                        <CardDescription>{workflow.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor(workflow.status)} data-testid={`badge-status-${workflow.id}`}>{workflow.status}</Badge>
                      <Button size="sm" variant="outline" onClick={() => toggleWorkflow(workflow.id)} data-testid={`button-workflow-toggle-${workflow.id}`}>
                        {workflow.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <TrendingUp className="h-4 w-4" />
                      <span data-testid={`text-success-${workflow.id}`}>{workflow.successRate}% success rate</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <span data-testid={`text-steps-${workflow.id}`}>{workflow.steps.length} steps</span>
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>Progress</span>
                      <span>{Math.round(getStepProgress(workflow.steps))}%</span>
                    </div>
                    <Progress value={getStepProgress(workflow.steps)} className="h-2" />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {workflow.steps.map((step, index) => (
                      <div key={step.id} className="flex items-center gap-1">
                        <div className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${getStatusColor(step.status)}`} data-testid={`badge-step-${workflow.id}-${step.id}`}>
                          {step.status === 'completed' && <CheckCircle className="h-3 w-3" />}
                          {step.status === 'running' && <Clock className="h-3 w-3 animate-spin" />}
                          {step.status === 'failed' && <AlertTriangle className="h-3 w-3" />}
                          {step.name}
                        </div>
                        {index < workflow.steps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
