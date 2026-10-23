import { Request, Response, NextFunction } from 'express';
import { SECURITY_CONFIG, NYAYAMITRA_CONFIG, SDK_CONFIG } from '../config/platform-config.js';
import { createLogger } from '../utils/logger.js';
import {
  writeCamActionAsync,
  camActionId,
  type CamSeverity,
} from '../services/compliance/jrx-cam-writer.js';
import { isSoftPolicyActive, isSoftPolicyRequest } from './jrx-integration-soft-policy.js';


const logger = createLogger('guardrails-enforcement');

interface GuardrailViolation {
  timestamp: string;
  requestId: string;
  violationType: string;
  action: string;
  details?: string;
}

interface GuardrailStats {
  totalViolations: number;
  violationsByType: Record<string, number>;
  lastViolation: GuardrailViolation | null;
  startedAt: string;
}

const LEGAL_ADVICE_PATTERNS: RegExp[] = [
  /you\s+should\s+file/i,
  /your\s+legal\s+rights\s+are/i,
  /I\s+recommend\s+suing/i,
  /you\s+must\s+sue/i,
  /you\s+should\s+sue/i,
  /I\s+advise\s+you\s+to\s+file/i,
  /you\s+are\s+entitled\s+to/i,
  /your\s+best\s+legal\s+option/i,
  /you\s+should\s+take\s+legal\s+action/i,
  /I\s+recommend\s+filing/i,
  /you\s+have\s+a\s+strong\s+case/i,
  /you\s+will\s+win\s+this\s+case/i,
];

const LAWYER_RATING_PATTERNS: RegExp[] = [
  /best\s+lawyer/i,
  /top\s+rated\s+lawyer/i,
  /lawyer\s+rating/i,
  /lawyer\s+comparison/i,
  /recommended\s+lawyer/i,
  /lawyer\s+ranking/i,
  /rate\s+this\s+lawyer/i,
  /compare\s+lawyers/i,
];

const BAIL_DRAFTING_PATTERNS: RegExp[] = [
  /bail\s+application\s+draft/i,
  /draft\s+bail/i,
  /prepare\s+bail\s+application/i,
  /bail\s+petition\s+template/i,
  /generate\s+bail\s+application/i,
];

const NOTICE_DRAFTING_PATTERNS: RegExp[] = [
  /draft\s+(a\s+)?legal\s+notice/i,
  /prepare\s+(a\s+)?legal\s+notice/i,
  /generate\s+(a\s+)?notice/i,
  /legal\s+notice\s+template/i,
  /notice\s+drafting/i,
  /draft\s+(a\s+)?notice\s+to/i,
];

const MARKETPLACE_PATTERNS: RegExp[] = [
  /browse\s+marketplace/i,
  /marketplace\s+listing/i,
  /shop\s+for\s+lawyers/i,
  /lawyer\s+marketplace/i,
  /find\s+and\s+hire/i,
  /browse\s+legal\s+services/i,
];

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|api|key|token|secret|password)[-_]?[a-zA-Z0-9]{20,}\b/i,
  /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/i,
  /\b(nyv_key_|nyv_sk_)[a-zA-Z0-9]+\b/i,
  /\bAIza[a-zA-Z0-9_-]{35}\b/,
  /\bsk-[a-zA-Z0-9]{40,}\b/,
];

const ALLOWED_JURISDICTIONS = SDK_CONFIG.supportedJurisdictions;

const MAX_REQUEST_BODY_SIZE = 1_048_576;

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function redactPii(text: string): string {
  let redacted = text;
  const patterns = SECURITY_CONFIG.pii.patterns;
  const redactionChar = SECURITY_CONFIG.pii.redactionChar;

  for (const [, pattern] of Object.entries(patterns) as [string, RegExp][]) {
    const regex = new RegExp(pattern.source, pattern.flags);
    redacted = redacted.replace(regex, (match: string) => redactionChar.repeat(match.length));
  }

  return redacted;
}

function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    redacted = redacted.replace(regex, (match: string) => SECURITY_CONFIG.pii.redactionChar.repeat(match.length));
  }
  return redacted;
}

function checkLegalContentPolicy(text: string): { blocked: boolean; reason: string | null } {
  for (const pattern of LEGAL_ADVICE_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'direct_legal_advice' };
    }
  }

  for (const pattern of LAWYER_RATING_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'lawyer_rating_comparison' };
    }
  }

  for (const pattern of BAIL_DRAFTING_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'bail_application_drafting' };
    }
  }

  for (const pattern of NOTICE_DRAFTING_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'notice_drafting' };
    }
  }

  for (const pattern of MARKETPLACE_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: 'marketplace_browsing' };
    }
  }

  return { blocked: false, reason: null };
}

function sanitizeResponseText(text: string): string {
  let sanitized = stripHtmlTags(text);
  sanitized = redactPii(sanitized);
  sanitized = redactSecrets(sanitized);
  return sanitized;
}

function sanitizeResponseObject(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return sanitizeResponseText(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeResponseObject(item));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeResponseText(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeResponseObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function extractAllText(obj: any): string[] {
  const texts: string[] = [];

  function walk(val: any): void {
    if (typeof val === 'string') {
      texts.push(val);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) walk(item);
      return;
    }
    if (typeof val === 'object' && val !== null) {
      for (const v of Object.values(val)) walk(v);
    }
  }

  walk(obj);
  return texts;
}

function containsBannedKeywords(text: string): string | null {
  const lower = text.toLowerCase();

  // NV-LEGAL-ALLOWLIST-001 — Legitimate legal research (statutes, criminal codes,
  // case commentary) must not trip BANNED_CONTENT on words like "murder"/"kill".
  const legalResearchSignal =
    /\b(bns|bnss|bsa|ipc|crpc|iea|section|statute|punishment|penal|bail|fir|charge.?sheet|jurisdiction|citation|precedent|caselaw|case.?law|bharatiya\s+nyaya|indian\s+penal|criminal\s+(?:code|law|procedure)|legal\s+research|under\s+(?:the\s+)?(?:bns|ipc|section))\b/i.test(
      text,
    );
  const LEGAL_CONTEXT_EXEMPT = new Set(['kill', 'murder', 'suicide', 'terror', 'bomb']);

  for (const keyword of SECURITY_CONFIG.bannedKeywords) {
    if (lower.includes(keyword)) {
      if (legalResearchSignal && LEGAL_CONTEXT_EXEMPT.has(keyword)) {
        continue;
      }
      return keyword;
    }
  }
  return null;
}

function validateJurisdiction(jurisdiction: string): boolean {
  return ALLOWED_JURISDICTIONS.includes(jurisdiction as any);
}

class GuardrailManager {
  private violations: GuardrailViolation[] = [];
  private violationCounts: Record<string, number> = {};
  private startedAt: string;

  constructor() {
    this.startedAt = new Date().toISOString();
  }

  runStartupAudit(): void {
    logger.info('[GuardrailManager] Platform guardrail startup audit');
    logger.info(`[GuardrailManager] CTO Exclusions: noAiLegalAdvice=${NYAYAMITRA_CONFIG.ctoExclusions.noAiLegalAdvice}, noVisibleLawyerRatings=${NYAYAMITRA_CONFIG.ctoExclusions.noVisibleLawyerRatings}, noNoticeDrafting=${NYAYAMITRA_CONFIG.ctoExclusions.noNoticeDrafting}, noBailAdvice=${NYAYAMITRA_CONFIG.ctoExclusions.noBailAdvice}, noMarketplaceBrowsing=${NYAYAMITRA_CONFIG.ctoExclusions.noMarketplaceBrowsing}`);
    logger.info(`[GuardrailManager] PII redaction enabled: ${SECURITY_CONFIG.pii.enabledByDefault}`);
    logger.info(`[GuardrailManager] PII patterns loaded: ${Object.keys(SECURITY_CONFIG.pii.patterns).length}`);
    logger.info(`[GuardrailManager] Banned keywords loaded: ${SECURITY_CONFIG.bannedKeywords.length}`);
    logger.info(`[GuardrailManager] Legal advice patterns: ${LEGAL_ADVICE_PATTERNS.length}`);
    logger.info(`[GuardrailManager] Supported jurisdictions: ${ALLOWED_JURISDICTIONS.join(', ')}`);
    logger.info(`[GuardrailManager] Max request body size: ${MAX_REQUEST_BODY_SIZE} bytes`);
    logger.info('[GuardrailManager] LLM orchestration enforcement: All tasks routed through agent registry');
    logger.info('[GuardrailManager] Guardrail enforcement active');
  }

  private logViolation(violation: GuardrailViolation): void {
    this.violations.push(violation);
    this.violationCounts[violation.violationType] = (this.violationCounts[violation.violationType] || 0) + 1;
    logger.warn(`[GuardrailManager] Violation: type=${violation.violationType} action=${violation.action} requestId=${violation.requestId} details=${violation.details || 'none'}`);
    this.maybeEmitCamAction(violation);
  }

  /**
   * Task #201: seed the compliance reviewer queue from guardrail
   * violations. Only HIGH/CRITICAL violations are surfaced — low-noise
   * input validation failures stay in the in-memory stats only.
   *
   * Severity map:
   *   - critical: legal_content_policy_* (banned outputs)
   *   - high:     banned_keyword, request_body_too_large, invalid_jurisdiction
   * Anything else is skipped.
   *
   * action_id is derived from (framework, type, requestId) so a single
   * blocked request emits exactly one row even if multiple violations
   * share the same requestId.
   */
  private maybeEmitCamAction(violation: GuardrailViolation): void {
    const type = violation.violationType;
    let severity: CamSeverity | null = null;
    if (type.startsWith('legal_content_policy_')) {
      severity = 'critical';
    } else if (
      type === 'banned_keyword' ||
      type === 'request_body_too_large' ||
      type === 'invalid_jurisdiction'
    ) {
      severity = 'high';
    }
    if (!severity) return;

    const actionId = camActionId(['guardrails', type, violation.requestId]);
    writeCamActionAsync({
      actionId,
      framework: 'guardrails',
      controlId: type,
      severity,
      title: `Guardrail violation: ${type}`,
      description: violation.details
        ? `Blocked request ${violation.requestId} (${violation.action}). ${violation.details}`
        : `Blocked request ${violation.requestId} (${violation.action}).`,
      triggeredBy: 'guardrail_enforcement',
      evidenceRef: violation.requestId,
      metadata: {
        violationType: type,
        action: violation.action,
        details: violation.details ?? null,
        timestamp: violation.timestamp,
      },
    });
  }

  enforceRequestGuardrails(req: Request): { allowed: boolean; code: string; message: string } | null {
    const requestId = req.sdkContext?.requestId || 'unknown';

    // NSP/NYM soft policy: skip content bans / jurisdiction blocks for integration testing.
    // Size limit still enforced.
    const soft = Boolean(req.sdkContext?.softPolicy) || isSoftPolicyRequest(req) || isSoftPolicyActive();

    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_REQUEST_BODY_SIZE) {
      this.logViolation({
        timestamp: new Date().toISOString(),
        requestId,
        violationType: 'request_body_too_large',
        action: 'blocked',
        details: `Content-Length: ${contentLength}`,
      });
      return { allowed: false, code: 'REQUEST_TOO_LARGE', message: `Request body exceeds maximum allowed size of ${MAX_REQUEST_BODY_SIZE} bytes.` };
    }

    if (soft) {
      return null;
    }

    if (req.body && typeof req.body === 'object') {
      const texts = extractAllText(req.body);
      for (const text of texts) {
        const banned = containsBannedKeywords(text);
        if (banned) {
          this.logViolation({
            timestamp: new Date().toISOString(),
            requestId,
            violationType: 'banned_keyword',
            action: 'blocked',
            details: `keyword: ${banned}`,
          });
          return { allowed: false, code: 'BANNED_CONTENT', message: 'Request contains prohibited content.' };
        }
      }

      if ((req.body.model || req.body.llm) && !req.body.agentId) {
        logger.warn(`[GuardrailManager] Direct LLM bypass attempt detected: requestId=${requestId} - request contains 'model' or 'llm' field without 'agentId'. All LLM tasks must be routed through the agent registry.`);
      }

      const jurisdiction = req.body.jurisdiction || req.body.jurisdictionCode;
      if (jurisdiction && typeof jurisdiction === 'string') {
        if (!validateJurisdiction(jurisdiction)) {
          this.logViolation({
            timestamp: new Date().toISOString(),
            requestId,
            violationType: 'invalid_jurisdiction',
            action: 'blocked',
            details: `jurisdiction: ${jurisdiction}`,
          });
          return { allowed: false, code: 'INVALID_JURISDICTION', message: `Jurisdiction '${jurisdiction}' is not supported. Allowed: ${ALLOWED_JURISDICTIONS.join(', ')}` };
        }
      }
    }

    return null;
  }

  enforceResponseGuardrails(response: any, context: { requestId: string; softPolicy?: boolean }): { sanitized: any; blocked: boolean; reason: string | null } {
    const soft = Boolean(context.softPolicy) || isSoftPolicyActive();
    const texts = extractAllText(response);

    if (!soft) {
      for (const text of texts) {
        const policyCheck = checkLegalContentPolicy(text);
        if (policyCheck.blocked) {
          this.logViolation({
            timestamp: new Date().toISOString(),
            requestId: context.requestId,
            violationType: `legal_content_policy_${policyCheck.reason}`,
            action: 'blocked',
          });
          return {
            sanitized: null,
            blocked: true,
            reason: policyCheck.reason,
          };
        }
      }
    }

    // Always sanitize secrets/PII even under soft policy.
    const sanitized = sanitizeResponseObject(response);

    return { sanitized, blocked: false, reason: null };
  }

  getStats(): GuardrailStats {
    return {
      totalViolations: this.violations.length,
      violationsByType: { ...this.violationCounts },
      lastViolation: this.violations.length > 0 ? this.violations[this.violations.length - 1] : null,
      startedAt: this.startedAt,
    };
  }
}

export const guardrailManager = new GuardrailManager();

export function guardrailEnforcementMiddleware(req: Request, res: Response, next: NextFunction): void {
  const result = guardrailManager.enforceRequestGuardrails(req);

  if (result) {
    res.status(400).json({
      success: false,
      data: null,
      error: {
        code: result.code,
        message: result.message,
      },
    });
    return;
  }

  next();
}

export function responseGuardrailMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any): Response {
    const requestId = req.sdkContext?.requestId || 'unknown';
    const softPolicy = Boolean(req.sdkContext?.softPolicy) || isSoftPolicyRequest(req) || isSoftPolicyActive();

    if (body && typeof body === 'object') {
      const result = guardrailManager.enforceResponseGuardrails(body, { requestId, softPolicy });

      if (result.blocked) {
        return originalJson({
          success: false,
          data: null,
          error: {
            code: 'CONTENT_POLICY_VIOLATION',
            message: 'Response blocked due to legal content policy violation.',
            policyViolation: result.reason,
          },
        });
      }

      return originalJson(result.sanitized);
    }

    return originalJson(body);
  } as any;

  next();
}
