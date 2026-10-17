'use client';

import { Badge } from '@/components/ui/badge';

// StatusBadge component
function StatusBadge({ status, children }: { status: 'healthy' | 'degraded' | 'unhealthy'; children: React.ReactNode }) {
  const variant = status === 'healthy' ? 'default' : status === 'degraded' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{children}</Badge>;
}
import { useSystemHealth } from '@/hooks/use-system-metrics';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';

export function SystemStatus() {
  const { data: health, isLoading } = useSystemHealth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-muted rounded-full animate-pulse" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  const getStatusIcon = () => {
    switch (health?.status) {
      case 'healthy':
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-3 w-3 text-yellow-500" />;
      case 'unhealthy':
      case 'error':
        return <XCircle className="h-3 w-3 text-red-500" />;
      default:
        return <div className="w-3 h-3 bg-gray-500 rounded-full" />;
    }
  };

  const getStatusText = () => {
    switch (health?.status) {
      case 'healthy':
        return 'All systems operational';
      case 'degraded':
        return 'System degraded';
      case 'unhealthy':
        return 'System unhealthy';
      case 'error':
        return 'System error';
      default:
        return 'Status unknown';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {getStatusIcon()}
      <span className="text-sm hidden sm:inline">{getStatusText()}</span>
      <StatusBadge 
        status={health?.status || 'unknown'} 
        size="sm"
        pulse={health?.status === 'degraded' || health?.status === 'unhealthy'}
      />
    </div>
  );
}