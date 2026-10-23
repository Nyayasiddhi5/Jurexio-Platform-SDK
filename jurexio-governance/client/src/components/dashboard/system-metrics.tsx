'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRealTimeMetrics } from '@/hooks/use-real-time-metrics';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

export function SystemMetrics() {
  const { data: realTimeData, isLoading } = useRealTimeMetrics();

  // Transform real-time data for charts
  const performanceData = realTimeData?.performance.responseTime.map((item, index) => ({
    time: item.label,
    responseTime: item.value,
    requests: realTimeData.performance.requests[index]?.value || 0,
    successRate: realTimeData.performance.successRate[index]?.value || 0,
  })) || [];

  const resourceData = realTimeData?.resources.cpu.map((item, index) => ({
    time: item.label,
    cpu: item.value,
    memory: realTimeData.resources.memory[index]?.value || 0,
    network: realTimeData.resources.network[index]?.value || 0,
  })) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="time" 
                  className="text-xs fill-muted-foreground"
                />
                <YAxis className="text-xs fill-muted-foreground" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="responseTime" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  name="Response Time (ms)"
                />
                <Line 
                  type="monotone" 
                  dataKey="requests" 
                  stroke="hsl(var(--secondary))" 
                  strokeWidth={2}
                  name="Requests/min"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resource Utilization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={resourceData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="time" 
                  className="text-xs fill-muted-foreground"
                />
                <YAxis className="text-xs fill-muted-foreground" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="cpu" 
                  stackId="1"
                  stroke="hsl(var(--primary))" 
                  fill="hsl(var(--primary))"
                  fillOpacity={0.6}
                  name="CPU %"
                />
                <Area 
                  type="monotone" 
                  dataKey="memory" 
                  stackId="1"
                  stroke="hsl(var(--secondary))" 
                  fill="hsl(var(--secondary))"
                  fillOpacity={0.6}
                  name="Memory %"
                />
                <Area 
                  type="monotone" 
                  dataKey="network" 
                  stackId="1"
                  stroke="hsl(var(--accent))" 
                  fill="hsl(var(--accent))"
                  fillOpacity={0.6}
                  name="Network %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}