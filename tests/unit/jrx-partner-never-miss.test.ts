/**
 * NV-QUEEN-NEVER-MISS-001 — partner empty-content guard tests.
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  buildPartnerNeverMissReply,
  ensurePartnerNeverMissContent,
} from '../../src/utils/jrx-partner-platform.js';

function nspRequest(body: Record<string, unknown> = {}): Request {
  return {
    body,
    headers: {},
    sdkContext: { platformUatLabel: 'NSP', appName: 'NSP' },
  } as unknown as Request;
}

describe('NV-QUEEN-NEVER-MISS-001 partner empty guard', () => {
  it('buildPartnerNeverMissReply includes prompt focus', () => {
    const out = buildPartnerNeverMissReply('Draft bail for FIR 42/2026');
    expect(out).toContain('Request focus: Draft bail for FIR 42/2026');
    expect(out.length).toBeGreaterThan(80);
  });

  it('ensurePartnerNeverMissContent leaves non-empty content unchanged', () => {
    const req = nspRequest({ taskType: 'legal-draft-fast' });
    expect(ensurePartnerNeverMissContent('Existing draft body', 'prompt', req)).toBe('Existing draft body');
  });

  it('ensurePartnerNeverMissContent injects for NSP when content empty', () => {
    const req = nspRequest({ taskType: 'legal-draft-fast' });
    const out = ensurePartnerNeverMissContent('', 'Draft bail application', req);
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain('Request focus: Draft bail application');
  });

  it('ensurePartnerNeverMissContent does not inject for non-ecosystem callers', () => {
    const req = { body: { taskType: 'legal-draft-fast' }, headers: {} } as Request;
    expect(ensurePartnerNeverMissContent('', 'Draft bail', req)).toBe('');
  });
});
