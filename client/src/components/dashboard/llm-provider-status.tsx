'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLLMProviders } from '@/hooks/use-llm-providers';
import { Brain, DollarSign, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

// Utility functions for formatting
const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;
const formatDuration = (ms: number) => `${ms.toFixed(0)}ms`;

// StatusBadge component
function StatusBadge({ status, children }: { status: 'healthy' | 'warning' | 'error'; children: React.ReactNode }) {
  const variant = status === 'healthy' ? 'default' : status === 'warning' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{children}</Badge>;
}

export function LLMProviderStatus() {
  const { data: providers, isLoading } = useLLMProviders();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>LLM Provider Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
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

  const healthyProviders = providers?.filter(p => p.status === 'healthy').length || 0;
  const totalProviders = providers?.length || 0;
  const totalCost = providers?.reduce((sum, p) => sum + p.costTracking.dailySpent, 0) || 0;
  const totalRequests = providers?.reduce((sum, p) => sum + p.usageStats.totalRequests, 0) || 0;
  const avgResponseTime = providers?.reduce((sum, p) => sum + p.usageStats.averageResponseTime, 0) / Math.max(providers?.length || 1, 1) || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          LLM Provider Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-2xl font-bold">{totalProviders}</div>
              <div className="text-muted-foreground">Total Providers</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{healthyProviders}</div>
              <div className="text-muted-foreground">Healthy</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{formatCurrency(totalCost)}</div>
              <div className="text-muted-foreground">Daily Cost</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-600">{formatDuration(avgResponseTime)}</div>
              <div className="text-muted-foreground">Avg Response</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Provider Status</div>
            {providers?.slice(0, 5).map((provider) => (
              <div key={provider.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={provider.status === 'healthy' ? 'healthy' : provider.status === 'warning' ? 'warning' : 'error'}>
                    {provider.displayName}
                  </StatusBadge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{provider.models.length} models</span>
                  <span>{formatCurrency(provider.costTracking.dailySpent)}</span>
                </div>
              </div>
            ))}
            {providers && providers.length > 5 && (
              <div className="text-xs text-center text-muted-foreground pt-2">
                +{providers.length - 5} more providers
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}