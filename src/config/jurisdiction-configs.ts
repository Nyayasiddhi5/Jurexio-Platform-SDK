import { createLogger } from '../utils/logger.js';
import { sortJurisdictionCatalog } from '../../shared/jrx-jurisdiction-catalog.js';
import {
  getRegistryFile,
  resolveAgentId,
  type RegistryAgent,
  type RegistryFile,
} from './agent-registry-loader.js';

const logger = createLogger('jurisdiction-configs');

export interface JurisdictionConfig {
  code: string;
  name: string;
  fullName: string;
  legalSystem: string;
  registryFile: string;
  agentCount: number;
}

export interface JurisdictionAgent extends RegistryAgent {
  originalAgentId?: string;
  jurisdiction: string;
  jurisdictionName: string;
  module: string;
  status: string;
}

export interface PracticeAreaSummary {
  id: number;
  name: string;
  slug: string;
  module: string;
  agentCount: number;
}

export interface ModuleSummary {
  code: string;
  name: string;
}

export interface JurisdictionRegistry extends RegistryFile {
  jurisdictionCode: string;
  jurisdictionName: string;
  jurisdictionFullName: string;
  legalSystem: string;
  agents: JurisdictionAgent[];
  practiceAreas: PracticeAreaSummary[];
  modules: ModuleSummary[];
}

const REGISTRY_CODES = ['IN', 'UK', 'US', 'GC', 'SG', 'EU', 'DEFAULT'] as const;
type RegistryCode = typeof REGISTRY_CODES[number];

let jurisdictionRegistries: Map<RegistryCode, JurisdictionRegistry> = new Map();
let allJurisdictionAgents: JurisdictionAgent[] = [];
let initialized = false;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function toJurisdictionAgent(agent: RegistryAgent, registry: RegistryFile, code: RegistryCode): JurisdictionAgent {
  const originalAgentId = resolveAgentId(String(agent.id)) || undefined;
  return {
    ...agent,
    originalAgentId,
    jurisdiction: code,
    jurisdictionName: String(registry.jurisdictionName || code),
    module: String(agent.category || agent.practiceArea || 'general'),
    status: String(agent.status || 'active'),
  };
}

function buildPracticeAreas(agents: JurisdictionAgent[]): PracticeAreaSummary[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = String(agent.practiceArea || agent.category || 'general');
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries()).map(([name, agentCount], index) => ({
    id: index + 1,
    name,
    slug: slugify(name),
    module: slugify(name),
    agentCount,
  }));
}

function buildModules(agents: JurisdictionAgent[]): ModuleSummary[] {
  const values = new Set<string>();
  for (const agent of agents) {
    values.add(String(agent.category || agent.practiceArea || 'general'));
  }
  return Array.from(values).map(code => ({ code, name: code }));
}

function toRegistry(code: RegistryCode, file: RegistryFile | null): JurisdictionRegistry | null {
  if (!file) return null;

  const agents = (file.agents || []).map(agent => toJurisdictionAgent(agent, file, code));
  return {
    ...file,
    jurisdictionCode: code,
    jurisdictionName: String(file.jurisdictionName || code),
    jurisdictionFullName: String(file.jurisdictionFullName || file.jurisdictionName || code),
    legalSystem: String(file.legalSystem || 'Legal system not specified'),
    agents,
    practiceAreas: buildPracticeAreas(agents),
    modules: buildModules(agents),
  };
}

export function loadAllJurisdictionRegistries(): {
  totalAgents: number;
  jurisdictions: string[];
  byJurisdiction: Record<string, number>;
} {
  if (initialized) {
    return {
      totalAgents: allJurisdictionAgents.length,
      jurisdictions: Array.from(jurisdictionRegistries.keys()),
      byJurisdiction: Object.fromEntries(
        Array.from(jurisdictionRegistries.entries()).map(([key, value]) => [key, value.totalAgents]),
      ),
    };
  }

  jurisdictionRegistries = new Map();
  allJurisdictionAgents = [];
  const byJurisdiction: Record<string, number> = {};

  for (const code of REGISTRY_CODES) {
    const registry = toRegistry(code, getRegistryFile(code));
    if (!registry) continue;
    jurisdictionRegistries.set(code, registry);
    allJurisdictionAgents.push(...registry.agents);
    byJurisdiction[code] = registry.totalAgents;
    logger.info(`[JurisdictionConfig] ${code}: ${registry.totalAgents} agents loaded [${registry.registryFormat}]`);
  }

  initialized = true;
  logger.info(
    `[JurisdictionConfig] Active registry set loaded: ${allJurisdictionAgents.length} agents across ${jurisdictionRegistries.size} files`,
  );

  return {
    totalAgents: allJurisdictionAgents.length,
    jurisdictions: Array.from(jurisdictionRegistries.keys()),
    byJurisdiction,
  };
}

function ensureLoaded(): void {
  if (!initialized) loadAllJurisdictionRegistries();
}

export function getJurisdictionRegistry(code: string): JurisdictionRegistry | null {
  ensureLoaded();
  return jurisdictionRegistries.get(code.toUpperCase() as RegistryCode) || null;
}

export function getDefaultRegistry(): JurisdictionRegistry | null {
  ensureLoaded();
  return jurisdictionRegistries.get('DEFAULT') || null;
}

export function getJurisdictionAgent(jurisdictionCode: string, agentId: string): JurisdictionAgent | null {
  ensureLoaded();
  const registry = getJurisdictionRegistry(jurisdictionCode);
  if (!registry) return null;
  const resolved = resolveAgentId(agentId) || agentId;
  return registry.agents.find(agent => agent.id === resolved || agent.originalAgentId === resolved) || null;
}

export function getAgentsByJurisdiction(jurisdictionCode: string): JurisdictionAgent[] {
  ensureLoaded();
  return getJurisdictionRegistry(jurisdictionCode)?.agents || [];
}

export function getAllJurisdictionAgents(): JurisdictionAgent[] {
  ensureLoaded();
  return allJurisdictionAgents;
}

export function getJurisdictionCodes(): string[] {
  return REGISTRY_CODES.filter(code => code !== 'DEFAULT');
}

export function getJurisdictionStats(): {
  totalAgents: number;
  jurisdictions: { code: string; name: string; agentCount: number; courts: number; statutes: number; practiceAreas: number }[];
} {
  ensureLoaded();
  return {
    totalAgents: allJurisdictionAgents.length,
    jurisdictions: sortJurisdictionCatalog(
      Array.from(jurisdictionRegistries.entries())
        .filter(([code]) => code !== 'DEFAULT')
        .map(([code, registry]) => ({
          code,
          name: registry.jurisdictionName,
          agentCount: registry.totalAgents,
          courts: 0,
          statutes: 0,
          practiceAreas: registry.practiceAreas.length,
        })),
    ),
  };
}

export function getAgentsByPracticeArea(jurisdictionCode: string, practiceAreaId: number): JurisdictionAgent[] {
  const registry = getJurisdictionRegistry(jurisdictionCode);
  if (!registry) return [];
  const practiceArea = registry.practiceAreas.find(item => item.id === practiceAreaId);
  if (!practiceArea) return [];
  return registry.agents.filter(agent => agent.practiceArea === practiceArea.name);
}

export function getAgentsByTool(jurisdictionCode: string, tool: string): JurisdictionAgent[] {
  const registry = getJurisdictionRegistry(jurisdictionCode);
  if (!registry) return [];
  const lookup = tool.toLowerCase();
  return registry.agents.filter(agent => (agent.tools || []).some(value => value.toLowerCase().includes(lookup)));
}

export function getAgentsByCapability(jurisdictionCode: string, capability: string): JurisdictionAgent[] {
  const registry = getJurisdictionRegistry(jurisdictionCode);
  if (!registry) return [];
  const lookup = capability.toLowerCase();
  return registry.agents.filter(agent =>
    (agent.capabilities || []).some(value => value.toLowerCase().includes(lookup)),
  );
}

export function getAgentHierarchy(jurisdictionCode: string, agentId: string): {
  agent: JurisdictionAgent | null;
  reportsTo: JurisdictionAgent[];
  manages: JurisdictionAgent[];
  collaboratesWith: JurisdictionAgent[];
} {
  const registry = getJurisdictionRegistry(jurisdictionCode);
  if (!registry) return { agent: null, reportsTo: [], manages: [], collaboratesWith: [] };

  const agent = getJurisdictionAgent(jurisdictionCode, agentId);
  if (!agent) return { agent: null, reportsTo: [], manages: [], collaboratesWith: [] };

  const resolveMany = (ids: unknown): JurisdictionAgent[] =>
    Array.isArray(ids)
      ? ids
          .map(id => getJurisdictionAgent(jurisdictionCode, String(id)))
          .filter((candidate): candidate is JurisdictionAgent => Boolean(candidate))
      : [];

  return {
    agent,
    reportsTo: resolveMany(agent.reportsTo),
    manages: resolveMany(agent.manages),
    collaboratesWith: resolveMany(agent.collaboratesWith),
  };
}

export function resolveJurisdictionAgent(
  agentId: string,
  jurisdictionCode?: string,
  capability?: string,
): JurisdictionAgent | null {
  ensureLoaded();

  if (jurisdictionCode) {
    const direct = getJurisdictionAgent(jurisdictionCode, agentId);
    if (direct) return direct;
  }

  const resolved = resolveAgentId(agentId) || agentId;
  const directMatch = allJurisdictionAgents.find(agent => agent.id === resolved || agent.originalAgentId === resolved);
  if (directMatch) return directMatch;

  if (capability) {
    const lookup = capability.toLowerCase();
    return (
      allJurisdictionAgents.find(agent =>
        agent.status === 'active' &&
        (agent.capabilities || []).some(value => value.toLowerCase().includes(lookup)) &&
        (!jurisdictionCode || agent.jurisdiction === jurisdictionCode.toUpperCase()),
      ) || null
    );
  }

  if (jurisdictionCode) {
    return getJurisdictionAgent('DEFAULT', agentId);
  }

  return null;
}

export function getPracticeAreas(jurisdictionCode?: string): PracticeAreaSummary[] {
  const registry = getJurisdictionRegistry(jurisdictionCode?.toUpperCase() || 'DEFAULT');
  return registry?.practiceAreas || [];
}

export function getModules(jurisdictionCode?: string): ModuleSummary[] {
  const registry = getJurisdictionRegistry(jurisdictionCode?.toUpperCase() || 'DEFAULT');
  return registry?.modules || [];
}
