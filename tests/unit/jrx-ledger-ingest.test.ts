import { describe, expect, it } from 'vitest';
import {
  getSyntheticLedgerIngestCount,
  ingestJrxLedgerEvent,
} from '../../src/services/jrx-ledger-ingest-service.js';

describe('JRX ledger ingest (synthetic)', () => {
  it('rejects non-synthetic real tenant', () => {
    const r = ingestJrxLedgerEvent({
      eventName: 'MATTER.OPENED',
      tenantId: 'tenant-prod-1',
    });
    expect(r.accepted).toBe(false);
    expect(r.code).toBe('LEDGER_REGION_STACK_REQUIRED');
  });

  it('accepts canonical event on synthetic path', () => {
    const before = getSyntheticLedgerIngestCount();
    const r = ingestJrxLedgerEvent({
      eventName: 'MATTER.OPENED',
      tenantId: 'syn-tenant-1',
      synthetic: true,
    });
    expect(r.accepted).toBe(true);
    expect(r.code).toBe('LEDGER_SYNTHETIC_ACCEPTED');
    expect(getSyntheticLedgerIngestCount()).toBe(before + 1);
  });

  it('rejects unknown event name', () => {
    const r = ingestJrxLedgerEvent({
      eventName: 'NOT.A.REAL.EVENT',
      tenantId: 'syn-tenant-1',
      synthetic: true,
    });
    expect(r.accepted).toBe(false);
    expect(r.code).toBe('EVENT_NOT_IN_REGISTRY');
  });
});
