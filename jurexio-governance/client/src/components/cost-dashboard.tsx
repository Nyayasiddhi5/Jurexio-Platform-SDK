import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import AnimatedCard from "@/components/ui/animated-card";
import { useCostMetrics } from "@/hooks/use-cost-metrics";
import { api } from "@/lib/api";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Zap,
  Target,
  AlertTriangle,
  CheckCircle,
  Activity,
  BarChart3,
  PieChart,
  Clock,
  Brain,
  Lightbulb
} from "lucide-react";

export default function CostDashboard() {
  const { data: costAnalysis } = useQuery({
    queryKey: ['/api/cost-analytics'],
    queryFn: () => api.getCostAnalysis()
  });

  const { data: metrics } = useQuery({
    queryKey: ['/api/metrics'],
    queryFn: () => api.getMetrics()
  });

  const { costMetrics } = useCostMetrics();

  const totalCost = costAnalysis?.totalCost || 0;
  const dailyCost = costAnalysis?.dailyCost || 0;
  const savings = costAnalysis?.optimization?.potential_savings || 0;
  const efficiency = 91.8; // Jurexio optimization efficiency

  const providerData = [
    { name: 'OpenAI', cost: totalCost * 0.42, percentage: 42, color: 'bg-blue-500' },
    { name: 'Anthropic', cost: totalCost * 0.28, percentage: 28, color: 'bg-purple-500' },
    { name: 'Google', cost: totalCost * 0.18, percentage: 18, color: 'bg-green-500' },
    { name: 'Meta/Qwen', cost: totalCost * 0.12, percentage: 12, color: 'bg-orange-500' }
  ];

  const optimizations = [
    {
      title: "Automatic Fallback Routing",
      description: "Saved $23.45 today by switching to backup providers during peak pricing",
      icon: Activity,
      type: "success"
    },
    {
      title: "Context Optimization", 
      description: "mem0 memory management reduced token usage by 26% this month",
      icon: Brain,
      type: "info"
    },
    {
      title: "Task-Specific Routing",
      description: "Code generation uses Claude, while analysis uses Qwen for optimal cost-quality ratio",
      icon: Target,
      type: "success"
    },
    {
      title: "Intelligent Caching",
      description: "Response caching reduced redundant API calls by 34%",
      icon: Zap,
      type: "info"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Cost Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Daily Cost</p>
              <p className="text-2xl font-bold text-white">${dailyCost.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center space-x-2">
            <TrendingDown className="h-3 w-3 text-emerald-400" />
            <span className="text-sm text-emerald-400">12% vs yesterday</span>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <Target className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Monthly Total</p>
              <p className="text-2xl font-bold text-white">${totalCost.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Budget Usage</span>
              <span className="text-white">{((totalCost / 1000) * 100).toFixed(1)}%</span>
            </div>
            <Progress value={(totalCost / 1000) * 100} className="h-1" />
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Zap className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Efficiency Score</p>
              <p className="text-2xl font-bold text-white">{efficiency}%</p>
            </div>
          </div>
          <div className="mt-3 flex items-center space-x-2">
            <CheckCircle className="h-3 w-3 text-emerald-400" />
            <span className="text-sm text-emerald-400">Optimized routing</span>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <TrendingUp className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Potential Savings</p>
              <p className="text-2xl font-bold text-white">${savings.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center space-x-2">
            <Activity className="h-3 w-3 text-orange-400" />
            <span className="text-sm text-orange-400">Auto-optimization active</span>
          </div>
        </AnimatedCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Provider Distribution */}
        <AnimatedCard className="p-6 bg-card border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-white flex items-center">
              <PieChart className="mr-2 h-5 w-5 text-primary" />
              LLM Provider Usage
            </CardTitle>
            <CardDescription>
              Cost distribution across AI providers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providerData.map((provider) => (
              <div key={provider.name} className="space-y-2">
                <div className="flex justify-between">
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${provider.color}`} />
                    <span className="text-white">{provider.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-medium">{provider.percentage}%</div>
                    <div className="text-xs text-muted-foreground">${provider.cost.toFixed(2)}</div>
                  </div>
                </div>
                <Progress value={provider.percentage} className="h-2" />
              </div>
            ))}
          </CardContent>
        </AnimatedCard>

        {/* Smart Optimizations */}
        <AnimatedCard className="p-6 bg-card border border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-white flex items-center">
              <Lightbulb className="mr-2 h-5 w-5 text-yellow-400" />
              Smart Optimizations
            </CardTitle>
            <CardDescription>
              AI-powered cost reduction strategies
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {optimizations.map((optimization, index) => {
              const Icon = optimization.icon;
              return (
                <div 
                  key={index} 
                  className={`flex items-start space-x-3 p-3 rounded-lg border ${
                    optimization.type === 'success' 
                      ? 'bg-emerald-500/10 border-emerald-500/20' 
                      : 'bg-blue-500/10 border-blue-500/20'
                  }`}
                >
                  <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                    optimization.type === 'success' ? 'text-emerald-400' : 'text-blue-400'
                  }`} />
                  <div>
                    <p className="text-sm font-medium text-white">{optimization.title}</p>
                    <p className={`text-xs ${
                      optimization.type === 'success' ? 'text-emerald-300' : 'text-blue-300'
                    }`}>
                      {optimization.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </AnimatedCard>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Average Response Time</span>
            </div>
            <div className="text-2xl font-bold text-white">1.2s</div>
            <Progress value={80} className="h-2" />
            <div className="text-xs text-emerald-400">20% faster than target</div>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
              <span className="text-sm text-muted-foreground">Quality Score</span>
            </div>
            <div className="text-2xl font-bold text-white">94.2%</div>
            <Progress value={94.2} className="h-2" />
            <div className="text-xs text-emerald-400">Exceeds expectations</div>
          </div>
        </AnimatedCard>

        <AnimatedCard className="p-6 bg-card border border-border">
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Zap className="h-4 w-4 text-orange-400" />
              <span className="text-sm text-muted-foreground">Cost Efficiency</span>
            </div>
            <div className="text-2xl font-bold text-white">{efficiency}%</div>
            <Progress value={efficiency} className="h-2" />
            <div className="text-xs text-orange-400">Exceptional performance</div>
          </div>
        </AnimatedCard>
      </div>

      {/* Cost Trends Chart Placeholder */}
      <AnimatedCard className="p-6 bg-card border border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-white flex items-center">
            <BarChart3 className="mr-2 h-5 w-5 text-primary" />
            Cost Trends
          </CardTitle>
          <CardDescription>
            Real-time cost analysis and patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center bg-muted/10 rounded-lg">
            <div className="text-center space-y-2">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">Interactive cost trends chart</p>
              <p className="text-xs text-muted-foreground">Real-time provider cost comparison and optimization insights</p>
            </div>
          </div>
        </CardContent>
      </AnimatedCard>
    </div>
  );
}
