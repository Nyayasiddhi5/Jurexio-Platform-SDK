import { useState } from 'react';
import { Link } from 'wouter';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import { OrchestrationTraceChatReference } from '@/components/orchestration/OrchestrationTraceChatReference';
import type { ExecutionOutcome } from '@/components/execution/ExecutionOutcomePanel';
import { streamQueenAguiForConsole } from '@/services/jrx-admin-agui-adapter';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { BRAND } from '@/features/legal-chat/brand';

const IDLE_OUTCOME: ExecutionOutcome = { status: 'idle', text: '' };

function mergeTimelineEvent(
  prev: LegalChatTimelineEvent[],
  e: LegalChatTimelineEvent,
): LegalChatTimelineEvent[] {
  const idx = prev.findIndex((x) => x.step === e.step);
  if (idx === -1) return [...prev, e];
  const next = prev.slice();
  next[idx] = e;
  return next;
}

function outcomeFromEvent(
  e: LegalChatTimelineEvent,
  prev: ExecutionOutcome,
): ExecutionOutcome {
  const resp = e.data?.response ?? e.data?.answer ?? e.data?.accumulated;
  const text = typeof resp === 'string' ? resp : prev.text;
  const citations = Array.isArray(e.data?.citations)
    ? (e.data?.citations as Array<Record<string, unknown>>)
    : prev.citations;

  if (e.step === 'run_complete') {
    return {
      ...prev,
      status: e.status === 'blocked' ? 'blocked' : 'complete',
      text: typeof e.data?.response === 'string' ? e.data.response : text,
      citations,
      model: typeof e.data?.model === 'string' ? e.data.model : prev.model,
      chars: typeof e.data?.response === 'string' ? e.data.response.length : prev.chars,
      maxOutputTokens: typeof e.data?.maxOutputTokens === 'number'
        ? e.data.maxOutputTokens
        : prev.maxOutputTokens,
    };
  }

  if (e.step === 'run_failed') {
    return { ...prev, status: 'failed', error: e.message || 'run failed' };
  }

  if (e.step === 'llm_stream_completed' && typeof e.data?.response === 'string') {
    return {
      ...prev,
      status: 'streaming',
      text: e.data.response,
      chars: e.data.response.length,
    };
  }

  if (text && prev.status !== 'complete' && prev.status !== 'blocked') {
    return { ...prev, status: 'streaming', text, chars: text.length, citations };
  }

  return prev.status === 'idle'
    ? { ...prev, status: 'streaming' }
    : prev;
}

export default function OrchestrationTracePane() {
  const [prompt, setPrompt] = useState('What is Section 103 of the Bharatiya Nyaya Sanhita about?');
  const [lastRunPrompt, setLastRunPrompt] = useState('');
  const [events, setEvents] = useState<LegalChatTimelineEvent[]>([]);
  const [orchId, setOrchId] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<ExecutionOutcome>(IDLE_OUTCOME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!prompt.trim() || busy) return;
    const task = prompt.trim();
    setBusy(true);
    setError(null);
    setEvents([]);
    setOrchId(undefined);
    setLastRunPrompt(task);
    setOutcome({ status: 'streaming', text: '' });
    try {
      const streamed = await streamQueenAguiForConsole(
        { task, jurisdiction: 'IN' },
        (e) => {
          setEvents((prev) => mergeTimelineEvent(prev, e));
          setOrchId(e.orchestrationId);
          setOutcome((prev) => outcomeFromEvent(e, prev));
        },
        undefined,
        (partialText) => {
          setOutcome((prev) => ({
            ...prev,
            status: prev.status === 'idle' ? 'streaming' : prev.status,
            text: partialText,
            chars: partialText.length,
          }));
        },
      );
      setOrchId(streamed.orchestrationId);
      setOutcome(streamed.outcome);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'trace failed';
      setError(msg);
      setOutcome({ status: 'failed', text: '', error: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12 p-4" data-testid="orch-trace-pane">
      <div className="lg:col-span-4 space-y-3">
        <h2 className="text-sm font-bold" style={{ color: BRAND.royal }}>Queen execution trace</h2>
        <p className="text-xs text-slate-600">
          Console JWT → <code>POST /api/jrx/stream</code>. The 16-step Queen rail stays visible after each run; the final answer appears in the panel below.
        </p>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          data-testid="orch-trace-prompt"
        />
        <div className="flex items-center gap-2">
          <Button onClick={() => void run()} disabled={busy} data-testid="orch-trace-run">
            {busy ? 'Running…' : 'Run Legal prompt'}
          </Button>
          {orchId ? (
            <Link href={`/orchestration/lineage/${encodeURIComponent(orchId)}`}>
              <span className="text-xs underline" style={{ color: BRAND.royal }}>Lineage {orchId.slice(0, 12)}…</span>
            </Link>
          ) : null}
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>

      <div className="lg:col-span-8 flex flex-col gap-4 pb-6">
        <section aria-label="Live execution trace" data-testid="orch-trace-rail-section">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ background: BRAND.royalSoft, color: BRAND.royal }}
            >
              Step 1 · Live trace
            </span>
            <span className="text-[11px]" style={{ color: BRAND.muted }}>
              16-step Queen rail — stays visible after the run completes
            </span>
          </div>
          <div className="min-h-[480px] h-[480px] shrink-0 overflow-hidden rounded-lg border border-slate-200 shadow-sm">
            <ExecutionTraceRail
              events={events}
              orchestrationId={orchId}
              title="Queen orchestration engine"
              outcome={outcome}
              showDiagnostics={false}
              showOutcomePanel={false}
              showFooterLinks={false}
            />
          </div>
        </section>
        <section aria-label="Orchestration outcome" data-testid="orch-trace-outcome-section">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ background: '#FBF9F0', color: '#7A6A1F', border: `1px solid ${BRAND.goldBorder}` }}
            >
              Step 2 · Outcome
            </span>
            <span className="text-[11px]" style={{ color: BRAND.muted }}>
              Your question and the gated final response
            </span>
          </div>
          <OrchestrationTraceChatReference
            question={lastRunPrompt || prompt}
            outcome={outcome}
            orchestrationId={orchId}
            busy={busy}
          />
        </section>
      </div>
    </div>
  );
}
