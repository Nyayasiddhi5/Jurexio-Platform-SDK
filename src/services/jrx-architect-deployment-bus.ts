/**
 * Jurexio Enterprise Platform 3.1.2 — Architect deployment event bus
 * task-258 (2026-05-13)
 *
 * In-process pub/sub for "an Architect org workflow has been deployed"
 * events. The architect deploy route (`jrx-architect-routes.ts`) calls
 * `nvArchitectDeploymentBus.publish(...)` after the row is persisted to
 * `sdk_workflows`; downstream subscribers consume the event to materialize
 * agents, register routing rules, write IronLedger entries, etc.
 *
 * The bus itself ships with a single built-in subscriber that logs the
 * event so the deploy path *always* fires a real, observable side-effect
 * even before downstream provisioning services are wired (this is the
 * "trigger the appropriate provisioning side-effects" hook called out in
 * task-258's "Done looks like").
 *
 * Design mirrors `jrx-activity-event-bus.ts` so anyone touching one
 * understands the other:
 *   - In-memory EventEmitter, ring buffer of last RING_CAP events.
 *   - Subscribers may NOT throw upwards: a misbehaving subscriber cannot
 *     fail an HTTP deploy.
 *   - For multi-replica prod: swap the in-memory store for Redis pub/sub
 *     without changing the public API.
 *
 * Guardrails honored:
 *   - NV-ARCH-001: no LLM emission, pure metadata fan-out.
 *   - NV-NAMING-001: file prefix `jrx-`.
 *   - NV-LLM-001: not in the LLM-emit path.
 *   - NV-WIRING-001: imported from `jrx-architect-routes.ts`, which is
 *     mounted from `src/index.ts`.
 */
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-architect-deployment-bus');

export interface ArchitectDeploymentEvent {
  workflowId: string;
  deploymentId: number | null;
  organizationId: number | null;
  createdBy: string;
  name: string;
  departmentCount: number;
  agentCount: number;
  connectionCount: number;
  ts: number;
}

const RING_CAP = 200;
const MAX_LISTENERS = 64;
const CHANNEL = 'architect:deploy';

export class NvArchitectDeploymentBus {
  private bus = new EventEmitter();
  private ring: ArchitectDeploymentEvent[] = [];

  constructor() {
    this.bus.setMaxListeners(MAX_LISTENERS);
    // Built-in observability subscriber so the deploy always fires a real,
    // visible side-effect even with zero downstream provisioning services
    // wired up.
    this.subscribe((ev) => {
      logger.info('architect_deployment_event', {
        workflowId: ev.workflowId,
        organizationId: ev.organizationId,
        departmentCount: ev.departmentCount,
        agentCount: ev.agentCount,
        connectionCount: ev.connectionCount,
        createdBy: ev.createdBy,
      });
    });
  }

  publish(ev: ArchitectDeploymentEvent): void {
    try {
      this.ring.push(ev);
      if (this.ring.length > RING_CAP) {
        this.ring.splice(0, this.ring.length - RING_CAP);
      }
      this.bus.emit(CHANNEL, ev);
    } catch (err) {
      logger.warn('architect_deployment_publish_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  subscribe(fn: (ev: ArchitectDeploymentEvent) => void): () => void {
    const wrapped = (ev: ArchitectDeploymentEvent): void => {
      try { fn(ev); } catch (err) {
        logger.warn('architect_deployment_subscriber_threw', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };
    this.bus.on(CHANNEL, wrapped);
    return () => { try { this.bus.off(CHANNEL, wrapped); } catch { /* ignore */ } };
  }

  recent(limit = 50): ArchitectDeploymentEvent[] {
    const lim = Math.max(1, Math.min(RING_CAP, Math.floor(limit)));
    return this.ring.slice(-lim).reverse();
  }
}

export const nvArchitectDeploymentBus = new NvArchitectDeploymentBus();
