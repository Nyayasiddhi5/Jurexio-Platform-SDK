/**
 * NV-CNR-DOCUMENT-BUNDLE-001 — unit tests for document bundle builder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CnrDocument, CnrResolveData } from '../../../packages/client-sdk/src/api/CnrApi.js';
import { fetchCnrDocumentBundle } from '../jrx-cnr-document-bundle.js';

const JUDGMENT: CnrDocument = {
  id: 'j1',
  kind: 'judgment',
  title: 'State vs Accused',
  url: 'https://example.com/j.pdf',
  pdfUrlKind: 'presigned',
  expiresIn: 300,
};

const ORDER: CnrDocument = {
  id: 'o1',
  kind: 'order',
  title: 'Interim order',
  url: 'https://example.com/o.pdf',
  pdfUrlKind: 'presigned',
  expiresIn: 900,
};

const FOUND: CnrResolveData = {
  cnr: 'TSWL000000742024',
  status: 'found',
  matchType: 'exact',
  source: 'nys_case_api',
  sourcesTried: ['nys_case_api'],
  confidence: 0.95,
  claimEcourts: false,
  validation: 'ok',
  ui: { badge: 'Suggested · Judgment corpus', subtitle: 'ok' },
  fields: null,
  documents: [JUDGMENT, ORDER],
  candidates: [],
  meta: { latencyMs: 42, source: 'nys-case-api' },
};

describe('./jrx-cnr-document-bundle', () => {
  const prevCaseApiKey = process.env.NYS_CASE_API_KEY;
  const prevCaseApiUrl = process.env.NYS_CASE_API_BASE_URL;
  const prevCaseApiFlag = process.env.JRX_F_CASE_API_CNR;

  beforeEach(() => {
    process.env.NYS_CASE_API_KEY = 'test-key-len-32-chars-minimum-xx';
    process.env.NYS_CASE_API_BASE_URL = 'https://nysapi.test';
    process.env.JRX_F_CASE_API_CNR = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (prevCaseApiKey === undefined) delete process.env.NYS_CASE_API_KEY;
    else process.env.NYS_CASE_API_KEY = prevCaseApiKey;
    if (prevCaseApiUrl === undefined) delete process.env.NYS_CASE_API_BASE_URL;
    else process.env.NYS_CASE_API_BASE_URL = prevCaseApiUrl;
    if (prevCaseApiFlag === undefined) delete process.env.JRX_F_CASE_API_CNR;
    else process.env.JRX_F_CASE_API_CNR = prevCaseApiFlag;
  });

  it('returns judgment + orders split from case-api lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('nysapi.test/v1/cases/TSWL000000742024') && !u.includes('/timeline')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                case: {
                  cnr: 'TSWL000000742024',
                  court_level: 'DC',
                  case_title: 'State vs Accused',
                  document: { url: JUDGMENT.url },
                },
              }),
          };
        }
        if (u.includes('/timeline')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                events: [
                  {
                    event_date: '2024-06-01',
                    purpose: 'Listed',
                    doc_url: ORDER.url,
                  },
                ],
              }),
          };
        }
        return { ok: false, status: 404, text: async () => '{}' };
      }),
    );

    const result = await fetchCnrDocumentBundle({
      cnr: 'TSWL000000742024',
      includeTimelineOrders: true,
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.bundle.cnr).toBe('TSWL000000742024');
      expect(result.bundle.claimEcourts).toBe(false);
      expect(result.bundle.judgment?.kind).toBe('judgment');
      expect(result.bundle.meta.includeTimelineOrders).toBe(true);
      expect(result.bundle.meta.refreshedAt).toBeTruthy();
    }
  });
});
