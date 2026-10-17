/**
 * NV-AGUI-OUTCOME-PANEL-001 — authoritative Queen final output for admin trace.
 * Prefers synthesis_final / run_complete response; never shows placeholder prose.
 */
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, AlertCircle, Loader2 } from 'lucide-react';
import { BRAND } from '@/features/legal-chat/brand';

export type ExecutionOutcomeStatus = 'idle' | 'streaming' | 'complete' | 'blocked' | 'failed';

export interface ExecutionOutcome {
  status: ExecutionOutcomeStatus;
  text: string;
  citations?: Array<Record<string, unknown>>;
  model?: string;
  chars?: number;
  maxOutputTokens?: number;
  error?: string;
}

export interface ExecutionOutcomePanelProps {
  outcome: ExecutionOutcome;
  className?: string;
}

function citationLabel(c: Record<string, unknown>, index: number): string {
  const title = c.title ?? c.text ?? c.source ?? c.id;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return `Citation ${index + 1}`;
}

export function ExecutionOutcomePanel({ outcome, className = '' }: ExecutionOutcomePanelProps) {
  const { status, text, citations = [], model, chars, maxOutputTokens, error } = outcome;

  if (status === 'idle') {
    return (
      <div
        className={`border-t border-slate-200 px-4 py-6 text-center ${className}`}
        data-testid="execution-outcome-idle"
      >
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" style={{ color: BRAND.muted }} />
        <p className="text-[11px]" style={{ color: BRAND.muted }}>
          Run a prompt to see the gated final synthesis here.
        </p>
      </div>
    );
  }

  if (status === 'streaming' && !text) {
    return (
      <div className={`border-t border-slate-200 px-4 py-4 ${className}`} data-testid="execution-outcome-streaming">
        <div className="flex items-center gap-2 text-[11px]" style={{ color: BRAND.muted }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: BRAND.gold }} />
          Queen orchestration in progress…
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className={`border-t border-red-200 bg-red-50/50 px-4 py-4 ${className}`} data-testid="execution-outcome-failed">
        <div className="flex items-start gap-2 text-[11px] text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Stream failed — no final outcome captured</p>
            {error ? <p className="mt-1 opacity-90">{error}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (!text.trim()) {
    return (
      <div className={`border-t border-amber-200 bg-amber-50/40 px-4 py-4 ${className}`} data-testid="execution-outcome-empty">
        <p className="text-[11px] font-semibold" style={{ color: '#8A7420' }}>
          Run finished without assistant text on the wire.
        </p>
        <p className="text-[10px] mt-1" style={{ color: BRAND.muted }}>
          Check gateway logs for safety block or synthesis failure — this panel does not invent placeholder answers.
        </p>
      </div>
    );
  }

  const displayChars = chars ?? text.length;

  return (
    <div className={`border-t border-slate-200 flex flex-col min-h-0 ${className}`} data-testid="execution-outcome-panel">
      <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <FileText className="h-3.5 w-3.5" style={{ color: BRAND.royal }} />
        <span className="text-[11px] font-bold" style={{ color: BRAND.royal }}>Execution outcome</span>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {status === 'blocked' ? 'blocked' : 'complete'}
        </Badge>
        {model ? (
          <Badge variant="secondary" className="text-[10px] font-mono">{model}</Badge>
        ) : null}
        <span className="text-[10px] font-mono" style={{ color: BRAND.muted }}>
          {displayChars.toLocaleString()} chars
          {maxOutputTokens ? ` · cap ${maxOutputTokens.toLocaleString()} tok` : ''}
        </span>
      </div>
      <ScrollArea className="max-h-72">
        <div className="px-4 py-3">
          <pre
            className="text-[12px] leading-relaxed whitespace-pre-wrap break-words font-sans"
            style={{ color: BRAND.ink }}
            data-testid="execution-outcome-text"
          >
            {text}
          </pre>
          {citations.length > 0 ? (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: BRAND.royal }}>
                Citations ({citations.length})
              </p>
              <ul className="space-y-1 text-[11px]" style={{ color: BRAND.muted }}>
                {citations.slice(0, 12).map((c, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="font-mono font-semibold" style={{ color: BRAND.gold }}>{i + 1}.</span>
                    <span className="break-all">{citationLabel(c, i)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export default ExecutionOutcomePanel;
