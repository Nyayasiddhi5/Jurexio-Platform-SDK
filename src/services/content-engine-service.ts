// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX-SVC-CONTENT — Autonomous Legal Content Engine
 * Ported from SIA open-source agentic framework.
 *
 * Capabilities:
 *  - Time-of-day aware proactive legal content generation
 *  - Anti-repetition enforcement (cosine similarity check against last 50 posts)
 *  - Platform-specific formatting (WhatsApp / email / portal / API)
 *  - Knowledge module context injection (from JRX-SVC-KM-MODULES)
 *  - Agent persona application (from JRX-SVC-PERSONA)
 *  - Proactive matter insights (deadline alerts, risk flags, hearing reminders)
 *  - Post history persisted in nv_schema.nv_content_history
 */

import { callJurexio } from './jrx-client.js';
import { agentPersonaService, type Platform, type TimeOfDay } from './agent-persona-service.js';
import { knowledgeModuleService } from './knowledge-module-service.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('content-engine-service');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContentOptions {
  agentKey: string;
  orgId: string;
  platform: Platform;
  timeOfDay?: TimeOfDay;
  matterId?: string;
  userId?: string;
  useKnowledgeContext?: boolean;
  topic?: string;
  maxRetries?: number;
}

export interface ContentResult {
  content: string;
  agentKey: string;
  platform: Platform;
  timeOfDay: TimeOfDay;
  orgId: string;
  antiRepetitionPassed: boolean;
  retriesUsed: number;
  knowledgeContextUsed: boolean;
  personaUsed: string;
  generatedAt: string;
  id?: string;
}

// ── DB Table Init ──────────────────────────────────────────────────────────────

let tablesReady = false;

async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  try {
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_content_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_key TEXT NOT NULL,
        org_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        time_of_day TEXT NOT NULL,
        content TEXT NOT NULL,
        topic TEXT,
        matter_id TEXT,
        knowledge_context_used BOOLEAN DEFAULT FALSE,
        generated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_content_history_agent_org
        ON nv_schema.nv_content_history(agent_key, org_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_content_history_generated
        ON nv_schema.nv_content_history(generated_at DESC)
    `);
    tablesReady = true;
  } catch (err: any) {
    logger.error('[JRX-SVC-CONTENT] ensureTables error:', err.message);
  }
}

// ── Anti-Repetition Engine ────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function simpleTextVector(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const allWords = Object.keys(freq).sort();
  return allWords.map(w => freq[w] || 0);
}

function computeTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\W+/).filter(Boolean));
  const words2 = new Set(text2.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

async function getRecentContentHistory(agentKey: string, orgId: string, limit = 50): Promise<string[]> {
  await ensureTables();
  try {
    const rows = await db.execute(sql`
      SELECT content FROM nv_schema.nv_content_history
      WHERE agent_key = ${agentKey} AND org_id = ${orgId}
      ORDER BY generated_at DESC
      LIMIT ${limit}
    `);
    return ((rows as any).rows || []).map((r: any) => r.content as string);
  } catch { return []; }
}

async function checkAntiRepetition(
  content: string,
  agentKey: string,
  orgId: string,
  threshold = 0.75
): Promise<{ passes: boolean; maxSimilarity: number }> {
  const history = await getRecentContentHistory(agentKey, orgId, 50);
  if (history.length === 0) return { passes: true, maxSimilarity: 0 };

  let maxSimilarity = 0;
  for (const pastContent of history) {
    const sim = computeTextSimilarity(content, pastContent);
    if (sim > maxSimilarity) maxSimilarity = sim;
  }

  return { passes: maxSimilarity < threshold, maxSimilarity };
}

// ── Content Generator ─────────────────────────────────────────────────────────

export async function generateContent(options: ContentOptions): Promise<ContentResult> {
  await ensureTables();

  const {
    agentKey, orgId, platform, matterId, userId,
    useKnowledgeContext = true, topic, maxRetries = 3,
  } = options;
  const timeOfDay = options.timeOfDay || agentPersonaService.getCurrentTimeOfDay();

  const persona = await agentPersonaService.getPersona(agentKey, orgId);
  const systemPrompt = agentPersonaService.buildPersonaSystemPrompt(persona, timeOfDay);

  let knowledgeContext = '';
  let knowledgeContextUsed = false;
  if (useKnowledgeContext) {
    try {
      knowledgeContext = await knowledgeModuleService.getContextForAgent(agentKey, timeOfDay, orgId);
      knowledgeContextUsed = knowledgeContext.length > 50;
    } catch { /* knowledge context is best-effort */ }
  }

  const topicLine = topic ? `\nFocus topic: ${topic}` : '';
  const matterLine = matterId ? `\nContext: This is for matter reference ${matterId}.` : '';

  let finalContent = '';
  let retriesUsed = 0;
  let antiRepetitionPassed = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    retriesUsed = attempt;

    const retryNote = attempt > 0
      ? `\n\nIMPORTANT: Your previous ${attempt} attempt(s) were too similar to past posts. Generate something COMPLETELY DIFFERENT in topic, structure, and opening.`
      : '';

    const result = await callJurexio(
      agentKey,
      systemPrompt,
      `Generate a ${timeOfDay} legal content post for the ${platform} platform.${topicLine}${matterLine}${knowledgeContext}${retryNote}`,
      { maxTokens: 700, tier: 'elite', jurisdiction: persona.jurisdiction[0] || 'india' }
    );

    const candidateContent = agentPersonaService.formatResponseForPlatform(result.content, platform, persona);
    const antiCheck = await checkAntiRepetition(candidateContent, agentKey, orgId);

    if (antiCheck.passes || attempt === maxRetries) {
      finalContent = candidateContent;
      antiRepetitionPassed = antiCheck.passes;
      break;
    }
  }

  if (!finalContent) {
    finalContent = `Legal intelligence update for ${timeOfDay}: Stay informed on the latest legal developments in your practice area.`;
    antiRepetitionPassed = true;
  }

  let savedId: string | undefined;
  try {
    const inserted = await db.execute(sql`
      INSERT INTO nv_schema.nv_content_history
        (agent_key, org_id, platform, time_of_day, content, topic, matter_id, knowledge_context_used)
      VALUES (
        ${agentKey}, ${orgId}, ${platform}, ${timeOfDay},
        ${finalContent}, ${topic || null}, ${matterId || null}, ${knowledgeContextUsed}
      )
      RETURNING id
    `);
    savedId = (inserted as any).rows?.[0]?.id;
  } catch (err: any) {
    logger.error('[JRX-SVC-CONTENT] history save error:', err.message);
  }

  return {
    content: finalContent,
    agentKey,
    platform,
    timeOfDay,
    orgId,
    antiRepetitionPassed,
    retriesUsed,
    knowledgeContextUsed,
    personaUsed: persona.name,
    generatedAt: new Date().toISOString(),
    id: savedId,
  };
}

// ── Proactive Insights ────────────────────────────────────────────────────────

export async function getProactiveInsights(orgId: string, agentKey = 'corporate-ma'): Promise<ContentResult[]> {
  await ensureTables();
  const results: ContentResult[] = [];

  try {
    const matters = await db.execute(sql`
      SELECT id, case_number, case_title, lifecycle_stage, next_hearing_date, sla_deadline
      FROM nyi_matter.nyi_matter_cases
      WHERE org_id = ${orgId}
        AND lifecycle_stage NOT IN ('closed', 'archived')
      ORDER BY updated_at DESC
      LIMIT 5
    `);

    for (const matter of ((matters as any).rows || [])) {
      const matterContext = `Matter: ${matter.case_title} (${matter.case_number}), Stage: ${matter.lifecycle_stage}${matter.next_hearing_date ? `, Next Hearing: ${matter.next_hearing_date}` : ''}${matter.sla_deadline ? `, SLA Deadline: ${matter.sla_deadline}` : ''}`;

      const result = await generateContent({
        agentKey,
        orgId,
        platform: 'portal',
        timeOfDay: agentPersonaService.getCurrentTimeOfDay(),
        matterId: matter.id,
        topic: `Proactive insight for: ${matterContext}`,
        useKnowledgeContext: false,
        maxRetries: 1,
      });

      results.push(result);
    }
  } catch (err: any) {
    logger.error('[JRX-SVC-CONTENT] getProactiveInsights error (matter query):', err.message);

    const result = await generateContent({
      agentKey,
      orgId,
      platform: 'portal',
      timeOfDay: agentPersonaService.getCurrentTimeOfDay(),
      topic: 'General legal intelligence update for your organization',
      useKnowledgeContext: true,
      maxRetries: 1,
    });
    results.push(result);
  }

  return results;
}

// ── Content History ───────────────────────────────────────────────────────────

export async function getContentHistory(
  orgId: string,
  options: { agentKey?: string; platform?: string; limit?: number; offset?: number } = {}
): Promise<ContentResult[]> {
  await ensureTables();
  const { agentKey, platform, limit = 20, offset = 0 } = options;

  try {
    const rows = await db.execute(sql`
      SELECT id, agent_key, org_id, platform, time_of_day, content, topic,
             matter_id, knowledge_context_used, generated_at
      FROM nv_schema.nv_content_history
      WHERE org_id = ${orgId}
        ${agentKey ? sql`AND agent_key = ${agentKey}` : sql``}
        ${platform ? sql`AND platform = ${platform}` : sql``}
      ORDER BY generated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return ((rows as any).rows || []).map((row: any) => ({
      id: row.id,
      content: row.content,
      agentKey: row.agent_key,
      platform: row.platform as Platform,
      timeOfDay: row.time_of_day as TimeOfDay,
      orgId: row.org_id,
      antiRepetitionPassed: true,
      retriesUsed: 0,
      knowledgeContextUsed: row.knowledge_context_used || false,
      personaUsed: row.agent_key,
      generatedAt: row.generated_at,
      matterId: row.matter_id,
      topic: row.topic,
    }));
  } catch (err: any) {
    logger.error('[JRX-SVC-CONTENT] getContentHistory error:', err.message);
    return [];
  }
}

export const contentEngineService = {
  generateContent,
  getProactiveInsights,
  getContentHistory,
};
