import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  sanitizeCnrEnvelopeForPartner,
  sanitizeCnrHttpJsonForPartner,
} from '../jrx-cnr-partner-sanitize.js';

function nspReq(): Request {
  return { headers: { 'x-nyv-platform': 'NSP' } } as Request;
}

function consoleReq(): Request {
  return { headers: {} } as Request;
}

describe('./jrx-cnr-partner-sanitize', () => {
  it('strips sourcesTried and cascade meta for NSP', () => {
    const raw = {
      cnr: 'TSWL000000742024',
      status: 'found' as const,
      matchType: 'exact' as const,
      source: 'nys_case_api',
      sourcesTried: ['nys_case_api', 'nys_rds'],
      confidence: 0.9,
      claimEcourts: false as const,
      validation: 'ok' as const,
      ui: { badge: 'x', subtitle: 'y' },
      fields: {},
      documents: [],
      candidates: [],
      meta: {
        tier: 'case_api',
        latencyMs: 42,
        fieldAvailability: { acts: 'partial' },
        extra: { cascade: './jrx-cnr-unified-cascade-001' },
        ecourtsLiveAttempt: 'skipped',
      },
    };
    const sanitized = sanitizeCnrEnvelopeForPartner(raw);
    expect(sanitized.sourcesTried).toBeUndefined();
    expect(sanitized.meta?.fieldAvailability).toEqual({ acts: 'partial' });
    expect(sanitized.meta?.latencyMs).toBe(42);
    expect(sanitized.meta?.tier).toBeUndefined();
    expect(sanitized.meta?.extra).toBeUndefined();
  });

  it('leaves envelope unchanged for non-partner requests', () => {
    const payload = {
      success: true,
      sourcesTried: ['nys_case_api'],
      data: { cnr: 'X', sourcesTried: ['nys_case_api'] },
    };
    expect(sanitizeCnrHttpJsonForPartner(consoleReq(), payload)).toEqual(payload);
  });

  it('sanitizeCnrHttpJsonForPartner strips top-level sourcesTried for NSP', () => {
    const payload = {
      success: true,
      claimEcourts: false,
      sourcesTried: ['ecourts_portal_attempted'],
      data: {
        status: 'found',
        cnr: 'TSWL000000742024',
        sourcesTried: ['nys_case_api'],
        meta: { tier: 'internal' },
      },
    };
    const out = sanitizeCnrHttpJsonForPartner(nspReq(), payload as Record<string, unknown>);
    expect(out.sourcesTried).toBeUndefined();
    expect((out.data as Record<string, unknown>).sourcesTried).toBeUndefined();
    expect((out.data as { meta?: Record<string, unknown> }).meta?.tier).toBeUndefined();
  });
});
