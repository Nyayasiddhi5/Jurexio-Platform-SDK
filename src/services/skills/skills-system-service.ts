/**
 * Jurexio Skills System Service v3.1.2
 * NYV-SVC-SKILLS-SYSTEM-001
 *
 * Skills System enables AI agents to acquire, share, and evolve specialized
 * legal skills dynamically. Unlike static system prompts, Skills are:
 *   - Composable: Multiple skills can be composed for complex tasks
 *   - Versioned: Each skill has a version and update history
 *   - Jurisdiction-aware: Skills adapt based on jurisdiction context
 *   - Performance-tracked: Usage metrics and quality scores tracked per skill
 *   - Marketplace-ready: Skills can be shared across SDK applications
 *
 * Skill Categories:
 *   - Legal Research: Case law retrieval, statute interpretation
 *   - Document Drafting: Contract, pleading, notice generation
 *   - Compliance Checking: Jurisdiction-specific compliance rules
 *   - Negotiation: Settlement, mediation, arbitration guidance
 *   - Litigation: Court procedure, evidence, trial strategy
 *   - Advisory: Client counselling, risk assessment
 *   - Regulatory: Filing, compliance, reporting
 */

import { logger } from '../../utils/logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type SkillCategory =
  | 'legal-research'
  | 'document-drafting'
  | 'compliance-checking'
  | 'negotiation'
  | 'litigation'
  | 'advisory'
  | 'regulatory'
  | 'tax'
  | 'ip-patent'
  | 'corporate-governance'
  | 'criminal-defense'
  | 'family-law'
  | 'real-estate'
  | 'arbitration'
  | 'cross-border';

export type SkillTier = 'basic' | 'professional' | 'expert' | 'sovereign';

export interface LegalSkill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  tier: SkillTier;
  version: string;
  author: string;
  jurisdictions: string[];          // Which jurisdictions this skill applies to
  practiceAreas: string[];
  systemPromptDelta: string;        // Prompt enhancement to inject
  toolRequirements: string[];       // Required MCP tools
  slmPreference?: string;           // Preferred SLM binding (e.g., 'NS-SLM-IND')
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  metrics: SkillMetrics;
  tags: string[];
  isPublic: boolean;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillMetrics {
  usageCount: number;
  averageQualityScore: number;      // 0–100
  averageResponseTime: number;      // ms
  successRate: number;              // 0–1
  userRating: number;               // 1–5
  jurisdictionPerformance: Record<string, number>;   // jurisdiction → quality score
}

export interface SkillComposition {
  id: string;
  name: string;
  skills: string[];                 // Ordered list of skill IDs
  executionMode: 'sequential' | 'parallel' | 'conditional';
  conditions?: Array<{
    skillId: string;
    condition: string;
    nextSkillId: string;
  }>;
}

export interface SkillActivationContext {
  agentId: string;
  jurisdiction: string;
  practiceArea: string;
  tier: 'solo' | 'plus' | 'pro' | 'enterprise';
  taskType: string;
  userId?: string;
  /**
   * NYV-WL-001 (round 10d): explicit first-class white-label exposure
   * flag. When true, getCapabilitiesForContext() escalates the tier to
   * the manifest's `white-label` surface regardless of billing tier so
   * white-label tenants get the full re-brandable capability set.
   */
  whiteLabel?: boolean;
}

export interface SkillActivationResult {
  activatedSkills: LegalSkill[];
  composedPromptDelta: string;
  requiredTools: string[];
  slmBinding?: string;
  estimatedQualityBoost: number;    // expected quality improvement %
}

// ──────────────────────────────────────────────────────────────────────────────
// Built-in Core Skills Library (BAKED IN — not DB-dependent)
// ──────────────────────────────────────────────────────────────────────────────

const CORE_SKILLS: LegalSkill[] = [
  {
    id: 'skill-legal-research-india',
    name: 'India Legal Research Expert',
    description: 'Deep legal research capability for Indian law — BNS, BNSS, BSA, Supreme Court judgments, High Court precedents across all 25 High Courts',
    category: 'legal-research',
    tier: 'expert',
    version: '3.1.2',
    author: 'nyayavigya-core',
    jurisdictions: ['IN'],
    practiceAreas: ['all'],
    systemPromptDelta: `You are an expert Indian legal researcher with deep knowledge of:
- BNS 2023, BNSS 2023, BSA 2023 (replacing IPC, CrPC, Evidence Act)
- Constitution of India and fundamental rights jurisprudence
- Supreme Court and High Court precedents from Indian Kanoon
- CPC, Limitation Act, Specific Relief Act
- Companies Act 2013, DPDPA 2023, Income Tax Act 1961
Always cite specific sections and relevant precedents. Use Indian legal citation format (AIR, SCC).`,
    toolRequirements: ['NYV-MCP-SEARCH-001', 'NYV-MCP-DOC-001'],
    slmPreference: 'NS-SLM-IND',
    romaLevel: 'L5',
    metrics: { usageCount: 0, averageQualityScore: 92, averageResponseTime: 1200, successRate: 0.96, userRating: 4.8, jurisdictionPerformance: { IN: 92 } },
    tags: ['india', 'research', 'bns', 'supreme-court'],
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-04-01'),
  },
  {
    id: 'skill-contract-drafting-cross',
    name: 'Cross-Jurisdiction Contract Drafter',
    description: 'Expert contract drafting across all 6 Jurexio jurisdictions — NDA, MSA, SaaS agreements, employment contracts, joint ventures',
    category: 'document-drafting',
    tier: 'expert',
    version: '3.1.2',
    author: 'nyayavigya-core',
    jurisdictions: ['IN', 'UK', 'GC', 'EU', 'US', 'SG'],
    practiceAreas: ['contract', 'corporate', 'employment'],
    systemPromptDelta: `You are an expert contract drafter across 6 global jurisdictions.
For each contract:
1. Identify applicable jurisdiction(s) and governing law
2. Include jurisdiction-specific mandatory clauses
3. Flag potential cross-border compliance issues
4. Use precise legal language with defined terms
5. Structure: Recitals → Definitions → Operative Clauses → Boilerplate
Always note which provisions are jurisdiction-specific and why.`,
    toolRequirements: ['NYV-MCP-DOC-001'],
    romaLevel: 'L5',
    metrics: { usageCount: 0, averageQualityScore: 90, averageResponseTime: 1800, successRate: 0.94, userRating: 4.7, jurisdictionPerformance: { IN: 90, UK: 88, EU: 87, US: 91, SG: 89, GC: 86 } },
    tags: ['contract', 'drafting', 'cross-border', 'nda', 'msa'],
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-04-01'),
  },
  {
    id: 'skill-gdpr-compliance',
    name: 'GDPR / UK GDPR Compliance Expert',
    description: 'Comprehensive GDPR and UK GDPR compliance guidance — DPIAs, SCCs, RoPA, breach notification, DSARs, adequacy decisions',
    category: 'compliance-checking',
    tier: 'professional',
    version: '3.1.2',
    author: 'nyayavigya-core',
    jurisdictions: ['EU', 'UK'],
    practiceAreas: ['compliance', 'data-protection', 'privacy'],
    systemPromptDelta: `You are a GDPR and UK GDPR compliance expert.
Apply: GDPR (EU) 2016/679 and UK GDPR (Data Protection Act 2018).
Always check: lawful basis, data minimisation, purpose limitation, storage limitation, data subject rights, DPO requirements, DPIAs, breach notification (72-hour rule), international transfers (adequacy/SCCs/BCRs).
Distinguish EU GDPR vs UK GDPR post-Brexit for cross-border scenarios.`,
    toolRequirements: ['NYV-MCP-SEARCH-001'],
    slmPreference: 'NS-SLM-EUR',
    romaLevel: 'L4',
    metrics: { usageCount: 0, averageQualityScore: 93, averageResponseTime: 1000, successRate: 0.97, userRating: 4.9, jurisdictionPerformance: { EU: 93, UK: 91 } },
    tags: ['gdpr', 'uk-gdpr', 'data-protection', 'compliance', 'privacy'],
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-04-01'),
  },
  {
    id: 'skill-litigation-india',
    name: 'Indian Litigation Strategy Expert',
    description: 'Complete litigation support for Indian courts — pleading drafting, evidence, procedural strategy, High Court and Supreme Court practice',
    category: 'litigation',
    tier: 'expert',
    version: '3.1.2',
    author: 'nyayavigya-core',
    jurisdictions: ['IN'],
    practiceAreas: ['litigation', 'criminal', 'civil', 'constitutional'],
    systemPromptDelta: `You are an expert Indian litigation strategist with experience across District Courts, High Courts, and the Supreme Court of India.
Expertise: BNSS 2023 procedural requirements, BNS 2023 criminal provisions, CPC civil procedure, SLPs, writ petitions, criminal appeals, interlocutory applications, bail applications, anticipatory bail under BNSS.
Always identify: jurisdiction, limitation periods, proper forum, cause of action, applicable remedies.`,
    toolRequirements: ['NYV-MCP-SEARCH-001', 'NYV-MCP-DOC-001'],
    slmPreference: 'NS-SLM-IND',
    romaLevel: 'L5',
    metrics: { usageCount: 0, averageQualityScore: 91, averageResponseTime: 1400, successRate: 0.95, userRating: 4.7, jurisdictionPerformance: { IN: 91 } },
    tags: ['litigation', 'india', 'high-court', 'supreme-court', 'criminal', 'civil'],
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-04-01'),
  },
  {
    id: 'skill-us-corporate',
    name: 'US Corporate & Securities Law Expert',
    description: 'US corporate governance, M&A, securities regulation, SEC filings, Delaware corporate law, startup legal structures',
    category: 'corporate-governance',
    tier: 'expert',
    version: '3.1.2',
    author: 'nyayavigya-core',
    jurisdictions: ['US'],
    practiceAreas: ['corporate', 'securities', 'ma', 'startup'],
    systemPromptDelta: `You are a US corporate and securities law expert.
Expertise: Delaware General Corporation Law, SEC regulations (17 CFR), Securities Act 1933, Securities Exchange Act 1934, SOX compliance, M&A deal structures (asset purchase vs stock purchase), cap table management, 409A valuations, term sheets, SAFE notes.
Always identify: state of incorporation, SEC reporting obligations, fiduciary duties, anti-takeover provisions.`,
    toolRequirements: ['NYV-MCP-SEARCH-001'],
    slmPreference: 'NS-SLM-USA',
    romaLevel: 'L4',
    metrics: { usageCount: 0, averageQualityScore: 89, averageResponseTime: 1100, successRate: 0.93, userRating: 4.6, jurisdictionPerformance: { US: 89 } },
    tags: ['us', 'corporate', 'securities', 'sec', 'delaware', 'ma', 'startup'],
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-04-01'),
  },
  {
    id: 'skill-arbitration-international',
    name: 'International Arbitration Expert',
    description: 'ICC, SIAC, LCIA, DIFC-LCIA and UNCITRAL arbitration rules — seat selection, emergency arbitration, enforcement, investor-state disputes',
    category: 'arbitration',
    tier: 'sovereign',
    version: '3.1.2',
    author: 'nyayavigya-core',
    jurisdictions: ['IN', 'UK', 'GC', 'EU', 'US', 'SG'],
    practiceAreas: ['arbitration', 'international-dispute', 'investment'],
    systemPromptDelta: `You are an international arbitration expert.
Rules expertise: ICC Rules 2021, SIAC Rules 2016, LCIA Rules 2020, DIFC-LCIA Rules, UNCITRAL Rules 2013, Arbitration and Conciliation Act 1996 (India), NY Convention 1958, ICSID Convention.
Always address: seat vs venue distinction, applicable law, emergency arbitrator, interim measures, challenge of arbitrators, enforcement of awards across jurisdictions.`,
    toolRequirements: ['NYV-MCP-SEARCH-001', 'NYV-MCP-DOC-001'],
    romaLevel: 'L5',
    metrics: { usageCount: 0, averageQualityScore: 94, averageResponseTime: 1500, successRate: 0.96, userRating: 4.9, jurisdictionPerformance: { IN: 92, UK: 93, GC: 91, EU: 94, US: 93, SG: 95 } },
    tags: ['arbitration', 'icc', 'siac', 'lcia', 'international', 'enforcement'],
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-04-01'),
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Skills System Service
// ──────────────────────────────────────────────────────────────────────────────

export class SkillsSystemService {
  private static instance: SkillsSystemService;
  private readonly skills = new Map<string, LegalSkill>();
  private readonly compositions = new Map<string, SkillComposition>();

  private constructor() {
    // Load core built-in skills
    for (const skill of CORE_SKILLS) {
      this.skills.set(skill.id, skill);
    }
    logger.info('[SkillsSystem] Skills System initialized', { coreSkills: CORE_SKILLS.length });
  }

  static getInstance(): SkillsSystemService {
    if (!SkillsSystemService.instance) {
      SkillsSystemService.instance = new SkillsSystemService();
    }
    return SkillsSystemService.instance;
  }

  /**
   * Auto-select and activate the best skills for a given context.
   * Returns composed prompt delta and required tools.
   */
  activateSkillsForContext(context: SkillActivationContext): SkillActivationResult {
    const candidateSkills = this.findBestSkills(context);
    const activatedSkills = candidateSkills.slice(0, this.getMaxSkillsForTier(context.tier));

    const composedPromptDelta = activatedSkills
      .map(s => s.systemPromptDelta)
      .join('\n\n---\n\n');

    const requiredTools = [...new Set(activatedSkills.flatMap(s => s.toolRequirements))];

    const slmBindings = activatedSkills
      .map(s => s.slmPreference)
      .filter(Boolean) as string[];
    const primarySLM = slmBindings[0];

    const estimatedQualityBoost = activatedSkills.reduce((acc, s) => {
      const jurisdictionScore = s.metrics.jurisdictionPerformance[context.jurisdiction] ?? s.metrics.averageQualityScore;
      return acc + (jurisdictionScore - 70) / 10;
    }, 0);

    // Track usage
    for (const skill of activatedSkills) {
      skill.metrics.usageCount += 1;
      this.skills.set(skill.id, skill);
    }

    logger.debug('[SkillsSystem] Skills activated', {
      context: context.taskType,
      jurisdiction: context.jurisdiction,
      activatedCount: activatedSkills.length,
      skills: activatedSkills.map(s => s.id),
    });

    return {
      activatedSkills,
      composedPromptDelta,
      requiredTools,
      slmBinding: primarySLM,
      estimatedQualityBoost: Math.round(estimatedQualityBoost),
    };
  }

  /**
   * Register a custom skill (for SDK partners and enterprise customers).
   */
  registerSkill(skill: Omit<LegalSkill, 'metrics' | 'createdAt' | 'updatedAt'>): LegalSkill {
    const fullSkill: LegalSkill = {
      ...skill,
      metrics: {
        usageCount: 0,
        averageQualityScore: 0,
        averageResponseTime: 0,
        successRate: 0,
        userRating: 0,
        jurisdictionPerformance: {},
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.skills.set(skill.id, fullSkill);
    logger.info('[SkillsSystem] Custom skill registered', { id: skill.id, name: skill.name });
    return fullSkill;
  }

  /**
   * Get all skills (filtered).
   */
  getSkills(filters?: {
    category?: SkillCategory;
    jurisdiction?: string;
    tier?: SkillTier;
    isPublic?: boolean;
    organizationId?: string;
  }): LegalSkill[] {
    let skills = Array.from(this.skills.values());
    if (filters?.category) skills = skills.filter(s => s.category === filters.category);
    if (filters?.jurisdiction) skills = skills.filter(s => s.jurisdictions.includes(filters.jurisdiction!));
    if (filters?.tier) skills = skills.filter(s => s.tier === filters.tier);
    if (filters?.isPublic !== undefined) skills = skills.filter(s => s.isPublic === filters.isPublic);
    if (filters?.organizationId) skills = skills.filter(s => s.organizationId === filters.organizationId);
    return skills;
  }

  /**
   * Get a skill by ID.
   */
  getSkill(id: string): LegalSkill | undefined {
    return this.skills.get(id);
  }

  /**
   * Update skill performance metrics after use.
   */
  recordSkillPerformance(skillId: string, jurisdiction: string, qualityScore: number, responseTimeMs: number, success: boolean): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    const m = skill.metrics;
    const total = m.usageCount || 1;
    m.averageQualityScore = (m.averageQualityScore * (total - 1) + qualityScore) / total;
    m.averageResponseTime = (m.averageResponseTime * (total - 1) + responseTimeMs) / total;
    m.successRate = (m.successRate * (total - 1) + (success ? 1 : 0)) / total;
    m.jurisdictionPerformance[jurisdiction] = (
      ((m.jurisdictionPerformance[jurisdiction] || 70) + qualityScore) / 2
    );

    skill.updatedAt = new Date();
    this.skills.set(skillId, skill);
  }

  /**
   * NYV-ORCH-SKILLS-001 (Task #32) — Per-tier, skill-narrowed capability surface.
   *
   * Returns the intersection of:
   *   tier+jurisdiction surface from the manifest
   *   ∩ (capabilities unlocked by activated skill bundles ∪ platform invariants)
   *
   * Platform invariants (always-on regardless of activated skills) are the
   * categories that every request must be able to traverse: safety, hitl,
   * metering, audit, governance/compliance gating primitives, protocol,
   * streaming, monitoring, llm-gateway, circuit-breaker, security, agent-
   * orchestration, task-allocation. Without these the orchestrator cannot
   * meet its uniform middleware contract.
   *
   * Domain capabilities (rag, memory, intelligence, document-pipeline,
   * vector, workflow, omnichannel, multimodal, simulation, white-label,
   * skills, tools) are gated by the activated skill bundle's category.
   *
   * Failure mode: in production a manifest lookup failure throws (no soft
   * empty surface) so the caller sees the real misconfiguration.
   */
  async getCapabilitiesForContext(context: SkillActivationContext): Promise<{
    activatedSkills: LegalSkill[];
    composedPromptDelta: string;
    requiredTools: string[];
    capabilities: Array<{ id: string; displayName: string; category: string }>;
  }> {
    const activation = this.activateSkillsForContext(context);
    let capabilities: Array<{ id: string; displayName: string; category: string }> = [];
    try {
      const { capabilityManifest } = await import('../../orchestration/capability-manifest.js');
      const tierMap: Record<string, 'lite' | 'mitra' | 'enterprise' | 'sovereign' | 'white-label'> = {
        solo: 'lite', plus: 'mitra', pro: 'enterprise', enterprise: 'sovereign',
      };
      // NYV-WL-001 (round 10d): white-label is a first-class manifest
      // tier — when the caller flags the tenant as white-label we
      // escalate to the dedicated `white-label` surface so re-brandable
      // capabilities (theming, custom domains, partner-scoped audit) are
      // exposed regardless of billing-tier mapping.
      const cTier = context.whiteLabel ? 'white-label' : (tierMap[context.tier] ?? 'lite');
      const tierSurface = capabilityManifest.list({ tier: cTier, jurisdiction: context.jurisdiction });

      const allowedCategories = this.computeAllowedCategoriesForSkills(activation.activatedSkills);
      const allowedTags = new Set<string>();
      for (const s of activation.activatedSkills) {
        for (const t of s.tags) allowedTags.add(t.toLowerCase());
      }

      capabilities = tierSurface
        .filter((c) => allowedCategories.has(c.category) || c.tags.some((t) => allowedTags.has(t.toLowerCase())))
        .map((c) => ({ id: c.id, displayName: c.displayName, category: c.category }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[SkillsSystem] capability manifest lookup failed', { error: msg });
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`[SkillsSystem] capability manifest unavailable in PRODUCTION: ${msg}`);
      }
    }
    return {
      activatedSkills: activation.activatedSkills,
      composedPromptDelta: activation.composedPromptDelta,
      requiredTools: activation.requiredTools,
      capabilities,
    };
  }

  /**
   * Skill-bundle → manifest-category allowlist.
   * Always-on platform categories are merged in last so the orchestrator can
   * always run safety/hitl/metering/audit/governance/etc. middleware.
   */
  private computeAllowedCategoriesForSkills(skills: LegalSkill[]): Set<string> {
    const categoryMap: Record<SkillCategory, string[]> = {
      'legal-research':       ['rag', 'memory', 'intelligence', 'vector', 'document-pipeline'],
      'document-drafting':    ['workflow', 'document-pipeline', 'tools', 'multimodal'],
      'compliance-checking':  ['compliance', 'intelligence', 'workflow'],
      'negotiation':          ['workflow', 'intelligence', 'omnichannel'],
      'litigation':           ['intelligence', 'workflow', 'document-pipeline', 'simulation'],
      'advisory':             ['intelligence', 'rag', 'memory'],
      'regulatory':           ['compliance', 'intelligence', 'workflow'],
      'tax':                  ['intelligence', 'compliance', 'workflow'],
      'ip-patent':            ['intelligence', 'document-pipeline', 'workflow'],
      'corporate-governance': ['compliance', 'workflow', 'intelligence'],
      'criminal-defense':     ['intelligence', 'workflow', 'document-pipeline'],
      'family-law':           ['workflow', 'document-pipeline', 'intelligence'],
      'real-estate':          ['workflow', 'document-pipeline', 'compliance'],
      'arbitration':          ['workflow', 'intelligence', 'compliance', 'simulation'],
      'cross-border':         ['intelligence', 'compliance', 'workflow', 'rag'],
    };

    const PLATFORM_INVARIANTS = [
      'safety', 'hitl', 'metering', 'audit', 'governance',
      'protocol', 'streaming', 'monitoring', 'llm-gateway',
      'circuit-breaker', 'security', 'agent-orchestration',
      'task-allocation', 'cache', 'database', 'skills', 'white-label',
    ];

    const allowed = new Set<string>(PLATFORM_INVARIANTS);
    for (const s of skills) {
      const cats = categoryMap[s.category] ?? [];
      for (const c of cats) allowed.add(c);
    }
    return allowed;
  }

  /**
   * Health check.
   */
  healthCheck(): { status: 'healthy'; totalSkills: number; coreSkills: number; customSkills: number } {
    const all = Array.from(this.skills.values());
    const core = all.filter(s => s.author === 'nyayavigya-core');
    return {
      status: 'healthy',
      totalSkills: all.length,
      coreSkills: core.length,
      customSkills: all.length - core.length,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private findBestSkills(context: SkillActivationContext): LegalSkill[] {
    const candidates = Array.from(this.skills.values())
      .filter(s => {
        const jurisdictionMatch = s.jurisdictions.includes(context.jurisdiction) || s.jurisdictions.includes('all');
        const practiceAreaMatch = s.practiceAreas.includes(context.practiceArea) || s.practiceAreas.includes('all');
        const tierOk = this.skillTierAllowed(s.tier, context.tier);
        return jurisdictionMatch && practiceAreaMatch && tierOk;
      })
      .sort((a, b) => {
        const aScore = a.metrics.jurisdictionPerformance[context.jurisdiction] ?? a.metrics.averageQualityScore;
        const bScore = b.metrics.jurisdictionPerformance[context.jurisdiction] ?? b.metrics.averageQualityScore;
        return bScore - aScore;
      });
    return candidates;
  }

  private skillTierAllowed(skillTier: SkillTier, userTier: string): boolean {
    const tierRank: Record<string, number> = { basic: 1, professional: 2, expert: 3, sovereign: 4 };
    const userRank: Record<string, number> = { solo: 1, plus: 2, pro: 3, enterprise: 4 };
    return (userRank[userTier] || 1) >= (tierRank[skillTier] || 1);
  }

  private getMaxSkillsForTier(tier: string): number {
    const limits: Record<string, number> = { solo: 1, plus: 2, pro: 3, enterprise: 5 };
    return limits[tier] || 1;
  }
}

export const skillsSystem = SkillsSystemService.getInstance();
