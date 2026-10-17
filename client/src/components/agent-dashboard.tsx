import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AnimatedCard from "@/components/ui/animated-card";
import { useAgents } from "@/hooks/use-agents";
import { useWebSocket } from "@/hooks/use-websocket";
import { api } from "@/lib/api";
import { 
  Users, 
  Brain, 
  Code2, 
  Shield, 
  Rocket,
  Crown,
  ChartLine,
  Megaphone,
  Palette,
  Database,
  Bug,
  Monitor,
  CheckCircle,
  Clock,
  AlertCircle,
  Zap,
  Activity,
  Settings
} from "lucide-react";

interface AgentDashboardProps {
  projectId: number;
}

const agentIcons: Record<string, any> = {
  cto: Crown,
  cpo: ChartLine,
  cmo: Megaphone,
  architect: Settings,
  frontend: Code2,
  backend: Database,
  qa: Bug,
  devops: Rocket,
  security: Shield,
  uiux: Palette,
  art_director: Palette,
  analytics: ChartLine,
  performance: Zap,
  documentation: Code2,
  communication: Users,
  api: Code2,
  mobile: Code2,
  ai_ml: Brain,
  content: Megaphone,
  video: Palette,
  integration: Settings,
  tooling: Settings,
  monitoring: Monitor,
  cost_optimization: ChartLine,
  compliance: Shield,
  accessibility: Users,
  scrum_master: Users,
  product_manager: ChartLine
};

export default function AgentDashboard({ projectId }: AgentDashboardProps) {
  const { agents, isLoading } = useAgents(projectId);
  
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

  useWebSocket('demo_user', (data) => {
    if (data.projectId === projectId) {
      console.log('Agent dashboard update:', data);
    }
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  const executiveAgents = agents.filter(a => ['cto', 'cpo', 'cmo'].includes(a.type));
  const developmentAgents = agents.filter(a => ['architect', 'frontend', 'backend', 'database', 'api', 'mobile'].includes(a.type));
  const qualityAgents = agents.filter(a => ['qa', 'devops', 'security', 'performance', 'monitoring'].includes(a.type));
  const designAgents = agents.filter(a => ['uiux', 'art_director', 'content', 'video'].includes(a.type));
  const specializedAgents = agents.filter(a => !executiveAgents.concat(developmentAgents, qualityAgents, designAgents).includes(a));

  const activeAgents = agents.filter(a => a.status === 'working');
  const idleAgents = agents.filter(a => a.status === 'idle');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'working': return 'bg-blue-500 animate-pulse';
      case 'idle': return 'bg-muted';
      case 'error': return 'bg-red-500';
      default: return 'bg-muted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'working': return <Activity className="h-4 w-4 text-blue-400" />;
      case 'idle': return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'error': return <AlertCircle className="h-4 w-4 text-red-400" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderAgentCard = (agent: any) => {
    const Icon = agentIcons[agent.type] || Brain;
    const agentTasks = tasks.filter(t => t.agentId === agent.id);
    const completedTasks = agentTasks.filter(t => t.status === 'completed');
    const progress = agentTasks.length > 0 ? (completedTasks.length / agentTasks.length) * 100 : 0;

    return (
      <AnimatedCard key={agent.id} className="p-4 bg-card border border-border">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-white text-sm">{agent.name}</h4>
              <p className="text-xs text-muted-foreground capitalize">{agent.type.replace('_', ' ')}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {getStatusIcon(agent.status)}
            <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`} />
          </div>
        </div>

        {agent.currentTask && (
          <div className="mb-3 p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-white font-medium">Current Task:</p>
            <p className="text-xs text-muted-foreground truncate">{agent.currentTask}</p>
          </div>
        )}

        {agentTasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-white">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{completedTasks.length} completed</span>
              <span>{agentTasks.length} total</span>
            </div>
          </div>
        )}

        <Badge 
          variant="secondary" 
          className={`mt-3 text-xs ${
            agent.status === 'working' ? 'bg-blue-500/20 text-blue-400' :
            agent.status === 'idle' ? 'bg-muted text-muted-foreground' :
            'bg-red-500/20 text-red-400'
          }`}
        >
          {agent.status}
        </Badge>
      </AnimatedCard>
    );
  };

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <AnimatedCard className="p-4 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Agents</p>
              <p className="text-xl font-bold text-white">{agents.length}</p>
            </div>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-4 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <Activity className="h-5 w-5 text-blue-400" />
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-xl font-bold text-white">{activeAgents.length}</p>
            </div>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-4 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Idle</p>
              <p className="text-xl font-bold text-white">{idleAgents.length}</p>
            </div>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-4 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm text-muted-foreground">Tasks Done</p>
              <p className="text-xl font-bold text-white">{tasks.filter(t => t.status === 'completed').length}</p>
            </div>
          </div>
        </AnimatedCard>
      </div>

      <Tabs defaultValue="all" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6 bg-muted/50">
          <TabsTrigger value="all">All Agents</TabsTrigger>
          <TabsTrigger value="executive">Executive</TabsTrigger>
          <TabsTrigger value="development">Development</TabsTrigger>
          <TabsTrigger value="quality">Quality & Ops</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="specialized">Specialized</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {agents.map(renderAgentCard)}
          </div>
        </TabsContent>

        <TabsContent value="executive">
          <Card className="bg-card border border-border">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Crown className="mr-2 h-5 w-5 text-yellow-400" />
                Executive Team
              </CardTitle>
              <CardDescription>Strategic leadership and decision-making agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {executiveAgents.map(renderAgentCard)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="development">
          <Card className="bg-card border border-border">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Code2 className="mr-2 h-5 w-5 text-blue-400" />
                Development Team
              </CardTitle>
              <CardDescription>Core development and architecture agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {developmentAgents.map(renderAgentCard)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality">
          <Card className="bg-card border border-border">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Shield className="mr-2 h-5 w-5 text-emerald-400" />
                Quality & Operations
              </CardTitle>
              <CardDescription>Testing, security, and operational excellence</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {qualityAgents.map(renderAgentCard)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="design">
          <Card className="bg-card border border-border">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Palette className="mr-2 h-5 w-5 text-purple-400" />
                Design & Creative
              </CardTitle>
              <CardDescription>UI/UX design and creative content agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {designAgents.map(renderAgentCard)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="specialized">
          <Card className="bg-card border border-border">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <Brain className="mr-2 h-5 w-5 text-cyan-400" />
                Specialized Agents
              </CardTitle>
              <CardDescription>AI/ML, analytics, and domain-specific experts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {specializedAgents.map(renderAgentCard)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Recent Agent Activity */}
      <AnimatedCard className="p-6 bg-card border border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-white">Recent Agent Activity</CardTitle>
          <CardDescription>Latest messages and task updates</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <div className="space-y-3">
              {messages.slice(0, 10).map((message) => {
                const agent = agents.find(a => a.id === message.fromAgentId);
                const Icon = agent ? agentIcons[agent.type] || Brain : Brain;
                
                return (
                  <div key={message.id} className="flex items-start space-x-3 p-3 bg-muted/30 rounded-lg">
                    <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-white">
                          {agent?.name || 'System'}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {agent?.type.replace('_', ' ') || 'system'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(message.timestamp!).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{message.message}</p>
                    </div>
                  </div>
                );
              })}
              
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No agent activity yet</p>
                  <p className="text-sm text-muted-foreground">Agent communication will appear here</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </AnimatedCard>
    </div>
  );
}
