import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const statusBadgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        healthy: 'bg-green-100 text-green-800 border border-green-200',
        active: 'bg-green-100 text-green-800 border border-green-200',
        success: 'bg-green-100 text-green-800 border border-green-200',
        running: 'bg-blue-100 text-blue-800 border border-blue-200',
        pending: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
        warning: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
        degraded: 'bg-orange-100 text-orange-800 border border-orange-200',
        error: 'bg-red-100 text-red-800 border border-red-200',
        failed: 'bg-red-100 text-red-800 border border-red-200',
        offline: 'bg-gray-100 text-gray-800 border border-gray-200',
        inactive: 'bg-gray-100 text-gray-800 border border-gray-200',
        maintenance: 'bg-purple-100 text-purple-800 border border-purple-200',
        default: 'bg-secondary text-secondary-foreground border',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusBadgeVariants> {
  status?: string;
  text?: string;
  pulse?: boolean;
}

const StatusBadge = React.forwardRef<HTMLDivElement, StatusBadgeProps>(
  ({ className, variant, size, status, text, pulse = false, ...props }, ref) => {
    // Auto-detect variant from status if not provided
    const autoVariant = variant || (status ? getVariantFromStatus(status) : 'default');
    const displayText = text || status || 'Unknown';

    return (
      <div
        ref={ref}
        className={cn(statusBadgeVariants({ variant: autoVariant, size, className }))}
        {...props}
      >
        {pulse && (
          <span className="flex h-2 w-2 relative mr-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
          </span>
        )}
        {displayText}
      </div>
    );
  }
);

StatusBadge.displayName = 'StatusBadge';

type StatusVariant = NonNullable<VariantProps<typeof statusBadgeVariants>['variant']>;

function getVariantFromStatus(status: string): StatusVariant {
  const statusMap: Record<string, StatusVariant> = {
    healthy: 'healthy',
    active: 'active',
    success: 'success',
    running: 'running',
    pending: 'pending',
    warning: 'warning',
    degraded: 'degraded',
    error: 'error',
    failed: 'failed',
    offline: 'offline',
    inactive: 'inactive',
    maintenance: 'maintenance',
  };
  return statusMap[status.toLowerCase()] || 'default';
}

export { StatusBadge, statusBadgeVariants };