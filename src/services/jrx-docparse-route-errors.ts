/**
 * NV-DOCPARSE-ROUTE-ERRORS-001 — stable codes for NSP fail-soft (no secret echo).
 */
import type { Response } from 'express';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';

const KNOWN: Record<string, string> = {
  DOCPARSE_EVIDENCE_DEPICT_DISABLED: 'Evidence depiction is disabled on this gateway.',
  DOCPARSE_ATTACH_UNDERSTAND_DISABLED: 'Attach understanding is disabled on this gateway.',
  EVIDENCE_DEPICT_PARSE_FAILED: 'Vision model returned an unreadable response.',
  EVIDENCE_DEPICT_SCHEMA_FAILED: 'Vision model JSON did not match the expected schema.',
  ATTACH_UNDERSTAND_PARSE_FAILED: 'Attach understanding response was not valid JSON.',
  ATTACH_UNDERSTAND_SCHEMA_FAILED: 'Attach understanding JSON did not match the expected schema.',
  VISION_LLM_UNAVAILABLE: 'Vision providers are temporarily unavailable.',
  Empty: 'Empty document bytes.',
};

export function respondDocparseRouteError(res: Response, err: unknown, status = 422): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'DOCPARSE_EVIDENCE_DEPICT_DISABLED' || msg === 'DOCPARSE_ATTACH_UNDERSTAND_DISABLED') {
    res.status(503).json({
      success: false,
      code: msg,
      error: KNOWN[msg] ?? sanitizeErrorForClient(err),
    });
    return;
  }
  if (KNOWN[msg]) {
    res.status(status).json({ success: false, code: msg, error: KNOWN[msg] });
    return;
  }
  res.status(status).json({ success: false, error: sanitizeErrorForClient(err) });
}
