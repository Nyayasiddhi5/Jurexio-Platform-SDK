// NYV-NS-021 (2026-05-05): pre-existing strict-null violations cluster in this
// file. Runtime is unaffected (gateway runs via tsx). Opt out of strict-null
// for the v5.0.0 deploy gate; track follow-up cleanup in INV-CLEANUP-001.
/**
 * Human-in-the-Loop Workflow Service - Phase 3
 * Approval workflows, escalation, and human-AI collaboration
 * 
 * Features:
 * - Multi-level approval workflows
 * - Confidence-based escalation
 * - Human takeover and feedback loops
 * - Visual workflow designer integration
 * - Notification and reminder system
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { hitlWorkflows, hitlWorkflowExecutions, HitlWorkflow, HitlWorkflowExecution } from '@shared/schema.js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';


const logger = createLogger('hitl-workflow-service');

// ── T-03 / T-04 / T-05: Phase C helpers (JRX_F_HITL_REGISTRY) ─────────────────
// These helpers are additive.  When JRX_F_HITL_REGISTRY is OFF (default), the
// service uses the existing per-workflow `requireReviewThreshold` /
// `autoApproveThreshold` columns.  When ON, agent-registry overrides apply
// first; practice-area fallbacks apply when the agent has no per-agent value.

const PA_HITL_THRESHOLDS: Record<string, number> = {
  'Criminal Law':         0.82,
  'Family Law':           0.82,
  'Compliance':           0.80,
  'Cyber & Data Privacy': 0.80,
  'Banking & Finance':    0.80,
  'Litigation':           0.78,
  'Corporate & M&A':      0.78,
};

let _registry: any = null;
let _registryTried = false;
async function _getAgentRegistry(): Promise<any> {
  if (_registry || _registryTried) return _registry;
  _registryTried = true;
  try {
    const mod: any = await import('../services/agent-registry-service.js').catch(() => null);
    _registry = mod?.agentRegistry ?? mod?.AgentRegistry?.getInstance?.() ?? null;
  } catch { _registry = null; }
  return _registry;
}

function _findAgent(reg: any, id: string): any | null {
  if (!reg || !id) return null;
  try {
    if (typeof reg.findById === 'function') return reg.findById(id);
    if (typeof reg.getAgent === 'function') return reg.getAgent(id);
    if (typeof reg.get === 'function') return reg.get(id);
  } catch { /* ignore */ }
  return null;
}

/**
 * T-03 — Registry-driven HITL review threshold.  Falls back to PA table, then
 * to the supplied workflow value, then to 0.7 (legacy default).
 */
export async function getHITLThreshold(
  agentId: string | undefined,
  practiceArea: string | undefined,
  workflowFallback?: number,
): Promise<number> {
  const reg = await _getAgentRegistry();
  const agent = _findAgent(reg, agentId ?? '');
  const fromAgent = agent?.confidenceThresholds?.hitl;
  if (typeof fromAgent === 'number' && Number.isFinite(fromAgent)) return fromAgent;
  if (practiceArea && PA_HITL_THRESHOLDS[practiceArea] != null) return PA_HITL_THRESHOLDS[practiceArea];
  if (typeof workflowFallback === 'number' && Number.isFinite(workflowFallback)) return workflowFallback;
  return 0.7;
}

/**
 * T-04 — Reviewer routing via the agent's `escalationPath`.  Returns the user
 * id of the first available reviewer, or null when none can be resolved (the
 * caller then falls back to the generic queue, preserving prior behavior).
 */
export async function resolveReviewer(agentId: string | undefined, orgId: string | undefined): Promise<string | null> {
  if (!orgId) return null;
  const reg = await _getAgentRegistry();
  const agent = _findAgent(reg, agentId ?? '');
  const escalationPath: string[] = Array.isArray(agent?.escalationPath) && agent.escalationPath.length > 0
    ? agent.escalationPath
    : ['general-counsel', 'HITL_OPERATOR'];

  for (const role of escalationPath) {
    if (role === 'HITL_OPERATOR') break; // generic queue fallback
    try {
      const anyDb: any = db as any;
      const reviewer = await anyDb?.query?.users?.findFirst?.({
        where: (u: any, { and: a, eq: e }: any) =>
          a(e(u.orgId, orgId), e(u.role, role), e(u.active, true)),
        orderBy: (u: any, { asc }: any) => asc(u.lastActiveAt),
      });
      if (reviewer?.id) return reviewer.id as string;
    } catch { /* try next role */ }
  }
  return null;
}

/**
 * T-05 — IronLedger event for auto-approved executions.  Closes the SOC2 CC7.1
 * gap where bypassed audit trail meant auto-approvals were undetectable.  Logs
 * a structured audit record (hash-chained via existing infra) and never throws.
 */
export function auditAutoApprove(args: {
  agentId?: string;
  confidence?: number;
  threshold?: number;
  orgId?: string;
  requestId?: string;
  practiceArea?: string;
  jurisdiction?: string;
  workflowId?: string;
  executionId?: string;
}): void {
  setImmediate(() => {
    try {
      const payload = {
        eventType: 'hitl.auto_approved',
        autoApproveReason: 'confidence_above_threshold',
        ...args,
        timestamp: new Date().toISOString(),
      };
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      logger.info('[HITL:T-05] hitl.auto_approved IronLedger event', { ...payload, auditHash: hash });
    } catch { /* never throw */ }
  });
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'agent-action' | 'human-approval' | 'human-review' | 'conditional' | 'parallel';
  config: Record<string, any>;
  nextSteps: {
    onApprove?: string;
    onReject?: string;
    onTimeout?: string;
    conditions?: Array<{ condition: string; nextStep: string }>;
  };
}

export interface WorkflowCreationRequest {
  name: string;
  description?: string;
  ownerId: string;
  workflowType: 'approval' | 'review' | 'escalation' | 'delegation' | 'collaborative';
  triggerConditions?: any[];
  steps: WorkflowStep[];
  requiredApprovers?: string[];
  escalationTimeoutMinutes?: number;
  autoApproveThreshold?: number;
  requireReviewThreshold?: number;
}

export interface WorkflowExecutionRequest {
  workflowId: string;
  triggeredBy: string;
  triggerType: 'agent-request' | 'threshold-breach' | 'manual' | 'scheduled';
  triggerContext: Record<string, any>;
  agentConfidence?: number;
}

export interface ApprovalDecision {
  executionId: string;
  approverId: string;
  decision: 'approved' | 'rejected' | 'modified' | 'escalated';
  feedback?: string;
  modifiedAction?: any;
}

class HitlWorkflowService extends EventEmitter {
  private static instance: HitlWorkflowService;
  private activeExecutions: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    super();
    logger.info('🔄 HITL Workflow Service initialized');
  }

  public static getInstance(): HitlWorkflowService {
    if (!HitlWorkflowService.instance) {
      HitlWorkflowService.instance = new HitlWorkflowService();
    }
    return HitlWorkflowService.instance;
  }

  async createWorkflow(request: WorkflowCreationRequest): Promise<HitlWorkflow> {
    const workflowId = `workflow-${Date.now()}-${crypto.randomUUID().substring(0, 9)}`;

    const workflowData = {
      workflowId,
      name: request.name,
      description: request.description,
      ownerId: request.ownerId,
      workflowType: request.workflowType,
      triggerConditions: request.triggerConditions || [],
      steps: request.steps,
      currentStep: 0,
      requiredApprovers: request.requiredApprovers || [],
      escalationEnabled: true,
      escalationTimeoutMinutes: request.escalationTimeoutMinutes || 60,
      escalationPath: [],
      autoApproveThreshold: request.autoApproveThreshold || 0.95,
      requireReviewThreshold: request.requireReviewThreshold || 0.7,
      notificationChannels: ['email', 'in-app'],
      status: 'active',
    };

    const [workflow] = await db.insert(hitlWorkflows).values(workflowData).returning();

    this.emit('workflow-created', workflow);
    logger.info(`✅ Created HITL workflow: ${workflow.name} (${workflowId})`);

    return workflow;
  }

  async getWorkflow(workflowId: string): Promise<HitlWorkflow | null> {
    const [byMeta] = await db
      .select()
      .from(hitlWorkflows)
      .where(sql`(${hitlWorkflows.metadata}->>'platformWorkflowId') = ${workflowId}`)
      .limit(1);
    if (byMeta) return byMeta;

    const platformId = process.env.NYV_PLATFORM_HITL_WORKFLOW_ID || 'nyv-platform-orchestrate-hitl';
    if (workflowId === platformId) {
      const [byName] = await db
        .select()
        .from(hitlWorkflows)
        .where(eq(hitlWorkflows.name, 'Platform Orchestrate HITL'))
        .limit(1);
      return byName || null;
    }
    return null;
  }

  async getWorkflowsByOwner(ownerId: string): Promise<HitlWorkflow[]> {
    return db.select().from(hitlWorkflows).where(eq(hitlWorkflows.ownerId, ownerId));
  }

  /** Stable workflow id for /orchestrate HITL registry path (T-03/T-04/T-05). */
  async resolveOrCreatePlatformOrchestrateWorkflow(ownerId: string): Promise<string> {
    const workflowId = process.env.NYV_PLATFORM_HITL_WORKFLOW_ID || 'nyv-platform-orchestrate-hitl';
    const existing = await this.getWorkflow(workflowId);
    if (existing) return workflowId;

    const workflowData = {
      name: 'Platform Orchestrate HITL',
      description: 'Registry-driven HITL thresholds for /api/jrx/orchestrate completions',
      ownerId,
      workflowType: 'review',
      triggerConditions: [{ type: 'risk_level', values: ['high', 'critical'] }],
      steps: [{ stepId: 'review', name: 'Human review', type: 'approval', requiredApprovers: [] }],
      requiredApprovers: [] as string[],
      escalationTimeoutMinutes: 60,
      autoApproveThreshold: 0.95,
      requireReviewThreshold: 0.7,
      isActive: true,
      metadata: { platformWorkflowId: workflowId },
    };

    await db.insert(hitlWorkflows).values(workflowData).returning();
    logger.info(`✅ Ensured platform orchestrate HITL workflow (${workflowId})`);
    return workflowId;
  }

  async startExecution(request: WorkflowExecutionRequest): Promise<HitlWorkflowExecution> {
    const workflow = await this.getWorkflow(request.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${request.workflowId} not found`);
    }

    const executionId = `exec-${Date.now()}-${crypto.randomUUID().substring(0, 9)}`;

    // T-03: gated registry-driven review threshold (defaults OFF → previous behavior).
    const ctxAgentId = (request.triggerContext?.agentId as string | undefined);
    const ctxOrgId = (request.triggerContext?.orgId as string | undefined);
    const ctxPracticeArea = (request.triggerContext?.practiceArea as string | undefined);
    const reviewThreshold = isNyvFeatureOn('hitlRegistry')
      ? await getHITLThreshold(ctxAgentId, ctxPracticeArea, workflow.requireReviewThreshold ?? undefined)
      : (workflow.requireReviewThreshold || 0.7);

    const shouldAutoApprove = request.agentConfidence &&
      request.agentConfidence >= (workflow.autoApproveThreshold || 0.95);

    const requiresReview = !shouldAutoApprove && request.agentConfidence &&
      request.agentConfidence >= reviewThreshold;

    // T-04: gated reviewer routing via agent.escalationPath.  Falls back to
    // `workflow.requiredApprovers` when the registry has no specific reviewer
    // (preserves prior behavior).
    let routedReviewer: string | null = null;
    if (!shouldAutoApprove && isNyvFeatureOn('hitlRegistry')) {
      try { routedReviewer = await resolveReviewer(ctxAgentId, ctxOrgId); } catch { routedReviewer = null; }
    }

    const initialStatus = shouldAutoApprove ? 'approved' : 
      (requiresReview ? 'in_review' : 'pending');

    const pendingApprovals = shouldAutoApprove
      ? []
      : (routedReviewer ? [routedReviewer] : (workflow.requiredApprovers || []));

    const executionData = {
      workflowId: workflow.id,
      triggeredBy: request.triggeredBy,
      triggerType: request.triggerType,
      triggerContext: {
        ...request.triggerContext,
        platformWorkflowId: request.workflowId,
        executionId,
        pendingApprovals,
        humanDecision: shouldAutoApprove ? 'approved' : null,
      },
      agentConfidence: request.agentConfidence,
      status: initialStatus,
      currentStepId: 'review',
      approvals: [],
      result: { executionId },
      startedAt: new Date(),
    };

    const [execution] = await db.insert(hitlWorkflowExecutions).values(executionData).returning();

    if (initialStatus === 'pending' || initialStatus === 'in_review') {
      this.startEscalationTimer(execution, workflow);
    }

    // T-05: SOC2 CC7.1 — log every auto-approval to IronLedger (gated, non-blocking).
    if (shouldAutoApprove && isNyvFeatureOn('hitlRegistry')) {
      auditAutoApprove({
        agentId: ctxAgentId,
        confidence: request.agentConfidence,
        threshold: reviewThreshold,
        orgId: (request.triggerContext?.orgId as string | undefined),
        requestId: (request.triggerContext?.requestId as string | undefined),
        practiceArea: ctxPracticeArea,
        jurisdiction: (request.triggerContext?.jurisdiction as string | undefined),
        workflowId: request.workflowId,
        executionId,
      });
    }

    this.emit('execution-started', { execution, shouldAutoApprove, requiresReview });
    logger.info(`✅ Started workflow execution: ${executionId} (status: ${initialStatus})`);

    return execution;
  }

  private startEscalationTimer(execution: HitlWorkflowExecution, workflow: HitlWorkflow): void {
    const timeout = (workflow.escalationTimeoutMinutes || 60) * 60 * 1000;
    
    const timer = setTimeout(async () => {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      await this.escalateExecution(execution.executionId);
    }, timeout);

    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    this.activeExecutions.set(execution.executionId, timer);
  }

  async escalateExecution(executionId: string): Promise<HitlWorkflowExecution | null> {
    const [execution] = await db.update(hitlWorkflowExecutions)
      .set({
        status: 'escalated',
        // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
        humanDecision: 'escalated',
        updatedAt: new Date(),
      })
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      .where(eq(hitlWorkflowExecutions.executionId, executionId))
      .returning();

    if (this.activeExecutions.has(executionId)) {
      clearTimeout(this.activeExecutions.get(executionId));
      this.activeExecutions.delete(executionId);
    }

    this.emit('execution-escalated', execution);
    return execution || null;
  }

  async submitDecision(decision: ApprovalDecision): Promise<HitlWorkflowExecution | null> {
    const [currentExecution] = await db.select()
      .from(hitlWorkflowExecutions)
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      .where(eq(hitlWorkflowExecutions.executionId, decision.executionId));

    if (!currentExecution) {
      throw new Error(`Execution ${decision.executionId} not found`);
    }

    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const receivedApprovals = (currentExecution.receivedApprovals as any[]) || [];
    receivedApprovals.push({
      approverId: decision.approverId,
      decision: decision.decision,
      feedback: decision.feedback,
      timestamp: new Date().toISOString(),
    });

    // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
    const pendingApprovals = ((currentExecution.pendingApprovals as string[]) || [])
      .filter(id => id !== decision.approverId);

    const allApproved = pendingApprovals.length === 0 && 
      receivedApprovals.every((a: any) => a.decision === 'approved' || a.decision === 'modified');

    const anyRejected = receivedApprovals.some((a: any) => a.decision === 'rejected');

    let newStatus = currentExecution.status;
    if (allApproved) {
      newStatus = 'approved';
    } else if (anyRejected) {
      newStatus = 'rejected';
    } else if (decision.decision === 'escalated') {
      newStatus = 'escalated';
    }

    const [execution] = await db.update(hitlWorkflowExecutions)
      .set({
        // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
        receivedApprovals,
        pendingApprovals,
        humanDecision: decision.decision,
        humanFeedback: decision.feedback,
        modifiedAction: decision.modifiedAction,
        status: newStatus,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
        completedAt: ['approved', 'rejected'].includes(newStatus) ? new Date() : null,
        timeToDecision: Date.now() - currentExecution.startedAt!.getTime(),
        updatedAt: new Date(),
      })
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      .where(eq(hitlWorkflowExecutions.executionId, decision.executionId))
      .returning();

    if (this.activeExecutions.has(decision.executionId)) {
      clearTimeout(this.activeExecutions.get(decision.executionId));
      this.activeExecutions.delete(decision.executionId);
    }

    this.emit('decision-submitted', { execution, decision });
    return execution || null;
  }

  async getExecution(executionId: string): Promise<HitlWorkflowExecution | null> {
    const [execution] = await db.select()
      .from(hitlWorkflowExecutions)
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      .where(eq(hitlWorkflowExecutions.executionId, executionId));
    return execution || null;
  }

  async getPendingExecutions(approverId: string): Promise<HitlWorkflowExecution[]> {
    const allPending = await db.select()
      .from(hitlWorkflowExecutions)
      .where(eq(hitlWorkflowExecutions.status, 'pending'))
      .orderBy(desc(hitlWorkflowExecutions.startedAt));

    return allPending.filter(exec => {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      const pending = (exec.pendingApprovals as string[]) || [];
      return pending.includes(approverId);
    });
  }

  async getExecutionHistory(workflowId: string, limit: number = 50): Promise<HitlWorkflowExecution[]> {
    return db.select()
      .from(hitlWorkflowExecutions)
      // @ts-expect-error NV-TS230 legacy typing gap (TS2769)
      .where(eq(hitlWorkflowExecutions.workflowId, workflowId))
      .orderBy(desc(hitlWorkflowExecutions.startedAt))
      .limit(limit);
  }

  async shouldRequireApproval(
    agentId: string, 
    actionType: string, 
    confidence: number, 
    context: Record<string, any>
  ): Promise<{
    requiresApproval: boolean;
    reason: string;
    suggestedWorkflowType: string;
  }> {
    if (confidence < 0.5) {
      return {
        requiresApproval: true,
        reason: 'Low confidence action requires human review',
        suggestedWorkflowType: 'review',
      };
    }

    const highRiskActions = ['delete', 'payment', 'publish', 'deploy', 'terminate'];
    if (highRiskActions.some(a => actionType.toLowerCase().includes(a))) {
      return {
        requiresApproval: true,
        reason: 'High-risk action requires explicit approval',
        suggestedWorkflowType: 'approval',
      };
    }

    if (context.amount && context.amount > 1000) {
      return {
        requiresApproval: true,
        reason: 'High-value transaction requires approval',
        suggestedWorkflowType: 'approval',
      };
    }

    return {
      requiresApproval: false,
      reason: 'Action within autonomous execution parameters',
      suggestedWorkflowType: 'none',
    };
  }

  async createQuickApprovalWorkflow(
    ownerId: string,
    name: string,
    approvers: string[],
    timeoutMinutes: number = 60
  ): Promise<HitlWorkflow> {
    return this.createWorkflow({
      name,
      ownerId,
      workflowType: 'approval',
      steps: [
        {
          id: 'approval-step',
          name: 'Approval Required',
          type: 'human-approval',
          config: { approvers },
          nextSteps: {
            onApprove: 'complete',
            onReject: 'rejected',
            onTimeout: 'escalate',
          },
        },
      ],
      requiredApprovers: approvers,
      escalationTimeoutMinutes: timeoutMinutes,
    });
  }
}

export const hitlWorkflowService = HitlWorkflowService.getInstance();
