import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-jurisdiction-prompt-resolver');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRIES_DIR = path.join(__dirname, '../../config/agent-registries');

export type JurisdictionCode = 'IN' | 'UK' | 'US' | 'EU' | 'SG' | 'GC' | 'DEFAULT';

export const SUPPORTED_JURISDICTIONS: JurisdictionCode[] = ['IN', 'UK', 'US', 'EU', 'SG', 'GC', 'DEFAULT'];
export const NON_DEFAULT_JURISDICTIONS: JurisdictionCode[] = ['IN', 'UK', 'US', 'EU', 'SG', 'GC'];

export interface ResolvedPrompt {
  prompt: string;
  agentId: string;
  jurisdiction: JurisdictionCode;
  promptBytes: number;
  sectionCount: number;
}

export interface ResolverStats {
  initialized: boolean;
  initializedAt: string | null;
  totalPrompts: number;
  perJurisdiction: Record<JurisdictionCode, number>;
  cacheBytes: number;
}

export class PromptNotFoundError extends Error {
  readonly agentId: string;
  readonly jurisdiction: JurisdictionCode;
  readonly availableJurisdictions: JurisdictionCode[];

  constructor(agentId: string, jurisdiction: JurisdictionCode, available: JurisdictionCode[] = []) {
    super(
      `[JurisdictionPromptResolver] No prompt found for agentId="${agentId}" jurisdiction="${jurisdiction}". ` +
      `Available jurisdictions for this agent: [${available.join(', ')}]. ` +
      `This agent may be a platform-internal agent without a v3 23-section prompt.`,
    );
    this.name = 'PromptNotFoundError';
    this.agentId = agentId;
    this.jurisdiction = jurisdiction;
    this.availableJurisdictions = available;
  }
}

const REGISTRY_FILES: Record<JurisdictionCode, string> = {
  IN:      'Jurexio-Legal-registry-IN.json',
  UK:      'Jurexio-Legal-registry-UK.json',
  US:      'Jurexio-Legal-registry-US.json',
  EU:      'Jurexio-Legal-registry-EU.json',
  SG:      'Jurexio-Legal-registry-SG.json',
  GC:      'Jurexio-Legal-registry-GC.json',
  DEFAULT: 'Jurexio-Legal-registry-Default.json',
};

// v5.0.0 renamed §22 to "Version and SLM Binding"; legacy v3 used "behavioral".
// Diagnostic marker only — actual gating is by section count + registry format.
const REQUIRED_SECTION_TAG_V5 = '<section_22_version_slm>';
const REQUIRED_SECTION_TAG_V3 = '<section_22_behavioral>';

interface RegistryAgent {
  id: string;
  originalAgentId?: string;
  systemPrompt?: string;
  name?: string;
  jurisdiction?: string;
}

interface RegistryFile {
  registryFormat?: string;
  jurisdictionCode?: string;
  totalAgents?: number;
  agents: RegistryAgent[];
}

export class JurisdictionPromptResolver {
  private static instance: JurisdictionPromptResolver | null = null;

  private cache: Map<JurisdictionCode, Map<string, ResolvedPrompt>> = new Map();
  private initialized = false;
  private initializedAt: string | null = null;
  private initPromise: Promise<void> | null = null;
  private cacheBytes = 0;

  private constructor() {}

  static getInstance(): JurisdictionPromptResolver {
    if (!JurisdictionPromptResolver.instance) {
      JurisdictionPromptResolver.instance = new JurisdictionPromptResolver();
    }
    return JurisdictionPromptResolver.instance;
  }

  /**
   * Idempotent eager-load of all 7 registry files into memory.
   * Safe to call concurrently — subsequent callers await the same promise.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<void> {
    const startMs = Date.now();
    let totalPrompts = 0;

    for (const juris of SUPPORTED_JURISDICTIONS) {
      const filename = REGISTRY_FILES[juris];
      const filePath = path.join(REGISTRIES_DIR, filename);

      if (!fs.existsSync(filePath)) {
        throw new Error(
          `[JurisdictionPromptResolver] Required registry file missing: ${filePath}. ` +
          `Cannot start without all 7 jurisdiction registries.`,
        );
      }

      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as RegistryFile;

      // v5.0.0 GA: accept v3 legacy formats AND the new v5 governed-execution-network format.
      // v5 format ships the §0 Security Constitution + §1-§22 = 23 XML sections per agent
      // with v5 topic semantics (citation moved §10→§6, PII at §10, Version+SLM at §22).
      const ALLOWED_FORMATS = new Set([
        'v3-full-22section',
        'v3-full-23section',
        'v5-governed-execution-network-nyayasiddhi-comprehensive',
        'v5.1.0-governed-execution-network-format-b',
      ]);
      if (!ALLOWED_FORMATS.has(data.registryFormat ?? '')) {
        throw new Error(
          `[JurisdictionPromptResolver] Registry ${filename} has unexpected format ` +
          `"${data.registryFormat}" (expected one of: ${Array.from(ALLOWED_FORMATS).join(', ')}).`,
        );
      }
      const isV5 =
        data.registryFormat === 'v5-governed-execution-network-nyayasiddhi-comprehensive' ||
        data.registryFormat === 'v5.1.0-governed-execution-network-format-b';
      const expectedSections =
        isV5 ? 23 : (data.registryFormat === 'v3-full-23section' ? 23 : 22);
      // Diagnostic ref — keep both markers in scope so analyzers don't flag them as unused.
      void REQUIRED_SECTION_TAG_V3; void REQUIRED_SECTION_TAG_V5;

      const agentMap = new Map<string, ResolvedPrompt>();
      let bytesForJur = 0;

      for (const agent of data.agents) {
        const key = (agent.originalAgentId ?? agent.id ?? '').trim();
        if (!key) {
          logger.warn({ msg: 'agent missing originalAgentId/id, skipped', file: filename });
          continue;
        }

        const prompt = (agent.systemPrompt ?? '').trim();
        if (!prompt) {
          throw new Error(
            `[JurisdictionPromptResolver] Agent "${key}" in ${filename} has empty systemPrompt. ` +
            `All v3 agents must ship with a populated 23-section prompt (legacy 22-section also accepted).`,
          );
        }

        // Tolerate digits in topic names (e.g., section_20_a2a_handoff) for v5 forward-compat.
        const sectionCount = (prompt.match(/<section_\d+_[a-z0-9_]+>/g) ?? []).length;
        // Section integrity invariant — the whole point of the v3 schema. ns-queen ships with
        // a special short prompt (no full section structure); whitelist it. Anything else with
        // a section count not matching the registry's declared format is a corrupt registry
        // and we refuse to serve it. expectedSections is 22 for v3-full-22section, 23 for
        // v3-full-23section (post Phase-C Data Privacy & PII Redaction Charter add).
        const isShortPromptAgent = key === 'ns-queen';
        if (!isShortPromptAgent && sectionCount !== expectedSections) {
          throw new Error(
            `[JurisdictionPromptResolver] Agent "${key}" in ${filename} has ${sectionCount} sections (expected exactly ${expectedSections} for format ${data.registryFormat}). ` +
            `Registry is corrupt; refusing to load.`,
          );
        }

        agentMap.set(key, {
          prompt,
          agentId: key,
          jurisdiction: juris,
          promptBytes: Buffer.byteLength(prompt, 'utf-8'),
          sectionCount,
        });
        bytesForJur += Buffer.byteLength(prompt, 'utf-8');
      }

      this.cache.set(juris, agentMap);
      this.cacheBytes += bytesForJur;
      totalPrompts += agentMap.size;

      logger.info({
        msg: 'loaded jurisdiction registry',
        jurisdiction: juris,
        agentCount: agentMap.size,
        cacheBytesMB: (bytesForJur / 1_000_000).toFixed(2),
      });
    }

    this.initialized = true;
    this.initializedAt = new Date().toISOString();

    logger.info({
      msg: 'JurisdictionPromptResolver ready',
      totalPrompts,
      jurisdictions: SUPPORTED_JURISDICTIONS.length,
      cacheBytesMB: (this.cacheBytes / 1_000_000).toFixed(2),
      loadMs: Date.now() - startMs,
    });
  }

  /**
   * Resolve a 23-section system prompt for the given agent + jurisdiction
   * (legacy 22-section registries are still accepted; see ALLOWED_FORMATS).
   * Throws PromptNotFoundError if not present (no silent fallback by design).
   */
  resolvePrompt(agentId: string, jurisdiction: JurisdictionCode): ResolvedPrompt {
    if (!this.initialized) {
      throw new Error('[JurisdictionPromptResolver] init() must complete before resolvePrompt(). Call await resolver.init() at startup.');
    }

    const jurMap = this.cache.get(jurisdiction);
    if (!jurMap) {
      throw new PromptNotFoundError(agentId, jurisdiction, []);
    }

    const hit = jurMap.get(agentId);
    if (hit) return hit;

    // Compute which jurisdictions DO have this agent — useful in the error.
    const available: JurisdictionCode[] = [];
    for (const j of SUPPORTED_JURISDICTIONS) {
      if (this.cache.get(j)?.has(agentId)) available.push(j);
    }
    throw new PromptNotFoundError(agentId, jurisdiction, available);
  }

  /**
   * Non-throwing variant for callers that want to handle missing prompts inline
   * (e.g., the 3 platform-internal agents like case-brief-generator).
   */
  tryResolvePrompt(agentId: string, jurisdiction: JurisdictionCode): ResolvedPrompt | null {
    try {
      return this.resolvePrompt(agentId, jurisdiction);
    } catch (e: any) {
      if (e instanceof PromptNotFoundError) return null;
      throw e;
    }
  }

  hasPrompt(agentId: string, jurisdiction: JurisdictionCode): boolean {
    return this.cache.get(jurisdiction)?.has(agentId) ?? false;
  }

  getStats(): ResolverStats {
    const perJurisdiction = {} as Record<JurisdictionCode, number>;
    let totalPrompts = 0;
    for (const j of SUPPORTED_JURISDICTIONS) {
      const count = this.cache.get(j)?.size ?? 0;
      perJurisdiction[j] = count;
      totalPrompts += count;
    }
    return {
      initialized: this.initialized,
      initializedAt: this.initializedAt,
      totalPrompts,
      perJurisdiction,
      cacheBytes: this.cacheBytes,
    };
  }

  /** Test-only — reset singleton state. Do not call in production code. */
  static __resetForTests(): void {
    JurisdictionPromptResolver.instance = null;
  }
}

export const jurisdictionPromptResolver = JurisdictionPromptResolver.getInstance();
