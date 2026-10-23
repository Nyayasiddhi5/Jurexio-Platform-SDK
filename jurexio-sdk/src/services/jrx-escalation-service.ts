import { createLogger } from '../utils/logger.js';
import { secureRandomHex } from '../utils/jrx-secure-random.js';

const logger = createLogger('./jrx-escalation-service');

const MAX_ESCALATION_DEPTH = 5;

export interface EscalationResult {
  resolved: boolean;
  finalTarget: string;
  chain: string[];
  hitl: boolean;
  reason: string;
  traceId: string;
}

export interface HITLTicket {
  id: string;
  agentId: string;
  reason: string;
  context: Record<string, unknown>;
  chain: string[];
  createdAt: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export class NvEscalationService {
  private static instance: NvEscalationService;

  private constructor() {}

  static getInstance(): NvEscalationService {
    if (!NvEscalationService.instance) {
      NvEscalationService.instance = new NvEscalationService();
    }
    return NvEscalationService.instance;
  }

  detectCircularChain(agentId: string, escalationPath: string[], visited?: Set<string>): boolean {
    const seen = visited || new Set<string>();
    seen.add(agentId);
    for (const step of escalationPath) {
      if (step === 'HITL_OPERATOR') return false;
      if (seen.has(step)) return true;
      seen.add(step);
    }
    return false;
  }

  async resolveEscalation(
    agentId: string,
    reason: string,
    context: Record<string, unknown>,
    escalationPath: string[],
    traceId: string
  ): Promise<EscalationResult> {
    const startTime = Date.now();
    try {
      const chain: string[] = [];
      const visited = new Set<string>([agentId]);

      for (let i = 0; i < escalationPath.length && chain.length < MAX_ESCALATION_DEPTH; i++) {
        const target = escalationPath[i];

        if (target === 'HITL_OPERATOR') {
          chain.push('HITL_OPERATOR');
          const ticket = await this.escalateToHITL({
            agentId,
            reason,
            context,
            chain: [agentId, ...chain],
          });
          logger.info({
            service: 'NvEscalationService',
            method: 'resolveEscalation',
            traceId,
            result: 'HITL',
            ticketId: ticket.id,
            durationMs: Date.now() - startTime,
          });
          return {
            resolved: true,
            finalTarget: 'HITL_OPERATOR',
            chain: [agentId, ...chain],
            hitl: true,
            reason,
            traceId,
          };
        }

        if (visited.has(target)) {
          logger.warn({
            service: 'NvEscalationService',
            method: 'resolveEscalation',
            traceId,
            warning: 'circular_detected',
            circularTarget: target,
            chain: [agentId, ...chain],
          });
          chain.push('HITL_OPERATOR');
          await this.escalateToHITL({ agentId, reason: `Circular escalation detected at ${target}`, context, chain: [agentId, ...chain] });
          return {
            resolved: true,
            finalTarget: 'HITL_OPERATOR',
            chain: [agentId, ...chain],
            hitl: true,
            reason: `Circular escalation detected: ${agentId} → ${target}`,
            traceId,
          };
        }

        visited.add(target);
        chain.push(target);
      }

      if (chain.length >= MAX_ESCALATION_DEPTH) {
        chain.push('HITL_OPERATOR');
        await this.escalateToHITL({ agentId, reason: `Max escalation depth (${MAX_ESCALATION_DEPTH}) reached`, context, chain: [agentId, ...chain] });
        return {
          resolved: true,
          finalTarget: 'HITL_OPERATOR',
          chain: [agentId, ...chain],
          hitl: true,
          reason: `Max escalation depth reached`,
          traceId,
        };
      }

      const finalTarget = chain[chain.length - 1] || agentId;
      logger.info({
        service: 'NvEscalationService',
        method: 'resolveEscalation',
        traceId,
        result: 'agent',
        finalTarget,
        durationMs: Date.now() - startTime,
      });
      return { resolved: true, finalTarget, chain: [agentId, ...chain], hitl: false, reason, traceId };
    } catch (error: any) {
      logger.error({
        service: 'NvEscalationService',
        method: 'resolveEscalation',
        traceId,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return { resolved: false, finalTarget: 'HITL_OPERATOR', chain: [agentId, 'HITL_OPERATOR'], hitl: true, reason: 'Escalation failed, defaulting to HITL', traceId };
    }
  }

  async escalateToHITL(params: { agentId: string; reason: string; context: Record<string, unknown>; chain: string[] }): Promise<HITLTicket> {
    const ticket: HITLTicket = {
      id: `hitl-${Date.now()}-${secureRandomHex(4)}`,
      agentId: params.agentId,
      reason: params.reason,
      context: params.context,
      chain: params.chain,
      createdAt: new Date(),
      priority: params.chain.length >= MAX_ESCALATION_DEPTH ? 'critical' : 'high',
    };

    logger.info({
      service: 'NvEscalationService',
      method: 'escalateToHITL',
      ticketId: ticket.id,
      agentId: ticket.agentId,
      priority: ticket.priority,
    });

    return ticket;
  }
}

export const nvEscalationService = NvEscalationService.getInstance();
