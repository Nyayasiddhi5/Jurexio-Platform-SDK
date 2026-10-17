/**
 * NV-NSP-PARSE-CONTRACT-001 — machine-readable resolve parse contract (SSoT).
 *
 * The single source of truth NSP uses to parse `POST /api/jrx/v1/sdk/cnr/resolve`
 * output. It answers, per resolve field key: WHERE the datum lives (`path`), its
 * `type` + `cardinality`, the nested object shape (`nestedSchema`), the tier that
 * populates it (`availabilityTier`), how to render it (`parseHint`), and — the
 * point of this whole exercise — WHY `.value` is empty when it is empty
 * (`absentWhen`: null | not_in_corpus | not_applicable | tier_mobile_depth_only
 * | tier3_required | manual_required | search_surface_only).
 *
 * Two hard invariants NSP must internalise (encoded in {@link NSP_PARSE_CONTRACT_NOTES}):
 *   1. `GET /search` NEVER emits these groups — it returns raw snake_case cards.
 *      The 14 normalized groups exist ONLY on `POST /resolve` (+ diary resolve).
 *   2. On resolve, every field KEY is always present as a `CnrFieldValue`
 *      wrapper even when empty. An empty value is not an error — read
 *      `.confidence`, `.note`, `meta.fieldAvailability`, and this contract.
 *
 * This module is the generator source for both the runtime `data.nspParseGuide`
 * (attached when `options.includeParseGuide: true`) and the static export
 * `documents/working/NSP-RESOLVE-PARSE-CONTRACT.json`
 * (see scripts/jrx-export-nsp-parse-contract.ts). Field keys only — no secrets.
 */
import type { NspParseContractEntry } from '../../packages/client-sdk/src/api/CnrApi.js';

const CFV = (path: string): string => `data.fields.${path}.value`;

/** Standing notes NSP must honour regardless of any single field entry. */
export const NSP_PARSE_CONTRACT_NOTES = {
  contractId: 'NV-NSP-PARSE-CONTRACT-001',
  wrapper:
    'Every data.fields.<key> is a CnrFieldValue { value, source, confidence, note? }. ' +
    'The key is always present on status:"found"; .value may be null/[]/"" — read absentWhen.',
  searchNeverSendsGroups:
    'GET /sdk/cnr/search returns raw snake_case data.cases[] discovery cards only. ' +
    'None of the normalized field keys below are produced on the search surface — ' +
    'they exist ONLY on POST /sdk/cnr/resolve and the diary resolve variant.',
  diary:
    'SC diary intake is POST /resolve with { diaryNumber } (or search-then-resolve). ' +
    'It DOES normalize into these keys; fields.cnr is typically "" for pending SC diaries.',
  documentsSeparate:
    'data.documents[] (presigned PDFs, expiresIn:900) is a SEPARATE array from data.fields.*. ' +
    'HC finalOrders[].filename / interimOrders[].filename are raw relative paths — NOT presigned.',
  claimEcourts: 'data.claimEcourts is ALWAYS false — judgment corpus / reference joins, not live eCourts.',
} as const;

const HcOrderRecordSchema: Record<string, string> = {
  order_id: 'string',
  order_date: 'date',
  order_details: 'string',
  filename: 'string (raw relative path — NOT presigned; opening directly 403s)',
  case_no: 'string',
  court_code: 'string',
};

/** The parse contract, keyed by resolve field key. */
export const NSP_RESOLVE_PARSE_CONTRACT: Record<string, NspParseContractEntry> = {
  // ── Group 1 · Identification ────────────────────────────────────────────────
  cnr: {
    path: CFV('cnr'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'universal (HC/DC); SC diary often empty',
    parseHint: 'Canonical CNR. Top-level data.cnr mirrors this. SC pending → "" with note.',
    absentWhen: ['null', 'not_in_corpus'],
  },
  caseNo: {
    path: CFV('caseNo'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'universal',
    parseHint: 'Case number (fallback case_number_display).',
    absentWhen: ['null'],
  },
  caseType: {
    path: CFV('caseType'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC ~98.9% / DC ~99%',
    parseHint: 'Short code (e.g. CRLP). Decode via caseTypeDisplay / §18 case-types.',
    absentWhen: ['null'],
  },
  caseTypeDisplay: {
    path: CFV('caseTypeDisplay'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'derived (nv_case_type_codes master; SME-curated subset)',
    parseHint: 'Expanded case-type label; source:"nyv_master" when derived. Falls back to null.',
    absentWhen: ['null', 'not_in_corpus'],
  },
  caseTitle: {
    path: CFV('caseTitle'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC/SC good; DC ~0% (fallback "pet vs res")',
    parseHint: 'Matter title.',
    absentWhen: ['null'],
  },
  citation: {
    path: CFV('citation'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'SC registry / reported judgments',
    parseHint: 'Reported/neutral citation.',
    absentWhen: ['null', 'not_applicable'],
  },
  filingNumber: {
    path: CFV('filingNumber'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'DC + HC mobile-depth ~0.4%',
    parseHint: 'Filing number.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  filingNumberYear: {
    path: CFV('filingNumberYear'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'DC + HC mobile-depth ~0.4%',
    parseHint: 'Filing year.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  registrationNumber: {
    path: CFV('registrationNumber'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth ~0.4%',
    parseHint: 'Registration number (distinct from filing).',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  registrationYear: {
    path: CFV('registrationYear'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth ~0.4%',
    parseHint: 'Registration year.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },

  // ── Group 2 · Status & dates ────────────────────────────────────────────────
  caseStatus: {
    path: CFV('caseStatus'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC/SC text; DC numeric code (see note)',
    parseHint:
      'Corpus status (not live). DC may be a numeric eCourts code — read .note; ' +
      'decode via nv_dc_case_status_codes when populated (NV-DC-STATUS-DECODE-001).',
    absentWhen: ['null', 'tier3_required'],
  },
  disposalNature: {
    path: CFV('disposalNature'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'disposed cases; DC may be numeric',
    parseHint: 'Disposal nature. DC numeric-code caveat as caseStatus.',
    absentWhen: ['null', 'not_applicable'],
  },
  filingDate: {
    path: CFV('filingDate'),
    type: 'date',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth only; DC good',
    parseHint: 'ISO date (fallback registration_date).',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  registrationDate: {
    path: CFV('registrationDate'),
    type: 'date',
    cardinality: 'one',
    availabilityTier: 'sparse',
    parseHint: 'ISO date distinct from filingDate when both published.',
    absentWhen: ['null'],
  },
  firstHearingDate: {
    path: CFV('firstHearingDate'),
    type: 'date',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth ~18.8%',
    parseHint: 'First listing date.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  decisionDate: {
    path: CFV('decisionDate'),
    type: 'date',
    cardinality: 'one',
    availabilityTier: 'disposed cases',
    parseHint: 'ISO decision date.',
    absentWhen: ['null', 'not_applicable'],
  },
  nextHearingDate: {
    path: CFV('nextHearingDate'),
    type: 'date',
    cardinality: 'one',
    availabilityTier: 'corpus when published, else tier-3',
    parseHint:
      'Corpus value (next_hearing_date ?? next_date). When null, meta.fieldAvailability ' +
      'marks tier3_required — NOT live eCourts. Keep a manual slot.',
    absentWhen: ['null', 'tier3_required'],
  },
  currentPurpose: {
    path: CFV('currentPurpose'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth ~85%',
    parseHint: 'Current purpose/stage.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },

  // ── Group 3 · Bench & venue ─────────────────────────────────────────────────
  judges: {
    path: CFV('judges'),
    type: 'string[]',
    cardinality: 'many',
    availabilityTier: 'HC/SC good',
    parseHint: 'Judge names (from judges/current_judge/coram).',
    absentWhen: ['null'],
  },
  coram: {
    path: CFV('coram'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC ~0.31%',
    parseHint: 'Coram string/array as published.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  benchComposition: {
    path: CFV('benchComposition'),
    type: 'object',
    cardinality: 'nested',
    availabilityTier: 'HC mobile-depth',
    parseHint: 'Bench type/composition as published (string or object).',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  judicialSection: {
    path: CFV('judicialSection'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth',
    parseHint: 'Judicial section.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  bench: {
    path: CFV('bench'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC',
    parseHint: 'CNR-prefix bench code (e.g. "aphc") — routing key, NOT "Division Bench".',
    absentWhen: ['null'],
  },
  courtType: {
    path: CFV('courtType'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'universal (corpus or CNR-inferred)',
    parseHint: 'sc|hc|dc. May be source:"nyv_master" when corpus null.',
    absentWhen: ['null'],
  },
  courtName: {
    path: CFV('courtName'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'corpus, else nyv_master prefill',
    parseHint: 'Court name; source:"nyv_master" on thin rows — badge "auto-filled (reference)".',
    absentWhen: ['null'],
  },
  stateName: {
    path: CFV('stateName'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth only in corpus → nyv_master prefill; DC ~99%',
    parseHint: 'State; source:"nyv_master" on ~99.6% of HC rows.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  districtName: {
    path: CFV('districtName'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth only; DC ~99%; else nyv_master (DC crosswalk)',
    parseHint: 'District; may be source:"nyv_master" via establishment crosswalk.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  complexName: {
    path: CFV('complexName'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'DC corpus / establishment crosswalk; HC mobile-depth',
    parseHint: 'Court complex/establishment; nyv_master when derivable from CNR.',
    absentWhen: ['null', 'tier_mobile_depth_only'],
  },
  courtCode: {
    path: CFV('courtCode'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'derived (DC establishment crosswalk)',
    parseHint: 'eCourts numeric court/complex code, source:"nyv_master" when derivable.',
    absentWhen: ['null', 'not_in_corpus'],
  },
  complexCode: {
    path: CFV('complexCode'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'derived (DC establishment crosswalk)',
    parseHint: 'eCourts numeric complex code (joins §18 /jurisdiction/complexes).',
    absentWhen: ['null', 'not_in_corpus'],
  },
  jurisdiction: {
    path: CFV('jurisdiction'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'universal',
    parseHint: 'Country jurisdiction (e.g. IND). Usually hidden/constant.',
    absentWhen: ['null'],
  },

  // ── Group 4 · Parties & advocates ───────────────────────────────────────────
  petitioner: {
    path: CFV('petitioner'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'universal',
    parseHint: 'Lead petitioner (first of array).',
    absentWhen: ['null'],
  },
  petitioners: {
    path: CFV('petitioners'),
    type: 'string[]',
    cardinality: 'many',
    availabilityTier: 'universal',
    parseHint: 'All petitioners.',
    absentWhen: ['null'],
  },
  respondent: {
    path: CFV('respondent'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'universal',
    parseHint: 'Lead respondent.',
    absentWhen: ['null'],
  },
  respondents: {
    path: CFV('respondents'),
    type: 'string[]',
    cardinality: 'many',
    availabilityTier: 'universal',
    parseHint: 'All respondents.',
    absentWhen: ['null'],
  },
  advocates: {
    path: CFV('advocates'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: { name: 'string', side: 'petitioner|respondent|null' },
    availabilityTier: 'DC ~99%; HC sparse',
    parseHint: 'Advocates with side.',
    absentWhen: ['null'],
  },
  partyDetails: {
    path: CFV('partyDetails'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      partyType: 'Individual|Organisation',
      name: 'string|null',
      fatherName: 'string|null',
      address: 'string|null',
      phone: 'string|null',
      email: 'string|null',
      advocate: 'string|null',
      source: 'string',
      confidence: 'number',
    },
    availabilityTier: 'names universal; PII 0% (RDS mirror)',
    parseHint: 'Party cards. address/phone/email/fatherName are almost always null — keep manual PII slots.',
    absentWhen: ['null', 'manual_required'],
  },

  // ── Group 5 · Legal (acts) ──────────────────────────────────────────────────
  actsSections: {
    path: CFV('actsSections'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: { act: 'string', section: 'string' },
    availabilityTier: 'HC mobile-depth 100%; DC via legacy merge; else count-only',
    parseHint: 'Acts & sections. When empty but meta.counts.acts>0, detail not hydrated (see .note).',
    absentWhen: ['null', 'not_in_corpus'],
  },

  // ── Group 6 · Category ──────────────────────────────────────────────────────
  hcCategoryDetails: {
    path: CFV('hcCategoryDetails'),
    type: 'object',
    cardinality: 'nested',
    nestedSchema: { category: 'string', sub_category: 'string', sub_sub_category: 'string' },
    availabilityTier: 'HC mobile-depth ~88.7%',
    parseHint: 'HC category (raw human strings). null on non-HC / thin rows.',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  caseCategory: {
    path: CFV('caseCategory'),
    type: 'object',
    cardinality: 'nested',
    nestedSchema: { code: 'string', main_category: 'string', sub_category: 'string' },
    availabilityTier: 'SC registry only',
    parseHint: 'SC official category. null on HC/DC.',
    absentWhen: ['null', 'not_applicable'],
  },

  // ── Group 7 · Interlocutory ─────────────────────────────────────────────────
  iaFilings: {
    path: CFV('iaFilings'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      case_type_no_year: 'string',
      rowtoprint: 'string',
      party_name: 'string',
      disposal_date: 'date',
      next_date: 'date',
      status: 'string',
    },
    availabilityTier: 'HC mobile-depth ~88.4%',
    parseHint: 'HC interlocutory application filings.',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  interlocutoryApplications: {
    path: CFV('interlocutoryApplications'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      serial_no: 'string',
      ia_no: 'string',
      particular: 'string',
      remark: 'string',
      filed_by: 'string',
      filing_date: 'date',
      status: 'string',
      entered_on: 'date',
    },
    availabilityTier: 'SC registry',
    parseHint: 'SC IA table. [] on HC/DC.',
    absentWhen: ['null', 'not_applicable'],
  },

  // ── Group 8 · Hearing history ───────────────────────────────────────────────
  hearings: {
    path: CFV('hearings'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      date: 'date (prefers hearing_date/business_date over adjournment next_date)',
      purpose: 'string',
      judge: 'string',
      status: 'string',
      docUrl: 'string? (presigned order PDF, 900s)',
      source: 'string',
      confidence: 'number',
    },
    availabilityTier: 'HC mobile-depth + all-court /timeline union',
    parseHint: 'Proceedings/timeline. Enriched via /timeline when sparse.',
    absentWhen: ['null'],
  },

  // ── Group 9 · Orders / judgments ────────────────────────────────────────────
  finalOrders: {
    path: CFV('finalOrders'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: HcOrderRecordSchema,
    availabilityTier: 'HC mobile-depth ~99.5%',
    parseHint:
      'HC final orders. filename is a RAW eCourts path — presigned ONLY when nv_hc_order_s3_map has a mirrored row (NV-HC-ORDER-PRESIGN-001).',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  interimOrders: {
    path: CFV('interimOrders'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: HcOrderRecordSchema,
    availabilityTier: 'HC mobile-depth ~89.5%',
    parseHint:
      'HC interim orders. presigned ONLY when nv_hc_order_s3_map has a mirrored row (NV-HC-ORDER-PRESIGN-001).',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },

  // ── Group 10 · Lower / earlier court ────────────────────────────────────────
  lowerCourtReference: {
    path: CFV('lowerCourtReference'),
    type: 'object',
    cardinality: 'nested',
    availabilityTier: 'HC mobile-depth ~22%',
    parseHint: 'Origin court reference. null on direct filings.',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  earlierCourtDetails: {
    path: CFV('earlierCourtDetails'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      serial_no: 'string',
      court: 'string',
      agency_state: 'string',
      case_no: 'string',
      order_date: 'date',
      cnr_or_designation: 'string',
      judges: 'string',
    },
    availabilityTier: 'SC registry',
    parseHint: 'SC earlier/lower court chain. Many fields may be source placeholder "-".',
    absentWhen: ['null', 'not_applicable'],
  },

  // ── Group 11 · FIR / criminal ───────────────────────────────────────────────
  firNo: {
    path: CFV('firNo'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth only; DC ~34%',
    parseHint: 'FIR number.',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  firYear: {
    path: CFV('firYear'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth only; DC ~34%',
    parseHint: 'FIR year (NOT the incident date).',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  policeStation: {
    path: CFV('policeStation'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'HC mobile-depth; DC ~34%',
    parseHint: 'Police station (fallback "FIR <no>").',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  incidentDate: {
    path: CFV('incidentDate'),
    type: 'date',
    cardinality: 'one',
    availabilityTier: 'not in corpus today (mapped when upstream publishes it)',
    parseHint:
      'FIR/incident/occurrence date. The adapter maps date_of_incident/incident_date/' +
      'fir_date/occurrence_date when present; corpus does not publish these today → null.',
    absentWhen: ['null', 'not_in_corpus'],
  },

  // ── Group 12 · Linked matters ───────────────────────────────────────────────
  linkedMatters: {
    path: CFV('linkedMatters'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      cnr: 'string|null',
      caseNumber: 'string|null',
      title: 'string|null',
      relation: 'string|null (connected|clubbed|analogous|earlier court)',
      court: 'string|null',
      source: 'string',
    },
    availabilityTier: 'sparse (legacy cnr_case_details.linked_cases); [] when none',
    parseHint: 'Linked/connected/clubbed matters. Distinct from lowerCourtReference/earlierCourtDetails.',
    absentWhen: ['null', 'not_in_corpus'],
  },

  // ── Group 13 · Other details ────────────────────────────────────────────────
  summary: {
    path: CFV('summary'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'SC judgments; HC/DC rare',
    parseHint: 'Case summary text. Grey when null; use extract/manual.',
    absentWhen: ['null', 'not_in_corpus'],
  },

  // ── Group 14 · Extra documents + registry status ────────────────────────────
  registryObjections: {
    path: CFV('registryObjections'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      serial_no: 'string',
      scrutiny_date: 'date',
      objection: 'string',
      compliance_by_date: 'date',
      receipt_date: 'date',
    },
    availabilityTier: 'HC mobile-depth ~86.5%',
    parseHint: 'HC registry objections.',
    absentWhen: ['null', 'not_applicable', 'tier_mobile_depth_only'],
  },
  registryDefects: {
    path: CFV('registryDefects'),
    type: 'object[]',
    cardinality: 'many',
    nestedSchema: {
      serial_no: 'string',
      description: 'string',
      remarks: 'string',
      notification_date: 'date',
      removed_on_date: 'date',
    },
    availabilityTier: 'SC registry',
    parseHint: 'SC registry defects. [] on HC/DC.',
    absentWhen: ['null', 'not_applicable'],
  },

  // ── Diary path extra ────────────────────────────────────────────────────────
  diaryNumber: {
    path: CFV('diaryNumber'),
    type: 'string',
    cardinality: 'one',
    availabilityTier: 'SC diary path only',
    parseHint: 'SC diary number (also top-level data.diaryNumber, data.lookupType:"diary").',
    absentWhen: ['not_applicable'],
  },
};

/**
 * Build the runtime parse guide attached to `data.nspParseGuide`. Returns the
 * full contract (stable, envelope-independent) so NSP can cache it. Callers gate
 * on `options.includeParseGuide` before attaching to keep default envelopes lean.
 */
export function buildNspParseGuide(): Record<string, NspParseContractEntry> {
  return NSP_RESOLVE_PARSE_CONTRACT;
}
