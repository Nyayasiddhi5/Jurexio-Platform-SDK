/**
 * CAM 2.0 (Continuous Agent Monitoring) Dashboard
 * Real-time monitoring of agent health, cost tracking, and quality metrics
 * 
 * Features:
 * - Agent health status and performance metrics
 * - Cost tracking and optimization recommendations
 * - Quality scores and success rates
 * - Collaborative cluster visualization
 * - Real-time updates from orchestration jobs
 */

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';
import { NyvErrorState } from '@/components/NyvErrorState';
import { 
  Activity, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle, 
  TrendingUp,
  TrendingDown,
  Users,
  Zap,
  Brain,
  Shield,
  Clock
} from 'lucide-react';

interface AgentHealthMetrics {
  agentId: string;
  successRate: number;
  avgLatency: number;
  totalExecutions: number;
  uptime: number;
  workload: number;
  qualityScore: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

interface CostMetrics {
  totalCost: number;
  llmCosts: number;
  storageCosts: number;
  computeCosts: number;
  costTrend: 'up' | 'down' | 'stable';
  recommendations: string[];
}

interface QualityMetrics {
  avgQuality: number;
  accuracy: number;
  reliability: number;
  consistency: number;
}

interface CAMDashboardData {
  overview: {
    totalAgents: number;
    activeWorkflows: number;
    totalExecutions: number;
    avgSuccessRate: number;
  };
  agents: AgentHealthMetrics[];
  costs: CostMetrics;
  quality: QualityMetrics;
  recentExecutions: {
    orchestrationId: string;
    workflow: string;
    duration: number;
    cost: number;
    status: 'success' | 'failed';
    timestamp: string;
  }[];
}

export function CAMMonitoringDashboard({ startupId }: { startupId: number }) {
  const { data: camData, isLoading, isError, refetch } = useQuery<CAMDashboardData>({
    queryKey: [p('CAM_TELEMETRY'), startupId],
    queryFn: async () => {
      const json = await nvFetchJson<{ data?: CAMDashboardData } & CAMDashboardData>(
        `${p('CAM_TELEMETRY')}${startupId ? `?startupId=${startupId}` : ''}`,
      );
      return (json?.data ?? json) as CAMDashboardData;
    },
    refetchInterval: 5000,
  });

  if (isError) {
    return (
      <NyvErrorState
        title="CAM telemetry unavailable"
        description="Could not load /api/nyayavigya/cam/dashboard — check session or gateway health."
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading || !camData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const overview = camData.overview ?? { totalAgents: 0, activeWorkflows: 0, totalExecutions: 0, avgSuccessRate: 0 };
  const costs = camData.costs ?? { totalCost: 0, llmCosts: 0, storageCosts: 0, computeCosts: 0, costTrend: 'stable' as const, recommendations: [] };
  const quality = camData.quality ?? { avgQuality: 0, accuracy: 0, reliability: 0, consistency: 0 };
  const agents = camData.agents ?? [];
  const recentExecutions = camData.recentExecutions ?? [];

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Agents</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview.totalAgents}</div>
            <p className="text-xs text-muted-foreground">{overview.activeWorkflows} active workflows (24h)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(overview.avgSuccessRate * 100).toFixed(1)}%
            </div>
            <Progress value={overview.avgSuccessRate * 100} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Executions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview.totalExecutions}</div>
            <p className="text-xs text-muted-foreground">
              Router decisions (24h window)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${costs.totalCost.toFixed(2)}</div>
            <div className="flex items-center text-xs mt-2">
              {costs.costTrend === 'down' ? (
                <TrendingDown className="h-3 w-3 text-green-500 mr-1" />
              ) : (
                <TrendingUp className="h-3 w-3 text-orange-500 mr-1" />
              )}
              <span className={costs.costTrend === 'down' ? 'text-green-500' : 'text-orange-500'}>
                {costs.costTrend}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agent Health Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Agent Health Status
          </CardTitle>
          <CardDescription>Real-time monitoring of agent performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {agents.slice(0, 5).map((agent) => (
              <div key={agent.agentId} className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <Badge
                    variant={
                      agent.status === 'healthy'
                        ? 'default'
                        : agent.status === 'degraded'
                        ? 'secondary'
                        : 'destructive'
                    }
                  >
                    {agent.status}
                  </Badge>
                  <span className="font-medium">{agent.agentId}</span>
                </div>
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    <span>{(agent.successRate * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{agent.avgLatency}ms</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>{agent.totalExecutions}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quality Metrics & Cost Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Quality Metrics
            </CardTitle>
            <CardDescription>Aggregate quality scores across all workflows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Average Quality</span>
                <span className="text-sm text-muted-foreground">
                  {(quality.avgQuality * 100).toFixed(1)}%
                </span>
              </div>
              <Progress value={quality.avgQuality * 100} />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Accuracy</span>
                <span className="text-sm text-muted-foreground">
                  {(quality.accuracy * 100).toFixed(1)}%
                </span>
              </div>
              <Progress value={quality.accuracy * 100} />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Reliability</span>
                <span className="text-sm text-muted-foreground">
                  {(quality.reliability * 100).toFixed(1)}%
                </span>
              </div>
              <Progress value={quality.reliability * 100} />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Consistency</span>
                <span className="text-sm text-muted-foreground">
                  {(quality.consistency * 100).toFixed(1)}%
                </span>
              </div>
              <Progress value={quality.consistency * 100} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Cost Breakdown
            </CardTitle>
            <CardDescription>Detailed cost analysis and optimization tips</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">LLM Costs</span>
              <span className="font-medium">${costs.llmCosts.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Storage Costs</span>
              <span className="font-medium">${costs.storageCosts.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Compute Costs</span>
              <span className="font-medium">${costs.computeCosts.toFixed(2)}</span>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-2">Optimization Recommendations</p>
              {(costs.recommendations ?? []).slice(0, 3).map((rec, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-muted-foreground mb-2">
                  <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Executions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Executions</CardTitle>
          <CardDescription>Latest orchestration workflow executions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentExecutions.map((execution) => (
              <div
                key={execution.orchestrationId}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Badge variant={execution.status === 'success' ? 'default' : 'destructive'}>
                    {execution.status}
                  </Badge>
                  <div>
                    <p className="font-medium text-sm">{execution.workflow}</p>
                    <p className="text-xs text-muted-foreground">{execution.orchestrationId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{execution.duration}ms</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    <span>${execution.cost.toFixed(4)}</span>
                  </div>
                  <span className="text-xs">
                    {new Date(execution.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
