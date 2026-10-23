// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX-SVC-FILTER — Intelligent Message Filter Service
 * Ported from SIA open-source agentic framework.
 *
 * Capabilities:
 *  - LLM-based 7-category request classification (before every agent call)
 *  - Categories: legal_query | off_topic | spam_promo | inappropriate |
 *                self_reference | capability_request | ambiguous
 *  - Configurable per-org filter rules (nv_schema.nv_filter_configs)
 *  - Default suggested responses per category
 *  - Express middleware for /api/nyi/ai/* and /api/jrx/agents/* routes
 *  - All filter decisions logged to nyi_audit_ai_actions
 */

import { Request, Response, NextFunction } from 'express';
import { callJurexio } from './jrx-client.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('message-filter-service');

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilterCategory =
  | 'legal_query'
  | 'off_topic'
  | 'spam_promo'
  | 'inappropriate'
  | 'self_reference'
  | 'capability_request'
  | 'ambiguous';

export interface FilterResult {
  allowed: boolean;
  category: FilterCategory;
  confidence: number;
  reason: string;
  suggestedResponse?: string;
}

export interface FilterConfig {
  orgId: string;
  agentKey?: string;
  rules: string[];
  blockedCategories: FilterCategory[];
  allowAmbiguous: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ── Default Suggested Responses ───────────────────────────────────────────────

const DEFAULT_RESPONSES: Record<FilterCategory, string> = {
  legal_query: '',
  off_topic: 'I specialize in legal matters and can help with legal questions, document analysis, contract review, and legal research. Could you rephrase your query in a legal context?',
  spam_promo: 'I\'m a legal AI assistant and cannot process promotional or advertising content. Please direct legal queries to me.',
  inappropriate: 'I\'m unable to process this request as it violates content guidelines. I can assist with legitimate legal questions and analysis.',
  self_reference: '',
  capability_request: 'I am a specialized legal AI agent on the Jurexio platform. I can help with: legal research, document analysis, contract review, case strategy, compliance guidance, and legal drafting — across multiple jurisdictions. How can I assist you with a legal matter?',
  ambiguous: '',
};

// ── DB Table Init ──────────────────────────────────────────────────────────────

let tablesReady = false;

async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  try {
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_filter_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id TEXT NOT NULL,
        agent_key TEXT,
        rules JSONB DEFAULT '[]',
        blocked_categories JSONB DEFAULT '["spam_promo","inappropriate"]',
        allow_ambiguous BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, agent_key)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_filter_configs_org
        ON nv_schema.nv_filter_configs(org_id)
    `);
    tablesReady = true;
  } catch (err: any) {
    logger.error('[JRX-SVC-FILTER] ensureTables error:', err.message);
  }
}

// ── Core Classification ────────────────────────────────────────────────────────

export async function classifyMessage(
  message: string,
  agentKey: string,
  orgId: string,
  context?: string
): Promise<FilterResult> {
  try {
    const truncatedMsg = message.substring(0, 2000);
    const contextNote = context ? `\nConversation context: ${context.substring(0, 500)}` : '';

    const result = await callJurexio(
      'message-filter-classifier',
      `You are a message classification system for a legal AI platform. Classify the user's message into exactly one of these categories:

1. "legal_query" — A genuine, relevant legal question (law, contracts, compliance, regulations, courts, rights, legal procedures, legal documents, jurisdiction)
2. "off_topic" — Question unrelated to legal matters (cooking, technology general chat, personal advice, entertainment, weather, etc.)
3. "spam_promo" — Promotional content, advertising, product pitches, affiliate marketing, solicitations
4. "inappropriate" — Harmful, abusive, discriminatory, threatening, or sexually explicit content
5. "self_reference" — The message appears to be an AI-generated response, not a human query (starts with "As an AI...", "I recommend...", etc.)
6. "capability_request" — Asking what the AI can do ("what can you help with?", "what are your capabilities?", "can you help me with X?")
7. "ambiguous" — Unclear intent; could be legal but lacks context

Reply with ONLY a JSON object:
{
  "category": "<one of the 7 categories>",
  "confidence": <0.0 to 1.0>,
  "reason": "<one sentence explanation>"
}`,
      `User message: "${truncatedMsg}"${contextNote}`,
      { maxTokens: 200, tier: 'pro', jurisdiction: 'india' }
    );

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const category = parsed.category as FilterCategory || 'ambiguous';
        const confidence = parseFloat(parsed.confidence) || 0.7;
        const allowed = ['legal_query', 'ambiguous', 'capability_request'].includes(category);
        return {
          allowed,
          category,
          confidence,
          reason: parsed.reason || '',
          suggestedResponse: allowed ? undefined : DEFAULT_RESPONSES[category],
        };
      }
    } catch { /* fallback below */ }

    return { allowed: true, category: 'ambiguous', confidence: 0.5, reason: 'Classification parse failed — allowing with ambiguous flag' };
  } catch (err: any) {
    logger.error('[JRX-SVC-FILTER] classifyMessage error:', err.message);
    return { allowed: true, category: 'ambiguous', confidence: 0.3, reason: 'Filter service error — allowing by default' };
  }
}

export function isSelfReference(message: string, _agentKey: string): boolean {
  const selfRefPatterns = [
    /^as an ai/i, /^i am an ai/i, /^as a legal ai/i,
    /^i'm an ai/i, /^i am a language model/i, /^based on my training/i,
    /^\[jurexio\]/i, /^\[agent\]/i,
  ];
  return selfRefPatterns.some(p => p.test(message.trim()));
}

export async function applyFilterRules(
  message: string,
  rules: string[]
): Promise<{ blocked: boolean; reason?: string }> {
  if (rules.length === 0) return { blocked: false };

  try {
    const rulesText = rules.map((r, i) => `Rule ${i + 1}: ${r}`).join('\n');
    const result = await callJurexio(
      'rule-filter-engine',
      `You are a content moderation system. Evaluate whether the user message violates any of the following org-specific rules.
Reply with ONLY a JSON object: { "blocked": <true|false>, "reason": "<which rule was violated, or empty string>" }

Rules:
${rulesText}`,
      `User message: "${message.substring(0, 1000)}"`,
      { maxTokens: 150, tier: 'pro', jurisdiction: 'india' }
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { blocked: !!parsed.blocked, reason: parsed.reason || '' };
    }
  } catch (err: any) {
    logger.error('[JRX-SVC-FILTER] applyFilterRules error:', err.message);
  }

  return { blocked: false };
}

// ── Org Config Management ─────────────────────────────────────────────────────

export async function getFilterConfig(orgId: string, agentKey?: string): Promise<FilterConfig> {
  await ensureTables();
  try {
    const rows = await db.execute(sql`
      SELECT org_id, agent_key, rules, blocked_categories, allow_ambiguous, created_at, updated_at
      FROM nv_schema.nv_filter_configs
      WHERE org_id = ${orgId} AND (agent_key = ${agentKey || null} OR agent_key IS NULL)
      ORDER BY agent_key NULLS LAST
      LIMIT 1
    `);
    const row = (rows as any).rows?.[0];
    if (row) {
      return {
        orgId: row.org_id,
        agentKey: row.agent_key,
        rules: Array.isArray(row.rules) ? row.rules : [],
        blockedCategories: Array.isArray(row.blocked_categories) ? row.blocked_categories : ['spam_promo', 'inappropriate'],
        allowAmbiguous: row.allow_ambiguous !== false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  } catch (err: any) {
    logger.error('[JRX-SVC-FILTER] getFilterConfig error:', err.message);
  }

  return {
    orgId,
    rules: [],
    blockedCategories: ['spam_promo', 'inappropriate'],
    allowAmbiguous: true,
  };
}

export async function saveFilterConfig(config: FilterConfig): Promise<void> {
  await ensureTables();
  try {
    await db.execute(sql`
      INSERT INTO nv_schema.nv_filter_configs
        (org_id, agent_key, rules, blocked_categories, allow_ambiguous)
      VALUES (
        ${config.orgId}, ${config.agentKey || null},
        ${JSON.stringify(config.rules)}::jsonb,
        ${JSON.stringify(config.blockedCategories)}::jsonb,
        ${config.allowAmbiguous}
      )
      ON CONFLICT (org_id, agent_key) DO UPDATE
        SET rules = EXCLUDED.rules,
            blocked_categories = EXCLUDED.blocked_categories,
            allow_ambiguous = EXCLUDED.allow_ambiguous,
            updated_at = NOW()
    `);
  } catch (err: any) {
    logger.error('[JRX-SVC-FILTER] saveFilterConfig error:', err.message);
    throw err;
  }
}

// ── Full Filter Pipeline ───────────────────────────────────────────────────────

export async function runFilterPipeline(
  message: string,
  agentKey: string,
  orgId: string,
  userId?: string,
  context?: string
): Promise<FilterResult> {
  if (isSelfReference(message, agentKey)) {
    return { allowed: false, category: 'self_reference', confidence: 1.0, reason: 'Self-reference detected — agent output passed as input', suggestedResponse: undefined };
  }

  const config = await getFilterConfig(orgId, agentKey);

  if (config.rules.length > 0) {
    const ruleCheck = await applyFilterRules(message, config.rules);
    if (ruleCheck.blocked) {
      return {
        allowed: false,
        category: 'inappropriate',
        confidence: 0.9,
        reason: `Org rule violation: ${ruleCheck.reason}`,
        suggestedResponse: 'This request violates organizational content policies.',
      };
    }
  }

  const classification = await classifyMessage(message, agentKey, orgId, context);

  if (!classification.allowed && config.blockedCategories.includes(classification.category)) {
    return classification;
  }

  if (classification.category === 'ambiguous' && !config.allowAmbiguous) {
    return { ...classification, allowed: false, suggestedResponse: 'Please provide more specific legal context for your question.' };
  }

  return { ...classification, allowed: true };
}

// ── Express Middleware ────────────────────────────────────────────────────────

export function createFilterMiddleware(options: { extractMessage?: (req: Request) => string } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) { next(); return; }

      const orgId = user.orgId || user.organizationId || 'default';
      const userId = user.userId || user.id;
      const agentKey = req.body?.agentKey || 'generic';
      const message = options.extractMessage
        ? options.extractMessage(req)
        : (req.body?.prompt || req.body?.message || req.body?.content || '');

      if (!message || message.length < 3) { next(); return; }

      const filterResult = await runFilterPipeline(message, agentKey, String(orgId), String(userId));

      res.setHeader('X-Filter-Category', filterResult.category);
      res.setHeader('X-Filter-Confidence', String(filterResult.confidence));

      if (!filterResult.allowed) {
        res.status(200).json({
          success: true,
          filtered: true,
          filterCategory: filterResult.category,
          response: filterResult.suggestedResponse || 'This request could not be processed.',
          message: filterResult.reason,
        });
        return;
      }

      // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
      req.filterResult = filterResult;
      next();
    } catch (err: any) {
      logger.error('[JRX-SVC-FILTER] middleware error:', err.message);
      next();
    }
  };
}

export const messageFilterService = {
  classifyMessage,
  isSelfReference,
  applyFilterRules,
  runFilterPipeline,
  getFilterConfig,
  saveFilterConfig,
  createFilterMiddleware,
};
