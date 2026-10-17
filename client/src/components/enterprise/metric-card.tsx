import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn, formatNumber, formatPercentage } from '../../lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: 'increase' | 'decrease' | 'neutral';
    period: string;
  };
  icon?: React.ReactNode;
  loading?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  className?: string;
  format?: 'number' | 'percentage' | 'currency' | 'duration';
}

const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ 
    title, 
    value, 
    change, 
    icon, 
    loading = false, 
    clickable = false, 
    onClick, 
    className,
    format = 'number',
    ...props 
  }, ref) => {
    const formatValue = (val: string | number) => {
      if (typeof val === 'string') return val;
      
      switch (format) {
        case 'percentage':
          return formatPercentage(val / 100);
        case 'currency':
          return `$${formatNumber(val)}`;
        case 'duration':
          return `${formatNumber(val)}ms`;
        default:
          return formatNumber(val);
      }
    };

    const getChangeIcon = () => {
      if (!change) return null;
      
      switch (change.type) {
        case 'increase':
          return <TrendingUp className="h-4 w-4 text-green-500" />;
        case 'decrease':
          return <TrendingDown className="h-4 w-4 text-red-500" />;
        default:
          return <Minus className="h-4 w-4 text-gray-500" />;
      }
    };

    const getChangeColor = () => {
      if (!change) return '';
      
      switch (change.type) {
        case 'increase':
          return 'text-green-500';
        case 'decrease':
          return 'text-red-500';
        default:
          return 'text-gray-500';
      }
    };

    return (
      <Card
        ref={ref}
        className={cn(
          'transition-all duration-200',
          clickable && 'cursor-pointer hover:shadow-md hover:scale-[1.02]',
          loading && 'opacity-50',
          className
        )}
        onClick={clickable ? onClick : undefined}
        {...props}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {icon && (
            <div className="h-4 w-4 text-muted-foreground">
              {icon}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {loading ? (
              <div className="h-7 bg-muted animate-pulse rounded" />
            ) : (
              <div className="text-2xl font-bold">
                {formatValue(value)}
              </div>
            )}
            
            {change && !loading && (
              <div className={cn(
                'flex items-center text-xs',
                getChangeColor()
              )}>
                {getChangeIcon()}
                <span className="ml-1">
                  {Math.abs(change.value)}% from {change.period}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

MetricCard.displayName = 'MetricCard';

export { MetricCard };