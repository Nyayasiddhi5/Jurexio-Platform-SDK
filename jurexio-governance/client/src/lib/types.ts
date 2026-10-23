export interface DashboardOverview {
  totalAgents: number;
  activeAgents: number;
  totalProviders: number;
  activeProviders: number;
  totalModels: number;
  recentOrchestrations: any[];
  metrics: Record<string, {
    value: string;
    unit: string;
    timestamp: Date;
  }>;
  indiaFeatures: Record<string, any[]>;
}

export interface AgentStats {
  [category: string]: {
    total: number;
    active: number;
  };
}
