/**
 * NYV AI Risk Score Engine — mandatory on ALL AI outputs per §3.3.3
 * Formula: (0.25 × Jurisdiction mismatch) + (0.20 × Clause absence)
 *        + (0.15 × Structural deviation) + (0.20 × Hallucination probability)
 *        + (0.20 × Unsupported references)
 * Outputs with score > 60 are BLOCKED until explicit lawyer confirmation.
 * @file src/services/jrx-ai-risk-engine.ts
 */

import crypto from 'crypto';

export interface RiskComponents {
  jurisdictionMismatch: number;      // 0–1: detected wrong jurisdiction formatting
  clauseAbsence: number;             // 0–1: required clauses missing
  structuralDeviation: number;       // 0–1: output structure deviates from template
  hallucinationProbability: number;  // 0–1: claims without citation
  unsupportedReferences: number;     // 0–1: legal references not in clause bank
}

export interface RiskAssessment {
  score: number;                     // 0–100 weighted risk score
  badge: 'GREEN' | 'YELLOW' | 'RED';
  components: RiskComponents;
  blocked: boolean;                  // true if score > 60
  requiresConfirmation: boolean;
  warnings: string[];
}

export class NyvAiRiskEngine {
  private static readonly WEIGHTS = {
    jurisdictionMismatch:     0.25,
    clauseAbsence:            0.20,
    structuralDeviation:      0.15,
    hallucinationProbability: 0.20,
    unsupportedReferences:    0.20,
  } as const;

  private static readonly JURISDICTION_VIOLATIONS: Record<string, RegExp[]> = {
    IN: [
      /district court, [a-z]+ \d{5}/i,
      /\$[\d,]+/,
      /pre-trial discovery/i,
      /\bIPC\b/,
      /\bCrPC\b/,
      /Indian Penal Code/i,
      /Code of Criminal Procedure/i,
    ],
    UK: [/\bIPC\b/, /district court/i, /USD|INR/],
    US: [/\bBNS\b/, /\bBNSS\b/, /High Court/i],
    EU: [/\bIPC\b/, /\bBNS\b/, /INR/],
    GCC: [/\bIPC\b/, /\bBNS\b/, /INR/, /pre-trial discovery/i],
    SG: [/\bIPC\b/, /\bBNS\b/, /INR/],
  };

  private static readonly CITATION_PATTERN =
    /(?:Section \d+[A-Z]?|BNS \d+|BNSS \d+|BSA \d+|Article \d+|\[\d{4}\] \d+ SCC \d+|\d{4} AIR \d+|[A-Z]{2,5} Act \d{4})/i;

  static compute(
    output: string,
    jurisdiction: string,
    templateExpected: string,
    clauseBankIds: string[],
    isLegalContent: boolean = true,
  ): RiskAssessment {
    const components: RiskComponents = {
      jurisdictionMismatch:     this.detectJurisdictionMismatch(output, jurisdiction),
      clauseAbsence:            this.detectClauseAbsence(output, clauseBankIds),
      structuralDeviation:      this.detectStructuralDeviation(output, templateExpected),
      hallucinationProbability: isLegalContent ? this.detectHallucination(output) : 0,
      unsupportedReferences:    isLegalContent ? this.detectUnsupportedRefs(output, clauseBankIds) : 0,
    };

    const score = Math.round(
      (components.jurisdictionMismatch     * this.WEIGHTS.jurisdictionMismatch     +
       components.clauseAbsence            * this.WEIGHTS.clauseAbsence            +
       components.structuralDeviation      * this.WEIGHTS.structuralDeviation      +
       components.hallucinationProbability * this.WEIGHTS.hallucinationProbability +
       components.unsupportedReferences    * this.WEIGHTS.unsupportedReferences) * 100
    );

    const badge: 'GREEN' | 'YELLOW' | 'RED' = score <= 30 ? 'GREEN' : score <= 60 ? 'YELLOW' : 'RED';
    const warnings: string[] = [];

    if (components.jurisdictionMismatch > 0.3)
      warnings.push(`Jurisdiction formatting issue detected (${jurisdiction})`);
    if (components.hallucinationProbability > 0.5)
      warnings.push('High hallucination probability — verify all legal claims');
    if (components.clauseAbsence > 0.4)
      warnings.push('Required clauses may be missing — review against checklist');

    return {
      score,
      badge,
      components,
      blocked: score > 60,
      requiresConfirmation: score > 60,
      warnings,
    };
  }

  private static detectJurisdictionMismatch(output: string, jurisdiction: string): number {
    const violations = this.JURISDICTION_VIOLATIONS[jurisdiction.toUpperCase()] || [];
    const found = violations.filter(p => p.test(output));
    return Math.min(found.length / 3, 1);
  }

  private static detectClauseAbsence(output: string, clauseIds: string[]): number {
    if (clauseIds.length === 0) return 0;
    const present = clauseIds.filter(id => output.includes(id)).length;
    return 1 - (present / clauseIds.length);
  }

  private static detectStructuralDeviation(output: string, template: string): number {
    if (!template) return 0;
    const templateHeadings = (template.match(/^#{1,3}\s+.+$/gm) || []).length;
    const outputHeadings   = (output.match(/^#{1,3}\s+.+$/gm) || []).length;
    if (templateHeadings === 0) return 0;
    return Math.min(Math.abs(templateHeadings - outputHeadings) / templateHeadings, 1);
  }

  private static detectHallucination(output: string): number {
    const legalClaims = (output.match(/\b(held|ruled|decided|observed|stated)\b/gi) || []).length;
    const citations   = (output.match(this.CITATION_PATTERN) || []).length;
    if (legalClaims === 0) return 0;
    return Math.max(0, 1 - (citations / legalClaims));
  }

  private static detectUnsupportedRefs(output: string, clauseIds: string[]): number {
    const refs = output.match(/Section \d+[A-Z]?|BNS \d+|BNSS \d+/g) || [];
    if (refs.length === 0) return 0;
    const validated = refs.filter(r => clauseIds.some(id => id.includes(r))).length;
    return 1 - (validated / refs.length);
  }

  static formatMetadataBlock(params: {
    modelVersion: string;
    jurisdiction: string;
    caseType: string;
    clauseSource: string;
    confidenceScore: number;
    riskAssessment: RiskAssessment;
    promptHash: string;
    templateMode: 'STRICT' | 'GUIDED' | 'MENTOR';
  }): Record<string, unknown> {
    return {
      _nyv_metadata: {
        generated_by:    params.modelVersion,
        jurisdiction:    params.jurisdiction,
        case_type:       params.caseType,
        clause_source:   params.clauseSource,
        confidence_score: params.confidenceScore,
        risk_score:      params.riskAssessment.score,
        risk_badge:      params.riskAssessment.badge,
        risk_blocked:    params.riskAssessment.blocked,
        template_mode:   params.templateMode,
        timestamp:       new Date().toISOString(),
        prompt_hash:     params.promptHash,
        warnings:        params.riskAssessment.warnings,
      },
    };
  }

  static buildPromptHash(systemPrompt: string, userPrompt: string): string {
    return crypto.createHash('sha256').update(systemPrompt + userPrompt).digest('hex');
  }
}
