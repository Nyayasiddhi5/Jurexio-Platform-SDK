import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassmorphicCard } from './GlassmorphicCard';

interface AnimatedMetricProps {
  value: string;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
  delay?: number;
  className?: string;
  'data-testid'?: string;
}

export function AnimatedMetric({
  value,
  label,
  icon: Icon,
  iconColor = 'text-primary',
  delay = 0,
  className,
  'data-testid': testId
}: AnimatedMetricProps) {
  return (
    <GlassmorphicCard
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay }}
      className={cn('text-center', className)}
      data-testid={testId}
    >
      <Icon className={cn('w-6 h-6 mx-auto mb-2', iconColor)} />
      <div className="text-3xl font-bold gradient-text font-body mb-1">{value}</div>
      <div className="text-sm text-foreground-secondary">{label}</div>
    </GlassmorphicCard>
  );
}
