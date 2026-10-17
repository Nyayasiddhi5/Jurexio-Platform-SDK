'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrchestrationHistory } from '@/hooks/use-orchestration';
import { Activity, Clock, User, Zap } from 'lucide-react';

// Utility functions
const formatDuration = (ms: number) => `${ms.toFixed(0)}ms`;
function StatusBadge({ status, children }: { status: 'success' | 'error' | 'pending'; children: React.ReactNode }) {
  const variant = status === 'success' ? 'default' : status === 'error' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{children}</Badge>;
}

export function RecentActivity() {
  const { data: history, isLoading } = useOrchestrationHistory();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
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

  const recentExecutions = history?.slice(0, 10) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentExecutions.length > 0 ? (
            recentExecutions.map((execution: any, index) => (
              <div key={execution.id || index} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex-shrink-0">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={execution.status === 'success' ? 'success' : execution.status === 'error' ? 'error' : 'pending'}>
                      {execution.type || 'Orchestration'}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatDuration(execution.executionTime || 0)}</span>
                    {execution.usedAgents && execution.usedAgents.length > 0 && (
                      <>
                        <span>•</span>
                        <span>{execution.usedAgents.length} agents</span>
                      </>
                    )}
                    {execution.actualCost && (
                      <>
                        <span>•</span>
                        <span>${(execution.actualCost || 0).toFixed(4)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(execution.startTime || Date.now()).toLocaleTimeString()}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">No recent activity</div>
              <div className="text-xs">Orchestration history will appear here</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}