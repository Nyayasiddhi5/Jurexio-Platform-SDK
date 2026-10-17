import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface AnalyticsDashboardProps {
  performanceMetrics?: any;
  projectId: number;
}

export function AnalyticsDashboard({ performanceMetrics, projectId }: AnalyticsDashboardProps) {
  // Default values if no metrics provided
  const metrics = performanceMetrics || {
    costToday: 247.82,
    budgetUsed: 45,
    agentEfficiency: {
      'cto-agent': 94,
      'frontend-agent': 87,
      'qa-agent': 91
    },
    estimatedCompletion: {
      days: 3,
      hours: 14
    }
  };

  const agentEfficiencyEntries = Object.entries(metrics.agentEfficiency || {});

  return (
    <Card className="bg-surface-800 p-6 border-surface-700">
      <h3 className="text-lg font-semibold mb-6 flex items-center">
        <i className="fas fa-chart-line text-blue-400 mr-2"></i>
        Performance Analytics
      </h3>
      
      <div className="space-y-6">
        {/* Cost Metrics */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-400">Development Cost</span>
            <span className="text-lg font-bold text-accent-400">
              ${metrics.costToday.toFixed(2)}
            </span>
          </div>
          <Progress value={metrics.budgetUsed} className="h-2" />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Budget: $550</span>
            <span>{metrics.budgetUsed}% used</span>
          </div>
        </div>

        {/* Agent Efficiency */}
        <div>
          <span className="text-sm text-gray-400 block mb-3">Agent Efficiency</span>
          <div className="space-y-2">
            {agentEfficiencyEntries.map(([agentName, efficiency]) => {
              const displayName = agentName.replace('-agent', '').replace('_', ' ');
              const normalizedEfficiency = typeof efficiency === 'number' ? efficiency : efficiency * 100;
              
              return (
                <div key={agentName} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{displayName}</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-16">
                      <Progress value={normalizedEfficiency} className="h-1.5" />
                    </div>
                    <span className="text-xs text-accent-400 w-8 text-right">
                      {Math.round(normalizedEfficiency)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline */}
        <div>
          <span className="text-sm text-gray-400 block mb-3">Project Timeline</span>
          <div className="text-2xl font-bold text-white mb-1">
            <span className="text-accent-400">{metrics.estimatedCompletion.days}</span>
            <span className="text-lg ml-1">days</span>
            <span className="text-accent-400 ml-3">{metrics.estimatedCompletion.hours}</span>
            <span className="text-lg ml-1">hours</span>
          </div>
          <p className="text-xs text-gray-400">Estimated completion time</p>
        </div>

        {/* Additional Metrics */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-surface-700">
          <div className="text-center">
            <div className="text-xl font-bold text-blue-400">98.5%</div>
            <div className="text-xs text-gray-400">Success Rate</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-400">2.3s</div>
            <div className="text-xs text-gray-400">Avg Response</div>
          </div>
        </div>

        {/* Quality Score */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Overall Quality Score</span>
            <span className="text-sm font-medium text-purple-400">9.2/10</span>
          </div>
          <Progress value={92} className="h-2" />
          <div className="text-xs text-gray-400 mt-1">
            Based on code quality, performance, and user satisfaction
          </div>
        </div>
      </div>
    </Card>
  );
}
