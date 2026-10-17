/**
 * NYV-SVC-SOCIAL-MEM — User Social Memory Service
 * Ported from SIA open-source agentic framework.
 *
 * Capabilities:
 *  - Per-user interaction tracking across all agent conversations
 *  - Conversation history (last 20 messages per user-agent pair)
 *  - Dynamic LLM-generated opinion about each user (updated every 10 interactions):
 *    their legal sophistication, preferred communication style, and risk appetite
 *  - Auto-injection of social context into callJurexio() system prompts
 *  - GDPR-compliant clear/delete endpoint
 *  - DB: nv_schema.nv_social_memory
 */

import { callJurexio } from './jrx-client.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('social-memory-service');

// NYV-PREFLIGHT-FIX-002 (2026-04-30): `db` from `../db/index.js` is typed as nullable
// (it's null when DATABASE_URL is unset and the system runs in degraded mode). Every
// call site here previously did `await db.execute(...)` without a null check, raising
// TS18047 across the file. This narrow helper asserts non-null at the call boundary —
// throwing a clear runtime error if the DB really is missing instead of crashing on
// "Cannot read property 'execute' of null".
function requireDb(): NonNullable<typeof db> {
  if (!db) {
    throw new Error('[NYV-SVC-SOCIAL-MEM] Database not initialized — set DATABASE_URL');
  }
  return db;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  platform?: string;
}

export interface SocialMemory {
  id: string;
  userId: string;
  agentKey: string;
  orgId: string;
  platform: string;
  interactionCount: number;
  lastInteraction: string;
  conversationHistory: ConversationTurn[];
  opinion: string | null;
  lastOpinionUpdatedAt: string | null;
  createdAt: string;
}

export interface SocialContext {
  hasHistory: boolean;
  interactionCount: number;
  opinion: string | null;
  recentMessages: ConversationTurn[];
  contextString: string;
}

// ── DB Table Init ──────────────────────────────────────────────────────────────

let tablesReady = false;

async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  try {
    await requireDb().execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);
    await requireDb().execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_social_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        org_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'portal',
        interaction_count INT NOT NULL DEFAULT 0,
        last_interaction TIMESTAMPTZ DEFAULT NOW(),
        conversation_history JSONB DEFAULT '[]',
        opinion TEXT,
        last_opinion_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, agent_key, org_id)
      )
    `);
    await requireDb().execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_social_memory_user
        ON nv_schema.nv_social_memory(user_id, org_id)
    `);
    await requireDb().execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_social_memory_agent
        ON nv_schema.nv_social_memory(agent_key, org_id)
    `);
    tablesReady = true;
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] ensureTables error:', err.message);
  }
}

// ── Core Methods ──────────────────────────────────────────────────────────────

export async function getOrCreateSocialMemory(
  userId: string,
  agentKey: string,
  orgId: string,
  platform: string = 'portal'
): Promise<SocialMemory> {
  await ensureTables();

  try {
    const existing = await requireDb().execute(sql`
      SELECT id, user_id, agent_key, org_id, platform, interaction_count,
             last_interaction, conversation_history, opinion,
             last_opinion_updated_at, created_at
      FROM nv_schema.nv_social_memory
      WHERE user_id = ${userId} AND agent_key = ${agentKey} AND org_id = ${orgId}
      LIMIT 1
    `);

    const row = (existing as any).rows?.[0];
    if (row) {
      return {
        id: row.id,
        userId: row.user_id,
        agentKey: row.agent_key,
        orgId: row.org_id,
        platform: row.platform,
        interactionCount: parseInt(row.interaction_count) || 0,
        lastInteraction: row.last_interaction,
        conversationHistory: Array.isArray(row.conversation_history) ? row.conversation_history : [],
        opinion: row.opinion || null,
        lastOpinionUpdatedAt: row.last_opinion_updated_at || null,
        createdAt: row.created_at,
      };
    }

    const created = await requireDb().execute(sql`
      INSERT INTO nv_schema.nv_social_memory
        (user_id, agent_key, org_id, platform, conversation_history)
      VALUES (${userId}, ${agentKey}, ${orgId}, ${platform}, '[]'::jsonb)
      ON CONFLICT (user_id, agent_key, org_id) DO UPDATE
        SET platform = EXCLUDED.platform
      RETURNING id, user_id, agent_key, org_id, platform, interaction_count,
                last_interaction, conversation_history, opinion,
                last_opinion_updated_at, created_at
    `);

    const newRow = (created as any).rows?.[0];
    return {
      id: newRow.id,
      userId: newRow.user_id,
      agentKey: newRow.agent_key,
      orgId: newRow.org_id,
      platform: newRow.platform,
      interactionCount: 0,
      lastInteraction: newRow.last_interaction,
      conversationHistory: [],
      opinion: null,
      lastOpinionUpdatedAt: null,
      createdAt: newRow.created_at,
    };
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] getOrCreateSocialMemory error:', err.message);
    return {
      id: 'error',
      userId,
      agentKey,
      orgId,
      platform,
      interactionCount: 0,
      lastInteraction: new Date().toISOString(),
      conversationHistory: [],
      opinion: null,
      lastOpinionUpdatedAt: null,
      createdAt: new Date().toISOString(),
    };
  }
}

export async function recordInteraction(
  userId: string,
  agentKey: string,
  orgId: string,
  platform: string,
  userMessage: string,
  agentResponse: string
): Promise<void> {
  await ensureTables();

  try {
    const memory = await getOrCreateSocialMemory(userId, agentKey, orgId, platform);
    const newTurns: ConversationTurn[] = [
      { role: 'user', content: userMessage.substring(0, 500), timestamp: new Date().toISOString(), platform },
      { role: 'agent', content: agentResponse.substring(0, 500), timestamp: new Date().toISOString(), platform },
    ];

    const updatedHistory = [...memory.conversationHistory, ...newTurns].slice(-20);
    const newCount = memory.interactionCount + 1;

    await requireDb().execute(sql`
      UPDATE nv_schema.nv_social_memory
      SET interaction_count = ${newCount},
          last_interaction = NOW(),
          conversation_history = ${JSON.stringify(updatedHistory)}::jsonb,
          platform = ${platform}
      WHERE user_id = ${userId} AND agent_key = ${agentKey} AND org_id = ${orgId}
    `);

    if (newCount % 10 === 0) {
      updateOpinion(userId, agentKey, orgId, updatedHistory).catch(err =>
        logger.error('[NYV-SVC-SOCIAL-MEM] background opinion update error:', err.message)
      );
    }
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] recordInteraction error:', err.message);
  }
}

export async function updateOpinion(
  userId: string,
  agentKey: string,
  orgId: string,
  history?: ConversationTurn[]
): Promise<string> {
  await ensureTables();

  try {
    let conversationHistory = history;
    if (!conversationHistory) {
      const memory = await getOrCreateSocialMemory(userId, agentKey, orgId);
      conversationHistory = memory.conversationHistory;
    }

    if (conversationHistory.length === 0) return '';

    const historyText = conversationHistory
      .slice(-10)
      .map(t => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.content}`)
      .join('\n');

    const result = await callJurexio(
      'social-memory-opinion-engine',
      `You are analyzing a user's interaction pattern with a legal AI agent to personalize future responses.
Based on the conversation history provided, generate a concise 2-3 sentence user profile covering:
1. Their legal sophistication level (novice/intermediate/expert)
2. Preferred communication style (brief/detailed, formal/conversational, technical/layperson)
3. Risk appetite (conservative/moderate/aggressive in legal matters)

Reply with ONLY the assessment text — no JSON, no preamble.`,
      `Conversation history:\n${historyText}`,
      { maxTokens: 300, tier: 'pro', jurisdiction: 'india' }
    );

    const opinion = result.content.trim();

    await requireDb().execute(sql`
      UPDATE nv_schema.nv_social_memory
      SET opinion = ${opinion}, last_opinion_updated_at = NOW()
      WHERE user_id = ${userId} AND agent_key = ${agentKey} AND org_id = ${orgId}
    `);

    return opinion;
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] updateOpinion error:', err.message);
    return '';
  }
}

export async function getSocialContext(
  userId: string,
  agentKey: string,
  orgId: string
): Promise<SocialContext> {
  await ensureTables();

  try {
    const memory = await getOrCreateSocialMemory(userId, agentKey, orgId);
    const recentMessages = memory.conversationHistory.slice(-6);

    let contextString = '';

    if (memory.interactionCount > 0) {
      contextString += `\n\n--- USER RELATIONSHIP CONTEXT ---\n`;
      contextString += `This user has had ${memory.interactionCount} previous interaction(s) with this agent.\n`;

      if (memory.opinion) {
        contextString += `User Profile: ${memory.opinion}\n`;
      }

      if (recentMessages.length > 0) {
        contextString += `\nRecent conversation (last ${recentMessages.length} turns):\n`;
        for (const turn of recentMessages) {
          contextString += `${turn.role === 'user' ? 'User' : 'Agent'}: ${turn.content.substring(0, 200)}\n`;
        }
      }
      contextString += `--- END USER CONTEXT ---`;
    }

    return {
      hasHistory: memory.interactionCount > 0,
      interactionCount: memory.interactionCount,
      opinion: memory.opinion,
      recentMessages,
      contextString,
    };
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] getSocialContext error:', err.message);
    return { hasHistory: false, interactionCount: 0, opinion: null, recentMessages: [], contextString: '' };
  }
}

export async function clearHistory(userId: string, agentKey: string, orgId: string): Promise<void> {
  await ensureTables();
  try {
    await requireDb().execute(sql`
      UPDATE nv_schema.nv_social_memory
      SET conversation_history = '[]'::jsonb,
          opinion = NULL,
          last_opinion_updated_at = NULL,
          interaction_count = 0
      WHERE user_id = ${userId} AND agent_key = ${agentKey} AND org_id = ${orgId}
    `);
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] clearHistory error:', err.message);
    throw err;
  }
}

export async function listOrgSocialMemories(orgId: string, limit = 50, offset = 0): Promise<SocialMemory[]> {
  await ensureTables();
  try {
    const rows = await requireDb().execute(sql`
      SELECT id, user_id, agent_key, org_id, platform, interaction_count,
             last_interaction, conversation_history, opinion,
             last_opinion_updated_at, created_at
      FROM nv_schema.nv_social_memory
      WHERE org_id = ${orgId}
      ORDER BY last_interaction DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return ((rows as any).rows || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      agentKey: row.agent_key,
      orgId: row.org_id,
      platform: row.platform,
      interactionCount: parseInt(row.interaction_count) || 0,
      lastInteraction: row.last_interaction,
      conversationHistory: Array.isArray(row.conversation_history) ? row.conversation_history : [],
      opinion: row.opinion || null,
      lastOpinionUpdatedAt: row.last_opinion_updated_at || null,
      createdAt: row.created_at,
    }));
  } catch (err: any) {
    logger.error('[NYV-SVC-SOCIAL-MEM] listOrgSocialMemories error:', err.message);
    return [];
  }
}

export const socialMemoryService = {
  getOrCreateSocialMemory,
  recordInteraction,
  updateOpinion,
  getSocialContext,
  clearHistory,
  listOrgSocialMemories,
};
