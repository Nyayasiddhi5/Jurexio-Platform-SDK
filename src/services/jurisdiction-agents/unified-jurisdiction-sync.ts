/**
 * Unified Jurisdiction Sync Service
 * Syncs all jurisdiction agents (India, USA, Europe) to PostgreSQL database
 * Uses actual database column names from legal_agents table
 */

import { db, legalAgents } from '../../db/index.js';
import { eq, sql } from 'drizzle-orm';
import { generateAllUSAAgents, USA_AGENTS_COUNT } from './usa-agents-generator.js';
import { generateAllEuropeAgents, EUROPE_AGENTS_COUNT } from './europe-agents-generator.js';
import { generateAllGulfAgents, generateUAEAgents, generateSaudiAgents, UAE_AGENTS_COUNT, SAUDI_AGENTS_COUNT, GULF_AGENTS_COUNT } from './gulf-agents-generator.js';
const GCC_AGENTS_COUNT = UAE_AGENTS_COUNT + SAUDI_AGENTS_COUNT;
import { generateAllSingaporeAgents, SINGAPORE_AGENTS_COUNT } from './singapore-agents-generator.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('unified-jurisdiction-sync');

interface SyncResult {
  jurisdiction: string;
  totalAgents: number;
  inserted: number;
  updated: number;
  errors: string[];
  timestamp: string;
}

interface UnifiedSyncResult {
  success: boolean;
  timestamp: string;
  results: SyncResult[];
  totals: {
    india: number;
    usa: number;
    europe: number;
    uae: number;
    gcc: number;
    singapore: number;
    total: number;
  };
  errors: string[];
}

/**
 * Sync USA jurisdiction agents to database using raw SQL
 */
async function syncUSAAgents(): Promise<SyncResult> {
  const result: SyncResult = {
    jurisdiction: 'USA',
    totalAgents: USA_AGENTS_COUNT,
    inserted: 0,
    updated: 0,
    errors: [],
    timestamp: new Date().toISOString()
  };

  try {
    const usaAgents = generateAllUSAAgents();
    logger.info(`📊 Generated ${usaAgents.length} USA jurisdiction agents`);

    for (const agent of usaAgents) {
      try {
        if (!db) throw new Error('Database not initialized');
        
        // Check if agent exists
        const existingResult = await db.execute(sql`
          SELECT id FROM legal_agents WHERE agent_id = ${agent.id} LIMIT 1
        `);

        if (existingResult.rows.length > 0) {
          // Update existing agent
          await db.execute(sql`
            UPDATE legal_agents SET
              name = ${agent.name},
              version = ${agent.version},
              tier = ${agent.tier},
              roma_level = ${agent.romaLevel},
              category = ${agent.category},
              legal_specialization = ${agent.practiceArea},
              description = ${agent.description},
              system_prompt = ${agent.systemPrompt},
              jurisdiction = 'USA',
              jurisdictions = ${JSON.stringify(agent.jurisdictions)}::jsonb,
              capabilities = ${JSON.stringify(agent.capabilities)}::jsonb,
              usa_law_support = ${JSON.stringify({ complianceFrameworks: agent.complianceFrameworks, specializations: agent.specializations })}::jsonb,
              updated_at = NOW()
            WHERE agent_id = ${agent.id}
          `);
          result.updated++;
        } else {
          // Insert new agent
          await db.execute(sql`
            INSERT INTO legal_agents (
              agent_id, name, version, tier, roma_level, category,
              legal_specialization, description, system_prompt, jurisdiction, jurisdictions,
              capabilities, usa_law_support, status, created_at, updated_at
            ) VALUES (
              ${agent.id},
              ${agent.name},
              ${agent.version},
              ${agent.tier},
              ${agent.romaLevel},
              ${agent.category},
              ${agent.practiceArea},
              ${agent.description},
              ${agent.systemPrompt},
              'USA',
              ${JSON.stringify(agent.jurisdictions)}::jsonb,
              ${JSON.stringify(agent.capabilities)}::jsonb,
              ${JSON.stringify({ complianceFrameworks: agent.complianceFrameworks, specializations: agent.specializations })}::jsonb,
              'active',
              NOW(),
              NOW()
            )
          `);
          result.inserted++;
        }
      } catch (err: any) {
        result.errors.push(`Agent ${agent.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`✅ USA Sync: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`);
  } catch (err: any) {
    result.errors.push(`USA sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Sync Europe jurisdiction agents to database using raw SQL
 */
async function syncEuropeAgents(): Promise<SyncResult> {
  const result: SyncResult = {
    jurisdiction: 'Europe',
    totalAgents: EUROPE_AGENTS_COUNT,
    inserted: 0,
    updated: 0,
    errors: [],
    timestamp: new Date().toISOString()
  };

  try {
    const europeAgents = generateAllEuropeAgents();
    logger.info(`📊 Generated ${europeAgents.length} Europe jurisdiction agents`);

    for (const agent of europeAgents) {
      try {
        if (!db) throw new Error('Database not initialized');
        
        // Check if agent exists
        const existingResult = await db.execute(sql`
          SELECT id FROM legal_agents WHERE agent_id = ${agent.id} LIMIT 1
        `);

        if (existingResult.rows.length > 0) {
          // Update existing agent
          await db.execute(sql`
            UPDATE legal_agents SET
              name = ${agent.name},
              version = ${agent.version},
              tier = ${agent.tier},
              roma_level = ${agent.romaLevel},
              category = ${agent.category},
              legal_specialization = ${agent.practiceArea},
              description = ${agent.description},
              system_prompt = ${agent.systemPrompt},
              jurisdiction = 'Europe',
              jurisdictions = ${JSON.stringify(agent.jurisdictions)}::jsonb,
              capabilities = ${JSON.stringify(agent.capabilities)}::jsonb,
              europe_law_support = ${JSON.stringify({ complianceFrameworks: agent.complianceFrameworks, specializations: agent.specializations })}::jsonb,
              updated_at = NOW()
            WHERE agent_id = ${agent.id}
          `);
          result.updated++;
        } else {
          // Insert new agent
          await db.execute(sql`
            INSERT INTO legal_agents (
              agent_id, name, version, tier, roma_level, category,
              legal_specialization, description, system_prompt, jurisdiction, jurisdictions,
              capabilities, europe_law_support, status, created_at, updated_at
            ) VALUES (
              ${agent.id},
              ${agent.name},
              ${agent.version},
              ${agent.tier},
              ${agent.romaLevel},
              ${agent.category},
              ${agent.practiceArea},
              ${agent.description},
              ${agent.systemPrompt},
              'Europe',
              ${JSON.stringify(agent.jurisdictions)}::jsonb,
              ${JSON.stringify(agent.capabilities)}::jsonb,
              ${JSON.stringify({ complianceFrameworks: agent.complianceFrameworks, specializations: agent.specializations })}::jsonb,
              'active',
              NOW(),
              NOW()
            )
          `);
          result.inserted++;
        }
      } catch (err: any) {
        result.errors.push(`Agent ${agent.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`✅ Europe Sync: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`);
  } catch (err: any) {
    result.errors.push(`Europe sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Sync Gulf (UAE + GCC) jurisdiction agents to database
 */
async function syncGulfAgents(): Promise<SyncResult> {
  const result: SyncResult = {
    jurisdiction: 'Gulf',
    totalAgents: GULF_AGENTS_COUNT,
    inserted: 0,
    updated: 0,
    errors: [],
    timestamp: new Date().toISOString()
  };

  try {
    const gulfAgents = generateAllGulfAgents();
    logger.info(`📊 Generated ${gulfAgents.length} Gulf jurisdiction agents (UAE: ${UAE_AGENTS_COUNT}, Saudi: ${GCC_AGENTS_COUNT})`);

    for (const agent of gulfAgents) {
      try {
        if (!db) throw new Error('Database not initialized');
        
        const existingResult = await db.execute(sql`
          SELECT id FROM legal_agents WHERE agent_id = ${agent.id} LIMIT 1
        `);

        if (existingResult.rows.length > 0) {
          await db.execute(sql`
            UPDATE legal_agents SET
              name = ${agent.name},
              version = ${agent.version},
              tier = ${agent.tier},
              roma_level = ${agent.romaLevel},
              category = ${agent.category},
              legal_specialization = ${agent.practiceArea},
              description = ${agent.description},
              system_prompt = ${agent.systemPrompt},
              jurisdiction = ${agent.primaryJurisdiction},
              jurisdictions = ${JSON.stringify(agent.jurisdictions)}::jsonb,
              capabilities = ${JSON.stringify(agent.capabilities)}::jsonb,
              updated_at = NOW()
            WHERE agent_id = ${agent.id}
          `);
          result.updated++;
        } else {
          await db.execute(sql`
            INSERT INTO legal_agents (
              agent_id, name, version, tier, roma_level, category,
              legal_specialization, description, system_prompt, jurisdiction, jurisdictions,
              capabilities, status, created_at, updated_at
            ) VALUES (
              ${agent.id},
              ${agent.name},
              ${agent.version},
              ${agent.tier},
              ${agent.romaLevel},
              ${agent.category},
              ${agent.practiceArea},
              ${agent.description},
              ${agent.systemPrompt},
              ${agent.primaryJurisdiction},
              ${JSON.stringify(agent.jurisdictions)}::jsonb,
              ${JSON.stringify(agent.capabilities)}::jsonb,
              'active',
              NOW(),
              NOW()
            )
          `);
          result.inserted++;
        }
      } catch (err: any) {
        result.errors.push(`Agent ${agent.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`✅ Gulf Sync: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`);
  } catch (err: any) {
    result.errors.push(`Gulf sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Sync Singapore jurisdiction agents to database
 */
async function syncSingaporeAgents(): Promise<SyncResult> {
  const result: SyncResult = {
    jurisdiction: 'Singapore',
    totalAgents: SINGAPORE_AGENTS_COUNT,
    inserted: 0,
    updated: 0,
    errors: [],
    timestamp: new Date().toISOString()
  };

  try {
    const singaporeAgents = generateAllSingaporeAgents();
    logger.info(`📊 Generated ${singaporeAgents.length} Singapore jurisdiction agents`);

    for (const agent of singaporeAgents) {
      try {
        if (!db) throw new Error('Database not initialized');
        
        const existingResult = await db.execute(sql`
          SELECT id FROM legal_agents WHERE agent_id = ${agent.id} LIMIT 1
        `);

        if (existingResult.rows.length > 0) {
          await db.execute(sql`
            UPDATE legal_agents SET
              name = ${agent.name},
              version = ${agent.version},
              tier = ${agent.tier},
              roma_level = ${agent.romaLevel},
              category = ${agent.category},
              legal_specialization = ${agent.practiceArea},
              description = ${agent.description},
              system_prompt = ${agent.systemPrompt},
              jurisdiction = 'Singapore',
              jurisdictions = ${JSON.stringify(agent.jurisdictions)}::jsonb,
              capabilities = ${JSON.stringify(agent.capabilities)}::jsonb,
              updated_at = NOW()
            WHERE agent_id = ${agent.id}
          `);
          result.updated++;
        } else {
          await db.execute(sql`
            INSERT INTO legal_agents (
              agent_id, name, version, tier, roma_level, category,
              legal_specialization, description, system_prompt, jurisdiction, jurisdictions,
              capabilities, status, created_at, updated_at
            ) VALUES (
              ${agent.id},
              ${agent.name},
              ${agent.version},
              ${agent.tier},
              ${agent.romaLevel},
              ${agent.category},
              ${agent.practiceArea},
              ${agent.description},
              ${agent.systemPrompt},
              'Singapore',
              ${JSON.stringify(agent.jurisdictions)}::jsonb,
              ${JSON.stringify(agent.capabilities)}::jsonb,
              'active',
              NOW(),
              NOW()
            )
          `);
          result.inserted++;
        }
      } catch (err: any) {
        result.errors.push(`Agent ${agent.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`✅ Singapore Sync: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`);
  } catch (err: any) {
    result.errors.push(`Singapore sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Get count of India agents from database
 */
async function getIndiaAgentCount(): Promise<number> {
  try {
    if (!db) return 0;
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM legal_agents 
      WHERE jurisdictions::text LIKE '%India%'
    `);
    return parseInt(String((result.rows[0] as any)?.count || 0));
  } catch {
    return 0;
  }
}

interface ExtendedUnifiedSyncResult extends UnifiedSyncResult {
  totals: {
    india: number;
    usa: number;
    europe: number;
    uae: number;
    gcc: number;
    singapore: number;
    total: number;
  };
}

/**
 * Unified sync for all 6 jurisdictions
 */
export async function syncAllJurisdictionAgents(): Promise<ExtendedUnifiedSyncResult> {
  logger.info('═'.repeat(60));
  logger.info('🌍 UNIFIED JURISDICTION SYNC - All 6 Jurisdictions');
  logger.info('═'.repeat(60));

  const result: ExtendedUnifiedSyncResult = {
    success: true,
    timestamp: new Date().toISOString(),
    results: [],
    totals: {
      india: 0,
      usa: 0,
      europe: 0,
      uae: 0,
      gcc: 0,
      singapore: 0,
      total: 0
    },
    errors: []
  };

  try {
    // Sync USA agents
    logger.info('\n📍 Syncing USA Jurisdiction Agents...');
    const usaResult = await syncUSAAgents();
    result.results.push(usaResult);
    if (usaResult.errors.length > 0) {
      result.errors.push(...usaResult.errors);
    }

    // Sync Europe agents
    logger.info('\n📍 Syncing Europe Jurisdiction Agents...');
    const europeResult = await syncEuropeAgents();
    result.results.push(europeResult);
    if (europeResult.errors.length > 0) {
      result.errors.push(...europeResult.errors);
    }

    // Sync Gulf agents (UAE + GCC)
    logger.info('\n📍 Syncing Gulf Jurisdiction Agents (UAE + GCC)...');
    const gulfResult = await syncGulfAgents();
    result.results.push(gulfResult);
    if (gulfResult.errors.length > 0) {
      result.errors.push(...gulfResult.errors);
    }

    // Sync Singapore agents
    logger.info('\n📍 Syncing Singapore Jurisdiction Agents...');
    const singaporeResult = await syncSingaporeAgents();
    result.results.push(singaporeResult);
    if (singaporeResult.errors.length > 0) {
      result.errors.push(...singaporeResult.errors);
    }

    // NOTE: India agents are seeded from config/agent-registries/Jurexio-Legal-registry-IN.json
    // via the canonical jurisdiction-overlay path (149 agents = 148 domain + 1 orchestrator).
    // NYV-NS-025 (2026-05-05): the 148 IN::<x> duplicate rows (without `in-` inner prefix)
    // were removed by scripts/jrx-dedupe-india-agents.ts. Do NOT add a separate syncIndia()
    // here — it would re-introduce the duplicates.

    // Get totals from database
    const stats = await getJurisdictionStats();
    result.totals.india = stats.india;
    result.totals.usa = stats.usa;
    result.totals.europe = stats.europe;
    result.totals.uae = stats.uae;
    result.totals.gcc = stats.gcc;
    result.totals.singapore = stats.singapore;
    result.totals.total = stats.total;

    // Mark as successful if agents synced
    result.success = (stats.total > 0);

    logger.info('\n' + '═'.repeat(60));
    logger.info('📊 SYNC SUMMARY - 6 JURISDICTIONS');
    logger.info('═'.repeat(60));
    logger.info(`India:        ${result.totals.india} agents`);
    logger.info(`USA:          ${result.totals.usa} agents`);
    logger.info(`Europe:       ${result.totals.europe} agents`);
    logger.info(`UAE:          ${result.totals.uae} agents`);
    logger.info(`GCC: ${result.totals.gcc} agents`);
    logger.info(`Singapore:    ${result.totals.singapore} agents`);
    logger.info('─'.repeat(60));
    logger.info(`TOTAL:        ${result.totals.total} agents`);
    logger.info('═'.repeat(60));

  } catch (err: any) {
    result.success = false;
    result.errors.push(`Unified sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Get jurisdiction statistics from database - All 6 Jurisdictions
 */
export async function getJurisdictionStats(): Promise<{
  india: number;
  usa: number;
  europe: number;
  uae: number;
  gcc: number;
  singapore: number;
  total: number;
  byTier: Record<string, number>;
  byJurisdiction: Record<string, number>;
}> {
  try {
    if (!db) throw new Error('Database not initialized');
    
    // Total count
    const totalResult = await db.execute(sql`SELECT COUNT(*) as count FROM legal_agents`);
    const total = parseInt(String((totalResult.rows[0] as any)?.count || 0));

    // By tier
    const tierResult = await db.execute(sql`
      SELECT tier, COUNT(*) as count 
      FROM legal_agents 
      GROUP BY tier
    `);
    const byTier: Record<string, number> = {};
    tierResult.rows.forEach((row: any) => {
      byTier[row.tier] = parseInt(row.count);
    });

    // Count by jurisdiction column (primary source)
    const jurisdictionResult = await db.execute(sql`
      SELECT jurisdiction, COUNT(*) as count 
      FROM legal_agents 
      GROUP BY jurisdiction
    `);
    const byJurisdiction: Record<string, number> = {};
    jurisdictionResult.rows.forEach((row: any) => {
      byJurisdiction[row.jurisdiction] = parseInt(row.count);
    });

    // Extract counts for each jurisdiction
    const india = byJurisdiction['India'] || 0;
    const usa = byJurisdiction['USA'] || 0;
    const europe = byJurisdiction['Europe'] || 0;
    const uae = byJurisdiction['GCC'] || 0;
    const gcc = byJurisdiction['GCC'] || 0;
    const singapore = byJurisdiction['Singapore'] || 0;

    return {
      india,
      usa,
      europe,
      uae,
      gcc,
      singapore,
      total,
      byTier,
      byJurisdiction
    };
  } catch (err: any) {
    logger.error('Failed to get jurisdiction stats:', err);
    return {
      india: 0,
      usa: 0,
      europe: 0,
      uae: 0,
      gcc: 0,
      singapore: 0,
      total: 0,
      byTier: {},
      byJurisdiction: {}
    };
  }
}

/**
 * Validate all agents have proper 22-point system prompts
 */
export async function validateAllAgentPrompts(): Promise<{
  total: number;
  valid: number;
  invalid: number;
  issues: Array<{ id: string; issue: string }>;
}> {
  const result = {
    total: 0,
    valid: 0,
    invalid: 0,
    issues: [] as Array<{ id: string; issue: string }>
  };

  try {
    if (!db) throw new Error('Database not initialized');
    
    const queryResult = await db.execute(sql`
      SELECT agent_id, name, system_prompt FROM legal_agents
    `);

    result.total = queryResult.rows.length;

    for (const row of queryResult.rows) {
      const agent = row as { agent_id: string; name: string; system_prompt: string };
      const prompt = agent.system_prompt || '';
      
      // Check for 22-point structure markers
      const hasSection1 = prompt.includes('SECTION 1');
      const hasSection7 = prompt.includes('SECTION 7');
      const has22Points = prompt.includes('22.');
      const minLength = prompt.length >= 15000;

      if (hasSection1 && hasSection7 && has22Points && minLength) {
        result.valid++;
      } else {
        result.invalid++;
        const issues: string[] = [];
        if (!hasSection1) issues.push('Missing Section 1');
        if (!hasSection7) issues.push('Missing Section 7');
        if (!has22Points) issues.push('Missing Point 22');
        if (!minLength) issues.push(`Too short (${prompt.length} chars)`);
        
        result.issues.push({
          id: agent.agent_id,
          issue: issues.join(', ')
        });
      }
    }
  } catch (err: any) {
    logger.error('Validation failed:', err);
  }

  return result;
}
