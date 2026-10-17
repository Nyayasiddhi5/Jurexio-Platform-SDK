/**
 * NV-COURT-DOC-FIELDS-001 — deterministic field extraction for Indian court
 * documents.
 *
 * Why this exists: `POST /api/jrx/gateway/documents/analyze` returned only an
 * `analysis` prose blob. NSP therefore had no structured values to attach to a
 * matter and fell back to its own regex layer, badging extraction as "Heuristic"
 * rather than "NYV" — i.e. we were doing the expensive part (an LLM read of the
 * document) and still not delivering the part the product needed.
 *
 * Why deterministic rather than another LLM call:
 *  - It is free and ~1ms, so it adds no latency or cost to a 26s analyse call.
 *  - A cause title is *positional*, not semantic: "…PETITIONER" after a name is a
 *    structural convention, and a regex reads it more reliably than a model that
 *    may paraphrase or reorder.
 *  - It cannot hallucinate a case number, which for a filing is a correctness
 *    requirement, not a nicety.
 *
 * Entity-level extraction (amounts, statutes, dates, courts, orgs) is delegated to
 * `nvLegalNerV2Service`, which already exists and already handles Indian citation
 * and date forms (NV-NER-INDIA-FORMS-001). This module adds only what that service
 * does not model: the filing metadata of a court document. `CASE_PATTERN` there
 * matches *reported citations* ("(2011) 1 SCC 694"), never a filing number like
 * "Criminal Petition No. 4471 of 2025" — that was the actual gap.
 *
 * Every field carries a confidence and never guesses: an absent value is omitted
 * rather than emitted empty, so NSP can distinguish "not in the document" from
 * "we failed to read it".
 */

import { nvLegalNerV2Service } from './jrx-legal-ner-v2-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-court-document-fields');

export interface CourtDocField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  /** How the value was obtained — partners badge on this. */
  source: 'cause-title' | 'regex-rules' | 'legal-ner' | 'docparse' | 'heuristic' | 'llm' | 'ocr_fallback';
}

export interface CourtDocExtraction {
  fields: CourtDocField[];
  /** Best-guess document class from its own text, not from the caller's hint. */
  detectedDocumentType?: string;
  fieldCount: number;
  /** True when the text looks like an Indian court filing at all. */
  isIndianCourtDocument: boolean;
  /** Primary engine path when @jurexio/docparse participated (NV-DOCPARSE-ADAPTER-001). */
  extractionPath?: 'docparse' | 'heuristic' | 'mixed' | 'ocr_fallback';
  /** Detected table grids (bank statements, charge sheets, cause lists). */
  tables?: CourtDocTableRecord[];
  /** Honest docparse provenance — never implies literal 100% completeness. */
  docparseMeta?: {
    tier?: string;
    completenessRatio?: number;
    conflictFields?: string[];
    lowConfidenceFields?: string[];
    absentFields?: string[];
    degraded?: boolean;
    degradeReason?: string;
    documentTypeCode?: string;
    documentTypeLabel?: string;
    warnings?: string[];
    /** IPC→BNS concordance is DRAFT until SME sign-off — never court-facing. */
    concordanceStatus?: 'DRAFT' | 'SIGNED_OFF';
    /** Pages flagged for human review (handwriting / low OCR confidence). */
    handwritingTriageSuggested?: boolean;
    humanReviewPages?: Array<{ documentId: string; pageNo: number; reason: string }>;
    inputFormat?: string;
    batchDocumentCount?: number;
    progressStages?: Array<{ stage: string; at: string; detail?: Record<string, unknown> }>;
    engine?: 'docparse' | 'docparse-sdk';
    legalParseGuide?: Record<string, unknown>;
    docparseResultV1?: Record<string, unknown>;
    docparseIntelligence?: Record<string, unknown>;
  };
}

/**
 * The three outcomes a partner must be able to tell apart. `[]` alone cannot carry
 * this distinction, which is the whole of NSP's NYV-6 report: an empty analysis and
 * a failed analysis were byte-identical, so their client could neither trust an
 * empty result nor retry a broken one.
 */
export type AnalysisStatus = 'structured' | 'unstructured' | 'failed';

/** Partner-visible table grid from @jurexio/docparse analysis (structure only — not autofill). */
export interface CourtDocTableRecord {
  documentId: string;
  pageNo: number;
  semantics: string;
  gridConf: number;
  semanticsConf: number;
  rows: number;
  cols: number;
  columns: string[];
  grid: string[][];
}

/** Optional binary context for @jurexio/docparse (NV-DOCPARSE-ADAPTER-001). */
export interface CourtDocExtractOptions {
  bytes?: Buffer;
  fileName?: string;
  mimeType?: string;
  batchId?: string;
  actor?: string;
  /** Multi-document batch (max 5) — forwarded to docparse run(). */
  documents?: Array<{ bytes: Buffer; fileName: string; mimeType?: string }>;
  /** Per-page / stage progress for long OCR jobs (doc-pipeline jobs, SSE). */
  onProgress?: (stage: string, detail?: Record<string, unknown>) => void;
  domainPackId?: string;
  forceOcr?: boolean;
  preferOcr?: boolean;
  maxPagesPerDoc?: number;
}

/** What the caller knows about the extraction attempt that the extraction itself cannot say. */
export interface CourtDocExtractionOutcome {
  /**
   * Set when extraction was attempted and threw. Every analyze handler runs extraction
   * inside a catch (a throw must not turn a working analysis into an error), so without
   * this flag the caught case and the "nothing in the document" case both arrive here
   * as `extraction === null` and become indistinguishable again.
   */
  failed?: boolean;
  /** Sanitised, partner-safe explanation. Never a stack or a provider message. */
  reason?: string;
}

/**
 * NV-COURT-DOC-FIELDS-004 — the ONE place the partner-visible field block is shaped.
 *
 * Three handlers had each assembled this inline, and a fourth path (document analysis
 * via `POST /api/jrx/orchestrate`) had no field block at all — which is the path NSP
 * actually calls, so they saw `entities: []` / no `fieldSource` on every response while
 * we reported the fix as shipped. Twice.
 *
 * Emitting the block from a single function means "fixed on one path" cannot happen
 * again: any caller that has an extraction gets byte-identical keys.
 *
 * `fieldSource` is `'nyv'` only when at least one field was actually extracted;
 * `'none'` otherwise. Partners badge provenance on it, so it must never claim
 * structured extraction for an empty result.
 *
 * NV-ANALYZE-STATUS-005 — `analysisStatus` is the field NSP asked for. `fieldSource`
 * could not answer their question because it collapses two different facts: it reads
 * `'none'` both for a document we read successfully that simply contains no filing
 * metadata, and for an extraction that threw. Those require opposite client
 * behaviour — cache the first, retry/alert on the second — so they must not share a
 * value.
 */
export function buildCourtDocFieldBlock(
  extraction: CourtDocExtraction | null | undefined,
  /** The analyzer's nested `entities` container, when the caller has one. */
  nestedEntities?: Record<string, unknown[]> | null,
  outcome?: CourtDocExtractionOutcome | null,
): Record<string, unknown> {
  const nested = nestedEntities || {};
  const byKey = new Map<string, string>(
    (extraction?.fields ?? []).map((f) => [f.key, f.value] as const),
  );
  /* Read via a local, never an inline `.get('…')`: scripts/generate-openapi-spec.ts
   * scans for `.get('…')` to discover routes and mis-registered such a call as a
   * phantom `GET …/statutes_invoked` operation in the frozen API contract. */
  const STATUTES_FIELD_KEY = 'statutes_invoked';
  const splitList = (v?: string): string[] =>
    (v ? v.split(';').map((s) => s.trim()).filter(Boolean) : []);

  const statutes = splitList(byKey.get(STATUTES_FIELD_KEY));
  const entitiesFlat = Array.isArray(nested.entities) ? nested.entities : [];
  const deadlinesFlat = Array.isArray(nested.deadlines) ? nested.deadlines : [];
  const obligationsFlat = Array.isArray(nested.obligations) ? nested.obligations : [];
  const risksFlat = Array.isArray(nested.risks) ? nested.risks : [];
  const fieldCount = extraction?.fieldCount ?? 0;

  /* Structured means "there is something in at least one array a partner maps".
   * Counting the flat aliases as well as `fieldCount` matters because the
   * docs-pipeline path can return entities/risks/deadlines for a contract that
   * carries no court-filing metadata at all — reporting that as `unstructured`
   * would understate a perfectly good structured result. */
  const populated =
    fieldCount > 0
    || statutes.length > 0
    || entitiesFlat.length > 0
    || deadlinesFlat.length > 0
    || obligationsFlat.length > 0
    || risksFlat.length > 0;

  let analysisStatus: AnalysisStatus;
  let analysisStatusReason: string;
  if (outcome?.failed) {
    analysisStatus = 'failed';
    analysisStatusReason =
      outcome.reason || 'Structured extraction failed; arrays are empty because nothing was read.';
  } else if (populated) {
    analysisStatus = 'structured';
    analysisStatusReason = 'Structured extraction succeeded.';
  } else {
    analysisStatus = 'unstructured';
    analysisStatusReason =
      'Analysis completed and found no structured values in this document; empty arrays are a result, not a failure.';
  }

  const fieldSource = (() => {
    if (!extraction || fieldCount === 0) return 'none';
    switch (extraction.extractionPath) {
      case 'docparse':
        return 'docparse';
      case 'mixed':
        return 'mixed';
      case 'ocr_fallback':
        return 'ocr_fallback';
      case 'heuristic':
        return 'heuristic';
      default:
        /* Legacy partner badge — deterministic NYV heuristics + NER. */
        return 'nyv';
    }
  })();

  return {
    fields: extraction?.fields ?? [],
    fieldCount,
    fieldSource,
    detectedDocumentType: extraction?.detectedDocumentType ?? null,
    isIndianCourtDocument: extraction?.isIndianCourtDocument ?? false,
    extractionPath: extraction?.extractionPath ?? null,
    docparseMeta: extraction?.docparseMeta ?? null,
    tables: extraction?.tables ?? [],
    analysisStatus,
    analysisStatusReason,
    /* Flat aliases: `entities` is a *container* in the analyzer payload, so a client
     * reading `data.entities.length` gets `undefined`. These give NSP's existing
     * mapping a real array without forcing them to rewrite a working client. */
    statutes,
    entitiesFlat,
    deadlinesFlat,
    obligationsFlat,
    risksFlat,
  };
}

/* ── Filing metadata ─────────────────────────────────────────────────────────
 * Indian filing numbers take the form "<Case type> No. <n> of <year>", where the
 * case type is one of a long but bounded set of registry abbreviations. Matching
 * the case-type words explicitly (rather than any capitalised run) keeps
 * "Invoice No. 4471 of 2025" out of the results. */
const CASE_TYPE =
  'Criminal Petition|Crl\\.?\\s*P|Crl\\.?\\s*M\\.?\\s*P|Writ Petition|W\\.?P|Civil Suit|C\\.?S|Original Suit|O\\.?S' +
  '|Special Leave Petition|SLP|Civil Appeal|C\\.?A|Criminal Appeal|Crl\\.?\\s*A|Company Petition|C\\.?P' +
  '|Arbitration Petition|Execution Petition|E\\.?P|Transfer Petition|T\\.?P|Review Petition|Contempt Petition' +
  '|Bail Application|Anticipatory Bail Application|Matrimonial Case|M\\.?C|Sessions Case|S\\.?C' +
  '|Complaint Case|C\\.?C|Interlocutory Application|I\\.?A|Appeal Suit|A\\.?S|Second Appeal|S\\.?A';

const FILING_NUMBER_RE = new RegExp(
  `\\b(${CASE_TYPE})\\s*(?:No\\.?|Number)?\\s*([0-9]{1,7})\\s*(?:of|/)\\s*((?:19|20)\\d{2})\\b`,
  'i',
);

const COURT_NAME_RE =
  /\b(?:IN THE\s+)?((?:HON'?BLE\s+)?(?:SUPREME COURT OF INDIA|HIGH COURT[A-Z\s,'()]*?|(?:PRINCIPAL\s+)?(?:DISTRICT|SESSIONS|FAMILY|COMMERCIAL|LABOUR|CONSUMER)\s+(?:AND SESSIONS\s+)?COURT[A-Z\s,'()]*?|NATIONAL COMPANY LAW (?:APPELLATE )?TRIBUNAL|NCLA?T|CONSUMER DISPUTES REDRESSAL[A-Z\s]*|[A-Z\s]*TRIBUNAL))\s*(?:\n|AT\s|FOR\s|$)/;

const FIR_RE = /\bFIR\s*(?:No\.?|Number)?\s*([0-9]{1,7})\s*(?:of|\/)\s*((?:19|20)\d{2})\b/i;
const POLICE_STATION_RE = /\bat\s+([A-Z][\w.\-]*(?:\s+[A-Z][\w.\-]*){0,3})\s+Police\s+Station\b/;
/* The gap must tolerate abbreviations. It was `[^.\n]{0,60}?`, which excluded any
 * period — so "listed before the Hon'ble Justice **A.** Rajashekar Reddy on 28 March
 * 2025" never matched, because a judge's initial sits between the cue and the date.
 * Now bounded to the same line (these are numbered paragraph lines, so a newline is
 * the real boundary) and still lazy, so it takes the nearest date to the cue. */
const NEXT_HEARING_RE =
  /\b(?:listed|posted|adjourned|next\s+hearing|come\s+up)\b[^\n]{0,80}?\bon\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i;
const JUDGE_RE =
  /\b(?:Hon'?ble\s+)?(?:Mr\.?\s+|Ms\.?\s+|Mrs\.?\s+)?(?:Justice|J\.)\s+([A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,3})/;
const PRAYER_RE = /\bPRAYER\b\s*:?\s*([\s\S]{0,400}?)(?:\n\s*\n|$)/i;

/** Party roles as they appear in an Indian cause title, in registry order. */
const PARTY_ROLES = 'PETITIONER|RESPONDENT|APPELLANT|PLAINTIFF|DEFENDANT|COMPLAINANT|ACCUSED|APPLICANT';
/** "Ram Kumar … … PETITIONER" — name and role on the same line. */
const PARTY_SAME_LINE_RE = new RegExp(
  `^(.{2,180}?)\\s*[.\\u2026]{2,}\\s*(${PARTY_ROLES})(?:\\s*(?:No\\.?\\s*)?(\\d+))?\\s*$`,
  'i',
);
/**
 * "… PETITIONER" alone on a line, with the name on the preceding line.
 *
 * This is the more common layout in real filings — the dotted leader and the role
 * are set on their own line beneath the party's description. The first version of
 * this module only handled the same-line form and therefore extracted **no parties
 * at all** from a genuine Telangana High Court petition; the test caught it.
 */
const PARTY_ROLE_ONLY_RE = new RegExp(
  `^[.\\u2026]{2,}\\s*(${PARTY_ROLES})(?:\\s*(?:No\\.?\\s*)?(\\d+))?\\s*$`,
  'i',
);

/* NV-COURT-DOC-TYPE-ORDER-001 — ordered MOST specific first, because the loop is
 * first-match-wins.
 *
 * Live defect (reported by NSP, reproduced): a Section 138 Negotiable Instruments Act
 * cheque-dishonour complaint was classified `fir`, because the pleading mentions
 * "FIR No. 221 of 2025" as background and `/\bFIR\b/` sat above the more specific
 * patterns. A document's own *cause of action* must outrank a document it merely
 * refers to, so the instrument-defining matches now come first and the generic
 * `fir` / `petition` catch-alls sit last.
 *
 * `cheque_dishonour_complaint` is its own type rather than folded into `complaint`
 * because NSP autofills a matter type from this, and NI-138 has a distinct limitation
 * clock (notice within 30 days of return memo, complaint within 1 month of the 15-day
 * cure period) that no other complaint shares.
 */
const DOC_TYPE_HINTS: Array<[RegExp, string]> = [
  // ── most specific: the instrument that defines the proceeding ──
  [/\bSection\s*138\b[^.\n]{0,60}\bNegotiable Instruments\b|\bNegotiable Instruments Act\b[^.\n]{0,40}\b138\b|\bcheque\b[^.\n]{0,80}\b(?:dishonou?r|returned unpaid|funds insufficient)\b/i, 'cheque_dishonour_complaint'],
  [/\banticipatory bail\b/i, 'anticipatory_bail_petition'],
  [/\bbail application\b|\bregular bail\b/i, 'bail_application'],
  [/\bwrit petition\b/i, 'writ_petition'],
  [/\bwritten statement\b/i, 'written_statement'],
  [/\bcounter[- ]affidavit\b/i, 'counter_affidavit'],
  [/\bvakalatnama\b/i, 'vakalatnama'],
  [/\bcharge[- ]?sheet\b/i, 'charge_sheet'],
  [/\blegal notice\b|\bnotice under section\b/i, 'legal_notice'],
  [/\bplaint\b(?!\s*iff)/i, 'plaint'],
  [/\bjudgment\b|\bORDER\b.*\bpronounced\b/i, 'judgment'],
  [/\bcomplaint under section\b|\bcriminal complaint\b/i, 'criminal_complaint'],
  [/\baffidavit\b/i, 'affidavit'],
  // ── least specific: a document that merely REFERENCES an FIR or is a bare petition ──
  [/^\s*FIR\b|\bFirst Information Report\b/i, 'fir'],
  [/\bpetition under section\b/i, 'petition'],
];

function clean(v: string | undefined | null): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function push(
  fields: CourtDocField[],
  key: string,
  label: string,
  value: string | undefined | null,
  confidence: number,
  source: CourtDocField['source'],
): void {
  const v = clean(value);
  /* Omit rather than emit empty: a caller must be able to tell "absent from the
   * document" from "extraction failed". */
  if (!v) return;
  if (fields.some((f) => f.key === key)) return;
  fields.push({ key, label, value: v, confidence, source });
}

/** Cause-title party lines, e.g. "Ram Kumar S/o ... ... PETITIONER". */
function extractParties(text: string): CourtDocField[] {
  const out: CourtDocField[] = [];
  const counts: Record<string, number> = {};
  const lines = text.split(/\r?\n/);

  const add = (rawName: string, rawRole: string): void => {
    const name = clean(rawName).replace(/^(?:BETWEEN|AND|VERSUS|VS\.?)\s*:?\s*/i, '');
    const role = clean(rawRole).toLowerCase();
    if (!name || name.length < 2) return;
    counts[role] = (counts[role] || 0) + 1;
    const idx = counts[role];
    const key = idx > 1 ? `${role}_${idx}` : role;
    push(out, key, `${role.charAt(0).toUpperCase()}${role.slice(1)}${idx > 1 ? ` ${idx}` : ''}`,
      name, 0.8, 'cause-title');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 220) continue;

    const same = PARTY_SAME_LINE_RE.exec(line);
    if (same) { add(same[1], same[2]); continue; }

    /* Role on its own line — walk back to the nearest non-empty line that is not
     * itself a connector ("BETWEEN:", "AND") or another role marker. */
    const roleOnly = PARTY_ROLE_ONLY_RE.exec(line);
    if (!roleOnly) continue;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      const cand = lines[j].trim();
      if (!cand) continue;
      if (/^(?:BETWEEN|AND|VERSUS|VS\.?)\s*:?$/i.test(cand)) continue;
      if (PARTY_ROLE_ONLY_RE.test(cand)) break;
      add(cand, roleOnly[1]);
      break;
    }
  }
  return out;
}

/**
 * NV-COURT-DOC-FIELDS-004 — cheap pre-filter: is this input a court filing at all?
 *
 * The orchestrate path carries every partner request, most of which are ordinary
 * chat turns. Running the full extractor (which calls the NER service) on "what is
 * anticipatory bail?" would add latency and could attach a misleading field block to
 * a conversational answer. This is deliberately a *string* test with no async work:
 * it must be far cheaper than the extraction it gates.
 *
 * Requires BOTH some length and a structural court-document cue, because either
 * alone produces false positives — a long research prompt has no cue, and the word
 * "petitioner" can appear in a one-line question about procedure.
 */
export function looksLikeCourtDocumentInput(text: string): boolean {
  const src = String(text || '');
  /* Shorter than this cannot carry a cause title plus a body. A real filing excerpt
   * worth extracting from is comfortably longer; a chat question rarely is. */
  if (src.length < 220) return false;
  const cues = [
    /\bIN\s+THE\s+(HIGH\s+COURT|SUPREME\s+COURT|COURT\s+OF|SESSIONS\s+COURT|FAMILY\s+COURT|DISTRICT\s+COURT)/i,
    /\b(?:Criminal|Civil|Writ|Special\s+Leave|Transfer|Company)\s+(?:Petition|Appeal|Application|Revision)\s+No\.?\s*\d+/i,
    /\bF\.?I\.?R\.?\s*No\.?\s*\d+/i,
    /\b(?:Crime|Crl\.?)\s*No\.?\s*\d+\s+of\s+(?:19|20)\d{2}/i,
    /\bversus\b|\bv\/s\b|\bVs\.?\b/,
    /\.{3}\s*(?:Petitioner|Respondent|Appellant|Complainant|Accused)\b/i,
    /\bPRAYER\s*:/i,
    /\bBefore\s+(?:the\s+)?(?:Hon(?:'|’)?ble|Honourable)\b/i,
  ];
  return cues.some((re) => re.test(src));
}

export async function extractCourtDocumentFields(
  text: string,
  jurisdiction = 'IN',
  options?: CourtDocExtractOptions,
): Promise<CourtDocExtraction> {
  if (options?.bytes?.length) {
    const { runDocparseWithFallback, isDocparseEnabled } = await import('./jrx-docparse-adapter-service.js');
    if (isDocparseEnabled(jurisdiction)) {
      return runDocparseWithFallback({
        text,
        jurisdiction,
        bytes: options.bytes,
        fileName: options.fileName,
        mimeType: options.mimeType,
        batchId: options.batchId,
        actor: options.actor,
        documents: options.documents,
        onProgress: options.onProgress,
        domainPackId: options.domainPackId,
        forceOcr: options.forceOcr,
        preferOcr: options.preferOcr,
        maxPagesPerDoc: options.maxPagesPerDoc,
      });
    }
  }

  const src = String(text || '');
  const fields: CourtDocField[] = [];

  const filing = FILING_NUMBER_RE.exec(src);
  if (filing) {
    push(fields, 'case_type', 'Case type', filing[1], 0.9, 'regex-rules');
    push(fields, 'filing_number', 'Filing number', `${clean(filing[1])} No. ${filing[2]} of ${filing[3]}`, 0.9, 'regex-rules');
    push(fields, 'case_year', 'Case year', filing[3], 0.9, 'regex-rules');
  }

  const court = COURT_NAME_RE.exec(src);
  if (court) push(fields, 'court', 'Court', court[1], 0.85, 'regex-rules');

  const fir = FIR_RE.exec(src);
  if (fir) push(fields, 'fir_number', 'FIR number', `FIR No. ${fir[1]} of ${fir[2]}`, 0.9, 'regex-rules');

  const ps = POLICE_STATION_RE.exec(src);
  if (ps) push(fields, 'police_station', 'Police station', `${clean(ps[1])} Police Station`, 0.75, 'regex-rules');

  const hearing = NEXT_HEARING_RE.exec(src);
  if (hearing) push(fields, 'next_hearing_date', 'Next hearing date', hearing[1], 0.7, 'regex-rules');

  const judge = JUDGE_RE.exec(src);
  if (judge) push(fields, 'judge', 'Judge', judge[1], 0.75, 'regex-rules');

  const prayer = PRAYER_RE.exec(src);
  if (prayer) push(fields, 'prayer', 'Prayer', clean(prayer[1]).slice(0, 400), 0.7, 'regex-rules');

  for (const p of extractParties(src)) {
    if (!fields.some((f) => f.key === p.key)) fields.push(p);
  }

  /* Entities come from the existing NER service — do not re-implement statute /
   * date / amount / court / org patterns here (NV-NO-DUPLICATE-001). */
  try {
    const ner = await nvLegalNerV2Service.extractEntities(src.slice(0, 20_000), jurisdiction as never);
    const seen = new Set<string>();
    const byType: Record<string, string[]> = {};
    for (const e of ner.entities) {
      const k = `${e.type}:${e.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      (byType[e.type] ||= []).push(e.text);
    }
    if (byType.SECTION_REF?.length) {
      push(fields, 'statutes_invoked', 'Statutes / sections invoked',
        byType.SECTION_REF.slice(0, 12).join('; '), 0.85, 'legal-ner');
    }
    if (byType.AMOUNT?.length) {
      push(fields, 'amount_in_dispute', 'Amount referred', byType.AMOUNT[0], 0.8, 'legal-ner');
    }
    if (byType.DATE?.length) {
      push(fields, 'dates_mentioned', 'Dates mentioned', byType.DATE.slice(0, 8).join('; '), 0.75, 'legal-ner');
    }
    if (byType.ORG?.length) {
      push(fields, 'organisations', 'Organisations', byType.ORG.slice(0, 8).join('; '), 0.75, 'legal-ner');
    }
    if (!fields.some((f) => f.key === 'court') && byType.COURT?.length) {
      push(fields, 'court', 'Court', byType.COURT[0], 0.7, 'legal-ner');
    }
    if (!fields.some((f) => f.key === 'judge') && byType.JUDGE?.length) {
      push(fields, 'judge', 'Judge', byType.JUDGE[0], 0.7, 'legal-ner');
    }
    if (byType.CASE_NUMBER?.length) {
      push(fields, 'cited_cases', 'Cited authorities', byType.CASE_NUMBER.slice(0, 8).join('; '), 0.75, 'legal-ner');
    }
  } catch (err) {
    /* NER is an enrichment, not a gate — cause-title fields are still useful. */
    logger.warn('[CourtDocFields] NER enrichment failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  let detectedDocumentType: string | undefined;
  for (const [re, label] of DOC_TYPE_HINTS) {
    if (re.test(src)) { detectedDocumentType = label; break; }
  }
  if (detectedDocumentType) {
    push(fields, 'document_type', 'Document type', detectedDocumentType, 0.8, 'regex-rules');
  }

  /* "Is this a court filing?" needs two independent signals, so a contract that
   * merely mentions a court is not mislabelled as a filing. */
  const courtSignals = [
    !!filing,
    !!court,
    /\bPETITIONER\b|\bRESPONDENT\b|\bAPPELLANT\b|\bPLAINTIFF\b|\bDEFENDANT\b/.test(src),
    /\bPRAYER\b|\bVERIFICATION\b|\bAFFIDAVIT\b/i.test(src),
  ].filter(Boolean).length;

  return {
    fields,
    detectedDocumentType,
    fieldCount: fields.length,
    isIndianCourtDocument: courtSignals >= 2,
  };
}
