/**
 * Jurexio user-facing message catalog (NV-MSG-001).
 * Single source of truth for API error codes, validation copy, and client toasts.
 * Phase 1: static catalog; Phase 2 may add DB overrides per tenant/locale.
 */

export type NvMessageSeverity = 'info' | 'warning' | 'error';

export interface NvMessageDefinition {
  code: string;
  message: string;
  httpStatus: number;
  severity: NvMessageSeverity;
  retryable?: boolean;
  userTitle?: string;
}

export const NV_MESSAGE_CATALOG = {
  // Auth & access
  API_KEY_MISSING: {
    code: 'API_KEY_MISSING',
    message: 'API key is required. Provide it via the X-API-Key header or Authorization: Bearer.',
    httpStatus: 401,
    severity: 'error',
    userTitle: 'Authentication required',
  },
  BEARER_NOT_SDK_KEY: {
    code: 'BEARER_NOT_SDK_KEY',
    message: 'This endpoint requires an SDK API key, not a session token.',
    httpStatus: 401,
    severity: 'error',
    userTitle: 'Invalid credentials',
  },
  INSUFFICIENT_SCOPE: {
    code: 'INSUFFICIENT_SCOPE',
    message: 'Your API key does not include the required scope for this action.',
    httpStatus: 403,
    severity: 'error',
    userTitle: 'Access denied',
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Authentication failed. Sign in again or provide a valid API key.',
    httpStatus: 401,
    severity: 'error',
    userTitle: 'Unauthorized',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action.',
    httpStatus: 403,
    severity: 'error',
    userTitle: 'Access denied',
  },

  // Infrastructure
  DB_UNAVAILABLE: {
    code: 'DB_UNAVAILABLE',
    message: 'Service is temporarily unavailable. Please try again shortly.',
    httpStatus: 503,
    severity: 'error',
    retryable: true,
    userTitle: 'Service unavailable',
  },
  QUEUE_UNAVAILABLE: {
    code: 'QUEUE_UNAVAILABLE',
    message: 'Background processing is temporarily unavailable. Please retry.',
    httpStatus: 503,
    severity: 'error',
    retryable: true,
    userTitle: 'Processing unavailable',
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred. If this persists, contact support with your request ID.',
    httpStatus: 500,
    severity: 'error',
    userTitle: 'Something went wrong',
  },
  QUALITY_ENVELOPE_FAILED: {
    code: 'QUALITY_ENVELOPE_FAILED',
    message:
      'Mandatory quality gates did not complete. Inspect error.details.qualityEnvelope.missingMandatory before retrying.',
    httpStatus: 422,
    severity: 'error',
    retryable: false,
    userTitle: 'Quality check incomplete',
  },
  AI_SERVICE_UNAVAILABLE: {
    code: 'AI_SERVICE_UNAVAILABLE',
    message:
      'AI providers are temporarily unavailable. A background retry may have been queued — check error.details.retryJobId.',
    httpStatus: 503,
    severity: 'error',
    retryable: true,
    userTitle: 'AI temporarily unavailable',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
    httpStatus: 404,
    severity: 'error',
    userTitle: 'Not found',
  },
  BAD_REQUEST: {
    code: 'BAD_REQUEST',
    message: 'The request could not be processed. Check your input and try again.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Invalid request',
  },
  RATE_LIMIT_EXCEEDED: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Rate limit exceeded. Please wait before retrying.',
    httpStatus: 429,
    severity: 'warning',
    retryable: true,
    userTitle: 'Too many requests',
  },
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    message: 'Validation failed. Review the highlighted fields.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Validation error',
  },

  // Common field validation
  QUERY_REQUIRED: {
    code: 'QUERY_REQUIRED',
    message: 'A query is required.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Missing query',
  },
  TEXT_REQUIRED: {
    code: 'TEXT_REQUIRED',
    message: 'Text content is required.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Missing text',
  },
  AGENT_KEY_REQUIRED: {
    code: 'AGENT_KEY_REQUIRED',
    message: 'An agent key is required.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Missing agent',
  },
  JURISDICTION_REQUIRED: {
    code: 'JURISDICTION_REQUIRED',
    message: 'A jurisdiction is required (e.g. IN, UK, US).',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Missing jurisdiction',
  },
  ORG_ID_REQUIRED: {
    code: 'ORG_ID_REQUIRED',
    message: 'An organization ID is required.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Missing organization',
  },
  NAME_REQUIRED: {
    code: 'NAME_REQUIRED',
    message: 'A name is required.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Missing name',
  },

  // Platform registry
  NYV_PLAT_NOT_FOUND: {
    code: 'NYV-PLAT-404',
    message: 'Platform not found.',
    httpStatus: 404,
    severity: 'error',
    userTitle: 'Platform not found',
  },
  NYV_PLAT_VALIDATION: {
    code: 'NYV-PLAT-VAL-001',
    message: 'Platform configuration is invalid.',
    httpStatus: 400,
    severity: 'warning',
    userTitle: 'Invalid platform config',
  },

  // Documents & jobs
  JOB_NOT_FOUND: {
    code: 'JOB_NOT_FOUND',
    message: 'Job not found or has expired.',
    httpStatus: 404,
    severity: 'error',
    userTitle: 'Job not found',
  },
  DOC_NOT_FOUND: {
    code: 'DOC_NOT_FOUND',
    message: 'Document not found or you do not have access.',
    httpStatus: 404,
    severity: 'error',
    userTitle: 'Document not found',
  },
  SESSION_NOT_FOUND: {
    code: 'SESSION_NOT_FOUND',
    message: 'Session not found or has expired.',
    httpStatus: 404,
    severity: 'error',
    userTitle: 'Session expired',
  },

  // Guardrails
  BANNED_CONTENT: {
    code: 'BANNED_CONTENT',
    message: 'This request was blocked by content safety policies.',
    httpStatus: 403,
    severity: 'warning',
    userTitle: 'Content blocked',
  },
  REQUEST_TOO_LARGE: {
    code: 'REQUEST_TOO_LARGE',
    message: 'The request payload exceeds the allowed size.',
    httpStatus: 413,
    severity: 'warning',
    userTitle: 'Request too large',
  },
} as const satisfies Record<string, NvMessageDefinition>;

export type NvMessageCode = keyof typeof NV_MESSAGE_CATALOG;

export interface NvMessageEnvelope {
  success: false;
  data?: null;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

export function nvMessage(
  code: NvMessageCode,
  vars?: Record<string, string>,
): NvMessageDefinition {
  const def = NV_MESSAGE_CATALOG[code];
  if (!vars) return def;
  let message: string = def.message;
  for (const [k, v] of Object.entries(vars)) {
    message = message.replaceAll(`{${k}}`, v);
  }
  return { ...def, message };
}

export function nvMessageEnvelope(
  code: NvMessageCode,
  opts?: { vars?: Record<string, string>; details?: unknown; overrideMessage?: string },
): NvMessageEnvelope {
  const def = nvMessage(code, opts?.vars);
  return {
    success: false,
    data: null,
    error: {
      code: def.code,
      message: opts?.overrideMessage ?? def.message,
      ...(def.retryable ? { retryable: true } : {}),
      ...(opts?.details !== undefined ? { details: opts.details } : {}),
    },
  };
}

/** Map HTTP status to default catalog code when no business code is known. */
export function httpStatusToMessageCode(status: number): NvMessageCode {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMIT_EXCEEDED';
  if (status === 503) return 'DB_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}
