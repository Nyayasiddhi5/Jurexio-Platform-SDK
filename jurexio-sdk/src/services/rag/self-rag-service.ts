/**
 * Self-RAG Service with Hallucination Detection
 * 
 * Features:
 * - Answer validation against retrieved context
 * - Hallucination detection and scoring
 * - Automatic regeneration for failed validations
 * - Citation verification
 * - Confidence calibration
 */

import { v4 as uuidv4 } from 'uuid';

export type HallucinationType = 
  | 'factual_error'
  | 'unsupported_claim'
  | 'contradiction'
  | 'fabricated_source'
  | 'exaggeration'
  | 'out_of_context';

export interface HallucinationDetection {
  id: string;
  type: HallucinationType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  claim: string;
  evidence?: string;
  reasoning: string;
  location: { start: number; end: number };
}

export interface ValidationResult {
  id: string;
  answerId: string;
  isValid: boolean;
  overallScore: number;
  groundednessScore: number;
  relevanceScore: number;
  coherenceScore: number;
  hallucinations: HallucinationDetection[];
  supportedClaims: string[];
  unsupportedClaims: string[];
  suggestions: string[];
}

export interface SelfRAGIteration {
  iterationNumber: number;
  answer: string;
  validation: ValidationResult;
  regenerated: boolean;
  timestamp: Date;
  latencyMs: number;
}

export interface SelfRAGSession {
  id: string;
  query: string;
  context: string;
  iterations: SelfRAGIteration[];
  finalAnswer: string;
  finalValidation: ValidationResult;
  totalIterations: number;
  passed: boolean;
  confidenceScore: number;
  totalLatencyMs: number;
  createdAt: Date;
}

export interface SelfRAGConfig {
  validationThreshold: number;
  maxRegenerations: number;
  hallucinationTolerance: number;
  requireCitations: boolean;
  minGroundednessScore: number;
}

export interface CitationCheck {
  claim: string;
  citedSource?: string;
  foundInContext: boolean;
  matchScore: number;
  contextExcerpt?: string;
}

type AnswerGenerator = (query: string, context: string, feedback?: ValidationResult) => Promise<string>;

class SelfRAGService {
  private sessions: Map<string, SelfRAGSession> = new Map();
  
  private config: SelfRAGConfig = {
    validationThreshold: 0.75,
    maxRegenerations: 3,
    hallucinationTolerance: 1,
    requireCitations: false,
    minGroundednessScore: 0.7
  };

  private readonly HALLUCINATION_PATTERNS: Array<{
    type: HallucinationType;
    pattern: RegExp;
    severity: HallucinationDetection['severity'];
  }> = [
    { 
      type: 'factual_error',
      pattern: /\b(always|never|all|none|every|no one)\b.*\b(is|are|was|were)\b/i,
      severity: 'medium'
    },
    {
      type: 'fabricated_source',
      pattern: /according to\s+(?!the\s+(context|document|text|passage))/i,
      severity: 'high'
    },
    {
      type: 'exaggeration',
      pattern: /\b(extremely|incredibly|absolutely|completely|totally|definitely|certainly)\b/i,
      severity: 'low'
    },
    {
      type: 'unsupported_claim',
      pattern: /\b(research shows|studies indicate|experts say|scientists believe)\b/i,
      severity: 'high'
    }
  ];

  async validateAnswer(
    answer: string,
    context: string,
    query: string
  ): Promise<ValidationResult> {
    const hallucinations: HallucinationDetection[] = [];
    const supportedClaims: string[] = [];
    const unsupportedClaims: string[] = [];
    const suggestions: string[] = [];

    const groundednessScore = this.calculateGroundedness(answer, context);
    const relevanceScore = this.calculateRelevance(answer, query);
    const coherenceScore = this.calculateCoherence(answer);

    const claims = this.extractClaims(answer);
    
    for (const claim of claims) {
      const isSupported = this.isClaimSupported(claim, context);
      if (isSupported) {
        supportedClaims.push(claim);
      } else {
        unsupportedClaims.push(claim);
        hallucinations.push({
          id: uuidv4(),
          type: 'unsupported_claim',
          severity: 'medium',
          claim,
          reasoning: 'Claim not found in provided context',
          location: {
            start: answer.indexOf(claim),
            end: answer.indexOf(claim) + claim.length
          }
        });
      }
    }

    for (const { type, pattern, severity } of this.HALLUCINATION_PATTERNS) {
      const matches = answer.match(pattern);
      if (matches) {
        for (const match of matches) {
          const existing = hallucinations.find(h => h.claim.includes(match));
          if (!existing) {
            hallucinations.push({
              id: uuidv4(),
              type,
              severity,
              claim: match,
              reasoning: `Detected ${type.replace(/_/g, ' ')} pattern`,
              location: {
                start: answer.indexOf(match),
                end: answer.indexOf(match) + match.length
              }
            });
          }
        }
      }
    }

    const criticalCount = hallucinations.filter(h => h.severity === 'critical').length;
    const highCount = hallucinations.filter(h => h.severity === 'high').length;
    const mediumCount = hallucinations.filter(h => h.severity === 'medium').length;
    const lowCount = hallucinations.filter(h => h.severity === 'low').length;

    const hallucinationPenalty = 
      criticalCount * 0.4 + 
      highCount * 0.2 + 
      mediumCount * 0.1 + 
      lowCount * 0.05;

    const overallScore = Math.max(0, Math.min(1,
      (groundednessScore * 0.4 + relevanceScore * 0.3 + coherenceScore * 0.3) - hallucinationPenalty
    ));

    if (groundednessScore < this.config.minGroundednessScore) {
      suggestions.push('Answer needs to be more grounded in the provided context');
    }
    if (hallucinations.length > this.config.hallucinationTolerance) {
      suggestions.push(`Remove or verify ${hallucinations.length} potential hallucinations`);
    }
    if (unsupportedClaims.length > 0) {
      suggestions.push(`Support or remove unsupported claims: ${unsupportedClaims.slice(0, 2).join('; ')}`);
    }

    const isValid = overallScore >= this.config.validationThreshold &&
                    criticalCount === 0 &&
                    groundednessScore >= this.config.minGroundednessScore;

    return {
      id: uuidv4(),
      answerId: uuidv4(),
      isValid,
      overallScore,
      groundednessScore,
      relevanceScore,
      coherenceScore,
      hallucinations,
      supportedClaims,
      unsupportedClaims,
      suggestions
    };
  }

  private calculateGroundedness(answer: string, context: string): number {
    const answerSentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const contextLower = context.toLowerCase();
    
    let groundedCount = 0;
    for (const sentence of answerSentences) {
      const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matchedWords = words.filter(w => contextLower.includes(w)).length;
      if (matchedWords / Math.max(1, words.length) > 0.3) {
        groundedCount++;
      }
    }

    return answerSentences.length > 0 ? groundedCount / answerSentences.length : 0.5;
  }

  private calculateRelevance(answer: string, query: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const answerLower = answer.toLowerCase();
    
    const matchedTerms = queryTerms.filter(t => answerLower.includes(t)).length;
    const termCoverage = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0.5;

    const addressesQuestion = 
      (query.toLowerCase().includes('what') && /is|are|means|refers to/i.test(answer)) ||
      (query.toLowerCase().includes('how') && /step|process|method|way/i.test(answer)) ||
      (query.toLowerCase().includes('why') && /because|reason|due to|since/i.test(answer));

    return Math.min(1, termCoverage + (addressesQuestion ? 0.2 : 0));
  }

  private calculateCoherence(answer: string): number {
    const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length < 2) return 0.7;

    const hasTransitions = /however|therefore|additionally|furthermore|moreover|thus|hence/i.test(answer);
    const hasLogicalFlow = sentences.every((s, i) => {
      if (i === 0) return true;
      const prevWords = new Set(sentences[i-1].toLowerCase().split(/\s+/));
      const currWords = s.toLowerCase().split(/\s+/);
      return currWords.some(w => prevWords.has(w) || w.length < 4);
    });

    return Math.min(1, 0.5 + (hasTransitions ? 0.25 : 0) + (hasLogicalFlow ? 0.25 : 0));
  }

  private extractClaims(answer: string): string[] {
    const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    return sentences.filter(sentence => {
      const hasAssertion = /\b(is|are|was|were|has|have|will|can|should)\b/i.test(sentence);
      const notQuestion = !sentence.trim().endsWith('?');
      return hasAssertion && notQuestion;
    }).map(s => s.trim());
  }

  private isClaimSupported(claim: string, context: string): boolean {
    const claimWords = claim.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const contextLower = context.toLowerCase();
    
    const matchedWords = claimWords.filter(w => contextLower.includes(w)).length;
    const matchRatio = claimWords.length > 0 ? matchedWords / claimWords.length : 0;

    return matchRatio > 0.4;
  }

  async detectHallucinations(
    answer: string,
    context: string
  ): Promise<HallucinationDetection[]> {
    const hallucinations: HallucinationDetection[] = [];

    for (const { type, pattern, severity } of this.HALLUCINATION_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, 'gi');
      while ((match = regex.exec(answer)) !== null) {
        hallucinations.push({
          id: uuidv4(),
          type,
          severity,
          claim: match[0],
          reasoning: `Pattern match for ${type.replace(/_/g, ' ')}`,
          location: {
            start: match.index,
            end: match.index + match[0].length
          }
        });
      }
    }

    const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences) {
      const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const contextLower = context.toLowerCase();
      const matchedWords = words.filter(w => contextLower.includes(w)).length;
      
      if (words.length > 3 && matchedWords / words.length < 0.2) {
        hallucinations.push({
          id: uuidv4(),
          type: 'out_of_context',
          severity: 'medium',
          claim: sentence.trim(),
          reasoning: 'Sentence has very low overlap with context',
          location: {
            start: answer.indexOf(sentence),
            end: answer.indexOf(sentence) + sentence.length
          }
        });
      }
    }

    return hallucinations;
  }

  async checkCitations(
    answer: string,
    context: string
  ): Promise<CitationCheck[]> {
    const citationPatterns = [
      /according to (?:the )?([\w\s]+)/gi,
      /as (?:stated|mentioned|noted) in ([\w\s]+)/gi,
      /\[([\d\w]+)\]/gi,
      /\(([^)]+, \d{4})\)/gi
    ];

    const claims: CitationCheck[] = [];
    const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 10);

    for (const sentence of sentences) {
      let hasCitation = false;
      let citedSource = '';

      for (const pattern of citationPatterns) {
        const match = pattern.exec(sentence);
        if (match) {
          hasCitation = true;
          citedSource = match[1];
          break;
        }
        pattern.lastIndex = 0;
      }

      const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const contextLower = context.toLowerCase();
      const matchedWords = words.filter(w => contextLower.includes(w)).length;
      const matchScore = words.length > 0 ? matchedWords / words.length : 0;

      let contextExcerpt: string | undefined;
      if (matchScore > 0.3) {
        const firstMatchWord = words.find(w => contextLower.includes(w));
        if (firstMatchWord) {
          const idx = contextLower.indexOf(firstMatchWord);
          contextExcerpt = context.slice(Math.max(0, idx - 50), idx + 100);
        }
      }

      claims.push({
        claim: sentence.trim(),
        citedSource: hasCitation ? citedSource : undefined,
        foundInContext: matchScore > 0.3,
        matchScore,
        contextExcerpt
      });
    }

    return claims;
  }

  async runSelfRAGLoop(
    query: string,
    context: string,
    generator: AnswerGenerator,
    options: {
      config?: Partial<SelfRAGConfig>;
    } = {}
  ): Promise<SelfRAGSession> {
    const startTime = Date.now();
    const sessionId = uuidv4();
    const sessionConfig = { ...this.config, ...options.config };
    
    const session: SelfRAGSession = {
      id: sessionId,
      query,
      context,
      iterations: [],
      finalAnswer: '',
      finalValidation: {} as ValidationResult,
      totalIterations: 0,
      passed: false,
      confidenceScore: 0,
      totalLatencyMs: 0,
      createdAt: new Date()
    };

    let currentAnswer = '';
    let previousValidation: ValidationResult | undefined;

    for (let i = 0; i < sessionConfig.maxRegenerations + 1; i++) {
      const iterationStart = Date.now();

      currentAnswer = await generator(query, context, previousValidation);

      const validation = await this.validateAnswer(currentAnswer, context, query);

      const iteration: SelfRAGIteration = {
        iterationNumber: i + 1,
        answer: currentAnswer,
        validation,
        regenerated: i > 0,
        timestamp: new Date(),
        latencyMs: Date.now() - iterationStart
      };

      session.iterations.push(iteration);

      if (validation.isValid) {
        session.finalAnswer = currentAnswer;
        session.finalValidation = validation;
        session.passed = true;
        session.confidenceScore = validation.overallScore;
        break;
      }

      if (i === sessionConfig.maxRegenerations) {
        session.finalAnswer = currentAnswer;
        session.finalValidation = validation;
        session.passed = false;
        session.confidenceScore = validation.overallScore;
        break;
      }

      previousValidation = validation;
    }

    session.totalIterations = session.iterations.length;
    session.totalLatencyMs = Date.now() - startTime;
    this.sessions.set(sessionId, session);
    
    return session;
  }

  async regenerateAnswer(
    query: string,
    context: string,
    previousAnswer: string,
    validation: ValidationResult,
    generator: AnswerGenerator
  ): Promise<string> {
    return await generator(query, context, validation);
  }

  getSession(sessionId: string): SelfRAGSession | undefined {
    return this.sessions.get(sessionId);
  }

  updateConfig(newConfig: Partial<SelfRAGConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getStats(): {
    totalSessions: number;
    passRate: number;
    averageIterations: number;
    averageHallucinations: number;
    averageGroundedness: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const passed = sessions.filter(s => s.passed).length;
    const totalIterations = sessions.reduce((sum, s) => sum + s.totalIterations, 0);
    const totalHallucinations = sessions.reduce((sum, s) => 
      sum + (s.finalValidation.hallucinations?.length || 0), 0);
    const totalGroundedness = sessions.reduce((sum, s) => 
      sum + (s.finalValidation.groundednessScore || 0), 0);

    return {
      totalSessions: sessions.length,
      passRate: sessions.length > 0 ? passed / sessions.length : 0,
      averageIterations: sessions.length > 0 ? totalIterations / sessions.length : 0,
      averageHallucinations: sessions.length > 0 ? totalHallucinations / sessions.length : 0,
      averageGroundedness: sessions.length > 0 ? totalGroundedness / sessions.length : 0
    };
  }
}

export const selfRAGService = new SelfRAGService();
export default selfRAGService;
