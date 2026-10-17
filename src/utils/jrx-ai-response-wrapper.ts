/**
 * NYV AI Response Wrapper — wraps every AI response with mandatory metadata block
 * Implements §3.3.4 — AI Output Metadata Block (mandatory on ALL 22-pattern outputs)
 * Implements §3.3.1 — Jurisdiction Binding (prohibited phrase scan per jurisdiction)
 * Implements §3.3.2 — Template Mode Enforcement (STRICT/GUIDED/MENTOR)
 * @file src/utils/jrx-ai-response-wrapper.ts
 */

import crypto from 'crypto';
import { NyvAiRiskEngine } from '../services/jrx-ai-risk-engine.js';

export type TemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';

// ─────────────────────────────────────────
// Template Mode enforcement patterns (§3.3.2)
// ─────────────────────────────────────────

const STRICT_MODE_VIOLATION_PATTERNS: RegExp[] = [
  /\bI (?:suggest|recommend|propose) restructur/i,
  /\balternatively,? (?:you could|consider) restructur/i,
  /\bmodify(?:ing)? the (?:structure|format|layout|headings)/i,
  /\breorder(?:ing)? (?:the )?(?:clauses|sections|headings)/i,
  /\breplace (?:the )?(?:existing )?(?:clause|section|heading)/i,
];

const GUIDED_MODE_ADVISORY_PATTERNS: RegExp[] = [
  /\bcompletely rewrite/i,
  /\bdiscard (?:the )?(?:entire |whole )?template/i,
  /\bstart (?:from scratch|fresh)/i,
];

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export interface JurisdictionScanResult {
  prohibited_phrases_found: string[];
  phrase_count: number;
  jurisdiction_clean: boolean;
}

export interface TemplateModeResult {
  mode: TemplateMode;
  violations: string[];
  compliant: boolean;
}

export interface WrappedAiResponse {
  content: string;
  metadata: {
    generated_by: string;
    jurisdiction: string;
    case_type: string;
    clause_source: string;
    confidence_score: number;
    risk_score: number;
    risk_badge: 'GREEN' | 'YELLOW' | 'RED';
    risk_blocked: boolean;
    template_mode: TemplateMode;
    timestamp: string;
    prompt_hash: string;
    warnings: string[];
    tokens: { input?: number; output?: number };
  };
  governance: {
    jurisdiction_validated: boolean;
    jurisdiction_scan: JurisdictionScanResult;
    template_locked: boolean;
    template_mode_result: TemplateModeResult;
    compliance_checked: boolean;
    has_external_inference: boolean;
  };
}

// ─────────────────────────────────────────
// Jurisdiction prohibited phrase scan (§3.3.1)
// ─────────────────────────────────────────

function scanForProhibitedPhrases(
  content: string,
  prohibitedPhrases: string[],
): JurisdictionScanResult {
  const found: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const phrase of prohibitedPhrases) {
    if (lowerContent.includes(phrase.toLowerCase())) {
      found.push(phrase);
    }
  }

  return {
    prohibited_phrases_found: found,
    phrase_count: found.length,
    jurisdiction_clean: found.length === 0,
  };
}

// ─────────────────────────────────────────
// Template Mode enforcement (§3.3.2)
// ─────────────────────────────────────────

function enforceTemplateMode(content: string, mode: TemplateMode): TemplateModeResult {
  const violations: string[] = [];

  if (mode === 'STRICT') {
    for (const pattern of STRICT_MODE_VIOLATION_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        violations.push(`STRICT violation: "${match[0]}" — structural changes are not permitted in STRICT mode`);
      }
    }
  }

  if (mode === 'GUIDED') {
    for (const pattern of GUIDED_MODE_ADVISORY_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        violations.push(`GUIDED advisory: "${match[0]}" — complete rewrites are not permitted in GUIDED mode`);
      }
    }
  }

  return {
    mode,
    violations,
    compliant: violations.length === 0,
  };
}

// ─────────────────────────────────────────
// Main wrapper (§3.3.4)
// ─────────────────────────────────────────

export function wrapAiResponse(params: {
  content: string;
  modelVersion: string;
  jurisdiction: string;
  caseType: string;
  templateMode: TemplateMode;
  systemPrompt: string;
  userPrompt: string;
  confidenceScore?: number;
  clauseBankIds?: string[];
  tokensInput?: number;
  tokensOutput?: number;
  prohibitedPhrases?: string[];
}): WrappedAiResponse {
  const promptHash = crypto
    .createHash('sha256')
    .update(params.systemPrompt + params.userPrompt)
    .digest('hex');

  const riskAssessment = NyvAiRiskEngine.compute(
    params.content,
    params.jurisdiction,
    '',
    params.clauseBankIds || [],
    true
  );

  const jurisdictionScan = scanForProhibitedPhrases(
    params.content,
    params.prohibitedPhrases || [],
  );

  const templateModeResult = enforceTemplateMode(params.content, params.templateMode);

  const allWarnings = [...riskAssessment.warnings];

  for (const phrase of jurisdictionScan.prohibited_phrases_found) {
    allWarnings.push(
      `[JurisdictionBinding] Prohibited phrase detected for ${params.jurisdiction}: "${phrase}" — use current legislation`
    );
  }

  for (const v of templateModeResult.violations) {
    allWarnings.push(`[TemplateMode:${params.templateMode}] ${v}`);
  }

  let adjustedScore = riskAssessment.score;
  adjustedScore += jurisdictionScan.phrase_count * 8;
  adjustedScore += templateModeResult.violations.length * 5;
  adjustedScore = Math.min(adjustedScore, 100);

  const adjustedBadge: 'GREEN' | 'YELLOW' | 'RED' =
    adjustedScore >= 70 ? 'RED' : adjustedScore >= 40 ? 'YELLOW' : 'GREEN';
  const adjustedBlocked = adjustedScore >= 70;

  return {
    content: params.content,
    metadata: {
      generated_by:     params.modelVersion,
      jurisdiction:     params.jurisdiction,
      case_type:        params.caseType,
      clause_source:    'NYV-CLAUSE-BANK-v3.1.2',
      confidence_score: params.confidenceScore ?? 0,
      risk_score:       adjustedScore,
      risk_badge:       adjustedBadge,
      risk_blocked:     adjustedBlocked,
      template_mode:    params.templateMode,
      timestamp:        new Date().toISOString(),
      prompt_hash:      promptHash,
      warnings:         allWarnings,
      tokens: {
        input:  params.tokensInput,
        output: params.tokensOutput,
      },
    },
    governance: {
      jurisdiction_validated: riskAssessment.components.jurisdictionMismatch < 0.2 && jurisdictionScan.jurisdiction_clean,
      jurisdiction_scan: jurisdictionScan,
      template_locked:        params.templateMode === 'STRICT',
      template_mode_result:   templateModeResult,
      compliance_checked:     true,
      has_external_inference: riskAssessment.components.hallucinationProbability > 0.3,
    },
  };
}

export function buildBlockedResponse(params: {
  riskScore: number;
  badge: 'GREEN' | 'YELLOW' | 'RED';
  warnings: string[];
  modelVersion: string;
  jurisdiction: string;
  caseType: string;
  promptHash: string;
  templateMode: TemplateMode;
}): Record<string, unknown> {
  return {
    error: 'HIGH_RISK_OUTPUT_BLOCKED',
    message: 'AI output risk score exceeds threshold. Lawyer confirmation required.',
    risk_score: params.riskScore,
    risk_badge: params.badge,
    warnings: params.warnings,
    requires_action: 'CONFIRM_WITH_REASON',
    metadata: {
      generated_by: params.modelVersion,
      jurisdiction: params.jurisdiction,
      case_type: params.caseType,
      risk_score: params.riskScore,
      risk_badge: params.badge,
      template_mode: params.templateMode,
      timestamp: new Date().toISOString(),
      prompt_hash: params.promptHash,
    },
  };
}
