/**
 * NV-CASE-CORPUS-FIELD-GAP-CLOSURE-001 — unit tests for the 2026-09-25 gap closure:
 * linkedMatters (Group 12), incidentDate (Group 11), DC numeric status decode,
 * DC establishment crosswalk prefill, and the machine-readable NSP parse contract.
 */
import { describe, it, expect } from 'vitest';
import {
  mapCaseApiToCnrResolveData,
  normalizeLinkedMatters,
  extractIncidentDate,
} from '../jrx-case-api-adapter.js';
import type { CaseApiCase } from '../jrx-case-api-adapter.js';
import {
  decodeDcCaseStatus,
  isNumericDcStatus,
  DC_STATUS_DECODE_PENDING_NOTE,
} from '../jrx-dc-status-codes.js';
import {
  NSP_RESOLVE_PARSE_CONTRACT,
  buildNspParseGuide,
} from '../jrx-nsp-parse-contract.js';
import {
  resolvePrefill,
  type JurisdictionMasterProvider,
} from '../jrx-jurisdiction-prefill.js';

const DC_ROW: CaseApiCase = {
  cnr: 'TSWL000000742024',
  court_level: 'DC',
  jurisdiction: 'IND',
  case_type: 'CS',
  petitioner: 'Jannu Upendra',
  respondent: 'Nandi Vijayalaxmi',
};

describe('Group 12 — linkedMatters', () => {
  it('normalizeLinkedMatters maps object rows and dedupes', () => {
    const rows = normalizeLinkedMatters(
      [
        { cnr: 'TSWL000000752024', relation: 'connected', case_no: '75/2024' },
        { case_number: '76/2024', title: 'Related Suit', link_type: 'clubbed' },
        { cnr: 'TSWL000000752024', relation: 'connected' }, // dup by cnr+caseNumber
      ],
      'nys_case_api_rds',
    );
    expect(rows.length).toBe(3);
    expect(rows[0]?.cnr).toBe('TSWL000000752024');
    expect(rows[0]?.relation).toBe('connected');
    expect(rows[1]?.title).toBe('Related Suit');
    expect(rows[1]?.relation).toBe('clubbed');
  });

  it('normalizeLinkedMatters parses a JSON string column', () => {
    const rows = normalizeLinkedMatters(
      JSON.stringify([{ cnr: 'APHC010000842023', relation: 'analogous' }]),
      'nys_rds',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relation).toBe('analogous');
  });

  it('mapCaseApiToCnrResolveData emits linkedMatters from linked_cases', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: { ...DC_ROW, linked_cases: [{ cnr: 'TSWL000000752024', relation: 'connected' }] },
      latencyMs: 10,
    });
    const linked = data.fields?.linkedMatters?.value as Array<{ cnr: string | null }>;
    expect(Array.isArray(linked)).toBe(true);
    expect(linked[0]?.cnr).toBe('TSWL000000752024');
  });

  it('linkedMatters is an empty array with honest note when none published', () => {
    const data = mapCaseApiToCnrResolveData({ cnr: 'TSWL000000742024', caseRow: DC_ROW, latencyMs: 10 });
    expect(data.fields?.linkedMatters?.value).toEqual([]);
    expect(data.fields?.linkedMatters?.note).toMatch(/no linked/i);
  });
});

describe('Group 11 — incidentDate (honest null)', () => {
  it('is null with an honest note when corpus has no incident date', () => {
    const data = mapCaseApiToCnrResolveData({ cnr: 'TSWL000000742024', caseRow: DC_ROW, latencyMs: 10 });
    expect(data.fields?.incidentDate?.value).toBeNull();
    expect(data.fields?.incidentDate?.note).toMatch(/not published/i);
  });

  it('maps date_of_incident / incident_date when upstream publishes it', () => {
    expect(extractIncidentDate({ ...DC_ROW, date_of_incident: '2023-05-01' })).toBe('2023-05-01');
    expect(extractIncidentDate({ ...DC_ROW, incident_date: '01-05-2023' })).toBe('2023-05-01');
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: { ...DC_ROW, occurrence_date: '2023-05-02' },
      latencyMs: 10,
    });
    expect(data.fields?.incidentDate?.value).toBe('2023-05-02');
  });
});

describe('NV-DC-STATUS-DECODE-001 — DC numeric status decode', () => {
  it('isNumericDcStatus detects bare integer codes', () => {
    expect(isNumericDcStatus('572')).toBe(true);
    expect(isNumericDcStatus('PENDING')).toBe(false);
  });

  it('numeric code with no master → undecoded + raw value kept', () => {
    const decoded = decodeDcCaseStatus('572');
    expect(decoded?.numericUndecoded).toBe(true);
    expect(decoded?.label).toBe('572');
    expect(decoded?.category).toBe('unknown');
  });

  it('numeric code decodes when a master map provides it', () => {
    const master = new Map([['572', { label: 'Disposed', category: 'disposed' as const }]]);
    const decoded = decodeDcCaseStatus('572', master);
    expect(decoded?.label).toBe('Disposed');
    expect(decoded?.numericUndecoded).toBe(false);
  });

  it('text labels categorise via verifiable buckets', () => {
    expect(decodeDcCaseStatus('WITHDRAWN')?.category).toBe('disposed');
    expect(decodeDcCaseStatus('Pending for evidence')?.category).toBe('pending');
    expect(decodeDcCaseStatus('ADMITTED')?.label).toBe('Admitted');
    expect(decodeDcCaseStatus('LOK_ADALAT')?.category).toBe('disposed');
  });

  it('adapter keeps raw numeric DC status + attaches pending-decode note', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: { ...DC_ROW, case_status: '572' },
      latencyMs: 10,
    });
    expect(data.fields?.caseStatus?.value).toBe('572');
    expect(data.fields?.caseStatus?.note).toBe(DC_STATUS_DECODE_PENDING_NOTE);
  });

  it('adapter decodes DC text status into a normalized label', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: { ...DC_ROW, case_status: 'CASE WITHDRAWN BY PETITIONER' },
      latencyMs: 10,
    });
    expect(data.fields?.caseStatus?.value).toBe('Withdrawn');
    expect(data.fields?.caseStatus?.note).toMatch(/decoded from corpus status/i);
  });

  it('HC numeric-looking status is NOT decoded (DC-only)', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'APHC010000832023',
      caseRow: { cnr: 'APHC010000832023', court_level: 'HC', case_status: 'WITHDRAWN' },
      latencyMs: 10,
    });
    expect(data.fields?.caseStatus?.value).toBe('WITHDRAWN');
  });
});

describe('NV-DC-ESTAB-CROSSWALK-001 — prefill sets courtCode/complexCode', () => {
  const provider: JurisdictionMasterProvider = {
    async getPrefixRule(prefix) {
      if (prefix === 'TSWL') {
        return {
          cnrPrefix: 'TSWL',
          stateCode: 'TS',
          courtTier: 'WL',
          courtType: 'DC',
          benchCode: null,
          establishment: null,
        };
      }
      return null;
    },
    async getJurisdiction() {
      return null;
    },
    async getDistrict(stateCode, districtCode) {
      if (stateCode === 'TS' && districtCode === 'WL') {
        return {
          stateCode: 'TS',
          districtCode: 'WL',
          districtName: 'Warangal',
          defaultComplex: 'District & Sessions Court, Warangal',
        };
      }
      return null;
    },
    async getCaseTypeDisplay() {
      return null;
    },
    async getEstablishmentCrosswalk(stateLetters, estabLetters) {
      if (stateLetters === 'TS' && estabLetters === 'WL') {
        return {
          stateLetters: 'TS',
          estabLetters: 'WL',
          stateCode: '29',
          districtCode: '2',
          complexCode: '1290002',
          courtCode: '1290002',
          stateName: 'Telangana',
          districtName: 'Warangal',
          complexName: 'District & Sessions Court, Warangal',
        };
      }
      return null;
    },
  };

  it('fills courtCode + complexCode from the crosswalk for a DC CNR', async () => {
    const out = await resolvePrefill({ cnr: 'TSWL000000742024' }, provider);
    expect(out.courtType).toBe('dc');
    expect(out.districtName).toBe('Warangal');
    expect(out.courtCode).toBe('1290002');
    expect(out.complexCode).toBe('1290002');
    expect(out.filledKeys).toContain('courtCode');
    expect(out.filledKeys).toContain('complexCode');
  });
});

describe('NV-NSP-PARSE-CONTRACT-001 — parse contract', () => {
  it('covers the new gap-closure fields with absentWhen semantics', () => {
    for (const key of ['linkedMatters', 'incidentDate', 'courtCode', 'complexCode', 'caseStatus']) {
      const entry = NSP_RESOLVE_PARSE_CONTRACT[key];
      expect(entry, `contract missing ${key}`).toBeTruthy();
      expect(entry!.path).toContain(`data.fields.${key}.value`);
      expect(entry!.absentWhen.length).toBeGreaterThan(0);
    }
    expect(NSP_RESOLVE_PARSE_CONTRACT.incidentDate!.absentWhen).toContain('not_in_corpus');
    expect(NSP_RESOLVE_PARSE_CONTRACT.nextHearingDate!.absentWhen).toContain('tier3_required');
    expect(NSP_RESOLVE_PARSE_CONTRACT.partyDetails!.absentWhen).toContain('manual_required');
    expect(NSP_RESOLVE_PARSE_CONTRACT.caseCategory!.absentWhen).toContain('not_applicable');
  });

  it('every entry has type + cardinality + parseHint', () => {
    for (const [key, entry] of Object.entries(NSP_RESOLVE_PARSE_CONTRACT)) {
      expect(entry.type, key).toBeTruthy();
      expect(entry.cardinality, key).toBeTruthy();
      expect(entry.parseHint.length, key).toBeGreaterThan(0);
    }
  });

  it('mapCaseApiToCnrResolveData attaches nspParseGuide when requested', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: DC_ROW,
      latencyMs: 10,
      includeParseGuide: true,
    });
    expect(data.nspParseGuide).toBeTruthy();
    expect(data.nspParseGuide?.linkedMatters?.cardinality).toBe('many');
    // Default (no flag) stays lean.
    const lean = mapCaseApiToCnrResolveData({ cnr: 'TSWL000000742024', caseRow: DC_ROW, latencyMs: 10 });
    expect(lean.nspParseGuide).toBeUndefined();
  });

  it('buildNspParseGuide returns the full contract', () => {
    expect(Object.keys(buildNspParseGuide()).length).toBe(
      Object.keys(NSP_RESOLVE_PARSE_CONTRACT).length,
    );
  });
});
