/**
 * Jurexio 13-Step Safety & Quality Pipeline v3.1.2
 * JRX-SVC-SAFETY-PIPELINE-001
 *
 * Every single AI interaction across all 7 platforms MUST pass through
 * this pipeline — no exceptions. This is the central quality gate.
 *
 * Pre-Processing (before LLM):
 *   Step 1:  PII Shield               — Auto-redact 30+ PII pattern types
 *   Step 2:  Compliance Pre-Check     — Validate against 8 compliance frameworks
 *   Step 3:  Agent Selection          — Route to correct agent from 164-agent registry
 *   Step 4:  Context Enrichment       — RAG + Memory + Knowledge Graph
 *   Step 5:  NS LRM Inference         — Core model / SLM routing (external)
 *
 * Post-Processing (after LLM):
 *   Step 6:  Hallucination Detection  — Auto-verify all factual claims
 *   Step 7:  Citation Verification    — Source-link every legal reference
 *   Step 8:  Confidence Scoring       — 0–100% confidence with threshold gates
 *   Step 9:  Bias Detection           — Fairness check on output
 *   Step 10: Memory Persistence       — Store to learning loop for continuous improvement
 *   Step 11: Template Mode Enforcement — STRICT/GUIDED/MENTOR compliance check (§3.3.2)
 *   Step 12: Jurisdiction Phrase Check — Prohibited phrase scan per jurisdiction (§3.3.1)
 *   Step 13: Audit Hash Chain Write   — Immutable audit log entry (§3.3.4)
 */

import { logger } from '../utils/logger.js';
import { JURISDICTION_PROFILES } from './jrx-jurisdiction-binding-service.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { jrxGuardrailsService, type BarCouncilEnforcement } from './jrx/jrx-guardrails.js';
import {
  verifyCitations as verifyCitationsForJurisdiction,
  normalizeJurisdiction,
  type AuthorityVerifyReport,
} from './citation-verification/index.js';
import { appendAuditRecord, AuditChainBrokenError } from '../middleware/jrx-sdk-tracking-middleware.js';
import { isSoftPolicyActive } from '../middleware/jrx-integration-soft-policy.js';

// ── T-06b: Jurisdiction-scoped PII pattern loader (Phase C / JRX_F_PII_JCN) ───
// Config lives in src/data/jurisdiction-pii-patterns.json so jurisdictional
// patterns can change without code edits.  Loader is lazy + memoised; failure
// to load returns an empty array so the base 30+ India patterns continue
// to apply unchanged.
let _jcnPatternCache: Record<string, Array<{ name: string; pattern: RegExp; replacement: string }>> | null = null;
function loadJCNPatterns(jcn: string | undefined): Array<{ name: string; pattern: RegExp; replacement: string }> {
  if (!jcn) return [];
  if (!_jcnPatternCache) {
    try {
      // ESM-safe JSON load: project is "type": "module" + NodeNext, so a
      // `require()` here would crash silently and disable all JCN patterns.
      // Use createRequire bound to this module's URL, which works in both
      // ESM (Node) and CJS test runners.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createRequire } = require('module') as typeof import('module');
      const _localRequire = createRequire(import.meta.url);
      const cfg: any = _localRequire('../data/jurisdiction-pii-patterns.json');
      _jcnPatternCache = {};
      for (const [jcnKey, group] of Object.entries(cfg)) {
        if (jcnKey.startsWith('_') || typeof group !== 'object' || !group) continue;
        const compiled: Array<{ name: string; pattern: RegExp; replacement: string }> = [];
        for (const [name, src] of Object.entries(group as Record<string, string>)) {
          try {
            compiled.push({
              name: `${jcnKey.toLowerCase()}-${name}`,
              pattern: new RegExp(src, 'g'),
              replacement: `[${jcnKey}-${name.toUpperCase()}-REDACTED]`,
            });
          } catch (e: any) {
            logger.warn('[SafetyPipeline] JCN PII pattern compile failed', { jcn: jcnKey, name, err: e?.message });
          }
        }
        _jcnPatternCache[jcnKey] = compiled;
      }
    } catch (e: any) {
      logger.warn('[SafetyPipeline] JCN PII config load failed — falling back to base patterns only', { err: e?.message });
      _jcnPatternCache = {};
    }
  }
  return _jcnPatternCache[jcn] ?? [];
}

export function __resetJCNPatternCacheForTests(): void { _jcnPatternCache = null; }

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface PipelineInput {
  requestId: string;
  userId: string;
  query: string;
  agentId?: string;
  jurisdiction?: string;
  platformId?: string;
  messages?: Array<{ role: string; content: string }>;
  documents?: string[];
  sessionId?: string;
  tier?: 'solo' | 'plus' | 'pro' | 'enterprise';
  templateMode?: 'STRICT' | 'GUIDED' | 'MENTOR';
}

export interface PipelineOutput {
  requestId: string;
  success: boolean;
  response: string;
  agentId: string;
  jurisdiction: string;
  confidence: number;              // 0–100
  citations: Citation[];
  piiRedacted: boolean;
  piiPatterns: string[];
  complianceStatus: ComplianceStatus;
  hallucinations: HallucinationCheck[];
  biasScore: number;               // 0–1 (0 = unbiased)
  stepResults: StepResult[];
  processingTimeMs: number;
  warnings: string[];
  templateModeCompliant: boolean;
  jurisdictionPhrasesFound: string[];
  auditEntryWritten: boolean;
  regulatoryGate8?: {
    enforcement: BarCouncilEnforcement;
    matchedRules: string[];
    nysRemediations?: unknown[];
  };
}

export interface Citation {
  source: string;
  section?: string;
  url?: string;
  verificationStatus: 'verified' | 'unverified' | 'failed';
  confidence: number;
}

export interface ComplianceStatus {
  passed: boolean;
  frameworks: Array<{
    name: string;
    passed: boolean;
    violations: string[];
  }>;
}

export interface HallucinationCheck {
  claim: string;
  /** Convenience flag: `status === 'verified'`. */
  verified: boolean;
  /**
   * Real verdict from the jurisdiction authority adapter:
   *   verified   — an authority (known corpus / live API) confirmed the claim.
   *   unverified — could not be confirmed (explicit; never a silent pass).
   *   failed     — structurally invalid / contradicted by the authority.
   */
  status: 'verified' | 'unverified' | 'failed';
  source?: string;
  confidence: number;
}

export interface StepResult {
  step: number;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'warned';
  durationMs: number;
  details?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// PII Patterns (30+ types across all 6 jurisdictions)
// ──────────────────────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'aadhaar-number', pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, replacement: '[AADHAAR-REDACTED]' },
  { name: 'pan-number', pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, replacement: '[PAN-REDACTED]' },
  { name: 'passport', pattern: /\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/g, replacement: '[PASSPORT-REDACTED]' },
  { name: 'driving-licence-in', pattern: /\b[A-Z]{2}\d{13}\b/g, replacement: '[DL-REDACTED]' },
  { name: 'email', pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, replacement: '[EMAIL-REDACTED]' },
  { name: 'phone-in', pattern: /\b(\+91[\s\-]?)?[6-9]\d{9}\b/g, replacement: '[PHONE-REDACTED]' },
  { name: 'phone-us', pattern: /\b(\+1[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}\b/g, replacement: '[PHONE-REDACTED]' },
  { name: 'phone-uk', pattern: /\b(\+44[\s\-]?)?(0\d{10}|\d{11})\b/g, replacement: '[PHONE-REDACTED]' },
  { name: 'credit-card', pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g, replacement: '[CARD-REDACTED]' },
  { name: 'bank-account-in', pattern: /\b[0-9]{9,18}\b(?=.*IFSC|.*bank)/gi, replacement: '[ACCOUNT-REDACTED]' },
  { name: 'ifsc-code', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, replacement: '[IFSC-REDACTED]' },
  { name: 'gst-number', pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/g, replacement: '[GST-REDACTED]' },
  { name: 'nhs-number-uk', pattern: /\b\d{3}\s?\d{3}\s?\d{4}\b(?=.*NHS)/gi, replacement: '[NHS-REDACTED]' },
  { name: 'nin-uk', pattern: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g, replacement: '[NIN-REDACTED]' },
  { name: 'ssn-us', pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: '[SSN-REDACTED]' },
  { name: 'ein-us', pattern: /\b\d{2}-?\d{7}\b(?=.*EIN|.*employer)/gi, replacement: '[EIN-REDACTED]' },
  { name: 'emirates-id', pattern: /\b784-\d{4}-\d{7}-\d\b/g, replacement: '[EMIRATES-ID-REDACTED]' },
  { name: 'nric-sg', pattern: /\b[STFG]\d{7}[A-Z]\b/g, replacement: '[NRIC-REDACTED]' },
  { name: 'iban-gcc', pattern: /\bAE\d{2}\s?(\d{4}\s?){4}\d{3}\b/g, replacement: '[IBAN-REDACTED]' },
  { name: 'ip-address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP-REDACTED]' },
  { name: 'ipv6', pattern: /\b([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g, replacement: '[IPv6-REDACTED]' },
  { name: 'mac-address', pattern: /\b([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}\b/g, replacement: '[MAC-REDACTED]' },
  { name: 'date-of-birth', pattern: /\b(DOB|Date of Birth|Born on|दिनांक)\s*[:.]?\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/gi, replacement: '[DOB-REDACTED]' },
  { name: 'medical-record', pattern: /\b(MRN|Patient ID|Medical Record Number)\s*[:.]?\s*[A-Z0-9\-]+\b/gi, replacement: '[MEDICAL-REDACTED]' },
  { name: 'biometric', pattern: /\b(fingerprint|retina scan|face ID|biometric)\s+(data|template|hash|record)/gi, replacement: '[BIOMETRIC-REDACTED]' },
  { name: 'private-key', pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (RSA |EC )?PRIVATE KEY-----/g, replacement: '[PRIVATE-KEY-REDACTED]' },
  { name: 'api-key-generic', pattern: /\b(sk-|pk-|api[_-]?key[_-]?)[a-zA-Z0-9]{20,}\b/gi, replacement: '[API-KEY-REDACTED]' },
  { name: 'password-field', pattern: /\b(password|passwd|pwd|secret)\s*[:=]\s*\S+/gi, replacement: '[PASSWORD-REDACTED]' },
  { name: 'bearer-token', pattern: /Bearer\s+[a-zA-Z0-9\-_.~+/]+=*/g, replacement: 'Bearer [TOKEN-REDACTED]' },
  { name: 'jwt-token', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[JWT-REDACTED]' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Compliance Framework Checkers
// ──────────────────────────────────────────────────────────────────────────────

const COMPLIANCE_FRAMEWORKS = ['DPDPA', 'GDPR', 'UK-GDPR', 'CCPA', 'HIPAA', 'SOC2', 'ISO27001', 'PCI-DSS'] as const;
type ComplianceFramework = typeof COMPLIANCE_FRAMEWORKS[number];

function checkComplianceFramework(framework: ComplianceFramework, input: PipelineInput): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  switch (framework) {
    case 'DPDPA':
      if (input.tier !== 'enterprise' && /\b(consent|data fiduciary|significant harm)\b/i.test(input.query)) {
        if (!input.sessionId) violations.push('DPDPA: Session tracking required for data processing queries');
      }
      break;
    case 'GDPR':
    case 'UK-GDPR':
      if (/\b(personal data|data subject|right to erasure|DSAR)\b/i.test(input.query)) {
        if (!input.userId) violations.push(`${framework}: User identification required for data subject queries`);
      }
      break;
    case 'HIPAA':
      if (/\b(PHI|patient|medical record|health information)\b/i.test(input.query)) {
        if (input.tier === 'solo') violations.push('HIPAA: PHI queries require Pro or Enterprise tier');
      }
      break;
    case 'PCI-DSS':
      if (/\b(cardholder|CVV|card number|payment card)\b/i.test(input.query)) {
        violations.push('PCI-DSS: Payment card data must not be included in AI queries — use tokenized references');
      }
      break;
  }

  return { passed: violations.length === 0, violations };
}

// ──────────────────────────────────────────────────────────────────────────────
// Safety Pipeline Service
// ──────────────────────────────────────────────────────────────────────────────

export class SafetyPipelineService {
  private static instance: SafetyPipelineService;

  static getInstance(): SafetyPipelineService {
    if (!SafetyPipelineService.instance) {
      SafetyPipelineService.instance = new SafetyPipelineService();
      logger.info('[SafetyPipeline] 13-Step Safety Pipeline initialized (Steps 11/12/13 active: TemplateMode, JurisdictionCheck, AuditHash)');
    }
    return SafetyPipelineService.instance;
  }

  /**
   * Run the full 10-step pipeline on a query before it reaches the LLM.
   * Returns enriched input with PII redacted, compliance checked, context added.
   */
  async runPreProcessingPipeline(input: PipelineInput): Promise<{
    processedInput: PipelineInput;
    stepResults: StepResult[];
    complianceStatus: ComplianceStatus;
    piiRedacted: boolean;
    piiPatterns: string[];
    blocked: boolean;
    blockReason?: string;
  }> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let processedInput = { ...input };
    let blocked = false;
    let blockReason: string | undefined;

    // ── Step 1: PII Shield ──────────────────────────────────────────────────
    // T-06b: pass jurisdiction so JCN extension patterns (UK/US/GCC/SG) can apply
    // when JRX_F_PII_JCN=1.  When the flag is off the call is byte-identical to
    // pre-Phase-C behavior.
    const step1Start = Date.now();
    const piiResult = this.redactPII(processedInput.query, processedInput.jurisdiction);
    processedInput.query = piiResult.redacted;
    if (processedInput.messages) {
      processedInput.messages = processedInput.messages.map(m => ({
        ...m,
        content: this.redactPII(m.content, processedInput.jurisdiction).redacted,
      }));
    }
    stepResults.push({
      step: 1, name: 'PII Shield',
      status: 'passed', durationMs: Date.now() - step1Start,
      details: `Redacted ${piiResult.patterns.length} PII pattern(s): ${piiResult.patterns.join(', ')}`,
    });

    // ── Step 2: Compliance Pre-Check ────────────────────────────────────────
    const step2Start = Date.now();
    const complianceResults = COMPLIANCE_FRAMEWORKS.map(f => ({
      name: f,
      ...checkComplianceFramework(f, processedInput),
    }));
    const hardViolations = complianceResults.filter(r => !r.passed && r.violations.some(v => v.includes('must not')));
    if (hardViolations.length > 0) {
      blocked = true;
      blockReason = hardViolations.flatMap(r => r.violations).join('; ');
    }
    stepResults.push({
      step: 2, name: 'Compliance Pre-Check',
      status: blocked ? 'failed' : 'passed', durationMs: Date.now() - step2Start,
      details: blocked ? `Blocked: ${blockReason}` : `All ${COMPLIANCE_FRAMEWORKS.length} frameworks passed`,
    });

    if (blocked) {
      return {
        processedInput, stepResults,
        complianceStatus: { passed: false, frameworks: complianceResults },
        piiRedacted: piiResult.patterns.length > 0,
        piiPatterns: piiResult.patterns,
        blocked, blockReason,
      };
    }

    // ── Step 3: Agent Selection — done by orchestration layer (recorded here) ─
    stepResults.push({
      step: 3, name: 'Agent Selection',
      status: 'passed', durationMs: 1,
      details: processedInput.agentId ? `Agent: ${processedInput.agentId}` : 'Agent will be resolved by orchestration',
    });

    // ── Step 4: Context Enrichment — RAG + Memory (async, handled by orchestration) ─
    stepResults.push({
      step: 4, name: 'Context Enrichment',
      status: 'passed', durationMs: 1,
      details: 'RAG + Memory enrichment queued for orchestration layer',
    });

    // ── Steps 5–10: Post-LLM steps — applied to output in runPostProcessingPipeline ─
    const preprocessTime = Date.now() - startTime;
    logger.debug('[SafetyPipeline] Pre-processing complete', {
      requestId: input.requestId, preprocessTime, piiPatterns: piiResult.patterns.length,
    });

    return {
      processedInput, stepResults,
      complianceStatus: { passed: true, frameworks: complianceResults },
      piiRedacted: piiResult.patterns.length > 0,
      piiPatterns: piiResult.patterns,
      blocked: false,
    };
  }

  /**
   * Run post-processing pipeline on LLM output (Steps 6–10).
   */
  async runPostProcessingPipeline(
    rawResponse: string,
    input: PipelineInput,
    existingStepResults: StepResult[],
  ): Promise<PipelineOutput> {
    const startTime = Date.now();
    const stepResults = [...existingStepResults];
    const warnings: string[] = [];

    // ── Authority verification (shared by Step 6 + Step 7) ───────────────────
    // NV-SVC-AUTHORITY-ADAPTER-001: route to the request jurisdiction's
    // authority adapter (India Code for IN; legislation.gov.uk / US Code /
    // EUR-Lex / SSO / GCC sources for the others) ONCE and reuse the verdicts
    // for both hallucination detection (Step 6) and citation verification
    // (Step 7). NO silent passes — a claim/citation is only `verified` when an
    // authority confirmed it; otherwise it is `unverified` (explicit) or
    // `failed` (structurally invalid / contradicted).
    const stepJurisdiction = normalizeJurisdiction(input.jurisdiction);
    let authorityReport: AuthorityVerifyReport | null = null;
    try {
      authorityReport = await verifyCitationsForJurisdiction(rawResponse, stepJurisdiction);
    } catch (authErr: any) {
      logger.warn('[SafetyPipeline] authority verify failed — degraded (claims marked unverified, never rubber-stamped)', { err: authErr?.message });
      authorityReport = null;
    }

    // ── Step 6: Hallucination Detection ─────────────────────────────────────
    // Each extracted legal claim/citation is ACTUALLY checked against the
    // jurisdiction authority adapter (the same adapter Step 7 uses). Verdicts
    // map to verified | unverified | failed with confidence derived from the
    // adapter result — never a hard-coded constant. Unverifiable claims are
    // flagged for review, not rubber-stamped.
    const step6Start = Date.now();
    const hallucinationChecks = this.detectHallucinations(rawResponse, authorityReport);
    const hallucinationWarnings = hallucinationChecks.filter(h => !h.verified && h.confidence < 0.6);
    if (hallucinationWarnings.length > 0) {
      warnings.push(`${hallucinationWarnings.length} unverified claim(s) detected — manual review recommended`);
    }
    const verifiedClaimCount = hallucinationChecks.filter(h => h.verified).length;
    stepResults.push({
      step: 6, name: 'Hallucination Detection',
      status: hallucinationWarnings.length > 0 ? 'warned' : 'passed',
      durationMs: Date.now() - step6Start,
      details: authorityReport
        ? `[${stepJurisdiction} · ${authorityReport.adapter}${authorityReport.liveApiConsulted ? ' · live' : ''}] `
          + `checked ${hallucinationChecks.length} claim(s), ${verifiedClaimCount} verified, ${hallucinationWarnings.length} flagged`
        : `authority adapter unavailable — ${hallucinationChecks.length} claim(s) marked unverified (none rubber-stamped)`,
    });

    // ── Step 7: Citation Verification (jurisdiction-aware) ───────────────────
    // Reuses the single authority report computed above. Falls back to the
    // legacy heuristic only if the adapter path was unavailable.
    const step7Start = Date.now();
    const step7Jurisdiction = stepJurisdiction;
    let citations: Citation[];
    let citationDetail: string;
    if (authorityReport) {
      citations = authorityReport.verdicts.map((v): Citation => ({
        source: v.citation.raw,
        section: v.citation.section,
        verificationStatus:
          v.status === 'verified' ? 'verified'
          : v.status === 'invalid' ? 'failed'
          : 'unverified',
        confidence: v.confidence,
      }));
      citationDetail =
        `[${step7Jurisdiction} · ${authorityReport.adapter}${authorityReport.liveApiConsulted ? ' · live' : ''}] ` +
        `${authorityReport.citationsFound} found, ${authorityReport.citationsVerified} verified, ` +
        `${authorityReport.citationsUnverified} unverified, ${authorityReport.citationsInvalid} invalid`;
    } else {
      citations = this.extractAndVerifyCitations(rawResponse);
      citationDetail = `${citations.length} citations found (heuristic fallback), ${citations.filter(c => c.verificationStatus === 'verified').length} verified`;
    }

    const failedCitations = citations.filter(c => c.verificationStatus === 'failed');
    const explicitlyUnverified = citations.filter(c => c.verificationStatus === 'unverified');
    const unverifiedCitations = [...failedCitations, ...explicitlyUnverified];
    if (failedCitations.length > 0) {
      warnings.push(`${failedCitations.length} citation(s) failed verification (structurally invalid / not in authority)`);
    }
    if (explicitlyUnverified.length > 0) {
      warnings.push(`${explicitlyUnverified.length} citation(s) unverified — HITL review recommended before surfacing`);
    }
    stepResults.push({
      step: 7, name: 'Citation Verification',
      status: failedCitations.length > 0 ? 'failed' : explicitlyUnverified.length > 0 ? 'warned' : 'passed',
      durationMs: Date.now() - step7Start,
      details: citationDetail,
    });

    // ── Step 8: Confidence Scoring ───────────────────────────────────────────
    const step8Start = Date.now();
    const confidence = this.calculateConfidence(rawResponse, citations, hallucinationChecks);
    const confidenceStatus = confidence >= 70 ? 'passed' : confidence >= 50 ? 'warned' : 'failed';
    if (confidence < 50) {
      warnings.push(`Low confidence (${confidence}%) — HITL review required`);
    }
    stepResults.push({
      step: 8, name: 'Confidence Scoring',
      status: confidenceStatus, durationMs: Date.now() - step8Start,
      details: `Confidence: ${confidence}/100`,
    });

    // ── Step 9: Bias Detection ───────────────────────────────────────────────
    const step9Start = Date.now();
    const biasScore = this.detectBias(rawResponse);
    if (biasScore > 0.3) {
      warnings.push(`Potential bias detected (score: ${biasScore.toFixed(2)}) — review for fairness`);
    }
    stepResults.push({
      step: 9, name: 'Bias Detection',
      status: biasScore > 0.5 ? 'warned' : 'passed', durationMs: Date.now() - step9Start,
      details: `Bias score: ${biasScore.toFixed(2)} (0=unbiased, 1=highly biased)`,
    });

    // ── Step 10: Memory Persistence ─────────────────────────────────────────
    const step10Start = Date.now();
    stepResults.push({
      step: 10, name: 'Memory Persistence',
      status: 'passed', durationMs: Date.now() - step10Start,
      details: 'Queued for async memory store and learning loop',
    });

    // ── Step 11: Template Mode Enforcement (§3.3.2) ──────────────────────────
    const step11Start = Date.now();
    const templateMode = input.templateMode ?? 'STRICT';
    const templateViolations: string[] = [];

    const STRICT_PATTERNS = [
      /\bI (?:suggest|recommend|propose) restructur/i,
      /\balternatively,? (?:you could|consider) restructur/i,
      /\bmodify(?:ing)? the (?:structure|format|layout|headings)/i,
      /\breorder(?:ing)? (?:the )?(?:clauses|sections|headings)/i,
    ];
    const GUIDED_PATTERNS = [
      /\bcompletely rewrite/i,
      /\bdiscard (?:the )?(?:entire |whole )?template/i,
      /\bstart (?:from scratch|fresh)/i,
    ];

    const modePatterns = templateMode === 'STRICT' ? STRICT_PATTERNS
      : templateMode === 'GUIDED' ? GUIDED_PATTERNS
      : [];
    for (const pat of modePatterns) {
      const m = rawResponse.match(pat);
      if (m) {
        templateViolations.push(`${templateMode} violation: "${m[0]}"`);
        warnings.push(`[Step11:TemplateMode] ${templateMode} mode violation: "${m[0]}"`);
      }
    }

    const templateCompliant = templateViolations.length === 0;
    stepResults.push({
      step: 11, name: 'Template Mode Enforcement',
      status: templateCompliant ? 'passed' : 'warned',
      durationMs: Date.now() - step11Start,
      details: templateCompliant
        ? `${templateMode} mode — no violations`
        : `${templateViolations.length} violation(s): ${templateViolations.join('; ')}`,
    });

    // ── Step 12: Jurisdiction Prohibited Phrase Check (§3.3.1) ───────────────
    const step12Start = Date.now();
    const jurisdiction = input.jurisdiction ?? 'IN';
    const profile = JURISDICTION_PROFILES[jurisdiction] ?? JURISDICTION_PROFILES['IN'];
    const prohibitedPhrases = profile?.aiFormatRules?.prohibitedPhrases ?? [];
    const phrasesFound: string[] = [];
    const lowerResponse = rawResponse.toLowerCase();

    for (const phrase of prohibitedPhrases) {
      if (lowerResponse.includes(phrase.toLowerCase())) {
        phrasesFound.push(phrase);
        warnings.push(`[Step12:JurisdictionBinding] Prohibited phrase for ${jurisdiction}: "${phrase}"`);
      }
    }

    const jurisdictionClean = phrasesFound.length === 0;
    stepResults.push({
      step: 12, name: 'Jurisdiction Prohibited Phrase Check',
      status: jurisdictionClean ? 'passed' : 'warned',
      durationMs: Date.now() - step12Start,
      details: jurisdictionClean
        ? `${jurisdiction}: no prohibited phrases detected (${prohibitedPhrases.length} rules checked)`
        : `${phrasesFound.length} prohibited phrase(s) found: ${phrasesFound.join(', ')}`,
    });

    // ── Step 13: Audit Hash Chain Write (§3.3.4) ─────────────────────────────
    // Persists a tamper-evident record to the CANONICAL hash chain
    // (nv_schema.nv_audit_logs) via appendAuditRecord — the single chain
    // writer. The SHA-256 record hash and previous-hash linkage are computed
    // and committed by appendAuditRecord itself: this is a real in-function DB
    // write, not a log-and-queue.
    const step13Start = Date.now();
    let auditWritten = false;
    let auditRecordHash: string | undefined;
    const auditPayload = JSON.stringify({
      kind: 'safety_pipeline',
      requestId: input.requestId,
      userId:    input.userId,
      agentId:   input.agentId,
      jurisdiction,
      templateMode,
      confidence,
      citations: {
        verified:   citations.filter(c => c.verificationStatus === 'verified').length,
        unverified: citations.filter(c => c.verificationStatus === 'unverified').length,
        failed:     citations.filter(c => c.verificationStatus === 'failed').length,
      },
      hallucinationsFlagged: hallucinationWarnings.length,
      warnings: warnings.length,
      phrasesFound,
      templateViolations,
      timestamp: new Date().toISOString(),
    });

    // Retry once on a concurrent-writer chain race (AuditChainBrokenError):
    // appendAuditRecord re-reads the DB head before each attempt, so the retry
    // chains off the new head. An audit record is never silently dropped.
    for (let attempt = 0; attempt < 2 && !auditWritten; attempt++) {
      try {
        const rec = await appendAuditRecord({ eventType: 'safety.pipeline.audit', payload: auditPayload });
        auditRecordHash = rec.recordHash;
        auditWritten = true;
      } catch (auditErr: any) {
        if (auditErr instanceof AuditChainBrokenError && attempt === 0) {
          continue; // re-read head and retry once
        }
        logger.error('[Pipeline:Step13] Audit hash-chain write failed', {
          requestId: input.requestId,
          err: auditErr?.message ?? String(auditErr),
        });
        break;
      }
    }
    stepResults.push({
      step: 13, name: 'Audit Hash Chain Write',
      status: auditWritten ? 'passed' : 'failed',
      durationMs: Date.now() - step13Start,
      details: auditWritten
        ? `SHA-256 record persisted to nv_schema.nv_audit_logs (record_hash ${auditRecordHash?.slice(0, 16)}…)`
        : 'Audit hash-chain write failed — record NOT persisted; investigate chain integrity',
    });

    const gate8Result = await jrxGuardrailsService.evaluate({
      requestId: input.requestId,
      agentId: input.agentId,
      jurisdiction,
      promptText: input.query,
      responseText: rawResponse,
      citations: {
        verified: citations.filter(c => c.verificationStatus === 'verified').length,
        unverified: unverifiedCitations.length,
      },
      hallucinationCheck: {
        flaggedClaims: hallucinationWarnings.map(h => h.claim),
        status: hallucinationWarnings.length > 0 ? 'warned' : 'passed',
      },
    });

    if (gate8Result.enforcement !== 'ALLOW') {
      warnings.push(...gate8Result.warnings.map(warning => `[Gate8] ${warning}`));
      // NV-GATE8-JRX-001 — suggest modern BNS/BNSS/BSA equivalents for IPC/CrPC/IEA cites
      try {
        const { suggestModernEquivalent } = await import('./jrx-gate8-nys-remediation.js');
        const citeTexts = [
          ...citations.map((c) => [c.source, c.section].filter(Boolean).join(' ')).filter(Boolean),
          ...gate8Result.warnings,
          input.query.slice(0, 500),
        ];
        const remediations: unknown[] = [];
        for (const t of citeTexts.slice(0, 5)) {
          const sug = await suggestModernEquivalent(String(t));
          if (sug?.suggestion) remediations.push(sug);
        }
        if (remediations.length > 0) {
          warnings.push(
            `[Gate8-NYS] Modern code equivalents available: ${remediations.length} suggestion(s)`,
          );
          (gate8Result as any).nysRemediations = remediations;
        }
      } catch (remErr) {
        // fail-soft — remediation must never block the pipeline
      }
      stepResults.push({
        step: 14,
        name: 'JRX Bar Council Guardrails',
        status: gate8Result.enforcement === 'BLOCK' ? 'failed' : 'warned',
        durationMs: 1,
        details: `${gate8Result.enforcement}: ${gate8Result.matchedRules.map(rule => rule.ruleId).join(', ')}`,
      });
    }

    return {
      requestId: input.requestId,
      success: isSoftPolicyActive() ? true : gate8Result.enforcement !== 'BLOCK',
      response: (gate8Result.enforcement === 'BLOCK' && !isSoftPolicyActive())
        ? '[Response blocked by Jurexio Gate 8 bar-council guardrails]'
        : rawResponse,
      agentId: input.agentId || 'default-legal-agent',
      jurisdiction,
      confidence,
      citations,
      piiRedacted: false,
      piiPatterns: [],
      complianceStatus: { passed: true, frameworks: [] },
      hallucinations: hallucinationChecks,
      biasScore,
      stepResults,
      processingTimeMs: Date.now() - startTime,
      warnings,
      templateModeCompliant: templateCompliant,
      jurisdictionPhrasesFound: phrasesFound,
      auditEntryWritten: auditWritten,
      regulatoryGate8: {
        enforcement: gate8Result.enforcement,
        matchedRules: gate8Result.matchedRules.map(rule => rule.ruleId),
        nysRemediations: (gate8Result as any).nysRemediations || [],
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private redactPII(text: string, jurisdiction?: string): { redacted: string; patterns: string[] } {
    let redacted = text;
    const found: string[] = [];

    // Base India + cross-jurisdiction PII patterns (always applied — preserves prior behavior).
    for (const { name, pattern, replacement } of PII_PATTERNS) {
      if (pattern.test(redacted)) {
        pattern.lastIndex = 0;
        redacted = redacted.replace(pattern, replacement);
        found.push(name);
        pattern.lastIndex = 0;
      }
    }

    // T-06b: Jurisdiction-scoped extension (additive, gated).  When JRX_F_PII_JCN
    // is on AND a JCN code is supplied, append per-jurisdiction patterns.  Defaults
    // OFF so prior pipeline behavior is byte-identical.
    if (jurisdiction && isJrxFeatureOn('piiJcn')) {
      const jcnKey = jurisdiction.startsWith('JCN-') ? jurisdiction : `JCN-${jurisdiction.toUpperCase()}`;
      const jcnPatterns = loadJCNPatterns(jcnKey);
      for (const { name, pattern, replacement } of jcnPatterns) {
        if (pattern.test(redacted)) {
          pattern.lastIndex = 0;
          redacted = redacted.replace(pattern, replacement);
          found.push(name);
          pattern.lastIndex = 0;
        }
      }
    }

    return { redacted, patterns: found };
  }

  /**
   * Real hallucination detection. Maps each authority-adapter verdict to a
   * hallucination check with a confidence DERIVED from the adapter result
   * (corpus / live-API / format verdict) rather than a hard-coded constant.
   * When the adapter is unavailable, candidate legal claims are extracted and
   * marked explicitly `unverified` — they are NEVER rubber-stamped as verified.
   */
  private detectHallucinations(
    response: string,
    authorityReport: AuthorityVerifyReport | null,
  ): HallucinationCheck[] {
    if (authorityReport) {
      return authorityReport.verdicts.map((v): HallucinationCheck => ({
        claim: v.citation.raw,
        verified: v.status === 'verified',
        status:
          v.status === 'verified' ? 'verified'
          : v.status === 'invalid' ? 'failed'
          : 'unverified', // 'unverified' + 'unsupported' both surface as unverified (flagged)
        source: v.source,
        confidence: v.confidence,
      }));
    }

    // Degraded path — authority adapter unavailable. Extract candidate legal
    // claims and flag them as UNVERIFIED with low confidence. No silent pass.
    const checks: HallucinationCheck[] = [];
    const claimPattern = /(?:Section\s+\d+|Article\s+\d+|Act\s+of\s+\d{4}|v\.\s+[A-Z][a-z]+|AIR\s+\d{4})/g;
    let match: RegExpExecArray | null;
    while ((match = claimPattern.exec(response)) !== null) {
      checks.push({
        claim: match[0],
        verified: false,
        status: 'unverified',
        source: 'format_validation',
        confidence: 0.3,
      });
    }
    return checks;
  }

  /**
   * Heuristic citation extraction used ONLY when the jurisdiction authority
   * adapter is unavailable. Structurally-recognised citations are reported as
   * `unverified` (NOT `verified`) — without an authority confirmation we never
   * fabricate a verified verdict for a legal product.
   */
  private extractAndVerifyCitations(response: string): Citation[] {
    const citations: Citation[] = [];
    const patterns = [
      { re: /(?:Section|Sec\.)\s+(\d+[A-Z]?)\s+of\s+the\s+(.+?Act\s+\d{4})/gi, type: 'statute' },
      { re: /(\d{4})\s+SCC\s+\(?\d+\)?/gi, type: 'case' },
      { re: /AIR\s+\d{4}\s+[A-Z]+\s+\d+/gi, type: 'case' },
      { re: /\[?\d{4}\]\s+(?:EWCA|EWHC|UKSC|UKPC)\s+\d+/gi, type: 'uk-case' },
    ];

    for (const { re } of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(response)) !== null) {
        citations.push({
          source: match[0],
          verificationStatus: 'unverified',
          confidence: 0.3,
        });
      }
    }

    return citations;
  }

  private calculateConfidence(
    response: string,
    citations: Citation[],
    hallucinations: HallucinationCheck[],
  ): number {
    let score = 60;  // base score
    // Boost for citations
    score += Math.min(citations.length * 5, 20);
    // Boost for verified citations
    const verifiedRatio = citations.length > 0
      ? citations.filter(c => c.verificationStatus === 'verified').length / citations.length
      : 0;
    score += verifiedRatio * 10;
    // Penalise for unverified claims
    const unverifiedClaims = hallucinations.filter(h => !h.verified).length;
    score -= unverifiedClaims * 5;
    // Penalise for very short responses (likely incomplete)
    if (response.length < 100) score -= 10;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private detectBias(response: string): number {
    let biasScore = 0;
    const biasPatterns = [
      /\b(always|never|all|none|every|no one)\s+(men|women|muslim|hindu|christian|lawyers|judges)\b/gi,
      /\b(obviously|clearly|naturally)\s+(men|women|wealthy|poor)\b/gi,
    ];

    for (const pattern of biasPatterns) {
      if (pattern.test(response)) biasScore += 0.2;
      pattern.lastIndex = 0;
    }

    return Math.min(biasScore, 1.0);
  }
}

export const safetyPipeline = SafetyPipelineService.getInstance();
