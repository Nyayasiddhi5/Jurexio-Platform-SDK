import { cn } from '@/lib/utils';

interface PulseStatusIndicatorProps {
  status?: 'success' | 'warning' | 'error' | 'info';
  className?: string;
  'data-testid'?: string;
}

export function PulseStatusIndicator({ 
  status = 'success', 
  className,
  'data-testid': testId
}: PulseStatusIndicatorProps) {
  const statusColors = {
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-destructive',
    info: 'bg-info'
  };

  return (
    <span
      className={cn('status-dot', statusColors[status], className)}
      data-testid={testId}
      aria-label={`${status} status`}
    />
  );
}
