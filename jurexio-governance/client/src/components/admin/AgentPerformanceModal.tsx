import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { 
  Activity, 
  Clock, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  TrendingUp,
  Zap,
  AlertTriangle 
} from 'lucide-react';

import { NV_BASE } from '@/lib/jrx-api-paths';
interface AgentPerformanceModalProps {
  agentId: string | null;
  agentName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AgentPerformanceModal({ 
  agentId, 
  agentName, 
  isOpen, 
  onClose 
}: AgentPerformanceModalProps) {
  const [timeRange, setTimeRange] = useState('24h');

  const { data: performanceData, isLoading } = useQuery({
    queryKey: ['agent-performance', agentId, timeRange],
    queryFn: async () => {
      if (!agentId) return null;
      // /api/admin/agents/:id/performance is not yet exposed under /api/jrx/*.
      // Try the canonical path first, fall back to an empty shape so the modal renders without an error boundary.
      try {
        const token = getAuthToken();
        const response = await fetch(
          `${NV_BASE}agents/${encodeURIComponent(agentId)}/performance?timeRange=${encodeURIComponent(timeRange)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (response.ok) {
          const json = await response.json();
          const payload = json?.data ?? json;
          return {
            metrics: payload?.metrics ?? {},
            timeline: payload?.timeline ?? [],
            unavailable: false,
          };
        }
      } catch { /* fall through to empty */ }
      return { metrics: {}, timeline: [], unavailable: true };
    },
    enabled: isOpen && !!agentId,
  });

  const metrics = performanceData?.metrics || {};
  const timeline = performanceData?.timeline || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-agent-performance">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Performance Monitor
              {agentName && <span className="text-muted-foreground">- {agentName}</span>}
            </DialogTitle>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-32" data-testid="select-time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last Hour</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Key Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Requests</p>
                      <p className="text-2xl font-bold" data-testid="metric-total-requests">
                        {metrics.totalRequests?.toLocaleString() || '0'}
                      </p>
                    </div>
                    <Activity className="w-8 h-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Success Rate</p>
                      <p className="text-2xl font-bold" data-testid="metric-success-rate">
                        {metrics.successRate?.toFixed(1) || '0'}%
                      </p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <Progress 
                    value={metrics.successRate || 0} 
                    className="mt-2"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Response</p>
                      <p className="text-2xl font-bold" data-testid="metric-response-time">
                        {metrics.averageResponseTime?.toFixed(0) || '0'}ms
                      </p>
                    </div>
                    <Clock className="w-8 h-8 text-orange-500" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Cost Usage</p>
                      <p className="text-2xl font-bold" data-testid="metric-cost-usage">
                        ${metrics.costUsage?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                    <DollarSign className="w-8 h-8 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Status Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-green-500" />
                    <span className="text-lg font-bold" data-testid="metric-uptime">
                      {metrics.uptime?.toFixed(2) || '0'}%
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Error Count</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-lg font-bold" data-testid="metric-error-count">
                      {metrics.errorCount || '0'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <Badge variant="secondary" data-testid="metric-status">
                      Operational
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Performance Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Performance Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Peak Requests/Hour:</span>
                      <span className="ml-2 font-semibold">
                        {Math.max(...timeline.map((t: any) => t.requests || 0))}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Min Response Time:</span>
                      <span className="ml-2 font-semibold">
                        {Math.min(...timeline.map((t: any) => t.responseTime || 0)).toFixed(0)}ms
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Errors:</span>
                      <span className="ml-2 font-semibold">
                        {timeline.reduce((sum: number, t: any) => sum + (t.errors || 0), 0)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Simple timeline visualization */}
                  <div className="space-y-2">
                    {timeline.slice(-10).map((point: any, index: number) => (
                      <div key={index} className="flex items-center gap-4 p-2 bg-muted/30 rounded">
                        <div className="w-16 text-xs text-muted-foreground">
                          {new Date(point.timestamp).toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </div>
                        <div className="flex-1 flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-xs">Requests:</span>
                            <Badge variant="outline">{point.requests}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs">Response:</span>
                            <Badge variant="outline">{point.responseTime?.toFixed(0)}ms</Badge>
                          </div>
                          {point.errors > 0 && (
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-3 h-3 text-red-500" />
                              <Badge variant="destructive">{point.errors} errors</Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}