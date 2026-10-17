/**
 * Unit tests — NYS case-api → NSP CNR resolve mapper (fixture JSON from handover).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  applyCorpusBetaHonestyEnvelope,
  applyTimelineEnrichment,
  buildCaseApiSearchForwardQuery,
  enrichCaseApiResolveData,
  extractActsFromCaseRow,
  extractFilingRef,
  fetchCaseByCnr,
  hearingRowDate,
  hearingsToTimeline,
  isCaseApiConfigured,
  isCaseApiLegacyEnrichEnabled,
  lookupCnrViaCaseApi,
  lookupDiaryViaCaseApi,
  extractCnrFromCaseRow,
  extractPartyPiiFromRow,
  buildPartyDetailsFromRow,
  isB9DuplicateRiskCnr,
  looksLikeIndianCnr,
  mapCaseApiDiaryToCnrResolveData,
  mapCaseApiSuggestedResolve,
  mapCaseApiToCnrResolveData,
  mapCaseApiNotFound,
  mergeActsSectionRows,
  mergeLegacyEnrichmentIntoResolveData,
  shouldAttemptLegacyCaseApiEnrichment,
  mergeTimelineEntries,
  needsCaseApiFieldEnrichment,
  normalizeActsSections,
  normalizeCnrInput,
  normalizeDiaryNumber,
  parseCaseApiCourtType,
  parseStringArray,
  shouldFallbackToLegacyCnr,
  shouldFallbackToLegacyDiary,
  timelineEventDate,
  timelineEventsToTimeline,
} from '../jrx-case-api-adapter.js';
import type { CaseApiCase } from '../jrx-case-api-adapter.js';
import { safetyPipeline } from '../safety-pipeline.js';
import { sanitizeCnrEnvelopeForPartner } from '../../utils/jrx-cnr-partner-sanitize.js';

const GJHC_FIXTURE: CaseApiCase = {
  cnr: 'GJHC240256342024',
  court_level: 'HC',
  jurisdiction: 'IND',
  case_title: null,
  case_number: '25634',
  case_type: 'CRMA',
  case_number_display: 'CRMA/25634/2024',
  court: 'High Court of Gujarat',
  state_name: 'Gujarat',
  petitioner: 'DHURABHAI MANILAL PATEL',
  respondent: 'JATINBHAI MANILAL PATEL AND ORS.',
  petitioner_advocate: 'ADV A',
  respondent_advocate: null,
  filing_date: '2024-01-15',
  decision_date: null,
  next_date: null,
  case_status: '39-RULE DISCHARGED AGAINST THE PETITIONER',
  disposal_nature: null,
  current_judge: 'HONOURABLE MR JUSTICE SAMPLE',
  hearings: [],
  field_availability: { case_title: 'not_published_by_source' },
  provenance: { backend: 'rds', elapsed_ms: 50.2, source_synced_at: null },
  counts: { hearings: 0, acts: 0 },
};

const TSWL_FIXTURE: CaseApiCase = {
  cnr: 'TSWL000000742024',
  court_level: 'DC',
  jurisdiction: 'IND',
  case_title: null,
  case_number: '742024',
  case_type: 'OS',
  case_number_display: 'OS/742024/2024',
  court: 'District Court',
  state_name: 'Telangana',
  petitioner: 'Jannu Upendra',
  respondent: 'Nandi Vijayalaxmi',
  filing_date: '2024-03-01',
  case_status: 'Pending',
  hearings: [
    { date: '2024-06-10', purpose: 'Evidence', judge: 'JMFC', status: 'Adjourned' },
    { date: '2024-07-15', purpose: 'Arguments', judge: 'JMFC', status: 'Listed' },
  ],
  provenance: { backend: 'rds', elapsed_ms: 180.2 },
  counts: { hearings: 17, acts: 1 },
};

describe('./jrx-case-api-adapter mapper', () => {
  it('maps GJHC fixture to found status with claimEcourts false', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: GJHC_FIXTURE,
      latencyMs: 50,
    });
    expect(data.status).toBe('found');
    expect(data.claimEcourts).toBe(false);
    expect(data.source).toBe('nys_case_api_rds');
    expect(data.meta?.tier).toBe('nys_case_api_rds');
    expect(data.meta?.source).toBe('nys-case-api');
    expect(data.meta?.fieldAvailability).toEqual({
      case_title: 'not_published_by_source',
    });
    expect(data.meta?.counts).toEqual({ hearings: 0, acts: 0 });
    expect(data.meta?.provenance?.backend).toBe('rds');
    expect(data.fields?.petitioner?.value).toContain('DHURABHAI');
    expect(data.fields?.courtType?.value).toBe('hc');
    expect(data.fields?.caseTitle?.note).toBe('not published by this court source');
  });

  it('maps hearings to timeline and caseCreate profile', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: TSWL_FIXTURE,
      latencyMs: 120,
      wantCaseCreate: true,
    });
    expect(data.status).toBe('found');
    expect(data.caseCreate?.timeline.length).toBe(2);
    expect(data.caseCreate?.clients[0]?.name).toBe('Jannu Upendra');
    expect(data.caseCreate?.fieldManifest.complete).toContain('cnr');
    expect(data.fields?.hearings?.value).toHaveLength(2);
  });

  it('hearingsToTimeline normalizes handover hearing rows', () => {
    const tl = hearingsToTimeline(TSWL_FIXTURE.hearings, 'nys_case_api_rds');
    expect(tl).toHaveLength(2);
    expect(tl[0]?.purpose).toBe('Evidence');
    expect(tl[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('hearingRowDate prefers hearing_date/business_date over next_date (NV-CNR-HEARING-DATE-001)', () => {
    expect(
      hearingRowDate({
        hearing_date: '2024-06-10',
        next_date: '2024-12-01',
        purpose: 'Listed',
      }),
    ).toBe('2024-06-10');
    expect(
      hearingRowDate({
        business_date: '15-07-2024',
        next_date: '2024-12-01',
      }),
    ).toBe('2024-07-15');
    const tl = hearingsToTimeline(
      [{ hearing_date: '2024-06-10', next_date: '2024-12-01', purpose: 'Evidence' }],
      'nys_case_api_rds',
    );
    expect(tl[0]?.date).toBe('2024-06-10');
  });

  it('timelineEventsToTimeline prefers event_date over legacy date keys', () => {
    expect(
      timelineEventDate({
        event_date: '2024-08-01',
        date: '2024-06-01',
        hearing_date: '2024-05-01',
      }),
    ).toBe('2024-08-01');
    const tl = timelineEventsToTimeline(
      [{ event_date: '2024-08-01', purpose_name: 'Order' }],
      'nys_case_api_rds_timeline',
    );
    expect(tl[0]?.date).toBe('2024-08-01');
  });

  it('maps APHC rich HC fields from nysapi row shape (NV-CNR-RICH-FIELDS-001)', () => {
    const aphcRow: CaseApiCase = {
      cnr: 'APHC010000832023',
      court_level: 'HC',
      case_number: '832023',
      case_type: 'WP',
      court: 'High Court of Andhra Pradesh',
      state_name: 'Andhra Pradesh',
      petitioner: 'PETITIONER ONE',
      respondent: 'STATE OF AP',
      bench_composition: [{ judge: 'Hon. Justice Sample' }],
      judicial_section: 'Writ Section',
      coram: 'Hon. Justice Sample',
      registration_number: '832023/2023',
      hc_category_details: { category: 'WP', sub_category: 'Service' },
      lower_court_reference: { court: 'District Court', case_no: '123/2022' },
      final_orders: [{ order_date: '2024-01-10', description: 'Disposed' }],
      hearings: [{ hearing_date: '2024-03-01', purpose: 'Admission', judge: 'J1' }],
      provenance: { backend: 'rds' },
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'APHC010000832023',
      caseRow: aphcRow,
      latencyMs: 80,
    });
    expect(data.status).toBe('found');
    expect(data.fields?.registrationNumber?.value).toBe('832023/2023');
    expect(data.fields?.judicialSection?.value).toBe('Writ Section');
    expect(data.fields?.coram?.value).toBe('Hon. Justice Sample');
    const bench = data.fields?.benchComposition?.value;
    expect(Array.isArray(bench)).toBe(true);
    expect((bench as unknown[]).length).toBe(1);
    const hearings = data.fields?.hearings?.value as Array<{ date: string | null }>;
    expect(hearings[0]?.date).toBe('2024-03-01');
    const sanitized = sanitizeCnrEnvelopeForPartner(data);
    expect(sanitized.fields?.benchComposition?.value).toBeTruthy();
    expect(sanitized).not.toHaveProperty('sourcesTried');
  });

  it('mapCaseApiNotFound preserves NSP not_found contract', () => {
    const data = mapCaseApiNotFound('ZZZZ000000000000', 110);
    expect(data.status).toBe('not_found');
    expect(data.claimEcourts).toBe(false);
    expect(data.fields).toBeNull();
    expect(data.sourcesTried).toContain('nys_case_api');
    expect(data.meta?.tier).toBeNull();
    expect(data.meta?.source).toBe('nys-case-api');
  });

  it('normalizeCnrInput strips separators and uppercases', () => {
    expect(normalizeCnrInput('gjhc-24025634-2024')).toBe('GJHC240256342024');
  });

  it('lookupCnrViaCaseApi returns fallback when unconfigured', async () => {
    const prevKey = process.env.NYS_CASE_API_KEY;
    delete process.env.NYS_CASE_API_KEY;
    const res = await lookupCnrViaCaseApi({ cnr: 'GJHC240256342024' });
    expect(res.kind).toBe('fallback');
    if (prevKey === undefined) delete process.env.NYS_CASE_API_KEY;
    else process.env.NYS_CASE_API_KEY = prevKey;
  });

  it('shouldFallbackToLegacyCnr on 404/401/429/504/503', () => {
    expect(shouldFallbackToLegacyCnr(404)).toBe(true);
    expect(shouldFallbackToLegacyCnr(401)).toBe(true);
    expect(shouldFallbackToLegacyCnr(429)).toBe(true);
    expect(shouldFallbackToLegacyCnr(504)).toBe(true);
    expect(shouldFallbackToLegacyCnr(503)).toBe(true);
    expect(shouldFallbackToLegacyCnr(200)).toBe(false);
  });

  it('shouldFallbackToLegacyDiary includes 400/422 for INSC diary shapes', () => {
    expect(shouldFallbackToLegacyDiary(400)).toBe(true);
    expect(shouldFallbackToLegacyDiary(422)).toBe(true);
    expect(shouldFallbackToLegacyDiary(404)).toBe(true);
    expect(shouldFallbackToLegacyDiary(502)).toBe(false);
  });

  it('isCaseApiConfigured false without key', () => {
    const prevUrl = process.env.NYS_CASE_API_BASE_URL;
    const prevKey = process.env.NYS_CASE_API_KEY;
    process.env.NYS_CASE_API_BASE_URL = 'https://nysapi.jurexio.example';
    delete process.env.NYS_CASE_API_KEY;
    expect(isCaseApiConfigured()).toBe(false);
    if (prevUrl === undefined) delete process.env.NYS_CASE_API_BASE_URL;
    else process.env.NYS_CASE_API_BASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.NYS_CASE_API_KEY;
    else process.env.NYS_CASE_API_KEY = prevKey;
  });

  it('fetchCaseByCnr returns 503 when unconfigured', async () => {
    const prevKey = process.env.NYS_CASE_API_KEY;
    delete process.env.NYS_CASE_API_KEY;
    const res = await fetchCaseByCnr('GJHC240256342024');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
    if (prevKey === undefined) delete process.env.NYS_CASE_API_KEY;
    else process.env.NYS_CASE_API_KEY = prevKey;
  });

  it('parseCaseApiCourtType maps sc|hc|dc hints', () => {
    expect(parseCaseApiCourtType('sc')).toBe('SC');
    expect(parseCaseApiCourtType('HC')).toBe('HC');
    expect(parseCaseApiCourtType('dc')).toBe('DC');
    expect(parseCaseApiCourtType('')).toBeUndefined();
  });

  describe('lookupDiaryViaCaseApi courtType default', () => {
    const prevCaseApiKey = process.env.NYS_CASE_API_KEY;
    const prevCaseApiUrl = process.env.NYS_CASE_API_BASE_URL;

    beforeEach(() => {
      process.env.NYS_CASE_API_KEY = 'test-key-len-32-chars-minimum-xx';
      process.env.NYS_CASE_API_BASE_URL = 'https://nysapi.test';
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      if (prevCaseApiKey === undefined) delete process.env.NYS_CASE_API_KEY;
      else process.env.NYS_CASE_API_KEY = prevCaseApiKey;
      if (prevCaseApiUrl === undefined) delete process.env.NYS_CASE_API_BASE_URL;
      else process.env.NYS_CASE_API_BASE_URL = prevCaseApiUrl;
    });

    function mockCaseApiSearch(cases: CaseApiCase[]): ReturnType<typeof vi.fn> {
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/timeline')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ events: [] }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ cases }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('defaults courtType to SC for slash diaries without hint', async () => {
      const scRow: CaseApiCase = {
        ...GJHC_FIXTURE,
        diary_no: '17329/2025',
        cnr: 'ESCR010000012025',
        court_level: 'SC',
      };
      const fetchMock = mockCaseApiSearch([scRow]);

      const res = await lookupDiaryViaCaseApi({ diaryNumber: '17329/2025' });

      const searchCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('diary_no=17329'),
      );
      expect(searchCall).toBeTruthy();
      const url = String(searchCall![0]);
      expect(url).toContain('court_type=SC');
      expect(url).toContain('diary_no=17329%2F2025');
      expect(res.kind).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.data.status).toBe('found');
        expect(res.data.diaryNumber).toBe('17329/2025');
      }
    });

    it('honors explicit courtType sc hint', async () => {
      const scRow: CaseApiCase = {
        ...GJHC_FIXTURE,
        diary_no: '17329/2025',
        cnr: 'ESCR010000012025',
        court_level: 'SC',
      };
      const fetchMock = mockCaseApiSearch([scRow]);

      const res = await lookupDiaryViaCaseApi({
        diaryNumber: '17329/2025',
        courtType: 'sc',
      });

      const searchCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('diary_no=17329'),
      );
      expect(searchCall).toBeTruthy();
      const url = String(searchCall![0]);
      expect(url).toContain('court_type=SC');
      expect(url).toContain('diary_no=17329%2F2025');
      expect(res.kind).toBe('resolved');
    });

    it('normalizes compact SC diary before case-api search', async () => {
      const scRow: CaseApiCase = {
        ...GJHC_FIXTURE,
        diary_no: '17329/2025',
        cnr: 'ESCR010000012025',
        court_level: 'SC',
      };
      const fetchMock = mockCaseApiSearch([scRow]);

      const res = await lookupDiaryViaCaseApi({
        diaryNumber: '173292025',
        courtType: 'sc',
      });

      const searchCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('diary_no=17329'),
      );
      expect(searchCall).toBeTruthy();
      const url = String(searchCall![0]);
      expect(url).toContain('diary_no=17329%2F2025');
      expect(res.kind).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.data.diaryNumber).toBe('17329/2025');
        expect(res.data.fields?.diaryNumber?.value).toBe('17329/2025');
      }
    });
  });

  describe('normalizeDiaryNumber', () => {
    it('converts compact SC diary digits to slash form', () => {
      expect(normalizeDiaryNumber('173292025')).toBe('17329/2025');
      expect(normalizeDiaryNumber('73192026')).toBe('7319/2026');
      expect(normalizeDiaryNumber('508502026')).toBe('50850/2026');
    });

    it('leaves slash and INSC forms unchanged', () => {
      expect(normalizeDiaryNumber('17329/2025')).toBe('17329/2025');
      expect(normalizeDiaryNumber('2023 INSC 1081')).toBe('2023 INSC 1081');
    });
  });

  it('extractCnrFromCaseRow backfills cnr_number when cnr empty', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      cnr: '',
      cnr_number: 'GJHC240256342024',
      diary_no: '17329/2025',
      court_level: 'SC',
    };
    const extracted = extractCnrFromCaseRow(row);
    expect(extracted.cnr).toBe('GJHC240256342024');
    expect(extracted.sourceField).toBe('cnr_number');
    expect(extracted.confidence).toBe(0.95);
  });

  it('mapCaseApiDiaryToCnrResolveData backfills data.cnr + fields.cnr from cnr_number', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      cnr: '',
      cnr_number: 'ESCR010000012025',
      diary_no: '17329/2025',
      court_level: 'SC',
    } as CaseApiCase & { cnr_number: string };
    const data = mapCaseApiDiaryToCnrResolveData({
      diaryNumber: '17329/2025',
      caseRow: row,
      latencyMs: 55,
    });
    expect(data.lookupType).toBe('diary');
    expect(data.cnr).toBe('ESCR010000012025');
    expect(data.fields?.cnr?.value).toBe('ESCR010000012025');
    expect(data.fields?.cnr?.source).toBe('nys_case_api_rds');
    expect(data.fields?.cnr?.note).toContain('cnr_number');
  });

  it('mapCaseApiDiaryToCnrResolveData leaves cnr empty when no identifier in row', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      cnr: '',
      diary_no: '17329/2025',
      case_number: '17329',
      case_number_display: 'Diary No. 17329/2025',
      court_level: 'SC',
    };
    const data = mapCaseApiDiaryToCnrResolveData({
      diaryNumber: '17329/2025',
      caseRow: row,
      latencyMs: 40,
    });
    expect(data.cnr).toBe('');
    expect(data.fields?.cnr?.value).toBe('');
    expect(data.fields?.cnr?.note).toContain('pending SC diary');
    expect(looksLikeIndianCnr('173292025')).toBe(false);
  });

  it('mapCaseApiToCnrResolveData backfills fields.cnr from secondary row field', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      cnr: '',
      cnr_number: 'TSWL000000742024',
    } as CaseApiCase & { cnr_number: string };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 30,
    });
    expect(data.cnr).toBe('TSWL000000742024');
    expect(data.fields?.cnr?.value).toBe('TSWL000000742024');
    expect(data.fields?.cnr?.note).toContain('cnr_number');
  });

  it('maps actsSections from extra.acts on case row', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      extra: {
        acts: [{ act: 'Indian Penal Code', section: '420' }],
      },
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 40,
    });
    expect(data.fields?.actsSections?.value).toEqual([
      { act: 'Indian Penal Code', section: '420' },
    ]);
    expect(data.fields?.actsSections?.source).toBe('nys_case_api_rds');
    expect(data.fields?.actsSections?.confidence).toBe(0.75);
  });

  it('maps actsSections from acts_sections array', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      acts_sections: [{ act: 'Code of Criminal Procedure', section: '482' }],
      counts: { hearings: 0, acts: 1 },
    };
    const acts = extractActsFromCaseRow(row);
    expect(acts).toHaveLength(1);
    expect(acts[0]?.act).toBe('Code of Criminal Procedure');
  });

  it('maps actsSections from RDS acts_json string column', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      acts_json: JSON.stringify([{ act: 'Indian Penal Code', section: '406' }]),
      counts: { hearings: 2, acts: 1 },
    };
    const acts = extractActsFromCaseRow(row);
    expect(acts).toEqual([{ act: 'Indian Penal Code', section: '406' }]);
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 12,
    });
    expect(data.fields?.actsSections?.value).toEqual([
      { act: 'Indian Penal Code', section: '406' },
    ]);
  });

  it('applyCorpusBetaHonestyEnvelope marks Tier-3 and PII beta slots', () => {
    const base = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: GJHC_FIXTURE,
      latencyMs: 10,
      wantCaseCreate: true,
    });
    const honest = applyCorpusBetaHonestyEnvelope(base, GJHC_FIXTURE);
    expect(honest.meta?.fieldAvailability?.nextHearingDate).toBe('tier3_required');
    expect(honest.meta?.fieldAvailability?.witnesses).toBe('manual_required');
    expect(honest.meta?.fieldAvailability?.clientPhone).toBe('corpus_unavailable');
    expect(honest.meta?.betaReadiness?.edjJobPath).toContain('ecosystem-documents');
    expect(honest.fields?.nextHearingDate?.note).toContain('Tier-3');
    expect(honest.caseCreate?.fieldManifest.corpusUnavailable).toContain('clientPhone');
    expect(honest.caseCreate?.fieldManifest.manualRequired).toContain('witnesses');
  });

  it('normalizeActsSections handles string rows', () => {
    expect(normalizeActsSections(['IPC 420'])).toEqual([{ act: 'IPC 420' }]);
  });

  it('needsCaseApiFieldEnrichment when acts and hearings empty', () => {
    const sparse = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: GJHC_FIXTURE,
      latencyMs: 10,
    });
    expect(needsCaseApiFieldEnrichment(sparse)).toBe(true);
    const rich = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: {
        ...TSWL_FIXTURE,
        extra: { acts: [{ act: 'IPC', section: '420' }] },
      },
      latencyMs: 10,
    });
    expect(needsCaseApiFieldEnrichment(rich, false)).toBe(false);
  });

  it('mergeLegacyEnrichmentIntoResolveData preserves status and source', () => {
    const base = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: GJHC_FIXTURE,
      latencyMs: 10,
    });
    const legacy = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: {
        ...GJHC_FIXTURE,
        acts_sections: [{ act: 'CrPC', section: '482' }],
        hearings: [{ date: '2024-02-01', purpose: 'Admission', judge: 'J1', status: 'Listed' }],
      },
      latencyMs: 20,
    });
    legacy.source = 'nys_rds';
    legacy.sourcesTried = ['nys_rds', 'cnr_case_details'];
    const merged = mergeLegacyEnrichmentIntoResolveData(base, legacy);
    expect(merged.status).toBe('found');
    expect(merged.source).toBe('nys_case_api_rds');
    expect(actsFromMerged(merged)).toHaveLength(1);
    expect(timelineFromMerged(merged)).toHaveLength(1);
    expect(merged.sourcesTried).toContain('nys_rds');
  });

  it('maps P1 max-detail scalar fields from nysapi row', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      citation: '2024 SCC OnLine TS 123',
      fir_no: '123',
      fir_year: '2024',
      jurisdiction: 'IND',
      district_name: 'Warangal',
      bench: 'Principal Bench',
      complex_name: 'Warangal District Court Complex',
      filing_number: '742024',
      filing_number_year: '2024',
      current_purpose: 'Evidence',
      first_hearing_date: '2024-04-01',
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 25,
    });
    expect(data.fields?.citation?.value).toBe('2024 SCC OnLine TS 123');
    expect(data.fields?.firNo?.value).toBe('123');
    expect(data.fields?.firYear?.value).toBe('2024');
    expect(data.fields?.jurisdiction?.value).toBe('IND');
    expect(data.fields?.stateName?.value).toBe('Telangana');
    expect(data.fields?.districtName?.value).toBe('Warangal');
    expect(data.fields?.bench?.value).toBe('Principal Bench');
    expect(data.fields?.complexName?.value).toBe('Warangal District Court Complex');
    expect(data.fields?.filingNumber?.value).toBe('742024');
    expect(data.fields?.filingNumberYear?.value).toBe('2024');
    expect(data.fields?.currentPurpose?.value).toBe('Evidence');
    expect(data.fields?.firstHearingDate?.value).toBe('2024-04-01');
  });

  it('maps fields.summary and fields.registrationDate from nysapi row', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      filing_date: '2024-03-01',
      registration_date: '2024-03-15',
      summary: 'Brief case summary from judgment metadata.',
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 15,
    });
    expect(data.fields?.summary?.value).toBe('Brief case summary from judgment metadata.');
    expect(data.fields?.registrationDate?.value).toBe('2024-03-15');
    expect(data.fields?.filingDate?.value).toBe('2024-03-01');
  });

  it('maps fields.partyDetails[] with PII when corpus publishes party fields', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      petitioner_address: '12 Gandhi Nagar, Warangal',
      petitioner_phone: '9876543210',
      petitioner_email: 'petitioner@example.com',
      petitioner_father_name: 'Rama Rao',
      respondent_address: '45 Station Road, Hyderabad',
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 20,
    });
    const details = data.fields?.partyDetails?.value as Array<{
      name: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      fatherName: string | null;
    }>;
    expect(Array.isArray(details)).toBe(true);
    expect(details).toHaveLength(2);
    expect(details[0]?.name).toBe('Jannu Upendra');
    expect(details[0]?.address).toBe('12 Gandhi Nagar, Warangal');
    expect(details[0]?.phone).toBe('9876543210');
    expect(details[0]?.email).toBe('petitioner@example.com');
    expect(details[0]?.fatherName).toBe('Rama Rao');
    expect(details[1]?.name).toBe('Nandi Vijayalaxmi');
    expect(details[1]?.address).toBe('45 Station Road, Hyderabad');
    expect(buildPartyDetailsFromRow(row, 'nys_case_api_rds')).toHaveLength(2);
  });

  it('adds expiresIn 900 on inline judgment documents with presigned url', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      decision_date: '2024-06-01',
      document: {
        doc_bucket: 'vanga-judgments',
        doc_key: 'hc/gj/sample.pdf',
        url: 'https://example.test/judgment.pdf?X-Amz-Expires=900',
      },
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: row,
      latencyMs: 30,
      includeDocuments: true,
    });
    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]?.kind).toBe('judgment');
    expect(data.documents[0]?.expiresIn).toBe(900);
    expect(data.documents[0]?.pdfUrlKind).toBe('presigned');
  });

  it('passes through party PII on caseCreate when case-api row has corpus fields', () => {
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      petitioner_address: '12 Gandhi Nagar, Warangal',
      petitioner_phone: '9876543210',
      petitioner_email: 'petitioner@example.com',
      petitioner_father_name: 'Rama Rao',
      respondent_address: '45 Station Road, Hyderabad',
      respondent_phone: '9123456780',
      respondent_email: 'respondent@example.com',
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 20,
      wantCaseCreate: true,
    });
    const client = data.caseCreate?.clients[0];
    const opposing = data.caseCreate?.opposingParties[0];
    expect(client?.address).toBe('12 Gandhi Nagar, Warangal');
    expect(client?.phone).toBe('9876543210');
    expect(client?.email).toBe('petitioner@example.com');
    expect(client?.fatherName).toBe('Rama Rao');
    expect(opposing?.address).toBe('45 Station Road, Hyderabad');
    expect(opposing?.phone).toBe('9123456780');
    expect(opposing?.email).toBe('respondent@example.com');
    expect(data.caseCreate?.fieldManifest.manualRecommended).not.toContain('clientPhone');
    expect(data.caseCreate?.fieldManifest.manualRecommended).not.toContain('clientEmail');
    expect(data.caseCreate?.fieldManifest.manualRecommended).not.toContain('clientAddress');
  });

  it('extractPartyPiiFromRow reads structured parties[] and extra aliases', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      extra: {
        pet_address: 'Via extra alias',
        parties: [
          {
            role: 'respondent',
            address: 'Structured respondent address',
            phone: '9000000001',
            email: 'structured@example.com',
            entity_type: 'Individual',
          },
        ],
      },
    };
    expect(extractPartyPiiFromRow(row, 'petitioner').address).toBe('Via extra alias');
    const respondentPii = extractPartyPiiFromRow(row, 'respondent');
    expect(respondentPii.address).toBe('Structured respondent address');
    expect(respondentPii.phone).toBe('9000000001');
    expect(respondentPii.email).toBe('structured@example.com');
    const data = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: row,
      latencyMs: 10,
      wantCaseCreate: true,
    });
    expect(data.caseCreate?.opposingParties[0]?.partyType).toBe('Individual');
    expect(data.caseCreate?.clients[0]?.address).toBe('Via extra alias');
  });

  it('mergeLegacyEnrichmentIntoResolveData carries party PII from legacy caseCreate', () => {
    const base = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: GJHC_FIXTURE,
      latencyMs: 20,
      wantCaseCreate: true,
    });
    const legacy = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: {
        ...GJHC_FIXTURE,
        petitioner_address: 'Legacy Petitioner Address',
        respondent_phone: '9111222333',
      },
      latencyMs: 20,
      wantCaseCreate: true,
    });
    legacy.source = 'nys_rds';
    const merged = mergeLegacyEnrichmentIntoResolveData(base, legacy);
    expect(merged.caseCreate?.clients[0]?.address).toBe('Legacy Petitioner Address');
    expect(merged.caseCreate?.opposingParties[0]?.phone).toBe('9111222333');
  });

  it('CNR resolve display path keeps party PII while AI safety pipeline redacts LLM input', async () => {
    const email = 'party@example.com';
    const row: CaseApiCase = {
      ...TSWL_FIXTURE,
      petitioner_email: email,
      petitioner_address: '123 Sample Road, Warangal',
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: row,
      latencyMs: 10,
      wantCaseCreate: true,
    });
    expect(data.caseCreate?.clients[0]?.email).toBe(email);
    expect(data.caseCreate?.clients[0]?.address).toContain('Sample Road');

    const aiInput = `Summarize case for ${email} at 123 Sample Road`;
    const pipeline = await safetyPipeline.runPreProcessingPipeline({
      requestId: 'req-party-pii-test',
      query: aiInput,
      jurisdiction: 'IN',
      userId: 'test-user',
      sessionId: 'test-session',
    });
    expect(pipeline.piiRedacted).toBe(true);
    expect(pipeline.processedInput.query).not.toContain(email);
  });

  it('maps party and advocate arrays from delimited corpus strings', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      petitioner: 'A1 PARTY; A2 PARTY',
      respondent: 'R1 PARTY, R2 PARTY',
      current_judge: 'J1, J2',
      petitioner_advocate: 'ADV PET',
      respondent_advocate: 'ADV RES',
    };
    const data = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: row,
      latencyMs: 20,
    });
    expect(data.fields?.petitioners?.value).toEqual(['A1 PARTY', 'A2 PARTY']);
    expect(data.fields?.respondents?.value).toEqual(['R1 PARTY', 'R2 PARTY']);
    expect(data.fields?.judges?.value).toEqual(['J1', 'J2']);
    expect(data.fields?.advocates?.value).toEqual([
      { name: 'ADV PET', side: 'petitioner' },
      { name: 'ADV RES', side: 'respondent' },
    ]);
  });

  it('parseStringArray handles JSON and delimited strings', () => {
    expect(parseStringArray('A; B, C')).toEqual(['A', 'B', 'C']);
    expect(parseStringArray(['X', 'Y'])).toEqual(['X', 'Y']);
  });

  it('mergeTimelineEntries dedupes by date+purpose', () => {
    const merged = mergeTimelineEntries(
      [{ date: '2024-01-01', purpose: 'Admission', judge: null, status: null, source: 'a', confidence: 0.8 }],
      [{ date: '2024-01-01', purpose: 'Admission', judge: 'J2', status: 'Listed', source: 'b', confidence: 0.9 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.judge).toBeNull();
  });

  it('mergeActsSectionRows unions acts without duplicates', () => {
    const merged = mergeActsSectionRows(
      [{ act: 'IPC', section: '420' }],
      [
        { act: 'IPC', section: '420' },
        { act: 'CrPC', section: '482' },
      ],
    );
    expect(merged).toHaveLength(2);
  });

  it('mergeLegacyEnrichmentIntoResolveData unions arrays when base is non-empty', () => {
    const base = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: TSWL_FIXTURE,
      latencyMs: 10,
    });
    const legacy = mapCaseApiToCnrResolveData({
      cnr: 'TSWL000000742024',
      caseRow: {
        ...TSWL_FIXTURE,
        hearings: [{ date: '2024-08-01', purpose: 'Final', judge: 'JMFC', status: 'Listed' }],
        acts_sections: [{ act: 'IPC', section: '420' }],
      },
      latencyMs: 20,
    });
    legacy.source = 'nys_rds';
    const merged = mergeLegacyEnrichmentIntoResolveData(base, legacy);
    expect(timelineFromMerged(merged).length).toBeGreaterThan(2);
    expect(actsFromMerged(merged)).toHaveLength(1);
  });

  it('mergeLegacyEnrichmentIntoResolveData carries extractPreview from legacy', () => {
    const base = mapCaseApiDiaryToCnrResolveData({
      diaryNumber: '17329/2025',
      caseRow: { ...TSWL_FIXTURE, cnr: '', diary_no: '17329/2025', court_level: 'SC' },
      latencyMs: 10,
    });
    const legacy = {
      ...base,
      status: 'found' as const,
      extractPreview: {
        s3Path: 's3://bucket/judgment.pdf',
        textLength: 1200,
        truncated: true,
        ocrUsed: false,
        policeStation: 'City PS',
        source: 'nyv_extract' as const,
      },
      fields: base.fields ?? {},
    };
    const merged = mergeLegacyEnrichmentIntoResolveData(base, legacy);
    expect(merged.extractPreview?.policeStation).toBe('City PS');
  });

  it('shouldAttemptLegacyCaseApiEnrichment forces legacy for diary without CNR', () => {
    process.env.JRX_F_CASE_API_LEGACY_ENRICH = '1';
    const data = mapCaseApiDiaryToCnrResolveData({
      diaryNumber: '17329/2025',
      caseRow: { ...TSWL_FIXTURE, cnr: '', diary_no: '17329/2025', court_level: 'SC' },
      latencyMs: 5,
    });
    expect(
      shouldAttemptLegacyCaseApiEnrichment({ data, diaryNumber: '17329/2025' }),
    ).toBe(true);
  });

  it('applyTimelineEnrichment fills hearings and caseCreate timeline', () => {
    const base = mapCaseApiToCnrResolveData({
      cnr: 'GJHC240256342024',
      caseRow: GJHC_FIXTURE,
      latencyMs: 10,
      wantCaseCreate: true,
    });
    const enriched = applyTimelineEnrichment(
      base,
      [{ date: '2024-05-01', purpose: 'Arguments', judge: 'J2', status: 'Listed' }],
      'nys_case_api_rds_timeline',
    );
    expect(timelineFromMerged(enriched)).toHaveLength(1);
    expect(enriched.caseCreate?.timeline).toHaveLength(1);
  });

  it('timelineEventsToTimeline maps nysapi event rows', () => {
    const tl = timelineEventsToTimeline(
      [{ hearing_date: '2024-06-10', purpose_name: 'Evidence', judge: 'JMFC' }],
      'nys_case_api_rds_timeline',
    );
    expect(tl).toHaveLength(1);
    expect(tl[0]?.purpose).toBe('Evidence');
  });

  it('timelineEventsToTimeline maps doc_url onto timeline entries', () => {
    const tl = timelineEventsToTimeline(
      [{ date: '2024-06-10', purpose: 'Order', doc_url: 'https://example.test/order.pdf' }],
      'nys_case_api_rds_timeline',
    );
    expect(tl[0]?.docUrl).toBe('https://example.test/order.pdf');
  });

  it('isB9DuplicateRiskCnr flags CT tier 16-char CNRs only', () => {
    expect(isB9DuplicateRiskCnr('DLCT010043082025')).toBe(true);
    expect(isB9DuplicateRiskCnr('GJHC240256342024')).toBe(false);
    expect(isB9DuplicateRiskCnr('TSWL000000742024')).toBe(false);
  });

  it('mapCaseApiSuggestedResolve returns suggested + two candidates', () => {
    const hcRow: CaseApiCase = {
      ...GJHC_FIXTURE,
      cnr: 'DLCT010043082025',
      court_level: 'HC',
      court: 'High Court of Delhi',
    };
    const dcRow: CaseApiCase = {
      ...TSWL_FIXTURE,
      cnr: 'DLCT010043082025',
      court_level: 'DC',
      court: 'District Court Delhi',
    };
    const data = mapCaseApiSuggestedResolve({
      cnr: 'DLCT010043082025',
      rows: [
        { courtLevel: 'HC', caseRow: hcRow, latencyMs: 40 },
        { courtLevel: 'DC', caseRow: dcRow, latencyMs: 45 },
      ],
    });
    expect(data.status).toBe('suggested');
    expect(data.fields).toBeNull();
    expect(data.candidates).toHaveLength(2);
    expect(data.candidates[0]?.title).toContain('(HC)');
    expect(data.candidates[1]?.title).toContain('(DC)');
  });

  describe('enrichCaseApiResolveData timeline fetch', () => {
    const prevCaseApiKey = process.env.NYS_CASE_API_KEY;
    const prevCaseApiUrl = process.env.NYS_CASE_API_BASE_URL;
    const prevLegacyEnrich = process.env.JRX_F_CASE_API_LEGACY_ENRICH;

    beforeEach(() => {
      process.env.NYS_CASE_API_KEY = 'test-key-len-32-chars-minimum-xx';
      process.env.NYS_CASE_API_BASE_URL = 'https://nysapi.test';
      delete process.env.JRX_F_CASE_API_LEGACY_ENRICH;
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      if (prevCaseApiKey === undefined) delete process.env.NYS_CASE_API_KEY;
      else process.env.NYS_CASE_API_KEY = prevCaseApiKey;
      if (prevCaseApiUrl === undefined) delete process.env.NYS_CASE_API_BASE_URL;
      else process.env.NYS_CASE_API_BASE_URL = prevCaseApiUrl;
      if (prevLegacyEnrich === undefined) delete process.env.JRX_F_CASE_API_LEGACY_ENRICH;
      else process.env.JRX_F_CASE_API_LEGACY_ENRICH = prevLegacyEnrich;
    });

    it('fetches timeline when includeTimeline true even with inline hearings', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            events: [
              {
                date: '2024-09-01',
                purpose: 'Order',
                doc_url: 'https://example.test/timeline-order.pdf',
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const mapped = mapCaseApiToCnrResolveData({
        cnr: 'TSWL000000742024',
        caseRow: TSWL_FIXTURE,
        latencyMs: 12,
        wantCaseCreate: true,
      });
      const enriched = await enrichCaseApiResolveData({
        data: mapped,
        caseRow: TSWL_FIXTURE,
        wantCaseCreate: true,
        includeTimeline: true,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(timelineFromMerged(enriched).length).toBeGreaterThanOrEqual(2);
      expect(enriched.documents.some((d) => d.url === 'https://example.test/timeline-order.pdf')).toBe(
        true,
      );
    });

    it('fetches timeline when counts.hearings exceeds inline hearings (P2b)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            events: [{ date: '2024-09-15', purpose: 'Order', judge: 'J4' }],
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const sparseInline: CaseApiCase = {
        ...TSWL_FIXTURE,
        hearings: [{ date: '2024-06-10', purpose: 'Evidence', judge: 'JMFC', status: 'Adjourned' }],
        counts: { hearings: 17, acts: 1 },
      };
      const mapped = mapCaseApiToCnrResolveData({
        cnr: 'TSWL000000742024',
        caseRow: sparseInline,
        latencyMs: 12,
      });
      const enriched = await enrichCaseApiResolveData({
        data: mapped,
        caseRow: sparseInline,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(timelineFromMerged(enriched).length).toBeGreaterThan(1);
    });

    it('fetches timeline when inline hearings empty and CNR known', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            events: [{ date: '2024-08-01', purpose: 'Final hearing', judge: 'J3' }],
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const mapped = mapCaseApiToCnrResolveData({
        cnr: 'GJHC240256342024',
        caseRow: GJHC_FIXTURE,
        latencyMs: 12,
        wantCaseCreate: true,
      });
      const enriched = await enrichCaseApiResolveData({
        data: mapped,
        caseRow: GJHC_FIXTURE,
        wantCaseCreate: true,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]![0])).toContain('/timeline');
      expect(timelineFromMerged(enriched)).toHaveLength(1);
    });

    it('isCaseApiLegacyEnrichEnabled respects JRX_F_CASE_API_LEGACY_ENRICH', () => {
      expect(isCaseApiLegacyEnrichEnabled()).toBe(false);
      process.env.JRX_F_CASE_API_LEGACY_ENRICH = '1';
      expect(isCaseApiLegacyEnrichEnabled()).toBe(true);
    });

    it('lookupCnrViaCaseApi returns suggested for B9 duplicate without explicit courtType', async () => {
      const hcRow: CaseApiCase = {
        ...GJHC_FIXTURE,
        cnr: 'DLCT010043082025',
        court_level: 'HC',
      };
      const dcRow: CaseApiCase = {
        ...TSWL_FIXTURE,
        cnr: 'DLCT010043082025',
        court_level: 'DC',
      };
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/timeline')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ events: [] }) };
        }
        if (u.includes('court_type=HC')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ case: hcRow }),
          };
        }
        if (u.includes('court_type=DC')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ case: dcRow }),
          };
        }
        return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'not_found' }) };
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await lookupCnrViaCaseApi({ cnr: 'DLCT010043082025' });
      expect(res.kind).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.data.status).toBe('suggested');
        expect(res.data.candidates).toHaveLength(2);
      }
    });

    it('lookupCnrViaCaseApi uses explicit courtType for B9 CNR', async () => {
      const dcRow: CaseApiCase = {
        ...TSWL_FIXTURE,
        cnr: 'DLCT010043082025',
        court_level: 'DC',
      };
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/timeline')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ events: [] }) };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ case: dcRow }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await lookupCnrViaCaseApi({
        cnr: 'DLCT010043082025',
        courtType: 'DC',
        explicitCourtType: true,
      });
      expect(res.kind).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.data.status).toBe('found');
        expect(res.data.fields?.courtType?.value).toBe('dc');
      }
      expect(fetchMock.mock.calls.filter((c) => !String(c[0]).includes('/timeline'))).toHaveLength(1);
    });
  });

  it('mapCaseApiDiaryToCnrResolveData sets lookupType diary + diaryNumber field', () => {
    const row: CaseApiCase = {
      ...GJHC_FIXTURE,
      diary_no: '17329/2025',
      cnr: 'ESCR010000012025',
      court_level: 'SC',
    };
    const data = mapCaseApiDiaryToCnrResolveData({
      diaryNumber: '17329/2025',
      caseRow: row,
      latencyMs: 42,
    });
    expect(data.lookupType).toBe('diary');
    expect(data.diaryNumber).toBe('17329/2025');
    expect(data.status).toBe('found');
    expect(data.cnr).toBe('ESCR010000012025');
    expect(data.fields?.diaryNumber?.value).toBe('17329/2025');
  });
});

function actsFromMerged(data: ReturnType<typeof mapCaseApiToCnrResolveData>): unknown[] {
  const value = data.fields?.actsSections?.value;
  return Array.isArray(value) ? value : [];
}

function timelineFromMerged(data: ReturnType<typeof mapCaseApiToCnrResolveData>): unknown[] {
  const value = data.fields?.hearings?.value;
  return Array.isArray(value) ? value : [];
}

describe('NYS-CNR-SEARCH-FILTERS-001', () => {
  it('buildCaseApiSearchForwardQuery forwards nysapi-native filter surface', () => {
    const forward = buildCaseApiSearchForwardQuery({
      courtType: 'dc',
      party_name: 'STATE OF TELANGANA',
      cnrNumber: 'tswl000000742024',
      filing_number: '25600000794',
      filing_number_year: '2025',
      fir_no: '123',
      act: 'IPC',
      advocate_name: 'Singh',
      year: '2024',
      page: '2',
      page_size: '10',
      want_total: 'true',
      unknown_param: 'drop-me',
    });
    expect(forward.court_type).toBe('DC');
    expect(forward.party_name).toBe('STATE OF TELANGANA');
    expect(forward.cnr).toBe('TSWL000000742024');
    expect(forward.filing_number).toBe('25600000794');
    expect(forward.fir_number).toBe('123');
    expect(forward.act).toBe('IPC');
    expect(forward.advocate_name).toBe('Singh');
    expect(forward.year).toBe('2024');
    expect(forward.page).toBe('2');
    expect(forward).not.toHaveProperty('unknown_param');
    expect(forward).not.toHaveProperty('fir_no');
    expect(forward).not.toHaveProperty('decision_date_from');
  });

  it('buildCaseApiSearchForwardQuery maps legacy date filters to year', () => {
    const forward = buildCaseApiSearchForwardQuery({
      court_type: 'HC',
      party_name: 'STATE',
      decision_date_from: '2023-06-01',
    });
    expect(forward.year).toBe('2023');
  });

  it('extractFilingRef accepts snake_case and camelCase', () => {
    expect(
      extractFilingRef({ filingNumber: '25600000794', filingYear: 2025 }),
    ).toEqual({ filingNumber: '25600000794', filingYear: '2025' });
    expect(
      extractFilingRef({ filing_number: '99', filing_number_year: '2024' }),
    ).toEqual({ filingNumber: '99', filingYear: '2024' });
    expect(extractFilingRef({ filingNumber: '99' })).toBeNull();
  });
});

describe('NV-CNR-NEXTDATE-KEY-001 — next_hearing_date mapping', () => {
  const baseRow: CaseApiCase = {
    cnr: 'APHC010000832023',
    court_level: 'HC',
    jurisdiction: 'IND',
    case_type: 'CRLP',
    court: 'High Court of Andhra Pradesh',
  };

  it('maps nysapi next_hearing_date → resolve field nextHearingDate', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'APHC010000832023',
      caseRow: { ...baseRow, next_hearing_date: '2026-10-15' },
      latencyMs: 10,
    });
    expect(data.fields?.nextHearingDate?.value).toBe('2026-10-15');
    expect(data.fields?.nextHearingDate?.source).not.toBeNull();
  });

  it('falls back to next_date when next_hearing_date absent', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'APHC010000832023',
      caseRow: { ...baseRow, next_date: '2026-11-01' },
      latencyMs: 10,
    });
    expect(data.fields?.nextHearingDate?.value).toBe('2026-11-01');
  });

  it('prefers next_hearing_date over next_date when both present', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'APHC010000832023',
      caseRow: { ...baseRow, next_hearing_date: '2026-10-15', next_date: '2026-11-01' },
      latencyMs: 10,
    });
    expect(data.fields?.nextHearingDate?.value).toBe('2026-10-15');
  });

  it('leaves nextHearingDate null when neither key present', () => {
    const data = mapCaseApiToCnrResolveData({
      cnr: 'APHC010000832023',
      caseRow: { ...baseRow },
      latencyMs: 10,
    });
    expect(data.fields?.nextHearingDate?.value).toBeNull();
  });
});
