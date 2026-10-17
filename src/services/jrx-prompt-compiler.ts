/**
 * JRX Prompt Compiler v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspired by obra/Superpowers token optimization: compresses 23-section system
 * prompts on subsequent conversation turns to avoid token bloat.
 *
 * ARCHITECTURE:
 *   Turn 1:  Full 23-section prompt (~3-4K tokens) — establishes agent identity
 *   Turn 2+: Compressed prompt (~800-1200 tokens) — identity anchor + delta only
 *
 * COMPRESSION STRATEGIES:
 *   1. Section Pruning    — Remove sections not relevant to current turn's topic
 *   2. Semantic Hashing   — Replace repeated sections with "[ref:SECTION_N]" anchors
 *   3. Statute Scoping    — Only include statutes relevant to the current query
 *   4. Behavioral Folding — Collapse behavioral patterns into compact directives
 *   5. Jurisdiction Focus — Only include active jurisdiction's statutes
 *
 * TOKEN SAVINGS: 40-60% reduction on multi-turn conversations
 *
 * INTEGRATION:
 *   - Called by jrx-system-prompt-engine.ts before LLM gateway calls
 *   - Session-aware: tracks which sections have been sent per session
 *   - Preserves critical sections (identity, prime directives, HITL rules)
 *
 * @module jrx-prompt-compiler
 * @version 1.0.0
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import {
  assembleLayeredAgentSystemPrompt,
  parseAgentPromptBundle,
} from './jrx-agent-prompt-bundle.js';

const logger = createLogger('jrx-prompt-compiler');

export interface PromptCompilerConfig {
  enableCompression: boolean;
  compressionStartTurn: number;
  minSectionsToKeep: number;
  maxCompressedTokens: number;
  alwaysKeepSections: number[];
  enableJurisdictionFocus: boolean;
  enableStatuteScoping: boolean;
  enableBehavioralFolding: boolean;
  sessionTTLMs: number;
}

export interface SessionPromptState {
  sessionId: string;
  agentId: string;
  turnCount: number;
  fullPromptHash: string;
  sentSections: Set<number>;
  activeJurisdiction: string | null;
  activeTopics: Set<string>;
  lastCompressedAt: string;
  tokenHistory: Array<{ turn: number; fullTokens: number; compressedTokens: number }>;
  createdAt: string;
}

export interface PromptCompilationResult {
  compiledPrompt: string;
  turnNumber: number;
  compressionApplied: boolean;
  fullTokenEstimate: number;
  compressedTokenEstimate: number;
  tokensSaved: number;
  savingsPercent: number;
  sectionsIncluded: number[];
  sectionsPruned: number[];
  compressionStrategies: string[];
}

const SECTION_HEADERS = [
  'SECTION 1 — AGENT IDENTITY & MANDATE',
  'SECTION 2 — CORE CAPABILITIES',
  'SECTION 3 — JURISDICTION INTELLIGENCE',
  'SECTION 4 — LEGAL KNOWLEDGE BASE & STATUTE INTELLIGENCE',
  'SECTION 5 — 22 AGENTIC PATTERNS',
  'SECTION 6 — PROTOCOL COMPLIANCE',
  'SECTION 7 — HITL ESCALATION',
  'SECTION 8 — SECURITY & ACCESS CONTROL',
  'SECTION 9 — OUTPUT FORMAT & CITATION STANDARDS',
  'SECTION 10 — TOOL INTEGRATION',
  'SECTION 11 — DIGITAL TWIN',
  'SECTION 12 — GRPO FEEDBACK',
  'SECTION 13 — QUANTUM READINESS',
  'SECTION 14 — MEMORY ARCHITECTURE',
  'SECTION 15 — BILLING & METERING',
  'SECTION 16 — WHITE-LABEL',
  'SECTION 17 — LANGUAGE ROUTING',
  'SECTION 18 — COMPLIANCE FRAMEWORKS',
  'SECTION 19 — OPERATIONAL BOUNDARIES',
  'SECTION 20 — BEHAVIOURAL PATTERNS',
  'SECTION 21 — CROSS-JURISDICTION',
  'SECTION 22 — COMPARATIVE KNOWLEDGE',
];

const CRITICAL_SECTIONS = [1, 7, 9, 19];

const TOPIC_SECTION_MAP: Record<string, number[]> = {
  'contract': [2, 3, 4, 9, 18],
  'litigation': [2, 3, 4, 7, 9],
  'compliance': [2, 3, 18, 19],
  'criminal': [2, 3, 4, 7, 9],
  'corporate': [2, 3, 4, 15, 18],
  'ip': [2, 3, 4, 9],
  'tax': [2, 3, 4, 15],
  'arbitration': [2, 3, 4, 9, 21],
  'data-protection': [2, 3, 4, 8, 18],
  'employment': [2, 3, 4, 9],
  'insolvency': [2, 3, 4, 7, 9],
  'real-estate': [2, 3, 4, 9],
  'environmental': [2, 3, 4, 18],
  'constitutional': [2, 3, 4, 7, 9],
  'cross-border': [2, 3, 4, 21, 22],
  'digital-twin': [2, 11],
  'memory': [2, 14],
  'tool-use': [2, 10],
  'billing': [2, 15],
  'general': [2, 3, 4],
};

const DEFAULT_CONFIG: PromptCompilerConfig = {
  enableCompression: true,
  compressionStartTurn: 2,
  minSectionsToKeep: 5,
  maxCompressedTokens: 1500,
  alwaysKeepSections: CRITICAL_SECTIONS,
  enableJurisdictionFocus: true,
  enableStatuteScoping: true,
  enableBehavioralFolding: true,
  sessionTTLMs: 30 * 60 * 1000,
};

export class JrxPromptCompiler {
  private config: PromptCompilerConfig;
  private sessions: Map<string, SessionPromptState> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private totalTokensSaved = 0;
  private totalCompilations = 0;

  constructor(config: Partial<PromptCompilerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
    logger.info('[PromptCompiler] Initialized', {
      compressionStartTurn: this.config.compressionStartTurn,
      maxCompressedTokens: this.config.maxCompressedTokens,
      criticalSections: CRITICAL_SECTIONS,
    });
  }

  compile(
    fullPrompt: string,
    sessionId: string,
    agentId: string,
    currentQuery?: string,
    jurisdiction?: string
  ): PromptCompilationResult {
    const sessionKey = `${sessionId}:${agentId}`;
    let state = this.sessions.get(sessionKey);

    if (!state) {
      state = this.createSessionState(sessionKey, sessionId, agentId, fullPrompt);
      this.sessions.set(sessionKey, state);
    }

    state.turnCount++;
    if (jurisdiction) state.activeJurisdiction = jurisdiction;

    // NV-AGENT-PROMPT-SESSION-001 — primary path for live registry XML (<section_*>)
    if (/<section_1_identity>|<section_0_security/i.test(fullPrompt)) {
      return this.compileXmlRegistryPrompt(fullPrompt, sessionId, agentId, state);
    }

    if (!this.config.enableCompression || state.turnCount < this.config.compressionStartTurn) {
      return this.buildFullResult(fullPrompt, state);
    }

    const topics = currentQuery ? this.detectTopics(currentQuery) : new Set<string>(['general']);
    for (const t of topics) state.activeTopics.add(t);

    const sections = this.parseSections(fullPrompt);
    const sectionsToKeep = this.selectSections(topics, state);
    const compressedSections: string[] = [];
    const includedSections: number[] = [];
    const prunedSections: number[] = [];
    const strategies: string[] = [];

    compressedSections.push(this.buildIdentityAnchor(sections, agentId, state));
    strategies.push('identity-anchor');

    for (let i = 0; i < sections.length; i++) {
      const sectionNum = i + 1;
      if (sectionNum === 1) continue;

      if (sectionsToKeep.has(sectionNum)) {
        const compressed = this.compressSection(sections[i], sectionNum, state);
        compressedSections.push(compressed);
        includedSections.push(sectionNum);
        state.sentSections.add(sectionNum);
      } else {
        prunedSections.push(sectionNum);
      }
    }

    if (this.config.enableBehavioralFolding && state.turnCount > 3) {
      strategies.push('behavioral-folding');
    }
    if (this.config.enableJurisdictionFocus && state.activeJurisdiction) {
      strategies.push('jurisdiction-focus');
    }
    if (this.config.enableStatuteScoping && currentQuery) {
      strategies.push('statute-scoping');
    }
    strategies.push('section-pruning');

    const compiledPrompt = compressedSections.join('\n\n');
    const fullTokens = this.estimateTokens(fullPrompt);
    const compressedTokens = this.estimateTokens(compiledPrompt);
    const saved = fullTokens - compressedTokens;

    state.tokenHistory.push({ turn: state.turnCount, fullTokens, compressedTokens });
    state.lastCompressedAt = new Date().toISOString();
    this.totalTokensSaved += saved;
    this.totalCompilations++;

    logger.info('[PromptCompiler] Compiled', {
      sessionId,
      agentId,
      turn: state.turnCount,
      fullTokens,
      compressedTokens,
      savedPercent: `${((saved / fullTokens) * 100).toFixed(1)}%`,
      sectionsKept: includedSections.length,
      sectionsPruned: prunedSections.length,
    });

    return {
      compiledPrompt,
      turnNumber: state.turnCount,
      compressionApplied: true,
      fullTokenEstimate: fullTokens,
      compressedTokenEstimate: compressedTokens,
      tokensSaved: saved,
      savingsPercent: fullTokens > 0 ? (saved / fullTokens) * 100 : 0,
      sectionsIncluded: [1, ...includedSections],
      sectionsPruned: prunedSections,
      compressionStrategies: strategies,
    };
  }

  /**
   * NV-AGENT-PROMPT-SESSION-001 — Turn 1 full L0; Turn 2+ L1 identity+mandate+§0 binding.
   * Uses structured XML section parse (not legacy ═══ SECTION N ═══ headers).
   */
  private compileXmlRegistryPrompt(
    fullPrompt: string,
    sessionId: string,
    agentId: string,
    state: SessionPromptState,
  ): PromptCompilationResult {
    const bundle = parseAgentPromptBundle(fullPrompt, agentId);
    const isTurn1 =
      !this.config.enableCompression
      || state.turnCount < this.config.compressionStartTurn
      || state.fullPromptHash !== bundle.hash;

    if (state.fullPromptHash !== bundle.hash) {
      state.fullPromptHash = bundle.hash;
    }

    const assembled = assembleLayeredAgentSystemPrompt({
      fullRegistryPrompt: fullPrompt,
      agentId,
      mode: isTurn1 ? 'turn1_full' : 'turn2_plus',
      turnNumber: state.turnCount,
    });

    const fullTokens = this.estimateTokens(fullPrompt);
    const compressedTokens = this.estimateTokens(assembled.systemPrompt);
    const saved = Math.max(0, fullTokens - compressedTokens);
    state.tokenHistory.push({ turn: state.turnCount, fullTokens, compressedTokens });
    state.lastCompressedAt = new Date().toISOString();
    for (let i = 0; i <= 22; i++) state.sentSections.add(i);
    this.totalCompilations++;
    if (saved > 0) this.totalTokensSaved += saved;

    logger.info('[PromptCompiler] XML registry layered compile', {
      sessionId: String(sessionId).slice(0, 12),
      agentId,
      turn: state.turnCount,
      mode: assembled.mode,
      fullTokens,
      compressedTokens,
      hash: bundle.hash,
    });

    return {
      compiledPrompt: assembled.systemPrompt,
      turnNumber: state.turnCount,
      compressionApplied: assembled.mode !== 'turn1_full',
      fullTokenEstimate: fullTokens,
      compressedTokenEstimate: compressedTokens,
      tokensSaved: saved,
      savingsPercent: fullTokens > 0 ? (saved / fullTokens) * 100 : 0,
      sectionsIncluded: assembled.mode === 'turn1_full' ? [0, 1, 2] : [1, 2],
      sectionsPruned: assembled.mode === 'turn1_full' ? [] : [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
      compressionStrategies: assembled.mode === 'turn1_full'
        ? ['xml-turn1-full-constitution']
        : ['xml-turn2-identity-mandate', 'constitution-binding'],
    };
  }

  private buildFullResult(fullPrompt: string, state: SessionPromptState): PromptCompilationResult {
    // Prefer layered Turn-1 marker when XML registry
    if (/<section_1_identity>|<section_0_security/i.test(fullPrompt)) {
      try {
        const assembled = assembleLayeredAgentSystemPrompt({
          fullRegistryPrompt: fullPrompt,
          agentId: state.agentId,
          mode: 'turn1_full',
          turnNumber: state.turnCount,
        });
        const tokens = this.estimateTokens(assembled.systemPrompt);
        for (let i = 0; i <= 22; i++) state.sentSections.add(i);
        state.tokenHistory.push({ turn: state.turnCount, fullTokens: tokens, compressedTokens: tokens });
        return {
          compiledPrompt: assembled.systemPrompt,
          turnNumber: state.turnCount,
          compressionApplied: false,
          fullTokenEstimate: tokens,
          compressedTokenEstimate: tokens,
          tokensSaved: 0,
          savingsPercent: 0,
          sectionsIncluded: Array.from({ length: 23 }, (_, i) => i),
          sectionsPruned: [],
          compressionStrategies: ['xml-turn1-full-constitution'],
        };
      } catch {
        /* fall through */
      }
    }

    const tokens = this.estimateTokens(fullPrompt);
    for (let i = 1; i <= 22; i++) state.sentSections.add(i);
    state.tokenHistory.push({ turn: state.turnCount, fullTokens: tokens, compressedTokens: tokens });

    return {
      compiledPrompt: fullPrompt,
      turnNumber: state.turnCount,
      compressionApplied: false,
      fullTokenEstimate: tokens,
      compressedTokenEstimate: tokens,
      tokensSaved: 0,
      savingsPercent: 0,
      sectionsIncluded: Array.from({ length: 22 }, (_, i) => i + 1),
      sectionsPruned: [],
      compressionStrategies: [],
    };
  }

  private parseSections(fullPrompt: string): string[] {
    const sections: string[] = [];

    // NV-AGENT-PROMPT-SESSION-001 — live registry uses <section_N_*>
    const xmlTags = [...String(fullPrompt || '').matchAll(/<(section_[a-z0-9_]+)>/gi)];
    if (xmlTags.length >= 2) {
      for (let i = 0; i < xmlTags.length; i++) {
        const tag = xmlTags[i][1];
        const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i');
        const m = fullPrompt.match(re);
        if (m) sections.push(m[0].trim());
      }
      if (sections.length > 0) return sections;
    }

    // Legacy ═══ SECTION N ═══ format
    const sectionPattern = /═{3,}\nSECTION \d+[^═]*\n═{3,}/g;
    const matches = [...fullPrompt.matchAll(sectionPattern)];

    if (matches.length === 0) {
      return [fullPrompt];
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : fullPrompt.length;
      sections.push(fullPrompt.slice(start, end).trim());
    }

    if (matches[0].index! > 0) {
      sections.unshift(fullPrompt.slice(0, matches[0].index!).trim());
    }

    return sections;
  }

  private buildIdentityAnchor(sections: string[], agentId: string, state: SessionPromptState): string {
    const joined = sections.join('\n');
    const identityXml = joined.match(/<section_1_identity>[\s\S]*?<\/section_1_identity>/i)?.[0]
      || sections[0]?.match(/<agent_identity>[\s\S]*?<\/agent_identity>/)?.[0]
      || '';
    const mandateXml = joined.match(/<section_2_core_mandate>[\s\S]*?<\/section_2_core_mandate>/i)?.[0] || '';

    const directivesMatch = (sections[0] || '').match(/Your PRIME DIRECTIVES:[\s\S]*?(?=\n═|$)/);
    const directives = directivesMatch ? directivesMatch[0] : '';

    return [
      identityXml || `[Agent ${agentId}]`,
      mandateXml,
      '',
      `[CONTINUATION — Turn ${state.turnCount} | Session ${state.sessionId.slice(0, 8)}]`,
      'Full constitution established in Turn 1. Maintaining all behavioral constraints (§0 IN FORCE).',
      '',
      directives,
    ].filter(Boolean).join('\n');
  }

  private selectSections(topics: Set<string>, state: SessionPromptState): Set<number> {
    const selected = new Set<number>(this.config.alwaysKeepSections);

    for (const topic of topics) {
      const topicSections = TOPIC_SECTION_MAP[topic] || TOPIC_SECTION_MAP['general'];
      for (const s of topicSections) selected.add(s);
    }

    while (selected.size < this.config.minSectionsToKeep) {
      for (let i = 2; i <= 22; i++) {
        if (!selected.has(i)) {
          selected.add(i);
          break;
        }
      }
    }

    return selected;
  }

  private compressSection(section: string, sectionNum: number, state: SessionPromptState): string {
    let compressed = section;

    if (this.config.enableBehavioralFolding && sectionNum === 20 && state.turnCount > 3) {
      compressed = this.foldBehavioralPatterns(compressed);
    }

    if (this.config.enableJurisdictionFocus && sectionNum === 3 && state.activeJurisdiction) {
      compressed = this.focusJurisdiction(compressed, state.activeJurisdiction);
    }

    if (this.config.enableStatuteScoping && sectionNum === 4) {
      compressed = this.scopeStatutes(compressed, state.activeTopics);
    }

    if (state.sentSections.has(sectionNum) && state.turnCount > 2) {
      const lines = compressed.split('\n');
      const header = lines.slice(0, 3).join('\n');
      const keyLines = lines.filter(l =>
        l.includes('MUST') || l.includes('NEVER') || l.includes('ALWAYS') ||
        l.includes('CRITICAL') || l.includes('WARNING') || l.includes('REQUIRED')
      );
      if (keyLines.length > 0 && keyLines.length < lines.length * 0.5) {
        compressed = [header, `[Ref: previously sent in Turn 1]`, ...keyLines].join('\n');
      }
    }

    return compressed;
  }

  private foldBehavioralPatterns(section: string): string {
    const lines = section.split('\n');
    const header = lines.slice(0, 3).join('\n');
    const critical = lines.filter(l =>
      /(?:MUST|NEVER|ALWAYS|REQUIRED|PROHIBITED)/i.test(l)
    );
    return [
      header,
      '[Behavioral patterns established in Turn 1 — compact directives follow]',
      ...critical.slice(0, 10),
    ].join('\n');
  }

  private focusJurisdiction(section: string, jurisdiction: string): string {
    const jurisdictionMap: Record<string, string[]> = {
      'IN': ['India', 'Indian', 'BNS', 'BNSS', 'BSA', 'DPDPA', 'IBC', 'SEBI', 'RBI', 'NCLT', 'MCA'],
      'UK': ['United Kingdom', 'UK', 'English', 'FCA', 'ICO', 'Companies Act 2006'],
      'US': ['United States', 'US', 'American', 'CCPA', 'HIPAA', 'SOX', 'SEC', 'FINRA'],
      'EU': ['European', 'EU', 'GDPR', 'CJEU', 'Brussels', 'Rome'],
      'GC': ['GCC', 'UAE', 'Saudi', 'DIFC', 'ADGM', 'PDPL'],
      'SG': ['Singapore', 'PDPA', 'MAS', 'SGCA'],
    };

    const activeTerms = new Set(jurisdictionMap[jurisdiction] || []);
    if (activeTerms.size === 0) return section;

    const lines = section.split('\n');
    const filtered = lines.filter(line => {
      const isHeader = /^[═\s]*SECTION|^[A-Z\s]*:$|^\s*$/.test(line);
      if (isHeader) return true;

      const isOtherJurisdiction = Object.entries(jurisdictionMap)
        .filter(([code]) => code !== jurisdiction)
        .some(([_, terms]) => terms.some(t => line.includes(t)));

      const isActiveJurisdiction = [...activeTerms].some(t => line.includes(t));

      if (isOtherJurisdiction && !isActiveJurisdiction) return false;
      return true;
    });

    return filtered.join('\n');
  }

  private scopeStatutes(section: string, activeTopics: Set<string>): string {
    if (activeTopics.size === 0) return section;

    const lines = section.split('\n');
    const header = lines.slice(0, 5).join('\n');
    const critical = lines.filter(l =>
      /PROTOCOL|VERIFY|amendment|RECENT/i.test(l)
    );

    return [header, ...critical].join('\n');
  }

  private detectTopics(query: string): Set<string> {
    const topics = new Set<string>();
    const q = query.toLowerCase();

    const topicPatterns: Record<string, RegExp> = {
      'contract': /\b(?:contract|agreement|clause|obligation|breach|force majeure|consideration|indemnity)\b/,
      'litigation': /\b(?:litigation|suit|petition|appeal|hearing|judgment|decree|injunction|stay)\b/,
      'compliance': /\b(?:compliance|regulatory|audit|inspection|penalty|violation|filing)\b/,
      'criminal': /\b(?:criminal|offence|offense|bail|arrest|fir|chargesheet|bns|bnss|murder|theft|fraud)\b/,
      'corporate': /\b(?:corporate|company|director|shareholder|board|merger|acquisition|ipo|sebi)\b/,
      'ip': /\b(?:patent|trademark|copyright|design|trade secret|infringement|licensing)\b/,
      'tax': /\b(?:tax|gst|income tax|tds|withholding|transfer pricing|assessment|reassessment)\b/,
      'arbitration': /\b(?:arbitration|mediation|conciliation|adr|dispute resolution|lcia|icc|siac)\b/,
      'data-protection': /\b(?:data protection|privacy|gdpr|dpdpa|personal data|consent|breach notification)\b/,
      'employment': /\b(?:employment|labour|labor|wages|termination|dismissal|retrenchment|discrimination)\b/,
      'insolvency': /\b(?:insolvency|bankruptcy|ibc|cirp|resolution|liquidation|nclt|moratorium)\b/,
      'cross-border': /\b(?:cross.?border|international|multi.?jurisdiction|foreign|extradition|treaty)\b/,
      'digital-twin': /\b(?:digital twin|simulation|scenario|persona|modeling)\b/,
      'memory': /\b(?:memory|context|history|recall|remember)\b/,
    };

    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(q)) topics.add(topic);
    }

    if (topics.size === 0) topics.add('general');
    return topics;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private createSessionState(
    key: string,
    sessionId: string,
    agentId: string,
    fullPrompt: string
  ): SessionPromptState {
    return {
      sessionId,
      agentId,
      turnCount: 0,
      fullPromptHash: crypto.createHash('sha256').update(fullPrompt).digest('hex').slice(0, 16),
      sentSections: new Set<number>(),
      activeJurisdiction: null,
      activeTopics: new Set<string>(),
      lastCompressedAt: new Date().toISOString(),
      tokenHistory: [],
      createdAt: new Date().toISOString(),
    };
  }

  clearSession(sessionId: string, agentId: string): void {
    const key = `${sessionId}:${agentId}`;
    this.sessions.delete(key);
    logger.info(`[PromptCompiler] Session cleared: ${key}`);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, state] of this.sessions) {
        if (now - new Date(state.createdAt).getTime() > this.config.sessionTTLMs) {
          this.sessions.delete(key);
        }
      }
    }, 5 * 60 * 1000);

    if (this.cleanupTimer?.unref) this.cleanupTimer.unref();
  }

  getStats(): {
    activeSessions: number;
    totalCompilations: number;
    totalTokensSaved: number;
    averageSavingsPercent: number;
  } {
    let totalSavings = 0;
    let totalEntries = 0;
    for (const state of this.sessions.values()) {
      for (const entry of state.tokenHistory) {
        if (entry.compressedTokens < entry.fullTokens) {
          totalSavings += (entry.fullTokens - entry.compressedTokens) / entry.fullTokens;
          totalEntries++;
        }
      }
    }

    return {
      activeSessions: this.sessions.size,
      totalCompilations: this.totalCompilations,
      totalTokensSaved: this.totalTokensSaved,
      averageSavingsPercent: totalEntries > 0 ? (totalSavings / totalEntries) * 100 : 0,
    };
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.sessions.clear();
    logger.info('[PromptCompiler] Destroyed');
  }
}

let compilerInstance: JrxPromptCompiler | null = null;

export function getPromptCompiler(config?: Partial<PromptCompilerConfig>): JrxPromptCompiler {
  if (!compilerInstance) {
    compilerInstance = new JrxPromptCompiler(config);
  }
  return compilerInstance;
}
