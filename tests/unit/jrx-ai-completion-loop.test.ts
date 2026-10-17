import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  buildPartnerCompletionEnvelope,
  parsePartnerContinuationInput,
} from '../../src/services/jrx-ai-completion-loop.js';

describe('./jrx-ai-completion-loop', () => {
  it('parses continueIncomplete + priorContent', () => {
    const req = {
      body: {
        options: {
          continueIncomplete: true,
          priorContent: 'PART ONE',
          segmentIndex: 1,
        },
      },
    } as unknown as Request;
    const parsed = parsePartnerContinuationInput(req);
    expect(parsed.active).toBe(true);
    expect(parsed.priorContent).toBe('PART ONE');
    expect(parsed.segmentIndex).toBe(1);
  });

  it('marks incomplete drafts with continuationAvailable when segments remain', () => {
    const content = 'IN THE HIGH COURT\n1. That the petitioner states\n';
    const env = buildPartnerCompletionEnvelope({
      content,
      taskType: 'legal-draft-fast',
      continuationCount: 0,
      segmentIndex: 0,
      requestId: 'req-1',
    });
    expect(env.status).toBe('incomplete');
    expect(env.continuationAvailable).toBe(true);
    expect(env.continueRequest?.options.continueIncomplete).toBe(true);
  });

  it('marks complete when prayer block present', () => {
    const content = [
      'IN THE HIGH COURT',
      '1. That the petitioner states facts in full.',
      'PRAYER',
      'a) Release the petitioner on bail;',
      'Place: Chennai',
      'Advocate for Petitioner',
      'VERIFICATION',
      'I verify that the contents are true.',
    ].join('\n');
    const env = buildPartnerCompletionEnvelope({
      content,
      taskType: 'legal-draft-fast',
      continuationCount: 0,
      segmentIndex: 0,
      requestId: 'req-2',
    });
    expect(env.status).toBe('complete');
    expect(env.continuationAvailable).toBe(false);
  });
});
