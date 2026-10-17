/**
 * Client-side mirror of server NV_MESSAGE_CATALOG (NV-MSG-001).
 * Keep codes in sync with src/config/jrx-message-catalog.ts
 */

export type NvClientMessageCode =
  | 'API_KEY_MISSING'
  | 'BEARER_NOT_SDK_KEY'
  | 'INSUFFICIENT_SCOPE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'DB_UNAVAILABLE'
  | 'QUEUE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'RATE_LIMIT_EXCEEDED'
  | 'VALIDATION_FAILED'
  | 'QUERY_REQUIRED'
  | 'TEXT_REQUIRED'
  | 'AGENT_KEY_REQUIRED'
  | 'JURISDICTION_REQUIRED'
  | 'ORG_ID_REQUIRED'
  | 'NAME_REQUIRED'
  | 'JRX_PLAT_NOT_FOUND'
  | 'JRX_PLAT_VALIDATION'
  | 'JOB_NOT_FOUND'
  | 'DOC_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'BANNED_CONTENT'
  | 'REQUEST_TOO_LARGE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR';

export interface NvClientMessage {
  code: NvClientMessageCode;
  title: string;
  message: string;
}

const CLIENT_MESSAGES: Record<NvClientMessageCode, NvClientMessage> = {
  API_KEY_MISSING: { code: 'API_KEY_MISSING', title: 'Authentication required', message: 'API key is required.' },
  BEARER_NOT_SDK_KEY: { code: 'BEARER_NOT_SDK_KEY', title: 'Invalid credentials', message: 'Use an SDK API key for this action.' },
  INSUFFICIENT_SCOPE: { code: 'INSUFFICIENT_SCOPE', title: 'Access denied', message: 'Your key lacks the required scope.' },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', title: 'Unauthorized', message: 'Please sign in again.' },
  FORBIDDEN: { code: 'FORBIDDEN', title: 'Access denied', message: 'You do not have permission.' },
  DB_UNAVAILABLE: { code: 'DB_UNAVAILABLE', title: 'Service unavailable', message: 'Try again in a moment.' },
  QUEUE_UNAVAILABLE: { code: 'QUEUE_UNAVAILABLE', title: 'Processing unavailable', message: 'Background jobs are temporarily unavailable.' },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', title: 'Something went wrong', message: 'An unexpected error occurred.' },
  NOT_FOUND: { code: 'NOT_FOUND', title: 'Not found', message: 'The requested item was not found.' },
  BAD_REQUEST: { code: 'BAD_REQUEST', title: 'Invalid request', message: 'Check your input and try again.' },
  RATE_LIMIT_EXCEEDED: { code: 'RATE_LIMIT_EXCEEDED', title: 'Too many requests', message: 'Please wait before retrying.' },
  VALIDATION_FAILED: { code: 'VALIDATION_FAILED', title: 'Validation error', message: 'Review the highlighted fields.' },
  QUERY_REQUIRED: { code: 'QUERY_REQUIRED', title: 'Missing query', message: 'Enter a query to continue.' },
  TEXT_REQUIRED: { code: 'TEXT_REQUIRED', title: 'Missing text', message: 'Text content is required.' },
  AGENT_KEY_REQUIRED: { code: 'AGENT_KEY_REQUIRED', title: 'Missing agent', message: 'Select an agent to continue.' },
  JURISDICTION_REQUIRED: { code: 'JURISDICTION_REQUIRED', title: 'Missing jurisdiction', message: 'Choose a jurisdiction.' },
  ORG_ID_REQUIRED: { code: 'ORG_ID_REQUIRED', title: 'Missing organization', message: 'Organization ID is required.' },
  NAME_REQUIRED: { code: 'NAME_REQUIRED', title: 'Missing name', message: 'A name is required.' },
  JRX_PLAT_NOT_FOUND: { code: 'JRX_PLAT_NOT_FOUND', title: 'Platform not found', message: 'This platform does not exist.' },
  JRX_PLAT_VALIDATION: { code: 'JRX_PLAT_VALIDATION', title: 'Invalid config', message: 'Platform configuration is invalid.' },
  JOB_NOT_FOUND: { code: 'JOB_NOT_FOUND', title: 'Job not found', message: 'This job was not found or expired.' },
  DOC_NOT_FOUND: { code: 'DOC_NOT_FOUND', title: 'Document not found', message: 'Document not found or access denied.' },
  SESSION_NOT_FOUND: { code: 'SESSION_NOT_FOUND', title: 'Session expired', message: 'Start a new session.' },
  BANNED_CONTENT: { code: 'BANNED_CONTENT', title: 'Content blocked', message: 'This request was blocked by safety policies.' },
  REQUEST_TOO_LARGE: { code: 'REQUEST_TOO_LARGE', title: 'Request too large', message: 'Reduce the payload size.' },
  NETWORK_ERROR: { code: 'NETWORK_ERROR', title: 'Network error', message: 'Check your connection and try again.' },
  TIMEOUT_ERROR: { code: 'TIMEOUT_ERROR', title: 'Request timed out', message: 'The server took too long to respond.' },
};

export function getNvClientMessage(code: NvClientMessageCode): NvClientMessage {
  return CLIENT_MESSAGES[code] ?? CLIENT_MESSAGES.INTERNAL_ERROR;
}

/** Resolve API error bodies from all gateway envelope shapes. */
export function resolveApiError(body: unknown): NvClientMessage {
  if (!body || typeof body !== 'object') {
    return CLIENT_MESSAGES.INTERNAL_ERROR;
  }
  const o = body as Record<string, unknown>;
  const err = o.error;
  if (typeof err === 'string' && err.trim()) {
    return { code: 'BAD_REQUEST', title: 'Error', message: err };
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const code = typeof e.code === 'string' ? e.code : 'INTERNAL_ERROR';
    const message = typeof e.message === 'string' ? e.message
      : typeof o.error === 'string' ? o.error
      : CLIENT_MESSAGES.INTERNAL_ERROR.message;
    const known = (CLIENT_MESSAGES as Record<string, NvClientMessage>)[code];
    if (known) {
      return { ...known, message };
    }
    return {
      code: 'INTERNAL_ERROR',
      title: 'Error',
      message,
    };
  }
  if (typeof o.message === 'string') {
    return { code: 'BAD_REQUEST', title: 'Error', message: o.message };
  }
  return CLIENT_MESSAGES.INTERNAL_ERROR;
}
