/**
 * Unified API error responder — NV-MSG-001.
 * All route handlers should prefer sendApiError / safeError over inline res.json.
 */

import type { Response } from 'express';
import {
  httpStatusToMessageCode,
  NV_MESSAGE_CATALOG,
  nvMessage,
  nvMessageEnvelope,
  type NvMessageCode,
  type NvMessageEnvelope,
} from '../config/jrx-message-catalog.js';
import type { QualityEnvelopeError } from '../orchestration/jrx-quality-envelope.js';
import { sanitizeOrchestrationErrorForClient } from './jrx-client-outcome-sanitize.js';
import { sanitizeErrorForClient } from './error-sanitizer.js';

export type { NvMessageCode, NvMessageEnvelope };

const CATALOG_CODES = new Set<string>(Object.keys(NV_MESSAGE_CATALOG));

function isNvMessageCode(v: string): v is NvMessageCode {
  return CATALOG_CODES.has(v);
}

/**
 * Send a catalog-backed error envelope.
 */
export function sendApiError(
  res: Response,
  code: NvMessageCode,
  opts?: { status?: number; vars?: Record<string, string>; details?: unknown; overrideMessage?: string },
): void {
  const def = nvMessage(code, opts?.vars);
  const status = opts?.status ?? def.httpStatus;
  res.status(status).json(nvMessageEnvelope(code, opts));
}

/** NV-NSP-SLA-QE-001 — stable partner-facing envelope failure (not opaque INTERNAL_ERROR). */
export function sendQualityEnvelopeFailure(res: Response, err: QualityEnvelopeError): void {
  sendApiError(res, 'QUALITY_ENVELOPE_FAILED', {
    details: {
      missingMandatory: err.snapshot.missingMandatory,
      qualityEnvelope: err.snapshot,
    },
  });
}

/**
 * Backward-compatible safeError used across nv5 and orch routes.
 * - `safeError(res, 'QUERY_REQUIRED')` → catalog message
 * - `safeError(res, 'custom text', 400)` → BAD_REQUEST with override in dev, catalog in prod for 5xx
 * - `safeError(res, err, 500)` → Error message in dev; INTERNAL_ERROR in prod for 5xx
 */
export function safeError(res: Response, err: unknown, status = 500): void {
  const isProd = process.env.NODE_ENV === 'production';

  if (typeof err === 'string') {
    if (isNvMessageCode(err)) {
      sendApiError(res, err, { status });
      return;
    }
    const code = httpStatusToMessageCode(status);
    const envelope = nvMessageEnvelope(code, {
      overrideMessage: isProd && status >= 500 ? undefined : err,
    });
    res.status(status).json(envelope);
    return;
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  const code = httpStatusToMessageCode(status);

  if (rawMsg === 'Database not available') {
    sendApiError(res, 'DB_UNAVAILABLE');
    return;
  }

  // Never leak orchestration / agent internals in error envelopes
  const clientMsg = sanitizeErrorForClient(err);
  const orchSafe = sanitizeOrchestrationErrorForClient(err);
  const overrideMessage =
    isProd && status >= 500
      ? undefined
      : /queen|swarm|orchestrat|timeout|failed branches|policy:/i.test(rawMsg)
        ? orchSafe
        : clientMsg;

  res.status(status).json(
    nvMessageEnvelope(code, {
      overrideMessage,
    }),
  );
}

/** Standard success envelope helper for consistency. */
export function sendApiSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}
