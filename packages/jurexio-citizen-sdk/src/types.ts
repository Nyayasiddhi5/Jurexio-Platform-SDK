/**
 * Public types for `@jurexio/jurexio-citizen-sdk` v1.
 *
 * These mirror the Jurexio Citizen <> Jurexio integration contract published in
 * `docs/v3.1.2/completed_docs/NYAYAMITRA-SDK-FINAL.md`. Consumers should import from this module so
 * a future Jurexio internal change cannot break the surface.
 */

/** ISO-639-1 codes for the 9 Indic languages NYM supports + English. */
export type Jurexio CitizenLanguage =
  | 'en'  // English
  | 'hi'  // Hindi
  | 'bn'  // Bengali
  | 'ta'  // Tamil
  | 'te'  // Telugu
  | 'mr'  // Marathi
  | 'gu'  // Gujarati
  | 'kn'  // Kannada
  | 'ml'  // Malayalam
  | 'ur'; // Urdu

export type Jurexio CitizenJurisdiction = 'IN'; // NYM is India-only by design.

/** ── Conversational chat (mitra-conversational agent) ─────────────────── */

export interface MitraChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO-8601 timestamp. */
  ts?: string;
}

export interface MitraChatRequest {
  /** The user's message in any of the 10 supported languages. */
  message: string;
  /** Detected or selected language. */
  language: Jurexio CitizenLanguage;
  /** Stable conversation id (NYM owns this — pass it through). */
  sessionId: string;
  /** Optional prior turns (most recent last). */
  history?: MitraChatMessage[];
  /** Optional structured intake data (location, age, case_type…). */
  intake?: Record<string, string | number | boolean | null>;
  /** Per-call overrides. */
  options?: { maxTokens?: number; temperature?: number };
}

export interface MitraChatResponse {
  /** Assistant reply, plain text in the requested language. */
  content: string;
  /** Suggested follow-up prompts the UI can render as chips. */
  followUps?: string[];
  /** When non-null, NYM should escalate (eg suicide, immediate danger). */
  escalation?: { kind: 'safety' | 'lawyer-required' | 'human-required'; reason: string } | null;
  /** Echo of the orchestration trace id for support. */
  traceId?: string;
  modelUsed?: string;
  language: Jurexio CitizenLanguage;
}

/** ── Clause classification (clause-classifier agent) ───────────────────── */

export type ClauseRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ClauseClassification {
  /** Original clause text from the document. */
  text: string;
  /** Single-line clause-type label (eg "Indemnity", "Liability cap"). */
  label: string;
  /** Risk to the citizen specifically (not the counterparty). */
  risk: ClauseRiskLevel;
  /** Plain-language explanation for a non-lawyer. */
  explanation: string;
  /** Optional jurisdiction-specific rule reference. */
  citations?: string[];
}

export interface ClauseClassifyRequest {
  /** Full document text (NYM uploads OCR'd PDFs as text). */
  documentText: string;
  /** Document type hint (helps the classifier prime). */
  documentType?: 'rent-agreement' | 'employment' | 'loan' | 'will' | 'consumer' | 'other';
  language?: Jurexio CitizenLanguage;
}

export interface ClauseClassifyResponse {
  clauses: ClauseClassification[];
  overallRisk: ClauseRiskLevel;
  summary: string;
  traceId?: string;
}

/** ── Case brief (case-brief-generator agent) ───────────────────────────── */

export interface CaseBriefIntake {
  /** Free-text recounting of the citizen's situation. */
  narrative: string;
  /** Key facts the UI may have collected as structured fields. */
  facts?: { label: string; value: string }[];
  /** Documents already uploaded — passed as `nymDocId` references. */
  documentIds?: string[];
  language?: Jurexio CitizenLanguage;
}

export interface CaseBriefStep {
  /** Action label, eg "File FIR at local police station". */
  action: string;
  /** Plain-language detail. */
  detail: string;
  /** ISO-8601 due date if relevant. */
  dueDate?: string | null;
}

export interface CaseBriefResponse {
  /** One-paragraph plain-language case summary. */
  summary: string;
  /** Applicable laws / sections (BNS, IPC, CrPC, etc). */
  applicableLaws: { name: string; section?: string; rationale: string }[];
  /** Recommended next steps for the citizen. */
  nextSteps: CaseBriefStep[];
  /** When non-null, recommend talking to a lawyer of this type. */
  recommendedLawyerType?: string | null;
  /** Estimated cost band in INR (₹). */
  estimatedCostBandInr?: '0-1000' | '1000-10000' | '10000-50000' | '50000+';
  language: Jurexio CitizenLanguage;
  traceId?: string;
}

/** ── Client config ─────────────────────────────────────────────────────── */

export interface Jurexio CitizenClientConfig {
  /** SDK API key issued for the Jurexio Citizen app. Format: `nyv_live_sk_...`. */
  apiKey: string;
  /** Defaults to https://api.jurexio.com. */
  baseUrl?: string;
  /** Default language used when not supplied per-call. Default 'hi'. */
  defaultLanguage?: Jurexio CitizenLanguage;
  /** Per-request timeout (ms). Default 30 000. */
  timeout?: number;
}
