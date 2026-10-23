/**
 * @jurexio/docparse — core types.
 *
 * Design rule that governs this whole file: nothing that reaches a case field may
 * exist without provenance. Every value carries where it came from, which engine
 * produced it, which page and pixel box it sits in, and whether AI touched it.
 * That is not a nicety — it is what makes the extraction defensible under audit
 * and what lets an advocate verify a field in one click.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Axis-aligned box in PDF-point space, origin top-left, y growing downward. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function bboxArea(b: BBox): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function bboxIntersection(a: BBox, b: BBox): BBox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bt <= y) return null;
  return { x, y, w: r - x, h: bt - y };
}

/** Vertical overlap of two boxes as a fraction of the shorter box's height. */
export function verticalOverlapRatio(a: BBox, b: BBox): number {
  const top = Math.max(a.y, b.y);
  const bot = Math.min(a.y + a.h, b.y + b.h);
  const overlap = bot - top;
  if (overlap <= 0) return 0;
  return overlap / Math.min(a.h, b.h);
}

// ---------------------------------------------------------------------------
// Scripts and languages
// ---------------------------------------------------------------------------

/**
 * Scripts we route OCR on. Indian legal documents are routinely bi-script
 * (Devanagari body with English cause-title, or Tamil body with English
 * section references), so script is a property of a *line*, not a document.
 */
export type ScriptCode =
  | "Latn"
  | "Deva"
  | "Beng"
  | "Taml"
  | "Telu"
  | "Knda"
  | "Mlym"
  | "Gujr"
  | "Guru"
  | "Orya"
  | "Arab" // Urdu / Punjabi-Shahmukhi
  | "Zyyy" // common: digits, punctuation only
  | "Zzzz"; // unknown

export type LangCode =
  | "en" | "hi" | "bn" | "ta" | "te" | "kn" | "ml" | "gu" | "pa" | "or"
  | "as" | "mr" | "ne" | "sa" | "ur" | "und";

// ---------------------------------------------------------------------------
// Extraction primitives
// ---------------------------------------------------------------------------

/**
 * Where a piece of text physically came from. TEXT_LAYER means the PDF carried
 * a real text layer; the others mean pixels were interpreted.
 */
export type SourceKind = "TEXT_LAYER" | "OCR" | "EMBEDDED" | "FORM_FIELD";

export interface Word {
  text: string;
  bbox: BBox;
  /** 0..1. Text-layer words are 1; OCR words carry the engine's own confidence. */
  conf: number;
  script: ScriptCode;
  source: SourceKind;
  /** Engine identifier, e.g. "tesseract-native@5.3.4:hin+eng". */
  engine?: string;
}

export interface Line {
  text: string;
  bbox: BBox;
  words: Word[];
  script: ScriptCode;
  conf: number;
  /** Index within the page, in reading order. */
  index: number;
  /** Page zone the line falls in — margins carry endorsements, not pleadings. */
  zone: PageZone;
}

export type PageZone = "HEADER" | "BODY" | "FOOTER" | "MARGIN_LEFT" | "MARGIN_RIGHT";

export interface Block {
  kind: "PARAGRAPH" | "HEADING" | "TABLE" | "LIST_ITEM" | "SIGNATURE" | "STAMP" | "UNKNOWN";
  text: string;
  bbox: BBox;
  lines: Line[];
  index: number;
}

export interface TableCell {
  text: string;
  bbox: BBox;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface Table {
  bbox: BBox;
  cells: TableCell[];
  rows: number;
  cols: number;
  /** Detection route: ruled lines, or whitespace column projection. */
  method: "RULED" | "PROJECTION";
  conf: number;
}

export interface Page {
  pageNo: number; // 1-based
  width: number;
  height: number;
  /** Rotation applied during preprocessing, degrees clockwise. */
  deskewDeg: number;
  lines: Line[];
  blocks: Block[];
  tables: Table[];
  /** Dominant script by character mass. */
  script: ScriptCode;
  /** Which route produced this page's text. */
  route: PageRoute;
  /** 0..1 quality signal used to decide the route and to gate autofill. */
  quality: PageQuality;
}

export type PageRoute = "TEXT_LAYER" | "OCR" | "HYBRID" | "EMPTY";

export interface PageQuality {
  /** Fraction of glyphs that came from a real text layer. */
  textLayerCoverage: number;
  /** Mean OCR word confidence, or 1 for pure text-layer pages. */
  meanConf: number;
  /** Fraction of words failing a dictionary/shape sanity check. */
  garbleRate: number;
  /** Estimated DPI of the rasterised page, if OCR ran. */
  dpi?: number;
  /** True when the page looks handwritten. Indic handwriting is NOT reliably
   *  machine-readable today, so this forces human review rather than autofill. */
  handwrittenSuspected: boolean;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  documentId: string;
  fileName: string;
  mime: string;
  sha256: string;
  pageCount: number;
  pages: Page[];
  /** Best-guess document type with alternatives kept, never silently discarded. */
  classification: Classification;
  langs: LangCode[];
  /** Wall-clock milliseconds per stage. Real measurements, not targets. */
  timings: Record<string, number>;
  warnings: Warning[];
}

export interface Warning {
  code: string;
  message: string;
  severity: "INFO" | "WARN" | "BLOCK";
  pageNo?: number;
}

// ---------------------------------------------------------------------------
// Document type taxonomy
// ---------------------------------------------------------------------------

export type DocFamily =
  | "POLICE"        // FIR, charge sheet, case diary, seizure memo
  | "PLEADING"      // plaint, written statement, petition, appeal, application
  | "ORDER"         // order, judgement, decree, award
  | "PROCESS"       // summons, warrant, notice, proclamation
  | "AFFIDAVIT"
  | "AUTHORITY"     // vakalatnama, power of attorney, board resolution
  | "CONTRACT"
  | "CORPORATE"     // MoA, AoA, MCA filings, resolutions
  | "FINANCIAL"     // cheque, bank statement, demand notice, invoice
  | "PROPERTY"      // sale deed, lease, agreement to sell, EC, mutation
  | "FAMILY"        // marriage certificate, divorce petition, maintenance
  | "IDENTITY"      // Aadhaar, PAN, passport, voter ID
  | "STATUTE"       // Act, ordinance, rules, notification, gazette
  | "BOND"          // bail bond, surety bond, personal bond
  | "COURT_ADMIN"   // cause list, filing receipt, court fee stamp, index
  | "MEDICAL"       // MLC, post-mortem, injury report, disability certificate
  | "OTHER";

export interface DocTypeProfile {
  code: string;
  label: string;
  family: DocFamily;
  /** Terms whose presence raises the score. Weighted; case-insensitive. */
  cues: Array<{ re: RegExp; w: number }>;
  /** Terms whose presence lowers the score — used to separate near-neighbours. */
  antiCues?: Array<{ re: RegExp; w: number }>;
  /** Anchor profile id used to pull labelled fields out of this type. */
  anchorProfile?: string;
  /** Fields this type is expected to yield; drives completeness reporting. */
  expectedFields: string[];
  /** Statutory basis, where the form is prescribed. */
  statutoryForm?: string;
}

export interface Classification {
  code: string;
  label: string;
  family: DocFamily;
  conf: number;
  /** Runners-up with scores. Kept so a wrong call is correctable, not invisible. */
  alternatives: Array<{ code: string; label: string; conf: number }>;
  /** Which cues fired, for explainability in the review UI. */
  evidence: Array<{ cue: string; weight: number; pageNo: number; snippet: string }>;
}

// ---------------------------------------------------------------------------
// Candidates — the unit of extraction
// ---------------------------------------------------------------------------

export type ExtractorKind =
  | "TEXT_LAYER"
  | "OCR"
  | "ANCHOR"     // label→value on the page
  | "GRAMMAR"    // regex/grammar pack match
  | "TABLE"      // pulled from a detected table cell
  | "REFERENCE"  // resolved against nyv_ref master data
  | "COMPUTED"   // derived from other candidates
  | "MANUAL"     // typed by a human
  | "LLM_FALLBACK";

/**
 * One proposed value for one field, with everything needed to justify it.
 * `field_path` is a dotted path into the NSP case shape, e.g.
 * "parties[0].name", "fir.number", "sections[2].statute".
 */
export interface Candidate<T = unknown> {
  fieldPath: string;
  /** Exactly as it appeared on the page. Never cleaned. */
  valueRaw: string;
  /** Canonical form for storage. Null when normalisation failed. */
  valueNormalized: T | null;
  /** 0..1, calibrated. See resolve/confidence.ts for the model. */
  confidence: number;
  extractorId: string;
  extractorKind: ExtractorKind;
  aiInvolved: boolean;
  documentId: string;
  pageNo: number;
  bbox: BBox | null;
  /** Line indices that contributed, for highlight rendering. */
  lineIndices: number[];
  /**
   * How much this document type is trusted for this field. A judgement is
   * authoritative for the cause title; an FIR is authoritative for FIR number;
   * a draft is authoritative for nothing.
   */
  authorityWeight: number;
  /** Set when the value was masked before persistence (Aadhaar, account nos.). */
  redacted?: boolean;
  notes?: string[];
}

export interface FieldResolution<T = unknown> {
  fieldPath: string;
  chosen: Candidate<T> | null;
  /** Every competing candidate, kept. Conflicts are shown, not hidden. */
  competing: Array<Candidate<T>>;
  status: "RESOLVED" | "CONFLICT" | "LOW_CONFIDENCE" | "ABSENT";
  /** Why the winner won — printed in the review UI. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Domain value objects
// ---------------------------------------------------------------------------

export interface ParsedDate {
  iso: string | null;        // YYYY-MM-DD
  y: number | null;
  m: number | null;
  d: number | null;
  precision: "DAY" | "MONTH" | "YEAR" | "UNKNOWN";
  calendar: "GREGORIAN" | "SAKA" | "UNKNOWN";
  /** True when the source was ambiguous between DD/MM and MM/DD. India is
   *  DD/MM, so we prefer it, but we record that we made a choice. */
  ambiguousOrder: boolean;
  raw: string;
}

export interface ParsedMoney {
  amount: number | null;
  currency: "INR" | "USD" | "EUR" | "GBP" | "UNKNOWN";
  /** The multiplier word found, if any. */
  scale: "NONE" | "THOUSAND" | "LAKH" | "CRORE";
  /** True when the document wrote the figure in words as well and they agreed. */
  wordsConfirmed?: boolean;
  raw: string;
}

export interface StatuteSection {
  section: string;          // "302", "138", "420", "376AB"
  subsections: string[];    // ["1", "a"]
  statute: string;          // canonical short code: IPC, BNS, CrPC, BNSS, NI_ACT
  statuteLabel: string;
  /** Post-2023 recodification mapping, when one exists and is unambiguous. */
  successor?: { statute: string; section: string; confidence: number };
  raw: string;
}

export type PartyRole =
  | "PLAINTIFF" | "DEFENDANT"
  | "PETITIONER" | "RESPONDENT"
  | "APPELLANT" | "APPELLEE"
  | "COMPLAINANT" | "ACCUSED"
  | "APPLICANT" | "OPPOSITE_PARTY"
  | "DECREE_HOLDER" | "JUDGEMENT_DEBTOR"
  | "INFORMANT" | "VICTIM" | "WITNESS"
  | "PROSECUTOR" | "STATE"
  | "INTERVENER" | "AMICUS"
  | "SURETY" | "GUARDIAN"
  | "UNKNOWN";

export interface Person {
  name: string;
  /** Serial as printed, e.g. "A-1", "R-2", "PW-3". */
  serial?: string;
  role: PartyRole;
  relation?: { type: "S/O" | "D/O" | "W/O" | "C/O" | "H/O"; name: string };
  age?: number;
  gender?: "M" | "F" | "O";
  occupation?: string;
  address?: string;
  phones: string[];
  emails: string[];
  /** Identity numbers, already masked where the law requires it. */
  ids: Array<{ kind: string; value: string; masked: boolean }>;
  /** Set when the person is a company/firm/trust rather than a natural person. */
  entityType?: "INDIVIDUAL" | "COMPANY" | "FIRM" | "TRUST" | "SOCIETY" | "GOVERNMENT" | "HUF";
}

export interface Advocate {
  name: string;
  /** Bar Council enrolment, e.g. "D/1234/2015". */
  enrolmentNo?: string;
  barCouncil?: string;
  appearingFor?: PartyRole;
  designation?: "SENIOR_ADVOCATE" | "ADVOCATE" | "AOR" | "GOVERNMENT_PLEADER" | "PUBLIC_PROSECUTOR" | "AMICUS";
  phones: string[];
  emails: string[];
}

export interface CourtRef {
  raw: string;
  /** Tier as read off the document, before registry resolution. */
  tier?: "SUPREME_COURT" | "HIGH_COURT" | "DISTRICT" | "SESSIONS" | "MAGISTRATE" | "TRIBUNAL" | "SPECIAL" | "COMMISSION" | "FAMILY" | "LOK_ADALAT" | "UNKNOWN";
  state?: string;
  district?: string;
  bench?: string;
  /** Resolved against nyv_ref.court when a confident match exists. */
  courtId?: string;
  courtName?: string;
  resolutionConf?: number;
}

export interface CaseNumberRef {
  raw: string;
  /** Case type token as printed, e.g. "CRL.A.", "W.P.(C)", "O.S.". */
  typeToken?: string;
  number?: string;
  year?: number;
  /** Court-scoped case-type code from nyv_ref, when resolvable. Case-type codes
   *  are court-scoped, never national — do not treat this as a global code. */
  caseTypeCode?: string;
  courtId?: string;
}

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  batchId: string;
  documents: ParsedDocument[];
  /** Flat candidate list, every proposal from every document. */
  candidates: Candidate[];
  /** Per-field resolution across documents, with conflicts surfaced. */
  resolutions: FieldResolution[];
  /** The autofill payload, shaped for the NSP case form. */
  autofill: AutofillPayload;
  analysis: DocumentAnalysis[];
  governance: GovernanceReport;
  timings: Record<string, number>;
  warnings: Warning[];
}

export interface AutofillPayload {
  /** Tier reached: T0 stub, T1 working, T2 filing-ready, T3 pleading-complete. */
  tier: "T0" | "T1" | "T2" | "T3";
  fields: Record<string, unknown>;
  /** Fields deliberately left blank because nothing was found. Never guessed. */
  absent: string[];
  /** Fields with competing values the advocate must choose between. */
  conflicts: string[];
  /** Fields present but below the autofill threshold — shown, not filled. */
  lowConfidence: string[];
  /** PII/statutory withheld — distinct from absent (restricted, not missing). */
  withheld: string[];
  completeness: { filled: number; expected: number; ratio: number };
}

export interface DocumentAnalysis {
  documentId: string;
  /** Extractive only. No generated prose in the default path. */
  summarySentences: Array<{ text: string; pageNo: number; score: number; lineIndices: number[] }>;
  timeline: Array<{ date: ParsedDate; event: string; pageNo: number; conf: number }>;
  /**
   * Contract/deed obligations, or judgement directions.
   *
   * `kind` stays a clean enumerable value. A relative deadline ("within 30 days")
   * goes in `relativeDue` rather than being appended to the kind — the first
   * version produced kinds like "PAYMENT_RELATIVE_30_DAYS", which made the field
   * unqueryable and meant every consumer had to parse the kind string to find
   * out it was a payment.
   */
  obligations: Array<{
    text: string;
    obligor?: string;
    /** An absolute deadline stated in the clause. */
    dueDate?: ParsedDate;
    /** A deadline stated relative to a trigger ("within 30 days of execution"). */
    relativeDue?: { count: string; unit: "DAYS" | "MONTHS" | "WEEKS" | "YEARS" };
    kind: string;
    pageNo: number;
  }>;
  reliefsSought: Array<{ text: string; pageNo: number }>;
  /** Judgement-specific: what was held and what was directed. */
  holding?: { text: string; pageNo: number; disposition?: "ALLOWED" | "DISMISSED" | "PARTLY_ALLOWED" | "DISPOSED" | "REMANDED" | "UNKNOWN" };
  citations: Array<{ raw: string; kind: string; pageNo: number }>;
  monetary: Array<{ money: ParsedMoney; context: string; pageNo: number }>;
  structure: Array<{ heading: string; pageNo: number; level: number }>;
  /**
   * Detected grids, semantically labelled and normalised.
   *
   * This is the CONSUMPTION layer for tables, and it is deliberately separate
   * from the candidate stream that feeds autofill.
   *
   * A bank statement has ten transaction dates and thirty amounts. Pushing those
   * into the generic `dates` and `amounts` candidate paths would be actively
   * harmful in two ways: it floods the resolver with values that are not
   * document-level facts (no one of those dates is "the date of the document"),
   * and because the grid re-reads the same words the prose sweep already read,
   * it would register as corroboration and inflate confidence on evidence that
   * is not independent.
   *
   * So the grid is published as structure, with per-cell provenance, and a
   * consumer that wants ledger rows or a cause-list import reads it directly.
   */
  tables: TableRecord[];
}

export type TableSemantics =
  /** Dated money movements: a bank or ledger statement. */
  | "LEDGER"
  /** Serial + description + quantity/rate/amount: an invoice or bill of costs. */
  | "LINE_ITEMS"
  /** Identifier + description: charge-sheet witness and document lists, schedules of annexures. */
  | "ID_LIST"
  /** A court listing: serial, case number, CNR, parties, advocates. */
  | "LISTING"
  /** A grid whose shape matched nothing known. Still published, still usable. */
  | "UNKNOWN";

export interface TableRecord {
  documentId: string;
  pageNo: number;
  semantics: TableSemantics;
  /** How confident the detector is in the GRID, carried through unchanged. */
  gridConf: number;
  /** How confident the semantic label is. Separate from gridConf on purpose. */
  semanticsConf: number;
  method: Table["method"];
  rows: number;
  cols: number;
  /** Index of the header row within `grid`, or null when there is no header. */
  headerRow: number | null;
  /** Column labels where a header exists, else generated positional labels. */
  columns: string[];
  /** Per-column coarse type, from the same classifier the grid gate uses. */
  columnKinds: CellKind[];
  /** Cell text, row-major and rectangular. Empty cells are empty strings. */
  grid: string[][];
  /** One bbox per cell, parallel to `grid`, for provenance highlighting. */
  cellBoxes: Array<Array<BBox | null>>;
  /**
   * Normalised values for the columns where normalisation is unambiguous. Keyed
   * by column index; a null entry means the cell did not normalise, which is
   * kept visible rather than being silently dropped.
   */
  normalized: {
    dates: Record<number, Array<ParsedDate | null>>;
    money: Record<number, Array<ParsedMoney | null>>;
  };
}

export type CellKind = "EMPTY" | "DATE" | "MONEY" | "NUM" | "CODE" | "TEXT_SHORT" | "TEXT_LONG";

export interface GovernanceReport {
  /** True when any restricted-category trigger fired. */
  restricted: boolean;
  restrictedReasons: string[];
  redactions: Array<{ kind: string; documentId: string; pageNo: number; count: number }>;
  aiInvolved: boolean;
  /** Set when a page could not be machine-read and needs a human. */
  humanReviewRequired: Array<{ documentId: string; pageNo: number; reason: string }>;
  auditEvents: Array<{ seq: number; at: string; actor: string; action: string; detail: string; hash: string; prevHash: string }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DocparseConfig {
  /** Minimum confidence at which a field is actually pre-filled in the form. */
  autofillThreshold: number;
  /** Below this, the candidate is discarded entirely. */
  floorThreshold: number;
  ocr: {
    /** Preferred engine order per script. */
    enginePreference: Partial<Record<ScriptCode, string[]>>;
    /** Rasterisation DPI. 300 is the accuracy/latency knee for Indian court scans. */
    dpi: number;
    maxConcurrency: number;
    /** Hard cap per page; a stuck page must not stall a batch. */
    pageTimeoutMs: number;
    tessdataPrefix?: string;
    tesseractBinary?: string;
  };
  llmFallback: {
    /** Org-level switch. Default OFF. The engine cannot turn this on itself. */
    enabled: boolean;
    /** Hard ceiling on any LLM-derived candidate's confidence. */
    maxConfidence: number;
  };
  redaction: {
    maskAadhaar: boolean;
    maskAccountNumbers: boolean;
    maskPhones: boolean;
  };
  /** Fields whose absence blocks nothing but is reported. */
  expectedFieldOverrides?: Record<string, string[]>;
}

export const DEFAULT_CONFIG: DocparseConfig = {
  autofillThreshold: 0.72,
  floorThreshold: 0.35,
  ocr: {
    enginePreference: {
      Latn: ["tesseract-native", "tesseract-js"],
      Deva: ["tesseract-native", "paddle-v5-devanagari", "tesseract-js"],
      Taml: ["tesseract-native", "paddle-v5-tamil", "tesseract-js"],
      Telu: ["tesseract-native", "paddle-v5-telugu", "tesseract-js"],
      // Bengali has no Paddle model at all (PP-OCRv5 ships none, PP-OCRv6 has no
      // Indic coverage) — Tesseract is the only route.
      Beng: ["tesseract-native", "tesseract-js"],
      Knda: ["tesseract-native", "tesseract-js"],
      Mlym: ["tesseract-native", "tesseract-js"],
      Gujr: ["tesseract-native", "tesseract-js"],
      Guru: ["tesseract-native", "tesseract-js"],
      Orya: ["tesseract-native", "tesseract-js"],
      Arab: ["tesseract-native", "tesseract-js"],
    },
    dpi: 300,
    maxConcurrency: 4,
    pageTimeoutMs: 20_000,
  },
  llmFallback: { enabled: false, maxConfidence: 0.65 },
  redaction: { maskAadhaar: true, maskAccountNumbers: true, maskPhones: false },
};
