'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// StatusBadge component
function StatusBadge({ status, children }: { status: 'active' | 'inactive' | 'error'; children: React.ReactNode }) {
  const variant = status === 'active' ? 'default' : status === 'inactive' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{children}</Badge>;
}
import { useAgents } from '@/hooks/use-agents';
import { Bot, TrendingUp, Clock, Zap } from 'lucide-react';

export function AgentStatus() {
  const { data: agents, isLoading } = useAgents();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const agentStats = agents?.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const totalAgents = agents?.length || 0;
  const activeAgents = agentStats.active || 0;
  const healthyAgents = agents?.filter(a => a.healthStatus.healthy).length || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Agent Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-2xl font-bold">{totalAgents}</div>
              <div className="text-muted-foreground">Total Agents</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{activeAgents}</div>
              <div className="text-muted-foreground">Active</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{healthyAgents}</div>
              <div className="text-muted-foreground">Healthy</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-600">{Math.round((activeAgents / Math.max(totalAgents, 1)) * 100)}%</div>
              <div className="text-muted-foreground">Uptime</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Status Distribution</div>
            {Object.entries(agentStats).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} size="sm" />
                  <span className="text-sm capitalize">{status}</span>
                </div>
                <span className="text-sm font-medium">{count}</span>
              </div>
            ))}
          </div>

          {agents && agents.length > 0 && (
            <div className="pt-2 border-t">
              <div className="text-sm text-muted-foreground">Recent Activity</div>
              <div className="space-y-1 mt-2">
                {agents.slice(0, 3).map((agent) => (
                  <div key={agent.id} className="text-xs flex items-center justify-between">
                    <span className="truncate">{agent.name}</span>
                    <StatusBadge status={agent.status} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}