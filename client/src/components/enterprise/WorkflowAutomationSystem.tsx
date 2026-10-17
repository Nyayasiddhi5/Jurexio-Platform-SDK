// Phase 3 - Enterprise Workflow Automation System
// Principal Engineer & Release Captain Implementation
// Visual workflow builder with enterprise integrations

import React, { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Workflow, 
  Play, 
  Pause, 
  Plus, 
  Settings, 
  Clock, 
  CheckCircle, 
  XCircle,
  GitBranch,
  Zap,
  Users,
  Mail,
  MessageSquare,
  ExternalLink,
  Timer,
  AlertTriangle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition' | 'approval' | 'delay';
  label: string;
  config: Record<string, any>;
  position: { x: number; y: number };
  connections: string[];
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: WorkflowNode[];
  triggers: string[];
  actions: string[];
  isActive: boolean;
  executionCount: number;
  lastRun?: string;
  createdBy: string;
  createdAt: string;
}

interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  startedAt: string;
  completedAt?: string;
  executedBy: string;
  logs: Array<{
    nodeId: string;
    timestamp: string;
    status: string;
    message: string;
  }>;
}

interface IntegrationConnector {
  id: string;
  name: string;
  type: 'slack' | 'teams' | 'email' | 'jira' | 'github' | 'webhook';
  icon: React.ComponentType<any>;
  connected: boolean;
  actions: string[];
  triggers: string[];
}

interface WorkflowAutomationSystemProps {
  organizationId?: string;
  className?: string;
}

export const WorkflowAutomationSystem: React.FC<WorkflowAutomationSystemProps> = ({
  organizationId,
  className
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  
  const [activeTab, setActiveTab] = useState('workflows');
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTemplate | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([]);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);

  // Available integrations
  const integrationConnectors: IntegrationConnector[] = [
    {
      id: 'slack',
      name: 'Slack',
      type: 'slack',
      icon: MessageSquare,
      connected: false,
      actions: ['send_message', 'create_channel', 'invite_user'],
      triggers: ['message_received', 'channel_created']
    },
    {
      id: 'teams',
      name: 'Microsoft Teams',
      type: 'teams',
      icon: Users,
      connected: false,
      actions: ['send_message', 'schedule_meeting'],
      triggers: ['meeting_started', 'message_received']
    },
    {
      id: 'email',
      name: 'Email',
      type: 'email',
      icon: Mail,
      connected: true,
      actions: ['send_email', 'send_template'],
      triggers: ['email_received']
    },
    {
      id: 'jira',
      name: 'JIRA',
      type: 'jira',
      icon: ExternalLink,
      connected: false,
      actions: ['create_issue', 'update_issue', 'transition_issue'],
      triggers: ['issue_created', 'issue_updated']
    }
  ];

  // Fetch workflows
  const { data: workflowsData, isLoading: workflowsLoading } = useQuery({
    queryKey: ['/api/enterprise/workflows', organizationId],
    queryFn: async () => {
      return await apiRequest(`/api/enterprise/workflows?organizationId=${organizationId}`);
    }
  });

  // Fetch workflow executions
  const { data: executionsData } = useQuery({
    queryKey: ['/api/enterprise/workflows/executions', organizationId],
    queryFn: async () => {
      return await apiRequest(`/api/enterprise/workflows/executions?organizationId=${organizationId}`);
    }
  });

  // Create workflow mutation
  const createWorkflowMutation = useMutation({
    mutationFn: async (workflowData: {
      name: string;
      description: string;
      nodes: WorkflowNode[];
      category: string;
    }) => {
      return await apiRequest('/api/enterprise/workflows', {
        method: 'POST',
        body: JSON.stringify({
          ...workflowData,
          organizationId
        })
      });
    },
    onSuccess: () => {
      toast({
        title: 'Workflow Created',
        description: 'Workflow has been saved successfully'
      });
      queryClient.invalidateQueries({ queryKey: ['/api/enterprise/workflows'] });
      setIsBuilderOpen(false);
      setWorkflowNodes([]);
    }
  });

  // Execute workflow mutation
  const executeWorkflowMutation = useMutation({
    mutationFn: async (workflowId: string) => {
      return await apiRequest('/api/enterprise/workflows/execute', {
        method: 'POST',
        body: JSON.stringify({
          workflowId,
          organizationId
        })
      });
    },
    onSuccess: (data) => {
      toast({
        title: 'Workflow Started',
        description: `Execution ID: ${data.executionId}`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/enterprise/workflows/executions'] });
    }
  });

  const workflows = workflowsData?.workflows || [];
  const executions = executionsData?.executions || [];

  // Node templates for workflow builder
  const nodeTemplates = [
    {
      type: 'trigger',
      label: 'Trigger',
      icon: Play,
      description: 'Start workflow on event'
    },
    {
      type: 'condition',
      label: 'Condition',
      icon: GitBranch,
      description: 'Branch based on criteria'
    },
    {
      type: 'action',
      label: 'Action',
      icon: Zap,
      description: 'Perform an operation'
    },
    {
      type: 'approval',
      label: 'Approval',
      icon: Users,
      description: 'Require human approval'
    },
    {
      type: 'delay',
      label: 'Delay',
      icon: Timer,
      description: 'Wait for specified time'
    }
  ];

  const handleNodeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedNode || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newNode: WorkflowNode = {
      id: `node-${Date.now()}`,
      type: draggedNode as any,
      label: `${draggedNode.charAt(0).toUpperCase() + draggedNode.slice(1)} Node`,
      config: {},
      position: { x, y },
      connections: []
    };

    setWorkflowNodes(prev => [...prev, newNode]);
    setDraggedNode(null);
  }, [draggedNode]);

  const handleSaveWorkflow = useCallback(() => {
    if (workflowNodes.length === 0) {
      toast({
        title: 'Empty Workflow',
        description: 'Please add at least one node to the workflow',
        variant: 'destructive'
      });
      return;
    }

    const triggerNodes = workflowNodes.filter(node => node.type === 'trigger');
    if (triggerNodes.length === 0) {
      toast({
        title: 'Missing Trigger',
        description: 'Workflow must have at least one trigger node',
        variant: 'destructive'
      });
      return;
    }

    createWorkflowMutation.mutate({
      name: 'New Workflow',
      description: 'Created with visual workflow builder',
      nodes: workflowNodes,
      category: 'custom'
    });
  }, [workflowNodes, createWorkflowMutation]);

  const getExecutionStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running': return <Play className="w-4 h-4 text-blue-500" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getExecutionStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className={className}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Workflow Automation</h2>
            <p className="text-muted-foreground">
              Create and manage automated business processes
            </p>
          </div>
          <Button onClick={() => setIsBuilderOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Workflow
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="executions">Executions</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>

          {/* Workflows Tab */}
          <TabsContent value="workflows" className="space-y-6">
            {workflowsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-t"></div>
                    <CardContent className="p-4">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : workflows.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Workflow className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-semibold mb-2">No Workflows Created</h3>
                  <p className="text-muted-foreground mb-4">
                    Create your first automated workflow to streamline business processes
                  </p>
                  <Button onClick={() => setIsBuilderOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Workflow
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workflows.map((workflow: WorkflowTemplate) => (
                  <Card
                    key={workflow.id}
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => setSelectedWorkflow(workflow)}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="line-clamp-1">{workflow.name}</span>
                        <Badge variant={workflow.isActive ? 'default' : 'secondary'}>
                          {workflow.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="line-clamp-2">
                        {workflow.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Nodes</span>
                          <span className="font-medium">{workflow.nodes.length}</span>
                        </div>
                        
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Executions</span>
                          <span className="font-medium">{workflow.executionCount}</span>
                        </div>
                        
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Last Run</span>
                          <span className="font-medium">
                            {workflow.lastRun ? new Date(workflow.lastRun).toLocaleDateString() : 'Never'}
                          </span>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              executeWorkflowMutation.mutate(workflow.id);
                            }}
                            disabled={executeWorkflowMutation.isPending}
                          >
                            <Play className="w-3 h-3 mr-1" />
                            Run
                          </Button>
                          <Button size="sm" variant="outline">
                            <Settings className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Executions Tab */}
          <TabsContent value="executions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Executions</CardTitle>
                <CardDescription>
                  Monitor workflow execution status and logs
                </CardDescription>
              </CardHeader>
              <CardContent>
                {executions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No workflow executions yet</p>
                    <p className="text-sm">Run a workflow to see execution history</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {executions.map((execution: WorkflowExecution) => (
                      <div
                        key={execution.id}
                        className="flex items-center justify-between p-4 border rounded"
                      >
                        <div className="flex items-center gap-4">
                          {getExecutionStatusIcon(execution.status)}
                          <div>
                            <div className="font-medium">
                              Workflow Execution #{execution.id.slice(-8)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Started {new Date(execution.startedAt).toLocaleString()} by {execution.executedBy}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          {execution.status === 'running' && (
                            <div className="text-sm text-muted-foreground">
                              {execution.progress}% complete
                            </div>
                          )}
                          <Badge className={getExecutionStatusColor(execution.status)}>
                            {execution.status}
                          </Badge>
                          <Button size="sm" variant="outline">
                            View Logs
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integrations Tab */}
          <TabsContent value="integrations" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {integrationConnectors.map(connector => {
                const Icon = connector.icon;
                return (
                  <Card key={connector.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="w-5 h-5" />
                          {connector.name}
                        </div>
                        <Badge variant={connector.connected ? 'default' : 'outline'}>
                          {connector.connected ? 'Connected' : 'Not Connected'}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-medium mb-2">Available Actions</div>
                          <div className="flex flex-wrap gap-1">
                            {connector.actions.map((action, index) => (
                              <Badge key={index} variant="outline" className="text-xs">
                                {action.replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-sm font-medium mb-2">Triggers</div>
                          <div className="flex flex-wrap gap-1">
                            {connector.triggers.map((trigger, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {trigger.replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <Button
                          className="w-full"
                          variant={connector.connected ? 'outline' : 'default'}
                        >
                          {connector.connected ? 'Disconnect' : 'Connect'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {/* Workflow Builder Dialog */}
        <Dialog open={isBuilderOpen} onOpenChange={setIsBuilderOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>Visual Workflow Builder</DialogTitle>
              <DialogDescription>
                Drag and drop components to create your automated workflow
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex h-96">
              {/* Node Palette */}
              <div className="w-64 border-r pr-4">
                <h3 className="font-semibold mb-3">Components</h3>
                <div className="space-y-2">
                  {nodeTemplates.map(template => {
                    const Icon = template.icon;
                    return (
                      <div
                        key={template.type}
                        className="flex items-center gap-2 p-2 border rounded cursor-grab hover:bg-gray-50 dark:hover:bg-gray-800"
                        draggable
                        onDragStart={() => setDraggedNode(template.type)}
                      >
                        <Icon className="w-4 h-4" />
                        <div>
                          <div className="font-medium text-sm">{template.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {template.description}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Canvas */}
              <div className="flex-1 pl-4">
                <div
                  ref={canvasRef}
                  className="w-full h-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded relative"
                  onDrop={handleNodeDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  {workflowNodes.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      Drag components here to build your workflow
                    </div>
                  ) : (
                    workflowNodes.map(node => {
                      const template = nodeTemplates.find(t => t.type === node.type);
                      const Icon = template?.icon || Settings;
                      return (
                        <div
                          key={node.id}
                          className="absolute bg-white dark:bg-gray-800 border rounded p-3 shadow cursor-move"
                          style={{
                            left: node.position.x,
                            top: node.position.y
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            <span className="text-sm font-medium">{node.label}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setWorkflowNodes([])}>
                Clear Canvas
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsBuilderOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveWorkflow}
                  disabled={createWorkflowMutation.isPending}
                >
                  {createWorkflowMutation.isPending ? 'Saving...' : 'Save Workflow'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default WorkflowAutomationSystem;