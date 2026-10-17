/**
 * NyvStreamReader — AG-UI Server-Sent Events reader for Jurexio Enterprise Platform 312.
 *
 * Consumes the /api/jrx/stream/* endpoints and emits typed AG-UI events:
 *   run_started → agent_started → thinking_step(s) → tool_call → text_delta(s) → run_finished
 *
 * Works in both browser (EventSource) and Node.js (fetch + ReadableStream).
 */

import type {
  NyvStreamHandlers,
  NyvStreamEvent,
  NyvStreamEventType,
  NyvPatternResponse,
} from './types/index.js';

export interface NyvStreamOptions {
  signal?: AbortSignal;
  reconnectMs?: number;
  maxReconnects?: number;
}

export class NyvStreamReader {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Stream a pattern execution via AG-UI SSE.
   * Returns a Promise that resolves to the final NyvPatternResponse
   * when the run_finished event is received.
   */
  async streamPattern(
    pattern: string,
    request: Record<string, unknown>,
    handlers: NyvStreamHandlers = {},
    options: NyvStreamOptions = {}
  ): Promise<NyvPatternResponse> {
    const url = `${this.baseUrl}/api/jrx/stream/${pattern.toLowerCase()}`;
    return this.consumeSse(url, request, handlers, options, pattern);
  }

  /**
   * Stream Queen orchestration via AG-UI SSE
   * (`POST /api/jrx/orchestrate/stream`).
   */
  async streamOrchestrate(
    request: Record<string, unknown>,
    handlers: NyvStreamHandlers = {},
    options: NyvStreamOptions = {}
  ): Promise<NyvPatternResponse> {
    const url = `${this.baseUrl}/api/jrx/orchestrate/stream`;
    return this.consumeSse(url, request, handlers, options, 'orchestrate');
  }

  private consumeSse(
    url: string,
    request: Record<string, unknown>,
    handlers: NyvStreamHandlers,
    options: NyvStreamOptions,
    patternLabel: string,
  ): Promise<NyvPatternResponse> {
    return new Promise<NyvPatternResponse>((resolve, reject) => {
      let accumulated = '';
      let replacedOnGate = false;
      let resolved = false;

      const handleEvent = (event: NyvStreamEvent) => {
        const { type } = event;
        const raw = event as unknown as Record<string, unknown>;
        const data: Record<string, unknown> =
          event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};

        // ── run_started / agent_started ─────────────────────────────────────
        if (type === 'run_started' || type === 'agent_started') {
          handlers.onStart?.(event);
          if (type === 'agent_started') {
            const agent = String(raw['agentId'] ?? raw['agentName'] ?? data['agent'] ?? '');
            if (agent) handlers.onAgentSelected?.(agent, event);
          }

        // ── agent_selected (Queen / orchestrate.stream) ─────────────────────
        } else if (type === 'agent_selected') {
          const agent = String(
            raw['agentName'] ?? raw['agentId'] ?? data['agent'] ?? '',
          );
          if (agent) handlers.onAgentSelected?.(agent, event);
          handlers.onStart?.(event);

        // ── thinking (AG-UI) + thinking_step (legacy) ───────────────────────
        } else if (type === 'thinking' || type === 'agent_thinking') {
          const step = String(raw['text'] ?? raw['step'] ?? '');
          if (step) handlers.onThinking?.(step, 0, 0);
        } else if (type === 'thinking_step') {
          const d = event.data as { step: string; index: number; total: number } | undefined;
          if (d) handlers.onThinking?.(d.step, d.index, d.total);

        // ── tool_call (AG-UI) + tool_call_start (legacy) ─────────────────
        } else if (type === 'tool_call' || type === 'tool_call_start') {
          const tool = String(raw['tool'] ?? data['tool'] ?? '');
          const input = raw['input'] ?? data['input'];
          if (tool) {
            handlers.onToolCall?.(tool, input);
            if (tool.startsWith('agent:')) {
              handlers.onAgentSelected?.(tool.slice('agent:'.length), event);
            }
          }

        // ── tool_result (AG-UI) + tool_call_result (legacy) ──────────────
        } else if (type === 'tool_result' || type === 'tool_call_result') {
          const tool = String(raw['tool'] ?? data['tool'] ?? '');
          const result = raw['resultSummary'] ?? raw['result'] ?? data['result'];
          if (tool) handlers.onToolResult?.(tool, result);

        // ── text_delta ──────────────────────────────────────────────────────
        // Queen provisional → gated replace contract:
        // First event with provisional:false / gated:true resets the buffer so
        // clients do not double-paint provisional + gated text.
        } else if (type === 'text_delta') {
          const delta = String(raw['delta'] ?? data['delta'] ?? '');
          const provisionalRaw = raw['provisional'] ?? data['provisional'];
          const gated =
            raw['gated'] === true ||
            data['gated'] === true ||
            provisionalRaw === false;
          const provisional = gated ? false : provisionalRaw !== false;
          if (gated && !replacedOnGate) {
            replacedOnGate = true;
            accumulated = '';
          }
          if (delta) {
            accumulated += delta;
          } else if (gated) {
            const acc = raw['accumulated'] ?? data['accumulated'];
            if (typeof acc === 'string' && acc.length > 0) accumulated = acc;
          }
          handlers.onTextDelta?.(delta, accumulated, { provisional, gated });

        // ── citation_block ──────────────────────────────────────────────────
        } else if (type === 'citation_block') {
          const citations = (raw['citations'] as unknown[]) ?? [];
          handlers.onCitationBlock?.(citations);

        // ── metadata ────────────────────────────────────────────────────────
        } else if (type === 'metadata') {
          handlers.onMetadata?.(event);

        // ── T002: pattern_event (P01-P10 specialized mechanics) ─────────────
        } else if (type === 'pattern_event') {
          handlers.onPatternEvent?.(raw as import('./types/index.js').NyvPatternSpecializedEvent);

        // ── run_completed / run_finished ─────────────────────────────────────
        } else if (type === 'run_completed' || type === 'run_finished') {
          if (!resolved) {
            resolved = true;
            const result = (raw['result'] as NyvPatternResponse | undefined)
              ?? (data['result'] as NyvPatternResponse | undefined)
              ?? ({ pattern: patternLabel, traceId: event.traceId ?? '', result: accumulated } as NyvPatternResponse);
            handlers.onComplete?.(result);
            resolve(result);
          }

        // ── error / run_error ────────────────────────────────────────────────
        } else if (type === 'error' || type === 'run_error') {
          if (!resolved) {
            resolved = true;
            const errSrc: Record<string, unknown> =
              (raw['error'] && typeof raw['error'] === 'object'
                ? (raw['error'] as Record<string, unknown>)
                : data);
            const err = {
              code: 'STREAM_ERROR',
              message: String(errSrc['message'] ?? raw['error'] ?? 'Stream error'),
              status: 500,
              traceId: event.traceId,
            };
            handlers.onError?.(err);
            reject(new Error(err.message));
          }
        }
      };

      // Use fetch + ReadableStream for universal compatibility
      this.fetchStream(url, request, handleEvent, options).catch((err) => {
        if (!resolved) {
          resolved = true;
          handlers.onError?.({ code: 'FETCH_ERROR', message: err.message, status: 0 });
          reject(err);
        }
      });
    });
  }

  private async fetchStream(
    url: string,
    body: Record<string, unknown>,
    handler: (event: NyvStreamEvent) => void,
    options: NyvStreamOptions
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Stream request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE chunks separated by double newlines
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          let eventType: NyvStreamEventType | undefined;
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim() as NyvStreamEventType;
            } else if (line.startsWith('data:')) {
              dataStr = line.slice(5).trim();
            }
          }

          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr) as NyvStreamEvent;
              if (eventType) parsed.type = eventType;
              handler(parsed);
            } catch {
              // Malformed SSE data — skip
            }
          }
        }
      }
    } finally {
      reader.cancel();
    }
  }
}
