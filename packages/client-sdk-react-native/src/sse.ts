/**
 * Server-Sent Events reader for React Native.
 *
 * Strategy:
 *   1. If `react-native-sse` is installed, use it (full SSE support, retries).
 *   2. Else, fall back to a polling reader that POSTs to the same endpoint
 *      with `?stream=poll` and consumes the JSON line-stream format the NYV
 *      gateway emits when SSE is unavailable.
 *
 * The fallback exists because plain RN `fetch` does not always handle SSE on
 * Android Hermes / older iOS versions. Polling is slower but functional
 * everywhere and is the default on web wrappers without `react-native-sse`.
 *
 * Both paths emit the same handler contract so callers do not need to switch
 * branches at the application level.
 */

import type {
  NyvStreamHandlers,
  NyvStreamEvent,
  NyvPatternResponse,
} from '@jurexio/client-sdk';

export interface NyvRNStreamOptions {
  /** Override base URL (defaults to client config baseUrl). */
  baseUrl?: string;
  /** AbortSignal to cancel the stream. */
  signal?: AbortSignal;
  /** Force polling fallback (useful for tests). */
  forcePoll?: boolean;
  /** Polling interval (ms) for the fallback path. Default 600 ms. */
  pollIntervalMs?: number;
}

export interface NyvRNStreamReaderConfig {
  apiKey: string;
  baseUrl: string;
  /** SDK-level User-Agent header. */
  userAgent?: string;
}

export class NyvRNStreamReader {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(config: NyvRNStreamReaderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userAgent = config.userAgent ?? 'NyvClientRN/1.0.0';
  }

  /**
   * Stream a pattern execution. Returns the final synthesized response.
   * Picks `react-native-sse` if installed, falls back to long-poll otherwise.
   */
  async streamPattern(
    pattern: string,
    request: Record<string, unknown>,
    handlers: NyvStreamHandlers = {},
    options: NyvRNStreamOptions = {},
  ): Promise<NyvPatternResponse> {
    const url = `${options.baseUrl ?? this.baseUrl}/api/jrx/stream/${pattern.toLowerCase()}`;
    if (!options.forcePoll) {
      const sse = tryRequireSSE();
      if (sse) {
        return this.streamViaSSE(sse, url, request, handlers, options);
      }
    }
    return this.streamViaPolling(url, request, handlers, options);
  }

  private streamViaSSE(
    sseModule: SSEModule,
    url: string,
    body: Record<string, unknown>,
    handlers: NyvStreamHandlers,
    options: NyvRNStreamOptions,
  ): Promise<NyvPatternResponse> {
    const EventSource: RNEventSourceCtor =
      'default' in sseModule ? sseModule.default : sseModule;
    return new Promise<NyvPatternResponse>((resolve, reject) => {
      const es = new EventSource(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'User-Agent': this.userAgent,
        },
        body: JSON.stringify(body),
      });
      let acc = '';
      let resolved = false;

      const close = () => { try { es.close(); } catch { /* noop */ } };
      const fail = (err: unknown) => {
        if (resolved) return;
        resolved = true;
        close();
        const e = err instanceof Error ? err : new Error(String(err));
        handlers.onError?.({
          code: 'stream_error',
          status: 0,
          message: e.message,
        });
        reject(e);
      };

      options.signal?.addEventListener('abort', () => fail(new Error('aborted')));

      es.addEventListener('message', (ev: { data: string }) => {
        try {
          const event = JSON.parse(ev.data) as NyvStreamEvent;
          dispatch(event, handlers, (delta) => { acc += delta; }, (final) => {
            resolved = true;
            close();
            resolve(final);
          });
        } catch (err) { fail(err); }
      });
      es.addEventListener('error', fail);
    });
  }

  private async streamViaPolling(
    url: string,
    body: Record<string, unknown>,
    handlers: NyvStreamHandlers,
    options: NyvRNStreamOptions,
  ): Promise<NyvPatternResponse> {
    const interval = options.pollIntervalMs ?? 600;
    const res = await fetch(`${url}?stream=poll`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/x-ndjson',
        'User-Agent': this.userAgent,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) {
      throw new Error(`stream poll failed: HTTP ${res.status}`);
    }
    const text = await res.text();
    let acc = '';
    let final: NyvPatternResponse | null = null;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as NyvStreamEvent;
        dispatch(event, handlers, (delta) => { acc += delta; }, (f) => { final = f; });
      } catch { /* skip malformed line */ }
      // throttle handler invocations to avoid jank — interval is purely a hint.
      if (interval > 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (!final) {
      throw new Error('polling stream ended without run_completed event');
    }
    return final;
  }
}

/** Minimal shape of the `react-native-sse` module we depend on. */
interface RNEventSourceCtor {
  new (url: string, init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): RNEventSource;
}
interface RNEventSource {
  addEventListener(event: 'message', cb: (ev: { data: string }) => void): void;
  addEventListener(event: 'error', cb: (ev: unknown) => void): void;
  close(): void;
}
type SSEModule = RNEventSourceCtor | { default: RNEventSourceCtor };

function tryRequireSSE(): SSEModule | null {
  try {
    // `react-native-sse` is an optional peer dep; resolved at runtime by Metro.
    return require('react-native-sse') as SSEModule;
  } catch { return null; }
}

function dispatch(
  event: NyvStreamEvent,
  handlers: NyvStreamHandlers,
  onDelta: (d: string) => void,
  onFinal: (f: NyvPatternResponse) => void,
) {
  const raw = event as unknown as Record<string, unknown>;
  const data = (raw.data && typeof raw.data === 'object')
    ? (raw.data as Record<string, unknown>)
    : undefined;
  switch (event.type) {
    case 'run_started':
    case 'agent_started':
      handlers.onStart?.(event); break;
    case 'thinking':
    case 'agent_thinking': {
      const step = String(raw.text ?? raw.step ?? '');
      if (step) handlers.onThinking?.(step, 0, 0);
      break;
    }
    case 'thinking_step': {
      const d = event.data as { step: string; index: number; total: number } | undefined;
      if (d) handlers.onThinking?.(d.step, d.index, d.total);
      break;
    }
    case 'tool_call':
    case 'tool_call_start': {
      const tool = String(raw.tool ?? data?.tool ?? '');
      const input = raw.input ?? data?.input;
      if (tool) handlers.onToolCall?.(tool, input);
      break;
    }
    case 'tool_result':
    case 'tool_call_result': {
      const tool = String(raw.tool ?? data?.tool ?? '');
      const result = raw.resultSummary ?? raw.result ?? data?.result;
      if (tool) handlers.onToolResult?.(tool, result);
      break;
    }
    case 'text_delta': {
      const delta = String(raw.delta ?? data?.delta ?? '');
      if (delta) { onDelta(delta); handlers.onTextDelta?.(delta, ''); }
      break;
    }
    case 'citation_block': {
      const citations = (raw.citations as unknown[]) ?? [];
      handlers.onCitationBlock?.(citations);
      break;
    }
    case 'metadata':
      handlers.onMetadata?.(event); break;
    case 'run_completed':
    case 'run_finished':
      handlers.onComplete?.(event.data as NyvPatternResponse);
      onFinal(event.data as NyvPatternResponse);
      break;
    default: break;
  }
}
