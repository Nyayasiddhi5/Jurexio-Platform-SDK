import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NyvEmptyState } from "@/components/NyvEmptyState";
import AgentDashboard from "@/components/agent-dashboard";
import CodeEditor from "@/components/workspace/code-editor";
import LivePreview from "@/components/workspace/live-preview";
import AnimatedCard from "@/components/ui/animated-card";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAgents } from "@/hooks/use-agents";
import { api } from "@/lib/api";
import { 
  ArrowLeft,
  Play,
  Code2,
  Eye,
  Terminal,
  Users,
  Activity,
  MessageCircle,
  Settings,
  Zap,
  CheckCircle,
  AlertCircle,
  Clock,
  Brain
} from "lucide-react";

export default function AgentWorkspace() {
  const { id } = useParams();
  const projectId = parseInt(id!);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ['/api/projects', projectId],
    queryFn: () => api.getProject(projectId)
  });

  const { data: progress } = useQuery({
    queryKey: ['/api/projects', projectId, 'progress'],
    queryFn: () => api.getProjectProgress(projectId),
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['/api/projects', projectId, 'tasks'],
    queryFn: () => api.getProjectTasks(projectId),
    refetchInterval: 3000
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['/api/projects', projectId, 'messages'],
    queryFn: () => api.getProjectMessages(projectId),
    refetchInterval: 2000
  });

  const { agents, isLoading: agentsLoading } = useAgents(projectId);

  useWebSocket('demo_user', (data) => {
    if (data.projectId === projectId) {
      // Trigger refetch when receiving updates
      console.log('Workspace update:', data);
    }
  });

  const completedTasks = tasks.filter(t => t.status === 'completed');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const pendingTasks = tasks.filter(t => t.status === 'pending');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-500';
      case 'in_progress': return 'bg-blue-500 animate-pulse';
      case 'failed': return 'bg-red-500';
      default: return 'bg-slate-100';
    }
  };

  const getAgentStatusColor = (status: string) => {
    switch (status) {
      case 'working': return 'text-blue-400';
      case 'idle': return 'text-slate-700';
      case 'error': return 'text-red-400';
      default: return 'text-slate-700';
    }
  };

  if (!project) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="animate-pulse space-y-8">
          <div className="h-8 bg-slate-100 rounded w-1/3"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="h-96 bg-slate-100 rounded-lg"></div>
            </div>
            <div className="space-y-6">
              <div className="h-64 bg-slate-100 rounded-lg"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white/50 backdrop-blur-sm sticky top-16 z-40">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => window.history.back()}
                className="text-slate-700 hover:text-slate-900"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{project.name}</h1>
                <p className="text-sm text-slate-700">AI Development Workspace</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 px-3 py-1 bg-primary/20 rounded-lg">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span className="text-sm text-primary">
                  {progress?.activeAgents || 0} agents active
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm">
                  <Play className="mr-2 h-4 w-4" />
                  Preview
                </Button>
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Button>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          {progress && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">Overall Progress</span>
                <span className="text-slate-900">{Math.round(progress.progressPercentage)}%</span>
              </div>
              <Progress value={progress.progressPercentage} className="h-2"  role="progressbar" aria-label="Progress"/>
              <div className="flex items-center justify-between text-xs text-slate-700">
                <span>{completedTasks.length}/{tasks.length} tasks completed</span>
                <span>Est. {progress.estimatedCompletion} remaining</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 bg-slate-100/50" aria-label="Navigation tabs">
            <TabsTrigger value="overview" className="data-[state=active]:bg-primary" aria-label="overview tab">
              <Activity className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="agents" className="data-[state=active]:bg-primary" aria-label="agents tab">
              <Users className="mr-2 h-4 w-4" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="workspace" className="data-[state=active]:bg-primary" aria-label="workspace tab">
              <Code2 className="mr-2 h-4 w-4" />
              Workspace
            </TabsTrigger>
            <TabsTrigger value="preview" className="data-[state=active]:bg-primary" aria-label="preview tab">
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="terminal" className="data-[state=active]:bg-primary" aria-label="terminal tab">
              <Terminal className="mr-2 h-4 w-4" />
              Terminal
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Overview */}
              <div className="lg:col-span-2 space-y-6">
                {/* Task Status */}
                <AnimatedCard className="p-6 bg-white border border-slate-200">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-slate-900 flex items-center">
                      <CheckCircle className="mr-2 h-5 w-5 text-emerald-400" />
                      Task Progress
                    </CardTitle>
                    <CardDescription>
                      Real-time development progress across all agents
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center space-y-2">
                        <div className="text-2xl font-bold text-emerald-400">{completedTasks.length}</div>
                        <div className="text-xs text-slate-700">Completed</div>
                      </div>
                      <div className="text-center space-y-2">
                        <div className="text-2xl font-bold text-blue-400">{inProgressTasks.length}</div>
                        <div className="text-xs text-slate-700">In Progress</div>
                      </div>
                      <div className="text-center space-y-2">
                        <div className="text-2xl font-bold text-slate-700">{pendingTasks.length}</div>
                        <div className="text-xs text-slate-700">Pending</div>
                      </div>
                    </div>

                    {/* Recent Tasks */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-slate-900">Recent Activity</h4>
                      <ScrollArea className="h-32" aria-label="Scrollable content">
                        <div className="space-y-2">
                          {tasks.slice(0, 5).map((task) => (
                            <div key={task.id} className="flex items-center space-x-3 p-2 rounded-lg bg-slate-100/30">
                              <div className={`w-2 h-2 rounded-full ${getStatusColor(task.status)}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">{task.title}</p>
                                <p className="text-xs text-slate-700 capitalize">{task.status}</p>
                              </div>
                              {task.status === 'completed' && (
                                <CheckCircle className="h-4 w-4 text-emerald-400" />
                              )}
                              {task.status === 'in_progress' && (
                                <Clock className="h-4 w-4 text-blue-400 animate-spin" />
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  </CardContent>
                </AnimatedCard>

                {/* Agent Communication */}
                <AnimatedCard className="p-6 bg-white border border-slate-200">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-slate-900 flex items-center">
                      <MessageCircle className="mr-2 h-5 w-5 text-primary" />
                      Agent Communication
                    </CardTitle>
                    <CardDescription>
                      Real-time messages between AI agents
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64" aria-label="Scrollable content">
                      <div className="space-y-3">
                        {messages.map((message) => (
                          <div key={message.id} className="flex items-start space-x-3 p-3 rounded-lg bg-slate-100/30">
                            <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Brain className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center space-x-2">
                                <span className="text-sm font-medium text-slate-900">
                                  {agents.find(a => a.id === message.fromAgentId)?.name || 'System'}
                                </span>
                                <span className="text-xs text-slate-700">
                                  {new Date(message.timestamp!).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-sm text-slate-700">{message.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </AnimatedCard>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Active Agents */}
                <AnimatedCard className="p-6 bg-white border border-slate-200">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-slate-900">Active Agents</CardTitle>
                    <CardDescription>
                      Currently working agents
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-48" aria-label="Scrollable content">
                      <div className="space-y-3">
                        {agents.filter(a => a.status === 'working').map((agent) => (
                          <div key={agent.id} className="flex items-center space-x-3 p-2 rounded-lg bg-slate-100/30">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-900">{agent.name}</p>
                              <p className="text-xs text-blue-400">{agent.currentTask}</p>
                            </div>
                            <Zap className="h-4 w-4 text-blue-400" />
                          </div>
                        ))}
                        
                        {agents.filter(a => a.status === 'working').length === 0 && (
                          <NyvEmptyState title="No agents currently working" size="sm" />
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </AnimatedCard>

                {/* Project Info */}
                <Card className="bg-white border border-slate-200">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-slate-900">Project Info</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700">Status</span>
                        <Badge 
                          variant="secondary" 
                          className="bg-primary/20 text-primary"
                         role="status">
                          {project.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700">Created</span>
                        <span className="text-slate-900">
                          {new Date(project.createdAt!).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-700">Agents</span>
                        <span className="text-slate-900">{agents.length}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="agents">
            <AgentDashboard projectId={projectId} />
          </TabsContent>

          <TabsContent value="workspace" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CodeEditor 
                projectId={projectId}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
              />
              <LivePreview projectId={projectId} />
            </div>
          </TabsContent>

          <TabsContent value="preview">
            <LivePreview projectId={projectId} fullscreen />
          </TabsContent>

          <TabsContent value="terminal">
            <Card className="bg-white border border-slate-200">
              <CardHeader>
                <CardTitle className="text-slate-900 flex items-center">
                  <Terminal className="mr-2 h-5 w-5" />
                  Terminal Output
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm h-96 overflow-y-auto">
                  <div className="space-y-1">
                    <div className="text-green-400">$ Jurexio Orchestration Engine v2.0.0</div>
                    <div className="text-slate-700">Initializing agents...</div>
                    <div className="text-blue-400">✓ CTO Agent initialized</div>
                    <div className="text-blue-400">✓ Architect Agent initialized</div>
                    <div className="text-blue-400">✓ Frontend Agent initialized</div>
                    <div className="text-blue-400">✓ Backend Agent initialized</div>
                    <div className="text-green-400">All agents ready. Starting development...</div>
                    <div className="text-slate-700">Monitoring agent communication...</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
