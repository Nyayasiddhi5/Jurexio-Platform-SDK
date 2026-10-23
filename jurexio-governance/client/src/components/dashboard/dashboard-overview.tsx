'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// MetricCard component
interface MetricCardProps {
  title: string;
  value: number | string;
  change?: {
    value: number;
    type: 'increase' | 'decrease';
    period: string;
  };
  icon?: React.ReactNode;
  format?: 'number' | 'currency' | 'percentage';
}

function MetricCard({ title, value, change, icon, format = 'number' }: MetricCardProps) {
  const formatValue = (val: number | string) => {
    if (typeof val === 'string') return val;
    switch (format) {
      case 'currency': return `$${val.toFixed(2)}`;
      case 'percentage': return `${val.toFixed(1)}%`;
      default: return val.toLocaleString();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatValue(value)}</div>
        {change && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Badge variant={change.type === 'increase' ? 'default' : 'secondary'}>
              {change.type === 'increase' ? '+' : '-'}{change.value}%
            </Badge>
            <span>{change.period}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
import { useSystemMetrics } from '@/hooks/use-system-metrics';
import { Bot, Brain, Zap, DollarSign, TrendingUp, Clock } from 'lucide-react';

export function DashboardOverview() {
  const { data: metrics, isLoading } = useSystemMetrics();

  const overviewMetrics = [
    {
      title: 'Active Agents',
      value: metrics?.agents?.active || 0,
      change: {
        value: 12,
        type: 'increase' as const,
        period: 'last 24h',
      },
      icon: <Bot className="h-4 w-4" />,
    },
    {
      title: 'LLM Providers',
      value: metrics?.llm?.providers || 0,
      change: {
        value: 5,
        type: 'increase' as const,
        period: 'last week',
      },
      icon: <Brain className="h-4 w-4" />,
    },
    {
      title: 'Total Executions',
      value: metrics?.orchestration?.totalExecutions || 0,
      change: {
        value: 23,
        type: 'increase' as const,
        period: 'today',
      },
      icon: <Zap className="h-4 w-4" />,
      format: 'number' as const,
    },
    {
      title: 'Total Cost',
      value: metrics?.llm?.totalCost || 0,
      change: {
        value: 8,
        type: 'decrease' as const,
        period: 'this month',
      },
      icon: <DollarSign className="h-4 w-4" />,
      format: 'currency' as const,
    },
    {
      title: 'Success Rate',
      value: ((metrics?.orchestration?.successfulExecutions || 0) / Math.max(metrics?.orchestration?.totalExecutions || 1, 1)) * 100,
      change: {
        value: 2.5,
        type: 'increase' as const,
        period: 'last 7d',
      },
      icon: <TrendingUp className="h-4 w-4" />,
      format: 'percentage' as const,
    },
    {
      title: 'Avg Response Time',
      value: metrics?.agents?.averageResponseTime || 0,
      change: {
        value: 15,
        type: 'decrease' as const,
        period: 'last hour',
      },
      icon: <Clock className="h-4 w-4" />,
      format: 'duration' as const,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {overviewMetrics.map((metric, index) => (
        <MetricCard
          key={index}
          title={metric.title}
          value={metric.value}
          change={metric.change}
          icon={metric.icon}
          loading={isLoading}
          format={metric.format}
        />
      ))}
    </div>
  );
}