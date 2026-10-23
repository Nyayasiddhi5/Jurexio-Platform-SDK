/**
 * Shared admin execution rail — same 16-step + 12a grid as Legal Chat.
 * Hosts: Legal Chat, Live Testing, Orch Hub, Drafting, Instant Search, SDK playground.
 */
import { useMemo } from 'react';
import { Link } from 'wouter';
import { WorkflowPane } from '@/features/legal-chat/WorkflowPane';
import { ThinkingStepsPanel } from '@/components/agui/ThinkingStepsPanel';
import { ToolCallsPanel } from '@/components/agui/ToolCallsPanel';
import { ReasoningTrailPanel } from '@/components/execution/ReasoningTrailPanel';
import { ExecutionOutcomePanel, type ExecutionOutcome } from '@/components/execution/ExecutionOutcomePanel';
import { GoodLawPanel } from '@/components/execution/GoodLawPanel';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';
import type { NvReasoningTrailSource } from '@/lib/jrx-reasoning-trail';
import { Badge } from '@/components/ui/badge';
import { BRAND } from '@/features/legal-chat/brand';

function engineStatusLabel(
  events: LegalChatTimelineEvent[],
  outcome?: ExecutionOutcome,
): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } | null {
  if (outcome?.status === 'complete' || outcome?.status === 'blocked') {
    return { label: outcome.status === 'blocked' ? 'Blocked' : 'Complete', variant: 'default' };
  }
  if (outcome?.status === 'failed') {
    return { label: 'Failed', variant: 'destructive' };
  }
  if (events.some((e) => e.step === 'run_complete')) {
    return { label: 'Complete', variant: 'default' };
  }
  if (outcome?.status === 'streaming' || events.some((e) => e.status === 'running')) {
    return { label: 'Running', variant: 'secondary' };
  }
  return null;
}

export interface ExecutionTraceRailProps {
  events: LegalChatTimelineEvent[];
  orchestrationId?: string;
  title?: string;
  compact?: boolean;
  /**
   * NV-REASONING-TRAIL-001 — audited `qualityEnvelope` for the finished run.
   *
   * Distinct from `events`, which is live progress on the legal-chat SSE
   * taxonomy: a step appearing there says the orchestrator reached it, not that
   * an audit gate concluded anything. `undefined` = the host does not carry an
   * envelope on its wire and the panel is not rendered; `null` = a run finished
   * without one, which is rendered as "not captured".
   */
  trail?: NvReasoningTrailSource | null;
  /** Host-supplied explanation shown when `trail` is null. */
  trailUnavailableReason?: string;
  /**
   * NV-GOOD-LAW-PANEL-001 — authority to offer a negative-treatment check for.
   *
   * `undefined` = the host has no authority in hand and the panel is not
   * rendered. A string mounts the panel, which stays un-run until the reader
   * asks: one check costs two upstream NYS searches, so it is never automatic.
   */
  goodLawCitation?: string;
  /** NV-AGUI-OUTCOME-PANEL-001 — gated final synthesis for admin trace surfaces. */
  outcome?: ExecutionOutcome;
  /** Hide thinking/tools diagnostics (trace tab uses external chat reference). */
  showDiagnostics?: boolean;
  /**
   * NV-AGUI-TRACE-RAIL-PERSIST-001 — hide embedded outcome when the host renders
   * its own request/response panel below the rail (orchestration trace tab).
   * `outcome` may still be passed for the engine status badge.
   */
  showOutcomePanel?: boolean;
  /** Hide lineage/router footer links (trace tab saves vertical space for steps). */
  showFooterLinks?: boolean;
}

function thinkingFromEvents(events: LegalChatTimelineEvent[]) {
  return events
    .filter((e) => e.step === 'agent_selection' || e.step === 'prompt_compiled' || e.step === 'router_decision')
    .map((e, i) => ({
      id: `${e.step}-${e.ts}-${i}`,
      title: e.step,
      content: JSON.stringify(e.data ?? {}, null, 0).slice(0, 400),
      timestamp: e.ts,
      duration: e.durationMs,
      status: e.status === 'running' ? 'active' as const : 'completed' as const,
    }));
}

function toolsFromEvents(events: LegalChatTimelineEvent[]) {
  return events
    .filter((e) => e.step === 'prompt_compiled' || e.step === 'llm_stream_completed')
    .map((e, i) => ({
      id: `${e.step}-${e.ts}-${i}`,
      toolName: String(e.data?.agentName || e.data?.agentId || e.step),
      parameters: (e.data ?? {}) as Record<string, unknown>,
      timestamp: e.ts,
      status: e.status === 'failed' ? 'error' as const : e.status === 'running' ? 'pending' as const : 'success' as const,
      duration: e.durationMs,
      error: e.message,
    }));
}

export function ExecutionTraceRail({
  events,
  orchestrationId,
  title = 'Live workflow',
  compact = false,
  trail,
  trailUnavailableReason,
  goodLawCitation,
  outcome,
  showDiagnostics = true,
  showOutcomePanel = true,
  showFooterLinks = true,
}: ExecutionTraceRailProps) {
  const thinking = useMemo(() => thinkingFromEvents(events), [events]);
  const tools = useMemo(() => toolsFromEvents(events), [events]);
  const engineStatus = useMemo(() => engineStatusLabel(events, outcome), [events, outcome]);

  return (
    <div
      className={compact ? 'h-[420px] border border-slate-200 rounded-lg overflow-hidden flex flex-col' : 'h-full flex flex-col'}
      style={{ background: BRAND.surface }}
      data-testid="execution-trace-rail"
    >
      {title !== 'Live workflow' ? (
        <div className="px-4 pt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold" style={{ color: BRAND.royal }}>
            {title}
          </span>
          {engineStatus ? (
            <Badge variant={engineStatus.variant} className="text-[10px] h-5" data-testid="engine-status-badge">
              Queen · {engineStatus.label}
            </Badge>
          ) : null}
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <WorkflowPane events={events} orchestrationId={orchestrationId} />
      </div>
      {showOutcomePanel && outcome ? <ExecutionOutcomePanel outcome={outcome} /> : null}
      {trail !== undefined ? (
        <ReasoningTrailPanel source={trail} unavailableReason={trailUnavailableReason} />
      ) : null}
      {goodLawCitation ? (
        <div className="border-t border-slate-200">
          <GoodLawPanel citation={goodLawCitation} />
        </div>
      ) : null}
      {showFooterLinks && orchestrationId ? (
        <div className="px-4 pb-2 text-[10px] flex gap-3" style={{ color: BRAND.muted }}>
          <Link href={`/orchestration/lineage/${encodeURIComponent(orchestrationId)}`}>
            <span className="underline">Lineage</span>
          </Link>
          <Link href="/orchestration?tab=router">
            <span className="underline">Router decisions</span>
          </Link>
          <Link href="/orchestration?tab=grpo">
            <span className="underline">GRPO</span>
          </Link>
        </div>
      ) : null}
      {!compact && showDiagnostics && events.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-2 p-3 border-t border-slate-200 max-h-64 overflow-y-auto">
          <ThinkingStepsPanel steps={thinking} />
          <ToolCallsPanel toolCalls={tools} />
        </div>
      ) : null}
    </div>
  );
}

export default ExecutionTraceRail;
