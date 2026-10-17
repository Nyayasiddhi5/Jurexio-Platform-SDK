/**
 * NV-AGUI-TRACE-CHAT-REF-001 — question ↔ outcome correlation for admin trace tab.
 */
import { useState, type ReactNode } from 'react';
import { Copy, Check, User, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ExecutionOutcome } from '@/components/execution/ExecutionOutcomePanel';
import { BRAND } from '@/features/legal-chat/brand';

export interface OrchestrationTraceChatReferenceProps {
  question: string;
  outcome: ExecutionOutcome;
  orchestrationId?: string;
  busy?: boolean;
}

function citationLabel(c: Record<string, unknown>, index: number): string {
  const title = c.title ?? c.text ?? c.source ?? c.id;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return `Citation ${index + 1}`;
}

function renderAnswerBody(text: string): ReactNode {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return (
        <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words font-mono bg-slate-50 rounded-md p-3 border border-slate-200">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      /* fall through to markdown-style sections */
    }
  }

  const sections = trimmed.split(/\n(?=#{1,3}\s)/);
  if (sections.length > 1) {
    return (
      <div className="space-y-3">
        {sections.map((section, i) => {
          const lines = section.split('\n');
          const head = lines[0]?.replace(/^#+\s*/, '') ?? `Section ${i + 1}`;
          const body = lines.slice(1).join('\n').trim();
          return (
            <div key={i}>
              <p className="text-[11px] font-bold mb-1" style={{ color: BRAND.royal }}>{head}</p>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: BRAND.ink }}>{body || section}</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: BRAND.ink }}>
      {trimmed}
    </p>
  );
}

export function OrchestrationTraceChatReference({
  question,
  outcome,
  orchestrationId,
  busy,
}: OrchestrationTraceChatReferenceProps) {
  const [copied, setCopied] = useState(false);
  const { status, text, citations = [], model, chars, maxOutputTokens, error } = outcome;
  const tokenEst = Math.ceil((chars ?? text.length) / 4);
  const showAnswer = Boolean(text.trim()) || status === 'streaming' || status === 'failed';

  async function copyAnswer() {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }

  if (status === 'idle' && !busy) {
    return (
      <div
        className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center"
        data-testid="orch-trace-chat-idle"
      >
        <p className="text-sm font-medium mb-1" style={{ color: BRAND.ink }}>
          Request / response reference
        </p>
        <p className="text-xs" style={{ color: BRAND.muted }}>
          Run a legal prompt on the left. The 7-phase workflow preview above fills in step-by-step; your question and the gated final answer will appear here.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col min-h-[280px]"
      data-testid="orch-trace-chat-reference"
    >
      <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold" style={{ color: BRAND.royal }}>Request / response reference</span>
        {orchestrationId ? (
          <span className="text-[10px] font-mono ml-auto truncate max-w-[200px]" style={{ color: BRAND.muted }}>
            {orchestrationId.slice(0, 20)}…
          </span>
        ) : null}
      </div>

      <ScrollArea className="flex-1 max-h-[420px]">
        <div className="p-4 space-y-4">
          <div className="flex justify-end gap-2" data-testid="orch-trace-user-question">
            <div
              className="max-w-[92%] rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm"
              style={{ background: BRAND.royal, color: '#fff' }}
            >
              {question}
            </div>
            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
              <User className="h-4 w-4 text-slate-500" />
            </div>
          </div>

          <div className="flex justify-start gap-2" data-testid="orch-trace-assistant-answer">
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-sm"
              style={{ background: BRAND.royal, color: BRAND.gold }}
            >
              Q
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[11px] font-semibold" style={{ color: BRAND.royal }}>
                  Orchestration outcome
                </span>
                {busy || (status === 'streaming' && !text) ? (
                  <Badge variant="outline" className="text-[10px] animate-pulse">streaming…</Badge>
                ) : null}
                {status === 'complete' || status === 'blocked' ? (
                  <Badge variant="outline" className="text-[10px]">
                    {status === 'blocked' ? 'blocked' : 'complete'}
                  </Badge>
                ) : null}
                {model ? <Badge variant="secondary" className="text-[10px] font-mono">{model}</Badge> : null}
                {text ? (
                  <span className="text-[10px] font-mono" style={{ color: BRAND.muted }}>
                    ~{tokenEst.toLocaleString()} tok · {text.length.toLocaleString()} chars
                    {maxOutputTokens ? ` · cap ${maxOutputTokens.toLocaleString()}` : ''}
                  </span>
                ) : null}
                {text ? (
                  <button
                    type="button"
                    onClick={() => void copyAnswer()}
                    className="ml-auto text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
                    data-testid="orch-trace-copy-answer"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
              </div>

              <div className="rounded-2xl rounded-tl-md px-3.5 py-3 bg-slate-50 border border-slate-200">
                {status === 'failed' ? (
                  <p className="text-[13px] text-red-700">
                    {error || 'Stream failed — no final text captured.'}
                  </p>
                ) : null}
                {status === 'streaming' && !text && !busy ? (
                  <p className="text-[13px]" style={{ color: BRAND.muted }}>Waiting for synthesis…</p>
                ) : null}
                {status === 'streaming' && !text && busy ? (
                  <span className="inline-flex gap-1 items-center text-slate-400 text-[13px]">
                    <Sparkles className="h-3.5 w-3.5 animate-pulse" style={{ color: BRAND.gold }} />
                    Queen orchestration running…
                  </span>
                ) : null}
                {!text.trim() && (status === 'complete' || status === 'blocked') ? (
                  <p className="text-[13px] font-medium" style={{ color: '#8A7420' }}>
                    Run finished without assistant text on the wire — no placeholder is shown.
                  </p>
                ) : null}
                {text.trim() ? (
                  <div data-testid="orch-trace-answer-body">{renderAnswerBody(text)}</div>
                ) : null}

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
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export default OrchestrationTraceChatReference;
