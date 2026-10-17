/**
 * NyvEmptyState — Reusable Jurexio branded empty-state component.
 * Used across all pages when no data is available.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

export interface NyvEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  secondaryCta?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'card' | 'inline';
}

export function NyvEmptyState({
  icon: Icon,
  title,
  description,
  cta,
  secondaryCta,
  className,
  size = 'md',
  variant = 'default',
}: NyvEmptyStateProps) {
  const sizes = {
    sm: { wrapper: 'py-8 px-4', iconBox: 'w-10 h-10', iconSize: 'w-5 h-5', title: 'text-sm', desc: 'text-xs' },
    md: { wrapper: 'py-14 px-6', iconBox: 'w-14 h-14', iconSize: 'w-7 h-7', title: 'text-base', desc: 'text-sm' },
    lg: { wrapper: 'py-20 px-8', iconBox: 'w-16 h-16', iconSize: 'w-8 h-8', title: 'text-lg', desc: 'text-base' },
  };
  const s = sizes[size];

  const wrapper = cn(
    'flex flex-col items-center justify-center text-center',
    s.wrapper,
    variant === 'card' && 'bg-slate-900/40 border border-slate-800/60 rounded-xl',
    className,
  );

  return (
    <div className={wrapper} role="status" aria-live="polite">
      {Icon && (
        <div className={cn('rounded-2xl bg-gradient-to-br from-[#152448]/30 to-[#1a4a9a]/20 border border-[#152448]/30 flex items-center justify-center mb-4', s.iconBox)}>
          <Icon className={cn(s.iconSize, 'text-[#C7B15B]/70')} aria-hidden="true" />
        </div>
      )}
      <h3 className={cn('font-semibold text-white mb-2', s.title)}>{title}</h3>
      {description && (
        <p className={cn('text-slate-500 max-w-sm leading-relaxed mb-5', s.desc)}>{description}</p>
      )}
      {(cta || secondaryCta) && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {cta && (
            <button
              onClick={cta.onClick}
              className="px-4 py-2 rounded-lg bg-[#152448] hover:bg-[#0d3580] text-white text-sm font-medium transition-colors"
            >
              {cta.label}
            </button>
          )}
          {secondaryCta && (
            <button
              onClick={secondaryCta.onClick}
              className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-sm font-medium transition-colors"
            >
              {secondaryCta.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default NyvEmptyState;
