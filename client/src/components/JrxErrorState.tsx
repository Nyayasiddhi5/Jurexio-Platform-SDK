/**
 * JrxErrorState — Reusable Jurexio branded fetch-error component.
 * Mirrors JrxEmptyState API; used across all pages when a data fetch fails.
 * task-180 (B5).
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, LucideIcon, RefreshCw } from 'lucide-react';

export interface JrxErrorStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'card' | 'inline';
}

function formatError(err: unknown): string | undefined {
  if (!err) return undefined;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

export function JrxErrorState({
  icon: Icon = AlertTriangle,
  title = 'Could not load data',
  description,
  error,
  onRetry,
  retryLabel = 'Retry',
  className,
  size = 'md',
  variant = 'default',
}: JrxErrorStateProps) {
  const sizes = {
    sm: { wrapper: 'py-8 px-4',  iconBox: 'w-10 h-10', iconSize: 'w-5 h-5', title: 'text-sm',  desc: 'text-xs' },
    md: { wrapper: 'py-14 px-6', iconBox: 'w-14 h-14', iconSize: 'w-7 h-7', title: 'text-base', desc: 'text-sm' },
    lg: { wrapper: 'py-20 px-8', iconBox: 'w-16 h-16', iconSize: 'w-8 h-8', title: 'text-lg',  desc: 'text-base' },
  };
  const s = sizes[size];
  const errMsg = formatError(error);
  const detail = description ?? errMsg;

  // Brand tokens: status.error #CC2C2C, brand.primary navy #152448 (CTA),
  // surface.default white card with border.default #E4E7EC, text.primary navy.
  const wrapper = cn(
    'flex flex-col items-center justify-center text-center',
    s.wrapper,
    className,
  );
  const wrapperStyle = variant === 'card'
    ? { backgroundColor: '#FFFFFF', border: '1px solid #E4E7EC', borderRadius: '12px' }
    : undefined;

  return (
    <div className={wrapper} style={wrapperStyle} role="alert" aria-live="assertive">
      <div
        className={cn('rounded-2xl flex items-center justify-center mb-4', s.iconBox)}
        style={{ backgroundColor: 'rgba(204,44,44,0.08)', border: '1px solid rgba(204,44,44,0.25)' }}
      >
        <Icon className={cn(s.iconSize)} aria-hidden="true" style={{ color: '#CC2C2C' }} />
      </div>
      <h3 className={cn('font-semibold mb-2', s.title)} style={{ color: '#152448' }}>{title}</h3>
      {detail && (
        <p className={cn('max-w-md leading-relaxed mb-5 break-words', s.desc)} style={{ color: '#61697D' }}>{detail}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
          style={{ backgroundColor: '#152448' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1d3266'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#152448'; }}
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default JrxErrorState;
