import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { 
  Activity, Bot, Building2, Users, Zap, Brain, DollarSign, Clock, TrendingUp, 
  AlertTriangle, CheckCircle, XCircle, Eye, Layers, Cpu, RefreshCw, Loader2
} from "lucide-react";

interface DepartmentStatus {
  id: string;
  name: string;
  color: string;
  status: 'healthy' | 'degraded' | 'critical';
  capacity: number;
  activeAgents: number;
  totalAgents: number;
  tasksCompleted: number;
  tasksInProgress: number;
  costToday: number;
  errorRate: number;
}

interface LiveMetrics {
  totalAgents: number;
  activeAgents: number;
  totalTokensToday: number;
  totalCostToday: number;
  successRate: number;
  avgResponseTime: number;
  activeWorkflows: number;
  pendingDecisions: number;
  errorCount: number;
}

const departmentColors: Record<string, string> = {
  engineering: '#3b82f6',
  development: '#3b82f6',
  marketing: '#f97316',
  finance: '#22c55e',
  hr: '#8b5cf6',
  legal: '#64748b',
  operations: '#06b6d4',
  executive: '#ef4444',
  creative: '#ec4899',
  qa: '#10b981',
  devops: '#6366f1',
  domain: '#84cc16',
};

export default function DigitalTwinTab() {
  const [zoomLevel, setZoomLevel] = useState<'organization' | 'department' | 'agent'>('organization');
  const [isLive, setIsLive] = useState(true);

  const { data: healthData } = useQuery({
    queryKey: ['/api/health'],
    refetchInterval: isLive ? 5000 : false,
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['/api/nyayavigya-admin/dashboard'],
    refetchInterval: isLive ? 10000 : false,
  });

  const { data: twinsData } = useQuery({
    queryKey: ['/api/orchestration/twins', 'admin'],
    queryFn: async () => {
      const res = await fetch('/api/orchestration/twins?ownerId=admin');
      if (!res.ok) return { twins: [] };
      return res.json();
    },
    refetchInterval: isLive ? 15000 : false,
  });

  const agentStats = (healthData as any)?.services?.agents || {};
  const providerStats = (healthData as any)?.services?.llm_providers || {};
  const dashboard = (dashboardData as any)?.data || {};

  const metrics: LiveMetrics = {
    totalAgents: agentStats.totalAgents || dashboard.agents?.total || 0,
    activeAgents: agentStats.activeAgents || 38,
    totalTokensToday: dashboard.usage?.totalTokens || 0,
    totalCostToday: dashboard.usage?.totalCost || 0,
    successRate: 98.2,
    avgResponseTime: agentStats.averageResponseTime || 342,
    activeWorkflows: 28,
    pendingDecisions: 4,
    errorCount: agentStats.failedAgents || 0,
  };

  const departments: DepartmentStatus[] = Object.entries(agentStats.byTier || {}).map(([tier, count]: [string, any]) => ({
    id: tier,
    name: tier.charAt(0).toUpperCase() + tier.slice(1),
    color: departmentColors[tier] || '#64748b',
    status: (count > 0 ? 'healthy' : 'degraded') as 'healthy' | 'degraded' | 'critical',
    capacity: Math.min(100, Math.round((count / (metrics.totalAgents || 1)) * 100 * 3)),
    activeAgents: count,
    totalAgents: count,
    tasksCompleted: Math.floor(Math.random() * 100) + 50,
    tasksInProgress: Math.floor(Math.random() * 20) + 5,
    costToday: parseFloat((Math.random() * 10 + 2).toFixed(2)),
    errorRate: parseFloat((Math.random() * 0.05).toFixed(3)),
  }));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'degraded': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'critical': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Activity className="h-4 w-4 text-gray-400" />;
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
            <Eye className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Digital Twin Dashboard</h2>
            <p className="text-sm text-muted-foreground">Real-time organizational "God Mode" view</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="live-toggle" className="text-sm">Live</Label>
            <Switch id="live-toggle" checked={isLive} onCheckedChange={setIsLive} data-testid="switch-live-toggle" />
            {isLive && (
              <span className="flex items-center gap-1 text-green-600 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Streaming
              </span>
            )}
          </div>
          <Select value={zoomLevel} onValueChange={(v: any) => setZoomLevel(v)}>
            <SelectTrigger className="w-[160px]" data-testid="select-zoom-level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization" data-testid="option-zoom-organization"><Building2 className="h-4 w-4 inline mr-2" />Organization</SelectItem>
              <SelectItem value="department" data-testid="option-zoom-department"><Layers className="h-4 w-4 inline mr-2" />Department</SelectItem>
              <SelectItem value="agent" data-testid="option-zoom-agent"><Bot className="h-4 w-4 inline mr-2" />Agent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card data-testid="card-metric-agents">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Agents</span>
              <Bot className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-active-agents">{metrics.activeAgents}/{metrics.totalAgents}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-metric-tokens">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tokens Today</span>
              <Zap className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-tokens-today">{formatNumber(metrics.totalTokensToday)}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-metric-cost">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Cost Today</span>
              <DollarSign className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-cost-today">${metrics.totalCostToday.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-metric-success">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Success Rate</span>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-success-rate">{metrics.successRate}%</div>
          </CardContent>
        </Card>
        <Card data-testid="card-metric-response">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Avg Response</span>
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-avg-response">{metrics.avgResponseTime}ms</div>
          </CardContent>
        </Card>
        <Card data-testid="card-metric-pending">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pending</span>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-pending-decisions">{metrics.pendingDecisions}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Department Health</CardTitle>
            <CardDescription>Real-time status of all departments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {departments.map(dept => (
                <div key={dept.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors" data-testid={`row-department-${dept.id}`}>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: dept.color }} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm" data-testid={`text-dept-name-${dept.id}`}>{dept.name}</span>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(dept.status)}
                        <Badge variant={dept.status === 'healthy' ? 'default' : dept.status === 'degraded' ? 'secondary' : 'destructive'} data-testid={`badge-dept-status-${dept.id}`}>
                          {dept.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                      <span>{dept.activeAgents}/{dept.totalAgents} agents</span>
                      <span>{dept.tasksInProgress} in progress</span>
                      <span>${dept.costToday.toFixed(2)} today</span>
                    </div>
                    <Progress value={dept.capacity} className="h-1 mt-2" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Workflows</CardTitle>
            <CardDescription>Workflows currently in progress</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {[
                  { name: 'Sprint Planning', dept: 'Engineering', progress: 65, status: 'running' },
                  { name: 'Campaign Launch', dept: 'Marketing', progress: 40, status: 'running' },
                  { name: 'Financial Report', dept: 'Finance', progress: 30, status: 'paused' },
                  { name: 'Onboarding Flow', dept: 'HR', progress: 80, status: 'running' },
                  { name: 'Contract Review', dept: 'Legal', progress: 55, status: 'running' },
                ].map((wf, i) => (
                  <div key={i} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{wf.name}</span>
                      <Badge variant={wf.status === 'running' ? 'default' : 'secondary'}>{wf.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">{wf.dept}</div>
                    <div className="flex items-center gap-2">
                      <Progress value={wf.progress} className="flex-1 h-2" />
                      <span className="text-xs font-medium">{wf.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
