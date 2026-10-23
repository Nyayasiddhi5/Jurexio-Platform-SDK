import { createLogger } from '../utils/logger.js';
import {
  getActiveAgents,
  getAgent as getLoadedAgent,
  getPracticeAreaCount,
  getRegistryConfig,
  getRegistrySummary,
  getRomaDistribution,
  resolveAgentId,
  resetRegistryLoaderCache,
  type RegistryAgent,
} from '../config/agent-registry-loader.js';
import {
  JRX_ARCHIVED_REGISTRY,
  JRX_MCP_TOOLS,
  JRX_REGISTRY_TOTALS,
  JRX_TOPOLOGY_CATALOG,
} from '../constants/jrx-registry-stats.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const logger = createLogger('agent-registry-service');

export interface AgentDefinition extends RegistryAgent {
  version: string;
  tier: string;
  romaLevel: string;
  category: string;
  practiceArea: string;
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  protocols: string[];
  preferredModels: string[];
  fallbackModels: string[];
  securityLevel: string;
  status: string;
  jurisdictions?: string[];
}

export interface AgentRegistryMetadata {
  totalLoaded: number;
  totalUpserted: number;
  byJurisdiction: Record<string, number>;
  byPracticeArea: Record<string, number>;
  byTier: Record<string, number>;
  loadedAt: string;
  sources: string[];
  format?: string;
  version?: string;
  formatsObserved?: string[];
}

let registryMetadata: AgentRegistryMetadata | null = null;

function toCompositeAgentId(agent: AgentDefinition): string {
  const primary = String(agent.jurisdictions?.[0] || getRegistryConfig().primaryJurisdiction || 'DEFAULT').toUpperCase();
  return `${primary}::${agent.id}`;
}

async function upsertActiveRegistryToLegalAgents(agents: AgentDefinition[]): Promise<number> {
  if (!db) return 0;

  let upserted = 0;

  for (const agent of agents) {
    const compositeAgentId = toCompositeAgentId(agent);
    const jurisdiction = String(agent.jurisdictions?.[0] || getRegistryConfig().primaryJurisdiction || 'DEFAULT').toUpperCase();

    const existing = await db.execute(sql`
      SELECT id
      FROM legal_agents
      WHERE agent_id = ${compositeAgentId}
      LIMIT 1
    `);

    if ((existing.rows?.length || 0) > 0) {
      await db.execute(sql`
        UPDATE legal_agents
        SET
          name = ${agent.name},
          version = ${agent.version},
          tier = ${agent.tier},
          roma_level = ${agent.romaLevel},
          category = ${agent.category},
          practice_area = ${agent.practiceArea},
          description = ${agent.description || ''},
          system_prompt = ${agent.systemPrompt || ''},
          status = ${agent.status || 'active'},
          is_enabled = true,
          updated_at = NOW()
        WHERE agent_id = ${compositeAgentId}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO legal_agents (
          agent_id,
          name,
          version,
          tier,
          roma_level,
          category,
          practice_area,
          description,
          system_prompt,
          status,
          is_enabled,
          created_at,
          updated_at
        ) VALUES (
          ${compositeAgentId},
          ${agent.name},
          ${agent.version},
          ${agent.tier},
          ${agent.romaLevel},
          ${agent.category},
          ${agent.practiceArea},
          ${`${agent.description || ''} [runtime_jurisdiction=${jurisdiction}]`},
          ${agent.systemPrompt || ''},
          ${agent.status || 'active'},
          true,
          NOW(),
          NOW()
        )
      `);
    }

    upserted++;
  }

  return upserted;
}

function toAgentDefinition(agent: RegistryAgent): AgentDefinition {
  return {
    ...agent,
    version: String(agent.version || '5.1.0'),
    tier: String(agent.tier || 'assistant'),
    romaLevel: String(agent.romaLevel || 'L2'),
    category: String(agent.category || 'general'),
    practiceArea: String(agent.practiceArea || 'general'),
    systemPrompt: String(agent.systemPrompt || ''),
    capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map(String) : [],
    tools: Array.isArray(agent.tools) ? agent.tools.map(String) : [],
    protocols: Array.isArray(agent.protocols) ? agent.protocols.map(String) : [],
    preferredModels: Array.isArray(agent.preferredModels) ? agent.preferredModels.map(String) : [],
    fallbackModels: Array.isArray(agent.fallbackModels) ? agent.fallbackModels.map(String) : [],
    securityLevel: String(agent.securityLevel || 'standard'),
    status: String(agent.status || 'active'),
    jurisdictions: [String(agent.jurisdictionActivation?.primary || 'DEFAULT')],
  };
}

function buildMetadata(agents: AgentDefinition[]): AgentRegistryMetadata {
  const config = getRegistryConfig();
  const byJurisdiction: Record<string, number> = {
    [config.primaryJurisdiction]: agents.length,
  };
  const byPracticeArea: Record<string, number> = {};
  const byTier: Record<string, number> = {};

  for (const agent of agents) {
    byPracticeArea[agent.practiceArea] = (byPracticeArea[agent.practiceArea] || 0) + 1;
    byTier[agent.tier] = (byTier[agent.tier] || 0) + 1;
  }

  return {
    totalLoaded: agents.length,
    totalUpserted: 0,
    byJurisdiction,
    byPracticeArea,
    byTier,
    loadedAt: new Date().toISOString(),
    sources: [
      config.defaultRegistryPath,
      ...(config.overlayRegistryPath ? [config.overlayRegistryPath] : []),
    ],
    format: config.format,
    version: config.version,
    formatsObserved: [config.format],
  };
}

function ensureMetadata(): AgentRegistryMetadata {
  if (!registryMetadata) {
    registryMetadata = buildMetadata(getAllAgents());
  }
  return registryMetadata;
}

export async function initializeAgentRegistry(): Promise<AgentRegistryMetadata> {
  resetRegistryLoaderCache();
  registryMetadata = buildMetadata(getAllAgents());
  try {
    registryMetadata.totalUpserted = await upsertActiveRegistryToLegalAgents(getAllAgents());
  } catch (error: any) {
    logger.warn('[AgentRegistry] legal_agents sync skipped', {
      error: error?.message || String(error),
      totalAgents: registryMetadata.totalLoaded,
    });
    registryMetadata.totalUpserted = 0;
  }
  logger.info('[AgentRegistry] Active registry initialized', {
    totalAgents: registryMetadata.totalLoaded,
    totalUpserted: registryMetadata.totalUpserted,
    version: registryMetadata.version,
    format: registryMetadata.format,
    primaryJurisdiction: getRegistryConfig().primaryJurisdiction,
  });
  return registryMetadata;
}

export function getAgent(agentId: string): AgentDefinition | undefined {
  const agent = getLoadedAgent(agentId);
  return agent ? toAgentDefinition(agent) : undefined;
}

export async function getAgentFromDb(agentId: string): Promise<Record<string, unknown> | null> {
  if (!db || !agentId) return null;

  const resolvedId = resolveAgentId(agentId) || agentId;
  const primaryJurisdiction = String(getRegistryConfig().primaryJurisdiction || 'DEFAULT').toUpperCase();
  const compositeCandidates = Array.from(new Set([
    agentId,
    resolvedId,
    `${primaryJurisdiction}::${agentId}`,
    `${primaryJurisdiction}::${resolvedId}`,
  ]));

  try {
    /* NV-MEMORY-ACCESS-ACCOUNTING-001 — same Drizzle/`ANY` trap as
     * jrx-orchestration-services.ts: interpolating a JS array expands to a parameter
     * LIST `($1, $2, …)`, and Postgres rejects it with "op ANY/ALL (array) requires
     * array on right side" (verified live). The `::text[]` cast on a delimited string
     * is the form that actually works. This lookup is inside a try/catch fallback, so
     * the failure would have been invisible here too. */
    const candidateCsv = compositeCandidates.join(',');
    const result = await db.execute(sql`
      SELECT *
      FROM legal_agents
      WHERE agent_id = ANY(string_to_array(${candidateCsv}, ',')::text[])
      LIMIT 1
    `);
    return (result.rows?.[0] as Record<string, unknown> | undefined) || null;
  } catch (error: any) {
    logger.warn('[AgentRegistry] DB fallback lookup failed', {
      agentId,
      error: error?.message || String(error),
    });
    return null;
  }
}

export function getAllAgents(): AgentDefinition[] {
  return getActiveAgents().map(toAgentDefinition);
}

export function getAgentsByPracticeArea(practiceArea: string): AgentDefinition[] {
  const lookup = practiceArea.toLowerCase();
  return getAllAgents().filter(agent => agent.practiceArea.toLowerCase() === lookup);
}

export function getAgentsByPracticeAreaId(practiceAreaId: number): AgentDefinition[] {
  return getAllAgents().filter(agent => Number(agent.practiceAreaId) === practiceAreaId);
}

export function getAgentsByJurisdiction(jurisdiction: string): AgentDefinition[] {
  const code = jurisdiction.toUpperCase();
  return getAllAgents().filter(agent =>
    (agent.jurisdictions || []).some(value => value.toUpperCase() === code),
  );
}

export function getAgentsByTier(tier: string): AgentDefinition[] {
  return getAllAgents().filter(agent => agent.tier === tier);
}

export function getAgentsByTool(tool: string): AgentDefinition[] {
  const lookup = tool.toLowerCase();
  return getAllAgents().filter(agent =>
    agent.tools.some(value => value.toLowerCase().includes(lookup)),
  );
}

export function getAgentsByCapability(capability: string): AgentDefinition[] {
  const lookup = capability.toLowerCase();
  return getAllAgents().filter(agent =>
    agent.capabilities.some(value => value.toLowerCase().includes(lookup)),
  );
}

export function getAgentHierarchy(agentId: string): {
  agent: AgentDefinition | undefined;
  reportsTo: AgentDefinition[];
  manages: AgentDefinition[];
  collaboratesWith: AgentDefinition[];
} {
  const agent = getAgent(agentId);
  if (!agent) return { agent: undefined, reportsTo: [], manages: [], collaboratesWith: [] };

  const lookup = (ids: unknown): AgentDefinition[] =>
    Array.isArray(ids)
      ? ids
          .map(id => getAgent(String(id)))
          .filter((candidate): candidate is AgentDefinition => Boolean(candidate))
      : [];

  return {
    agent,
    reportsTo: lookup(agent.reportsTo),
    manages: lookup(agent.manages),
    collaboratesWith: lookup(agent.collaboratesWith),
  };
}

export function searchAgents(query: string): AgentDefinition[] {
  const lookup = query.toLowerCase();
  return getAllAgents().filter(agent =>
    agent.id.toLowerCase().includes(lookup) ||
    agent.name.toLowerCase().includes(lookup) ||
    agent.practiceArea.toLowerCase().includes(lookup) ||
    agent.description?.toLowerCase().includes(lookup) ||
    agent.capabilities.some(value => value.toLowerCase().includes(lookup)),
  );
}

export function getRegistryMetadata(): AgentRegistryMetadata | null {
  return ensureMetadata();
}

export function getTotalAgentCount(): number {
  return getRegistryConfig().totalAgents;
}

export function getRegistryStats(): {
  totalAgents: number;
  jurisdictions: number;
  practiceAreas: number;
  registryFormat: string;
  registryVersion: string;
  section23Coverage: number;
  byJurisdiction: Record<string, number>;
  loaded: boolean;
  romaDistribution: Record<string, number>;
  aliasCount: number;
  mcpTools: number;
  mcpCategories: number;
  topologyCatalog: number;
  archivedBackupAgents: number;
  forensicMode: boolean;
} {
  const summary = getRegistrySummary();
  const config = getRegistryConfig();
  const forensicMode = config.defaultRegistryPath.includes(JRX_ARCHIVED_REGISTRY.archiveSubdir);
  return {
    totalAgents: config.totalAgents,
    jurisdictions: summary.activeJurisdiction === 'DEFAULT' ? 1 : 2,
    practiceAreas: getPracticeAreaCount(),
    registryFormat: config.format,
    registryVersion: config.version,
    section23Coverage: config.totalAgents,
    byJurisdiction: summary.availableRegistries,
    loaded: true,
    romaDistribution: getRomaDistribution(),
    aliasCount: summary.aliasCount,
    mcpTools: JRX_MCP_TOOLS.totalTools,
    mcpCategories: JRX_MCP_TOOLS.categories,
    topologyCatalog: JRX_TOPOLOGY_CATALOG.totalTopologies,
    archivedBackupAgents: JRX_ARCHIVED_REGISTRY.totalAgentsFlat,
    forensicMode,
  };
}

/** Static fallbacks when the loader has not booted yet. */
export function getRegistryStatsFallback(): ReturnType<typeof getRegistryStats> {
  return {
    totalAgents: JRX_REGISTRY_TOTALS.totalAgents,
    jurisdictions: 1,
    practiceAreas: JRX_REGISTRY_TOTALS.practiceAreas,
    registryFormat: JRX_REGISTRY_TOTALS.registryFormat,
    registryVersion: JRX_REGISTRY_TOTALS.registryVersion,
    section23Coverage: JRX_REGISTRY_TOTALS.section23Coverage,
    byJurisdiction: { DEFAULT: JRX_REGISTRY_TOTALS.defaultAgents },
    loaded: false,
    romaDistribution: {},
    aliasCount: 0,
    mcpTools: JRX_MCP_TOOLS.totalTools,
    mcpCategories: JRX_MCP_TOOLS.categories,
    topologyCatalog: JRX_TOPOLOGY_CATALOG.totalTopologies,
    archivedBackupAgents: JRX_ARCHIVED_REGISTRY.totalAgentsFlat,
    forensicMode: false,
  };
}

export function resolveRegistryAgentId(agentId: string): string | null {
  return resolveAgentId(agentId);
}
