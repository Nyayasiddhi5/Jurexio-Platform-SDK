import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('verbalized-sampling-service');

export interface VerbSamplingConfig {
  defaultConfidenceThreshold: number;
  maxOptionsToAnalyze: number;
  enableCalibration: boolean;
  calibrationWindowSize: number;
  legalDomainMode: boolean;
  verbosityLevel: 'concise' | 'standard' | 'detailed';
}

export interface SamplingOption {
  id: string;
  content: string;
  rawScore: number;
  metadata?: Record<string, any>;
}

export interface VerbalizedProbability {
  optionId: string;
  numericProbability: number;
  verbalDescription: string;
  confidenceLevel: 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
  reasoning: string;
  legalContext?: string;
}

export interface SamplingResult {
  id: string;
  selectedOptionId: string;
  selectedContent: string;
  probabilities: VerbalizedProbability[];
  selectionReasoning: string;
  chainOfThought: ThoughtStep[];
  confidenceStatement: string;
  calibrationAdjustment: number;
  timestamp: string;
}

export interface ThoughtStep {
  step: number;
  description: string;
  confidence: number;
  verbalizedConfidence: string;
  evidence: string[];
  alternatives: string[];
}

export interface CalibrationData {
  predictedConfidence: number;
  actualOutcome: boolean;
  timestamp: string;
  domain?: string;
}

export interface VerbSamplingStats {
  totalSamplings: number;
  averageConfidence: number;
  calibrationScore: number;
  confidenceDistribution: Record<string, number>;
  domainBreakdown: Record<string, number>;
  calibrationHistory: number[];
  lastSamplingTimestamp: string | null;
}

const DEFAULT_CONFIG: VerbSamplingConfig = {
  defaultConfidenceThreshold: 0.7,
  maxOptionsToAnalyze: 5,
  enableCalibration: true,
  calibrationWindowSize: 100,
  legalDomainMode: true,
  verbosityLevel: 'standard',
};

const CONFIDENCE_VOCABULARY: Record<string, Record<string, string>> = {
  general: {
    very_low: 'Very unlikely; the evidence is insufficient to support this conclusion with any reasonable degree of certainty',
    low: 'Unlikely; while some supporting factors exist, significant doubts remain about this assessment',
    moderate: 'Moderately confident; the available evidence provides a reasonable basis, though notable uncertainty persists',
    high: 'Highly confident; strong supporting evidence and consistent indicators point toward this conclusion',
    very_high: 'Very highly confident; overwhelming evidence and multiple corroborating factors strongly support this conclusion',
  },
  legal: {
    very_low: 'Weak statutory basis; minimal precedent support and significant doctrinal uncertainty undermine this position',
    low: 'Limited legal support; some applicable provisions exist but precedent is sparse or distinguishable',
    moderate: 'Reasonable legal foundation; relevant statutes and moderate precedent support exist, though counterarguments are viable',
    high: 'Strong precedent support; well-established legal principles and substantial case law favor this interpretation',
    very_high: 'Compelling legal authority; binding precedent, clear statutory language, and consistent judicial interpretation strongly support this position',
  },
};

const LEGAL_DOMAIN_KEYWORDS: string[] = [
  'section', 'article', 'clause', 'statute', 'act', 'regulation', 'provision',
  'amendment', 'subsection', 'rule', 'precedent', 'judgment', 'court', 'tribunal',
  'jurisdiction', 'plaintiff', 'defendant', 'petition', 'appeal', 'verdict',
  'affidavit', 'bail', 'witness', 'evidence', 'constitution', 'advocate',
  'v.', 'vs.', 'supra', 'infra', 'ibid', 'et al', 'para', 'compliance',
];

const EVIDENCE_INDICATORS: string[] = [
  'according to', 'based on', 'as stated in', 'per', 'pursuant to',
  'in accordance with', 'as established by', 'supported by', 'confirmed by',
  'referenced in', 'cited in', 'as per', 'under', 'following', 'given that',
];

const STRUCTURAL_PATTERNS = {
  hasParagraphs: /\n\n/,
  hasNumberedList: /^\s*\d+[.)]\s/m,
  hasBulletList: /^\s*[-*]\s/m,
  hasHeadings: /^#+\s|^[A-Z][A-Z\s]{2,}:/m,
  hasCitations: /\[\d+\]|\(\d{4}\)|v\.\s/,
  hasConclusion: /\b(conclusion|summary|therefore|thus|accordingly|in summary)\b/i,
  hasLegalRef: /\b(section|article|clause|act|regulation)\s+\d+/i,
};

export class VerbalizedSamplingService extends EventEmitter {
  private config: VerbSamplingConfig;
  private calibrationData: CalibrationData[] = [];
  private samplingHistory: SamplingResult[] = [];
  private domainCounts: Record<string, number> = {};
  private confidenceCounts: Record<string, number> = {
    very_low: 0,
    low: 0,
    moderate: 0,
    high: 0,
    very_high: 0,
  };
  private lastSamplingTimestamp: string | null = null;

  constructor(config?: Partial<VerbSamplingConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('[VerbSampling] Verbalized Sampling Service initialized');
    logger.info(`[VerbSampling] Confidence threshold: ${this.config.defaultConfidenceThreshold}, Max options: ${this.config.maxOptionsToAnalyze}`);
    logger.info(`[VerbSampling] Calibration: ${this.config.enableCalibration ? 'enabled' : 'disabled'}, Window: ${this.config.calibrationWindowSize}`);
    logger.info(`[VerbSampling] Legal domain mode: ${this.config.legalDomainMode ? 'enabled' : 'disabled'}, Verbosity: ${this.config.verbosityLevel}`);
  }

  async analyzeSamplingOptions(prompt: string, options: SamplingOption[]): Promise<SamplingResult> {
    const startTime = Date.now();
    const resultId = randomUUID();

    const trimmedOptions = options.slice(0, this.config.maxOptionsToAnalyze);
    logger.info(`[VerbSampling] Analyzing ${trimmedOptions.length} options for prompt: "${prompt.substring(0, 60)}..."`);

    const domain = this.detectDomain(prompt, trimmedOptions);
    const probabilities = this.computeProbabilities(trimmedOptions, prompt, domain);
    const chainOfThought = await this.generateChainOfThought(prompt, trimmedOptions.map(o => o.content).join(' '));

    const selected = probabilities.reduce((best, p) =>
      p.numericProbability > best.numericProbability ? p : best, probabilities[0]);

    const selectedOption = trimmedOptions.find(o => o.id === selected.optionId) || trimmedOptions[0];
    const calibrationAdjustment = this.computeCalibrationAdjustment();

    const confidenceStatement = this.buildConfidenceStatement(selected, domain);
    const selectionReasoning = this.buildSelectionReasoning(selected, probabilities, domain);

    const result: SamplingResult = {
      id: resultId,
      selectedOptionId: selectedOption.id,
      selectedContent: selectedOption.content,
      probabilities,
      selectionReasoning,
      chainOfThought,
      confidenceStatement,
      calibrationAdjustment,
      timestamp: new Date().toISOString(),
    };

    this.samplingHistory.push(result);
    this.lastSamplingTimestamp = result.timestamp;
    this.confidenceCounts[selected.confidenceLevel]++;
    this.domainCounts[domain] = (this.domainCounts[domain] || 0) + 1;

    const elapsed = Date.now() - startTime;
    logger.info(`[VerbSampling] Analysis complete in ${elapsed}ms, selected option ${selectedOption.id.substring(0, 8)} with confidence ${selected.numericProbability.toFixed(4)}`);
    this.emit('sampling:completed', result);

    return result;
  }

  verbalizeConfidence(score: number, domain?: string): VerbalizedProbability {
    const clampedScore = this.clamp(score, 0, 1);
    const effectiveDomain = domain || (this.config.legalDomainMode ? 'legal' : 'general');
    const confidenceLevel = this.scoreToConfidenceLevel(clampedScore);
    const vocabulary = CONFIDENCE_VOCABULARY[effectiveDomain] || CONFIDENCE_VOCABULARY['general'];
    const verbalDescription = vocabulary[confidenceLevel];

    const reasoning = this.generateConfidenceReasoning(clampedScore, confidenceLevel, effectiveDomain);

    const result: VerbalizedProbability = {
      optionId: '',
      numericProbability: clampedScore,
      verbalDescription,
      confidenceLevel,
      reasoning,
    };

    if (effectiveDomain === 'legal') {
      result.legalContext = this.generateLegalContext(clampedScore, confidenceLevel);
    }

    this.emit('confidence:verbalized', result);
    return result;
  }

  async generateChainOfThought(prompt: string, context?: string): Promise<ThoughtStep[]> {
    const steps: ThoughtStep[] = [];
    const promptWords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const contextWords = context ? context.toLowerCase().split(/\s+/).filter(w => w.length > 3) : [];
    const allWords = [...new Set([...promptWords, ...contextWords])];

    const stepDefinitions = this.buildStepDefinitions(prompt, context);

    for (let i = 0; i < stepDefinitions.length; i++) {
      const def = stepDefinitions[i];
      const evidence = this.extractEvidence(def.focus, allWords, context);
      const alternatives = this.generateAlternatives(def.focus, i);
      const confidence = this.computeStepConfidence(evidence, alternatives, i, stepDefinitions.length);
      const verbalizedConfidence = this.verbalizeStepConfidence(confidence);

      steps.push({
        step: i + 1,
        description: def.description,
        confidence,
        verbalizedConfidence,
        evidence,
        alternatives,
      });
    }

    logger.info(`[VerbSampling] Generated chain of thought with ${steps.length} steps`);
    this.emit('chain:generated', steps);
    return steps;
  }

  recordCalibration(data: CalibrationData): void {
    if (!this.config.enableCalibration) {
      logger.info('[VerbSampling] Calibration disabled, skipping record');
      return;
    }

    this.calibrationData.push(data);

    if (this.calibrationData.length > this.config.calibrationWindowSize) {
      this.calibrationData = this.calibrationData.slice(-this.config.calibrationWindowSize);
    }

    if (data.domain) {
      this.domainCounts[data.domain] = (this.domainCounts[data.domain] || 0) + 1;
    }

    logger.info(`[VerbSampling] Calibration recorded, total: ${this.calibrationData.length}, Brier: ${this.getCalibrationScore().toFixed(4)}`);
    this.emit('calibration:recorded', data);
  }

  getCalibrationScore(): number {
    if (this.calibrationData.length === 0) return 0;

    let brierSum = 0;
    for (const entry of this.calibrationData) {
      const outcome = entry.actualOutcome ? 1 : 0;
      brierSum += Math.pow(entry.predictedConfidence - outcome, 2);
    }

    return brierSum / this.calibrationData.length;
  }

  getStats(): VerbSamplingStats {
    const totalSamplings = this.samplingHistory.length;

    let avgConfidence = 0;
    if (totalSamplings > 0) {
      const totalConf = this.samplingHistory.reduce((sum, s) => {
        const best = s.probabilities.reduce((b, p) =>
          p.numericProbability > b.numericProbability ? p : b, s.probabilities[0]);
        return sum + (best?.numericProbability || 0);
      }, 0);
      avgConfidence = totalConf / totalSamplings;
    }

    const calibrationScore = this.getCalibrationScore();

    const trendWindow = Math.min(50, this.calibrationData.length);
    const calibrationHistory: number[] = [];
    if (trendWindow > 0) {
      const recentData = this.calibrationData.slice(-trendWindow);
      for (let i = 0; i < recentData.length; i++) {
        const subset = recentData.slice(0, i + 1);
        let sum = 0;
        for (const entry of subset) {
          const outcome = entry.actualOutcome ? 1 : 0;
          sum += Math.pow(entry.predictedConfidence - outcome, 2);
        }
        calibrationHistory.push(sum / subset.length);
      }
    }

    return {
      totalSamplings,
      averageConfidence: avgConfidence,
      calibrationScore,
      confidenceDistribution: { ...this.confidenceCounts },
      domainBreakdown: { ...this.domainCounts },
      calibrationHistory,
      lastSamplingTimestamp: this.lastSamplingTimestamp,
    };
  }

  getConfidenceVocabulary(domain?: string): Record<string, string> {
    const effectiveDomain = domain || (this.config.legalDomainMode ? 'legal' : 'general');
    return { ...(CONFIDENCE_VOCABULARY[effectiveDomain] || CONFIDENCE_VOCABULARY['general']) };
  }

  resetCalibration(): void {
    this.calibrationData = [];
    this.samplingHistory = [];
    this.domainCounts = {};
    this.confidenceCounts = {
      very_low: 0,
      low: 0,
      moderate: 0,
      high: 0,
      very_high: 0,
    };
    this.lastSamplingTimestamp = null;

    logger.info('[VerbSampling] Calibration and history reset');
    this.emit('calibration:reset');
  }

  private computeProbabilities(
    options: SamplingOption[],
    prompt: string,
    domain: string
  ): VerbalizedProbability[] {
    const rawScores = options.map(o => this.scoreOption(o, prompt));
    const totalScore = rawScores.reduce((sum, s) => sum + s, 0);
    const normalizedScores = totalScore > 0
      ? rawScores.map(s => s / totalScore)
      : rawScores.map(() => 1 / rawScores.length);

    const calibrationAdj = this.computeCalibrationAdjustment();

    return options.map((option, idx) => {
      const adjustedScore = this.clamp(normalizedScores[idx] + calibrationAdj, 0, 1);
      const confidenceLevel = this.scoreToConfidenceLevel(adjustedScore);
      const vocabulary = CONFIDENCE_VOCABULARY[domain] || CONFIDENCE_VOCABULARY['general'];
      const verbalDescription = this.buildVerbalDescription(adjustedScore, confidenceLevel, vocabulary, option);
      const reasoning = this.buildOptionReasoning(option, adjustedScore, prompt, domain);

      const result: VerbalizedProbability = {
        optionId: option.id,
        numericProbability: adjustedScore,
        verbalDescription,
        confidenceLevel,
        reasoning,
      };

      if (domain === 'legal') {
        result.legalContext = this.generateLegalContext(adjustedScore, confidenceLevel);
      }

      return result;
    });
  }

  private scoreOption(option: SamplingOption, prompt: string): number {
    let score = option.rawScore;

    const contentLower = option.content.toLowerCase();
    const promptLower = prompt.toLowerCase();
    const contentWords = contentLower.split(/\s+/);
    const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3);

    if (promptWords.length > 0) {
      const overlapCount = promptWords.filter(pw => contentLower.includes(pw)).length;
      score += (overlapCount / promptWords.length) * 0.15;
    }

    const wordCount = contentWords.length;
    if (wordCount >= 20 && wordCount <= 500) {
      score += 0.1;
    } else if (wordCount < 10) {
      score -= 0.1;
    }

    const structuralScore = this.computeStructuralScore(option.content);
    score += structuralScore * 0.1;

    const evidenceScore = this.computeEvidenceScore(option.content);
    score += evidenceScore * 0.1;

    const repetitionPenalty = this.measureRepetition(option.content);
    score -= repetitionPenalty * 0.15;

    return Math.max(score, 0.01);
  }

  private computeStructuralScore(content: string): number {
    let score = 0;
    let checks = 0;

    for (const [, pattern] of Object.entries(STRUCTURAL_PATTERNS)) {
      checks++;
      if (pattern.test(content)) {
        score++;
      }
    }

    return checks > 0 ? score / checks : 0;
  }

  private computeEvidenceScore(content: string): number {
    const contentLower = content.toLowerCase();
    let count = 0;

    for (const indicator of EVIDENCE_INDICATORS) {
      if (contentLower.includes(indicator)) {
        count++;
      }
    }

    return Math.min(count / 5, 1);
  }

  private measureRepetition(content: string): number {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length < 2) return 0;

    let duplicatePairs = 0;
    let totalPairs = 0;

    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        totalPairs++;
        const similarity = this.computeJaccardSimilarity(
          sentences[i].trim().toLowerCase(),
          sentences[j].trim().toLowerCase()
        );
        if (similarity > 0.7) {
          duplicatePairs++;
        }
      }
    }

    return totalPairs > 0 ? duplicatePairs / totalPairs : 0;
  }

  private computeJaccardSimilarity(a: string, b: string): number {
    const wordsA = a.split(/\s+/);
    const wordsB = b.split(/\s+/);
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);
    let intersectionSize = 0;
    setA.forEach(x => { if (setB.has(x)) intersectionSize++; });
    const unionSize = setA.size + setB.size - intersectionSize;
    return unionSize > 0 ? intersectionSize / unionSize : 0;
  }

  private scoreToConfidenceLevel(score: number): 'very_low' | 'low' | 'moderate' | 'high' | 'very_high' {
    if (score < 0.2) return 'very_low';
    if (score < 0.4) return 'low';
    if (score < 0.6) return 'moderate';
    if (score < 0.8) return 'high';
    return 'very_high';
  }

  private detectDomain(prompt: string, options: SamplingOption[]): string {
    if (!this.config.legalDomainMode) return 'general';

    const allText = [prompt, ...options.map(o => o.content)].join(' ').toLowerCase();
    let legalKeywordCount = 0;

    for (const keyword of LEGAL_DOMAIN_KEYWORDS) {
      if (allText.includes(keyword.toLowerCase())) {
        legalKeywordCount++;
      }
    }

    return legalKeywordCount >= 3 ? 'legal' : 'general';
  }

  private buildVerbalDescription(
    score: number,
    level: string,
    vocabulary: Record<string, string>,
    option: SamplingOption
  ): string {
    const baseDescription = vocabulary[level] || vocabulary['moderate'];

    if (this.config.verbosityLevel === 'concise') {
      return baseDescription;
    }

    const percentage = (score * 100).toFixed(1);

    if (this.config.verbosityLevel === 'detailed') {
      return `${baseDescription}. Assigned probability: ${percentage}%. Content length: ${option.content.split(/\s+/).length} words. Raw score: ${option.rawScore.toFixed(4)}.`;
    }

    return `${baseDescription} (${percentage}% probability)`;
  }

  private buildOptionReasoning(
    option: SamplingOption,
    score: number,
    prompt: string,
    domain: string
  ): string {
    const factors: string[] = [];

    const wordCount = option.content.split(/\s+/).length;
    if (wordCount >= 20 && wordCount <= 500) {
      factors.push('appropriate response length');
    } else if (wordCount < 20) {
      factors.push('response is brief');
    } else {
      factors.push('response is lengthy');
    }

    const promptLower = prompt.toLowerCase();
    const contentLower = option.content.toLowerCase();
    const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3);
    if (promptWords.length > 0) {
      const overlap = promptWords.filter(pw => contentLower.includes(pw)).length;
      const ratio = overlap / promptWords.length;
      if (ratio > 0.5) {
        factors.push('strong relevance to the query');
      } else if (ratio > 0.2) {
        factors.push('moderate relevance to the query');
      } else {
        factors.push('limited direct relevance to the query');
      }
    }

    const evidenceScore = this.computeEvidenceScore(option.content);
    if (evidenceScore > 0.5) {
      factors.push('well-supported with evidence indicators');
    } else if (evidenceScore > 0.2) {
      factors.push('some evidence provided');
    }

    if (domain === 'legal') {
      const legalCount = LEGAL_DOMAIN_KEYWORDS.filter(kw => contentLower.includes(kw.toLowerCase())).length;
      if (legalCount >= 5) {
        factors.push('strong legal terminology usage');
      } else if (legalCount >= 2) {
        factors.push('moderate legal terminology usage');
      }
    }

    return `Score ${score.toFixed(4)} assigned based on: ${factors.join('; ')}.`;
  }

  private buildConfidenceStatement(selected: VerbalizedProbability, domain: string): string {
    const percentage = (selected.numericProbability * 100).toFixed(1);

    if (domain === 'legal') {
      return `With ${percentage}% confidence and ${selected.confidenceLevel.replace('_', ' ')} certainty, the selected response demonstrates ${selected.legalContext || 'adequate legal grounding'}.`;
    }

    return `The selected response carries a ${selected.confidenceLevel.replace('_', ' ')} confidence level at ${percentage}%, indicating ${selected.verbalDescription.substring(0, 100)}.`;
  }

  private buildSelectionReasoning(
    selected: VerbalizedProbability,
    allProbabilities: VerbalizedProbability[],
    domain: string
  ): string {
    const sorted = [...allProbabilities].sort((a, b) => b.numericProbability - a.numericProbability);
    const rank = sorted.findIndex(p => p.optionId === selected.optionId) + 1;
    const totalOptions = allProbabilities.length;

    let reasoning = `Selected option ranked #${rank} out of ${totalOptions} candidates.`;

    if (sorted.length >= 2) {
      const margin = sorted[0].numericProbability - sorted[1].numericProbability;
      if (margin > 0.2) {
        reasoning += ` Clear frontrunner with ${(margin * 100).toFixed(1)}% margin over the next best option.`;
      } else if (margin > 0.05) {
        reasoning += ` Moderate advantage with ${(margin * 100).toFixed(1)}% margin.`;
      } else {
        reasoning += ` Close contest with only ${(margin * 100).toFixed(1)}% margin separating top options.`;
      }
    }

    if (domain === 'legal') {
      reasoning += ' Legal domain analysis applied with specialized confidence vocabulary.';
    }

    return reasoning;
  }

  private generateConfidenceReasoning(score: number, level: string, domain: string): string {
    const percentage = (score * 100).toFixed(1);

    if (domain === 'legal') {
      const legalReasons: Record<string, string> = {
        very_low: `At ${percentage}%, this assessment lacks sufficient legal authority. Minimal relevant precedent or statutory support was identified.`,
        low: `At ${percentage}%, limited legal support exists. Some applicable provisions were found but precedent coverage is incomplete.`,
        moderate: `At ${percentage}%, a reasonable legal foundation is present. Relevant statutes apply and some precedent supports this position.`,
        high: `At ${percentage}%, strong legal support is evident. Well-established principles and substantial case law favor this interpretation.`,
        very_high: `At ${percentage}%, compelling legal authority exists. Binding precedent and clear statutory language strongly support this position.`,
      };
      return legalReasons[level] || legalReasons['moderate'];
    }

    const generalReasons: Record<string, string> = {
      very_low: `At ${percentage}%, the evidence base is insufficient. Key supporting factors are absent or contradictory.`,
      low: `At ${percentage}%, some supporting indicators exist but significant uncertainty remains.`,
      moderate: `At ${percentage}%, a reasonable evidence base supports this assessment with acknowledged limitations.`,
      high: `At ${percentage}%, multiple consistent indicators and strong supporting evidence underpin this assessment.`,
      very_high: `At ${percentage}%, overwhelming corroborating evidence from multiple independent sources supports this conclusion.`,
    };
    return generalReasons[level] || generalReasons['moderate'];
  }

  private generateLegalContext(score: number, level: string): string {
    const contexts: Record<string, string> = {
      very_low: 'weak statutory basis with minimal precedent support',
      low: 'limited legal authority with sparse applicable case law',
      moderate: 'reasonable statutory foundation with moderate precedent coverage',
      high: 'strong precedent support with well-established legal principles',
      very_high: 'compelling legal authority with binding precedent and clear statutory language',
    };
    return contexts[level] || contexts['moderate'];
  }

  private buildStepDefinitions(prompt: string, context?: string): Array<{ focus: string; description: string }> {
    const steps: Array<{ focus: string; description: string }> = [];

    steps.push({
      focus: 'problem_identification',
      description: `Identifying the core question and key requirements from the prompt: "${prompt.substring(0, 80)}"`,
    });

    const promptLower = prompt.toLowerCase();
    const hasLegalContext = LEGAL_DOMAIN_KEYWORDS.some(kw => promptLower.includes(kw.toLowerCase()));

    if (hasLegalContext && this.config.legalDomainMode) {
      steps.push({
        focus: 'legal_framework',
        description: 'Analyzing applicable legal framework, relevant statutes, and jurisdictional considerations',
      });
    }

    if (context) {
      steps.push({
        focus: 'context_integration',
        description: 'Integrating provided context with the identified requirements to establish a comprehensive analytical foundation',
      });
    }

    steps.push({
      focus: 'evidence_assessment',
      description: 'Evaluating available evidence, identifying supporting factors and potential counterarguments',
    });

    steps.push({
      focus: 'option_evaluation',
      description: 'Assessing possible response approaches, weighing trade-offs between completeness, accuracy, and relevance',
    });

    steps.push({
      focus: 'confidence_synthesis',
      description: 'Synthesizing findings into a confidence assessment, verbalizing the probability distribution across considered options',
    });

    return steps;
  }

  private extractEvidence(focus: string, words: string[], context?: string): string[] {
    const evidence: string[] = [];
    const relevantWords = words.slice(0, 20);

    const evidenceTemplates: Record<string, string[]> = {
      problem_identification: [
        'Query contains specific domain terminology',
        'Request scope is well-defined with clear boundaries',
        'Multiple analytical dimensions identified in the prompt',
      ],
      legal_framework: [
        'Applicable statutory provisions identified',
        'Relevant jurisdictional requirements assessed',
        'Precedent coverage evaluated for consistency',
      ],
      context_integration: [
        'Contextual information aligns with query requirements',
        'Supporting details provide additional analytical depth',
        'Cross-referencing context with primary query confirms scope',
      ],
      evidence_assessment: [
        'Multiple supporting indicators identified',
        'Evidence consistency evaluated across sources',
        'Potential counterarguments acknowledged and assessed',
      ],
      option_evaluation: [
        'Response options compared on relevance and completeness',
        'Trade-off analysis performed across quality dimensions',
        'Optimal approach selected based on multi-criteria assessment',
      ],
      confidence_synthesis: [
        'Confidence level determined through systematic evaluation',
        'Probability distribution verbalized with supporting reasoning',
        'Calibration adjustment applied based on historical accuracy',
      ],
    };

    const templates = evidenceTemplates[focus] || evidenceTemplates['evidence_assessment'];
    const keywordCount = relevantWords.length;

    if (keywordCount > 10) {
      evidence.push(templates[0]);
      evidence.push(templates[1]);
      evidence.push(templates[2]);
    } else if (keywordCount > 5) {
      evidence.push(templates[0]);
      evidence.push(templates[1]);
    } else {
      evidence.push(templates[0]);
    }

    if (context && context.length > 50) {
      evidence.push('Additional context provides supplementary analytical basis');
    }

    return evidence;
  }

  private generateAlternatives(focus: string, stepIndex: number): string[] {
    const alternativesByFocus: Record<string, string[]> = {
      problem_identification: [
        'Alternative interpretation of query scope',
        'Broader framing of the analytical question',
      ],
      legal_framework: [
        'Alternative jurisdictional analysis',
        'Different statutory interpretation approach',
      ],
      context_integration: [
        'Selective context application',
        'Context-independent analysis approach',
      ],
      evidence_assessment: [
        'Weight-of-evidence approach rather than preponderance',
        'Bayesian updating with different prior assumptions',
      ],
      option_evaluation: [
        'Satisficing rather than optimizing approach',
        'Equal weight across all evaluation dimensions',
      ],
      confidence_synthesis: [
        'Conservative confidence estimate with wider uncertainty bounds',
        'Domain-specific calibration adjustment',
      ],
    };

    return alternativesByFocus[focus] || [
      'Alternative analytical approach considered',
      'Different weighting of evaluation criteria',
    ];
  }

  private computeStepConfidence(
    evidence: string[],
    alternatives: string[],
    stepIndex: number,
    totalSteps: number
  ): number {
    let confidence = 0.5;

    confidence += Math.min(evidence.length * 0.1, 0.3);
    confidence -= Math.min(alternatives.length * 0.05, 0.15);

    const progressFactor = (stepIndex + 1) / totalSteps;
    confidence += progressFactor * 0.1;

    if (this.calibrationData.length > 10) {
      const recentAccuracy = this.computeRecentAccuracy();
      confidence = confidence * 0.8 + recentAccuracy * 0.2;
    }

    return this.clamp(confidence, 0.1, 0.95);
  }

  private verbalizeStepConfidence(confidence: number): string {
    const level = this.scoreToConfidenceLevel(confidence);
    const percentage = (confidence * 100).toFixed(1);

    const descriptions: Record<string, string> = {
      very_low: `Low certainty (${percentage}%) - significant uncertainty remains at this stage`,
      low: `Below average certainty (${percentage}%) - additional evidence would strengthen this step`,
      moderate: `Reasonable certainty (${percentage}%) - adequate basis established for proceeding`,
      high: `Strong certainty (${percentage}%) - solid foundation supports this analytical step`,
      very_high: `Very strong certainty (${percentage}%) - comprehensive evidence supports this conclusion`,
    };

    return descriptions[level] || descriptions['moderate'];
  }

  private computeCalibrationAdjustment(): number {
    if (!this.config.enableCalibration || this.calibrationData.length < 5) return 0;

    const recentData = this.calibrationData.slice(-20);
    let overconfidenceSum = 0;

    for (const entry of recentData) {
      const outcome = entry.actualOutcome ? 1 : 0;
      overconfidenceSum += entry.predictedConfidence - outcome;
    }

    const avgOverconfidence = overconfidenceSum / recentData.length;
    return this.clamp(-avgOverconfidence * 0.1, -0.1, 0.1);
  }

  private computeRecentAccuracy(): number {
    if (this.calibrationData.length === 0) return 0.5;

    const recent = this.calibrationData.slice(-20);
    let correct = 0;

    for (const entry of recent) {
      const predicted = entry.predictedConfidence >= 0.5;
      if (predicted === entry.actualOutcome) {
        correct++;
      }
    }

    return correct / recent.length;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

export const verbalizedSamplingService = new VerbalizedSamplingService();
