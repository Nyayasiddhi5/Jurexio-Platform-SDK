import { motion, MotionProps } from 'framer-motion';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlassmorphicCardProps extends Omit<MotionProps, 'children'> {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'bordered' | 'elevated';
  'data-testid'?: string;
}

export function GlassmorphicCard({ 
  children, 
  className,
  variant = 'default',
  'data-testid': testId,
  ...motionProps 
}: GlassmorphicCardProps) {
  const variants = {
    default: 'glass-card',
    bordered: 'glass-card gradient-border',
    elevated: 'glass-card shadow-xl'
  };

  return (
    <motion.div
      className={cn(variants[variant], className)}
      data-testid={testId}
      {...motionProps}
    >
      {children}
    </motion.div>
  );
}
