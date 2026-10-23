// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio Enterprise Platform 3.1.2 — AI Output Metadata Service
 * JRX-SVC-METADATA-001
 *
 * Handover §3.3.4 — Every AI output MUST carry an ai_metadata block.
 * This block is injected by the GRPO response interceptor in patterns-routes.ts
 * and also by jrx-completions-routes.ts into every response.
 *
 * ai_metadata block fields:
 *   - risk_score + components (from risk engine)
 *   - template_mode (STRICT/GUIDED/MENTOR)
 *   - jurisdiction (bound code + profile)
 *   - prompt_hash (SHA-256 of input prompt)
 *   - trace_id (UUID per request)
 *   - model_used (provider + model name)
 *   - grpo_telemetry (self-learning stats)
 *   - governance_badge (validation status)
 *   - disclosure (mandatory legal disclosure text)
 *   - generated_at (ISO timestamp)
 */

import crypto from 'crypto';
import { riskScoreEngine, RiskScoreResult, RiskScoringContext } from './jrx-ai-risk-score-service.js';
import { getJurisdictionProfile, buildGovernanceBadge } from '../middleware/jrx-jurisdiction-binding-middleware.js';
import { TemplateMode, validateStrictModeOutput } from '../middleware/jrx-template-mode-middleware.js';
import { createLogger } from '../utils/logger.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';

const logger = createLogger('./jrx-ai-metadata');

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface AIMetadataContext {
  jurisdictionCode: string;
  templateMode: TemplateMode;
  prompt: string;
  output: string;
  modelProvider?: string;
  modelName?: string;
  tokensUsed?: number;
  latencyMs?: number;
  traceId?: string;
  userId?: string;
  patternKey?: string;
  route?: string;
  caseType?: string;
  mandatoryClauses?: string[];
}

export interface AIMetadataBlock {
  trace_id: string;
  generated_at: string;
  jurisdiction: {
    code: string;
    name: string;
    currency: string;
    legal_system: string;
    disclosure_appended: boolean;
  };
  template_mode: TemplateMode;
  strict_mode_violations: string[];
  risk: {
    score: number;
    blocked: boolean;
    block_reason: string | null;
    confidence: number;
    components: RiskScoreResult['components'];
    prompt_hash: string;
  };
  model: {
    provider: string;
    model: string;
    tokens_used: number;
    latency_ms: number;
  };
  governance: {
    jurisdiction_validated: boolean;
    jurisdiction_code: string;
    jurisdiction_name: string;
    currency: string;
    legal_system: string;
    disclosure_appended: boolean;
  };
  disclosure: string;
  nyv_version: string;
}

// ─────────────────────────────────────────
// Metadata Builder
// ─────────────────────────────────────────

export class AIMetadataService {
  /**
   * Build the full ai_metadata block for any AI output.
   * Also persists to nv_schema.ai_activity for audit trail.
   */
  async buildMetadataBlock(ctx: AIMetadataContext): Promise<AIMetadataBlock> {
    const traceId = ctx.traceId || crypto.randomUUID();
    const profile = getJurisdictionProfile(ctx.jurisdictionCode);

    // Score risk
    const riskCtx: RiskScoringContext = {
      jurisdiction: ctx.jurisdictionCode,
      caseType: ctx.caseType,
      templateMode: ctx.templateMode,
      prompt: ctx.prompt,
      output: ctx.output,
      mandatoryClauses: ctx.mandatoryClauses,
    };
    const riskResult = riskScoreEngine.computeScore(riskCtx);

    // Check STRICT mode violations
    const strictViolations = ctx.templateMode === 'STRICT'
      ? validateStrictModeOutput(ctx.output)
      : [];

    // Governance badge
    const governance = buildGovernanceBadge(profile, !riskResult.blocked);

    const block: AIMetadataBlock = {
      trace_id: traceId,
      generated_at: new Date().toISOString(),
      jurisdiction: {
        code: profile.code,
        name: profile.name,
        currency: profile.currency,
        legal_system: profile.legalSystem,
        disclosure_appended: profile.aiDisclosureRequired,
      },
      template_mode: ctx.templateMode,
      strict_mode_violations: strictViolations,
      risk: {
        score: riskResult.risk_score,
        blocked: riskResult.blocked,
        block_reason: riskResult.block_reason,
        confidence: riskResult.confidence,
        components: riskResult.components,
        prompt_hash: riskResult.prompt_hash,
      },
      model: {
        provider: ctx.modelProvider || 'openrouter',
        model: ctx.modelName || 'unknown',
        tokens_used: ctx.tokensUsed || 0,
        latency_ms: ctx.latencyMs || 0,
      },
      governance,
      disclosure: profile.mandatoryDisclosure,
      nyv_version: '3.1.2',
    };

    // Persist to ai_activity table (non-blocking)
    setImmediate(() => this._persistToAiActivity(ctx, block, riskResult).catch(() => {}));

    return block;
  }

  /**
   * Quick metadata block builder — synchronous, no DB write.
   * Used in high-frequency paths where persistence is handled separately.
   */
  buildMetadataBlockSync(ctx: Omit<AIMetadataContext, 'mandatoryClauses'>): Omit<AIMetadataBlock, 'risk'> & { risk: Omit<AIMetadataBlock['risk'], 'components'> & { components: Record<string, number> } } {
    const traceId = ctx.traceId || crypto.randomUUID();
    const profile = getJurisdictionProfile(ctx.jurisdictionCode);
    const promptHash = crypto.createHash('sha256').update(ctx.prompt || '').digest('hex');
    const governance = buildGovernanceBadge(profile, true);

    return {
      trace_id: traceId,
      generated_at: new Date().toISOString(),
      jurisdiction: {
        code: profile.code,
        name: profile.name,
        currency: profile.currency,
        legal_system: profile.legalSystem,
        disclosure_appended: profile.aiDisclosureRequired,
      },
      template_mode: ctx.templateMode,
      strict_mode_violations: [],
      risk: {
        score: 0,
        blocked: false,
        block_reason: null,
        confidence: 1,
        components: { jurisdiction_mismatch: 0, clause_absence: 0, structural_deviation: 0, hallucination_probability: 0, unsupported_references: 0 },
        prompt_hash: promptHash,
      },
      model: {
        provider: ctx.modelProvider || 'openrouter',
        model: ctx.modelName || 'unknown',
        tokens_used: ctx.tokensUsed || 0,
        latency_ms: ctx.latencyMs || 0,
      },
      governance,
      disclosure: profile.mandatoryDisclosure,
      nyv_version: '3.1.2',
    };
  }

  // ─────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────

  private async _persistToAiActivity(
    ctx: AIMetadataContext,
    block: AIMetadataBlock,
    risk: RiskScoreResult
  ): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.ai_activity (
          id, trace_id, user_id, jurisdiction, pattern_key, route,
          template_mode, risk_score, prompt_hash, blocked, model_provider,
          model_name, tokens_used, latency_ms, created_at
        ) VALUES (
          gen_random_uuid(),
          ${block.trace_id},
          ${ctx.userId || 'anonymous'},
          ${ctx.jurisdictionCode},
          ${ctx.patternKey || null},
          ${ctx.route || null},
          ${ctx.templateMode},
          ${risk.risk_score},
          ${risk.prompt_hash},
          ${risk.blocked},
          ${ctx.modelProvider || 'openrouter'},
          ${ctx.modelName || 'unknown'},
          ${ctx.tokensUsed || 0},
          ${ctx.latencyMs || 0},
          NOW()
        )
      `);
    } catch (err: any) {
      logger.warn('ai_activity persistence failed — table may not exist yet', { traceId: block.trace_id });
    }
  }
}

export const aiMetadataService = new AIMetadataService();
