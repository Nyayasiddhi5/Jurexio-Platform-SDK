/**
 * Confidence Scorer Service - HITL Confidence Thresholds
 * Jurexio Enterprise Platform SDK v2.0 - January 18, 2026
 * 
 * Implements confidence-based escalation logic:
 * - Auto-approve: >= 0.95 confidence
 * - Review queue: 0.70 - 0.95 confidence
 * - Escalation: < 0.50 confidence
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('confidence-scorer');

export const CONFIDENCE_THRESHOLDS = {
  AUTO_APPROVE: 0.95,    // >= 95% → auto-approve
  REVIEW: 0.70,          // 70-95% → queue for review
  ESCALATE: 0.50         // < 50% → immediate escalation
} as const;

export interface ConfidenceInput {
  agentScores: number[];
  taskComplexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4';
  modelQuality?: number;
  previousSuccessRate?: number;
  domainRelevance?: number;
}

export interface ConfidenceResult {
  confidence: number;
  action: 'auto_approve' | 'review' | 'escalate';
  factors: ConfidenceFactors;
  explanation: string;
}

export interface ConfidenceFactors {
  agentScore: number;
  complexityFactor: number;
  romaFactor: number;
  modelFactor: number;
  historicalFactor: number;
  domainFactor: number;
}

export class ConfidenceScorer extends EventEmitter {
  private static instance: ConfidenceScorer;
  private thresholds: { AUTO_APPROVE: number; REVIEW: number; ESCALATE: number };

  private constructor() {
    super();
    this.thresholds = { ...CONFIDENCE_THRESHOLDS };
    logger.info('🎯 ConfidenceScorer initialized');
    logger.info(`   Auto-approve: >= ${this.thresholds.AUTO_APPROVE}`);
    logger.info(`   Review: ${this.thresholds.REVIEW} - ${this.thresholds.AUTO_APPROVE}`);
    logger.info(`   Escalate: < ${this.thresholds.ESCALATE}`);
  }

  public static getInstance(): ConfidenceScorer {
    if (!ConfidenceScorer.instance) {
      ConfidenceScorer.instance = new ConfidenceScorer();
    }
    return ConfidenceScorer.instance;
  }

  /**
   * Calculate confidence score and determine HITL action
   */
  public evaluate(input: ConfidenceInput): ConfidenceResult {
    const factors = this.calculateFactors(input);
    const confidence = this.computeConfidence(factors);
    const action = this.determineAction(confidence);
    const explanation = this.generateExplanation(confidence, action, factors);

    const result: ConfidenceResult = {
      confidence,
      action,
      factors,
      explanation
    };

    this.emit('confidence_evaluated', result);
    return result;
  }

  private calculateFactors(input: ConfidenceInput): ConfidenceFactors {
    // Agent score factor (0-1)
    const agentScore = input.agentScores.length > 0
      ? Math.min(input.agentScores.reduce((a, b) => a + b, 0) / (input.agentScores.length * 100), 1)
      : 0.5;

    // Complexity factor (inverse relationship)
    const complexityFactors = {
      'simple': 1.0,
      'moderate': 0.9,
      'complex': 0.75,
      'very_complex': 0.6
    };
    const complexityFactor = complexityFactors[input.taskComplexity];

    // ROMA level factor (higher level = more confidence)
    const romaFactors = {
      'L4': 1.0,
      'L3': 0.85,
      'L2': 0.7,
      'L1': 0.55
    };
    const romaFactor = romaFactors[input.romaLevel];

    // Model quality factor
    const modelFactor = input.modelQuality ?? 0.8;

    // Historical success factor
    const historicalFactor = input.previousSuccessRate ?? 0.75;

    // Domain relevance factor
    const domainFactor = input.domainRelevance ?? 0.8;

    return {
      agentScore,
      complexityFactor,
      romaFactor,
      modelFactor,
      historicalFactor,
      domainFactor
    };
  }

  private computeConfidence(factors: ConfidenceFactors): number {
    // Weighted average of all factors
    const weights = {
      agentScore: 0.25,
      complexityFactor: 0.20,
      romaFactor: 0.20,
      modelFactor: 0.15,
      historicalFactor: 0.10,
      domainFactor: 0.10
    };

    const confidence = 
      factors.agentScore * weights.agentScore +
      factors.complexityFactor * weights.complexityFactor +
      factors.romaFactor * weights.romaFactor +
      factors.modelFactor * weights.modelFactor +
      factors.historicalFactor * weights.historicalFactor +
      factors.domainFactor * weights.domainFactor;

    // Ensure bounds
    return Math.min(Math.max(confidence, 0), 1);
  }

  private determineAction(confidence: number): 'auto_approve' | 'review' | 'escalate' {
    if (confidence >= this.thresholds.AUTO_APPROVE) {
      return 'auto_approve';
    } else if (confidence >= this.thresholds.REVIEW) {
      return 'review';
    } else if (confidence < this.thresholds.ESCALATE) {
      return 'escalate';
    }
    return 'review';
  }

  private generateExplanation(
    confidence: number, 
    action: string, 
    factors: ConfidenceFactors
  ): string {
    const percentage = (confidence * 100).toFixed(1);
    
    if (action === 'auto_approve') {
      return `High confidence (${percentage}%) - Auto-approved. Strong agent matching and task simplicity.`;
    } else if (action === 'escalate') {
      return `Low confidence (${percentage}%) - Escalated for human review. Factors: complexity=${factors.complexityFactor.toFixed(2)}, domain=${factors.domainFactor.toFixed(2)}`;
    } else {
      return `Moderate confidence (${percentage}%) - Queued for review. Consider task complexity and agent capabilities.`;
    }
  }

  /**
   * Update thresholds (admin configurable)
   */
  public updateThresholds(updates: Partial<typeof CONFIDENCE_THRESHOLDS>): void {
    if (updates.AUTO_APPROVE !== undefined) {
      this.thresholds.AUTO_APPROVE = updates.AUTO_APPROVE;
    }
    if (updates.REVIEW !== undefined) {
      this.thresholds.REVIEW = updates.REVIEW;
    }
    if (updates.ESCALATE !== undefined) {
      this.thresholds.ESCALATE = updates.ESCALATE;
    }

    this.emit('thresholds_updated', this.thresholds);
  }

  /**
   * Get current thresholds
   */
  public getThresholds(): { AUTO_APPROVE: number; REVIEW: number; ESCALATE: number } {
    return { ...this.thresholds };
  }
}

export const confidenceScorer = ConfidenceScorer.getInstance();
