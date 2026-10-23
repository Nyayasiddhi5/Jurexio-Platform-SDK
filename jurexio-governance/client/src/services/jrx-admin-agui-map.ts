/**
 * NV-ADMIN-AGUI-001 — Console-only mapper.
 *
 * Maps AG-UI Queen SSE JSON (POST /api/jrx/stream) onto the Legal Chat
 * timeline contract so ExecutionTraceRail can render the same 16+12a grid.
 * Partner /orchestrate/stream stays sanitized (NV-CLIENT-OUTCOME-SANITIZE-001).
 */
export type AdminTimelineStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'failed'
  | 'skipped'
  | 'blocked';

export interface AdminTimelineEvent {
  orchestrationId: string;
  step: string;
  status: AdminTimelineStatus;
  ts: number;
  durationMs?: number;
  data?: Record<string, unknown>;
  message?: string;
}

export interface AguiWireEvent {
  type?: string;
  event?: string;
  name?: string;
  subtype?: string;
  tool?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  result?: unknown;
  delta?: string;
  model?: string;
  pattern?: string;
  patternName?: string;
  agentId?: string;
  jurisdiction?: string;
  matterId?: string;
  answer?: string;
  citations?: unknown;
  requestId?: string;
  orchestrationId?: string;
  step?: string;
  status?: string;
  ts?: number;
  durationMs?: number;
  [key: string]: unknown;
}

function payloadOf(evt: AguiWireEvent): Record<string, unknown> {
  if (evt.data && typeof evt.data === 'object') return evt.data;
  if (evt.payload && typeof evt.payload === 'object') return evt.payload;
  return evt as Record<string, unknown>;
}

function orchIdOf(evt: AguiWireEvent, fallback: string): string {
  const p = payloadOf(evt);
  return String(evt.orchestrationId || evt.requestId || p.orchestrationId || p.requestId || fallback);
}

function mapStatus(raw: unknown): AdminTimelineStatus {
  const s = String(raw || 'ok').toLowerCase();
  if (s === 'running' || s === 'pending') return s;
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'skipped') return 'skipped';
  if (s === 'blocked') return 'blocked';
  return 'ok';
}

export function mapAguiEventToTimeline(
  evt: AguiWireEvent,
  fallbackOrchId: string,
  now = Date.now(),
): AdminTimelineEvent | null {
  const type = String(evt.type || evt.event || '');
  const orch = orchIdOf(evt, fallbackOrchId);
  const data = payloadOf(evt);

  switch (type) {
    case 'timeline_step':
      return {
        orchestrationId: orch,
        step: String(evt.step || data.step || ''),
        status: mapStatus(evt.status ?? data.status),
        ts: typeof evt.ts === 'number' ? evt.ts : now,
        durationMs: typeof evt.durationMs === 'number' ? evt.durationMs : undefined,
        data: data as Record<string, unknown>,
        message: typeof evt.message === 'string' ? evt.message : undefined,
      };
    case 'run_started':
      return {
        orchestrationId: orch,
        step: 'request_received',
        status: 'ok',
        ts: now,
        data: {
          pattern: evt.pattern ?? data.pattern,
          patternName: evt.patternName ?? data.patternName,
          agentId: evt.agentId ?? data.agentId,
          jurisdiction: evt.jurisdiction ?? data.jurisdiction,
          matterId: evt.matterId ?? data.matterId,
        },
      };
    case 'pattern_event': {
      const name = String(evt.subtype || evt.name || data.subtype || data.name || data.kind || '');
      if (name === 'queen_decomposition' || name === 'decomposition_complete') {
        return {
          orchestrationId: orch,
          step: 'agent_selection',
          status: 'ok',
          ts: now,
          data: {
            algorithm: data.algorithm,
            pattern: data.pattern ?? data.queenPattern,
            complexity: data.complexity,
            tasks: data.subtaskCount ?? (Array.isArray(data.subtasks) ? data.subtasks.length : undefined),
            subtasks: data.subtasks,
            summary: data.summary,
          },
        };
      }
      if (name === 'synthesis_started') {
        return {
          orchestrationId: orch,
          step: 'llm_stream_started',
          status: 'running',
          ts: now,
          data: { agentCount: data.agentCount, failedCount: data.failedCount },
        };
      }
      if (name === 'synthesis_complete') {
        return {
          orchestrationId: orch,
          step: 'llm_stream_completed',
          status: 'ok',
          ts: now,
          data: { chars: data.length ?? data.chars, format: data.format, language: data.language },
        };
      }
      if (name === 'synthesis_final') {
        const topContent = typeof evt.content === 'string' ? evt.content : undefined;
        const content = data.content ?? data.answer ?? topContent;
        return {
          orchestrationId: orch,
          step: 'llm_stream_completed',
          status: 'ok',
          ts: now,
          data: {
            chars: data.length ?? (typeof content === 'string' ? content.length : undefined),
            response: content,
            source: 'synthesis_final',
            gated: data.gated ?? true,
          },
        };
      }
      if (name === 'agent_failed') {
        return {
          orchestrationId: orch,
          step: 'llm_stream_completed',
          status: 'failed',
          ts: now,
          message: String(data.error || data.message || 'agent failed'),
          data: { agentId: data.agentId, agentName: data.agentName },
        };
      }
      return null;
    }
    case 'tool_call': {
      const tool = String(evt.tool || data.tool || '');
      const agentName = tool.startsWith('agent:') ? tool.slice(6) : tool;
      return {
        orchestrationId: orch,
        step: 'prompt_compiled',
        status: 'running',
        ts: now,
        data: {
          agentId: data.agentId ?? evt.agentId,
          agentName: data.agentName ?? agentName,
          taskId: data.subtaskId ?? data.taskId,
          description: data.description,
        },
      };
    }
    case 'tool_result':
      return {
        orchestrationId: orch,
        step: 'llm_stream_completed',
        status: 'ok',
        ts: now,
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
        data: {
          agentId: data.agentId,
          agentName: data.agentName,
          model: data.model ?? evt.model,
          via: data.via,
        },
      };
    case 'synthesis_started':
      return {
        orchestrationId: orch,
        step: 'llm_stream_started',
        status: 'running',
        ts: now,
        data: { agentCount: data.agentCount },
      };
    case 'synthesis_complete':
      return {
        orchestrationId: orch,
        step: 'llm_stream_completed',
        status: 'ok',
        ts: now,
        data: { chars: data.length ?? data.chars, model: data.model ?? evt.model },
      };
    case 'citation_block':
      return {
        orchestrationId: orch,
        step: 'citation_grounding',
        status: 'ok',
        ts: now,
        data: {
          citationCount: Array.isArray(evt.citations)
            ? evt.citations.length
            : Array.isArray(data.citations)
              ? data.citations.length
              : undefined,
          citations: evt.citations ?? data.citations,
        },
      };
    case 'run_completed': {
      const result = (data.result && typeof data.result === 'object')
        ? data.result as Record<string, unknown>
        : data;
      return {
        orchestrationId: orch,
        step: 'run_complete',
        status: 'ok',
        ts: now,
        durationMs: typeof data.processingMs === 'number' ? data.processingMs : undefined,
        data: {
          response: evt.answer ?? result.answer ?? data.answer ?? data.result,
          model: evt.model ?? result.model ?? data.model,
          agentsUsed: result.agentsUsed ?? data.agentsUsed,
          citations: evt.citations ?? result.citations ?? data.citations,
          requestId: orch,
        },
      };
    }
    case 'run_error':
      return {
        orchestrationId: orch,
        step: 'run_failed',
        status: 'failed',
        ts: now,
        message: String(data.error || data.message || evt.result || 'run error'),
        data,
      };
    case 'step_complete': {
      const step = String(evt.step || data.step || '');
      const canonical = new Set([
        'request_received', 'pii_redaction', 'session_persisted', 'agent_selection',
        'prompt_compiled', 'rag_retrieval', 'memory_injection', 'router_decision',
        'llm_stream_started', 'llm_stream_completed', 'maker_checker', 'safety_verdict',
        'citation_grounding', 'audit_chain', 'response_persisted', 'run_complete',
      ]);
      if (!canonical.has(step)) return null;
      return {
        orchestrationId: orch,
        step,
        status: 'ok',
        ts: now,
        data,
      };
    }
    case 'text_delta': {
      const delta = typeof evt.delta === 'string' ? evt.delta : '';
      const accumulated = typeof evt.accumulated === 'string'
        ? evt.accumulated
        : typeof data.accumulated === 'string'
          ? data.accumulated
          : undefined;
      if (!delta && !accumulated) return null;
      return {
        orchestrationId: orch,
        step: 'llm_stream_token',
        status: 'running',
        ts: now,
        data: {
          delta,
          accumulated,
          model: evt.model ?? data.model,
          count: accumulated ? Math.ceil(accumulated.length / 4) : undefined,
        },
      };
    }
    case 'metadata':
    case 'thinking':
      return null;
    default:
      return null;
  }
}
