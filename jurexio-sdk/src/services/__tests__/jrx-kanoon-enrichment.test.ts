/**
 * NV-KANOON-ENRICH-001 — optional enrichment tests.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { CnrResolveData } from '../../../packages/client-sdk/src/api/CnrApi.js';
import { enrichWithKanoonCandidates, isKanoonEnrichEnabled } from '../jrx-kanoon-enrichment.js';

const BASE: CnrResolveData = {
  cnr: 'TSWL000000742024',
  status: 'found',
  matchType: 'exact',
  source: 'nys_case_api',
  sourcesTried: ['nys_case_api'],
  confidence: 0.9,
  claimEcourts: false,
  validation: 'ok',
  ui: { badge: 'Suggested · Judgment corpus', subtitle: 'ok' },
  fields: {
    caseTitle: { value: 'State vs Accused', source: 'nys_case_api', confidence: 0.9 },
  },
  documents: [],
  candidates: [],
};

describe('./jrx-kanoon-enrichment', () => {
  const prevFlag = process.env.JRX_F_KANOON_ENRICH;
  const prevKey = process.env.INDIA_KANOON_API_KEY;

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.JRX_F_KANOON_ENRICH;
    else process.env.JRX_F_KANOON_ENRICH = prevFlag;
    if (prevKey === undefined) delete process.env.INDIA_KANOON_API_KEY;
    else process.env.INDIA_KANOON_API_KEY = prevKey;
  });

  it('defaults off without API key', () => {
    delete process.env.JRX_F_KANOON_ENRICH;
    delete process.env.INDIA_KANOON_API_KEY;
    expect(isKanoonEnrichEnabled()).toBe(false);
  });

  it('auto-enables when INDIA_KANOON_API_KEY is configured', () => {
    delete process.env.JRX_F_KANOON_ENRICH;
    process.env.INDIA_KANOON_API_KEY = 'test-token-len-32-chars-minimum-xx';
    expect(isKanoonEnrichEnabled()).toBe(true);
  });

  it('records attempted tag when key absent', async () => {
    process.env.JRX_F_KANOON_ENRICH = '1';
    delete process.env.INDIA_KANOON_API_KEY;
    const out = await enrichWithKanoonCandidates(BASE);
    expect(out.sourcesTried).toContain('indian_kanoon_attempted');
    expect(out.meta?.extra?.kanoonEnrich).toBe('not_configured');
  });

  it('merges mock search hits without live API (fetch stubbed)', async () => {
    process.env.JRX_F_KANOON_ENRICH = '1';
    process.env.INDIA_KANOON_API_KEY = 'test-token-len-32-chars-minimum-xx';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          docs: [{ tid: 123, title: 'State vs Accused', docsource: 'Supreme Court', publishdate: '2020-01-01' }],
        }),
      }),
    );
    const out = await enrichWithKanoonCandidates(BASE);
    expect(out.candidates.some((c) => c.source === 'indian_kanoon_enrichment')).toBe(true);
    expect(out.meta?.extra?.kanoonEnrich).toBe('candidates_added');
    vi.unstubAllGlobals();
  });
});
