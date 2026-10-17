import { createLogger } from './logger.js';
import { sanitizeOrchestrationErrorForClient } from './jrx-client-outcome-sanitize.js';

const logger = createLogger('error-sanitizer');

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  'ECONNREFUSED': 'Service temporarily unavailable',
  'ECONNRESET': 'Connection interrupted, please retry',
  'ETIMEDOUT': 'Request timed out, please retry',
  'ENOTFOUND': 'Service temporarily unavailable',
  'ER_DUP_ENTRY': 'A record with this information already exists',
  '23505': 'A record with this information already exists',
  '23503': 'Referenced record not found',
  '28P01': 'Caselaw store temporarily unavailable',
  '42P01': 'System configuration error',
  // Match Postgres missing-relation text only — NOT "correlationId" (contains "relation").
  'relation "': 'System configuration error',
  'ENOMEM': 'Server resource limit reached',
  'password authentication': 'Caselaw store temporarily unavailable',
  'InvalidClientTokenId': 'Document store temporarily unavailable',
  'ExpiredToken': 'Document store temporarily unavailable',
  'AccessDenied': 'Document store temporarily unavailable',
};

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api.?key/i,
  /credential/i,
  /database.*url/i,
  /connection.*string/i,
  /stack.*at\s/i,
  /node_modules/i,
  /\/home\//i,
  /\.ts:\d+/i,
  /\.js:\d+/i,
  /pg_/i,
  /SELECT|INSERT|UPDATE|DELETE|DROP|ALTER/i,
];

export function sanitizeErrorForClient(error: unknown): string {
  if (!error) return 'An unexpected error occurred';

  const rawMessage = error instanceof Error ? error.message : String(error);

  // NV-CLIENT-OUTCOME-SANITIZE-001 — never echo Queen/swarm/timeout internals
  if (
    /queen|swarm|orchestrat|failed branches|per-node timeout|agent execution|decomposition|policy:\s*per-node/i.test(
      rawMessage,
    )
  ) {
    return sanitizeOrchestrationErrorForClient(error);
  }

  for (const [pattern, safeMessage] of Object.entries(SAFE_ERROR_MESSAGES)) {
    if (rawMessage.includes(pattern)) {
      return safeMessage;
    }
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(rawMessage)) {
      return 'An internal error occurred. Please try again or contact support.';
    }
  }

  if (rawMessage.length > 200) {
    return 'An internal error occurred. Please try again or contact support.';
  }

  const safeChars = /^[a-zA-Z0-9\s.,!?'"\-:;()[\]{}@#$%&*+=/<>]+$/;
  if (!safeChars.test(rawMessage)) {
    return 'An internal error occurred. Please try again or contact support.';
  }

  return rawMessage;
}

export function logAndSanitize(error: unknown, context: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(`[ERROR] ${context}:`, rawMessage);
  if (process.env.NODE_ENV === 'development' && stack) {
    logger.error(`[STACK] ${context}:`, stack);
  }

  return sanitizeErrorForClient(error);
}
