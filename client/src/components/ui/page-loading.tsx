/**
 * PageLoading — canonical full-section loading skeleton (task-180/B5).
 * Use in place of bespoke `<Loader2 className="animate-spin">` blocks so every
 * page renders the same loading silhouette.
 */
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface PageLoadingProps {
  rows?: number;
  className?: string;
  label?: string;
}

export function PageLoading({ rows = 4, className, label = 'Loading…' }: PageLoadingProps) {
  return (
    <div
      className={cn('w-full space-y-3 p-4', className)}
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="page-loading"
    >
      <Skeleton className="h-6 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export default PageLoading;
