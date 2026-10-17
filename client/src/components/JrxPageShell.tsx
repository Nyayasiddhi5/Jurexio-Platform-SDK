/**
 * JrxPageShell — shared light-theme page chrome for Console consistency.
 * Use inside WithSidebar / hub tabs. Prefer tokens over hex colors.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function JrxPageShell({
  title,
  description,
  actions,
  children,
  className,
  compact,
  testId,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Hub-embedded: less outer padding (hub already pads). */
  compact?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'w-full bg-background text-foreground',
        compact ? 'space-y-4 p-0' : 'min-h-full space-y-6 p-6',
        className,
      )}
      data-testid={testId}
    >
      {(title || description || actions) && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {title ? (
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-royal-blue md:text-3xl">
                {title}
              </h1>
            ) : null}
            {description ? (
              <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/** @deprecated Use JrxPageShell — removed next release */
export const JrxPageShell = JrxPageShell;

export default JrxPageShell;
