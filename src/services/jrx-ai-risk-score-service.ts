/**
 * Jurexio Enterprise Platform 3.1.2 — AI Risk Score Engine
 * NYV-SVC-RISK-001
 *
 * Mandatory per Handover §3.3.3 — every AI output must carry a risk score (0–100).
 * Outputs with score > 60 are BLOCKED until explicit lawyer confirmation.
 *
 * Formula:
 *   risk_score = (0.25 × jurisdiction_mismatch)
 *              + (0.20 × clause_absence)
 *              + (0.15 × structural_deviation)
 *              + (0.20 × hallucination_probability)
 *              + (0.20 × unsupported_references)
 *
 * Each component: 0–100. Final score: weighted sum (0–100).
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-ai-risk-score');

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface RiskComponents {
  jurisdiction_mismatch: number;    // 0–100: AI output uses wrong jurisdiction's currency/courts/statutes
  clause_absence: number;           // 0–100: AI output missing mandatory clauses for the case type
  structural_deviation: number;     // 0–100: AI restructured the template (STRICT mode violation)
  hallucination_probability: number;// 0–100: AI made claims without citation grounding
  unsupported_references: number;   // 0–100: AI referenced non-existent case law or statute sections
}

export interface RiskScoreResult {
  risk_score: number;               // Final weighted score 0–100
  components: RiskComponents;
  blocked: boolean;                 // true when risk_score > 60
  block_reason: string | null;      // human-readable reason when blocked
  confidence: number;               // 0–1 confidence of the AI output (inverse of risk)
  prompt_hash: string;              // SHA-256 of the prompt
  computed_at: string;              // ISO timestamp
}

export interface RiskScoringContext {
  jurisdiction: string;             // e.g. 'IN', 'UK', 'US'
  caseType?: string;
  templateMode: 'STRICT' | 'GUIDED' | 'MENTOR';
  prompt: string;
  output: string;
  expectedCurrency?: string;        // e.g. 'INR', 'GBP', 'USD'
  expectedCourtLevel?: string;
  clauseBankVersion?: string;
  mandatoryClauses?: string[];
}

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const BLOCK_THRESHOLD = 60;

/** Currency patterns per jurisdiction */
const JURISDICTION_CURRENCIES: Record<string, string[]> = {
  IN:  ['INR', '₹', 'Rs.', 'rupee', 'lakh', 'crore'],
  UK:  ['GBP', '£', 'pound', 'sterling'],
  US:  ['USD', '$', 'dollar', 'cent'],
  EU:  ['EUR', '€', 'euro'],
  GCC: ['AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'dirham', 'riyal'],
  SG:  ['SGD', 'S$', 'Singapore dollar'],
};

/** Court name patterns per jurisdiction */
const JURISDICTION_COURTS: Record<string, string[]> = {
  IN:  ['Supreme Court of India', 'High Court', 'District Court', 'Sessions Court', 'Magistrate', 'NCLT', 'NCLAT', 'RERA'],
  UK:  ['Supreme Court', 'Court of Appeal', 'High Court of Justice', 'Crown Court', 'County Court', 'Magistrates Court'],
  US:  ['Supreme Court', 'Circuit Court', 'District Court', 'Court of Appeals', 'Federal Court', 'State Court'],
  EU:  ['European Court of Justice', 'General Court', 'National Court'],
  GCC: ['Federal Supreme Court', 'Federal Court', 'DIFC Court', 'ADGM Court'],
  SG:  ['Court of Appeal', 'High Court', 'State Courts', 'SICC'],
};

/** Wrong jurisdiction signals (other jurisdiction currencies appearing in wrong context) */
const CROSS_JURISDICTION_PATTERNS = [
  { pattern: /\b(USD|\$\s*\d|dollar)\b/i, badFor: ['IN', 'UK', 'EU', 'GCC', 'SG'], weight: 30 },
  { pattern: /\b(GBP|£\s*\d|pound sterling)\b/i, badFor: ['IN', 'US', 'EU', 'GCC', 'SG'], weight: 25 },
  { pattern: /\bDistrict Court,?\s*(New York|California|Texas|Illinois)/i, badFor: ['IN', 'UK', 'EU', 'GCC', 'SG'], weight: 40 },
  { pattern: /\b(IPC|CrPC|Indian Penal Code|Code of Criminal Procedure)\b/i, badFor: ['UK', 'US', 'EU', 'GCC', 'SG'], weight: 20 },
];

/** Hallucination indicators in legal text */
const HALLUCINATION_PATTERNS = [
  /\bsection \d+ of the [A-Z][a-z]+ Act, (\d{4})\b/g,  // verify section numbers exist
  /\b(unreported|unpublished) judgment\b/gi,
  /\bAIR \d{4} [A-Z]+ \d+\b/g,   // Indian case citations — should exist
  /\b\d+ SCC \d+\b/g,              // Supreme Court cases
];

/** Citation absence patterns */
const CITATION_ABSENCE_PATTERNS = [
  /\b(it is settled law|it is well established|courts have held)\b/gi,
  /\b(as per the law|under the law|the law provides)\b/gi,
];

// ─────────────────────────────────────────
// Core Risk Score Engine
// ─────────────────────────────────────────

export class AIRiskScoreEngine {
  /**
   * Compute risk score for an AI output.
   * Returns complete RiskScoreResult including block status.
   */
  computeScore(context: RiskScoringContext): RiskScoreResult {
    const components: RiskComponents = {
      jurisdiction_mismatch:     this._scoreJurisdictionMismatch(context),
      clause_absence:            this._scoreClauseAbsence(context),
      structural_deviation:      this._scoreStructuralDeviation(context),
      hallucination_probability: this._scoreHallucinationProbability(context),
      unsupported_references:    this._scoreUnsupportedReferences(context),
    };

    // Weighted formula per handover §3.3.3
    const risk_score = Math.min(100, Math.round(
      (components.jurisdiction_mismatch    * 0.25) +
      (components.clause_absence           * 0.20) +
      (components.structural_deviation     * 0.15) +
      (components.hallucination_probability * 0.20) +
      (components.unsupported_references   * 0.20)
    ));

    const blocked = risk_score > BLOCK_THRESHOLD;
    const block_reason = blocked ? this._buildBlockReason(components, risk_score) : null;
    const confidence = Math.max(0, Math.round((1 - risk_score / 100) * 100) / 100);
    const prompt_hash = crypto.createHash('sha256').update(context.prompt).digest('hex');

    logger.info('Risk score computed', {
      jurisdiction: context.jurisdiction,
      risk_score,
      blocked,
      components,
    });

    return {
      risk_score,
      components,
      blocked,
      block_reason,
      confidence,
      prompt_hash,
      computed_at: new Date().toISOString(),
    };
  }

  /** Returns true if this output should be blocked */
  isBlocked(score: number): boolean {
    return score > BLOCK_THRESHOLD;
  }

  // ─────────────────────────────────────────
  // Component Scorers
  // ─────────────────────────────────────────

  private _scoreJurisdictionMismatch(ctx: RiskScoringContext): number {
    const { jurisdiction, output } = ctx;
    let score = 0;

    // Check for cross-jurisdiction currency / court references
    for (const check of CROSS_JURISDICTION_PATTERNS) {
      if (check.badFor.includes(jurisdiction) && check.pattern.test(output)) {
        score += check.weight;
      }
    }

    // Check expected currency presence (if specified)
    if (ctx.expectedCurrency) {
      const currencies = JURISDICTION_CURRENCIES[jurisdiction] || [];
      const hasCorrectCurrency = currencies.some(c => output.includes(c));
      if (!hasCorrectCurrency && output.length > 200) {
        score += 15; // Long output with no correct currency is suspicious
      }
    }

    // Check for wrong court references
    const wrongCourts = Object.entries(JURISDICTION_COURTS)
      .filter(([code]) => code !== jurisdiction)
      .flatMap(([, courts]) => courts);
    const correctCourts = JURISDICTION_COURTS[jurisdiction] || [];
    for (const court of wrongCourts) {
      if (output.includes(court) && !correctCourts.includes(court)) {
        score += 20;
        break;
      }
    }

    return Math.min(100, score);
  }

  private _scoreClauseAbsence(ctx: RiskScoringContext): number {
    const { mandatoryClauses, output } = ctx;
    if (!mandatoryClauses || mandatoryClauses.length === 0) return 5; // Low default
    const missing = mandatoryClauses.filter(clause =>
      !output.toLowerCase().includes(clause.toLowerCase())
    );
    return Math.min(100, Math.round((missing.length / mandatoryClauses.length) * 100));
  }

  private _scoreStructuralDeviation(ctx: RiskScoringContext): number {
    if (ctx.templateMode === 'STRICT') {
      // In STRICT mode, any structural restructuring is penalised
      const structureViolations = [
        /\[SUGGESTED CHANGE\]/gi,
        /I would restructure/gi,
        /alternatively, the structure could/gi,
        /you may want to reorganize/gi,
        /I have reorganized the/gi,
      ];
      const violations = structureViolations.filter(p => p.test(ctx.output)).length;
      return Math.min(100, violations * 40); // Each violation = 40 points
    }
    if (ctx.templateMode === 'GUIDED') {
      // GUIDED: structural suggestions are allowed but should be marked
      const unmarkedChanges = /I have moved|I have reorganized|I restructured/gi.test(ctx.output);
      return unmarkedChanges ? 30 : 0;
    }
    return 0; // MENTOR mode — no structural penalty
  }

  private _scoreHallucinationProbability(ctx: RiskScoringContext): number {
    const { output } = ctx;
    let score = 0;

    // Statements with no citation (legal claims without source)
    const uncitedClaims = CITATION_ABSENCE_PATTERNS.filter(p => p.test(output)).length;
    score += uncitedClaims * 15;

    // High confidence claims in short output (likely hallucination)
    if (output.length < 300 && /\b(definitely|certainly|absolutely|always)\b/gi.test(output)) {
      score += 20;
    }

    // References to "recent" or "current" without dates (temporal hallucination)
    if (/\b(recent judgment|current law|latest amendment)\b/gi.test(output) &&
        !/\d{4}/.test(output)) {
      score += 15;
    }

    return Math.min(100, score);
  }

  private _scoreUnsupportedReferences(ctx: RiskScoringContext): number {
    const { output } = ctx;
    let score = 0;

    // References to laws that don't exist
    const suspectLaws = [
      /the \w+ Act of \d{4}/gi,
      /under section \d+ of the [A-Z][a-z]+ Act/gi,
    ];

    // If there are many specific section references, risk of at least one being wrong goes up
    const sectionRefs = (output.match(/section \d+[A-Z]?/gi) || []).length;
    if (sectionRefs > 5) score += 20;
    if (sectionRefs > 10) score += 20;

    // Referencing repealed legislation as current law
    if (/\b(IPC|Indian Penal Code) (section|s\.) \d+\b/i.test(output) &&
        ctx.jurisdiction === 'IN' &&
        !/\b(old|pre-2024|erstwhile|formerly)\b/i.test(output)) {
      score += 35; // Citing IPC as current law in India (repealed July 2024)
    }

    if (/\b(CrPC|Code of Criminal Procedure) (section|s\.) \d+\b/i.test(output) &&
        ctx.jurisdiction === 'IN' &&
        !/\b(old|pre-2024|erstwhile|formerly)\b/i.test(output)) {
      score += 35; // Citing CrPC as current law in India (repealed July 2024)
    }

    return Math.min(100, score);
  }

  private _buildBlockReason(components: RiskComponents, score: number): string {
    const high = Object.entries(components)
      .filter(([, v]) => v > 40)
      .map(([k]) => k.replace(/_/g, ' '))
      .join(', ');
    return `Risk score ${score}/100 exceeds threshold (60). High-risk factors: ${high || 'combined weighted risk'}. Lawyer confirmation required before delivering this output.`;
  }
}

// Singleton instance
export const riskScoreEngine = new AIRiskScoreEngine();
