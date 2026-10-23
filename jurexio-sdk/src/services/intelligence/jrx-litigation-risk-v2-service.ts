import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-litigation-risk-v2-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
type LegalDomain = 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip' | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';
type LitigationRecommendation = 'settle' | 'proceed' | 'appeal' | 'arbitrate';

interface CaseDetails {
  caseDescription: string;
  jurisdiction: JurisdictionCode;
  domain: LegalDomain;
  claimAmount?: number;
  judgeId?: string;
  opposingCounselId?: string;
  forum?: 'court' | 'arbitration' | 'tribunal';
  precedents?: string[];
}

interface RiskAssessmentV2 {
  overallRiskScore: number;
  dimensionScores: Record<string, number>;
  confidenceInterval: [number, number];
  settlementProbability: number;
  expectedTimeline: { best: number; expected: number; worst: number };
  recommendation: LitigationRecommendation;
  analysis: string;
  traceId: string;
  assessedAt: Date;
}

interface SettlementCurve {
  dataPoints: { probability: number; amount: number }[];
  optimalSettlementRange: { min: number; max: number };
  expectedTrialCost: number;
}

interface LitigationROI {
  expectedRecovery: number;
  estimatedCost: number;
  roi: number;
  breakEvenProbability: number;
  recommendation: string;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  'legal-merit': 0.20,
  'evidence-strength': 0.15,
  'jurisdiction-risk': 0.10,
  'judge-risk': 0.10,
  'opposing-counsel': 0.08,
  'forum-risk': 0.07,
  'precedent-alignment': 0.10,
  'settlement-probability': 0.07,
  'timeline-risk': 0.05,
  'cost-to-outcome': 0.04,
  'public-exposure': 0.02,
  'enforcement-risk': 0.02,
};

class NvLitigationRiskV2Service {
  async assessRisk(caseDetails: CaseDetails): Promise<RiskAssessmentV2> {
    const traceId = `lrv2-${crypto.randomBytes(8).toString('hex')}`;
    logger.info({ method: 'assessRisk', jurisdiction: caseDetails.jurisdiction, domain: caseDetails.domain, traceId });

    const dimensionScores: Record<string, number> = {};
    dimensionScores['legal-merit'] = this.scoreLegalMerit(caseDetails);
    dimensionScores['evidence-strength'] = this.scoreEvidenceStrength(caseDetails);
    dimensionScores['jurisdiction-risk'] = this.scoreJurisdictionRisk(caseDetails.jurisdiction);
    dimensionScores['judge-risk'] = caseDetails.judgeId ? await this.calculateJudgeRisk(caseDetails.judgeId, caseDetails.domain) : 50;
    dimensionScores['opposing-counsel'] = caseDetails.opposingCounselId ? await this.calculateCounselStrength(caseDetails.opposingCounselId) : 50;
    dimensionScores['forum-risk'] = this.scoreForumRisk(caseDetails.forum || 'court', caseDetails.jurisdiction);
    dimensionScores['precedent-alignment'] = this.scorePrecedentAlignment(caseDetails);
    dimensionScores['settlement-probability'] = this.scoreSettlementProbability(caseDetails);
    dimensionScores['timeline-risk'] = this.scoreTimelineRisk(caseDetails.jurisdiction);
    dimensionScores['cost-to-outcome'] = this.scoreCostToOutcome(caseDetails);
    dimensionScores['public-exposure'] = this.scorePublicExposure(caseDetails);
    dimensionScores['enforcement-risk'] = this.scoreEnforcementRisk(caseDetails.jurisdiction);

    let overallRiskScore = 0;
    for (const [dim, weight] of Object.entries(DEFAULT_WEIGHTS)) {
      overallRiskScore += (dimensionScores[dim] || 50) * weight;
    }
    overallRiskScore = Math.round(overallRiskScore);

    const variance = 8;
    const confidenceInterval: [number, number] = [
      Math.max(0, overallRiskScore - variance),
      Math.min(100, overallRiskScore + variance),
    ];

    const settlementProbability = Math.round(dimensionScores['settlement-probability']) / 100;

    let recommendation: LitigationRecommendation;
    if (overallRiskScore >= 70) recommendation = 'settle';
    else if (overallRiskScore >= 50) recommendation = caseDetails.forum === 'arbitration' ? 'arbitrate' : 'proceed';
    else if (overallRiskScore >= 30) recommendation = 'proceed';
    else recommendation = 'proceed';

    const analysis = this.generateAnalysis(dimensionScores, overallRiskScore, recommendation, caseDetails);

    return {
      overallRiskScore,
      dimensionScores,
      confidenceInterval,
      settlementProbability,
      expectedTimeline: this.estimateTimeline(caseDetails.jurisdiction, caseDetails.domain),
      recommendation,
      analysis,
      traceId,
      assessedAt: new Date(),
    };
  }

  async calculateJudgeRisk(judgeId: string, domain: LegalDomain): Promise<number> {
    logger.info({ method: 'calculateJudgeRisk', judgeId, domain });
    return 50;
  }

  async calculateCounselStrength(counselId: string): Promise<number> {
    logger.info({ method: 'calculateCounselStrength', counselId });
    return 50;
  }

  async generateSettlementCurve(caseDetails: CaseDetails): Promise<SettlementCurve> {
    const claimAmount = caseDetails.claimAmount || 1000000;
    return {
      dataPoints: [
        { probability: 0.9, amount: claimAmount * 0.3 },
        { probability: 0.7, amount: claimAmount * 0.5 },
        { probability: 0.5, amount: claimAmount * 0.65 },
        { probability: 0.3, amount: claimAmount * 0.8 },
        { probability: 0.1, amount: claimAmount * 0.95 },
      ],
      optimalSettlementRange: { min: claimAmount * 0.4, max: claimAmount * 0.6 },
      expectedTrialCost: claimAmount * 0.15,
    };
  }

  async calculateLitigationROI(caseDetails: CaseDetails, claimAmount: number): Promise<LitigationROI> {
    const estimatedCost = claimAmount * 0.15;
    const winProbability = (100 - this.scoreLegalMerit(caseDetails)) / 100;
    const expectedRecovery = claimAmount * winProbability;
    const roi = (expectedRecovery - estimatedCost) / estimatedCost;

    return {
      expectedRecovery: Math.round(expectedRecovery),
      estimatedCost: Math.round(estimatedCost),
      roi: Math.round(roi * 100) / 100,
      breakEvenProbability: Math.round((estimatedCost / claimAmount) * 100) / 100,
      recommendation: roi > 0.5 ? 'Proceed — positive expected ROI' : roi > 0 ? 'Marginal — consider settlement' : 'Settle — negative expected ROI',
    };
  }

  private scoreLegalMerit(details: CaseDetails): number {
    const desc = details.caseDescription.toLowerCase();
    let score = 50;
    if (desc.includes('clear evidence') || desc.includes('strong case')) score -= 15;
    if (desc.includes('weak') || desc.includes('uncertain')) score += 15;
    if (desc.includes('precedent') || desc.includes('settled law')) score -= 10;
    return Math.max(0, Math.min(100, score));
  }

  private scoreEvidenceStrength(details: CaseDetails): number {
    return 50;
  }

  private scoreJurisdictionRisk(jurisdiction: JurisdictionCode): number {
    const risks: Record<JurisdictionCode, number> = {
      'IN': 55, 'UK': 40, 'EU': 45, 'US': 50, 'GCC': 60, 'SG': 35,
    };
    return risks[jurisdiction] || 50;
  }

  private scoreForumRisk(forum: string, jurisdiction: JurisdictionCode): number {
    if (forum === 'arbitration') return 35;
    if (forum === 'tribunal') return 45;
    return 55;
  }

  private scorePrecedentAlignment(details: CaseDetails): number {
    return details.precedents && details.precedents.length > 0 ? 35 : 55;
  }

  private scoreSettlementProbability(details: CaseDetails): number {
    if (details.domain === 'corporate' || details.domain === 'civil') return 65;
    if (details.domain === 'criminal') return 20;
    return 50;
  }

  private scoreTimelineRisk(jurisdiction: JurisdictionCode): number {
    const risks: Record<JurisdictionCode, number> = {
      'IN': 70, 'UK': 45, 'EU': 50, 'US': 55, 'GCC': 50, 'SG': 35,
    };
    return risks[jurisdiction] || 50;
  }

  private scoreCostToOutcome(details: CaseDetails): number {
    return 50;
  }

  private scorePublicExposure(details: CaseDetails): number {
    const desc = details.caseDescription.toLowerCase();
    if (desc.includes('public') || desc.includes('media') || desc.includes('government')) return 75;
    return 30;
  }

  private scoreEnforcementRisk(jurisdiction: JurisdictionCode): number {
    const risks: Record<JurisdictionCode, number> = {
      'IN': 55, 'UK': 30, 'EU': 35, 'US': 30, 'GCC': 45, 'SG': 25,
    };
    return risks[jurisdiction] || 40;
  }

  private estimateTimeline(jurisdiction: JurisdictionCode, domain: LegalDomain): { best: number; expected: number; worst: number } {
    const baseTimelines: Record<JurisdictionCode, { best: number; expected: number; worst: number }> = {
      'IN': { best: 12, expected: 36, worst: 84 },
      'UK': { best: 6, expected: 18, worst: 36 },
      'EU': { best: 8, expected: 24, worst: 48 },
      'US': { best: 6, expected: 24, worst: 60 },
      'GCC': { best: 6, expected: 18, worst: 36 },
      'SG': { best: 4, expected: 12, worst: 24 },
    };
    return baseTimelines[jurisdiction] || { best: 6, expected: 24, worst: 60 };
  }

  private generateAnalysis(
    scores: Record<string, number>,
    overall: number,
    recommendation: LitigationRecommendation,
    details: CaseDetails
  ): string {
    const highRiskDimensions = Object.entries(scores)
      .filter(([, score]) => score >= 65)
      .map(([dim]) => dim);

    const lowRiskDimensions = Object.entries(scores)
      .filter(([, score]) => score <= 35)
      .map(([dim]) => dim);

    let analysis = `12-Dimension Litigation Risk Assessment for ${details.jurisdiction} ${details.domain} matter.\n\n`;
    analysis += `Overall Risk Score: ${overall}/100 — Recommendation: ${recommendation.toUpperCase()}.\n\n`;

    if (highRiskDimensions.length > 0) {
      analysis += `High-risk dimensions: ${highRiskDimensions.join(', ')}.\n`;
    }
    if (lowRiskDimensions.length > 0) {
      analysis += `Favorable dimensions: ${lowRiskDimensions.join(', ')}.\n`;
    }

    return analysis;
  }
}

export const nvLitigationRiskV2Service = new NvLitigationRiskV2Service();
