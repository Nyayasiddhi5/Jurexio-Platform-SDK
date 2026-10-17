/**
 * Legal Chat Event Bus
 * ─────────────────────────────────────────────────────────────────────────────
 * In-process pub/sub keyed by orchestrationId. The Legal Chat workflow
 * visualizer subscribes to a single id over SSE and receives every step as
 * it happens (PII redaction → agent picks → RAG retrievals → router decision
 * → LLM stream → safety verdict → audit chain).
 *
 * Design notes:
 *   - One bus instance per process (in-memory). Good enough for a single-
 *     gateway dev/staging deploy. For multi-replica prod we'd back this
 *     with Redis pub/sub but the API would not change.
 *   - Buffers up to MAX_BUFFER events per id so a subscriber that connects
 *     slightly after publish still gets the early events. Buffer is dropped
 *     when the run completes or after 10 minutes of inactivity.
 *   - Never throws to publishers. A misbehaving subscriber cannot block the
 *     orchestrator.
 */

import { EventEmitter } from 'events';
import { resolveRedisTcpUrl } from '../utils/redis-tcp-url.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('legal-chat-event-bus');
// Per-orchestration Redis channel pattern (NV-EVENT-BUS-PER-ORCH-001).
// Each orchestrationId gets its own pub/sub channel so multi-replica
// gateway pods only receive events for orchestrations their SSE clients
// actually subscribe to. The subscriber side uses psubscribe on the
// pattern below to receive every per-id channel without per-orchestration
// subscribe/unsubscribe round-trips.
const REDIS_CHANNEL_PREFIX = 'nyv:legalchat:tl:';
const REDIS_CHANNEL_PATTERN = `${REDIS_CHANNEL_PREFIX}*`;
const channelFor = (orchestrationId: string) => `${REDIS_CHANNEL_PREFIX}${orchestrationId}`;

export type LegalChatTimelineStep =
  | 'request_received'
  | 'pii_redaction'
  | 'session_persisted'
  | 'agent_selection'
  | 'prompt_compiled'
  | 'rag_retrieval'
  | 'memory_injection'
  | 'router_decision'
  | 'llm_stream_started'
  // 'llm_stream_token' is intentionally OMITTED — Queen synthesis
  // returns a single block today, so no per-chunk callback is emitted.
  // Reinstate on both server + client unions when chunked synthesis lands.
  | 'llm_stream_completed'
  // NV-LEGALCHAT-ATTACHMENTS-2026-05-12 (task-260): emitted when uploaded
  // file text was extracted and inlined into the Queen prompt. Surfaced in
  // the dashboard timeline; consumers without attachment support ignore it.
  | 'attachments_extracted'
  | 'maker_checker'
  | 'safety_verdict'
  | 'citation_grounding'
  | 'audit_chain'
  | 'response_persisted'
  | 'run_complete'
  | 'run_failed';

export interface LegalChatTimelineEvent {
  orchestrationId: string;
  step: LegalChatTimelineStep;
  status: 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'blocked';
  ts: number;
  durationMs?: number;
  data?: Record<string, unknown>;
  message?: string;
}

const MAX_BUFFER = 500;
const TTL_MS = 10 * 60 * 1000;

interface BufferEntry {
  events: LegalChatTimelineEvent[];
  lastTouchedAt: number;
  done: boolean;
}

class LegalChatEventBus extends EventEmitter {
  private buffers = new Map<string, BufferEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  // Multi-replica fan-out (NV-EVENT-BUS-REDIS-001): when JRX_LEGAL_CHAT_BUS_REDIS=1
  // and a Redis URL is resolvable, mirror every publish onto a Redis pub/sub
  // channel so any gateway replica (each with its own SSE clients) sees every
  // event. Wire is best-effort + lazy + non-blocking; if Redis is down we
  // silently degrade to in-process only.
  private redisPub: unknown = null;
  private redisSub: unknown = null;
  private redisReady = false;
  private redisInitTried = false;
  private replicaId = `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    super();
    this.setMaxListeners(0);
    this.cleanupTimer = setInterval(() => this.evictStale(), 60_000);
    this.cleanupTimer.unref?.();
    if (process.env.JRX_LEGAL_CHAT_BUS_REDIS === '1') {
      void this.initRedis();
    }
  }

  private async initRedis(): Promise<void> {
    if (this.redisInitTried) return;
    this.redisInitTried = true;
    const r = resolveRedisTcpUrl();
    if (!r.enabled || !r.url) { logger.info('redis fan-out disabled', { reason: r.reason ?? 'no url' }); return; }
    const url = r.url;
    try {
      const mod = await import('redis');
      const pub = mod.createClient({ url });
      const sub = mod.createClient({ url });
      pub.on('error', (e: unknown) => logger.warn('redis pub error', { err: String(e) }));
      sub.on('error', (e: unknown) => logger.warn('redis sub error', { err: String(e) }));
      await pub.connect();
      await sub.connect();
      await sub.pSubscribe(REDIS_CHANNEL_PATTERN, (message: string) => {
        try {
          const env = JSON.parse(message) as { replicaId: string; event: LegalChatTimelineEvent };
          if (env.replicaId === this.replicaId) return; // ignore our own echo
          this.applyLocal(env.event);
        } catch { /* ignore malformed */ }
      });
      this.redisPub = pub;
      this.redisSub = sub;
      this.redisReady = true;
      logger.info('redis fan-out enabled', { pattern: REDIS_CHANNEL_PATTERN });
    } catch (e) {
      logger.warn('redis fan-out init failed; in-process only', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  private applyLocal(event: LegalChatTimelineEvent): void {
    if (!event.orchestrationId) return;
    let entry = this.buffers.get(event.orchestrationId);
    if (!entry) {
      entry = { events: [], lastTouchedAt: Date.now(), done: false };
      this.buffers.set(event.orchestrationId, entry);
    }
    entry.events.push(event);
    if (entry.events.length > MAX_BUFFER) {
      entry.events.splice(0, entry.events.length - MAX_BUFFER);
    }
    entry.lastTouchedAt = Date.now();
    if (event.step === 'run_complete' || event.step === 'run_failed') {
      entry.done = true;
    }
    try { this.emit(event.orchestrationId, event); } catch { /* ignore */ }
  }

  publish(event: LegalChatTimelineEvent): void {
    this.applyLocal(event);
    if (this.redisReady && this.redisPub) {
      try {
        const env = JSON.stringify({ replicaId: this.replicaId, event });
        // Fire-and-forget; any rejection is swallowed so the orchestrator
        // never blocks on a slow Redis.
        void (this.redisPub as { publish(ch: string, msg: string): Promise<number> })
          .publish(channelFor(event.orchestrationId), env)
          .catch((e: unknown) => logger.warn('redis publish failed', { err: String(e) }));
      } catch { /* ignore */ }
    }
  }

  /**
   * Subscribe to events for a given orchestrationId. The subscriber is
   * immediately replayed any buffered events, then receives live events
   * until it unsubscribes or the run completes (caller decides — this fn
   * does NOT auto-unsubscribe on completion).
   *
   * Replay race fix: we attach the live listener BEFORE replaying the
   * buffer, queueing live events while we drain. We then drain queued
   * live events with a `seen` set keyed by `(step|ts|status)` so a live
   * event that was already in the buffer is not delivered twice. Without
   * this, an event published between snapshot and listener-attach would
   * be lost; with naive ordering it would be doubled.
   */
  subscribe(
    orchestrationId: string,
    onEvent: (event: LegalChatTimelineEvent) => void,
  ): () => void {
    const seen = new Set<string>();
    const key = (e: LegalChatTimelineEvent) => `${e.step}|${e.ts}|${e.status}`;
    const liveQueue: LegalChatTimelineEvent[] = [];
    let draining = true;

    const deliver = (e: LegalChatTimelineEvent) => {
      const k = key(e);
      if (seen.has(k)) return;
      seen.add(k);
      try { onEvent(e); } catch { /* ignore */ }
    };

    const handler = (e: LegalChatTimelineEvent) => {
      if (draining) { liveQueue.push(e); return; }
      deliver(e);
    };
    // Attach listener FIRST so nothing emitted during replay is lost.
    this.on(orchestrationId, handler);

    // Snapshot is taken AFTER listener is attached.
    const entry = this.buffers.get(orchestrationId);
    if (entry) {
      for (const e of entry.events) deliver(e);
    }
    // Drain anything that arrived live during the replay loop.
    draining = false;
    while (liveQueue.length > 0) {
      const e = liveQueue.shift()!;
      deliver(e);
    }

    return () => this.off(orchestrationId, handler);
  }

  snapshot(orchestrationId: string): LegalChatTimelineEvent[] {
    const entry = this.buffers.get(orchestrationId);
    return entry ? [...entry.events] : [];
  }

  isDone(orchestrationId: string): boolean {
    return this.buffers.get(orchestrationId)?.done ?? false;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [id, entry] of this.buffers.entries()) {
      if (entry.done && now - entry.lastTouchedAt > TTL_MS) {
        this.buffers.delete(id);
      }
    }
  }
}

export const legalChatEventBus = new LegalChatEventBus();

export function publishTimeline(event: LegalChatTimelineEvent): void {
  legalChatEventBus.publish(event);
}
