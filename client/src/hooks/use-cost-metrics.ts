import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface CostMetric {
  id: number;
  projectId?: number;
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  requestType: string;
  timestamp: Date;
}

export interface CostAnalysis {
  totalCost: number;
  dailyCost: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  optimization: {
    potential_savings: number;
    recommendations: string[];
  };
  budget: {
    monthlyLimit: number;
    monthlyUsage: number;
    dailyLimit: number;
    dailyUsage: number;
  };
}

export function useCostMetrics(projectId?: number) {
  const { data: costAnalysis, isLoading: analysisLoading } = useQuery({
    queryKey: ['/api/cost-analytics'],
    queryFn: () => api.getCostAnalysis(),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: projectMetrics = [], isLoading: metricsLoading } = useQuery({
    queryKey: ['/api/projects', projectId, 'cost-metrics'],
    queryFn: () => projectId ? api.getProjectCostMetrics(projectId) : Promise.resolve([]),
    enabled: !!projectId,
    refetchInterval: 30000,
  });

  // Calculate derived metrics
  const dailyCostLimit = costAnalysis?.budget?.dailyLimit || 100;
  const monthlyCostLimit = costAnalysis?.budget?.monthlyLimit || 1000;
  const dailyUsagePercentage = costAnalysis?.dailyCost ? (costAnalysis.dailyCost / dailyCostLimit) * 100 : 0;
  const monthlyUsagePercentage = costAnalysis?.totalCost ? (costAnalysis.totalCost / monthlyCostLimit) * 100 : 0;

  // Provider efficiency metrics
  const providerEfficiency = {
    openai: { cost: 0.000003, quality: 9.5, efficiency: 95 },
    anthropic: { cost: 0.000003, quality: 9.7, efficiency: 97 },
    google: { cost: 0.0000015, quality: 8.8, efficiency: 92 },
    xai: { cost: 0.000002, quality: 8.5, efficiency: 88 },
    meta: { cost: 0.0000018, quality: 8.2, efficiency: 85 },
    qwen: { cost: 0.0000012, quality: 8.0, efficiency: 82 },
  };

  // Cost trends (mock data for demonstration)
  const costTrends = [
    { date: '2025-01-07', cost: 45.23, provider: 'openai' },
    { date: '2025-01-08', cost: 52.18, provider: 'anthropic' },
    { date: '2025-01-09', cost: 38.94, provider: 'google' },
    { date: '2025-01-10', cost: 47.82, provider: 'openai' },
  ];

  // Optimization recommendations
  const optimizationRecommendations = [
    {
      type: 'provider_switch',
      title: 'Switch Simple Tasks to Qwen',
      description: 'Route simple analysis tasks to Qwen 2.5 72B for 40% cost reduction',
      potential_savings: 23.45,
      impact: 'medium'
    },
    {
      type: 'caching',
      title: 'Enable Response Caching',
      description: 'Cache similar responses to reduce redundant API calls',
      potential_savings: 15.30,
      impact: 'low'
    },
    {
      type: 'context_optimization',
      title: 'Optimize Context Length',
      description: 'Use mem0 for better context management and token reduction',
      potential_savings: 31.20,
      impact: 'high'
    }
  ];

  // Budget alerts
  const budgetAlerts = [];
  if (dailyUsagePercentage > 80) {
    budgetAlerts.push({
      type: 'warning',
      message: `Daily budget usage at ${dailyUsagePercentage.toFixed(1)}%`,
      threshold: 80
    });
  }
  if (monthlyUsagePercentage > 75) {
    budgetAlerts.push({
      type: 'warning', 
      message: `Monthly budget usage at ${monthlyUsagePercentage.toFixed(1)}%`,
      threshold: 75
    });
  }

  return {
    costAnalysis,
    costMetrics: projectMetrics,
    providerEfficiency,
    costTrends,
    optimizationRecommendations,
    budgetAlerts,
    dailyUsagePercentage,
    monthlyUsagePercentage,
    isLoading: analysisLoading || metricsLoading,
  };
}
