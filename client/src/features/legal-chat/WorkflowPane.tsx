import { StepCard } from './StepCard';
import type { LegalChatTimelineEvent, LegalChatTimelineStep } from '@/services/legal-chat-api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import {
  Inbox, Brain, Database, Route, Sparkles,
  ShieldCheck, CheckCircle2, Activity,
} from 'lucide-react';
import { BRAND } from './brand';

import { NV_BASE } from '@/lib/jrx-api-paths';
interface WorkflowPaneProps {
  events: LegalChatTimelineEvent[];
  orchestrationId?: string;
}

// Task #156 — WorkflowPane v2: 16-step canonical grouping over the
// LegalChatTimelineStep union (request_received → run_complete). Steps
// not yet emitted render as 'pending' placeholders so SMEs see the full
// 16-step pipeline at a glance, not just the events that have arrived.
const CANONICAL_GROUPS: Array<{
  group: string;
  Icon: typeof Inbox;
  steps: Array<{ step: LegalChatTimelineStep; label: string }>;
}> = [
  { group: 'Intake', Icon: Inbox, steps: [
    { step: 'request_received', label: '1 · Request received' },
    { step: 'pii_redaction', label: '2 · PII redaction' },
    { step: 'session_persisted', label: '3 · Session persisted' },
  ]},
  { group: 'Planning', Icon: Brain, steps: [
    { step: 'agent_selection', label: '4 · Agent selection' },
    { step: 'prompt_compiled', label: '5 · Prompt compiled' },
  ]},
  { group: 'Retrieval', Icon: Database, steps: [
    { step: 'rag_retrieval', label: '6 · RAG retrieval' },
    { step: 'memory_injection', label: '7 · Memory L1–L5 injection' },
  ]},
  { group: 'Routing', Icon: Route, steps: [
    { step: 'router_decision', label: '8 · Router decision' },
  ]},
  { group: 'Generation', Icon: Sparkles, steps: [
    { step: 'llm_stream_started', label: '9 · LLM stream started' },
    // 10 · llm_stream_token intentionally omitted from the canonical
    // grid — Queen orchestrator returns synthesis as a single block
    // (no per-token chunk emission today). Will be reinstated when the
    // synthesis path exposes onChunk callbacks.
    { step: 'llm_stream_completed', label: '11 · LLM stream completed' },
  ]},
  { group: 'Verification', Icon: ShieldCheck, steps: [
    { step: 'maker_checker', label: '12a · Maker-checker (CAM)' },
    { step: 'safety_verdict', label: '12 · Safety verdict' },
    { step: 'citation_grounding', label: '13 · Citation grounding' },
    { step: 'audit_chain', label: '14 · Audit chain' },
  ]},
  { group: 'Complete', Icon: CheckCircle2, steps: [
    { step: 'response_persisted', label: '15 · Response persisted' },
    { step: 'run_complete', label: '16 · Run complete' },
  ]},
];

export function WorkflowPane({ events, orchestrationId }: WorkflowPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Replay state machine: monotonic `replayIndex` advances one event per
  // 80 ms tick. When replayIndex === null we render the full live timeline.
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  // Replay-from-server (NV-REPLAY-TIMELINE-001): when present, overrides
  // the live `events` array so SMEs replay the canonical buffered timeline
  // fetched from GET /api/jrx/legal-chat/timeline/:id rather than the
  // local in-memory SSE buffer (which can be partial if the user opened
  // the pane mid-run or refreshed the tab).
  const [serverReplay, setServerReplay] = useState<LegalChatTimelineEvent[] | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events.length, replayIndex]);

  // Source array for the replay window: server-fetched canonical buffer
  // when available, otherwise the local SSE event log.
  const sourceEvents = serverReplay ?? events;

  useEffect(() => {
    if (replayIndex === null) return;
    if (replayIndex >= sourceEvents.length) { setReplayIndex(null); return; }
    const id = setTimeout(() => setReplayIndex((i) => (i === null ? null : i + 1)), 80);
    return () => clearTimeout(id);
  }, [replayIndex, sourceEvents.length]);

  const renderEvents = replayIndex === null ? sourceEvents : sourceEvents.slice(0, replayIndex);

  async function handleReplay() {
    if (!orchestrationId) { setReplayIndex(0); return; }
    setReplayLoading(true);
    try {
      // GET /timeline/:id returns the server's canonical buffered timeline
      // (publishTimeline buffer, MAX_BUFFER=500, TTL 10m) so replay shows
      // every step that ever fired even if the local SSE missed any.
      // Bearer token same shape as legal-chat-api helpers — `/timeline/:id`
      // sits behind authenticateToken + ownership gate so credentials:include
      // alone is not enough; we MUST send Authorization for the snapshot
      // branch to return JSON instead of 401/403.
      const token = typeof window !== 'undefined' ? getAuthToken() : null;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${NV_BASE}legal-chat/timeline/${orchestrationId}?snapshot=1`, {
        credentials: 'include',
        headers,
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({} as { events?: LegalChatTimelineEvent[] }));
        if (Array.isArray(j?.events) && j.events.length > 0) {
          setServerReplay(j.events as LegalChatTimelineEvent[]);
          setReplayIndex(0);
          return;
        }
      }
    } catch {
      /* fall through to local replay */
    } finally {
      setReplayLoading(false);
    }
    // Fallback: local SSE buffer replay.
    setServerReplay(null);
    setReplayIndex(0);
  }

  // Build a lookup of latest event per canonical step for the v2 renderer
  // off the currently-rendered slice (so the canonical grid also animates
  // during replay rather than jumping to "all complete").
  const latestByStep = useMemo(() => {
    const m = new Map<LegalChatTimelineStep, LegalChatTimelineEvent>();
    for (const e of renderEvents) m.set(e.step as LegalChatTimelineStep, e);
    return m;
  }, [renderEvents]);

  const runComplete = latestByStep.get('run_complete');
  const runFailed = latestByStep.get('run_failed');
  const runFinished = Boolean(runComplete || runFailed);

  const effectiveEvent = (step: LegalChatTimelineStep): LegalChatTimelineEvent | undefined => {
    const evt = latestByStep.get(step);
    if (!evt) return undefined;
    if (
      evt.step === 'llm_stream_started'
      && evt.status === 'running'
      && (latestByStep.has('llm_stream_completed') || runFinished)
    ) {
      return { ...evt, status: 'ok' };
    }
    return evt;
  };

  // Compute progress for the header ring
  const totalSteps = CANONICAL_GROUPS.reduce((acc, g) => acc + g.steps.length, 0);
  const completedSteps = CANONICAL_GROUPS.reduce(
    (acc, g) => acc + g.steps.filter((s) => {
      if (latestByStep.has(s.step)) return true;
      if (runFinished) return true;
      return false;
    }).length,
    0,
  );
  const pct = totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const running = events.length > 0 && !runFinished;

  return (
    <div className="p-4 h-full flex flex-col" style={{ background: BRAND.surface }}>
      <div className="border-b border-slate-200 pb-3 mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2.5">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND.royalSoft }}
          >
            <Activity className={`h-4 w-4 ${running ? 'animate-pulse' : ''}`} style={{ color: BRAND.royal }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold leading-tight" style={{ color: BRAND.royal }}>Live workflow</h2>
            <p className="text-[10px] truncate" style={{ color: BRAND.muted }}>
              {orchestrationId ? <>orch: <span className="font-mono">{orchestrationId.slice(0, 18)}…</span></> : '15 shipped + 1 deferred'}
            </p>
          </div>
        </div>
        {events.length > 0 && (
          <button
            onClick={handleReplay}
            disabled={replayIndex !== null || replayLoading}
            className="text-[10px] px-2.5 py-1 rounded-md border font-semibold disabled:opacity-50 hover:bg-[#FBF9F0]"
            style={{ borderColor: BRAND.goldBorder, color: '#7A6A1F' }}
          >{replayLoading
              ? 'Loading…'
              : (replayIndex === null
                  ? (serverReplay ? 'Replay (server)' : 'Replay')
                  : `${replayIndex}/${sourceEvents.length}`)}</button>
        )}
      </div>

      {/* Progress strip */}
      {events.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: BRAND.muted }}>
            <span>{completedSteps} of {totalSteps} steps</span>
            <span className="font-mono" style={{ color: '#8A7420' }}>{pct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${pct}%`, background: BRAND.royal }}
            />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 -mr-2 pr-2">
        {events.length === 0 && (
          <div className="py-2">
            <p className="text-[11px] text-center mb-3" style={{ color: BRAND.muted }}>
              Queen agentic workflow — 7 phases, 16 steps. Run a prompt to watch each gate execute live; completed steps stay visible after the run.
            </p>
            <div className="space-y-1.5">
              {CANONICAL_GROUPS.map((g) => (
                <div
                  key={g.group}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                >
                  <div
                    className="h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: BRAND.royalSoft }}
                  >
                    <g.Icon className="h-3.5 w-3.5" style={{ color: BRAND.royal }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold" style={{ color: BRAND.ink }}>{g.group}</div>
                    <div className="text-[10px] leading-snug" style={{ color: BRAND.muted }}>
                      {g.steps.map((s) => s.label.split(' · ')[1]).join(' · ')}
                    </div>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider font-semibold mt-0.5 text-slate-400">
                    {g.steps.length}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {events.length > 0 && CANONICAL_GROUPS.map((g) => {
          const groupTotal = g.steps.length;
          const groupCompleted = runFinished
            ? groupTotal
            : g.steps.filter((s) => latestByStep.has(s.step)).length;
          const groupActive = !runFinished && groupCompleted > 0 && groupCompleted < groupTotal;
          const groupDone = groupCompleted === groupTotal;
          return (
            <div key={g.group}>
              <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-white py-1 z-10">
                <g.Icon className="h-3 w-3" style={{ color: groupDone ? BRAND.emerald : groupActive ? BRAND.gold : '#94a3b8' }} />
                <span className="text-[10px] uppercase tracking-[0.12em] font-bold" style={{ color: groupDone ? BRAND.emerald : groupActive ? '#8A7420' : '#94a3b8' }}>{g.group}</span>
                <span className="text-[9px] text-slate-400 ml-auto">{groupCompleted}/{groupTotal}</span>
              </div>
              <div className="space-y-1">
                {g.steps.map((s) => {
                  const evt = effectiveEvent(s.step);
                  if (!evt) {
                    if (runFinished) {
                      return (
                        <div key={s.step} className="text-[10px] text-slate-400 px-2.5 py-1.5 border-l-2 border-slate-200 italic bg-slate-50 rounded-r">
                          {s.label} — skipped
                        </div>
                      );
                    }
                    return (
                      <div key={s.step} className="text-[10px] text-slate-400 px-2.5 py-1.5 border-l-2 border-slate-200 italic bg-slate-50 rounded-r">
                        {s.label} — pending
                      </div>
                    );
                  }
                  return <StepCard key={s.step} event={evt} />;
                })}
              </div>
            </div>
          );
        })}
        {events.length > 0 && (
          <details className="text-[10px] pt-2 border-t border-slate-200" style={{ color: BRAND.muted }}>
            <summary className="cursor-pointer hover:text-[#152448]">Raw event log ({renderEvents.length})</summary>
            <div className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
              {renderEvents.map((e, i) => (
                <div key={i} className="font-mono opacity-80 text-[9.5px]">
                  {new Date(e.ts).toISOString().slice(11, 19)} · {e.step} · {e.status}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
