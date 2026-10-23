import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  Brain, 
  Users, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Play, 
  Pause, 
  BarChart3,
  Calendar,
  Target,
  Zap,
  GitBranch,
  Monitor
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface ProjectBoard {
  id: string;
  projectId: number;
  name: string;
  description: string;
  columns: BoardColumn[];
  createdAt: Date;
  updatedAt: Date;
}

interface BoardColumn {
  id: string;
  name: string;
  position: number;
  tasks: Task[];
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  progress: number;
  assignedAgent?: Agent;
  requiredAgentType?: string;
  estimatedHours: number;
  actualHours?: number;
  dependencies: string[];
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface Agent {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'working' | 'busy';
  capabilities: string[];
  currentTask?: string;
}

interface ProjectMemory {
  projectId: number;
  totalMemories: number;
  agentActivities: number;
  taskCompletions: number;
  learnings: number;
  challenges: number;
  solutions: number;
  recentActivities: AgentActivity[];
}

interface AgentActivity {
  id: string;
  agentId: string;
  action: string;
  timestamp: Date;
  success: boolean;
  context: any;
}

interface ProjectManagementProps {
  projectId: number;
  onTaskUpdate?: (task: Task) => void;
}

export function ProjectManagement({ projectId, onTaskUpdate }: ProjectManagementProps) {
  const [selectedBoard, setSelectedBoard] = useState<string>('');
  const [newTaskDialog, setNewTaskDialog] = useState(false);
  const [newTaskData, setNewTaskData] = useState({
    title: '',
    description: '',
    columnId: '',
    priority: 'medium' as Task['priority'],
    estimatedHours: 1,
    requiredAgentType: '',
    tags: ''
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch project boards
  const { data: boards, isLoading: boardsLoading } = useQuery({
    queryKey: [`/api/projects/${projectId}/boards`],
    enabled: !!projectId
  });

  // Fetch project memory
  const { data: memory, isLoading: memoryLoading } = useQuery({
    queryKey: [`/api/projects/${projectId}/memory`],
    enabled: !!projectId
  });

  // Fetch board details
  const { data: boardDetails, isLoading: boardLoading } = useQuery({
    queryKey: [`/api/boards/${selectedBoard}`],
    enabled: !!selectedBoard
  });

  // Fetch board analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: [`/api/boards/${selectedBoard}/analytics`],
    enabled: !!selectedBoard
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return apiRequest(`/api/boards/${selectedBoard}/tasks`, {
        method: 'POST',
        body: JSON.stringify(taskData)
      });
    },
    onSuccess: () => {
      toast({
        title: "Task Created",
        description: "New task has been created successfully."
      });
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${selectedBoard}`] });
      setNewTaskDialog(false);
      setNewTaskData({
        title: '',
        description: '',
        columnId: '',
        priority: 'medium',
        estimatedHours: 1,
        requiredAgentType: '',
        tags: ''
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Assign task mutation
  const assignTaskMutation = useMutation({
    mutationFn: async ({ taskId, agentId }: { taskId: string; agentId: string }) => {
      return apiRequest(`/api/tasks/${taskId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ agentId })
      });
    },
    onSuccess: () => {
      toast({
        title: "Task Assigned",
        description: "Task has been assigned to agent successfully."
      });
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${selectedBoard}`] });
    }
  });

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      return apiRequest(`/api/tasks/${taskId}/complete`, {
        method: 'POST'
      });
    },
    onSuccess: () => {
      toast({
        title: "Task Completed",
        description: "Task has been marked as completed."
      });
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${selectedBoard}`] });
    }
  });

  // Set default board when boards are loaded
  useEffect(() => {
    if (boards?.data && boards.data.length > 0 && !selectedBoard) {
      setSelectedBoard(boards.data[0].id);
    }
  }, [boards, selectedBoard]);

  const handleCreateTask = () => {
    const tags = newTaskData.tags.split(',').map(tag => tag.trim()).filter(Boolean);
    
    createTaskMutation.mutate({
      ...newTaskData,
      tags,
      estimatedHours: Number(newTaskData.estimatedHours)
    });
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'in_progress': return <Play className="h-4 w-4 text-blue-500" />;
      case 'in_review': return <Monitor className="h-4 w-4 text-purple-500" />;
      default: return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  if (boardsLoading || memoryLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-blue-600" />
            Project Management
          </h2>
          <p className="text-muted-foreground">
            AI-powered project orchestration with intelligent task management
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={selectedBoard} onValueChange={setSelectedBoard}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select board" />
            </SelectTrigger>
            <SelectContent>
              {boards?.data?.map((board: ProjectBoard) => (
                <SelectItem key={board.id} value={board.id}>
                  {board.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Dialog open={newTaskDialog} onOpenChange={setNewTaskDialog}>
            <DialogTrigger asChild>
              <Button>
                <Zap className="h-4 w-4 mr-2" />
                Create Task
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Task</DialogTitle>
                <DialogDescription>
                  Add a new task to the project board for agent assignment
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Input
                  placeholder="Task title"
                  value={newTaskData.title}
                  onChange={(e) => setNewTaskData(prev => ({ ...prev, title: e.target.value }))}
                />
                
                <Textarea
                  placeholder="Task description"
                  value={newTaskData.description}
                  onChange={(e) => setNewTaskData(prev => ({ ...prev, description: e.target.value }))}
                />
                
                <Select 
                  value={newTaskData.columnId} 
                  onValueChange={(value) => setNewTaskData(prev => ({ ...prev, columnId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {boardDetails?.data?.columns?.map((column: BoardColumn) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <div className="grid grid-cols-2 gap-2">
                  <Select 
                    value={newTaskData.priority} 
                    onValueChange={(value) => setNewTaskData(prev => ({ ...prev, priority: value as Task['priority'] }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Input
                    type="number"
                    placeholder="Hours"
                    min="1"
                    value={newTaskData.estimatedHours}
                    onChange={(e) => setNewTaskData(prev => ({ ...prev, estimatedHours: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                
                <Input
                  placeholder="Required agent type (optional)"
                  value={newTaskData.requiredAgentType}
                  onChange={(e) => setNewTaskData(prev => ({ ...prev, requiredAgentType: e.target.value }))}
                />
                
                <Input
                  placeholder="Tags (comma-separated)"
                  value={newTaskData.tags}
                  onChange={(e) => setNewTaskData(prev => ({ ...prev, tags: e.target.value }))}
                />
                
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNewTaskDialog(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreateTask}
                    disabled={!newTaskData.title || !newTaskData.columnId || createTaskMutation.isPending}
                  >
                    {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Project Insights */}
      {memory?.data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" />
                <div>
                  <p className="text-sm font-medium">Total Memories</p>
                  <p className="text-2xl font-bold">{memory.data.totalMemories}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium">Agent Activities</p>
                  <p className="text-2xl font-bold">{memory.data.agentActivities}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium">Completed Tasks</p>
                  <p className="text-2xl font-bold">{memory.data.taskCompletions}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-orange-600" />
                <div>
                  <p className="text-sm font-medium">Solutions Found</p>
                  <p className="text-2xl font-bold">{memory.data.solutions}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs defaultValue="board" className="space-y-4">
        <TabsList>
          <TabsTrigger value="board">Task Board</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="memory">Agent Memory</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-4">
          {boardDetails?.data && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {boardDetails.data.columns?.map((column: BoardColumn) => (
                <Card key={column.id} className="h-fit">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      {column.name}
                      <Badge variant="secondary" className="text-xs">
                        {column.tasks?.length || 0}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {column.tasks?.map((task: Task) => (
                      <Card key={task.id} className="p-3 cursor-pointer hover:shadow-md transition-shadow">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <h4 className="font-medium text-sm line-clamp-2">{task.title}</h4>
                            {getStatusIcon(task.status)}
                          </div>
                          
                          {task.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {task.description}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-between">
                            <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
                              {task.priority}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {task.estimatedHours}h
                            </span>
                          </div>
                          
                          {task.progress > 0 && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span>Progress</span>
                                <span>{task.progress}%</span>
                              </div>
                              <Progress value={task.progress} className="h-1" />
                            </div>
                          )}
                          
                          {task.assignedAgent && (
                            <div className="flex items-center gap-2 pt-2 border-t">
                              <div className="w-6 h-6 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                <span className="text-xs font-medium text-blue-600 dark:text-blue-300">
                                  {task.assignedAgent.name.charAt(0)}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground truncate">
                                {task.assignedAgent.name}
                              </span>
                            </div>
                          )}
                          
                          {task.tags && task.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {task.tags.slice(0, 2).map((tag, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                              {task.tags.length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{task.tags.length - 2}
                                </Badge>
                              )}
                            </div>
                          )}
                          
                          {task.status !== 'completed' && (
                            <div className="flex gap-1 pt-2">
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="text-xs h-7 flex-1"
                                onClick={() => assignTaskMutation.mutate({ taskId: task.id, agentId: 'auto' })}
                                disabled={assignTaskMutation.isPending}
                              >
                                Assign
                              </Button>
                              {task.status === 'in_progress' && (
                                <Button 
                                  size="sm" 
                                  className="text-xs h-7 flex-1"
                                  onClick={() => completeTaskMutation.mutate(task.id)}
                                  disabled={completeTaskMutation.isPending}
                                >
                                  Complete
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          {analytics?.data && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Task Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Todo</span>
                      <span>{analytics.data.tasksByStatus?.todo || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>In Progress</span>
                      <span>{analytics.data.tasksByStatus?.in_progress || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Completed</span>
                      <span>{analytics.data.tasksByStatus?.completed || 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Time Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Avg Task Time</span>
                      <span>{analytics.data.averageTaskTime || 0}h</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Total Effort</span>
                      <span>{analytics.data.totalEffort || 0}h</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Efficiency</span>
                      <span>{analytics.data.efficiency || 0}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Agent Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Active Agents</span>
                      <span>{analytics.data.activeAgents || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Utilization</span>
                      <span>{analytics.data.agentUtilization || 0}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Success Rate</span>
                      <span>{analytics.data.successRate || 0}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="memory" className="space-y-4">
          {memory?.data?.recentActivities && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Recent Agent Activities
                </CardTitle>
                <CardDescription>
                  Latest actions and learnings from AI agents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {memory.data.recentActivities.map((activity: AgentActivity) => (
                    <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                      <div className={`w-2 h-2 rounded-full mt-2 ${activity.success ? 'bg-green-500' : 'bg-red-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{activity.agentId}</p>
                          <span className="text-xs text-muted-foreground">
                            {new Date(activity.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{activity.action}</p>
                        {activity.context && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            <code className="bg-muted rounded px-1">
                              {JSON.stringify(activity.context).slice(0, 100)}...
                            </code>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ProjectManagement;