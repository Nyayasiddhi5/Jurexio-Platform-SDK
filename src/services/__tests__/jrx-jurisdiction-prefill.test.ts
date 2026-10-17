/**
 * Unit tests — NV-CASE-MASTER-DATA-001 jurisdiction master prefill.
 * Uses an in-memory provider (no DB) so the pure resolve algorithm and the
 * envelope wiring are exercised deterministically.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePrefill,
  applyJurisdictionPrefill,
  PREFILL_SOURCE,
  type JurisdictionMasterProvider,
  type CnrPrefixRuleRow,
  type CourtJurisdictionRow,
  type DistrictRow,
} from '../jrx-jurisdiction-prefill.js';
import type { CnrResolveData, CnrFieldValue } from '../../../packages/client-sdk/src/api/CnrApi.js';

const PREFIX_RULES: Record<string, CnrPrefixRuleRow> = {
  APHC: {
    cnrPrefix: 'APHC',
    stateCode: 'AP',
    courtTier: 'HC',
    courtType: 'HC',
    benchCode: 'aphc',
    establishment: 'High Court of Andhra Pradesh',
  },
  TSWL: {
    cnrPrefix: 'TSWL',
    stateCode: 'TS',
    courtTier: 'WL',
    courtType: 'DC',
    benchCode: null,
    establishment: null,
  },
};

const JURISDICTIONS: Record<string, CourtJurisdictionRow> = {
  aphc: {
    benchCode: 'aphc',
    courtName: 'High Court of Andhra Pradesh',
    courtType: 'HC',
    stateName: 'Andhra Pradesh',
  },
};

const DISTRICTS: Record<string, DistrictRow> = {
  'TS|WL': {
    stateCode: 'TS',
    districtCode: 'WL',
    districtName: 'Warangal',
    defaultComplex: 'District & Sessions Court, Warangal',
  },
};

const CASE_TYPES: Record<string, string> = {
  'CRLP|HC|': 'Criminal Petition',
};

const provider: JurisdictionMasterProvider = {
  async getPrefixRule(prefix) {
    return PREFIX_RULES[prefix] ?? null;
  },
  async getJurisdiction(benchCode) {
    return JURISDICTIONS[benchCode] ?? null;
  },
  async getDistrict(stateCode, districtCode) {
    return DISTRICTS[`${stateCode}|${districtCode}`] ?? null;
  },
  async getCaseTypeDisplay(code, courtType, stateCode) {
    // Prefer a state-specific row, then the state-agnostic ('') row (mirrors DB).
    return (
      CASE_TYPES[`${code}|${courtType}|${stateCode}`] ??
      CASE_TYPES[`${code}|${courtType}|`] ??
      null
    );
  },
};

function fv(value: unknown): CnrFieldValue {
  return { value, source: value ? 'nys_case_api' : null, confidence: value ? 0.9 : 0 };
}

describe('resolvePrefill (Appendix F.3)', () => {
  it('fills courtType/stateName/courtName for an HC CNR with empty fields', async () => {
    const out = await resolvePrefill(
      { cnr: 'APHC010000832023', courtType: null, stateName: null, courtName: null },
      provider,
    );
    expect(out.courtType).toBe('hc');
    expect(out.stateName).toBe('Andhra Pradesh');
    expect(out.courtName).toBe('High Court of Andhra Pradesh');
    expect(out.filledKeys.sort()).toEqual(['courtName', 'courtType', 'stateName']);
  });

  it('never overwrites non-empty corpus values', async () => {
    const out = await resolvePrefill(
      {
        cnr: 'APHC010000832023',
        courtType: 'hc',
        stateName: 'ANDHRAPRADESH',
        courtName: 'High Court of Andhra Pradesh',
      },
      provider,
    );
    expect(out.filledKeys).toEqual([]);
  });

  it('resolves courtName from bench code when only bench is present', async () => {
    const out = await resolvePrefill(
      { cnr: 'ZZZZ999999992023', bench: 'aphc', courtName: null, stateName: null },
      provider,
    );
    expect(out.courtName).toBe('High Court of Andhra Pradesh');
    expect(out.stateName).toBe('Andhra Pradesh');
  });

  it('fills district + complex for a DC CNR (TSWL…)', async () => {
    const out = await resolvePrefill(
      { cnr: 'TSWL000000742024', districtName: null, complexName: null },
      provider,
    );
    expect(out.courtType).toBe('dc');
    expect(out.districtName).toBe('Warangal');
    expect(out.complexName).toBe('District & Sessions Court, Warangal');
  });

  it('computes caseTypeDisplay (P1) from code + tier', async () => {
    const out = await resolvePrefill(
      { cnr: 'APHC010000832023', caseType: 'CRLP' },
      provider,
    );
    expect(out.caseTypeDisplay).toBe('Criminal Petition');
  });

  it('is a no-op for an unknown prefix', async () => {
    const out = await resolvePrefill({ cnr: 'ZZZZ000000002020' }, provider);
    expect(out.filledKeys).toEqual([]);
  });
});

describe('applyJurisdictionPrefill', () => {
  function foundEnvelope(fields: Record<string, CnrFieldValue>): CnrResolveData {
    return {
      cnr: 'APHC010000832023',
      status: 'found',
      matchType: 'exact',
      source: 'nys_case_api',
      sourcesTried: ['nys_case_api'],
      confidence: 0.97,
      claimEcourts: false,
      validation: 'ok',
      ui: { badge: 'x', subtitle: 'y' },
      fields,
      documents: [],
      candidates: [],
    } as unknown as CnrResolveData;
  }

  it('tags prefilled fields with source nyv_master and records sourcesTried', async () => {
    const data = foundEnvelope({
      courtType: fv(null),
      courtName: fv(null),
      stateName: fv(null),
      caseType: fv('CRLP'),
    });
    const out = await applyJurisdictionPrefill(data, 'APHC010000832023', provider);
    expect(out.fields?.stateName?.value).toBe('Andhra Pradesh');
    expect(out.fields?.stateName?.source).toBe(PREFILL_SOURCE);
    expect(out.fields?.courtType?.value).toBe('hc');
    expect(out.sourcesTried).toContain(PREFILL_SOURCE);
    // claimEcourts must stay false — reference join, not live registry.
    expect(out.claimEcourts).toBe(false);
  });

  it('does not overwrite a corpus-published courtName', async () => {
    const data = foundEnvelope({
      courtName: fv('High Court of Andhra Pradesh'),
      stateName: fv(null),
    });
    const out = await applyJurisdictionPrefill(data, 'APHC010000832023', provider);
    expect(out.fields?.courtName?.source).toBe('nys_case_api');
    expect(out.fields?.stateName?.source).toBe(PREFILL_SOURCE);
  });

  it('no-ops for a not_found envelope', async () => {
    const data = { ...foundEnvelope({}), status: 'not_found', fields: null } as unknown as CnrResolveData;
    const out = await applyJurisdictionPrefill(data, 'APHC010000832023', provider);
    expect(out).toBe(data);
  });
});
