/**
 * NV-CNR-UNIFIED-CASCADE-001 — cascade merge + tier orchestration unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CnrResolveData } from '../../../packages/client-sdk/src/api/CnrApi.js';
import {
  annotateLegacyCascadeHit,
  CASCADE_ID,
  isCnrUnifiedCascadeEnabled,
  isEcourtsLiveFetchEnabled,
  mergeNotFoundCascade,
  resolveCnrViaUnifiedCascade,
  unionSourcesTried,
} from '../jrx-cnr-unified-cascade.js';
import { mapCaseApiNotFound } from '../jrx-case-api-adapter.js';

const NOT_FOUND: CnrResolveData = mapCaseApiNotFound('TSWL000000999999', 42);

const LEGACY_FOUND: CnrResolveData = {
  cnr: 'TSWL000000999999',
  status: 'found',
  matchType: 'exact',
  source: 'nys_rds',
  sourcesTried: ['nys_rds', 'opendata_athena_case_details'],
  confidence: 0.9,
  claimEcourts: false,
  validation: 'ok',
  ui: { badge: 'Suggested · Judgment corpus', subtitle: 'From legacy cascade' },
  fields: {
    courtName: { value: 'District Court', source: 'nys_rds', confidence: 0.9 },
    hearings: {
      value: [{ date: '2024-01-01', purpose: 'Listed', judge: null, status: null, source: 'nys_rds', confidence: 0.8 }],
      source: 'nys_rds',
      confidence: 0.8,
    },
  },
  documents: [],
  candidates: [],
};

describe('./jrx-cnr-unified-cascade', () => {
  describe('unionSourcesTried', () => {
    it('dedupes tier tags in order', () => {
      expect(
        unionSourcesTried(['nys_case_api'], ['nys_rds', 'nys_case_api'], ['opendata_athena_case_details']),
      ).toEqual(['nys_case_api', 'nys_rds', 'opendata_athena_case_details']);
    });
  });

  describe('annotateLegacyCascadeHit', () => {
    it('preserves legacy payload and unions sourcesTried', () => {
      const merged = annotateLegacyCascadeHit(NOT_FOUND, LEGACY_FOUND);
      expect(merged.status).toBe('found');
      expect(merged.source).toBe('nys_rds');
      expect(merged.claimEcourts).toBe(false);
      expect(merged.sourcesTried).toEqual([
        'nys_case_api',
        'nys_rds',
        'opendata_athena_case_details',
      ]);
      expect(merged.meta?.extra?.cascade).toBe(CASCADE_ID);
      expect(merged.meta?.extra?.caseApiAttemptStatus).toBe('not_found');
    });
  });

  describe('mergeNotFoundCascade', () => {
    it('unions sourcesTried when both tiers miss', () => {
      const legacyMiss: CnrResolveData = {
        ...NOT_FOUND,
        sourcesTried: ['nys_rds', 'opendata_athena_case_details'],
      };
      const merged = mergeNotFoundCascade(NOT_FOUND, legacyMiss);
      expect(merged.status).toBe('not_found');
      expect(merged.sourcesTried).toEqual([
        'nys_case_api',
        'nys_rds',
        'opendata_athena_case_details',
      ]);
      expect(merged.claimEcourts).toBe(false);
      expect(String(merged.ui.subtitle)).toContain('indexed records');
    });
  });

  describe('feature flags', () => {
    const prevCascade = process.env.JRX_F_CNR_UNIFIED_CASCADE;
    const prevCaseApi = process.env.JRX_F_CASE_API_CNR;
    const prevEcourts = process.env.JRX_F_ECOURTS_LIVE_FETCH;

    afterEach(() => {
      if (prevCascade === undefined) delete process.env.JRX_F_CNR_UNIFIED_CASCADE;
      else process.env.JRX_F_CNR_UNIFIED_CASCADE = prevCascade;
      if (prevCaseApi === undefined) delete process.env.JRX_F_CASE_API_CNR;
      else process.env.JRX_F_CASE_API_CNR = prevCaseApi;
      if (prevEcourts === undefined) delete process.env.JRX_F_ECOURTS_LIVE_FETCH;
      else process.env.JRX_F_ECOURTS_LIVE_FETCH = prevEcourts;
    });

    it('defaults unified cascade on when case-api enabled', () => {
      delete process.env.JRX_F_CNR_UNIFIED_CASCADE;
      process.env.JRX_F_CASE_API_CNR = '1';
      expect(isCnrUnifiedCascadeEnabled()).toBe(true);
    });

    it('opts out with JRX_F_CNR_UNIFIED_CASCADE=0', () => {
      process.env.JRX_F_CASE_API_CNR = '1';
      process.env.JRX_F_CNR_UNIFIED_CASCADE = '0';
      expect(isCnrUnifiedCascadeEnabled()).toBe(false);
    });

    it('eCourts live fetch defaults off', () => {
      delete process.env.JRX_F_ECOURTS_LIVE_FETCH;
      expect(isEcourtsLiveFetchEnabled()).toBe(false);
    });
  });

  describe('resolveCnrViaUnifiedCascade', () => {
    const prevCaseApiKey = process.env.NYS_CASE_API_KEY;
    const prevCaseApiUrl = process.env.NYS_CASE_API_BASE_URL;
    const prevCaseApiFlag = process.env.JRX_F_CASE_API_CNR;
    const prevCascade = process.env.JRX_F_CNR_UNIFIED_CASCADE;
    const prevNysUrl = process.env.NYS_KNOWLEDGE_BASE_URL;

    beforeEach(() => {
      process.env.NYS_CASE_API_KEY = 'test-key-len-32-chars-minimum-xx';
      process.env.NYS_CASE_API_BASE_URL = 'https://nysapi.test';
      process.env.JRX_F_CASE_API_CNR = '1';
      process.env.JRX_F_CNR_UNIFIED_CASCADE = '1';
      process.env.NYS_KNOWLEDGE_BASE_URL = 'https://nys.test';
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
      if (prevCascade === undefined) delete process.env.JRX_F_CNR_UNIFIED_CASCADE;
      else process.env.JRX_F_CNR_UNIFIED_CASCADE = prevCascade;
      if (prevNysUrl === undefined) delete process.env.NYS_KNOWLEDGE_BASE_URL;
      else process.env.NYS_KNOWLEDGE_BASE_URL = prevNysUrl;
    });

    it('cascades to legacy when case-api returns not_found', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          const u = String(url);
          if (u.includes('nysapi.test')) {
            return {
              ok: false,
              status: 404,
              text: async () => JSON.stringify({ error: 'not_found' }),
            };
          }
          if (u.includes('nys.test/cnr/resolve')) {
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ success: true, data: LEGACY_FOUND }),
            };
          }
          return { ok: false, status: 404, text: async () => '{}' };
        }),
      );

      const res = await resolveCnrViaUnifiedCascade({ cnr: 'TSWL000000999999' });
      expect(res.kind).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.data.status).toBe('found');
        expect(res.data.sourcesTried).toContain('nys_case_api');
        expect(res.data.sourcesTried).toContain('opendata_athena_case_details');
        expect(res.data.claimEcourts).toBe(false);
      }
    });
  });
});
