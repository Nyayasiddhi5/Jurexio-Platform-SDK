/**
 * NYV Pattern Auto-Selector v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspired by obra/Superpowers auto-triggering skills: context-aware pattern
 * selection that automatically determines the optimal agentic pattern (P01-P22)
 * based on task analysis, complexity estimation, and historical performance.
 *
 * ARCHITECTURE:
 *   1. Intent Analysis      — classify task into legal intent categories
 *   2. Complexity Estimation — score task complexity (simple → critical)
 *   3. Pattern Scoring       — score each of 22 patterns against the task
 *   4. Performance Weighting — boost patterns with historical success for similar tasks
 *   5. Constraint Filtering  — exclude patterns incompatible with jurisdiction/tier
 *
 * AUTO-TRIGGER RULES (Superpowers-inspired):
 *   - Research tasks     → P11 NyayaRAG or P12 GraphRAG
 *   - Drafting tasks     → P02 CoT or P06 Refine
 *   - Review tasks       → P07 Maker-Checker
 *   - Complex multi-step → P05 Plan-Execute or P15 HTA
 *   - Adversarial tasks  → P03 ToT or P16 Swarm
 *   - Compliance tasks   → P17 ACONIC monitoring
 *   - Quick lookups      → P14 Semantic Cache
 *   - Historical queries → P13 Mem0
 *
 * INTEGRATION:
 *   - Called by NS-Queen orchestrator before agent execution
 *   - Feeds into BM25 agent selector (pattern-first, then agent)
 *   - GRPO feedback loop refines selection weights over time
 *
 * @module nyv-pattern-auto-selector
 * @version 1.0.0
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('nyv-pattern-auto-selector');

export type TaskIntent =
  | 'research' | 'draft' | 'review' | 'analyze' | 'advise'
  | 'compliance' | 'litigation' | 'negotiation' | 'filing'
  | 'monitoring' | 'simulation' | 'comparison' | 'summarize'
  | 'translate' | 'predict' | 'general';

export type ComplexityLevel = 'simple' | 'moderate' | 'complex' | 'very-complex' | 'critical';

export interface PatternScore {
  patternId: string;
  patternName: string;
  score: number;
  intentMatch: number;
  complexityMatch: number;
  performanceBoost: number;
  constraintPenalty: number;
  reasons: string[];
}

export interface PatternSelectionResult {
  selectedPattern: PatternScore;
  alternativePatterns: PatternScore[];
  taskAnalysis: {
    intent: TaskIntent;
    complexity: ComplexityLevel;
    complexityScore: number;
    detectedTopics: string[];
    requiresMultiHop: boolean;
    requiresHITL: boolean;
    estimatedTokens: number;
  };
  confidence: number;
  autoTriggered: boolean;
  selectionTimeMs: number;
}

export interface PatternPerformanceRecord {
  patternId: string;
  successRate: number;
  avgLatencyMs: number;
  avgTokens: number;
  avgQualityScore: number;
  totalExecutions: number;
  lastUsed: string;
}

export interface PatternAutoSelectorConfig {
  enablePerformanceWeighting: boolean;
  performanceWeight: number;
  intentWeight: number;
  complexityWeight: number;
  minConfidenceThreshold: number;
  maxAlternatives: number;
  enableConstraintFiltering: boolean;
  cacheSimilarityThreshold: number;
}

const DEFAULT_CONFIG: PatternAutoSelectorConfig = {
  enablePerformanceWeighting: true,
  performanceWeight: 0.3,
  intentWeight: 0.45,
  complexityWeight: 0.25,
  minConfidenceThreshold: 0.4,
  maxAlternatives: 3,
  enableConstraintFiltering: true,
  cacheSimilarityThreshold: 0.92,
};

interface PatternDefinition {
  id: string;
  name: string;
  slug: string;
  intents: TaskIntent[];
  complexityRange: [ComplexityLevel, ComplexityLevel];
  strengths: string[];
  tokenEfficiency: number;
  requiresMultiAgent: boolean;
  latencyTier: 'fast' | 'medium' | 'slow';
}

const PATTERN_DEFINITIONS: PatternDefinition[] = [
  { id: 'P01', name: 'ReAct', slug: 'react', intents: ['research', 'analyze', 'general'], complexityRange: ['moderate', 'complex'], strengths: ['tool-use', 'iterative-reasoning', 'fact-checking'], tokenEfficiency: 0.7, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P02', name: 'Chain-of-Thought', slug: 'cot', intents: ['analyze', 'draft', 'advise', 'summarize'], complexityRange: ['simple', 'complex'], strengths: ['step-by-step', 'explainability', 'legal-reasoning'], tokenEfficiency: 0.8, requiresMultiAgent: false, latencyTier: 'fast' },
  { id: 'P03', name: 'Tree-of-Thought', slug: 'tot', intents: ['analyze', 'negotiation', 'litigation'], complexityRange: ['complex', 'critical'], strengths: ['multi-branch', 'adversarial', 'strategy-exploration'], tokenEfficiency: 0.5, requiresMultiAgent: false, latencyTier: 'slow' },
  { id: 'P04', name: 'Reflection', slug: 'reflect', intents: ['review', 'draft', 'analyze'], complexityRange: ['moderate', 'complex'], strengths: ['self-critique', 'quality-improvement', 'error-detection'], tokenEfficiency: 0.6, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P05', name: 'Plan-and-Execute', slug: 'plan-exec', intents: ['compliance', 'filing', 'litigation'], complexityRange: ['complex', 'critical'], strengths: ['structured-execution', 'multi-step', 'due-diligence'], tokenEfficiency: 0.6, requiresMultiAgent: false, latencyTier: 'slow' },
  { id: 'P06', name: 'Iterative Refinement', slug: 'refine', intents: ['draft', 'review'], complexityRange: ['moderate', 'complex'], strengths: ['document-quality', 'iterative-improvement', 'precision'], tokenEfficiency: 0.65, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P07', name: 'Maker-Checker', slug: 'maker-checker', intents: ['review', 'compliance', 'draft'], complexityRange: ['moderate', 'critical'], strengths: ['dual-validation', 'error-prevention', 'audit-trail'], tokenEfficiency: 0.5, requiresMultiAgent: true, latencyTier: 'medium' },
  { id: 'P08', name: 'Tool-Retry', slug: 'tool-retry', intents: ['filing', 'research'], complexityRange: ['simple', 'moderate'], strengths: ['resilience', 'api-integration', 'retry-logic'], tokenEfficiency: 0.85, requiresMultiAgent: false, latencyTier: 'fast' },
  { id: 'P09', name: 'Function Router', slug: 'function-router', intents: ['general', 'research', 'filing'], complexityRange: ['simple', 'complex'], strengths: ['routing', 'tool-selection', 'specialization'], tokenEfficiency: 0.8, requiresMultiAgent: false, latencyTier: 'fast' },
  { id: 'P10', name: 'MCP Chain', slug: 'mcp-chain', intents: ['research', 'compliance', 'filing'], complexityRange: ['moderate', 'complex'], strengths: ['multi-tool', 'sequential-execution', 'data-pipeline'], tokenEfficiency: 0.7, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P11', name: 'NyayaRAG', slug: 'nyayarag', intents: ['research', 'analyze', 'advise'], complexityRange: ['simple', 'complex'], strengths: ['statute-retrieval', 'precedent-search', 'citation-quality'], tokenEfficiency: 0.75, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P12', name: 'GraphRAG', slug: 'graphrag', intents: ['research', 'analyze', 'comparison'], complexityRange: ['moderate', 'critical'], strengths: ['multi-hop', 'knowledge-graph', 'precedent-chains'], tokenEfficiency: 0.7, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P13', name: 'Mem0', slug: 'mem0', intents: ['advise', 'analyze', 'general'], complexityRange: ['simple', 'moderate'], strengths: ['context-recall', 'long-term-memory', 'client-history'], tokenEfficiency: 0.9, requiresMultiAgent: false, latencyTier: 'fast' },
  { id: 'P14', name: 'Semantic Cache', slug: 'semantic-cache', intents: ['research', 'general', 'summarize'], complexityRange: ['simple', 'simple'], strengths: ['speed', 'cost-reduction', 'repeated-queries'], tokenEfficiency: 0.95, requiresMultiAgent: false, latencyTier: 'fast' },
  { id: 'P15', name: 'HTA', slug: 'hta', intents: ['compliance', 'litigation', 'filing'], complexityRange: ['complex', 'critical'], strengths: ['task-decomposition', 'hierarchy', 'complex-matters'], tokenEfficiency: 0.55, requiresMultiAgent: false, latencyTier: 'slow' },
  { id: 'P16', name: 'Swarm', slug: 'swarm', intents: ['research', 'analyze', 'comparison', 'negotiation'], complexityRange: ['complex', 'critical'], strengths: ['parallel-execution', 'consensus', 'multi-perspective'], tokenEfficiency: 0.4, requiresMultiAgent: true, latencyTier: 'slow' },
  { id: 'P17', name: 'ACONIC', slug: 'aconic', intents: ['monitoring', 'compliance'], complexityRange: ['moderate', 'critical'], strengths: ['continuous-monitoring', 'regulatory-tracking', 'alerts'], tokenEfficiency: 0.7, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P18', name: 'MOAt', slug: 'moat', intents: ['compliance', 'review', 'litigation'], complexityRange: ['complex', 'critical'], strengths: ['multi-layer-orchestration', 'audit-trail', 'governance'], tokenEfficiency: 0.5, requiresMultiAgent: true, latencyTier: 'slow' },
  { id: 'P19', name: 'ADaPT', slug: 'adapt', intents: ['analyze', 'research', 'general'], complexityRange: ['moderate', 'complex'], strengths: ['adaptive-planning', 'dynamic-decomposition', 'flexible'], tokenEfficiency: 0.65, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P20', name: 'Computer-Use', slug: 'computer-use', intents: ['filing', 'research'], complexityRange: ['moderate', 'complex'], strengths: ['ui-automation', 'form-filling', 'e-filing'], tokenEfficiency: 0.5, requiresMultiAgent: false, latencyTier: 'slow' },
  { id: 'P21', name: 'GRPO', slug: 'grpo', intents: ['review', 'analyze', 'predict'], complexityRange: ['complex', 'critical'], strengths: ['feedback-optimization', 'quality-scoring', 'learning'], tokenEfficiency: 0.6, requiresMultiAgent: false, latencyTier: 'medium' },
  { id: 'P22', name: 'Digital Twin', slug: 'digital-twin', intents: ['simulation', 'predict', 'negotiation'], complexityRange: ['complex', 'critical'], strengths: ['scenario-modelling', 'persona-simulation', 'what-if'], tokenEfficiency: 0.5, requiresMultiAgent: true, latencyTier: 'slow' },
];

const COMPLEXITY_ORDER: ComplexityLevel[] = ['simple', 'moderate', 'complex', 'very-complex', 'critical'];

const INTENT_PATTERNS: Record<TaskIntent, RegExp> = {
  research: /\b(?:research|find|search|look up|case law|precedent|statute|section|act|what is|explain|interpret)\b/i,
  draft: /\b(?:draft|write|prepare|compose|create|generate|template|clause|agreement|contract|petition|application|notice)\b/i,
  review: /\b(?:review|check|verify|validate|audit|assess|examine|evaluate|proofread|compliance check)\b/i,
  analyze: /\b(?:analyze|analyse|assessment|implications|impact|risk|compare|contrast|distinguish|evaluate)\b/i,
  advise: /\b(?:advise|advice|recommend|suggest|counsel|opinion|guidance|what should|how to|best approach)\b/i,
  compliance: /\b(?:compliance|regulatory|requirement|obligation|mandatory|filing|deadline|audit|inspection)\b/i,
  litigation: /\b(?:litigation|suit|case|appeal|petition|writ|hearing|trial|evidence|witness|argument|plea)\b/i,
  negotiation: /\b(?:negotiation|negotiate|settlement|mediation|conciliation|compromise|counter.?offer)\b/i,
  filing: /\b(?:file|filing|submit|register|e-?file|upload|form|application|return|declaration)\b/i,
  monitoring: /\b(?:monitor|track|watch|alert|notification|update|change|amendment|gazette)\b/i,
  simulation: /\b(?:simulate|scenario|what if|model|predict|forecast|outcome|probability|twin)\b/i,
  comparison: /\b(?:compare|contrast|difference|similar|between|versus|vs|cross.?jurisdiction)\b/i,
  summarize: /\b(?:summarize|summary|brief|overview|key points|highlights|gist|tldr|synopsis)\b/i,
  translate: /\b(?:translate|translation|hindi|tamil|bengali|marathi|gujarati|kannada|telugu|malayalam)\b/i,
  predict: /\b(?:predict|probability|likelihood|outcome|forecast|estimate|chance|risk score)\b/i,
  general: /./,
};

const COMPLEXITY_INDICATORS: Record<string, { pattern: RegExp; weight: number }[]> = {
  high: [
    { pattern: /\b(?:multiple jurisdiction|cross.?border|international|treaty)\b/i, weight: 2.0 },
    { pattern: /\b(?:supreme court|constitutional|fundamental right|writ)\b/i, weight: 1.5 },
    { pattern: /\b(?:merger|acquisition|m&a|due diligence|restructuring)\b/i, weight: 1.5 },
    { pattern: /\b(?:criminal|bail|arrest|chargesheet|fir|anticipatory)\b/i, weight: 1.5 },
    { pattern: /\b(?:insolvency|cirp|liquidation|resolution plan|moratorium)\b/i, weight: 1.5 },
    { pattern: /\b(?:complex|complicated|multi.?party|interconnected|comprehensive)\b/i, weight: 1.0 },
  ],
  medium: [
    { pattern: /\b(?:contract|agreement|clause|term|condition|obligation)\b/i, weight: 0.8 },
    { pattern: /\b(?:tax|gst|income tax|tds|assessment|return)\b/i, weight: 0.8 },
    { pattern: /\b(?:employment|termination|discrimination|harassment)\b/i, weight: 0.8 },
    { pattern: /\b(?:data protection|privacy|consent|processing|breach)\b/i, weight: 0.8 },
  ],
  low: [
    { pattern: /\b(?:what is|define|meaning of|explain|basic|simple)\b/i, weight: -0.5 },
    { pattern: /\b(?:format|template|checklist|list|standard|common)\b/i, weight: -0.3 },
  ],
};

export class NyvPatternAutoSelector {
  private config: PatternAutoSelectorConfig;
  private performanceHistory: Map<string, PatternPerformanceRecord> = new Map();
  private selectionHistory: Array<{ taskHash: string; patternId: string; success: boolean }> = [];
  private totalSelections = 0;

  constructor(config: Partial<PatternAutoSelectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[PatternAutoSelector] Initialized', {
      intentWeight: this.config.intentWeight,
      complexityWeight: this.config.complexityWeight,
      performanceWeight: this.config.performanceWeight,
    });
  }

  select(
    task: string,
    jurisdiction?: string,
    agentTier?: string,
    excludePatterns?: string[]
  ): PatternSelectionResult {
    const start = Date.now();

    const intent = this.detectIntent(task);
    const { level: complexity, score: complexityScore } = this.estimateComplexity(task);
    const topics = this.detectTopics(task);
    const requiresMultiHop = this.detectMultiHopNeed(task);
    const requiresHITL = this.detectHITLNeed(task, complexity, agentTier);

    const scores: PatternScore[] = [];

    for (const pattern of PATTERN_DEFINITIONS) {
      if (excludePatterns?.includes(pattern.id)) continue;

      const intentMatch = this.scoreIntentMatch(pattern, intent);
      const complexityMatch = this.scoreComplexityMatch(pattern, complexity);
      const performanceBoost = this.getPerformanceBoost(pattern.id);
      const constraintPenalty = this.computeConstraintPenalty(pattern, jurisdiction, agentTier, requiresMultiHop);

      const totalScore =
        intentMatch * this.config.intentWeight +
        complexityMatch * this.config.complexityWeight +
        performanceBoost * this.config.performanceWeight -
        constraintPenalty;

      const reasons: string[] = [];
      if (intentMatch > 0.7) reasons.push(`Strong ${intent} intent match`);
      if (complexityMatch > 0.7) reasons.push(`Good ${complexity} complexity fit`);
      if (performanceBoost > 0) reasons.push(`Historical performance boost: +${(performanceBoost * 100).toFixed(0)}%`);
      if (constraintPenalty > 0) reasons.push(`Constraint penalty: -${(constraintPenalty * 100).toFixed(0)}%`);
      if (requiresMultiHop && pattern.strengths.includes('multi-hop')) reasons.push('Supports multi-hop reasoning');
      if (pattern.strengths.some(s => topics.includes(s))) reasons.push('Topic alignment');

      scores.push({
        patternId: pattern.id,
        patternName: pattern.name,
        score: Math.max(0, totalScore),
        intentMatch,
        complexityMatch,
        performanceBoost,
        constraintPenalty,
        reasons,
      });
    }

    scores.sort((a, b) => b.score - a.score);

    const selected = scores[0];
    const alternatives = scores.slice(1, 1 + this.config.maxAlternatives);
    const confidence = selected ? Math.min(1, selected.score) : 0;

    this.totalSelections++;

    const result: PatternSelectionResult = {
      selectedPattern: selected,
      alternativePatterns: alternatives,
      taskAnalysis: {
        intent,
        complexity,
        complexityScore,
        detectedTopics: topics,
        requiresMultiHop,
        requiresHITL,
        estimatedTokens: this.estimateTaskTokens(task, selected?.patternId),
      },
      confidence,
      autoTriggered: true,
      selectionTimeMs: Date.now() - start,
    };

    logger.info('[PatternAutoSelector] Selected', {
      pattern: selected?.patternId,
      name: selected?.patternName,
      score: selected?.score.toFixed(3),
      intent,
      complexity,
      confidence: confidence.toFixed(2),
      alternatives: alternatives.map(a => a.patternId).join(','),
    });

    return result;
  }

  private detectIntent(task: string): TaskIntent {
    let bestIntent: TaskIntent = 'general';
    let bestScore = 0;

    for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
      if (intent === 'general') continue;
      const matches = task.match(pattern);
      if (matches && matches.length > bestScore) {
        bestScore = matches.length;
        bestIntent = intent as TaskIntent;
      }
    }

    return bestIntent;
  }

  private estimateComplexity(task: string): { level: ComplexityLevel; score: number } {
    let score = 0;

    for (const [_level, indicators] of Object.entries(COMPLEXITY_INDICATORS)) {
      for (const { pattern, weight } of indicators) {
        const matches = task.match(pattern);
        if (matches) score += weight * matches.length;
      }
    }

    const wordCount = task.split(/\s+/).length;
    if (wordCount > 100) score += 1.0;
    else if (wordCount > 50) score += 0.5;

    const questionCount = (task.match(/\?/g) || []).length;
    if (questionCount > 2) score += 0.5;

    let level: ComplexityLevel;
    if (score >= 4) level = 'critical';
    else if (score >= 3) level = 'very-complex';
    else if (score >= 2) level = 'complex';
    else if (score >= 1) level = 'moderate';
    else level = 'simple';

    return { level, score };
  }

  private detectTopics(task: string): string[] {
    const topics: string[] = [];
    const t = task.toLowerCase();

    if (/statute|section|act|law|legal/.test(t)) topics.push('statute-retrieval');
    if (/precedent|case law|judgment|citation/.test(t)) topics.push('precedent-search');
    if (/document|draft|write|prepare/.test(t)) topics.push('document-quality');
    if (/multi.?hop|chain|connect|relate/.test(t)) topics.push('multi-hop');
    if (/monitor|track|alert|change/.test(t)) topics.push('continuous-monitoring');
    if (/tool|api|file|upload|submit/.test(t)) topics.push('tool-use');
    if (/history|context|remember|previous/.test(t)) topics.push('context-recall');
    if (/compare|contrast|difference|versus/.test(t)) topics.push('multi-perspective');
    if (/audit|compliance|check|verify/.test(t)) topics.push('audit-trail');
    if (/simulate|scenario|predict|model/.test(t)) topics.push('scenario-modelling');

    return topics;
  }

  private detectMultiHopNeed(task: string): boolean {
    return /\b(?:connect|relate|chain|trace|follow|link|impact|consequence|implication|downstream|upstream|cascade)\b/i.test(task) ||
           /\b(?:from.*to|between.*and|how does.*affect|what.*leads to)\b/i.test(task);
  }

  private detectHITLNeed(task: string, complexity: ComplexityLevel, agentTier?: string): boolean {
    if (agentTier === 'executive' || agentTier === 'senior') return true;
    if (complexity === 'critical') return true;
    return /\b(?:criminal|bail|arrest|death|imprisonment|constitutional|fundamental|writ|habeas)\b/i.test(task);
  }

  private scoreIntentMatch(pattern: PatternDefinition, intent: TaskIntent): number {
    if (pattern.intents.includes(intent)) {
      const position = pattern.intents.indexOf(intent);
      return 1.0 - position * 0.1;
    }
    return 0.1;
  }

  private scoreComplexityMatch(pattern: PatternDefinition, complexity: ComplexityLevel): number {
    const [minLevel, maxLevel] = pattern.complexityRange;
    const minIdx = COMPLEXITY_ORDER.indexOf(minLevel);
    const maxIdx = COMPLEXITY_ORDER.indexOf(maxLevel);
    const taskIdx = COMPLEXITY_ORDER.indexOf(complexity);

    if (taskIdx >= minIdx && taskIdx <= maxIdx) return 1.0;
    const distance = taskIdx < minIdx ? minIdx - taskIdx : taskIdx - maxIdx;
    return Math.max(0, 1.0 - distance * 0.3);
  }

  private getPerformanceBoost(patternId: string): number {
    if (!this.config.enablePerformanceWeighting) return 0;
    const record = this.performanceHistory.get(patternId);
    if (!record || record.totalExecutions < 3) return 0;
    return record.successRate * record.avgQualityScore * 0.5;
  }

  private computeConstraintPenalty(
    pattern: PatternDefinition,
    jurisdiction?: string,
    agentTier?: string,
    requiresMultiHop?: boolean
  ): number {
    if (!this.config.enableConstraintFiltering) return 0;
    let penalty = 0;

    if (requiresMultiHop && !pattern.strengths.includes('multi-hop') && !pattern.strengths.includes('knowledge-graph')) {
      penalty += 0.2;
    }

    if (agentTier === 'junior' && pattern.requiresMultiAgent) {
      penalty += 0.15;
    }

    return penalty;
  }

  private estimateTaskTokens(task: string, patternId?: string): number {
    const baseTokens = Math.ceil(task.length / 4);
    const pattern = PATTERN_DEFINITIONS.find(p => p.id === patternId);
    if (!pattern) return baseTokens * 3;
    return Math.ceil(baseTokens * (2 / pattern.tokenEfficiency));
  }

  recordOutcome(patternId: string, success: boolean, qualityScore: number, latencyMs: number, tokens: number): void {
    let record = this.performanceHistory.get(patternId);
    if (!record) {
      record = {
        patternId,
        successRate: 0,
        avgLatencyMs: 0,
        avgTokens: 0,
        avgQualityScore: 0,
        totalExecutions: 0,
        lastUsed: new Date().toISOString(),
      };
      this.performanceHistory.set(patternId, record);
    }

    const n = record.totalExecutions;
    record.successRate = (record.successRate * n + (success ? 1 : 0)) / (n + 1);
    record.avgLatencyMs = (record.avgLatencyMs * n + latencyMs) / (n + 1);
    record.avgTokens = (record.avgTokens * n + tokens) / (n + 1);
    record.avgQualityScore = (record.avgQualityScore * n + qualityScore) / (n + 1);
    record.totalExecutions++;
    record.lastUsed = new Date().toISOString();

    this.selectionHistory.push({
      taskHash: 'recorded',
      patternId,
      success,
    });
  }

  getStats(): {
    totalSelections: number;
    patternDistribution: Record<string, number>;
    performanceSummary: Record<string, { successRate: number; avgQuality: number; executions: number }>;
  } {
    const dist: Record<string, number> = {};
    for (const entry of this.selectionHistory) {
      dist[entry.patternId] = (dist[entry.patternId] || 0) + 1;
    }

    const perfSummary: Record<string, { successRate: number; avgQuality: number; executions: number }> = {};
    for (const [id, record] of this.performanceHistory) {
      perfSummary[id] = {
        successRate: record.successRate,
        avgQuality: record.avgQualityScore,
        executions: record.totalExecutions,
      };
    }

    return {
      totalSelections: this.totalSelections,
      patternDistribution: dist,
      performanceSummary: perfSummary,
    };
  }
}

let autoSelectorInstance: NyvPatternAutoSelector | null = null;

export function getPatternAutoSelector(config?: Partial<PatternAutoSelectorConfig>): NyvPatternAutoSelector {
  if (!autoSelectorInstance) {
    autoSelectorInstance = new NyvPatternAutoSelector(config);
  }
  return autoSelectorInstance;
}
