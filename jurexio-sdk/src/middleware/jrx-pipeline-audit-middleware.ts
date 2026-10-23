/**
 * Jurexio Enterprise Platform 3.1.2 — 13-Step AI Pipeline Hardening Middleware
 * JRX-MW-PIPELINE-001
 *
 * Handover §3.3 — 13-Step AI Safety Pipeline:
 *
 * Step 1:  Input sanitisation (remove HTML, XSS vectors, null bytes)
 * Step 2:  Prompt injection detection (adversarial patterns)
 * Step 3:  PII detection + redaction (Aadhaar, PAN, phone, email)
 * Step 4:  Jurisdiction binding (ensure jurisdiction profile is attached)
 * Step 5:  Template mode validation (STRICT/GUIDED/MENTOR enforced)
 * Step 6:  Credit reservation (check balance before calling AI)
 * Step 7:  RAG gate (block if confidence < 0.85 for legal fact claims)
 * Step 8:  AI execution (the actual LLM call — performed by route handler)
 * Step 9:  Output citation check (all legal claims must cite sources)
 * Step 10: Risk score computation (5-component formula)
 * Step 11: Block gate (risk > 60 → blocked, requires lawyer confirmation)
 * Step 12: AI metadata block injection
 * Step 13: Audit log write (ai_activity + hash chain)
 *
 * Steps 1-7 are pre-execution (request middleware).
 * Steps 9-13 are post-execution (handled by service layer + GRPO interceptor).
 * Step 8 is the route handler itself.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-pipeline-audit');

// ─────────────────────────────────────────
// Step 1: Input Sanitisation
// ─────────────────────────────────────────

export function sanitiseInput(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove script injection patterns
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    // Normalise whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────
// Step 2: Prompt Injection Detection
// ─────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore (previous|all|your) (instructions?|prompt|rules?)/gi,
  /you are now (a\s+)?(different|new|alternative)\s+AI/gi,
  /forget (everything|all instructions|your training)/gi,
  /pretend you (are|have no|can ignore)/gi,
  /system:\s*(you|your role|your instructions)/gi,
  /<<SYS>>/gi,
  /\[INST\]/gi,
  /###\s*new\s*system/gi,
  /override (safety|guardrail|filter|restriction)/gi,
  /bypass (safety|guardrail|filter|restriction)/gi,
  /jailbreak/gi,
  /DAN\s+mode/gi,
  /do anything now/gi,
];

export function detectPromptInjection(prompt: string): { detected: boolean; pattern?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false };
}

// ─────────────────────────────────────────
// Step 3: PII Detection + Redaction
// ─────────────────────────────────────────

const PII_PATTERNS = [
  { name: 'aadhaar', pattern: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/, replacement: '[AADHAAR_REDACTED]' },
  { name: 'pan', pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/, replacement: '[PAN_REDACTED]' },
  { name: 'mobile', pattern: /\b[6-9]\d{9}\b/, replacement: '[MOBILE_REDACTED]' },
  { name: 'email', pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/, replacement: '[EMAIL_REDACTED]' },
  { name: 'passport', pattern: /\b[A-Z]{1}[0-9]{7}\b/, replacement: '[PASSPORT_REDACTED]' },
  { name: 'driving_license', pattern: /\b[A-Z]{2}[0-9]{2}\s?[0-9]{11}\b/, replacement: '[DL_REDACTED]' },
];

export interface PIIDetectionResult {
  hasRedactions: boolean;
  redactedText: string;
  typesFound: string[];
}

export function detectAndRedactPII(text: string): PIIDetectionResult {
  let redacted = text;
  const typesFound: string[] = [];
  for (const { name, pattern, replacement } of PII_PATTERNS) {
    const before = redacted;
    redacted = redacted.replace(pattern, replacement);
    if (redacted !== before) typesFound.push(name);
  }
  return {
    hasRedactions: typesFound.length > 0,
    redactedText: redacted,
    typesFound,
  };
}

// ─────────────────────────────────────────
// Step 7: RAG Confidence Gate
// ─────────────────────────────────────────

const RAG_THRESHOLD = 0.85;

export interface RAGGateResult {
  passed: boolean;
  confidence: number;
  reason?: string;
}

/**
 * Checks RAG retrieval confidence for legal fact claims.
 * In production this calls the RAG service — here we check
 * if a confidence score is provided in the RAG context.
 */
export function ragConfidenceGate(
  ragConfidence?: number,
  skipForPatterns: string[] = ['MENTOR', 'GUIDED']
): RAGGateResult {
  // If no RAG context or confidence score, pass (not a RAG request)
  if (ragConfidence === undefined || ragConfidence === null) {
    return { passed: true, confidence: 1, reason: 'No RAG context — gate not applicable' };
  }
  if (ragConfidence < RAG_THRESHOLD) {
    return {
      passed: false,
      confidence: ragConfidence,
      reason: `RAG confidence ${ragConfidence.toFixed(3)} below threshold ${RAG_THRESHOLD}. Legal fact claims require stronger source grounding.`,
    };
  }
  return { passed: true, confidence: ragConfidence };
}

// ─────────────────────────────────────────
// Combined Pre-Execution Pipeline Middleware (Steps 1–7)
// ─────────────────────────────────────────

/**
 * Apply Steps 1–3 to the incoming request.
 * Attaches pipelineAudit object to req for downstream use.
 * Blocks on injection detection.
 */
export function pipelinePreExecutionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  // Step 1: Sanitise text fields (include STT / voice copy-resend aliases)
  const textFields = ['task', 'query', 'prompt', 'input', 'description', 'message', 'content', 'text', 'transcript'];
  for (const field of textFields) {
    const value = body[field];
    if (typeof value === 'string') {
      body[field] = sanitiseInput(value);
    }
  }

  // Step 2: Prompt injection detection
  const pickStr = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');
  const promptText = pickStr('task') || pickStr('query') || pickStr('prompt') || pickStr('input') || pickStr('message') || pickStr('text') || pickStr('transcript');
  const injectionCheck = detectPromptInjection(promptText);
  if (injectionCheck.detected) {
    logger.warn('Prompt injection detected — request blocked', {
      traceId,
      pattern: injectionCheck.pattern,
      ip: req.ip,
    });
    res.status(400).json({
      success: false,
      error: 'PROMPT_INJECTION_DETECTED',
      message: 'Request contains adversarial patterns and has been blocked.',
      trace_id: traceId,
    });
    return;
  }

  // Step 3: PII detection (log but do NOT block — user may be submitting their own data)
  const piiResult = detectAndRedactPII(promptText);
  if (piiResult.hasRedactions) {
    logger.info('PII detected in request — redacted for logging', {
      traceId,
      types: piiResult.typesFound,
    });
  }

  // Attach pipeline audit state to request
  req.pipelineAudit = {
    trace_id: traceId,
    start_time: startTime,
    step: 3,
    injection_clear: true,
    pii_types_found: piiResult.typesFound,
    sanitised: true,
  };

  logger.debug('Pipeline pre-execution: steps 1–3 passed', { traceId });
  next();
}

/**
 * Step 9: Citation check on AI output.
 * Returns list of uncited legal claims found.
 */
export function checkOutputCitations(output: string): string[] {
  const uncited: string[] = [];
  const citationPatterns = [
    /\b(section|s\.)\s*\d+[A-Z]?\b/gi,
    /\b(article)\s+\d+\b/gi,
  ];
  const legalClaimPatterns = [
    /\b(it is settled law|it is well established|courts have held|the law provides|it is mandatory under law)\b/gi,
  ];
  for (const claimPattern of legalClaimPatterns) {
    const claims = output.match(claimPattern) || [];
    for (const claim of claims) {
      // Check if claim is followed by a citation within 100 chars
      const claimIndex = output.toLowerCase().indexOf(claim.toLowerCase());
      const context = output.substring(claimIndex, claimIndex + 150);
      const hasCitation = citationPatterns.some(p => p.test(context));
      if (!hasCitation) {
        uncited.push(`Claim "${claim}" has no citation`);
      }
    }
  }
  return uncited;
}

/**
 * Build a Step 13 audit log entry (attached to every AI response).
 */
export function buildAuditEntry(
  traceId: string,
  userId: string,
  route: string,
  riskScore: number,
  blocked: boolean,
  durationMs: number
) {
  return {
    trace_id: traceId,
    user_id: userId,
    route,
    risk_score: riskScore,
    blocked,
    duration_ms: durationMs,
    pipeline_version: '3.1.2-13step',
    audited_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S9.1 — 13-Step Pipeline Audit Recorder + Gate Enforcers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a pipeline audit recorder for tracking all 13 steps per request.
 * Attach to req.pipelineAudit and pass through the middleware chain.
 */
export function createPipelineAudit() {
  return {
    steps: {} as Record<number, { name: string; status: 'pass' | 'fail' | 'skip'; detail?: string }>,
    record(step: number, name: string, status: 'pass' | 'fail' | 'skip', detail?: string) {
      this.steps[step] = { name, status, detail };
    },
    verify() {
      const REQUIRED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
      const missing = REQUIRED_STEPS.filter(s => !this.steps[s]);
      if (missing.length > 0) {
        logger.warn(`[Pipeline] Steps not recorded: ${missing.join(', ')}`);
      }
      return missing;
    },
    toLog() { return this.steps; },
  };
}

/**
 * Step 7 RAG gate enforcement — blocks if confidence below threshold.
 * Minimum confidence: 0.85 (per §3.3.5)
 */
export function enforceRagGate(
  ragResult: { confidence: number },
  minConfidence = 0.85
): { blocked: boolean; confidence: number; threshold?: number; reason?: string } {
  if (ragResult.confidence < minConfidence) {
    return {
      blocked: true,
      confidence: ragResult.confidence,
      threshold: minConfidence,
      reason: 'RAG_CONFIDENCE_BELOW_THRESHOLD',
    };
  }
  return { blocked: false, confidence: ragResult.confidence };
}

/**
 * Step 9 Citation validator — legal claims must have supporting citations.
 * Returns valid:false with warning when uncited legal claims detected.
 */
export function validateCitations(output: string): { valid: boolean; warning?: string } {
  const CITATION_PATTERN =
    /(?:Section \d+[A-Z]?|BNS \d+|BNSS \d+|BSA \d+|Article \d+|\[\d{4}\] \d+ SCC \d+|\d{4} AIR \d+)/i;
  const hasLegalClaims = /\b(held|ruled|decided|observed|stated)\b/i.test(output);
  const hasCitations = CITATION_PATTERN.test(output);

  if (hasLegalClaims && !hasCitations) {
    return { valid: false, warning: 'Legal claims present without citations. Lawyer review required.' };
  }
  return { valid: true };
}
