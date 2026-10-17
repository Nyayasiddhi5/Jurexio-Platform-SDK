import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../utils/logger.js';
import {
  ALLOWED_JURISDICTIONS,
  type JurisdictionCode,
  REGISTRY_VERSION,
  getAliasMapPath,
  getRegistryDir,
  getRegistryPath,
} from './registry-paths.js';

const logger = createLogger('agent-registry-loader');

export type ActiveJurisdictionCode = Exclude<JurisdictionCode, 'Default'> | 'DEFAULT';
export type RegistryFileCode = JurisdictionCode;

export interface RegistryAgent {
  id: string;
  name: string;
  version?: string;
  tier?: string;
  romaLevel?: string;
  category?: string;
  practiceArea?: string;
  description?: string;
  systemPrompt?: string;
  capabilities?: string[];
  tools?: string[];
  protocols?: string[];
  preferredModels?: string[];
  fallbackModels?: string[];
  securityLevel?: string;
  supportedLanguages?: string[];
  guardrails?: Record<string, unknown>;
  costOptimization?: Record<string, unknown>;
  compliance?: Record<string, unknown>;
  quantumReady?: Record<string, unknown>;
  slmBinding?: Record<string, unknown>;
  ragNamespaces?: string[];
  hitlConfig?: Record<string, unknown>;
  jurisdictionActivation?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegistryFile {
  registryFormat: string;
  registryVersion: string;
  generatedAt?: string;
  platformVersion?: string;
  jurisdictionCode?: string;
  jurisdictionName?: string;
  jurisdictionFullName?: string;
  legalSystem?: string;
  totalAgents: number;
  sdkVersion?: string;
  romaDistribution?: Record<string, number>;
  agents: RegistryAgent[];
  [key: string]: unknown;
}

export interface RegistryLoaderConfig {
  version: string;
  format: string;
  totalAgents: number;
  primaryJurisdiction: ActiveJurisdictionCode;
  defaultRegistryPath: string;
  overlayRegistryPath: string | null;
  aliasCount: number;
  availableRegistries: Record<string, number>;
}

interface AliasPayload {
  version?: string;
  aliases?: Record<string, string>;
}

interface CacheState {
  defaultRegistry: RegistryFile;
  overlays: Map<ActiveJurisdictionCode, RegistryFile>;
  aliases: Map<string, string>;
  activeJurisdiction: ActiveJurisdictionCode;
  activeAgents: Map<string, RegistryAgent>;
  config: RegistryLoaderConfig;
}

let cache: CacheState | null = null;

function normalizeJurisdiction(input?: string | null): ActiveJurisdictionCode {
  const value = String(input || '').trim().toUpperCase();
  switch (value) {
    case 'IN':
    case 'UK':
    case 'US':
    case 'EU':
    case 'GC':
    case 'SG':
      return value;
    default:
      return 'DEFAULT';
  }
}

function toFileJurisdiction(code: ActiveJurisdictionCode): RegistryFileCode {
  return code === 'DEFAULT' ? 'Default' : code;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function replaceSection3Prompt(defaultPrompt: string | undefined, overlayPrompt: string | undefined): string | undefined {
  if (!defaultPrompt || !overlayPrompt) return overlayPrompt || defaultPrompt;

  const startTag = '<section_3_jurisdiction>';
  const endTag = '</section_3_jurisdiction>';
  const defaultStart = defaultPrompt.indexOf(startTag);
  const defaultEnd = defaultPrompt.indexOf(endTag);
  const overlayStart = overlayPrompt.indexOf(startTag);
  const overlayEnd = overlayPrompt.indexOf(endTag);

  if (defaultStart === -1 || defaultEnd === -1 || overlayStart === -1 || overlayEnd === -1) {
    return overlayPrompt;
  }

  const before = defaultPrompt.slice(0, defaultStart + startTag.length);
  const overlayBody = overlayPrompt.slice(overlayStart + startTag.length, overlayEnd);
  const after = defaultPrompt.slice(defaultEnd);
  return `${before}${overlayBody}${after}`;
}

function mergeAgent(defaultAgent: RegistryAgent, overlayAgent?: RegistryAgent): RegistryAgent {
  if (!overlayAgent) return { ...defaultAgent };

  return {
    ...defaultAgent,
    systemPrompt: replaceSection3Prompt(defaultAgent.systemPrompt, overlayAgent.systemPrompt),
    slmBinding: overlayAgent.slmBinding ?? defaultAgent.slmBinding,
    ragNamespaces: overlayAgent.ragNamespaces ?? defaultAgent.ragNamespaces,
    hitlConfig: overlayAgent.hitlConfig ?? defaultAgent.hitlConfig,
    jurisdictionActivation: overlayAgent.jurisdictionActivation ?? defaultAgent.jurisdictionActivation,
  };
}

function buildAliasMap(): Map<string, string> {
  const aliases = new Map<string, string>();
  const aliasPath = getAliasMapPath();
  if (!fs.existsSync(aliasPath)) return aliases;

  const payload = readJsonFile<AliasPayload>(aliasPath);
  for (const [legacyId, canonicalId] of Object.entries(payload.aliases || {})) {
    aliases.set(legacyId, canonicalId);
    aliases.set(legacyId.toLowerCase(), canonicalId);
  }
  return aliases;
}

function buildActiveAgents(
  defaultRegistry: RegistryFile,
  overlayRegistry: RegistryFile | null,
): Map<string, RegistryAgent> {
  const overlayById = new Map<string, RegistryAgent>(
    (overlayRegistry?.agents || []).map(agent => [String(agent.id), agent]),
  );

  const active = new Map<string, RegistryAgent>();
  for (const agent of defaultRegistry.agents || []) {
    active.set(String(agent.id), mergeAgent(agent, overlayById.get(String(agent.id))));
  }
  return active;
}

function buildConfig(
  defaultRegistry: RegistryFile,
  activeJurisdiction: ActiveJurisdictionCode,
  overlays: Map<ActiveJurisdictionCode, RegistryFile>,
  aliases: Map<string, string>,
): RegistryLoaderConfig {
  const availableRegistries: Record<string, number> = {
    DEFAULT: defaultRegistry.agents.length,
  };

  for (const [code, overlay] of overlays.entries()) {
    availableRegistries[code] = overlay.agents.length;
  }

  return {
    version: defaultRegistry.registryVersion || REGISTRY_VERSION,
    format: defaultRegistry.registryFormat,
    totalAgents: defaultRegistry.agents.length,
    primaryJurisdiction: activeJurisdiction,
    defaultRegistryPath: resolveRegistryFilePath('Default'),
    overlayRegistryPath:
      activeJurisdiction === 'DEFAULT' ? null : resolveRegistryFilePath(toFileJurisdiction(activeJurisdiction)),
    aliasCount: aliases.size,
    availableRegistries,
  };
}

function isForensicMode(): boolean {
  const value = String(process.env.NV_REGISTRY_FORENSIC_MODE || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * NV-REGISTRY-SNAPSHOT-001 — simple production rollback to a timestamped backup
 * without forensic 1042-agent mode.
 *
 *   NV_REGISTRY_SNAPSHOT=live                    → current registries (default)
 *   NV_REGISTRY_SNAPSHOT=20260730T0750Z          → config/agent-registries/backups/<stamp>/
 *   NV_REGISTRY_SNAPSHOT=backup:20260730T0750Z   → same
 *   NV_REGISTRY_FORENSIC_MODE=1                  → archive/v5.0.0 (1042 agents; NOT default)
 *
 * LLM preferredModels from the loaded snapshot drive Queen routing. To ignore
 * registry preferredModels and use Bedrock-first policy only:
 *   NYV_IGNORE_REGISTRY_PREFERRED_MODELS=1
 */
function resolveRegistrySnapshotDir(): string | null {
  const raw = String(process.env.NV_REGISTRY_SNAPSHOT || 'live').trim();
  if (!raw || raw.toLowerCase() === 'live' || raw === '0' || raw === 'current') return null;
  const stamp = raw.replace(/^backup:/i, '').trim();
  if (!stamp || stamp.toLowerCase() === 'forensic') return null;
  const dir = path.join(getRegistryDir(), 'backups', stamp);
  if (!fs.existsSync(dir)) {
    logger.warn('[AgentRegistryLoader] NV_REGISTRY_SNAPSHOT dir missing — falling back to live', { stamp, dir });
    return null;
  }
  return dir;
}

function resolveRegistryFilePath(jurisdiction: RegistryFileCode): string {
  if (isForensicMode()) {
    return path.join(getRegistryArchiveDir(), `Jurexio-Legal-registry-${jurisdiction}.json`);
  }
  const snapshotDir = resolveRegistrySnapshotDir();
  if (snapshotDir) {
    const snapPath = path.join(snapshotDir, `Jurexio-Legal-registry-${jurisdiction}.json`);
    if (fs.existsSync(snapPath)) return snapPath;
  }
  return getRegistryPath(jurisdiction);
}

function buildCache(): CacheState {
  const forensicMode = isForensicMode();
  if (forensicMode) {
    logger.warn('[AgentRegistryLoader] NV_REGISTRY_FORENSIC_MODE active — loading archived v5.0.0 backup registries (NOT production runtime default)');
  }

  const defaultRegistry = readJsonFile<RegistryFile>(resolveRegistryFilePath('Default'));
  const overlays = new Map<ActiveJurisdictionCode, RegistryFile>();

  for (const jurisdiction of ALLOWED_JURISDICTIONS) {
    if (jurisdiction === 'Default') continue;
    const filePath = resolveRegistryFilePath(jurisdiction);
    if (fs.existsSync(filePath)) {
      overlays.set(jurisdiction, readJsonFile<RegistryFile>(filePath));
    }
  }

  const aliases = buildAliasMap();
  const activeJurisdiction = normalizeJurisdiction(
    process.env.NV_PRIMARY_JURISDICTION
      || (process.env.NODE_ENV === 'production' || process.env.NYV_FORCE_INDIA_REGISTRY === '1'
        ? 'IN'
        : undefined),
  );
  const activeOverlay = activeJurisdiction === 'DEFAULT' ? null : overlays.get(activeJurisdiction) || null;
  const activeAgents = buildActiveAgents(defaultRegistry, activeOverlay);
  const config = buildConfig(defaultRegistry, activeJurisdiction, overlays, aliases);

  logger.info('[AgentRegistryLoader] Active registry ready', {
    version: config.version,
    format: config.format,
    totalAgents: config.totalAgents,
    primaryJurisdiction: config.primaryJurisdiction,
    overlayEnabled: Boolean(config.overlayRegistryPath),
    aliasCount: config.aliasCount,
  });

  return {
    defaultRegistry,
    overlays,
    aliases,
    activeJurisdiction,
    activeAgents,
    config,
  };
}

function ensureCache(): CacheState {
  if (!cache) cache = buildCache();
  return cache;
}

export function resetRegistryLoaderCache(): void {
  cache = null;
}

export function resolveAgentId(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const lookup = String(agentId).trim();
  if (!lookup) return null;

  // Hard aliases for deep / snake_case review ids (SDK signature guardrail).
  // Keeps guardrail: maps to canonical agent, does not disable policy checks.
  const HARD_ALIASES: Record<string, string> = {
    'contract-review-deep': 'contract-reviewer',
    'contract_review_deep': 'contract-reviewer',
    'contract_review': 'contract-reviewer',
    'document-review': 'contract-reviewer',
    'document_review': 'contract-reviewer',
    'document-review-deep': 'contract-reviewer',
    // NV-AGENT-ALIAS-OPTIONAL-001 — legacy NSP keys (NSP keeps remaps; aliases for other products)
    hearing: 'court-advocate',
    'hearing-prep-specialist': 'court-advocate',
    'hearing_prep_specialist': 'court-advocate',
    'task-manager': 'legal-project-manager',
    task_manager: 'legal-project-manager',
    'doc-comparator-agent': 'legal-analyst',
    doc_comparator_agent: 'legal-analyst',
  };
  const hard = HARD_ALIASES[lookup] || HARD_ALIASES[lookup.toLowerCase()];
  if (hard) {
    const stateHard = ensureCache();
    if (stateHard.activeAgents.has(hard)) return hard;
    // Even if registry uses a different id, prefer the alias target for routing.
    return hard;
  }

  const state = ensureCache();
  if (state.activeAgents.has(lookup)) return lookup;
  if (state.activeAgents.has(lookup.toUpperCase())) return lookup.toUpperCase();
  return state.aliases.get(lookup) || state.aliases.get(lookup.toLowerCase()) || null;
}

export function getActiveAgents(): RegistryAgent[] {
  return Array.from(ensureCache().activeAgents.values());
}

export function getAgent(agentId: string | undefined | null): RegistryAgent | undefined {
  const resolvedId = resolveAgentId(agentId);
  if (!resolvedId) return undefined;
  return ensureCache().activeAgents.get(resolvedId);
}

export function getRegistryConfig(): RegistryLoaderConfig {
  return ensureCache().config;
}

export function getRegistryFile(code: ActiveJurisdictionCode): RegistryFile | null {
  const state = ensureCache();
  if (code === 'DEFAULT') return state.defaultRegistry;
  return state.overlays.get(code) || null;
}

export function getRegistryFileByCode(code?: string | null): RegistryFile | null {
  return getRegistryFile(normalizeJurisdiction(code));
}

export function getAvailableRegistryCodes(): ActiveJurisdictionCode[] {
  const state = ensureCache();
  return ['DEFAULT', ...Array.from(state.overlays.keys())];
}

export function getRomaDistribution(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const agent of getActiveAgents()) {
    const key = String(agent.romaLevel || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function getPracticeAreaCount(): number {
  return new Set(getActiveAgents().map(agent => String(agent.practiceArea || '')).filter(Boolean)).size;
}

export function getRegistrySummary(): {
  totalAgents: number;
  activeJurisdiction: ActiveJurisdictionCode;
  availableRegistries: Record<string, number>;
  aliasCount: number;
  romaDistribution: Record<string, number>;
} {
  const config = getRegistryConfig();
  return {
    totalAgents: config.totalAgents,
    activeJurisdiction: config.primaryJurisdiction,
    availableRegistries: config.availableRegistries,
    aliasCount: config.aliasCount,
    romaDistribution: getRomaDistribution(),
  };
}

export function getRegistryArchiveDir(): string {
  return path.join(path.dirname(getRegistryPath('Default')), 'archive', 'v5.0.0');
}
