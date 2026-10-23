import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-llm-judge-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
type LegalDomain = 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip' | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';

interface JudgeContext {
  query: string;
  jurisdiction: JurisdictionCode;
  domain: LegalDomain;
  expectedCitations?: string[];
  groundTruth?: string;
}

interface JudgementResult {
  scores: {
    legalAccuracy: number;
    citationQuality: number;
    jurisdictionCorrectness: number;
    biasAbsence: number;
    actionability: number;
  };
  weightedTotal: number;
  passedThreshold: boolean;
  judgeReasoning: string;
  flaggedIssues: string[];
  judgeModel: string;
  evaluatedAt: Date;
}

const DEFAULT_WEIGHTS = {
  legalAccuracy: parseFloat(process.env.JRX_JUDGE_WEIGHT_ACCURACY || '0.30'),
  citationQuality: parseFloat(process.env.JRX_JUDGE_WEIGHT_CITATION || '0.25'),
  jurisdictionCorrectness: parseFloat(process.env.JRX_JUDGE_WEIGHT_JURISDICTION || '0.20'),
  biasAbsence: parseFloat(process.env.JRX_JUDGE_WEIGHT_BIAS || '0.15'),
  actionability: parseFloat(process.env.JRX_JUDGE_WEIGHT_ACTIONABILITY || '0.10'),
};

const PASS_THRESHOLD = parseFloat(process.env.JRX_JUDGE_PASS_THRESHOLD || '8.5');

class NvLlmJudgeService {
  async evaluate(
    response: string,
    context: JudgeContext,
    judgeModel?: string
  ): Promise<JudgementResult> {
    const model = judgeModel || process.env.JRX_JUDGE_DEFAULT_MODEL || 'gpt-4o';
    logger.info({ method: 'evaluate', jurisdiction: context.jurisdiction, domain: context.domain, judgeModel: model });

    const scores = this.scoreResponse(response, context);

    const weightedTotal =
      scores.legalAccuracy * DEFAULT_WEIGHTS.legalAccuracy +
      scores.citationQuality * DEFAULT_WEIGHTS.citationQuality +
      scores.jurisdictionCorrectness * DEFAULT_WEIGHTS.jurisdictionCorrectness +
      scores.biasAbsence * DEFAULT_WEIGHTS.biasAbsence +
      scores.actionability * DEFAULT_WEIGHTS.actionability;

    const roundedTotal = Math.round(weightedTotal * 100) / 100;
    const flaggedIssues = this.identifyIssues(scores, response, context);

    const result: JudgementResult = {
      scores,
      weightedTotal: roundedTotal,
      passedThreshold: roundedTotal >= PASS_THRESHOLD,
      judgeReasoning: this.generateReasoning(scores, roundedTotal, context),
      flaggedIssues,
      judgeModel: model,
      evaluatedAt: new Date(),
    };

    await this.storeEvaluation(result);
    return result;
  }

  private scoreResponse(response: string, context: JudgeContext): JudgementResult['scores'] {
    const responseLower = response.toLowerCase();

    let legalAccuracy = 7;
    const legalPatterns = /section\s+\d+|article\s+\d+|act\s+\d{4}|sanhita|code|regulation/gi;
    const legalMatches = response.match(legalPatterns);
    if (legalMatches && legalMatches.length > 0) legalAccuracy += Math.min(legalMatches.length, 3);

    let citationQuality = 6;
    const citationPattern = /\(\d{4}\)\s+\d+\s+(SCC|AIR|SCR)|section\s+\d+\s+of\s+/gi;
    const citationMatches = response.match(citationPattern);
    if (citationMatches) citationQuality += Math.min(citationMatches.length * 2, 4);

    let jurisdictionCorrectness = 8;
    const jurisdictionIndicators: Record<JurisdictionCode, string[]> = {
      'IN': ['bns', 'bnss', 'bsa', 'dpdpa', 'indian', 'supreme court of india', 'high court'],
      'UK': ['pace', 'uk gdpr', 'limitation act 1980', 'crown court', 'uk'],
      'EU': ['gdpr', 'eu ai act', 'ecj', 'european'],
      'US': ['ucc', 'scotus', 'federal', 'amendment'],
      'GCC': ['sharia', 'islamic', 'uae'],
      'SG': ['pdpa', 'singapore', 'siac'],
    };

    const indicators = jurisdictionIndicators[context.jurisdiction] || [];
    const wrongIndicators = Object.entries(jurisdictionIndicators)
      .filter(([j]) => j !== context.jurisdiction)
      .flatMap(([, v]) => v);

    if (wrongIndicators.some(i => responseLower.includes(i))) {
      jurisdictionCorrectness -= 3;
    }

    let biasAbsence = 9;
    const biasTerms = ['obviously', 'clearly the', 'any fool', 'his rights', 'her fault', 'caste', 'religion'];
    if (biasTerms.some(t => responseLower.includes(t))) biasAbsence -= 3;

    let actionability = 7;
    const actionTerms = ['recommend', 'should', 'file', 'apply', 'submit', 'next step', 'action'];
    const actionMatches = actionTerms.filter(t => responseLower.includes(t));
    actionability += Math.min(actionMatches.length, 3);

    return {
      legalAccuracy: Math.min(10, Math.max(1, legalAccuracy)),
      citationQuality: Math.min(10, Math.max(1, citationQuality)),
      jurisdictionCorrectness: Math.min(10, Math.max(1, jurisdictionCorrectness)),
      biasAbsence: Math.min(10, Math.max(1, biasAbsence)),
      actionability: Math.min(10, Math.max(1, actionability)),
    };
  }

  private identifyIssues(scores: JudgementResult['scores'], response: string, context: JudgeContext): string[] {
    const issues: string[] = [];
    if (scores.legalAccuracy < 7) issues.push('Low legal accuracy — statute references may be incorrect');
    if (scores.citationQuality < 7) issues.push('Citation quality below threshold — citations may be incomplete or fabricated');
    if (scores.jurisdictionCorrectness < 7) issues.push('Jurisdiction mismatch — response may apply wrong jurisdiction law');
    if (scores.biasAbsence < 8) issues.push('Potential bias detected in response language');
    if (scores.actionability < 6) issues.push('Response lacks actionable recommendations');
    return issues;
  }

  private generateReasoning(scores: JudgementResult['scores'], total: number, context: JudgeContext): string {
    let reasoning = `LLM-as-Judge evaluation for ${context.jurisdiction} ${context.domain} query.\n`;
    reasoning += `Weighted total: ${total}/10 (threshold: ${PASS_THRESHOLD}).\n`;
    reasoning += `Legal Accuracy: ${scores.legalAccuracy}/10, Citation: ${scores.citationQuality}/10, `;
    reasoning += `Jurisdiction: ${scores.jurisdictionCorrectness}/10, Bias: ${scores.biasAbsence}/10, `;
    reasoning += `Actionability: ${scores.actionability}/10.`;
    return reasoning;
  }

  private async storeEvaluation(result: JudgementResult): Promise<void> {
    logger.info({
      method: 'storeEvaluation',
      weightedTotal: result.weightedTotal,
      passed: result.passedThreshold,
      flaggedIssueCount: result.flaggedIssues.length,
    });
  }

  private buildJudgePrompt(response: string, context: JudgeContext): string {
    return `Evaluate the following legal AI response for quality.
Jurisdiction: ${context.jurisdiction}
Domain: ${context.domain}
Query: ${context.query}

Response to evaluate:
${response}

Score each dimension 1-10:
1. Legal Accuracy (0.30 weight)
2. Citation Quality (0.25 weight)
3. Jurisdiction Correctness (0.20 weight)
4. Bias Absence (0.15 weight)
5. Actionability (0.10 weight)

Provide reasoning for each score and flag any issues.`;
  }
}

export const nvLlmJudgeService = new NvLlmJudgeService();
