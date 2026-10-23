import { validateJrxCanonicalEventName } from './jrx-module-registry-service.js';

export interface JrxLedgerIngestInput {
  eventName: string;
  tenantId: string;
  payload?: Record<string, unknown>;
  synthetic?: boolean;
}

export interface JrxLedgerIngestResult {
  accepted: boolean;
  code: string;
  message: string;
  ingestId?: string;
  critical?: boolean;
}

/** In-memory synthetic ingest log (Sprint 1 — replaced by M09 chain store). */
const syntheticIngestLog: { ingestId: string; eventName: string; tenantId: string; at: string }[] =
  [];

export function getSyntheticLedgerIngestCount(): number {
  return syntheticIngestLog.length;
}

export function ingestJrxLedgerEvent(input: JrxLedgerIngestInput): JrxLedgerIngestResult {
  const eventName = String(input.eventName ?? '').trim().toUpperCase();
  const tenantId = String(input.tenantId ?? '').trim();
  const synthetic = input.synthetic === true || tenantId.startsWith('syn-');

  if (!eventName || !tenantId) {
    return {
      accepted: false,
      code: 'LEDGER_INGEST_INVALID',
      message: 'eventName and tenantId are required',
    };
  }

  if (!synthetic) {
    return {
      accepted: false,
      code: 'LEDGER_REGION_STACK_REQUIRED',
      message:
        'Chairman C-07: real tenant ingest blocked until dual-region Ledger stacks exist; use synthetic:true or tenantId syn-*',
    };
  }

  const validation = validateJrxCanonicalEventName(eventName);
  if (!validation.valid) {
    return {
      accepted: false,
      code: validation.code,
      message: 'Event rejected at registry boundary (Ledger annex)',
    };
  }

  const ingestId = `syn-${Date.now()}-${syntheticIngestLog.length + 1}`;
  syntheticIngestLog.push({
    ingestId,
    eventName,
    tenantId,
    at: new Date().toISOString(),
  });

  return {
    accepted: true,
    code: 'LEDGER_SYNTHETIC_ACCEPTED',
    message: 'Event accepted on synthetic ingest path (Sprint 1 stub)',
    ingestId,
    critical: validation.event?.critical ?? false,
  };
}
