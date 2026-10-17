import { createLogger } from '../../utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('./jrx-agent-lifecycle');

type AgentState = 'IDLE' | 'PLANNING' | 'EXECUTING' | 'WAITING' | 'PAUSED' | 'ERROR' | 'COMPLETED' | 'TERMINATED';
type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

export interface AgentInstance {
  instanceId: string;
  agentId: string;
  jurisdiction: JurisdictionCode;
  state: AgentState;
  traceId: string;
  parentInstanceId?: string;
  childInstanceIds: string[];
  startedAt: Date;
  lastActivityAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  stepIndex: number;
  totalSteps: number;
  metadata: Record<string, unknown>;
}

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  timestamp: Date;
  reason: string;
  triggeredBy: string;
}

export interface LifecycleEvent {
  type: 'spawn' | 'transition' | 'heartbeat' | 'complete' | 'error' | 'terminate' | 'escalate';
  instanceId: string;
  agentId: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface HealthReport {
  totalInstances: number;
  byState: Record<AgentState, number>;
  staleInstances: string[];
  errorInstances: string[];
  avgDurationMs: number;
}

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  'IDLE': ['PLANNING', 'TERMINATED'],
  'PLANNING': ['EXECUTING', 'PAUSED', 'ERROR', 'TERMINATED'],
  'EXECUTING': ['WAITING', 'PAUSED', 'COMPLETED', 'ERROR', 'TERMINATED'],
  'WAITING': ['EXECUTING', 'PAUSED', 'ERROR', 'TERMINATED'],
  'PAUSED': ['EXECUTING', 'PLANNING', 'TERMINATED'],
  'ERROR': ['PLANNING', 'TERMINATED'],
  'COMPLETED': ['TERMINATED'],
  'TERMINATED': [],
};

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export class NvAgentLifecycleService {
  private static instance: NvAgentLifecycleService;
  private instances: Map<string, AgentInstance> = new Map();
  private transitions: Map<string, StateTransition[]> = new Map();
  private eventLog: LifecycleEvent[] = [];

  private constructor() {}

  static getInstance(): NvAgentLifecycleService {
    if (!NvAgentLifecycleService.instance) {
      NvAgentLifecycleService.instance = new NvAgentLifecycleService();
    }
    return NvAgentLifecycleService.instance;
  }

  spawn(agentId: string, jurisdiction: JurisdictionCode, traceId: string, parentInstanceId?: string, totalSteps: number = 1): AgentInstance {
    const instanceId = `inst_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date();

    const instance: AgentInstance = {
      instanceId,
      agentId,
      jurisdiction,
      state: 'IDLE',
      traceId,
      parentInstanceId,
      childInstanceIds: [],
      startedAt: now,
      lastActivityAt: now,
      stepIndex: 0,
      totalSteps,
      metadata: {},
    };

    this.instances.set(instanceId, instance);
    this.transitions.set(instanceId, []);

    if (parentInstanceId) {
      const parent = this.instances.get(parentInstanceId);
      if (parent) parent.childInstanceIds.push(instanceId);
    }

    this.emitEvent('spawn', instanceId, agentId, { jurisdiction, traceId, parentInstanceId });

    logger.info({
      service: 'NvAgentLifecycleService',
      method: 'spawn',
      instanceId,
      agentId,
      jurisdiction,
      traceId,
    });

    return instance;
  }

  transition(instanceId: string, newState: AgentState, reason: string, triggeredBy: string = 'system'): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      logger.warn({ service: 'NvAgentLifecycleService', warning: `Instance ${instanceId} not found` });
      return false;
    }

    const validTargets = VALID_TRANSITIONS[instance.state];
    if (!validTargets.includes(newState)) {
      logger.warn({
        service: 'NvAgentLifecycleService',
        warning: `Invalid transition ${instance.state} → ${newState} for ${instanceId}`,
      });
      return false;
    }

    const transitionRecord: StateTransition = {
      from: instance.state,
      to: newState,
      timestamp: new Date(),
      reason,
      triggeredBy,
    };

    instance.state = newState;
    instance.lastActivityAt = new Date();

    if (newState === 'COMPLETED') instance.completedAt = new Date();
    if (newState === 'ERROR') instance.errorMessage = reason;

    this.transitions.get(instanceId)!.push(transitionRecord);
    this.emitEvent('transition', instanceId, instance.agentId, { from: transitionRecord.from, to: newState, reason });

    return true;
  }

  advanceStep(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    instance.stepIndex++;
    instance.lastActivityAt = new Date();

    if (instance.stepIndex >= instance.totalSteps) {
      return this.transition(instanceId, 'COMPLETED', 'All steps completed');
    }

    return true;
  }

  heartbeat(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    instance.lastActivityAt = new Date();
    this.emitEvent('heartbeat', instanceId, instance.agentId, { state: instance.state });
    return true;
  }

  terminate(instanceId: string, reason: string = 'Manual termination'): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    for (const childId of instance.childInstanceIds) {
      this.terminate(childId, `Parent ${instanceId} terminated`);
    }

    return this.transition(instanceId, 'TERMINATED', reason);
  }

  getInstance(instanceId: string): AgentInstance | undefined {
    return this.instances.get(instanceId);
  }

  getInstancesByAgent(agentId: string): AgentInstance[] {
    return Array.from(this.instances.values()).filter(i => i.agentId === agentId);
  }

  getInstancesByTrace(traceId: string): AgentInstance[] {
    return Array.from(this.instances.values()).filter(i => i.traceId === traceId);
  }

  getTransitionHistory(instanceId: string): StateTransition[] {
    return this.transitions.get(instanceId) || [];
  }

  getHealthReport(): HealthReport {
    const now = Date.now();
    const byState: Record<AgentState, number> = {
      IDLE: 0, PLANNING: 0, EXECUTING: 0, WAITING: 0,
      PAUSED: 0, ERROR: 0, COMPLETED: 0, TERMINATED: 0,
    };
    const staleInstances: string[] = [];
    const errorInstances: string[] = [];
    let totalDuration = 0;
    let durationCount = 0;

    for (const [id, inst] of this.instances) {
      byState[inst.state]++;

      if (!['COMPLETED', 'TERMINATED'].includes(inst.state)) {
        if (now - inst.lastActivityAt.getTime() > STALE_THRESHOLD_MS) {
          staleInstances.push(id);
        }
      }

      if (inst.state === 'ERROR') errorInstances.push(id);

      if (inst.completedAt) {
        totalDuration += inst.completedAt.getTime() - inst.startedAt.getTime();
        durationCount++;
      }
    }

    return {
      totalInstances: this.instances.size,
      byState,
      staleInstances,
      errorInstances,
      avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    };
  }

  cleanupCompleted(olderThanMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, inst] of this.instances) {
      if (['COMPLETED', 'TERMINATED'].includes(inst.state)) {
        const endTime = inst.completedAt || inst.lastActivityAt;
        if (now - endTime.getTime() > olderThanMs) {
          this.instances.delete(id);
          this.transitions.delete(id);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info({ service: 'NvAgentLifecycleService', method: 'cleanupCompleted', cleaned });
    }

    return cleaned;
  }

  recoverStale(maxStaleMs: number = STALE_THRESHOLD_MS): string[] {
    const now = Date.now();
    const recovered: string[] = [];

    for (const [id, inst] of this.instances) {
      if (['EXECUTING', 'WAITING', 'PLANNING'].includes(inst.state)) {
        if (now - inst.lastActivityAt.getTime() > maxStaleMs) {
          this.transition(id, 'ERROR', 'Stale instance recovered', 'lifecycle-monitor');
          recovered.push(id);
        }
      }
    }

    return recovered;
  }

  getRecentEvents(limit: number = 50): LifecycleEvent[] {
    return this.eventLog.slice(-limit);
  }

  private emitEvent(type: LifecycleEvent['type'], instanceId: string, agentId: string, payload: Record<string, unknown>): void {
    const event: LifecycleEvent = { type, instanceId, agentId, payload, timestamp: new Date() };
    this.eventLog.push(event);

    if (this.eventLog.length > 1000) {
      this.eventLog.splice(0, this.eventLog.length - 500);
    }
  }
}

export const nvAgentLifecycleService = NvAgentLifecycleService.getInstance();
