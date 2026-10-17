import { describe, expect, it } from 'vitest';
import { wrapPartnerRunCompletedSseEvent } from '../../src/orchestration/jrx-partner-run-completed-sse.js';

describe('NV-NSP-SSE-FILING-MIRROR-001', () => {
  it('mirrors filing fields on run_completed event root', () => {
    const result = {
      content: 'PRAYER\nVERIFICATION',
      draftProfile: { templateKey: 'civil_caveat' },
      validationResults: [{ id: 'structure.prayer', status: 'pass' }],
      formattedBlocks: [{ id: 'enclosures' }],
      draftQuality: { reviewRecommended: false },
      traceId: 'run-1',
    };
    const evt = wrapPartnerRunCompletedSseEvent({
      runId: 'run-1',
      timestamp: '2026-09-21T00:00:00.000Z',
      result,
    });
    expect(evt.type).toBe('run_completed');
    expect(evt.result).toBe(result);
    expect(evt.validationResults).toEqual(result.validationResults);
    expect(evt.draftProfile).toEqual(result.draftProfile);
    expect(evt.formattedBlocks).toEqual(result.formattedBlocks);
    expect(evt.draftQuality).toEqual(result.draftQuality);
  });

  it('mirrors completion fields on run_completed event root (NV-NSP-STREAM-META-002)', () => {
    const result = {
      content: 'IN THE COURT\n1. Facts\n',
      completionStatus: 'incomplete',
      continuationAvailable: true,
      completion: {
        status: 'incomplete',
        continuationAvailable: true,
        continuationCount: 0,
        continueRequest: { options: { continueIncomplete: true, segmentIndex: 1 } },
      },
      draftQuality: { completionStatus: 'incomplete', continuationAvailable: true },
    };
    const evt = wrapPartnerRunCompletedSseEvent({
      runId: 'run-c',
      timestamp: '2026-10-09T00:00:00.000Z',
      result,
    });
    expect(evt.completionStatus).toBe('incomplete');
    expect(evt.continuationAvailable).toBe(true);
    expect(evt.completion).toEqual(result.completion);
  });

  it('omits mirror keys when absent on result', () => {
    const result = { content: 'hello', traceId: 'run-2' };
    const evt = wrapPartnerRunCompletedSseEvent({
      runId: 'run-2',
      timestamp: '2026-09-21T00:00:00.000Z',
      result,
    });
    expect(evt.validationResults).toBeUndefined();
    expect(evt.draftProfile).toBeUndefined();
  });
});
