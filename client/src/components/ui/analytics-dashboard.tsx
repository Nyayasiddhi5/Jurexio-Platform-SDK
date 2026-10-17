import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

interface AnalyticsDashboardProps {
  metrics?: {
    requests?: {
      total: number;
      successful: number;
      failed: number;
    };
    performance?: {
      averageLatency: number;
      p95Latency: number;
      throughput: number;
      qualityScore: number;
    };
    cost?: {
      totalCost: number;
      costByProvider: Record<string, number>;
      optimization: {
        potential_savings: number;
        recommendations: string[];
      };
    };
  };
  agentStats?: {
    totalTasks: number;
    averageQuality: number;
    averageSuccessRate: number;
    topPerformers: Array<{
      name: string;
      type: string;
      quality: number;
      tasksCompleted: number;
    }>;
  };
  className?: string;
}

export function AnalyticsDashboard({ metrics, agentStats, className = "" }: AnalyticsDashboardProps) {
  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;
  const formatLatency = (ms: number) => `${ms.toFixed(0)}ms`;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Total Requests</p>
                <p className="text-2xl font-bold text-white">
                  {metrics?.requests?.total?.toLocaleString() || '0'}
                </p>
              </div>
              <div className="p-3 bg-blue-500/20 rounded-full">
                <i className="fas fa-chart-line text-blue-400 text-lg"></i>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center text-sm">
                <span className="text-green-400">
                  {metrics?.requests ? Math.round((metrics.requests.successful / metrics.requests.total) * 100) : 0}%
                </span>
                <span className="text-gray-400 ml-1">success rate</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Avg Latency</p>
                <p className="text-2xl font-bold text-white">
                  {formatLatency(metrics?.performance?.averageLatency || 0)}
                </p>
              </div>
              <div className="p-3 bg-green-500/20 rounded-full">
                <i className="fas fa-clock text-green-400 text-lg"></i>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center text-sm">
                <span className="text-gray-400">P95:</span>
                <span className="text-white ml-1">
                  {formatLatency(metrics?.performance?.p95Latency || 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Quality Score</p>
                <p className="text-2xl font-bold text-white">
                  {Math.round((metrics?.performance?.qualityScore || 0) * 100)}%
                </p>
              </div>
              <div className="p-3 bg-purple-500/20 rounded-full">
                <i className="fas fa-star text-purple-400 text-lg"></i>
              </div>
            </div>
            <div className="mt-4">
              <Progress value={(metrics?.performance?.qualityScore || 0) * 100} className="h-2" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">Total Cost</p>
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(metrics?.cost?.totalCost || 0)}
                </p>
              </div>
              <div className="p-3 bg-yellow-500/20 rounded-full">
                <i className="fas fa-dollar-sign text-yellow-400 text-lg"></i>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center text-sm">
                <span className="text-green-400">
                  {formatCurrency(metrics?.cost?.optimization?.potential_savings || 0)}
                </span>
                <span className="text-gray-400 ml-1">potential savings</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown and Agent Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Breakdown */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white flex items-center">
              <i className="fas fa-chart-pie text-yellow-400 mr-2"></i>
              Cost Breakdown by Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {metrics?.cost?.costByProvider && Object.entries(metrics.cost.costByProvider).map(([provider, cost]) => {
                const percentage = (cost / (metrics.cost?.totalCost || 1)) * 100;
                return (
                  <div key={provider} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white capitalize">{provider}</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-gray-400">{percentage.toFixed(1)}%</span>
                        <span className="text-sm font-medium text-white">{formatCurrency(cost)}</span>
                      </div>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                );
              })}
            </div>
            
            {/* Cost Optimization Recommendations */}
            {metrics?.cost?.optimization?.recommendations && (
              <div className="mt-6 p-4 bg-gray-700/50 rounded-lg">
                <h4 className="text-sm font-medium text-white mb-3">💡 Optimization Tips</h4>
                <div className="space-y-2">
                  {metrics.cost.optimization.recommendations.slice(0, 3).map((tip, index) => (
                    <div key={index} className="text-xs text-gray-300 flex items-start">
                      <i className="fas fa-lightbulb text-yellow-400 mr-2 mt-0.5 text-xs"></i>
                      {tip}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agent Performance */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white flex items-center">
              <i className="fas fa-trophy text-green-400 mr-2"></i>
              Top Performing Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {agentStats?.topPerformers?.map((agent, index) => (
                <div key={agent.name} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white text-sm font-bold">
                      #{index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{agent.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{agent.type.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center space-x-2">
                      <Badge className="bg-green-600 text-white text-xs">
                        {Math.round(agent.quality * 100)}%
                      </Badge>
                      <span className="text-sm text-gray-400">{agent.tasksCompleted} tasks</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Overall Agent Stats */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-gray-700/50 rounded-lg">
                <div className="text-lg font-semibold text-blue-400">
                  {agentStats?.totalTasks?.toLocaleString() || '0'}
                </div>
                <div className="text-xs text-gray-400">Total Tasks</div>
              </div>
              <div className="text-center p-3 bg-gray-700/50 rounded-lg">
                <div className="text-lg font-semibold text-green-400">
                  {Math.round((agentStats?.averageQuality || 0) * 100)}%
                </div>
                <div className="text-xs text-gray-400">Avg Quality</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Throughput and Performance Trends */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-white flex items-center">
            <i className="fas fa-chart-area text-cyan-400 mr-2"></i>
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-cyan-400">
                {metrics?.performance?.throughput || 0}
              </div>
              <div className="text-sm text-gray-400 mt-1">Requests/min</div>
              <div className="mt-2">
                <Progress value={75} className="h-2" />
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400">
                {Math.round((agentStats?.averageSuccessRate || 0) * 100)}%
              </div>
              <div className="text-sm text-gray-400 mt-1">Success Rate</div>
              <div className="mt-2">
                <Progress value={(agentStats?.averageSuccessRate || 0) * 100} className="h-2" />
              </div>
            </div>
            
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-400">
                99.5%
              </div>
              <div className="text-sm text-gray-400 mt-1">Uptime</div>
              <div className="mt-2">
                <Progress value={99.5} className="h-2" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
