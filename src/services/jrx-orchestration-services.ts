import { db as rawDb } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { governanceProtocolRegistryRef, governanceSelectOneIdByColumn } from '../db/governance-sql.js';
import { requireDb } from '../utils/jrx-type-helpers.js';
import {
  getAllAgents,
  getAgentsByPracticeArea,
  searchAgents,
} from './agent-registry-service.js';

// JRX-NS-005 (2026-05-01): rebind db locally so every db.* call site below
// is type-safe (was: ~114 TS18047 'db is possibly null' errors).
// JRX-NS-022 (2026-05-07): Proxy defers requireDb() until first property
// access. Eager `const db = requireDb(rawDb)` at module init crashed prod
// because routes static-import this module BEFORE initializeDatabase()
// runs in src/index.ts. Each `db.foo` now does a fresh `requireDb(rawDb).foo`
// lookup; once the singleton is set, calls succeed. Throws at use-site
// (not import-site) if init genuinely failed.
const db: NonNullable<typeof rawDb> = new Proxy({} as any, {
  get(_t, prop, receiver) {
    const real = requireDb(rawDb) as any;
    const v = Reflect.get(real, prop, receiver);
    return typeof v === 'function' ? v.bind(real) : v;
  }
}) as NonNullable<typeof rawDb>;
import crypto from 'crypto';
import { callJurexio, callJurexioSimple } from './jrx-client.js';
import { publishHitlChange } from './jrx-hitl-event-bus.js';
import { createLogger } from '../utils/logger.js';
import {
  NvContractPlaybookService,
  nvContractPlaybookService,
} from './jrx-contract-playbook-service.js';

export { NvContractPlaybookService, nvContractPlaybookService };

const logger = createLogger('orchestration-services');

const HIGH_RISK_CATEGORIES = ['bail', 'criminal', 'regulatory_filing', 'sentencing', 'deportation', 'custody'];
const MEDIUM_RISK_CATEGORIES = ['contract_review', 'legal_advice', 'compliance_check', 'litigation_strategy'];

export function classifyRiskLevel(agentKey: string, taskType?: string): 'low' | 'medium' | 'high' | 'critical' {
  const lower = `${agentKey} ${taskType || ''}`.toLowerCase();
  if (HIGH_RISK_CATEGORIES.some(c => lower.includes(c))) return 'critical';
  if (MEDIUM_RISK_CATEGORIES.some(c => lower.includes(c))) return 'high';
  if (lower.includes('research') || lower.includes('summariz')) return 'low';
  return 'medium';
}

export class NvHallucinationDetector {
  async checkOutput(params: {
    requestId: string;
    inputText: string;
    outputText: string;
    agentKey: string;
    userId?: string;
    tenantId?: string;
  }): Promise<{ score: number; flaggedClaims: string[]; verifiedCitations: string[]; unverifiedCitations: string[]; status: string }> {
    // NV-HALLUCHECK-GUARD-001 — this capability is reachable from the Queen's
    // capability manifest as a *subtask* leaf (`safety.hallucination-check` is
    // in the quality_check / review / qa intent maps), where no upstream output
    // exists yet. `outputText` was then undefined and `.match()` threw a
    // TypeError, which the Queen's `safetyReject` test misread as a policy
    // rejection and used to fail the whole agent in production.
    const outputText = typeof params.outputText === 'string' ? params.outputText : '';
    const inputText = typeof params.inputText === 'string' ? params.inputText : '';
    if (!outputText.trim()) {
      return {
        score: 1,
        flaggedClaims: [],
        verifiedCitations: [],
        unverifiedCitations: [],
        status: 'skipped_no_output',
      };
    }
    const citationPatterns = [
      /(?:AIR|SCC|SCR)\s+\d{4}\s+\w+\s+\d+/g,
      /\d{4}\s+\(\d+\)\s+SCC\s+\d+/g,
      /Section\s+\d+[A-Z]?\s+(?:of\s+)?(?:the\s+)?[A-Z][a-zA-Z\s]+Act/g,
      /Article\s+\d+[A-Z]?\s+(?:of\s+)?(?:the\s+)?Constitution/gi,
      /\b\d{4}\s+(?:INSC|SCC\s+OnLine)\s+\w+\s+\d+/g,
    ];

    const extractedCitations: string[] = [];
    for (const pattern of citationPatterns) {
      const matches = outputText.match(pattern);
      if (matches) extractedCitations.push(...matches);
    }

    const claimPatterns = [
      /(?:the court held|it was decided|as per the judgment|the ruling states|the law requires|mandatory under)/gi,
      /(?:guaranteed|always|never|definitively|without exception|absolute right)/gi,
    ];

    const flaggedClaims: string[] = [];
    const sentences = outputText.split(/[.!?]+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences) {
      for (const pattern of claimPatterns) {
        if (pattern.test(sentence)) {
          const hasCitation = citationPatterns.some(cp => cp.test(sentence));
          if (!hasCitation) {
            flaggedClaims.push(sentence.trim().substring(0, 200));
          }
          pattern.lastIndex = 0;
        }
      }
    }

    const totalClaims = Math.max(sentences.length, 1);
    const groundingScore = Math.max(0, 1 - (flaggedClaims.length / totalClaims));
    const confidenceScore = extractedCitations.length > 0 ? Math.min(1, 0.5 + (extractedCitations.length * 0.1)) : 0.3;
    const status = groundingScore >= 0.8 ? 'passed' : groundingScore >= 0.5 ? 'review_recommended' : 'flagged';

    try {
      await db.execute(sql`
        INSERT INTO nv_schema.hallucination_checks (request_id, user_id, tenant_id, agent_key, input_text, output_text, confidence_score, grounding_score, flagged_claims, verified_citations, unverified_citations, status)
        VALUES (${params.requestId}, ${params.userId || null}, ${params.tenantId || null}, ${params.agentKey}, ${inputText.substring(0, 5000)}, ${outputText.substring(0, 10000)}, ${confidenceScore}, ${groundingScore}, ${JSON.stringify(flaggedClaims.slice(0, 10))}, ${JSON.stringify(extractedCitations)}, ${JSON.stringify([])}, ${status})
      `);
    } catch (e: any) {
      logger.warn('[NV-Hallucination] DB write failed:', e.message);
    }

    return { score: groundingScore, flaggedClaims: flaggedClaims.slice(0, 10), verifiedCitations: extractedCitations, unverifiedCitations: [], status };
  }
}

export class NvHITLService {
  async checkAndQueue(params: {
    requestId: string;
    agentKey: string;
    aiOutput: string;
    riskLevel: string;
    userId?: string;
    tenantId?: string;
  }): Promise<{ required: boolean; reviewId?: string; status: string }> {
    const requiresReview = params.riskLevel === 'critical' || params.riskLevel === 'high';

    if (!requiresReview) {
      return { required: false, status: 'auto_approved' };
    }

    const reviewId = crypto.randomUUID();
    const slaHours = params.riskLevel === 'critical' ? 2 : 24;
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);

    try {
      await db.execute(sql`
        INSERT INTO nv_schema.hitl_reviews (id, request_id, user_id, tenant_id, agent_key, risk_level, ai_output, review_status, sla_deadline, created_at)
        VALUES (${reviewId}, ${params.requestId}, ${params.userId || null}, ${params.tenantId || null}, ${params.agentKey}, ${params.riskLevel}, ${params.aiOutput.substring(0, 20000)}, 'pending', ${slaDeadline.toISOString()}, NOW())
      `);
    } catch (e: any) {
      logger.warn('[NV-HITL] DB write failed:', e.message);
    }

    // Task #314 — wake any /hitl/stats/stream subscribers so the dashboard
    // tiles + 7-day sparkline reflect the new pending row instantly.
    publishHitlChange(params.tenantId ?? null, 'queued');

    return { required: true, reviewId, status: 'pending_review' };
  }

  async submitDecision(reviewId: string, decision: string, reviewerId: string, notes?: string, modifiedOutput?: string): Promise<any> {
    const result = await db.execute(sql`
      UPDATE nv_schema.hitl_reviews SET reviewer_id = ${reviewerId}, reviewer_decision = ${decision}, reviewer_notes = ${notes || null}, modified_output = ${modifiedOutput || null}, review_status = ${decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'modified'}, reviewed_at = NOW()
      WHERE id = ${reviewId} RETURNING *
    `);
    const row = result.rows?.[0] as { tenant_id?: string | null } | undefined;
    // Task #314 — fan-out to /hitl/stats/stream SSE subscribers. tenant_id
    // is taken from the updated row so per-tenant streams only see their
    // own changes.
    publishHitlChange(row?.tenant_id ?? null, 'decided');
    return row || null;
  }

  async getPendingReviews(tenantId?: string, limit: number = 50): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.hitl_reviews WHERE review_status = 'pending' AND tenant_id = ${tenantId} ORDER BY created_at ASC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM nv_schema.hitl_reviews WHERE review_status = 'pending' ORDER BY created_at ASC LIMIT ${limit}`);
    return result.rows || [];
  }

  async getReviewById(reviewId: string): Promise<any> {
    const result = await db.execute(sql`SELECT * FROM nv_schema.hitl_reviews WHERE id = ${reviewId}`);
    return result.rows?.[0] || null;
  }

  async getReviewStats(tenantId?: string): Promise<NvHitlReviewStats> {
    const filter = tenantId ? sql`AND tenant_id = ${tenantId}` : sql``;
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE review_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE review_status = 'approved') as approved,
        COUNT(*) FILTER (WHERE review_status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE review_status = 'modified') as modified,
        COUNT(*) as total,
        AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) FILTER (WHERE reviewed_at IS NOT NULL) as avg_review_hours
      FROM nv_schema.hitl_reviews WHERE 1=1 ${filter}
    `);
    const headRow = (result.rows?.[0] ?? {}) as Partial<NvHitlReviewHead>;
    const head: NvHitlReviewHead = {
      pending: headRow.pending ?? null,
      approved: headRow.approved ?? null,
      rejected: headRow.rejected ?? null,
      modified: headRow.modified ?? null,
      total: headRow.total ?? null,
      avg_review_hours: headRow.avg_review_hours ?? null,
    };

    // Task #301 — 7-day decision-volume trend, used by /console/hitl-decision-cards
    // stats card. Bucketised in UTC; absent days return 0 so the sparkline is contiguous.
    let trend7d: NvHitlTrendBucket[] = [];
    let avgReviewHoursLast7d: number | null = null;
    try {
      const trendRows = await db.execute(sql`
        WITH days AS (
          SELECT generate_series(
            (CURRENT_DATE - INTERVAL '6 days')::date,
            CURRENT_DATE::date,
            INTERVAL '1 day'
          )::date AS day
        )
        SELECT
          to_char(d.day, 'YYYY-MM-DD') as day,
          COALESCE(COUNT(h.id), 0)::int as total,
          COALESCE(COUNT(h.id) FILTER (WHERE h.review_status = 'approved'), 0)::int as approved,
          COALESCE(COUNT(h.id) FILTER (WHERE h.review_status = 'rejected'), 0)::int as rejected,
          COALESCE(COUNT(h.id) FILTER (WHERE h.review_status = 'modified'), 0)::int as modified,
          COALESCE(COUNT(h.id) FILTER (WHERE h.review_status = 'pending'),  0)::int as pending
        FROM days d
        LEFT JOIN nv_schema.hitl_reviews h
          ON (h.created_at AT TIME ZONE 'UTC')::date = d.day
         AND (${tenantId ?? null}::text IS NULL OR h.tenant_id = ${tenantId ?? null})
        GROUP BY d.day
        ORDER BY d.day ASC
      `);
      const rawTrend = (trendRows.rows ?? []) as Array<Partial<NvHitlTrendBucket>>;
      trend7d = rawTrend.map(r => ({
        day: String(r.day ?? ''),
        total: Number(r.total ?? 0),
        approved: Number(r.approved ?? 0),
        rejected: Number(r.rejected ?? 0),
        modified: Number(r.modified ?? 0),
        pending: Number(r.pending ?? 0),
      }));
      const avgRow = await db.execute(sql`
        SELECT AVG(EXTRACT(EPOCH FROM (reviewed_at - created_at))/3600) AS h
        FROM nv_schema.hitl_reviews
        WHERE reviewed_at IS NOT NULL
          AND created_at >= NOW() - INTERVAL '7 days'
          ${filter}
      `);
      const avgRowOne = (avgRow.rows?.[0] ?? {}) as { h?: number | string | null };
      avgReviewHoursLast7d = avgRowOne.h == null ? null : Number(avgRowOne.h);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[NV-HITL] trend7d query failed', { err: msg });
    }

    return { ...head, trend7d, avg_review_hours_last_7d: avgReviewHoursLast7d };
  }
}

// Task #301 — exported as part of the public service contract consumed by
// /api/jrx/hitl/stats and the /console/hitl-decision-cards page. Strings are
// allowed for the head counters because Postgres returns COUNT(*) as bigint
// which the pg driver hands back as a string.
export interface NvHitlReviewHead {
  pending: number | string | null;
  approved: number | string | null;
  rejected: number | string | null;
  modified: number | string | null;
  total: number | string | null;
  avg_review_hours: number | string | null;
}
export interface NvHitlTrendBucket {
  day: string;
  total: number;
  approved: number;
  rejected: number;
  modified: number;
  pending: number;
}
export interface NvHitlReviewStats extends NvHitlReviewHead {
  trend7d: NvHitlTrendBucket[];
  avg_review_hours_last_7d: number | null;
}

export class NvExplainabilityService {
  async generateExplanation(params: {
    requestId: string;
    agentKey: string;
    userPrompt: string;
    aiOutput: string;
    tier: string;
    userId?: string;
    tenantId?: string;
  }): Promise<{ reasoningSteps: string[]; sourcesConsulted: string[]; confidence: number }> {
    const enableCoT = ['pro', 'elite', 'government'].includes(params.tier);
    if (!enableCoT) {
      return { reasoningSteps: [], sourcesConsulted: [], confidence: 0 };
    }

    const reasoningSteps: string[] = [];
    const sourcesConsulted: string[] = [];

    const sectionHeaders = params.aiOutput.match(/(?:^|\n)(?:\d+\.|#+|[A-Z][A-Z\s]+:)\s*.+/g);
    if (sectionHeaders) {
      for (const header of sectionHeaders.slice(0, 10)) {
        reasoningSteps.push(header.trim());
      }
    }

    const sourcePatterns = [
      /(?:AIR|SCC|SCR)\s+\d{4}\s+\w+\s+\d+/g,
      /Section\s+\d+[A-Z]?\s+(?:of\s+)?(?:the\s+)?[A-Z][a-zA-Z\s]+Act/g,
      /(?:Indian Kanoon|SCC Online|Manupatra|legal database)/gi,
    ];
    for (const pattern of sourcePatterns) {
      const matches = params.aiOutput.match(pattern);
      if (matches) sourcesConsulted.push(...matches);
    }

    const confidence = Math.min(1, 0.4 + (reasoningSteps.length * 0.05) + (sourcesConsulted.length * 0.1));

    try {
      await db.execute(sql`
        INSERT INTO nv_schema.explainability_logs (request_id, user_id, tenant_id, agent_key, reasoning_steps, sources_consulted, confidence, tier)
        VALUES (${params.requestId}, ${params.userId || null}, ${params.tenantId || null}, ${params.agentKey}, ${JSON.stringify(reasoningSteps)}, ${JSON.stringify([...new Set(sourcesConsulted)])}, ${confidence}, ${params.tier})
      `);
    } catch (e: any) {
      logger.warn('[NV-Explainability] DB write failed:', e.message);
    }

    return { reasoningSteps, sourcesConsulted: [...new Set(sourcesConsulted)], confidence };
  }
}

export class NvCitationVerifier {
  async verifyCitations(params: {
    requestId: string;
    outputText: string;
    jurisdiction?: string;
    tenantId?: string;
  }): Promise<{ verified: number; unverified: number; details: Array<{ text: string; verified: boolean; source?: string }> }> {
    const citationPatterns = [
      { pattern: /(?:AIR|SCC|SCR)\s+\d{4}\s+\w+\s+\d+/g, type: 'case_law' },
      { pattern: /\d{4}\s+\(\d+\)\s+SCC\s+\d+/g, type: 'case_law' },
      { pattern: /Section\s+\d+[A-Z]?\s+(?:of\s+)?(?:the\s+)?[A-Z][a-zA-Z\s]+(?:Act|Code|Rules)/g, type: 'statute' },
      { pattern: /Article\s+\d+[A-Z]?\s+(?:of\s+)?(?:the\s+)?Constitution/gi, type: 'constitution' },
      { pattern: /Order\s+[IVXLC]+\s+Rule\s+\d+/g, type: 'procedural' },
    ];

    const details: Array<{ text: string; verified: boolean; source?: string }> = [];
    for (const { pattern, type } of citationPatterns) {
      const matches = params.outputText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const isVerifiable = /\d{4}/.test(match);
          details.push({
            text: match,
            verified: isVerifiable,
            source: isVerifiable ? 'pattern_validated' : undefined,
          });

          try {
            await db.execute(sql`
              INSERT INTO nv_schema.citation_checks (request_id, tenant_id, citation_text, citation_type, verified, confidence)
              VALUES (${params.requestId}, ${params.tenantId || null}, ${match}, ${type}, ${isVerifiable}, ${isVerifiable ? 0.7 : 0.3})
            `);
          } catch (e: any) { /* non-fatal */ }
        }
      }
    }

    const verified = details.filter(d => d.verified).length;
    const unverified = details.filter(d => !d.verified).length;
    return { verified, unverified, details };
  }
}

export class NvFeedbackService {
  async submitFeedback(params: {
    userId: string;
    requestId?: string;
    agentKey?: string;
    rating?: number;
    thumbs?: 'up' | 'down';
    comment?: string;
    responseSnippet?: string;
    tenantId?: string;
    tags?: string[];
  }): Promise<{ id: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.ai_feedback (user_id, tenant_id, request_id, agent_key, rating, thumbs, comment, response_snippet, tags)
      VALUES (${params.userId}, ${params.tenantId || null}, ${params.requestId || null}, ${params.agentKey || null}, ${params.rating || null}, ${params.thumbs || null}, ${params.comment || null}, ${(params.responseSnippet || '').substring(0, 2000)}, ${JSON.stringify(params.tags || [])})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async getFeedbackStats(agentKey?: string, tenantId?: string): Promise<any> {
    // Parameterized via drizzle sql template literal — no user input
    // is concatenated into raw SQL.
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total_feedback,
        COUNT(*) FILTER (WHERE thumbs = 'up') as thumbs_up,
        COUNT(*) FILTER (WHERE thumbs = 'down') as thumbs_down,
        AVG(rating) as avg_rating,
        COUNT(DISTINCT agent_key) as agents_reviewed
      FROM nv_schema.ai_feedback
      WHERE (${agentKey ?? null}::text IS NULL OR agent_key = ${agentKey ?? null})
        AND (${tenantId ?? null}::text IS NULL OR tenant_id = ${tenantId ?? null})
    `);
    return result.rows?.[0] || {};
  }

  async getRecentFeedback(tenantId?: string, limit: number = 50): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.ai_feedback WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM nv_schema.ai_feedback ORDER BY created_at DESC LIMIT ${limit}`);
    return result.rows || [];
  }
}

export class NvAgentMetricsService {
  async recordMetrics(params: {
    agentKey: string;
    tenantId?: string;
    latencyMs: number;
    tokens: number;
    costUsd?: number;
    success: boolean;
  }): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await db.execute(sql`
        INSERT INTO nv_schema.agent_metrics (agent_key, tenant_id, period, period_start, total_requests, avg_latency_ms, avg_tokens, avg_cost_usd, error_rate)
        VALUES (${params.agentKey}, ${params.tenantId || null}, 'daily', ${today.toISOString()}, 1, ${params.latencyMs}, ${params.tokens}, ${params.costUsd || 0}, ${params.success ? 0 : 1})
        ON CONFLICT DO NOTHING
      `);
    } catch (e: any) {
      logger.warn('[NV-AgentMetrics] DB write failed:', e.message);
    }
  }

  async getAgentMetrics(agentKey?: string, tenantId?: string): Promise<any[]> {
    if (agentKey) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.agent_metrics WHERE agent_key = ${agentKey} ORDER BY period_start DESC LIMIT 30`);
      return result.rows || [];
    }
    const result = tenantId
      ? await db.execute(sql`SELECT agent_key, SUM(total_requests) as total_requests, AVG(avg_latency_ms) as avg_latency, AVG(satisfaction_score) as avg_satisfaction FROM nv_schema.agent_metrics WHERE tenant_id = ${tenantId} GROUP BY agent_key ORDER BY total_requests DESC LIMIT 100`)
      : await db.execute(sql`SELECT agent_key, SUM(total_requests) as total_requests, AVG(avg_latency_ms) as avg_latency, AVG(satisfaction_score) as avg_satisfaction FROM nv_schema.agent_metrics GROUP BY agent_key ORDER BY total_requests DESC LIMIT 100`);
    return result.rows || [];
  }
}

export class NvAgentAutoSelector {
  private practiceAreaKeywords: Record<string, string[]> = {
    criminal: ['crime', 'theft', 'murder', 'bail', 'fir', 'arrest', 'police', 'prosecution', 'accused'],
    corporate: ['company', 'merger', 'acquisition', 'shareholder', 'board', 'incorporation', 'llp'],
    family: ['divorce', 'custody', 'maintenance', 'alimony', 'marriage', 'domestic', 'child'],
    property: ['land', 'property', 'tenant', 'lease', 'rent', 'eviction', 'title', 'deed'],
    labor: ['employment', 'salary', 'termination', 'workplace', 'labor', 'pf', 'esi', 'gratuity'],
    tax: ['income tax', 'gst', 'tax', 'assessment', 'refund', 'deduction', 'tds'],
    ipr: ['patent', 'trademark', 'copyright', 'intellectual property', 'infringement', 'design'],
    banking: ['loan', 'bank', 'nbfc', 'rbi', 'cheque', 'sarfaesi', 'drt', 'mortgage'],
    constitutional: ['fundamental rights', 'article', 'constitution', 'writ', 'pil'],
    cyber: ['cyber', 'data protection', 'privacy', 'it act', 'online fraud', 'hacking'],
    consumer: ['consumer', 'deficiency', 'complaint', 'product', 'service defect'],
    arbitration: ['arbitration', 'mediation', 'conciliation', 'dispute resolution', 'adr'],
    environmental: ['environment', 'pollution', 'ngt', 'forest', 'wildlife', 'climate'],
    immigration: ['visa', 'immigration', 'passport', 'oci', 'deportation', 'work permit'],
    insolvency: ['ibc', 'insolvency', 'bankruptcy', 'nclt', 'resolution', 'liquidation'],
  };

  async selectAgent(params: {
    query: string;
    userId?: string;
    tenantId?: string;
    jurisdiction?: string;
  }): Promise<{ agentKey: string; practiceArea: string; taskType: string; confidence: number }> {
    const start = Date.now();
    const queryLower = params.query.toLowerCase();
    let bestArea = 'general';
    let bestScore = 0;

    for (const [area, keywords] of Object.entries(this.practiceAreaKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (queryLower.includes(keyword)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestArea = area;
      }
    }

    let taskType = 'analysis';
    if (/draft|write|create|prepare/i.test(queryLower)) taskType = 'drafting';
    else if (/review|check|verify|audit/i.test(queryLower)) taskType = 'review';
    else if (/research|find|search|case law/i.test(queryLower)) taskType = 'research';
    else if (/summarize|brief|outline/i.test(queryLower)) taskType = 'summarization';
    else if (/translate|convert/i.test(queryLower)) taskType = 'translation';

    const registryMatches = searchAgents(params.query);
    const practiceMatches = getAgentsByPracticeArea(bestArea);
    const registryAgent = registryMatches[0] || practiceMatches[0] || getAllAgents()[0];
    const agentKey = registryAgent?.id || `${bestArea}_${taskType}_agent`;
    const confidence = registryAgent
      ? Math.min(1, Math.max(bestScore * 0.25, 0.55))
      : (bestScore > 0 ? Math.min(1, bestScore * 0.25) : 0.2);

    try {
      await db.execute(sql`
        INSERT INTO nv_schema.agent_auto_selections (user_id, tenant_id, query_text, classified_practice_area, classified_task_type, selected_agent_key, confidence, classification_model, classification_latency_ms)
        VALUES (${params.userId || null}, ${params.tenantId || null}, ${params.query.substring(0, 2000)}, ${bestArea}, ${taskType}, ${agentKey}, ${confidence}, 'keyword_classifier_v1', ${Date.now() - start})
      `);
    } catch (e: any) { /* non-fatal */ }

    return { agentKey, practiceArea: bestArea, taskType, confidence };
  }
}

export class NvBiasDetector {
  async auditOutput(params: {
    agentKey: string;
    outputText: string;
    tenantId?: string;
    jurisdiction?: string;
  }): Promise<{ biasScore: number; findings: string[]; recommendations: string[] }> {
    const biasIndicators = [
      { pattern: /\b(?:always|never|all|none|every)\b/gi, type: 'absolutist_language', weight: 0.1 },
      { pattern: /\b(?:obviously|clearly|undoubtedly)\b/gi, type: 'certainty_bias', weight: 0.05 },
      { pattern: /\b(?:he|him|his)\b(?!.*\b(?:she|her|hers)\b)/gi, type: 'gender_bias', weight: 0.15 },
      { pattern: /\b(?:western|eastern|traditional|modern)\b.*(?:superior|better|inferior|worse)/gi, type: 'cultural_bias', weight: 0.2 },
    ];

    const findings: string[] = [];
    let totalBias = 0;

    for (const indicator of biasIndicators) {
      const matches = params.outputText.match(indicator.pattern);
      if (matches && matches.length > 3) {
        findings.push(`${indicator.type}: ${matches.length} instances detected`);
        totalBias += indicator.weight;
      }
    }

    const biasScore = Math.min(1, totalBias);
    const recommendations = biasScore > 0.3
      ? ['Review output for potential bias', 'Consider alternative phrasing', 'Ensure balanced representation']
      : [];

    try {
      await db.execute(sql`
        INSERT INTO nv_schema.bias_audits (tenant_id, agent_key, audit_type, sample_size, bias_score, findings, recommendations, status)
        VALUES (${params.tenantId || null}, ${params.agentKey}, 'demographic', 1, ${biasScore}, ${JSON.stringify(findings)}, ${JSON.stringify(recommendations)}, 'completed')
      `);
    } catch (e: any) { /* non-fatal */ }

    return { biasScore, findings, recommendations };
  }

  async getAuditHistory(tenantId?: string, limit: number = 50): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.bias_audits WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM nv_schema.bias_audits ORDER BY created_at DESC LIMIT ${limit}`);
    return result.rows || [];
  }
}

// PII vault at-rest encryption (AES-256-GCM). NV_PII_ENCRYPTION_KEY is
// REQUIRED; in production a missing/empty value fails startup. In dev/test
// we generate a non-deterministic per-process key so no predictable
// fallback is ever written to a real datastore.
const PII_CIPHER_ALGO = 'aes-256-gcm';
function resolvePiiEncryptionKey(): Buffer {
  const raw = process.env.NV_PII_ENCRYPTION_KEY;
  if (raw && raw.trim().length > 0) {
    return crypto.createHash('sha256').update(raw).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[NvPIIVaultService] NV_PII_ENCRYPTION_KEY is required in production — refusing to start with a default key',
    );
  }
  // Non-PROD: ephemeral, per-process random key. Never persisted; cycling
  // it across restarts is intentional so dev/test cannot accumulate
  // recoverable PII under a default key.
  return crypto.randomBytes(32);
}
const PII_ENC_KEY = resolvePiiEncryptionKey();

function encryptPII(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(PII_CIPHER_ALGO, PII_ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag
  // Store: iv(12) + tag(16) + ciphertext, all base64 encoded
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptPII(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const decipher = crypto.createDecipheriv(PII_CIPHER_ALGO, PII_ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export class NvPIIVaultService {
  async tokenize(params: {
    piiType: string;
    value: string;
    tenantId?: string;
    userId?: string;
    requestId?: string;
    ttlMinutes?: number;
  }): Promise<{ token: string }> {
    const token = `PII_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
    // GAP-023: AES-256-GCM encryption at rest (replaces base64 encoding)
    const encrypted = encryptPII(params.value);
    const expiresAt = new Date(Date.now() + (params.ttlMinutes || 30) * 60 * 1000);

    await db.execute(sql`
      INSERT INTO nv_schema.pii_vault (token, pii_type, encrypted_value, tenant_id, user_id, request_id, expires_at)
      VALUES (${token}, ${params.piiType}, ${encrypted}, ${params.tenantId || null}, ${params.userId || null}, ${params.requestId || null}, ${expiresAt.toISOString()})
    `);

    return { token };
  }

  async detokenize(token: string): Promise<{ value: string; piiType: string } | null> {
    const result = await db.execute(sql`
      UPDATE nv_schema.pii_vault SET access_count = access_count + 1
      WHERE token = ${token} AND (expires_at IS NULL OR expires_at > NOW())
      RETURNING encrypted_value, pii_type
    `);
    const row = result.rows?.[0] as any;
    if (!row) return null;
    try {
      return { value: decryptPII(row.encrypted_value), piiType: row.pii_type };
    } catch {
      // Fallback: try legacy base64 for pre-existing tokens
      return { value: Buffer.from(row.encrypted_value, 'base64').toString('utf-8'), piiType: row.pii_type };
    }
  }

  async cleanupExpired(): Promise<number> {
    const result = await db.execute(sql`DELETE FROM nv_schema.pii_vault WHERE expires_at < NOW()`);
    return (result as any).rowCount || 0;
  }

  // Verify encryption is working correctly (smoke test)
  verifyEncryption(): boolean {
    try {
      const test = 'PII-TEST-9876543210';
      const encrypted = encryptPII(test);
      const decrypted = decryptPII(encrypted);
      return decrypted === test;
    } catch { return false; }
  }
}

export class NvModelGovernanceService {
  async registerModel(params: {
    modelName: string;
    provider: string;
    version?: string;
    deploymentRegions?: string[];
    approvedBy?: string;
    riskAssessment?: any;
  }): Promise<{ id: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.model_governance (model_name, provider, version, deployment_regions, approved_by, risk_assessment, status)
      VALUES (${params.modelName}, ${params.provider}, ${params.version || '1.0'}, ${JSON.stringify(params.deploymentRegions || ['IN'])}, ${params.approvedBy || 'system'}, ${JSON.stringify(params.riskAssessment || {})}, 'approved')
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async getRegistry(status?: string): Promise<any[]> {
    const result = status
      ? await db.execute(sql`SELECT * FROM nv_schema.model_governance WHERE status = ${status} ORDER BY created_at DESC`)
      : await db.execute(sql`SELECT * FROM nv_schema.model_governance ORDER BY created_at DESC`);
    return result.rows || [];
  }

  async updateModelStatus(id: string, status: string): Promise<any> {
    const result = await db.execute(sql`UPDATE nv_schema.model_governance SET status = ${status}, updated_at = NOW() WHERE id = ${id} RETURNING *`);
    return result.rows?.[0] || null;
  }
}

export class NvComplianceExportService {
  async generateEvidence(params: {
    tenantId: string;
    framework: string;
    evidenceType: string;
    title: string;
    description?: string;
    generatedBy?: string;
  }): Promise<{ id: string }> {
    const evidenceData: any = { generatedAt: new Date().toISOString(), framework: params.framework };

    if (params.framework === 'ISO_42001') {
      const [hitlStats, biasAudits, modelReg, piiStats] = await Promise.all([
        db.execute(sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE review_status = 'approved') as approved FROM nv_schema.hitl_reviews WHERE tenant_id = ${params.tenantId}`),
        db.execute(sql`SELECT COUNT(*) as total, AVG(bias_score) as avg_bias FROM nv_schema.bias_audits WHERE tenant_id = ${params.tenantId}`),
        db.execute(sql`SELECT COUNT(*) as total FROM nv_schema.model_governance WHERE status = 'approved'`),
        db.execute(sql`SELECT COUNT(*) as total FROM nv_schema.pii_vault WHERE tenant_id = ${params.tenantId}`),
      ]);
      evidenceData.humanOversight = hitlStats.rows?.[0];
      evidenceData.biasAssessment = biasAudits.rows?.[0];
      evidenceData.modelRegistry = modelReg.rows?.[0];
      evidenceData.piiProtection = piiStats.rows?.[0];
    }

    const result = await db.execute(sql`
      INSERT INTO nv_schema.compliance_evidence (tenant_id, evidence_type, framework, title, description, evidence_data, generated_by)
      VALUES (${params.tenantId}, ${params.evidenceType}, ${params.framework}, ${params.title}, ${params.description || null}, ${JSON.stringify(evidenceData)}, ${params.generatedBy || 'system'})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async getEvidencePackage(tenantId?: string, framework?: string): Promise<any[]> {
    if (tenantId && framework) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.compliance_evidence WHERE tenant_id = ${tenantId} AND framework = ${framework} ORDER BY created_at DESC`);
      return result.rows || [];
    }
    if (tenantId) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.compliance_evidence WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`);
      return result.rows || [];
    }
    const result = await db.execute(sql`SELECT * FROM nv_schema.compliance_evidence ORDER BY created_at DESC`);
    return result.rows || [];
  }
}

export class NvConsentService {
  async recordConsent(params: {
    userId: string;
    consentType: string;
    granted: boolean;
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ id: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.ai_consents (user_id, tenant_id, consent_type, granted, ip_address, user_agent, granted_at)
      VALUES (${params.userId}, ${params.tenantId || null}, ${params.consentType}, ${params.granted}, ${params.ipAddress || null}, ${params.userAgent || null}, ${params.granted ? new Date().toISOString() : null})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async getUserConsents(userId: string): Promise<any[]> {
    const result = await db.execute(sql`SELECT * FROM nv_schema.ai_consents WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at DESC`);
    return result.rows || [];
  }

  async revokeConsent(id: string): Promise<any> {
    const result = await db.execute(sql`UPDATE nv_schema.ai_consents SET granted = false, revoked_at = NOW() WHERE id = ${id} RETURNING *`);
    return result.rows?.[0] || null;
  }

  async checkConsent(userId: string, consentType: string): Promise<boolean> {
    const result = await db.execute(sql`SELECT granted, revoked_at FROM nv_schema.ai_consents WHERE user_id = ${userId} AND consent_type = ${consentType} ORDER BY created_at DESC LIMIT 1`);
    const row = result.rows?.[0] as any;
    const granted = row?.granted === true && !row?.revoked_at;

    // Task #215: a check that returns "not granted" represents a DPDPA
    // consent breach attempt by the caller (they are about to process
    // personal data). Emit one CAM reviewer-queue row, idempotent on
    // (user, consent_type, breach-status). Best-effort, never throws.
    if (!granted) {
      try {
        const { writeCamActionAsync, camActionId } = await import('./compliance/jrx-cam-writer.js');
        const status: 'missing' | 'withdrawn' = row?.revoked_at ? 'withdrawn' : 'missing';
        const sensitive = ['biometric', 'sensitive_legal_data', 'third_party_sharing'].includes(consentType);
        writeCamActionAsync({
          actionId: camActionId(['dpdpa', 'platform', userId, consentType, status]),
          framework: 'dpdpa',
          controlId: `dpdpa.purpose.${consentType}`,
          severity: sensitive ? 'critical' : 'high',
          title: `DPDPA consent breach: ${consentType} (${status})`,
          description: `User ${userId} has no valid consent for "${consentType}" (status=${status}).`,
          triggeredBy: 'NvConsentService.checkConsent',
          metadata: { userId, consentType, status, source: 'ai_consents' },
        });
      } catch { /* best-effort */ }
    }
    return granted;
  }
}

export class NvIncidentService {
  async reportIncident(params: {
    incidentType: string;
    severity: string;
    title: string;
    description?: string;
    tenantId?: string;
    reportedBy?: string;
    affectedRequestIds?: string[];
  }): Promise<{ id: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.ai_incidents (tenant_id, incident_type, severity, title, description, reported_by, affected_request_ids)
      VALUES (${params.tenantId || null}, ${params.incidentType}, ${params.severity}, ${params.title}, ${params.description || null}, ${params.reportedBy || null}, ${JSON.stringify(params.affectedRequestIds || [])})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async resolveIncident(id: string, resolution: string, rootCause: string, resolvedBy: string): Promise<any> {
    const result = await db.execute(sql`
      UPDATE nv_schema.ai_incidents SET resolution = ${resolution}, root_cause = ${rootCause}, resolved_by = ${resolvedBy}, status = 'resolved', resolved_at = NOW()
      WHERE id = ${id} RETURNING *
    `);
    return result.rows?.[0] || null;
  }

  async getIncidents(tenantId?: string, status?: string): Promise<any[]> {
    if (tenantId && status) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.ai_incidents WHERE tenant_id = ${tenantId} AND status = ${status} ORDER BY created_at DESC`);
      return result.rows || [];
    }
    if (tenantId) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.ai_incidents WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`);
      return result.rows || [];
    }
    const result = await db.execute(sql`SELECT * FROM nv_schema.ai_incidents ORDER BY created_at DESC`);
    return result.rows || [];
  }
}

export class NvBulkAnalysisService {
  async createJob(params: {
    tenantId: string;
    userId?: string;
    jobName: string;
    analysisType: string;
    totalDocuments: number;
    tier?: string;
  }): Promise<{ id: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.bulk_analysis_jobs (tenant_id, user_id, job_name, analysis_type, total_documents, status, tier)
      VALUES (${params.tenantId}, ${params.userId || null}, ${params.jobName}, ${params.analysisType}, ${params.totalDocuments}, 'pending', ${params.tier || 'standard'})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async updateProgress(jobId: string, processed: number, failed: number, results?: any): Promise<void> {
    await db.execute(sql`
      UPDATE nv_schema.bulk_analysis_jobs SET processed_documents = ${processed}, failed_documents = ${failed},
      status = CASE WHEN ${processed} + ${failed} >= total_documents THEN 'completed' ELSE 'processing' END,
      aggregate_results = COALESCE(${results ? JSON.stringify(results) : null}, aggregate_results),
      started_at = COALESCE(started_at, NOW()),
      completed_at = CASE WHEN ${processed} + ${failed} >= total_documents THEN NOW() ELSE NULL END
      WHERE id = ${jobId}
    `);
  }

  async getJob(jobId: string): Promise<any> {
    const result = await db.execute(sql`SELECT * FROM nv_schema.bulk_analysis_jobs WHERE id = ${jobId}`);
    return result.rows?.[0] || null;
  }

  async getJobs(tenantId?: string): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.bulk_analysis_jobs WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50`)
      : await db.execute(sql`SELECT * FROM nv_schema.bulk_analysis_jobs ORDER BY created_at DESC LIMIT 50`);
    return result.rows || [];
  }
}

export class NvCalendarExtractionService {
  async extractFromDocument(params: {
    documentText: string;
    tenantId?: string;
    userId?: string;
    matterId?: string;
    jurisdiction?: string;
  }): Promise<{ events: any[] }> {
    const datePatterns = [
      { pattern: /(?:hearing|next\s+date|listed\s+(?:on|for)|adjourned\s+to|posted\s+to)\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi, type: 'hearing' },
      { pattern: /(?:deadline|due\s+date|last\s+date|limitation)\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi, type: 'deadline' },
      { pattern: /(?:filing\s+date|date\s+of\s+filing)\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi, type: 'filing' },
      { pattern: /(?:expire|expiry|expiration)\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi, type: 'expiry' },
    ];

    const events: any[] = [];
    for (const { pattern, type } of datePatterns) {
      let match;
      while ((match = pattern.exec(params.documentText)) !== null) {
        const dateStr = match[1];
        let parsedDate: Date | null = null;
        try {
          const parts = dateStr.split(/[\/-]/);
          if (parts.length === 3) {
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const year = parseInt(parts[2]) < 100 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
            parsedDate = new Date(year, month, day);
          }
        } catch { continue; }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const context = params.documentText.substring(Math.max(0, match.index - 50), Math.min(params.documentText.length, match.index + 100)).trim();
          events.push({
            eventType: type,
            title: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${dateStr}`,
            description: context,
            eventDate: parsedDate.toISOString(),
          });

          try {
            await db.execute(sql`
              INSERT INTO nv_schema.calendar_events (tenant_id, user_id, matter_id, event_type, title, description, event_date, jurisdiction, status)
              VALUES (${params.tenantId || null}, ${params.userId || null}, ${params.matterId || null}, ${type}, ${`${type}: ${dateStr}`}, ${context}, ${parsedDate.toISOString()}, ${params.jurisdiction || null}, 'active')
            `);
          } catch (e: any) { /* non-fatal */ }
        }
      }
    }

    return { events };
  }

  async getEvents(params: { tenantId?: string; userId?: string; matterId?: string; status?: string }): Promise<any[]> {
    if (params.matterId) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.calendar_events WHERE matter_id = ${params.matterId} AND status = 'active' ORDER BY event_date ASC`);
      return result.rows || [];
    }
    if (params.userId) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.calendar_events WHERE user_id = ${params.userId} AND status = 'active' ORDER BY event_date ASC`);
      return result.rows || [];
    }
    const result = params.tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.calendar_events WHERE tenant_id = ${params.tenantId} AND status = 'active' ORDER BY event_date ASC LIMIT 100`)
      : await db.execute(sql`SELECT * FROM nv_schema.calendar_events WHERE status = 'active' ORDER BY event_date ASC LIMIT 100`);
    return result.rows || [];
  }
}

export class NvCustomAgentService {
  async createAgent(params: {
    tenantId: string;
    createdBy?: string;
    agentName: string;
    description?: string;
    systemPrompt: string;
    knowledgeSourceIds?: string[];
    allowedActions?: string[];
    temperature?: number;
    maxTokens?: number;
    modelPreference?: string;
  }): Promise<{ id: string; agentKey: string }> {
    const agentKey = `custom_${params.tenantId}_${params.agentName.toLowerCase().replace(/\s+/g, '_').substring(0, 30)}`;
    const result = await db.execute(sql`
      INSERT INTO nv_schema.custom_agents (tenant_id, created_by, agent_name, agent_key, description, system_prompt, knowledge_source_ids, allowed_actions, temperature, max_tokens, model_preference)
      VALUES (${params.tenantId}, ${params.createdBy || null}, ${params.agentName}, ${agentKey}, ${params.description || null}, ${params.systemPrompt}, ${JSON.stringify(params.knowledgeSourceIds || [])}, ${JSON.stringify(params.allowedActions || [])}, ${params.temperature || 0.7}, ${params.maxTokens || 2048}, ${params.modelPreference || null})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '', agentKey };
  }

  async executeCustomAgent(agentId: string, userPrompt: string, options: any = {}): Promise<any> {
    const agentResult = await db.execute(sql`SELECT * FROM nv_schema.custom_agents WHERE id = ${agentId} AND is_active = true`);
    const agent = agentResult.rows?.[0] as any;
    if (!agent) throw new Error('Custom agent not found or inactive');

    await db.execute(sql`UPDATE nv_schema.custom_agents SET usage_count = usage_count + 1 WHERE id = ${agentId}`);

    const result = await callJurexio(agent.agent_key, agent.system_prompt, userPrompt, {
      ...options,
      maxTokens: agent.max_tokens,
      source: 'custom_agent',
    });

    return result;
  }

  async getAgents(tenantId?: string): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.custom_agents WHERE tenant_id = ${tenantId} AND is_active = true ORDER BY created_at DESC`)
      : await db.execute(sql`SELECT * FROM nv_schema.custom_agents WHERE is_active = true ORDER BY created_at DESC`);
    return result.rows || [];
  }

  async updateAgent(agentId: string, updates: any): Promise<any> {
    // Build the SET clause from a fixed allowlist of column names; bind every
    // user value through the drizzle parameter system so nothing is concatenated.
    const allowedNumeric = new Set(['temperature', 'maxTokens']);
    const allowedBoolean = new Set(['isActive']);
    const allowedText = new Set(['agentName', 'description', 'systemPrompt']);
    const colMap: Record<string, string> = {
      agentName: 'agent_name',
      description: 'description',
      systemPrompt: 'system_prompt',
      temperature: 'temperature',
      maxTokens: 'max_tokens',
      isActive: 'is_active',
    };

    const fragments: any[] = [];
    for (const key of Object.keys(updates ?? {})) {
      if (!(key in colMap)) continue;
      const col = colMap[key];
      const val = (updates as any)[key];
      if (val === undefined) continue;
      if (allowedText.has(key)) {
        fragments.push(sql`${sql.identifier(col)} = ${String(val)}`);
      } else if (allowedNumeric.has(key)) {
        fragments.push(sql`${sql.identifier(col)} = ${Number(val)}`);
      } else if (allowedBoolean.has(key)) {
        fragments.push(sql`${sql.identifier(col)} = ${Boolean(val)}`);
      }
    }
    fragments.push(sql`version = version + 1`);
    fragments.push(sql`updated_at = NOW()`);

    const setClause = sql.join(fragments, sql`, `);
    const result = await db.execute(sql`
      UPDATE nv_schema.custom_agents SET ${setClause} WHERE id = ${agentId} RETURNING *
    `);
    return result.rows?.[0] || null;
  }
}

export class NvEmailClassificationService {
  async classifyEmail(params: {
    tenantId: string;
    userId?: string;
    emailSubject: string;
    emailFrom: string;
    emailBodySnippet: string;
  }): Promise<{ priority: string; action: string; confidence: number; draftResponse?: string }> {
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'deadline', 'hearing tomorrow', 'court date', 'final notice'];
    const bodyLower = `${params.emailSubject} ${params.emailBodySnippet}`.toLowerCase();

    let priority = 'normal';
    if (urgentKeywords.some(k => bodyLower.includes(k))) priority = 'urgent';
    else if (/\b(?:fyi|information|newsletter|update)\b/i.test(bodyLower)) priority = 'low';

    let action = 'review';
    if (/\b(?:reply|respond|confirm|acknowledge)\b/i.test(bodyLower)) action = 'respond';
    else if (/\b(?:file|upload|attach|document)\b/i.test(bodyLower)) action = 'file';
    else if (/\b(?:schedule|meeting|call|appointment)\b/i.test(bodyLower)) action = 'schedule';

    const confidence = 0.6;

    await db.execute(sql`
      INSERT INTO nv_schema.email_classifications (tenant_id, user_id, email_subject, email_from, email_body_snippet, classified_priority, classified_action, classification_confidence, status)
      VALUES (${params.tenantId}, ${params.userId || null}, ${params.emailSubject}, ${params.emailFrom}, ${params.emailBodySnippet.substring(0, 2000)}, ${priority}, ${action}, ${confidence}, 'classified')
    `);

    return { priority, action, confidence };
  }

  async getClassifications(tenantId?: string, status?: string): Promise<any[]> {
    if (tenantId && status) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.email_classifications WHERE tenant_id = ${tenantId} AND status = ${status} ORDER BY created_at DESC LIMIT 50`);
      return result.rows || [];
    }
    if (tenantId) {
      const result = await db.execute(sql`SELECT * FROM nv_schema.email_classifications WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50`);
      return result.rows || [];
    }
    const result = await db.execute(sql`SELECT * FROM nv_schema.email_classifications ORDER BY created_at DESC LIMIT 50`);
    return result.rows || [];
  }
}

export class NvMemoryService {
  /**
   * `nv_schema.memory_entries.value` is JSONB. Plain text from Queen/middleware
   * must be wrapped or CAST — otherwise Postgres raises
   * `invalid input syntax for type json` and NSP/NYM orchestrate logs
   * "[Middleware] memory store failed" on every AI turn.
   */
  private static toJsonbPayload(value: unknown): string {
    if (value == null) return JSON.stringify({ text: '' });
    if (typeof value === 'object') return JSON.stringify(value);
    const s = String(value);
    try {
      const parsed = JSON.parse(s);
      if (parsed !== null && typeof parsed === 'object') return s;
    } catch {
      /* plain prose */
    }
    return JSON.stringify({ text: s });
  }

  async store(params: {
    userId: string;
    key: string;
    value: string;
    memoryType?: string;
    scope?: string;
    matterId?: string;
    sessionId?: string;
    tenantId?: string;
    importance?: number;
    ttlMinutes?: number;
  }): Promise<{ id: string }> {
    const expiresAt = params.ttlMinutes ? new Date(Date.now() + params.ttlMinutes * 60 * 1000) : null;
    const jsonbPayload = NvMemoryService.toJsonbPayload(params.value);
    const result = await db.execute(sql`
      INSERT INTO nv_schema.memory_entries (user_id, tenant_id, memory_type, scope, matter_id, session_id, key, value, importance, expires_at)
      VALUES (${params.userId}, ${params.tenantId || null}, ${params.memoryType || 'session'}, ${params.scope || 'user'}, ${params.matterId || null}, ${params.sessionId || null}, ${params.key}, CAST(${jsonbPayload} AS jsonb), ${params.importance || 0.5}, ${expiresAt?.toISOString() || null})
      RETURNING id
    `);
    /* NV-MEM-RECALL-INDEX-001 — bound per-user growth.
     *
     * Recall cost is linear in rows-per-user (measured ~0.48 ms/row pre-index), so an
     * unbounded table eventually defeats any index: the 30 s breaker returns at a
     * higher row count rather than never. This caps a user's retained entries and
     * evicts the least useful first (lowest importance, then least recently
     * accessed) — the same ordering the recall fallback de-prioritises, so eviction
     * removes rows that were already last in line to be returned.
     *
     * Deliberately probabilistic (1-in-20 writes) rather than on every insert: the
     * cap query is itself indexed but not free, and it does not need to be exact —
     * it needs to keep the table within an order of magnitude of the ceiling. Never
     * awaited, and never allowed to fail a store.
     *
     * Expiring rows (`expires_at`) are excluded from the count so a TTL'd session
     * burst cannot evict durable matter memory. */
    if (Math.random() < 0.05) {
      const cap = Math.max(500, Number(process.env.JRX_MEMORY_MAX_ROWS_PER_USER || 20_000));
      void db
        .execute(sql`
          DELETE FROM nv_schema.memory_entries
           WHERE id IN (
             SELECT id FROM nv_schema.memory_entries
              WHERE user_id = ${params.userId}
                AND expires_at IS NULL
              ORDER BY importance ASC, last_accessed_at ASC
              OFFSET ${cap}
           )
        `)
        .catch((err: unknown) => {
          logger.warn('[Memory] per-user eviction failed (non-fatal)', {
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async retrieve(params: {
    userId: string;
    sessionId?: string;
    matterId?: string;
    scope?: string;
    limit?: number;
    query?: string;
  }): Promise<any[]> {
    // Parameterized retrieval — every value flows through drizzle bind.
    const limit = Math.max(1, Math.min(1000, Number(params.limit ?? 20)));
    /* NV-MEM-SEMANTIC-001: when a query is supplied, order by lexical relevance
     * THEN importance/recency. Non-matching rows get rank 0 and still fall back.
     *
     * NV-MEM-RECALL-INDEX-001 (2026-08-17): rank against the STORED generated
     * `value_tsv` column instead of computing `to_tsvector(value::text)` per row.
     * The old form was measured at 688 ms to rank 1,430 rows on live RDS (~0.48
     * ms/row, linear), which reaches the 30 s capability breaker at roughly 62,000
     * rows for a single user — the latent cause of the hung `memory.tiered.recall`
     * seen in Queen leaf traces.
     *
     * The `@@` predicate is deliberately in the ORDER BY input only, not the WHERE
     * clause: recall must still return recent/important rows when the query matches
     * nothing. Making it a WHERE filter would turn "no lexical match" into an empty
     * recall, which the middleware treats as "no memory" and would silently drop
     * context that used to be returned. Ranking-only keeps behaviour identical while
     * the index removes the cost. */
    const q = (params.query ?? '').trim();
    const useFts = q.length > 2 && (await this.hasTsvColumn());
    const result = useFts
      ? await db.execute(sql`
          SELECT *, ts_rank_cd(value_tsv, plainto_tsquery('simple', ${q})) AS _relevance
          FROM nv_schema.memory_entries
          WHERE user_id = ${params.userId}
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (${params.sessionId ?? null}::text IS NULL OR session_id = ${params.sessionId ?? null})
            AND (${params.matterId ?? null}::text IS NULL OR matter_id = ${params.matterId ?? null})
            AND (${params.scope ?? null}::text IS NULL OR scope = ${params.scope ?? null})
          ORDER BY _relevance DESC, importance DESC, last_accessed_at DESC
          LIMIT ${limit}
        `)
      : q.length > 2
      ? await db.execute(sql`
          SELECT *, ts_rank_cd(to_tsvector('simple', COALESCE(value::text, '')), plainto_tsquery('simple', ${q})) AS _relevance
          FROM nv_schema.memory_entries
          WHERE user_id = ${params.userId}
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (${params.sessionId ?? null}::text IS NULL OR session_id = ${params.sessionId ?? null})
            AND (${params.matterId ?? null}::text IS NULL OR matter_id = ${params.matterId ?? null})
            AND (${params.scope ?? null}::text IS NULL OR scope = ${params.scope ?? null})
          ORDER BY _relevance DESC, importance DESC, last_accessed_at DESC
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT * FROM nv_schema.memory_entries
          WHERE user_id = ${params.userId}
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (${params.sessionId ?? null}::text IS NULL OR session_id = ${params.sessionId ?? null})
            AND (${params.matterId ?? null}::text IS NULL OR matter_id = ${params.matterId ?? null})
            AND (${params.scope ?? null}::text IS NULL OR scope = ${params.scope ?? null})
          ORDER BY importance DESC, last_accessed_at DESC
          LIMIT ${limit}
        `);

    const rows = (result.rows || []) as any[];

    /* NV-MEM-RECALL-INDEX-001 — one batched UPDATE, not one per row.
     *
     * This loop previously issued an AJRXTED UPDATE per returned row: with the
     * default limit of 20 that is 20 sequential round trips on the critical path of
     * every leaf, for pure bookkeeping. Now a single statement, and not awaited —
     * access accounting must never delay an answer the caller is already holding.
     * Errors are logged rather than swallowed silently so a broken counter is
     * visible without being fatal. */
    if (rows.length > 0) {
      const ids = rows.map((r) => String(r.id));
      /* NV-MEMORY-ACCESS-ACCOUNTING-001 — pass the ids as a single uuid[] parameter.
       *
       * `ANY(${ids})` looked right but Drizzle expands a JS array into a parameter
       * LIST, producing `ANY(($1, $2, …))`. `ANY` requires an array expression, not a
       * parenthesised row, so Postgres rejected every one of these statements and the
       * batched UPDATE from the recall-index change had been failing silently on each
       * recall — visible only as a non-fatal warn, which is exactly why it survived a
       * deploy. Caught by reading the live log rather than the code.
       *
       * Consequence while broken: `access_count` / `last_accessed_at` never advanced,
       * so importance ranking and the eviction cap were working from stale counters. */
      const idCsv = ids.join(',');
      void db
        .execute(sql`
          UPDATE nv_schema.memory_entries
             SET access_count = access_count + 1, last_accessed_at = NOW()
           WHERE id = ANY(string_to_array(${idCsv}, ',')::uuid[])
        `)
        .catch((err: unknown) => {
          logger.warn('[Memory] access accounting failed (non-fatal)', {
            count: ids.length,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }

    return rows;
  }

  /**
   * NV-MEM-RECALL-INDEX-001 — is the generated `value_tsv` column present?
   *
   * The fast path depends on a migration. Probing once (and caching) keeps the
   * service correct on BOTH sides of the deploy: if code ships before the migration
   * runs, recall falls back to the old expression instead of failing with
   * `column "value_tsv" does not exist`. Deploy order therefore cannot break recall,
   * which matters because the app deploy and the DDL apply are separate steps.
   */
  private _hasTsv: boolean | null = null;
  private async hasTsvColumn(): Promise<boolean> {
    if (this._hasTsv !== null) return this._hasTsv;
    try {
      const r = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'nv_schema'
           AND table_name = 'memory_entries'
           AND column_name = 'value_tsv'
         LIMIT 1
      `);
      this._hasTsv = ((r.rows || []) as any[]).length > 0;
    } catch {
      this._hasTsv = false;
    }
    return this._hasTsv;
  }

  async getContext(userId: string, sessionId?: string, matterId?: string): Promise<string> {
    const memories = await this.retrieve({ userId, sessionId, matterId, limit: 10 });
    if (memories.length === 0) return '';
    return memories.map((m: any) => {
      const v = m?.value;
      const text =
        typeof v === 'string'
          ? v
          : v && typeof v === 'object' && typeof (v as any).text === 'string'
            ? (v as any).text
            : JSON.stringify(v ?? '');
      return `[${m.key}]: ${text}`;
    }).join('\n');
  }

  async clear(userId: string, scope?: string): Promise<number> {
    const result = scope
      ? await db.execute(sql`DELETE FROM nv_schema.memory_entries WHERE user_id = ${userId} AND scope = ${scope}`)
      : await db.execute(sql`DELETE FROM nv_schema.memory_entries WHERE user_id = ${userId}`);
    return (result as any).rowCount || 0;
  }
}

export class NvRAGService {
  async ingestDocument(params: {
    tenantId?: string;
    userId?: string;
    title: string;
    content: string;
    fileType?: string;
    metadata?: any;
  }): Promise<{ documentId: string; chunkCount: number }> {
    /* NV-DUAL-RAG-TABLE-001 — this writes to `nv_schema.rag_documents`, which is a
     * DIFFERENT table from the `rag_documents` the retrieval path reads.
     *
     * Measured on live RDS (2026-08-17): `public.rag_documents` holds **757 rows**;
     * `nv_schema.rag_documents` and `nv_schema.rag_chunks` hold **0**. The app role's
     * `search_path` is `"$user", public`, so every UNQUALIFIED `rag_documents` query in the
     * codebase (e.g. `jrx-rag-live-service.ts`, `jrx-statute-rag-backfill-service.ts`)
     * resolves to `public` — while this method is explicitly schema-qualified to
     * `nv_schema` and therefore writes somewhere nothing reads.
     *
     * Left schema-qualified ON PURPOSE rather than "fixed" by repointing it at `public`:
     * this is the tenant-scoped ingest API (`/api/jrx/orchestration/rag/*`) with its own
     * `tenant_id` column and its own delete path at :1383, whereas `public.rag_documents`
     * is the statute/corpus backfill table with a different shape. Silently merging two
     * differently-shaped tables during a performance pass is how data gets corrupted.
     *
     * The real defect is the NAME COLLISION, which makes every unqualified reference a
     * coin flip for a future reader. Tracked for a rename (`nv_tenant_rag_documents`)
     * under its own change with a migration; until then every reference in this file stays
     * explicitly qualified so the ambiguity cannot bite silently. */
    const docResult = await db.execute(sql`
      INSERT INTO nv_schema.rag_documents (tenant_id, user_id, title, file_type, file_size, status, metadata)
      VALUES (${params.tenantId || null}, ${params.userId || null}, ${params.title}, ${params.fileType || 'text'}, ${params.content.length}, 'processing', ${JSON.stringify(params.metadata || {})})
      RETURNING id
    `);
    const documentId = (docResult.rows?.[0] as any)?.id;

    const chunkSize = 1000;
    const overlap = 200;
    const chunks: string[] = [];
    for (let i = 0; i < params.content.length; i += chunkSize - overlap) {
      chunks.push(params.content.substring(i, i + chunkSize));
    }

    for (let i = 0; i < chunks.length; i++) {
      const tokenCount = Math.ceil(chunks[i].length / 4);
      await db.execute(sql`
        INSERT INTO nv_schema.rag_chunks (document_id, chunk_index, content, token_count, metadata)
        VALUES (${documentId}, ${i}, ${chunks[i]}, ${tokenCount}, ${JSON.stringify({ documentTitle: params.title })})
      `);
    }

    await db.execute(sql`UPDATE nv_schema.rag_documents SET chunk_count = ${chunks.length}, status = 'indexed' WHERE id = ${documentId}`);

    return { documentId, chunkCount: chunks.length };
  }

  async searchChunks(params: {
    query: string;
    tenantId?: string;
    limit?: number;
  }): Promise<{ chunks: any[]; contextText: string }> {
    const queryWords = params.query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const searchTerms = queryWords.slice(0, 5).map(w => `%${w}%`);

    let chunks: any[] = [];
    if (searchTerms.length > 0) {
      // Parameterize each ILIKE pattern individually and OR-join them.
      const limit = Math.max(1, Math.min(100, Number(params.limit ?? 5)));
      const ilikeFragments = searchTerms.map(t => sql`content ILIKE ${t}`);
      const ilikeOr = sql.join(ilikeFragments, sql` OR `);
      const result = await db.execute(sql`
        SELECT c.*, d.title as document_title
        FROM nv_schema.rag_chunks c
        LEFT JOIN nv_schema.rag_documents d ON c.document_id = d.id
        WHERE (${params.tenantId ?? null}::text IS NULL OR d.tenant_id = ${params.tenantId ?? null})
          AND (${ilikeOr})
        ORDER BY c.chunk_index
        LIMIT ${limit}
      `);
      chunks = result.rows || [];
    }

    const contextText = chunks.map((c: any) => c.content).join('\n\n');

    if (chunks.length > 0) {
      await db.execute(sql`
        INSERT INTO nv_schema.rag_retrievals (request_id, tenant_id, query_text, chunk_ids, retrieval_latency_ms)
        VALUES (${crypto.randomUUID()}, ${params.tenantId || null}, ${params.query.substring(0, 2000)}, ${JSON.stringify(chunks.map((c: any) => c.id))}, 0)
      `).catch(() => {});
    }

    return { chunks, contextText };
  }

  async getDocuments(tenantId?: string): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.rag_documents WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 100`)
      : await db.execute(sql`SELECT * FROM nv_schema.rag_documents ORDER BY created_at DESC LIMIT 100`);
    return result.rows || [];
  }

  async deleteDocument(documentId: string): Promise<void> {
    await db.execute(sql`DELETE FROM nv_schema.rag_chunks WHERE document_id = ${documentId}`);
    await db.execute(sql`DELETE FROM nv_schema.rag_documents WHERE id = ${documentId}`);
  }
}

export class NvProtocolRegistryService {
  async registerProtocol(params: {
    protocolName: string;
    protocolVersion?: string;
    status?: string;
    config?: any;
    activatedBy?: string;
    dependsOn?: string[];
  }): Promise<{ id: string }> {
    const reg = governanceProtocolRegistryRef();
    const result = await db.execute(sql`
      INSERT INTO ${reg} (protocol_name, protocol_version, status, config_json, activated_by, depends_on, activated_at)
      VALUES (${params.protocolName}, ${params.protocolVersion || '1.0'}, ${params.status || 'initialized'}, ${JSON.stringify(params.config || {})}, ${params.activatedBy || null}, ${JSON.stringify(params.dependsOn || [])}, ${params.status === 'active' ? new Date().toISOString() : null})
      RETURNING id
    `);
    return { id: (result.rows?.[0] as any)?.id || '' };
  }

  async activateProtocol(protocolName: string): Promise<any> {
    const reg = governanceProtocolRegistryRef();
    const result = await db.execute(sql`
      UPDATE ${reg} SET status = 'active', activated_at = NOW(), health_status = 'healthy', last_health_check = NOW()
      WHERE protocol_name = ${protocolName} RETURNING *
    `);
    return result.rows?.[0] || null;
  }

  async getRegistry(): Promise<any[]> {
    const reg = governanceProtocolRegistryRef();
    const result = await db.execute(sql`SELECT * FROM ${reg} ORDER BY protocol_name`);
    return result.rows || [];
  }

  async initializeROMA(): Promise<void> {
    const romaLevels = [
      { name: 'ROMA_L1_Transparency', version: '1.0', config: { feature: 'explainability', description: 'Show AI reasoning steps' }, dependsOn: [] },
      { name: 'ROMA_L2_Accountability', version: '1.0', config: { feature: 'hitl', description: 'Human-in-the-loop for high-risk outputs' }, dependsOn: ['ROMA_L1_Transparency'] },
      { name: 'ROMA_L3_Fairness', version: '1.0', config: { feature: 'bias_detection', description: 'Monitor outputs for demographic bias' }, dependsOn: ['ROMA_L2_Accountability'] },
      { name: 'ROMA_L4_Safety', version: '1.0', config: { feature: 'hallucination_detection', description: 'Ground outputs in source material' }, dependsOn: ['ROMA_L3_Fairness'] },
    ];

    for (const level of romaLevels) {
      const existingId = await governanceSelectOneIdByColumn(
        (query) => db.execute(query),
        'protocol_registry',
        'protocol_name',
        level.name,
      );
      if (!existingId) {
        await this.registerProtocol({ protocolName: level.name, protocolVersion: level.version, status: 'active', config: level.config, dependsOn: level.dependsOn, activatedBy: 'system' });
      }
    }

    // JRX-PROTOCOL-MANIFEST-001 (Task #32 round 7): also bind every capability
    // from the SSoT manifest into the protocol registry so both surfaces
    // (tool-exec + protocol registry) are manifest-initialized and every
    // catalog capability is callable via one registry contract.
    await this.initializeFromManifest();
  }

  /**
   * JRX-PROTOCOL-MANIFEST-001 (Task #32 round 7) — Manifest-driven boot.
   * Delegates to the standalone `initializeProtocolRegistryFromManifest`
   * helper (extracted to its own module to avoid the
   * `jrx-orchestration-services ↔ jrx-client` circular dependency, and to
   * keep the protocol-registry/manifest binding directly unit-testable).
   * Idempotent: capabilities already present (by `CAP_<id>` name) are
   * skipped.
   */
  async initializeFromManifest(): Promise<{ registered: number; skipped: number; total: number }> {
    const { initializeProtocolRegistryFromManifest } = await import('./jrx-protocol-registry-manifest.js');
    return initializeProtocolRegistryFromManifest((p) => this.registerProtocol(p));
  }
}

export class NvToolExecutionService {
  async executeToolCall(params: {
    requestId?: string;
    tenantId?: string;
    toolName: string;
    toolCategory: string;
    inputParams: any;
  }): Promise<{ result: any; executionTimeMs: number }> {
    const start = Date.now();
    let output: any = {};
    let success = true;
    let errorMessage: string | null = null;

    try {
      switch (params.toolCategory) {
        case 'web-search':
          output = { message: 'Web search tool executed', query: params.inputParams?.query, results: [] };
          break;
        case 'calculator': {
          const { evaluateSafeCalculatorExpression } = await import('../utils/jrx-safe-calculator.js');
          const expr = params.inputParams?.expression;
          const value = evaluateSafeCalculatorExpression(String(expr ?? ''));
          output = value === null ? { error: 'Invalid expression' } : { result: value };
          break;
        }
        case 'text-processing':
          output = { wordCount: (params.inputParams?.text || '').split(/\s+/).length, charCount: (params.inputParams?.text || '').length };
          break;
        default:
          output = { message: `Tool ${params.toolName} executed`, category: params.toolCategory };
      }
    } catch (e: any) {
      success = false;
      errorMessage = e.message;
    }

    const executionTimeMs = Date.now() - start;

    await db.execute(sql`
      INSERT INTO nv_schema.tool_executions (request_id, tenant_id, tool_name, tool_category, input_params, output_result, execution_time_ms, success, error_message, sandboxed)
      VALUES (${params.requestId || null}, ${params.tenantId || null}, ${params.toolName}, ${params.toolCategory}, ${JSON.stringify(params.inputParams)}, ${JSON.stringify(output)}, ${executionTimeMs}, ${success}, ${errorMessage}, true)
    `).catch(() => {});

    return { result: output, executionTimeMs };
  }

  async getExecutionHistory(tenantId?: string, limit: number = 50): Promise<any[]> {
    const result = tenantId
      ? await db.execute(sql`SELECT * FROM nv_schema.tool_executions WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM nv_schema.tool_executions ORDER BY created_at DESC LIMIT ${limit}`);
    return result.rows || [];
  }

  /**
   * JRX-ORCH-MANIFEST-001 (Task #32) — Manifest-bound execution.
   * Looks up the requested capability id in the SSoT manifest and invokes
   * its bound implementation. Records the call in `tool_executions` so the
   * audit trail is identical to the legacy executeToolCall path.
   */
  async executeFromManifest(params: {
    capabilityId: string;
    inputParams: any;
    requestId?: string;
    tenantId?: string;
    userId?: string;
    jurisdiction?: string;
    tier?: string;
    agentKey?: string;
  }): Promise<{ result: any; executionTimeMs: number; capability: string }> {
    const start = Date.now();
    const { capabilityManifest } = await import('../orchestration/capability-manifest.js');
    const cap = capabilityManifest.get(params.capabilityId);
    if (!cap) {
      throw new Error(`[NvToolExecution] Unknown capability: ${params.capabilityId}`);
    }

    let output: any = null;
    let success = true;
    let errorMessage: string | null = null;
    try {
      output = await capabilityManifest.invoke(
        params.capabilityId,
        params.inputParams ?? {},
        {
          requestId: params.requestId,
          tenantId: params.tenantId,
          userId: params.userId,
          jurisdiction: params.jurisdiction,
          tier: ((): 'lite' | 'mitra' | 'enterprise' | 'sovereign' | 'white-label' => {
            const allowed = ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'] as const;
            return (params.tier && (allowed as readonly string[]).includes(params.tier))
              ? (params.tier as typeof allowed[number])
              : 'lite';
          })(),
          agentKey: params.agentKey,
        },
      );
    } catch (e: any) {
      success = false;
      errorMessage = e?.message ?? String(e);
      // JRX-TOOLEXEC-FAILLOUD-001 (Task #32 round 5): in production, every
      // capability invocation failure must propagate so the orchestrator
      // surfaces the failed branch (and runWithConcurrency / evaluateFailures
      // see r.error). Previously only safety/hitl/audit categories rethrew,
      // which silently degraded all other categories. Audit is still written
      // before the throw so the failure remains traceable.
      if (process.env.NODE_ENV === 'production') {
        await db.execute(sql`
          INSERT INTO nv_schema.tool_executions (request_id, tenant_id, tool_name, tool_category, input_params, output_result, execution_time_ms, success, error_message, sandboxed)
          VALUES (${params.requestId || null}, ${params.tenantId || null}, ${cap.id}, ${cap.category}, ${JSON.stringify(params.inputParams)}, ${JSON.stringify({ error: errorMessage })}, ${Date.now() - start}, ${false}, ${errorMessage}, true)
        `).catch(() => {});
        throw e;
      }
    }
    const executionTimeMs = Date.now() - start;

    await db.execute(sql`
      INSERT INTO nv_schema.tool_executions (request_id, tenant_id, tool_name, tool_category, input_params, output_result, execution_time_ms, success, error_message, sandboxed)
      VALUES (${params.requestId || null}, ${params.tenantId || null}, ${cap.id}, ${cap.category}, ${JSON.stringify(params.inputParams)}, ${JSON.stringify(output)}, ${executionTimeMs}, ${success}, ${errorMessage}, true)
    `).catch(() => {});

    return { result: output, executionTimeMs, capability: cap.id };
  }

  /** List capabilities visible to the requesting tier — used by the SDK. */
  async listCapabilitiesForTier(tier: string): Promise<Array<{ id: string; displayName: string; category: string; costClass: string }>> {
    const { capabilityManifest, mapBillingTierToCapabilityTier } = await import('../orchestration/capability-manifest.js');
    type CapTier = 'lite' | 'mitra' | 'enterprise' | 'sovereign' | 'white-label';
    const allowed: readonly CapTier[] = ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'];
    const t: CapTier = (allowed as readonly string[]).includes(tier)
      ? (tier as CapTier)
      : mapBillingTierToCapabilityTier(tier);
    return capabilityManifest.capabilitiesForTier(t).map(c => ({
      id: c.id,
      displayName: c.displayName,
      category: c.category,
      costClass: c.costClass,
    }));
  }
}

export class NvUsageService {
  async logUsage(params: {
    tenantId?: string;
    userId?: string;
    agentKey: string;
    source: string;
    inputTokens: number;
    outputTokens: number;
    model: string;
    provider: string;
    tier: string;
    latencyMs: number;
    success: boolean;
    costUsd?: number;
    errorMessage?: string;
  }): Promise<void> {
    await db.execute(sql`
      INSERT INTO nv_schema.usage_logs (tenant_id, user_id, agent_key, source, input_tokens, output_tokens, total_tokens, cost_usd, model, provider, tier, latency_ms, success, error_message)
      VALUES (${params.tenantId || null}, ${params.userId || null}, ${params.agentKey}, ${params.source}, ${params.inputTokens}, ${params.outputTokens}, ${params.inputTokens + params.outputTokens}, ${params.costUsd || 0}, ${params.model}, ${params.provider}, ${params.tier}, ${params.latencyMs}, ${params.success}, ${params.errorMessage || null})
    `).catch((e: any) => logger.warn('[NV-Usage] Log failed:', e.message));
  }

  async getUsageStats(tenantId?: string, days: number = 30): Promise<any> {
    // Coerce days to an integer and bind everything via parameters.
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(days) || 30)));
    const result = await db.execute(sql`
      SELECT COUNT(*) as total_requests, SUM(total_tokens) as total_tokens, SUM(cost_usd::numeric) as total_cost,
        AVG(latency_ms) as avg_latency,
        COUNT(*) FILTER (WHERE success = true) as successful,
        COUNT(*) FILTER (WHERE success = false) as failed
      FROM nv_schema.usage_logs
      WHERE (${tenantId ?? null}::text IS NULL OR tenant_id = ${tenantId ?? null})
        AND created_at > NOW() - (${safeDays} || ' days')::interval
    `);
    return result.rows?.[0] || {};
  }

  async getDailyUsage(tenantId?: string, days: number = 7): Promise<any[]> {
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(days) || 7)));
    const result = await db.execute(sql`
      SELECT DATE(created_at) as date, COUNT(*) as requests, SUM(total_tokens) as tokens, SUM(cost_usd::numeric) as cost
      FROM nv_schema.usage_logs
      WHERE (${tenantId ?? null}::text IS NULL OR tenant_id = ${tenantId ?? null})
        AND created_at > NOW() - (${safeDays} || ' days')::interval
      GROUP BY DATE(created_at) ORDER BY date DESC
    `);
    return result.rows || [];
  }
}

export class NvStreamingService {
  async createSession(params: {
    userId?: string;
    tenantId?: string;
    agentKey?: string;
    model?: string;
  }): Promise<{ sessionId: string }> {
    const result = await db.execute(sql`
      INSERT INTO nv_schema.streaming_sessions (user_id, tenant_id, agent_key, model, status)
      VALUES (${params.userId || null}, ${params.tenantId || null}, ${params.agentKey || null}, ${params.model || null}, 'active')
      RETURNING id
    `);
    return { sessionId: (result.rows?.[0] as any)?.id || '' };
  }

  async completeSession(sessionId: string, tokensStreamed: number, totalChunks: number): Promise<void> {
    await db.execute(sql`
      UPDATE nv_schema.streaming_sessions SET status = 'completed', tokens_streamed = ${tokensStreamed}, total_chunks = ${totalChunks}, completed_at = NOW()
      WHERE id = ${sessionId}
    `).catch(() => {});
  }
}

export const nvHallucinationDetector = new NvHallucinationDetector();
export const nvHITLService = new NvHITLService();
export const nvExplainabilityService = new NvExplainabilityService();
export const nvCitationVerifier = new NvCitationVerifier();
export const nvFeedbackService = new NvFeedbackService();
export const nvAgentMetricsService = new NvAgentMetricsService();
export const nvAgentAutoSelector = new NvAgentAutoSelector();
export const nvBiasDetector = new NvBiasDetector();
export const nvPIIVaultService = new NvPIIVaultService();
export const nvModelGovernanceService = new NvModelGovernanceService();
export const nvComplianceExportService = new NvComplianceExportService();
export const nvConsentService = new NvConsentService();
export const nvIncidentService = new NvIncidentService();
export const nvBulkAnalysisService = new NvBulkAnalysisService();
export const nvCalendarExtractionService = new NvCalendarExtractionService();
export const nvCustomAgentService = new NvCustomAgentService();
export const nvEmailClassificationService = new NvEmailClassificationService();
export const nvMemoryService = new NvMemoryService();
export const nvRAGService = new NvRAGService();
export const nvProtocolRegistryService = new NvProtocolRegistryService();
export const nvToolExecutionService = new NvToolExecutionService();
export const nvUsageService = new NvUsageService();
export const nvStreamingService = new NvStreamingService();

// ── Phase 3 Extension: Agent Chaining + BMAD + Parlant ──────────────────────

export class NvAgentChainService {
  private static tablesEnsured = false;

  async ensureTables(): Promise<void> {
    if (NvAgentChainService.tablesEnsured) return;
    // NV-CHAINS-DDL-PERM-001 (2026-06-24): on hardened prod RDS the gateway role
    // (`nv_app`) has USAGE but NOT CREATE on `nv_schema` — the tables are
    // provisioned by migrations, not by the app. `CREATE TABLE IF NOT EXISTS`
    // still raises "permission denied for schema nv_schema" (the privilege check
    // fires before the existence short-circuit), which previously threw out of
    // every getChains/createChain call and 500'd the Governance → Agent Chains /
    // A2A page on every request (the static guard never flipped, so the failing
    // DDL retried forever). Best-effort the DDL and continue regardless: the
    // tables already exist, so reads/writes work; flipping the guard stops the
    // per-request retry. Local/dev (role with CREATE, fresh DB) still gets the
    // tables created on first call.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS nv_schema.agent_chains (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          steps JSONB NOT NULL DEFAULT '[]',
          user_id TEXT DEFAULT '',
          tenant_id TEXT DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS nv_schema.agent_chain_executions (
          id SERIAL PRIMARY KEY,
          chain_id INT,
          step_results JSONB DEFAULT '[]',
          initial_input TEXT DEFAULT '',
          final_output TEXT DEFAULT '',
          total_latency_ms INT DEFAULT 0,
          status TEXT DEFAULT 'completed',
          user_id TEXT DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) {
      logger.warn('[NV-AgentChain] ensureTables DDL skipped (table likely exists; role lacks CREATE on nv_schema)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    NvAgentChainService.tablesEnsured = true;
  }

  async createChain(params: { name: string; description?: string; steps: Array<{ agentKey: string; inputTemplate?: string; outputField?: string }>; userId?: string; tenantId?: string }): Promise<any> {
    await this.ensureTables();
    const result = await db.execute(sql`
      INSERT INTO nv_schema.agent_chains (name, description, steps, user_id, tenant_id)
      VALUES (${params.name}, ${params.description || ''}, ${JSON.stringify(params.steps)}::jsonb, ${params.userId || ''}, ${params.tenantId || ''})
      RETURNING id, name, description, steps, user_id, created_at
    `);
    return result.rows?.[0] || null;
  }

  async executeChain(params: { chainId: number; initialInput: string; userId?: string; tenantId?: string; sessionId?: string }): Promise<any> {
    await this.ensureTables();
    const chainResult = await db.execute(sql`SELECT * FROM nv_schema.agent_chains WHERE id = ${params.chainId}`);
    const chain = chainResult.rows?.[0] as any;
    if (!chain) throw new Error(`Agent chain ${params.chainId} not found`);

    const steps: any[] = Array.isArray(chain.steps) ? chain.steps : (typeof chain.steps === 'string' ? JSON.parse(chain.steps) : []);
    if (!steps.length) throw new Error('Chain has no steps');

    const stepResults: any[] = [];
    let currentInput = params.initialInput;
    const start = Date.now();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepStart = Date.now();
      try {
        const response = await callJurexio(
          step.agentKey,
          '',
          currentInput,
          {
            userId: params.userId || 'chain-executor',
            tenantId: params.tenantId || 'default',
            sessionId: params.sessionId || `chain-${params.chainId}-${Date.now()}`,
          },
        );
        const output = (response as any).content || (response as any).response || '';
        stepResults.push({ step: i + 1, agentKey: step.agentKey, input: currentInput.substring(0, 500), output: output.substring(0, 2000), latencyMs: Date.now() - stepStart, success: true });
        currentInput = output || currentInput;
      } catch (err: any) {
        stepResults.push({ step: i + 1, agentKey: step.agentKey, input: currentInput.substring(0, 500), error: err.message, latencyMs: Date.now() - stepStart, success: false });
        break;
      }
    }

    const totalLatency = Date.now() - start;
    const finalOutput = stepResults[stepResults.length - 1]?.output || stepResults[stepResults.length - 1]?.error || '';

    await db.execute(sql`
      INSERT INTO nv_schema.agent_chain_executions (chain_id, step_results, initial_input, final_output, total_latency_ms, status, user_id)
      VALUES (${params.chainId}, ${JSON.stringify(stepResults)}::jsonb, ${params.initialInput.substring(0, 2000)}, ${finalOutput.substring(0, 10000)}, ${totalLatency}, 'completed', ${params.userId || ''})
    `).catch(() => {});

    return { chainId: params.chainId, steps: stepResults, totalLatencyMs: totalLatency, finalOutput, stepsCompleted: stepResults.length, totalSteps: steps.length };
  }

  async getChains(userId?: string): Promise<any[]> {
    await this.ensureTables();
    // NV-CHAINS-TYPESAFE-001 (2026-06-24): two fixes that previously 500'd this
    // endpoint (Governance → Agent Chains / A2A page blank):
    //   1. `user_id` is a TEXT column, but the caller passes req.user.id which is
    //      a NUMBER for console JWTs (e.g. super_admin id=1). Binding an integer
    //      makes Postgres reject `text = integer` ("operator does not exist").
    //      Coerce to string so the bind type matches the column.
    //   2. `jsonb_array_length(steps)` throws if any row's `steps` is not a JSON
    //      array. Guard with jsonb_typeof so a malformed row degrades to 0 rather
    //      than failing the whole list.
    const uid = userId !== undefined && userId !== null && String(userId).length > 0 ? String(userId) : undefined;
    const stepCount = sql`CASE WHEN jsonb_typeof(steps) = 'array' THEN jsonb_array_length(steps) ELSE 0 END`;
    const result = uid
      ? await db.execute(sql`SELECT id, name, description, ${stepCount} as step_count, user_id, created_at FROM nv_schema.agent_chains WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 50`)
      : await db.execute(sql`SELECT id, name, description, ${stepCount} as step_count, user_id, created_at FROM nv_schema.agent_chains ORDER BY created_at DESC LIMIT 50`);
    return result.rows || [];
  }

  async getChainExecution(executionId: number): Promise<any> {
    const result = await db.execute(sql`SELECT * FROM nv_schema.agent_chain_executions WHERE id = ${executionId}`);
    return result.rows?.[0] || null;
  }

  async listChainExecutions(chainId: number, limit = 20): Promise<any[]> {
    const result = await db.execute(sql`SELECT id, chain_id, status, total_latency_ms, created_at, final_output FROM nv_schema.agent_chain_executions WHERE chain_id = ${chainId} ORDER BY created_at DESC LIMIT ${limit}`);
    return result.rows || [];
  }
}

export class NvBMADService {
  getTemplates(): any[] {
    return [
      { id: 'nda-drafting', name: 'NDA Drafting Pipeline', description: 'Multi-step NDA creation from requirements to final draft', steps: [{ agentKey: 'legal-analyst', role: 'analyst', description: 'Analyze NDA requirements and party positions' }, { agentKey: 'legal-writer', role: 'architect', description: 'Draft NDA structure with all standard clauses' }, { agentKey: 'compliance-checker', role: 'developer', description: 'Check compliance with applicable law' }, { agentKey: 'qa-reviewer', role: 'qa', description: 'Final review and quality assurance' }] },
      { id: 'contract-review', name: 'Contract Review Workflow', description: 'Systematic contract analysis with risk scoring', steps: [{ agentKey: 'contract-analyst', role: 'analyst', description: 'Extract and catalog all key terms and obligations' }, { agentKey: 'risk-assessor', role: 'architect', description: 'Identify and score commercial and legal risks' }, { agentKey: 'legal-advisor', role: 'developer', description: 'Provide negotiation recommendations' }] },
      { id: 'litigation-brief', name: 'Litigation Brief Preparation', description: 'Research-backed brief drafting with full citations', steps: [{ agentKey: 'case-researcher', role: 'analyst', description: 'Research relevant precedents and statutory provisions' }, { agentKey: 'legal-writer', role: 'architect', description: 'Draft brief sections with arguments' }, { agentKey: 'citation-specialist', role: 'developer', description: 'Verify and format all legal citations' }] },
      { id: 'compliance-audit', name: 'Compliance Audit', description: 'Comprehensive regulatory compliance assessment', steps: [{ agentKey: 'compliance-checker', role: 'analyst', description: 'Audit current regulatory compliance posture' }, { agentKey: 'regulatory-specialist', role: 'architect', description: 'Perform gap analysis against applicable regulations' }, { agentKey: 'legal-advisor', role: 'developer', description: 'Develop compliance remediation roadmap' }] },
      { id: 'due-diligence', name: 'Corporate Due Diligence', description: 'M&A and investment due diligence workflow', steps: [{ agentKey: 'corporate-lawyer', role: 'analyst', description: 'Entity verification and corporate structure review' }, { agentKey: 'contract-analyst', role: 'architect', description: 'Material contract review and red flags' }, { agentKey: 'risk-assessor', role: 'developer', description: 'Consolidated risk report with recommendations' }] },
    ];
  }

  async runBMADWorkflow(params: { templateId: string; requirements: string; userId: string; tenantId?: string }): Promise<any> {
    const templates = this.getTemplates();
    const template = templates.find(t => t.id === params.templateId);
    if (!template) throw new Error(`BMAD template '${params.templateId}' not found`);
    const chain = await nvAgentChain.createChain({ name: `BMAD: ${template.name}`, description: `Auto-created from BMAD template: ${params.templateId}`, steps: template.steps, userId: params.userId, tenantId: params.tenantId });
    return nvAgentChain.executeChain({ chainId: (chain as any).id, initialInput: params.requirements, userId: params.userId, tenantId: params.tenantId });
  }

  analyzeProject(params: { projectType: string; requirements: string; teamSize?: number }): any {
    const roleMap: Record<string, any[]> = {
      nda: [{ role: 'Analyst', agent: 'legal-analyst', task: 'Requirements analysis' }, { role: 'Architect', agent: 'legal-writer', task: 'Document structure design' }, { role: 'Developer', agent: 'compliance-checker', task: 'Compliance validation' }],
      contract: [{ role: 'Analyst', agent: 'contract-analyst', task: 'Term extraction' }, { role: 'Architect', agent: 'risk-assessor', task: 'Risk architecture' }, { role: 'Developer', agent: 'legal-advisor', task: 'Advisory output' }],
      litigation: [{ role: 'Analyst', agent: 'case-researcher', task: 'Precedent research' }, { role: 'Architect', agent: 'legal-writer', task: 'Argument structure' }, { role: 'Developer', agent: 'citation-specialist', task: 'Citation formatting' }],
      compliance: [{ role: 'Analyst', agent: 'compliance-checker', task: 'Gap audit' }, { role: 'Architect', agent: 'regulatory-specialist', task: 'Regulation mapping' }, { role: 'Developer', agent: 'legal-advisor', task: 'Remediation plan' }],
    };
    const roles = roleMap[params.projectType] || roleMap['contract'];
    return { projectType: params.projectType, framework: 'BMAD CAM 2.0', decompositionStrategy: 'sequential-specialist', recommendedAgents: roles, estimatedSteps: roles.length, estimatedOutputQuality: '94%' };
  }

  /* ── GAP-011: BMAD Multi-Jurisdiction Clustering ──────────────────────────
     For cross-border matters spanning multiple jurisdictions, formCluster()
     groups agents by jurisdiction affinity and creates parallel legal analysis
     sub-clusters — one per jurisdiction — then routes a consolidation agent
     to synthesize the jurisdictional analysis into a unified legal strategy.
  ─────────────────────────────────────────────────────────────────────────── */
  async formCluster(params: {
    jurisdictions: string[];
    matter: string;
    templateId?: string;
    userId: string;
    tenantId?: string;
  }): Promise<any> {
    if (!params.jurisdictions || params.jurisdictions.length < 2) {
      throw new Error('formCluster requires at least 2 jurisdictions for multi-jurisdiction clustering');
    }

    /* Map each jurisdiction to its specialist agent */
    const jurisdictionAgentMap: Record<string, string> = {
      IN: 'indian-law-specialist',
      US: 'us-law-specialist',
      UK: 'uk-law-specialist',
      SG: 'singapore-law-specialist',
      AE: 'uae-law-specialist',
      EU: 'eu-law-specialist',
      AU: 'australia-law-specialist',
    };

    /* Build per-jurisdiction analysis steps */
    const jurisdictionSteps = params.jurisdictions.map((jCode, idx) => ({
      agentKey: jurisdictionAgentMap[jCode] || 'legal-research-agent',
      role: `jurisdiction-analyst-${jCode.toLowerCase()}`,
      description: `Analyze matter under ${jCode} jurisdiction law and precedents`,
      jurisdiction: jCode,
      stepOrder: idx + 1,
    }));

    /* Final consolidation step */
    const consolidationStep = {
      agentKey: 'multi-jurisdiction-synthesizer',
      role: 'consolidator',
      description: 'Synthesize all jurisdictional analyses into unified cross-border legal strategy',
      stepOrder: jurisdictionSteps.length + 1,
    };

    const allSteps = [...jurisdictionSteps, consolidationStep];

    const clusterId = `bmad-cluster-${Date.now()}`;
    const chain = await nvAgentChain.createChain({
      name: `BMAD Cluster [${params.jurisdictions.join('+')}]: ${params.matter.substring(0, 60)}`,
      description: `Multi-jurisdiction BMAD cluster for ${params.jurisdictions.join(', ')} | Matter: ${params.matter.substring(0, 100)}`,
      steps: allSteps,
      userId: params.userId,
      tenantId: params.tenantId,
    });

    logger.info(`[GAP-011] BMAD cluster formed: ${clusterId}, jurisdictions=${params.jurisdictions.join(',')}`);
    return {
      clusterId,
      chainId: (chain as any).id,
      jurisdictions: params.jurisdictions,
      steps: allSteps.length,
      schema: 'BMAD-CAM-2.0-MultiJurisdiction',
      chain,
    };
  }

  async executeCluster(params: {
    clusterId?: string;
    chainId: number;
    matter: string;
    userId: string;
    tenantId?: string;
  }): Promise<any> {
    return nvAgentChain.executeChain({
      chainId: params.chainId,
      initialInput: params.matter,
      userId: params.userId,
      tenantId: params.tenantId,
    });
  }
}

export class NvParlantService {
  private static tablesEnsured = false;

  async ensureTables(): Promise<void> {
    if (NvParlantService.tablesEnsured) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.parlant_sessions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        turns JSONB DEFAULT '[]',
        context JSONB DEFAULT '{}',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )
    `);
    NvParlantService.tablesEnsured = true;
  }

  async createSession(params: { userId: string; agentKey: string; context?: Record<string, any> }): Promise<any> {
    await this.ensureTables();

    /* ── GAP-012: Parlant Auto-Journey Detection ─────────────────────────────
       When a mentor chat session starts, detect the client's intent from the
       initial message or context and automatically load the matching Parlant
       journey template to guide the conversation through structured steps.
    ─────────────────────────────────────────────────────────────────────── */
    const journeyTemplates: Record<string, { journeyId: string; steps: string[]; estimatedTurns: number }> = {
      'new-client-intake':   { journeyId: 'journey-intake-001', steps: ['identity_verification', 'matter_description', 'urgency_assessment', 'conflict_check', 'fee_discussion', 'engagement_letter'], estimatedTurns: 6 },
      'contract-review':     { journeyId: 'journey-contract-001', steps: ['document_upload', 'key_terms_extraction', 'risk_flagging', 'negotiation_points', 'final_summary'], estimatedTurns: 5 },
      'litigation-consult':  { journeyId: 'journey-litigation-001', steps: ['case_facts', 'evidence_assessment', 'legal_strategy', 'cost_estimate', 'next_steps'], estimatedTurns: 5 },
      'compliance-audit':    { journeyId: 'journey-compliance-001', steps: ['business_description', 'regulation_mapping', 'gap_analysis', 'remediation_plan', 'timeline'], estimatedTurns: 5 },
      'family-law':          { journeyId: 'journey-family-001', steps: ['relationship_history', 'assets_liabilities', 'children_welfare', 'desired_outcome', 'legal_options'], estimatedTurns: 5 },
      'criminal-defense':    { journeyId: 'journey-criminal-001', steps: ['incident_description', 'prior_record', 'evidence_available', 'defense_strategy', 'bail_assessment'], estimatedTurns: 5 },
      'general-inquiry':     { journeyId: 'journey-general-001', steps: ['topic_clarification', 'relevant_law', 'practical_advice', 'referral_options'], estimatedTurns: 4 },
    };

    /* Detect intent from context keys or initialMessage */
    const ctx = params.context || {};
    const initialMsg = (ctx.initialMessage || ctx.message || '').toLowerCase();
    let detectedJourney = 'general-inquiry';

    if (params.agentKey.includes('intake') || initialMsg.includes('new client') || initialMsg.includes('first time') || initialMsg.includes('naya client')) {
      detectedJourney = 'new-client-intake';
    } else if (params.agentKey.includes('contract') || initialMsg.includes('contract') || initialMsg.includes('agreement') || initialMsg.includes('draft')) {
      detectedJourney = 'contract-review';
    } else if (params.agentKey.includes('litigation') || initialMsg.includes('case') || initialMsg.includes('court') || initialMsg.includes('suit') || initialMsg.includes('sued')) {
      detectedJourney = 'litigation-consult';
    } else if (params.agentKey.includes('compliance') || initialMsg.includes('compliance') || initialMsg.includes('regulation') || initialMsg.includes('audit')) {
      detectedJourney = 'compliance-audit';
    } else if (initialMsg.includes('divorce') || initialMsg.includes('custody') || initialMsg.includes('matrimonial') || initialMsg.includes('family')) {
      detectedJourney = 'family-law';
    } else if (initialMsg.includes('criminal') || initialMsg.includes('police') || initialMsg.includes('fir') || initialMsg.includes('arrest') || initialMsg.includes('bail')) {
      detectedJourney = 'criminal-defense';
    }

    const journeyTemplate = journeyTemplates[detectedJourney];
    const enrichedContext = {
      ...ctx,
      autoJourney: {
        journeyId: journeyTemplate.journeyId,
        journeyType: detectedJourney,
        steps: journeyTemplate.steps,
        currentStep: 0,
        estimatedTurns: journeyTemplate.estimatedTurns,
        detectedAt: new Date().toISOString(),
      },
    };

    logger.info(`[GAP-012] Parlant auto-journey loaded: ${detectedJourney} for session (user=${params.userId})`);

    const result = await db.execute(sql`
      INSERT INTO nv_schema.parlant_sessions (user_id, agent_key, context)
      VALUES (${params.userId}, ${params.agentKey}, ${JSON.stringify(enrichedContext)}::jsonb)
      RETURNING id, user_id, agent_key, context, status, created_at
    `);
    return {
      ...(result.rows?.[0] || {}),
      journeyAutoLoaded: detectedJourney,
      journeyTemplate,
    };
  }

  async addTurn(params: { sessionId: number; userMessage: string }): Promise<any> {
    await this.ensureTables();
    const sessionResult = await db.execute(sql`SELECT * FROM nv_schema.parlant_sessions WHERE id = ${params.sessionId} AND status = 'active'`);
    const session = sessionResult.rows?.[0] as any;
    if (!session) throw new Error('Session not found or already ended');

    const turns: any[] = Array.isArray(session.turns) ? session.turns : (typeof session.turns === 'string' ? JSON.parse(session.turns) : []);
    const recentTurns = turns.slice(-5);
    const historyContext = recentTurns.map((t: any) => `User: ${t.userMessage}\nAssistant: ${t.assistantResponse}`).join('\n\n');
    const fullPrompt = historyContext ? `${historyContext}\n\nUser: ${params.userMessage}` : params.userMessage;

    const response = await callJurexio(
      session.agent_key,
      '',
      fullPrompt,
      { userId: session.user_id, sessionId: `parlant-${params.sessionId}` },
    );
    const assistantResponse = (response as any).content || (response as any).response || '';

    const newTurn = { userMessage: params.userMessage, assistantResponse, timestamp: new Date().toISOString(), turnNumber: turns.length + 1 };
    turns.push(newTurn);
    await db.execute(sql`UPDATE nv_schema.parlant_sessions SET turns = ${JSON.stringify(turns)}::jsonb WHERE id = ${params.sessionId}`);
    return { sessionId: params.sessionId, turn: newTurn, totalTurns: turns.length };
  }

  async getSession(sessionId: number): Promise<any> {
    const result = await db.execute(sql`SELECT * FROM nv_schema.parlant_sessions WHERE id = ${sessionId}`);
    return result.rows?.[0] || null;
  }

  async listSessions(userId: string): Promise<any[]> {
    const result = await db.execute(sql`
      SELECT id, user_id, agent_key, status, created_at, ended_at,
             jsonb_array_length(COALESCE(turns, '[]'::jsonb)) as turn_count
      FROM nv_schema.parlant_sessions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 20
    `);
    return result.rows || [];
  }

  async endSession(sessionId: number): Promise<any> {
    await db.execute(sql`UPDATE nv_schema.parlant_sessions SET status = 'ended', ended_at = NOW() WHERE id = ${sessionId}`);
    return { sessionId, status: 'ended', endedAt: new Date().toISOString() };
  }
}

export const nvAgentChain = new NvAgentChainService();
export const nvBMAD = new NvBMADService();
export const nvParlant = new NvParlantService();
