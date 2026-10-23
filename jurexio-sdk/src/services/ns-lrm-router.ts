// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio NS LRM + SLM Jurisdiction Router v3.1.2
 * JRX-SVC-LRM-ROUTER-001
 *
 * Two-Tier AI Architecture:
 *   Tier 1: NS LRM (Jurexio Legal Reasoning Model) — Master Orchestrator
 *   Tier 2: 6 Jurisdiction SLMs — Hyper-precise, cost-efficient legal intelligence
 *
 * Routing Logic:
 *   1. Detect jurisdiction from context, language, entity names, cited statutes
 *   2. Route to appropriate SLM if confidence >= 85%
 *   3. NS LRM synthesises for cross-jurisdictional queries (< 85% single jurisdiction)
 *   4. Global LLM Fallback Tier for edge cases (confidence < 70%)
 *
 * Cost Architecture:
 *   70% queries → SLM level (lowest cost)
 *   25% queries → NS LRM synthesis
 *   5%  queries → Global LLM Fallback (all PII redacted before external call)
 *
 * SECURITY: PII is ALWAYS redacted before any external LLM API call.
 *           Client data NEVER leaves Jurexio infrastructure unredacted.
 */

import { logger } from '../utils/logger.js';
// @ts-expect-error NV-TS230 legacy typing gap (TS2305)
import { NV_PLATFORM_CONFIG, SLM_BINDINGS } from '../config/platform-config.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type JurisdictionCode = 'IN' | 'UK' | 'GC' | 'EU' | 'US' | 'SG' | 'CROSS';
export type SLMBinding = typeof SLM_BINDINGS[keyof typeof SLM_BINDINGS];
export type RoutingTier = 'slm' | 'lrm-synthesis' | 'global-fallback';

export interface JurisdictionDetectionResult {
  primary: JurisdictionCode;
  secondary: JurisdictionCode[];
  confidence: number;           // 0–1
  detectionMethod: DetectionMethod[];
  isCrossJurisdictional: boolean;
  slmBinding: SLMBinding;
}

export type DetectionMethod =
  | 'explicit-user-selection'
  | 'cited-statute'
  | 'entity-name'
  | 'document-language'
  | 'legal-term-vocabulary'
  | 'court-name'
  | 'default-fallback';

export interface LRMRoutingDecision {
  tier: RoutingTier;
  jurisdiction: JurisdictionDetectionResult;
  slmBinding: SLMBinding;
  fallbackChain: SLMBinding[];
  costTier: 'low' | 'medium' | 'high';
  estimatedCostReduction: number;   // percentage vs all-LLM approach
  piiRedactionRequired: boolean;
  crossBorderSynthesis: boolean;
  routingReason: string;
}

export interface LRMQueryInput {
  query: string;
  userId?: string;
  explicitJurisdiction?: JurisdictionCode;
  documentLanguage?: string;
  citedStatutes?: string[];
  entityNames?: string[];
  platformId?: string;
  practiceArea?: string;
  sessionJurisdiction?: JurisdictionCode;
}

// ──────────────────────────────────────────────────────────────────────────────
// Jurisdiction Detection Patterns
// ──────────────────────────────────────────────────────────────────────────────

const JURISDICTION_PATTERNS: Record<JurisdictionCode, {
  statutes: RegExp[];
  courts: RegExp[];
  legalTerms: RegExp[];
  languages: string[];
  currencies: RegExp[];
}> = {
  IN: {
    statutes: [
      /\b(BNS|BNSS|BSA|IPC|CrPC|CPC|Companies Act|DPDPA|DPDP|GST|Income Tax Act|Hindu Marriage Act|Transfer of Property Act|Arbitration and Conciliation Act|Indian Evidence Act)\b/i,
      /\bSection\s+\d+\s+(of\s+)?(the\s+)?(BNS|IPC|CrPC|CPC)\b/i,
    ],
    courts: [/\b(Supreme Court of India|High Court|District Court|Sessions Court|Family Court|NCLAT|NCLT|ITAT|CCI)\b/i],
    legalTerms: [/\b(writ petition|SLP|PIL|vakalatnama|FIR|chargesheet|bail|Aadhaar|PAN|GST number|GSTIN)\b/i],
    languages: ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'bn', 'or'],
    currencies: [/\b(INR|₹|Rs\.?)\b/i],
  },
  UK: {
    statutes: [
      /\b(UK GDPR|Data Protection Act|Companies Act 2006|Employment Rights Act|Equality Act|Financial Services and Markets Act|Proceeds of Crime Act|Consumer Rights Act)\b/i,
      /\b(HMRC|Companies House|FCA|PRA|ICO)\b/i,
    ],
    courts: [/\b(Supreme Court of the United Kingdom|Court of Appeal|High Court of Justice|Crown Court|Magistrates' Court|Employment Tribunal|UKIPO)\b/i],
    legalTerms: [/\b(barrister|solicitor|Queen's Counsel|King's Counsel|QC|KC|HMRC|PAYE|VAT registration|Companies House number)\b/i],
    languages: ['cy', 'gd'],
    currencies: [/\b(GBP|£)\b/i],
  },
  GC: {
    statutes: [
      /\b(UAE Federal Law|UAE Civil Code|DIFC|ADGM|Saudi Commercial Law|Saudi Labor Law|GCC|PDPL|Vision 2030|Sharia|Islamic law)\b/i,
      /\b(CBUAE|SCA|ADGM Financial Services|DFSA)\b/i,
    ],
    courts: [/\b(DIFC Courts|ADGM Courts|UAE Federal Court|Dubai Courts|Abu Dhabi Courts|Saudi Commercial Court|GCC Arbitration)\b/i],
    legalTerms: [/\b(wasta|halal|haram|Sharia compliance|fidya|mahr|talaq|IBAN.*AE|IBAN.*SA)\b/i],
    languages: ['ar'],
    currencies: [/\b(AED|SAR|OMR|KWD|BHD|QAR|دراهم|ريال)\b/i],
  },
  EU: {
    statutes: [
      /\b(GDPR|EU AI Act|Digital Services Act|Digital Markets Act|NIS2|ePrivacy|ECHR|DSGVO|AVG|RGPD)\b/i,
      /\b(European Commission|EBA|ESMA|EIOPA|ECB)\b/i,
    ],
    courts: [/\b(Court of Justice of the European Union|CJEU|General Court|European Court of Human Rights|ECtHR|Bundesgerichtshof|Cour de cassation)\b/i],
    legalTerms: [/\b(data subject|controller|processor|DPO|DPA|right to erasure|DSAR|adequacy decision|standard contractual clauses|SCCs)\b/i],
    languages: ['fr', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'ro', 'sv', 'da', 'fi'],
    currencies: [/\b(EUR|€)\b/i],
  },
  US: {
    statutes: [
      /\b(CCPA|CPRA|HIPAA|HITECH|SOX|UCC|FCRA|ADA|ERISA|SEC Rule|17 CFR|28 CFR|Federal Rules of Civil Procedure|FRCP)\b/i,
      /\b(SEC|CFTC|FTC|DOJ|NLRB|OSHA|USPTO|IRS)\b/i,
    ],
    courts: [/\b(US Supreme Court|US Court of Appeals|US District Court|Federal Circuit|PTAB|TTAB|US Tax Court|Bankruptcy Court)\b/i],
    legalTerms: [/\b(deposition|discovery|subpoena|amicus|writ of certiorari|class action|ERISA|401\(k\)|LLC|LLP|Inc\.|Corp\.)\b/i],
    languages: ['es'],
    currencies: [/\b(USD|\$(?![\d,]*\s*(AED|SGD|CAD|AUD)))\b/i],
  },
  SG: {
    statutes: [
      /\b(Singapore Companies Act|PDPA|Employment Act|Electronic Transactions Act|Securities and Futures Act|Banking Act|MAS Notice|SGX Rules)\b/i,
      /\b(MAS|ACRA|SGX|IRAS|PDPC|CAAS)\b/i,
    ],
    courts: [/\b(Singapore International Commercial Court|SICC|Singapore Court of Appeal|High Court of Singapore|State Courts|SIAC|SIMC)\b/i],
    legalTerms: [/\b(ACRA registration|UEN|CPF|GST.*Singapore|PDPC|cybersecurity.*Singapore|fintech.*MAS)\b/i],
    languages: ['zh', 'ms', 'ta'],
    currencies: [/\b(SGD|S\$)\b/i],
  },
  CROSS: {
    statutes: [],
    courts: [],
    legalTerms: [/\b(cross.?jurisdictional|multi.?jurisdictional|comparative law|international arbitration|treaty|ICSID|ICC Arbitration|UNCITRAL)\b/i],
    languages: [],
    currencies: [],
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// SLM Binding Map — canonical map from jurisdiction to SLM binding
// ──────────────────────────────────────────────────────────────────────────────

// @ts-expect-error NV-TS230 legacy typing gap (TS2352)
const JURISDICTION_TO_SLM: Record<JurisdictionCode, SLMBinding> = {
  IN:    'NS-SLM-IND',
  UK:    'NS-SLM-UK',
  GC:    'NS-SLM-GCC',
  EU:    'NS-SLM-EUR',
  US:    'NS-SLM-USA',
  SG:    'NS-SLM-SGP',
  CROSS: 'NS-SLM-IND',  // NS LRM synthesises — SLM field unused for CROSS
} as Record<JurisdictionCode, SLMBinding>;

// Global LLM Fallback Tier — frontier models for edge cases.
// PII is ALWAYS redacted before any call here.
//
// Aligned with BUILT_IN_PROVIDERS in src/config/jrx-dynamic-model-registry.ts
// (priority order: openai → anthropic → google → openrouter → sarvam → agentzero).
// To swap a model here, update the providerModelId path; to disable a whole
// provider, flip BUILT_IN_PROVIDERS[<id>].enabled = false (no edits here needed).
const GLOBAL_FALLBACK_CHAIN: readonly string[] = Object.freeze([
  'anthropic/claude-sonnet-4-6',                  // Tier 1 — frontier legal reasoning
  'openai/gpt-4.1',                               // Tier 1 — general drafting
  'openai/o4-mini',                               // Tier 1 — reasoning, mid-cost
  'google/gemini-2.5-pro',                        // Tier 1 — EU/IN data residency, multimodal
  'openrouter/moonshotai/kimi-k2',                // Tier 2 — agentic, long-context
  'openrouter/meta-llama/llama-4-maverick',       // Tier 3 — sovereign open-source
  'openrouter/mistralai/mistral-large-2411',      // Tier 2 — EU sovereign
  'openrouter/deepseek/deepseek-r1',              // Tier 2 — reasoning, cost-optimised
  'agentzero/jrx-agentzero',                      // Tier 5 FINAL BACKUP — sovereign, no external egress
]);

// ──────────────────────────────────────────────────────────────────────────────
// Core Router Class
// ──────────────────────────────────────────────────────────────────────────────

export class NSLRMRouter {
  private static instance: NSLRMRouter;
  private readonly CONFIDENCE_THRESHOLD_SLM = 0.85;
  private readonly CONFIDENCE_THRESHOLD_LRM = 0.70;

  static getInstance(): NSLRMRouter {
    if (!NSLRMRouter.instance) {
      NSLRMRouter.instance = new NSLRMRouter();
      logger.info('[NSLRMRouter] Initialized — Two-tier NS LRM + 6 SLM architecture active');
    }
    return NSLRMRouter.instance;
  }

  /**
   * Main routing entry point. Analyzes query and returns routing decision.
   * All callers MUST redact PII before calling external APIs.
   */
  route(input: LRMQueryInput): LRMRoutingDecision {
    const jurisdiction = this.detectJurisdiction(input);
    return this.buildRoutingDecision(jurisdiction, input);
  }

  /**
   * Detect jurisdiction from multiple signals, returning confidence score.
   */
  detectJurisdiction(input: LRMQueryInput): JurisdictionDetectionResult {
    // 1. Explicit user selection — highest confidence
    if (input.explicitJurisdiction && input.explicitJurisdiction !== 'CROSS') {
      return {
        primary: input.explicitJurisdiction,
        secondary: [],
        confidence: 1.0,
        detectionMethod: ['explicit-user-selection'],
        isCrossJurisdictional: false,
        slmBinding: JURISDICTION_TO_SLM[input.explicitJurisdiction],
      };
    }

    // 2. Session jurisdiction — high confidence
    if (input.sessionJurisdiction && input.sessionJurisdiction !== 'CROSS') {
      return {
        primary: input.sessionJurisdiction,
        secondary: [],
        confidence: 0.92,
        detectionMethod: ['explicit-user-selection'],
        isCrossJurisdictional: false,
        slmBinding: JURISDICTION_TO_SLM[input.sessionJurisdiction],
      };
    }

    // 3. Pattern matching on query content
    const scores = this.scoreJurisdictions(input);
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b.score - a.score);
    const [topCode, topResult] = sorted[0] as [JurisdictionCode, { score: number; methods: DetectionMethod[] }];
    const secondaryJurisdictions = sorted
      .slice(1)
      .filter(([, r]) => (r as any).score > 0.2)
      .map(([code]) => code as JurisdictionCode);

    const isCrossJurisdictional = secondaryJurisdictions.length > 0 && topResult.score < 0.7;

    return {
      primary: isCrossJurisdictional ? 'CROSS' : topCode,
      secondary: secondaryJurisdictions,
      confidence: topResult.score,
      detectionMethod: topResult.methods,
      isCrossJurisdictional,
      slmBinding: JURISDICTION_TO_SLM[isCrossJurisdictional ? 'IN' : topCode],
    };
  }

  /**
   * Score all jurisdictions against the input signals.
   */
  private scoreJurisdictions(input: LRMQueryInput): Record<string, { score: number; methods: DetectionMethod[] }> {
    const text = [
      input.query,
      ...(input.citedStatutes || []),
      ...(input.entityNames || []),
    ].join(' ');

    const scores: Record<string, { score: number; methods: DetectionMethod[] }> = {};

    for (const [code, patterns] of Object.entries(JURISDICTION_PATTERNS)) {
      if (code === 'CROSS') continue;
      let score = 0;
      const methods: DetectionMethod[] = [];

      // Check statutes (weight: 0.40)
      for (const re of patterns.statutes) {
        if (re.test(text)) { score += 0.40; methods.push('cited-statute'); break; }
      }
      // Check courts (weight: 0.25)
      for (const re of patterns.courts) {
        if (re.test(text)) { score += 0.25; methods.push('court-name'); break; }
      }
      // Check legal terms (weight: 0.20)
      for (const re of patterns.legalTerms) {
        if (re.test(text)) { score += 0.20; methods.push('legal-term-vocabulary'); break; }
      }
      // Check currencies (weight: 0.10)
      for (const re of patterns.currencies) {
        if (re.test(text)) { score += 0.10; methods.push('entity-name'); break; }
      }
      // Check document language (weight: 0.05)
      if (input.documentLanguage && patterns.languages.includes(input.documentLanguage)) {
        score += 0.05; methods.push('document-language');
      }

      if (methods.length === 0) methods.push('default-fallback');
      scores[code] = { score: Math.min(score, 1.0), methods };
    }

    return scores;
  }

  /**
   * Build the final routing decision with tier, cost, and fallback chain.
   */
  private buildRoutingDecision(
    jurisdiction: JurisdictionDetectionResult,
    input: LRMQueryInput,
  ): LRMRoutingDecision {
    let tier: RoutingTier;
    let costTier: 'low' | 'medium' | 'high';
    let estimatedCostReduction: number;
    let routingReason: string;

    if (jurisdiction.isCrossJurisdictional || jurisdiction.confidence < this.CONFIDENCE_THRESHOLD_LRM) {
      tier = 'global-fallback';
      costTier = 'high';
      estimatedCostReduction = 0;
      routingReason = `Cross-jurisdictional query or low confidence (${(jurisdiction.confidence * 100).toFixed(0)}%) — escalating to Global LLM Fallback with PII redaction`;
    } else if (jurisdiction.confidence < this.CONFIDENCE_THRESHOLD_SLM || jurisdiction.secondary.length > 0) {
      tier = 'lrm-synthesis';
      costTier = 'medium';
      estimatedCostReduction = 60;
      routingReason = `Multi-jurisdiction synthesis required (primary: ${jurisdiction.primary}, secondary: ${jurisdiction.secondary.join(',')}) — NS LRM synthesis active`;
    } else {
      tier = 'slm';
      costTier = 'low';
      estimatedCostReduction = 90;
      routingReason = `High-confidence single jurisdiction (${jurisdiction.primary}, ${(jurisdiction.confidence * 100).toFixed(0)}%) — routing to ${jurisdiction.slmBinding}`;
    }

    const fallbackChain = this.buildFallbackChain(jurisdiction);

    logger.debug('[NSLRMRouter] Routing decision', {
      tier,
      jurisdiction: jurisdiction.primary,
      confidence: jurisdiction.confidence,
      slmBinding: jurisdiction.slmBinding,
      costReduction: `${estimatedCostReduction}%`,
    });

    return {
      tier,
      jurisdiction,
      slmBinding: jurisdiction.slmBinding,
      fallbackChain,
      costTier,
      estimatedCostReduction,
      piiRedactionRequired: tier === 'global-fallback',
      crossBorderSynthesis: tier === 'lrm-synthesis',
      routingReason,
    };
  }

  /**
   * Build the SLM fallback chain — primary SLM first, then related SLMs, then global.
   */
  private buildFallbackChain(jurisdiction: JurisdictionDetectionResult): SLMBinding[] {
    const primary = jurisdiction.slmBinding;
    const secondaries = jurisdiction.secondary
      .map(j => JURISDICTION_TO_SLM[j])
      .filter(Boolean)
      .filter(s => s !== primary);

    // Fallback order: primary → secondaries → default (NS-SLM-IND) → global
    const chain: SLMBinding[] = [primary, ...secondaries];
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    if (!chain.includes('NS-SLM-IND')) chain.push('NS-SLM-IND');
    return chain;
  }

  /**
   * Get global fallback LLM chain — for edge cases only.
   * Caller MUST have already redacted all PII.
   */
  getGlobalFallbackChain(): readonly string[] {
    return GLOBAL_FALLBACK_CHAIN;
  }

  /**
   * Return all SLM bindings — used by the orchestration layer.
   */
  getAllSLMBindings(): Record<JurisdictionCode, SLMBinding> {
    return { ...JURISDICTION_TO_SLM };
  }

  /**
   * Health check for the router.
   */
  healthCheck(): { status: 'healthy'; jurisdictions: number; slmBindings: string[] } {
    return {
      status: 'healthy',
      jurisdictions: Object.keys(JURISDICTION_TO_SLM).length - 1,  // exclude CROSS
      slmBindings: Object.values(SLM_BINDINGS),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────────────────────────────────────
export const nsLRMRouter = NSLRMRouter.getInstance();
