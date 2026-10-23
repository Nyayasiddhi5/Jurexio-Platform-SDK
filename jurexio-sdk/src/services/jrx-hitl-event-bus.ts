/**
 * NV HITL Event Bus — Task #314
 * ─────────────────────────────────────────────────────────────────────────────
 * In-process pub/sub for HITL stats invalidation. Powers the
 * `/api/jrx/hitl/stats/stream` SSE channel consumed by /console/hitl-decision-cards
 * so the four stat tiles + 7-day sparkline update the instant a reviewer
 * approves / rejects / modifies a card (was: 30s polling).
 *
 * Mirrors `jrx-activity-event-bus.ts` so anyone touching one understands the
 * other:
 *   - Single in-memory EventEmitter.
 *   - Never throws to publishers; a misbehaving subscriber cannot block the
 *     HITL service write paths that call publishHitlChange().
 *   - For multi-replica prod: swap the in-memory emitter for Redis pub/sub
 *     without changing the public API.
 *
 * Guardrails honored:
 *   - NV-ARCH-001: no LLM emission, pure metadata fan-out.
 *   - NV-NAMING-001: grep `jrx-hitl-event-bus` showed no existing file.
 *   - NV-LLM-001: not in the LLM-emit path.
 */

import { EventEmitter } from 'events';

export interface HitlChangeEvent {
  /** Tenant the changed review belongs to (null = global / unknown). */
  tenantId: string | null;
  /** Coarse classification — useful for future filtering. */
  kind: 'queued' | 'decided';
  ts: number;
}

const MAX_LISTENERS = 256;

class NvHitlEventBus {
  private bus = new EventEmitter();
  constructor() { this.bus.setMaxListeners(MAX_LISTENERS); }

  publish(ev: HitlChangeEvent): void {
    try { this.bus.emit('change', ev); } catch { /* never throw */ }
  }

  subscribe(fn: (ev: HitlChangeEvent) => void): () => void {
    this.bus.on('change', fn);
    return () => { try { this.bus.off('change', fn); } catch { /* ignore */ } };
  }
}

export const nvHitlEventBus = new NvHitlEventBus();

export function publishHitlChange(tenantId: string | null | undefined, kind: HitlChangeEvent['kind']): void {
  nvHitlEventBus.publish({ tenantId: tenantId ?? null, kind, ts: Date.now() });
}
