/**
 * Maker-Checker Loop Service
 * 
 * Implements the Generator + Critic pattern with:
 * - Maker agent generates initial output
 * - Checker agent validates and critiques
 * - Conditional looping until quality threshold met
 * - Human escalation for stuck cases
 * - Audit trail for all decisions
 */

import { v4 as uuidv4 } from 'uuid';
import { db as _rawDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import type { LLMRequest } from './real-llm-service.js';

const logger = createLogger('maker-checker');
const db = lazyRequire(() => _rawDb, 'db');

export interface MakerOutput {
  id: string;
  content: string;
  metadata: Record<string, any>;
  confidence: number;
  reasoning?: string;
  alternatives?: string[];
}

export interface CheckerFeedback {
  id: string;
  makerOutputId: string;
  approved: boolean;
  score: number;
  issues: CheckerIssue[];
  suggestions: string[];
  reasoning: string;
  requiresHumanReview: boolean;
}

export interface CheckerIssue {
  type: 'accuracy' | 'completeness' | 'clarity' | 'safety' | 'relevance' | 'format';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location?: string;
  suggestedFix?: string;
}

export interface LoopIteration {
  iterationNumber: number;
  makerOutput: MakerOutput;
  checkerFeedback: CheckerFeedback;
  timestamp: Date;
  latencyMs: number;
}

export interface LoopResult {
  sessionId: string;
  originalPrompt: string;
  finalOutput: MakerOutput;
  iterations: LoopIteration[];
  totalIterations: number;
  approved: boolean;
  humanEscalated: boolean;
  humanDecision?: 'approved' | 'rejected' | 'modified';
  totalLatencyMs: number;
  qualityScore: number;
}

export interface LoopConfig {
  maxIterations: number;
  approvalThreshold: number;
  humanEscalationThreshold: number;
  criticalIssueEscalation: boolean;
  timeoutMs: number;
  enableParallelChecking: boolean;
}

export interface HumanReviewRequest {
  requestId: string;
  sessionId: string;
  prompt: string;
  makerOutput: MakerOutput;
  checkerFeedback: CheckerFeedback;
  iterations: LoopIteration[];
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: Date;
  deadline?: Date;
}

type MakerFunction = (prompt: string, feedback?: CheckerFeedback) => Promise<MakerOutput>;
type CheckerFunction = (prompt: string, output: MakerOutput) => Promise<CheckerFeedback>;

class MakerCheckerService {
  private activeSessions: Map<string, LoopResult> = new Map();
  private humanReviewQueue: Map<string, HumanReviewRequest> = new Map();
  private completedSessions: Map<string, LoopResult> = new Map();
  private auditLog: Map<string, any[]> = new Map();
  
  private config: LoopConfig = {
    maxIterations: 5,
    approvalThreshold: 0.85,
    humanEscalationThreshold: 3,
    criticalIssueEscalation: true,
    timeoutMs: 60000,
    enableParallelChecking: false
  };

  /**
   * Real maker (generator). Routes through the single orchestrator entrypoint
   * (`executeWithFullSafetyRing`, NV-LLM-001 whitelisted) — never a provider
   * directly. Confidence is taken from the orchestration response quality
   * signal, not fabricated. The wrapper is imported dynamically to avoid an
   * import cycle (queen → maker-checker → wrapper → jrx-client → queen).
   */
  private defaultMaker: MakerFunction = async (prompt: string, feedback?: CheckerFeedback): Promise<MakerOutput> => {
    const { executeWithFullSafetyRing } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');

    const systemPrompt =
      'You are the MAKER in a maker/checker governance loop for a regulated legal AI platform. '
      + 'Produce the best, most accurate answer to the request. Cite controlling authority where relevant, '
      + 'be precise, and fully address any reviewer feedback supplied.';
    const userPrompt = feedback && (feedback.suggestions.length > 0 || feedback.issues.length > 0)
      ? `Revise your previous answer to resolve the reviewer's findings.\n`
        + `Issues: ${feedback.issues.map(i => `[${i.severity}] ${i.description}`).join('; ') || 'none'}.\n`
        + `Suggestions: ${feedback.suggestions.join('; ') || 'none'}.\n\n`
        + `Original request:\n${prompt}`
      : prompt;

    const resp = await executeWithFullSafetyRing(
      {
        id: `mk-maker-${Date.now()}-${uuidv4().slice(0, 8)}`,
        userId: 'maker-checker',
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 2048,
        temperature: 0.3,
        requirements: {
          complexity: 'complex',
          domain: 'analytical',
          priority: 'high',
          costBudget: 'balanced',
          responseTime: 'balanced',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      } as LLMRequest,
      {
        agentKey: 'auto',
        taskType: 'maker_checker_generate',
        tier: 'enterprise',
        enableHallucinationCheck: true,
        enableCitationVerification: true,
      },
    );

    const qs = (resp as { qualityScore?: number }).qualityScore;
    const confidence = typeof qs === 'number' && Number.isFinite(qs)
      ? Math.max(0, Math.min(1, qs))
      : 0.5;

    return {
      id: uuidv4(),
      content: resp.content,
      metadata: {
        generatedAt: new Date().toISOString(),
        model: resp.model,
        provider: (resp as { provider?: string }).provider,
        routedThroughSafetyRing: true,
      },
      confidence,
      reasoning: feedback
        ? `Revised against ${feedback.issues.length} reviewer issue(s) via orchestrator`
        : 'Initial generation via orchestrator',
    };
  };

  /**
   * Real checker (critic). Routes the critique request through the single
   * orchestrator entrypoint and parses a STRICT JSON verdict. If the model
   * does not return a parseable verdict the call fails loud (throws) — it
   * never fabricates an approval.
   */
  private defaultChecker: CheckerFunction = async (prompt: string, output: MakerOutput): Promise<CheckerFeedback> => {
    const { executeWithFullSafetyRingSimple } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');

    const systemPrompt =
      'You are the CHECKER (critic) in a maker/checker governance loop for a regulated legal AI platform. '
      + 'Critically evaluate the MAKER output for accuracy, completeness, clarity, safety, relevance and format. '
      + 'Respond with ONLY a single JSON object (no prose, no code fences) matching exactly this shape: '
      + '{"approved": boolean, "score": number between 0 and 1, '
      + '"issues": [{"type": "accuracy|completeness|clarity|safety|relevance|format", '
      + '"severity": "low|medium|high|critical", "description": string, "suggestedFix": string}], '
      + '"suggestions": [string], "reasoning": string, "requiresHumanReview": boolean}';
    const userPrompt = `ORIGINAL REQUEST:\n${prompt}\n\nMAKER OUTPUT TO REVIEW:\n${output.content}`;

    const raw = await executeWithFullSafetyRingSimple(
      systemPrompt,
      userPrompt,
      { agentKey: 'auto', taskType: 'maker_checker_review', tier: 'enterprise' },
      1024,
    );

    const verdict = this.parseCheckerVerdict(raw);
    return {
      id: uuidv4(),
      makerOutputId: output.id,
      approved: verdict.approved,
      score: verdict.score,
      issues: verdict.issues,
      suggestions: verdict.suggestions,
      reasoning: verdict.reasoning,
      requiresHumanReview: verdict.requiresHumanReview,
    };
  };

  /**
   * Parse a checker LLM response into a structured verdict. Throws if no
   * JSON object or no numeric score is present — fail loud, never default to
   * an approval.
   */
  private parseCheckerVerdict(raw: string): {
    approved: boolean;
    score: number;
    issues: CheckerIssue[];
    suggestions: string[];
    reasoning: string;
    requiresHumanReview: boolean;
  } {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('maker-checker: checker model did not return a JSON verdict');
    }
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`maker-checker: checker verdict JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (typeof obj.score !== 'number' || !Number.isFinite(obj.score)) {
      throw new Error('maker-checker: checker verdict missing a numeric "score"');
    }
    const score = Math.max(0, Math.min(1, obj.score));

    const validTypes = new Set<CheckerIssue['type']>(['accuracy', 'completeness', 'clarity', 'safety', 'relevance', 'format']);
    const validSeverities = new Set<CheckerIssue['severity']>(['low', 'medium', 'high', 'critical']);
    const rawIssues = Array.isArray(obj.issues) ? obj.issues : [];
    const issues: CheckerIssue[] = rawIssues.map((i: any): CheckerIssue => ({
      type: validTypes.has(i?.type) ? i.type : 'accuracy',
      severity: validSeverities.has(i?.severity) ? i.severity : 'medium',
      description: String(i?.description ?? '').slice(0, 1000),
      suggestedFix: i?.suggestedFix != null ? String(i.suggestedFix).slice(0, 1000) : undefined,
    }));

    const suggestions: string[] = Array.isArray(obj.suggestions)
      ? (obj.suggestions as unknown[]).map(s => String(s).slice(0, 1000))
      : [];

    const approved = typeof obj.approved === 'boolean' ? obj.approved : score >= this.config.approvalThreshold;
    const requiresHumanReview = typeof obj.requiresHumanReview === 'boolean'
      ? obj.requiresHumanReview
      : issues.some(i => i.severity === 'critical');
    const reasoning = String(obj.reasoning ?? `Checker score ${score.toFixed(2)} with ${issues.length} issue(s)`).slice(0, 2000);

    return { approved, score, issues, suggestions, reasoning, requiresHumanReview };
  }

  async runLoop(
    prompt: string,
    options: {
      makerFn?: MakerFunction;
      checkerFn?: CheckerFunction;
      config?: Partial<LoopConfig>;
      context?: Record<string, any>;
    } = {}
  ): Promise<LoopResult> {
    const sessionId = uuidv4();
    const startTime = Date.now();
    const sessionConfig = { ...this.config, ...options.config };
    
    const makerFn = options.makerFn || this.defaultMaker;
    const checkerFn = options.checkerFn || this.defaultChecker;
    
    const iterations: LoopIteration[] = [];
    let currentOutput: MakerOutput | null = null;
    let currentFeedback: CheckerFeedback | null = null;
    let approved = false;
    let humanEscalated = false;

    this.logAudit(sessionId, 'session_started', { prompt, config: sessionConfig });

    for (let i = 0; i < sessionConfig.maxIterations; i++) {
      const iterationStart = Date.now();

      if (Date.now() - startTime > sessionConfig.timeoutMs) {
        this.logAudit(sessionId, 'timeout', { iteration: i });
        break;
      }

      try {
        currentOutput = await makerFn(prompt, currentFeedback || undefined);
        this.logAudit(sessionId, 'maker_output', { iteration: i, outputId: currentOutput.id });
      } catch (error: any) {
        this.logAudit(sessionId, 'maker_error', { iteration: i, error: String(error) });
        throw error;
      }

      try {
        currentFeedback = await checkerFn(prompt, currentOutput);
        this.logAudit(sessionId, 'checker_feedback', { 
          iteration: i, 
          feedbackId: currentFeedback.id,
          approved: currentFeedback.approved,
          score: currentFeedback.score
        });
      } catch (error: any) {
        this.logAudit(sessionId, 'checker_error', { iteration: i, error: String(error) });
        throw error;
      }

      iterations.push({
        iterationNumber: i + 1,
        makerOutput: currentOutput,
        checkerFeedback: currentFeedback,
        timestamp: new Date(),
        latencyMs: Date.now() - iterationStart
      });

      if (currentFeedback.approved) {
        approved = true;
        this.logAudit(sessionId, 'approved', { iteration: i, score: currentFeedback.score });
        break;
      }

      if (currentFeedback.requiresHumanReview || 
          (sessionConfig.criticalIssueEscalation && 
           currentFeedback.issues.some(issue => issue.severity === 'critical'))) {
        humanEscalated = true;
        this.logAudit(sessionId, 'human_escalation', { 
          reason: 'critical_issue',
          iteration: i 
        });
        
        await this.createHumanReviewRequest(
          sessionId,
          prompt,
          currentOutput,
          currentFeedback,
          iterations,
          'Critical issue detected requiring human review'
        );
        break;
      }

      if (i >= sessionConfig.humanEscalationThreshold - 1 && !approved) {
        humanEscalated = true;
        this.logAudit(sessionId, 'human_escalation', { 
          reason: 'max_iterations_without_approval',
          iteration: i 
        });
        
        await this.createHumanReviewRequest(
          sessionId,
          prompt,
          currentOutput,
          currentFeedback,
          iterations,
          `Failed to achieve approval after ${i + 1} iterations`
        );
        break;
      }
    }

    const result: LoopResult = {
      sessionId,
      originalPrompt: prompt,
      finalOutput: currentOutput!,
      iterations,
      totalIterations: iterations.length,
      approved,
      humanEscalated,
      totalLatencyMs: Date.now() - startTime,
      qualityScore: currentFeedback?.score ?? 0
    };

    this.activeSessions.delete(sessionId);
    this.completedSessions.set(sessionId, result);
    this.logAudit(sessionId, 'session_completed', { 
      approved, 
      humanEscalated, 
      totalIterations: iterations.length 
    });

    // Durable persistence to the governance store (replaces in-process-only
    // state for audit/recovery). Best-effort: a DB outage logs loudly but must
    // not lose the already-computed result for the caller.
    await this.persistSession(result);

    return result;
  }

  /**
   * Persist a maker/checker session to nv_schema.nv_maker_checker_sessions.
   * Idempotent (UPSERT on session_id) so a later human decision update lands
   * on the same row. Failures are logged, never swallowed silently.
   */
  private async persistSession(result: LoopResult): Promise<void> {
    if (!_rawDb) {
      logger.error('[MakerChecker] session persistence skipped — DB handle unavailable', { sessionId: result.sessionId });
      return;
    }
    try {
      const { ensureNvSchemaTables } = await import('../db/jrx-ensure-schema.js');
      await ensureNvSchemaTables(db as any);
      await db.execute(sql`
        INSERT INTO nv_schema.nv_maker_checker_sessions
          (session_id, original_prompt, final_output, iterations, total_iterations,
           approved, human_escalated, human_decision, quality_score, total_latency_ms, metadata, updated_at)
        VALUES (
          ${result.sessionId}::uuid,
          ${result.originalPrompt ?? ''},
          ${JSON.stringify(result.finalOutput ?? {})}::jsonb,
          ${JSON.stringify(result.iterations ?? [])}::jsonb,
          ${result.totalIterations},
          ${result.approved},
          ${result.humanEscalated},
          ${result.humanDecision ?? null},
          ${result.qualityScore},
          ${result.totalLatencyMs},
          ${JSON.stringify({})}::jsonb,
          now()
        )
        ON CONFLICT (session_id) DO UPDATE SET
          final_output     = EXCLUDED.final_output,
          iterations       = EXCLUDED.iterations,
          total_iterations = EXCLUDED.total_iterations,
          approved         = EXCLUDED.approved,
          human_escalated  = EXCLUDED.human_escalated,
          human_decision   = EXCLUDED.human_decision,
          quality_score    = EXCLUDED.quality_score,
          total_latency_ms = EXCLUDED.total_latency_ms,
          updated_at       = now()
      `);
    } catch (err) {
      logger.error('[MakerChecker] session persistence failed', {
        sessionId: result.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async createHumanReviewRequest(
    sessionId: string,
    prompt: string,
    output: MakerOutput,
    feedback: CheckerFeedback,
    iterations: LoopIteration[],
    reason: string
  ): Promise<HumanReviewRequest> {
    const hasCritical = feedback.issues.some(i => i.severity === 'critical');
    
    const request: HumanReviewRequest = {
      requestId: uuidv4(),
      sessionId,
      prompt,
      makerOutput: output,
      checkerFeedback: feedback,
      iterations,
      reason,
      priority: hasCritical ? 'urgent' : iterations.length >= 4 ? 'high' : 'medium',
      createdAt: new Date(),
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };

    this.humanReviewQueue.set(request.requestId, request);
    return request;
  }

  async submitHumanDecision(
    requestId: string,
    decision: 'approved' | 'rejected' | 'modified',
    modifiedContent?: string,
    notes?: string
  ): Promise<LoopResult | null> {
    const request = this.humanReviewQueue.get(requestId);
    if (!request) return null;

    const session = this.completedSessions.get(request.sessionId);
    if (!session) return null;

    session.humanDecision = decision;
    
    if (decision === 'approved') {
      session.approved = true;
    } else if (decision === 'modified' && modifiedContent) {
      session.finalOutput = {
        ...session.finalOutput,
        content: modifiedContent,
        metadata: {
          ...session.finalOutput.metadata,
          humanModified: true,
          humanNotes: notes
        }
      };
      session.approved = true;
    }

    this.logAudit(request.sessionId, 'human_decision', { 
      requestId, 
      decision, 
      notes 
    });

    // Persist the human decision onto the same durable row (UPSERT).
    await this.persistSession(session);

    this.humanReviewQueue.delete(requestId);
    return session;
  }

  getPendingHumanReviews(priority?: HumanReviewRequest['priority']): HumanReviewRequest[] {
    const reviews = Array.from(this.humanReviewQueue.values());
    
    if (priority) {
      return reviews.filter(r => r.priority === priority);
    }
    
    return reviews.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  getSession(sessionId: string): LoopResult | undefined {
    return this.completedSessions.get(sessionId) || this.activeSessions.get(sessionId);
  }

  getAuditLog(sessionId: string): any[] {
    return this.auditLog.get(sessionId) || [];
  }

  private logAudit(sessionId: string, event: string, data: Record<string, any>): void {
    if (!this.auditLog.has(sessionId)) {
      this.auditLog.set(sessionId, []);
    }
    
    this.auditLog.get(sessionId)!.push({
      timestamp: new Date().toISOString(),
      event,
      ...data
    });
  }

  updateConfig(newConfig: Partial<LoopConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getStats(): {
    activeSessions: number;
    completedSessions: number;
    pendingReviews: number;
    approvalRate: number;
    averageIterations: number;
    escalationRate: number;
  } {
    const completed = Array.from(this.completedSessions.values());
    const approved = completed.filter(s => s.approved).length;
    const escalated = completed.filter(s => s.humanEscalated).length;
    const avgIterations = completed.length > 0
      ? completed.reduce((sum, s) => sum + s.totalIterations, 0) / completed.length
      : 0;

    return {
      activeSessions: this.activeSessions.size,
      completedSessions: this.completedSessions.size,
      pendingReviews: this.humanReviewQueue.size,
      approvalRate: completed.length > 0 ? approved / completed.length : 0,
      averageIterations: avgIterations,
      escalationRate: completed.length > 0 ? escalated / completed.length : 0
    };
  }
}

export const makerCheckerService = new MakerCheckerService();
export default makerCheckerService;
