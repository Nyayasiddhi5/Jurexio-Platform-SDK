/**
 * NV-COUNSEL-GRADE-EVAL-001 — the checker behind "counsel-grade".
 *
 * WHAT THIS IS
 * ------------
 * Pure, I/O-free assertions over ONE delivered answer + its orchestration
 * envelope. No network, no DB, no LLM. That is deliberate: the harness that
 * grades the platform must itself be gradeable, and the only way to prove an
 * assertion CAN fail is to hand it a bad input and watch it go red. Everything
 * here is therefore a function of `(body, envelope, case-config)`.
 *
 * WHY IT EXISTS
 * -------------
 * Measured live on jrx-prod (2026-08-19): asked for "leading Supreme Court
 * authorities on anticipatory bail for economic offences", `/api/jrx/orchestrate`
 * returned 6,925 characters of confident prose containing ZERO case citations
 * while reporting `trust: { citationsPresent: true, qualityOk: true }`. Three
 * independent faults produced it, and all three were found by hand. Nothing
 * measured it, so nothing could have caught it.
 *
 * `jrx-eval-legal-accuracy.ts` already grades jurisdiction × legal-chat answers
 * for accuracy / citation-faithfulness / hallucination, and `jrx-quality-trend.ts`
 * already owns run-to-run regression. Neither one exercises the ORCHESTRATE task
 * families (research, chat, analysis, draft, analyzeDocument, statute transition,
 * treatment), and — critically — neither cross-checks the envelope's self-report
 * against the body it describes. That cross-check is what was missing, so that is
 * what this module adds. It reuses the platform's own
 * `countDeliveredAuthorities()` rather than re-deriving the count, so the harness
 * grades the shipped expression and not a copy of it.
 *
 * DESIGN RULES
 * ------------
 * 1. Every assertion returns `pass | fail | na | blocked` — never a bare boolean.
 *    `na` means "this property is not claimed for this family"; `blocked` means
 *    the instrument could not measure (empty body / transport failure), which must
 *    NEVER be reported as a quality failure. A gateway outage reading as a quality
 *    regression is the same lie as a health probe on the wrong port.
 * 2. Never trust a self-reported field alone. Authority counts are re-derived from
 *    the body by regex and compared with the envelope.
 * 3. An assertion that cannot fail is worse than no assertion, so each one carries
 *    `measured` + `expected` numbers, and `tests/unit/jrx-counsel-grade-assertions.test.ts`
 *    pins a RED fixture for every id in `ASSERTION_IDS`.
 */

import { countDeliveredAuthorities } from '../src/orchestration/jrx-orchestration-response-contract.js';

/* ────────────────────────────── types ────────────────────────────── */

export type AssertionStatus = 'pass' | 'fail' | 'na' | 'blocked';

export const ASSERTION_IDS = [
  'transport',
  'length_floor',
  'authority_density',
  'envelope_honesty',
  'draft_structure',
  'statute_currency',
  'anti_fabrication',
  'deterministic_fidelity',
  'good_law_signal',
  'structured_fields',
] as const;

export type AssertionId = (typeof ASSERTION_IDS)[number];

export interface AssertionResult {
  id: AssertionId;
  label: string;
  status: AssertionStatus;
  /** The number (or count) actually observed. `null` when nothing was measurable. */
  measured: number | null;
  /** The bar the measured value had to clear. */
  expected: number | null;
  /** One line an engineer can act on. Never a bare "failed". */
  detail: string;
}

/** Which counsel-grade properties a given eval case CLAIMS. Absent ⇒ `na`. */
export interface CounselGradeCaseConfig {
  id: string;
  family: string;
  prompt: string;
  /** Minimum body length below which the answer is a failure whatever it says. */
  minChars?: number;
  /** Authority-seeking prompt: the answer must carry ≥ this many case authorities. */
  minCaseAuthorities?: number;
  /** Structure keys the instrument must contain (see STRUCTURE_CHECKS). */
  requiredStructure?: string[];
  /** Minimum number of `requiredStructure` keys that must be present. */
  minStructureScore?: number;
  /**
   * `post-2024-07-01` ⇒ BNS/BNSS/BSA must be the operative code. Any other value
   * (or absent) makes `statute_currency` `na`, because an answer about a pre-BNS
   * offence citing IPC is CORRECT and must not be failed for it.
   */
  offenceEra?: 'post-2024-07-01' | 'pre-2024-07-01' | 'not-criminal';
  /** Facts were deliberately withheld ⇒ the answer must use placeholders, not invent. */
  factsWithheld?: boolean;
  /**
   * How many placeholders a `factsWithheld` case must carry. Default 3.
   *
   * Measured while building this harness: a fixture with every material
   * particular (name, address, FIR number, suit number, advocate, date) replaced
   * by an invented one still scored `placeholders: 1`, because a single
   * `______` blank survived in the cause title. "≥1 placeholder" therefore does
   * NOT distinguish a properly slotted draft from a fabricated one; a count
   * proportional to the withheld facts does.
   */
  minPlaceholders?: number;
  /** Deterministic family: every one of these substrings must appear (case-insensitive). */
  mustContain?: string[];
  /** Treatment/good-law family: the response must carry an explicit good-law signal. */
  expectTreatmentSignal?: boolean;
  /** Structured extraction: these field names must be present and non-empty. */
  requiredFields?: string[];
  /**
   * Authorities the platform says it supplied to the model. When present, every
   * reporter citation in the body must be one of these. Absent on the live path
   * (the response does not expose the RAG block) ⇒ containment is reported `na`
   * rather than silently passing.
   */
  suppliedAuthorities?: string[];
}

/** What the harness could observe about one delivered answer. */
export interface DeliveredAnswer {
  /** The answer body. Empty string when the call produced nothing. */
  body: string;
  /** Raw orchestration envelope (or the sub-object carrying `trust`). */
  envelope?: Record<string, unknown> | null;
  /** HTTP status, when the answer came over the wire. */
  httpStatus?: number;
  /** Transport-level failure message (timeout, DNS, 5xx). Presence ⇒ `blocked`. */
  transportError?: string;
  latencyMs?: number;
}

export interface CounselGradeAssessment {
  caseId: string;
  family: string;
  bodyChars: number;
  /** True when the answer never arrived — every quality assertion is `blocked`. */
  blocked: boolean;
  metrics: CounselGradeMetrics;
  assertions: AssertionResult[];
  passed: number;
  failed: number;
  blockedCount: number;
  /** A case is `ok` when nothing failed AND nothing was blocked. */
  ok: boolean;
}

export interface CounselGradeMetrics {
  reporterCitations: string[];
  citedCaseNames: string[];
  bareCaseNames: string[];
  statutoryCitations: string[];
  caseAuthorities: number;
  anyCitations: number;
  envelopeAuthoritiesDelivered: number | null;
  envelopeCitationsPresent: boolean | null;
  envelopeQualityOk: boolean | null;
  envelopeAuthoritiesRederived: number | null;
  structure: Record<string, boolean>;
  structureScore: number;
  newCodeMentions: number;
  legacyOperativeMentions: number;
  legacyTransitionalMentions: number;
  placeholders: number;
  impossibleCitations: string[];
  unsuppliedCitations: string[];
}

/* ─────────────────── detection: authorities in the body ─────────────────── */

/**
 * Indian law reporters, plus the few foreign series our golden sets touch.
 *
 * Deliberately an explicit allowlist and not `[A-Z]{2,5}`: a generic
 * "capitals between a year and a number" pattern matches "(2024) 3 BNS 103" and
 * every table row in a statute-comparison answer, which would let
 * `authority_density` pass on an answer containing no case law at all.
 */
const REPORTER_SERIES = [
  'SCC OnLine', 'SCC', 'SCR', 'AIR', 'SCALE', 'JT', 'Supp SCC',
  'Cri LJ', 'CriLJ', 'Crl LJ', 'MLJ', 'Mad LJ', 'BomCR', 'Bom CR', 'DLT', 'PLR',
  'KLT', 'KHC', 'ITR', 'Comp Cas', 'CTR', 'STC', 'LLJ', 'FLR', 'ALL ER', 'WLR',
];
const COURT_TOKENS = 'SC|SCW|INSC|UKSC|EWCA|EWHC|Bom|Del|Mad|Cal|All|Ker|Kar|Guj|Pat|Ori|Raj|MP|AP|TS|P&H|Gau|HP|J&K|Jhar|Chh|Utt|Sikk|Mani|Megh|Tri|NOC';

const REPORTER_PATTERNS: readonly RegExp[] = [
  // "(2020) 5 SCC 1"  /  "[2019] 3 WLR 45"  /  "(1978) 1 SCC 248"
  new RegExp(
    `[(\\[]\\s*((?:1[89]|20)\\d{2})\\s*[)\\]]\\s*(\\d{1,3})\\s+(${REPORTER_SERIES.join('|')})\\s+(\\d{1,5})`,
    'gi',
  ),
  // "AIR 1980 SC 1632"  /  "AIR 2020 SC 1"
  new RegExp(`\\bAIR\\s+((?:1[89]|20)\\d{2})\\s+(${COURT_TOKENS})\\s+(\\d{1,5})\\b`, 'gi'),
  // "2019 SCC OnLine SC 1445"
  /\b((?:19|20)\d{2})\s+SCC\s+OnLine\s+[A-Za-z&]{2,6}\s+(\d{1,5})\b/gi,
  // "2023 INSC 456" — the Supreme Court's own neutral citation
  /\b((?:19|20)\d{2})\s+INSC\s+(\d{1,5})\b/gi,
  // "[2020] UKSC 12" / "[2019] EWCA Civ 2002"
  /\[((?:19|20)\d{2})\]\s+(UKSC|UKHL|EWCA\s+(?:Civ|Crim)|EWHC)\s+(\d{1,5})\b/gi,
  // "410 U.S. 113"
  /\b(\d{1,3})\s+U\.\s?S\.\s+(\d{1,4})\b/g,
];

/**
 * Party pairs. Both `v.` / `vs` (how counsel types) and `versus` (how the NYS
 * corpus stores titles, e.g. `SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI)`).
 */
const CASE_NAME_PATTERN =
  /\b([A-Z][\w.&'’\-]*(?:[ \t]+(?:of|and|the|&|v\/s)?[ \t]*[A-Z][\w.&'’\-]*){0,6})[ \t]+(?:v\.?|vs\.?|versus)[ \t]+([A-Z][\w.&'’\-]*(?:[ \t]+(?:of|and|the|&)?[ \t]*[A-Z(][\w.&'’\-)]*){0,6})/g;

/**
 * Words that name a ROLE, not a party. `Petitioner versus Respondent` is a
 * template, not an authority — counting it would let a fabricated-free but
 * citation-free draft satisfy `authority_density`.
 */
const GENERIC_PARTY = new Set([
  'petitioner', 'petitioners', 'respondent', 'respondents', 'applicant', 'applicants',
  'appellant', 'appellants', 'plaintiff', 'plaintiffs', 'defendant', 'defendants',
  'accused', 'complainant', 'claimant', 'deponent', 'party', 'partya', 'partyb',
  'the state', 'state', 'union of india', 'anr', 'ors', 'others', 'another',
  'x', 'y', 'a', 'b', 'name', 'company', 'employer', 'employee',
]);

/** Statute codes that are still operative for offences committed on/after 1 Jul 2024. */
const NEW_CODE_PATTERN =
  /\b(BNS|BNSS|BSA|Bharatiya\s+Nyaya\s+Sanhita|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita|Bharatiya\s+Sakshya\s+Adhiniyam)\b/gi;

/** A provision reference anchored in a repealed code, either word order. */
const LEGACY_PROVISION_PATTERNS: readonly RegExp[] = [
  /\b(?:Section|Sections|Sec\.?|S\.|§)\s*\d+[A-Z]{0,2}(?:\s*\(\d+\))?(?:\s*(?:,|and|to|read\s+with)\s*\d+[A-Z]{0,2})*\s+(?:of\s+the\s+)?(IPC|Cr\.?\s?P\.?\s?C\.?|CrPC|Indian\s+Penal\s+Code|Code\s+of\s+Criminal\s+Procedure|Indian\s+Evidence\s+Act|IEA)\b/gi,
  /\b(IPC|CrPC|Cr\.?\s?P\.?\s?C\.?|Indian\s+Penal\s+Code|Code\s+of\s+Criminal\s+Procedure|Indian\s+Evidence\s+Act)\s*(?:,\s*(?:18|19)\d{2})?\s*(?:Section|Sec\.?|S\.|§)\s*\d+[A-Z]{0,2}/gi,
];

/**
 * Language that makes a repealed-code reference legitimate rather than stale.
 *
 * This list is the whole reason `statute_currency` is not a keyword ban: an
 * answer that says "Section 438 CrPC (now Section 482 BNSS)" is BETTER than one
 * that silently drops the old numbering, because that is how a practitioner
 * reads a pre-2024 judgment. Failing it would be a false failure.
 */
const TRANSITIONAL_MARKER =
  /\b(formerly|erstwhile|corresponding|corresponds|repealed|replaced|superseded|renumbered|now|previously|earlier|prior|pre-?(?:BNS|BNSS|BSA|2024)|old|equivalent|analogous|savings?|transition(?:al)?|pari\s+materia|until|before|hitherto|as\s+it\s+stood|BNS|BNSS|BSA)\b/i;
const TRANSITIONAL_WINDOW = 160;

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\[\[\s*PLACEHOLDER\s*:[^\]]{0,120}\]\]/gi,
  /\[[A-Z][A-Z0-9 ./_'-]{2,60}\]/g,
  /_{4,}/g,
];

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.replace(/\s+/g, ' ').trim());
  }
  return out;
}

function matchAll(body: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    for (const m of body.matchAll(new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`))) {
      out.push(m[0]);
    }
  }
  return out;
}

/** Reporter-style citations found in the body, independent of any envelope field. */
export function detectReporterCitations(body: string): string[] {
  return dedupe(matchAll(String(body || ''), REPORTER_PATTERNS));
}

function normaliseParty(side: string): string {
  return side
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(anr|ors|others|another|etc|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericParty(side: string): boolean {
  const n = normaliseParty(side);
  if (!n) return true;
  if (GENERIC_PARTY.has(n)) return true;
  return n.split(' ').every((t) => GENERIC_PARTY.has(t));
}

/**
 * Party pairs split into two buckets.
 *
 * `cited` — a party pair with a reporter citation, a year, a court name or a case
 * number within `window` characters. That is what an advocate can actually pull,
 * and it is the only bucket `authority_density` counts.
 *
 * `bare` — a party pair with nothing locating it. Reported as a number so a
 * "reads authoritative, cites nothing" answer is visible, but never counted as an
 * authority. This split also keeps a draft's own cause title
 * ("[APPLICANT] versus STATE OF TELANGANA") out of the authority count.
 *
 * The `[[...]]` exclusion is not cosmetic. Measured on the live jrx-prod answer for
 * the regression prompt: the platform correctly said "the specific Supreme Court
 * reporter citations ... are absent from the currently retrieved knowledge corpus"
 * and listed the case names as `[[P. Chidambaram v. Directorate of Enforcement]]`
 * — its anti-fabrication placeholder marker. An earlier version of this function
 * counted that as a DELIVERED authority, so `authority_density` PASSED on the very
 * answer that has no citations. The harness was reproducing the lie it exists to
 * catch. A placeholder is the platform being honest about a gap; counting it as
 * the thing that fills the gap is the worst failure mode available to a checker.
 */
export function detectCaseNames(body: string, window = 90): { cited: string[]; bare: string[] } {
  const text = String(body || '');
  const cited: string[] = [];
  const bare: string[] = [];
  const locator = new RegExp(
    `(?:[(\\[]?(?:1[89]|20)\\d{2}[)\\]]?|${REPORTER_SERIES.join('|')}|Supreme\\s+Court`
    + '|High\\s+Court|CNR\\s+[A-Z0-9]{8,})',
    'i',
  );

  for (const m of text.matchAll(CASE_NAME_PATTERN)) {
    const [full, left, right] = m;
    if (isGenericParty(left) && isGenericParty(right)) continue;
    // A bracketed placeholder INSIDE the pair is a template, not an authority.
    if (/\[[^\]]*\]/.test(full)) continue;
    const at = m.index ?? 0;
    // …and a pair WRAPPED in `[[ ]]` is the platform's own "citation unavailable"
    // marker. Look outward, not just inward.
    if (isPlaceholderWrapped(text, at, full.length)) continue;

    const near = text.slice(Math.max(0, at - window), at + full.length + window);
    (locator.test(near.replace(full, ' ')) ? cited : bare).push(full);
  }

  /* A name that is bracketed in one place and located in another must NOT appear
   * in both buckets — `caseAuthorities` would then count a placeholder as real. */
  const citedOut = dedupe(cited);
  const citedKeys = new Set(citedOut.map((c) => c.toLowerCase()));
  return { cited: citedOut, bare: dedupe(bare).filter((b) => !citedKeys.has(b.toLowerCase())) };
}

/** Is the match enclosed in `[[ … ]]` (the repo's anti-fabrication placeholder)? */
function isPlaceholderWrapped(text: string, at: number, len: number): boolean {
  const before = text.slice(Math.max(0, at - 12), at);
  const after = text.slice(at + len, at + len + 12);
  return /\[\[[^\]]{0,10}$/.test(before) && /^[^[]{0,10}\]\]/.test(after);
}

/**
 * Statutory / constitutional provision references. Used ONLY by
 * `envelope_honesty`'s "is there any citation at all" test — an answer about the
 * limitation period under BNSS legitimately cites no case law, and failing it for
 * that would be a false failure.
 */
export function detectStatutoryCitations(body: string): string[] {
  return dedupe(
    matchAll(String(body || ''), [
      /\b(?:Section|Sections|Sec\.?|S\.|§)\s*\d+[A-Z]{0,2}(?:\s*\(\d+\))?(?:\s+(?:of\s+(?:the\s+)?)?[A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,6}|\s+(?:IPC|CrPC|BNS|BNSS|BSA|CPC|IEA|IT\s+Act|NI\s+Act))?/g,
      /\bArticles?\s+\d+[A-Z]{0,2}\s*(?:\(\d+\))?(?:\s*(?:of\s+the\s+)?Constitution)?/gi,
      /\b(?:Order|Rule|Regulation)\s+[IVXLC\d]+[A-Z]?(?:\s+Rule\s+\d+)?\s+(?:of\s+the\s+)?(?:CPC|Code\s+of\s+Civil\s+Procedure)/gi,
    ]),
  );
}

export function countPlaceholders(body: string): number {
  return matchAll(String(body || ''), PLACEHOLDER_PATTERNS).length;
}

/* ─────────────────── detection: pleading structure ─────────────────── */

/**
 * The measured 8/8 reference bar came from a live `legal-draft-fast` bail
 * application (10,978 chars). Two of those eight — "BNS not IPC" and
 * "placeholders not invented facts" — are separate assertions here, because they
 * are content properties that also apply to non-draft families. What is left is
 * pure Indian pleading structure.
 *
 * Each case declares which keys apply (`requiredStructure`): a legal notice has
 * no cause title and no verification, so demanding all six of every instrument
 * would manufacture failures.
 */
export const STRUCTURE_CHECKS: Readonly<Record<string, RegExp>> = {
  causeTitle:
    /\bIN\s+THE\s+(?:HON'?BLE\s+)?(?:COURT|HIGH\s+COURT|SUPREME\s+COURT|SESSIONS|COURT\s+OF|FAMILY\s+COURT|DISTRICT\s+COURT|TRIBUNAL|NATIONAL\s+COMPANY)/i,
  showeth: /MOST\s+RESPECTFULLY\s+SHOWETH/i,
  prayer: /(?:^|\n)\s*[*#>\s]*\**\s*PRAYER\b|it\s+is\s+(?:therefore\s+)?(?:most\s+respectfully\s+)?prayed/im,
  verification:
    /(?:^|\n)\s*[*#>\s]*\**\s*VERIFICATION\b|do\s+hereby\s+verify\s+that\s+the\s+contents/im,
  numberedParagraphs: /^\s*(?:\d{1,2}\.|\(\d{1,2}\))\s+\S/m,
  /**
   * The signature block. Accepts a bracketed placeholder naming the advocate as
   * well as literal "Counsel for the …".
   *
   * Measured live: a Section 138 notice signed off with
   * `**[[PLACEHOLDER: ADVOCATE NAME / LAW FIRM LETTERHEAD]]**` was marked missing
   * by an earlier version of this pattern, which only accepted `[ADVOCATE …]`.
   * That was a FALSE FAILURE — a correctly-slotted placeholder is the desired
   * output under the anti-fabrication rule, so failing it would have punished the
   * platform for doing the right thing and taught people to ignore red.
   */
  advocateBlock:
    /(?:Counsel\s+for\s+the|Advocate\s+for\s+the|Enrol?lment\s+No|\[+\s*(?:PLACEHOLDER\s*:\s*)?[^\]]*\b(?:ADVOCATE|LAW\s+FIRM|LETTERHEAD)\b[^\]]*\]+)/i,
  placeDate: /Place\s*:/i,
};

/** ≥3 numbered paragraphs — one stray "1." is a list item, not a pleading. */
const MIN_NUMBERED_PARAGRAPHS = 3;

export function scoreStructure(body: string, required: string[]): Record<string, boolean> {
  const text = String(body || '');
  const out: Record<string, boolean> = {};
  for (const key of required) {
    const pattern = STRUCTURE_CHECKS[key];
    if (!pattern) {
      out[key] = false;
      continue;
    }
    if (key === 'numberedParagraphs') {
      const hits = text.match(/^\s*(?:\d{1,2}\.|\(\d{1,2}\))\s+\S/gm) || [];
      out[key] = hits.length >= MIN_NUMBERED_PARAGRAPHS;
      continue;
    }
    if (key === 'placeDate') {
      out[key] = /Place\s*:/i.test(text) && /Date\s*:/i.test(text);
      continue;
    }
    out[key] = pattern.test(text);
  }
  return out;
}

/* ─────────────────── detection: statute currency ─────────────────── */

export interface StatuteCurrency {
  newCodeMentions: number;
  legacyOperativeMentions: number;
  legacyTransitionalMentions: number;
  /** The legacy references that carried no transitional framing. */
  staleReferences: string[];
}

/**
 * Split repealed-code references into transitional (legitimate) and operative
 * (stale). A reference is transitional when transitional language — or the new
 * code itself — appears within `TRANSITIONAL_WINDOW` characters.
 */
export function analyseStatuteCurrency(body: string): StatuteCurrency {
  const text = String(body || '');
  const newCodeMentions = (text.match(NEW_CODE_PATTERN) || []).length;

  let transitional = 0;
  const stale: string[] = [];
  for (const pattern of LEGACY_PROVISION_PATTERNS) {
    for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const at = m.index ?? 0;
      const window = text.slice(
        Math.max(0, at - TRANSITIONAL_WINDOW),
        at + m[0].length + TRANSITIONAL_WINDOW,
      );
      // Remove the match itself so "Code of Criminal Procedure" cannot satisfy
      // its own transitional test through the word "Code".
      if (TRANSITIONAL_MARKER.test(window.replace(m[0], ' '))) transitional += 1;
      else stale.push(m[0].replace(/\s+/g, ' ').trim());
    }
  }

  return {
    newCodeMentions,
    legacyOperativeMentions: stale.length,
    legacyTransitionalMentions: transitional,
    staleReferences: dedupe(stale),
  };
}

/* ─────────────────── detection: fabrication ─────────────────── */

/**
 * Citations that cannot exist. Not a completeness check — a structural one, so it
 * can run with no corpus and no network.
 *   • a decision year in the future
 *   • a Supreme Court Cases volume beyond what has ever been printed
 *   • volume or page zero
 */
export function detectImpossibleCitations(citations: string[], now = new Date()): string[] {
  const currentYear = now.getUTCFullYear();
  const bad: string[] = [];
  for (const c of citations) {
    const year = Number((c.match(/(?:1[89]|20)\d{2}/) || [])[0] || 0);
    if (year > currentYear) {
      bad.push(c);
      continue;
    }
    const bracketed = c.match(/[(\[]\s*(?:1[89]|20)\d{2}\s*[)\]]\s*(\d{1,3})\s+[A-Za-z][A-Za-z .]*?\s+(\d{1,5})/);
    if (bracketed) {
      const volume = Number(bracketed[1]);
      const page = Number(bracketed[2]);
      // SCC has never run past ~20 volumes in a year; 0 is impossible anywhere.
      if (volume === 0 || page === 0 || volume > 20) bad.push(c);
      continue;
    }
    if (/\bAIR\s+(?:1[89]|20)\d{2}\s+\S+\s+0\b/.test(c)) bad.push(c);
  }
  return dedupe(bad);
}

/** Reporter citations in the body that were never in the supplied authority list. */
export function detectUnsuppliedCitations(
  citations: string[],
  supplied: string[] | undefined,
): string[] | null {
  if (!supplied) return null; // not observable ⇒ `na`, never a silent pass
  const haystack = supplied.join(' \u0000 ').toLowerCase().replace(/\s+/g, ' ');
  return citations.filter((c) => !haystack.includes(c.toLowerCase().replace(/\s+/g, ' ')));
}

/* ─────────────────── envelope reading ─────────────────── */

interface EnvelopeView {
  trust: Record<string, unknown> | null;
  citations: unknown;
  fields: Record<string, unknown> | null;
  treatmentSignal: { present: boolean; value: string | null };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Read the parts of an orchestration response the assertions need.
 *
 * Tolerant of the wrapper on purpose: the gateway returns the contract at the top
 * level on some paths and under `data`/`result` on others, and a probe that
 * silently found `undefined` would report a quality failure for a shape mismatch.
 */
export function readEnvelope(raw: Record<string, unknown> | null | undefined): EnvelopeView {
  const root = asRecord(raw) ?? {};
  const inner = asRecord(root.data) ?? asRecord(root.result) ?? {};
  const pick = (key: string): unknown =>
    root[key] !== undefined ? root[key] : inner[key];

  const trust = asRecord(pick('trust'));
  const fields =
    asRecord(pick('fields'))
    ?? asRecord(pick('extractedFields'))
    ?? asRecord(asRecord(pick('analysis'))?.fields);

  const treatmentCandidates = ['goodLaw', 'treatment', 'good_law', 'treatmentStatus'];
  let treatment: { present: boolean; value: string | null } = { present: false, value: null };
  for (const key of treatmentCandidates) {
    const v = pick(key);
    if (v === undefined || v === null) continue;
    const rec = asRecord(v);
    const value = rec
      ? String(rec.status ?? rec.value ?? rec.goodLaw ?? rec.resolution ?? '')
      : String(v);
    treatment = { present: true, value: value || null };
    break;
  }

  return { trust, citations: pick('citations'), fields, treatmentSignal: treatment };
}

/** Body text, wherever the responding path put it. */
export function readBody(raw: Record<string, unknown> | null | undefined): string {
  const root = asRecord(raw) ?? {};
  const inner = asRecord(root.data) ?? asRecord(root.result) ?? {};
  for (const key of ['content', 'response', 'answer', 'text', 'draft']) {
    const v = root[key] ?? inner[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  const curated = asRecord(root.curated) ?? asRecord(inner.curated);
  if (curated && typeof curated.summary === 'string' && curated.summary.trim()) {
    return curated.summary;
  }
  return '';
}

/* ─────────────────── the assertions ─────────────────── */

function result(
  id: AssertionId,
  label: string,
  status: AssertionStatus,
  measured: number | null,
  expected: number | null,
  detail: string,
): AssertionResult {
  return { id, label, status, measured, expected, detail };
}

export function computeMetrics(
  answer: DeliveredAnswer,
  cfg: CounselGradeCaseConfig,
): CounselGradeMetrics {
  const body = String(answer.body || '');
  const reporterCitations = detectReporterCitations(body);
  const names = detectCaseNames(body);
  const statutoryCitations = detectStatutoryCitations(body);
  const env = readEnvelope(answer.envelope);
  const currency = analyseStatuteCurrency(body);
  const structure = scoreStructure(body, cfg.requiredStructure ?? []);
  const unsupplied = detectUnsuppliedCitations(reporterCitations, cfg.suppliedAuthorities);

  const caseAuthorities = dedupe([...reporterCitations, ...names.cited]).length;

  const trustAuthorities =
    env.trust && typeof env.trust.authoritiesDelivered === 'number'
      ? (env.trust.authoritiesDelivered as number)
      : null;

  return {
    reporterCitations,
    citedCaseNames: names.cited,
    bareCaseNames: names.bare,
    statutoryCitations,
    caseAuthorities,
    anyCitations: caseAuthorities + statutoryCitations.length,
    envelopeAuthoritiesDelivered: trustAuthorities,
    envelopeCitationsPresent:
      env.trust && typeof env.trust.citationsPresent === 'boolean'
        ? (env.trust.citationsPresent as boolean)
        : null,
    envelopeQualityOk:
      env.trust && typeof env.trust.qualityOk === 'boolean'
        ? (env.trust.qualityOk as boolean)
        : null,
    // Re-derived with the platform's own counter so the harness grades the
    // shipped expression, not a reimplementation of it.
    envelopeAuthoritiesRederived:
      env.citations === undefined ? null : countDeliveredAuthorities(env.citations),
    structure,
    structureScore: Object.values(structure).filter(Boolean).length,
    newCodeMentions: currency.newCodeMentions,
    legacyOperativeMentions: currency.legacyOperativeMentions,
    legacyTransitionalMentions: currency.legacyTransitionalMentions,
    placeholders: countPlaceholders(body),
    impossibleCitations: detectImpossibleCitations(reporterCitations),
    unsuppliedCitations: unsupplied ?? [],
  };
}

/**
 * Grade one delivered answer against what its case CLAIMS.
 *
 * The `blocked` short-circuit is the most important line in this file. When the
 * answer never arrived, every quality assertion returns `blocked`, not `fail`.
 * A gateway outage rendering as a quality regression is exactly the lie a health
 * probe on the wrong port told during the 51-minute outage, and a red board that
 * means "the network was down" trains people to ignore the board.
 */
export function assessAnswer(
  answer: DeliveredAnswer,
  cfg: CounselGradeCaseConfig,
): CounselGradeAssessment {
  const body = String(answer.body || '');
  const metrics = computeMetrics(answer, cfg);
  const assertions: AssertionResult[] = [];

  const transportOk = !answer.transportError
    && (answer.httpStatus === undefined || answer.httpStatus === 200)
    && body.trim().length > 0;

  assertions.push(
    result(
      'transport',
      'answer was delivered at all',
      transportOk ? 'pass' : 'blocked',
      body.length,
      1,
      transportOk
        ? `http=${answer.httpStatus ?? 'n/a'} body=${body.length} chars`
        : `NOT A QUALITY RESULT — http=${answer.httpStatus ?? 'n/a'} `
          + `error=${answer.transportError ?? 'none'} body=${body.length} chars. `
          + 'Check the platform is up before reading anything below.',
    ),
  );

  if (!transportOk) {
    for (const id of ASSERTION_IDS) {
      if (id === 'transport') continue;
      assertions.push(
        result(id, LABELS[id], 'blocked', null, null, 'not measurable — no answer body'),
      );
    }
    return summarise(cfg, body, metrics, assertions, true);
  }

  /* 1. Length floor — a 400-char "draft" is a failure whatever its structure. */
  if (cfg.minChars === undefined) {
    assertions.push(result('length_floor', LABELS.length_floor, 'na', body.length, null, 'no floor declared'));
  } else {
    const ok = body.length >= cfg.minChars;
    assertions.push(
      result('length_floor', LABELS.length_floor, ok ? 'pass' : 'fail', body.length, cfg.minChars,
        ok ? `${body.length} ≥ ${cfg.minChars} chars`
          : `${body.length} chars < floor ${cfg.minChars} — truncated or refused`),
    );
  }

  /* 2. Authority density — independently regexed from the body. The envelope's
   *    own count is reported alongside but is NOT what decides this. */
  if (cfg.minCaseAuthorities === undefined) {
    assertions.push(
      result('authority_density', LABELS.authority_density, 'na', metrics.caseAuthorities, null,
        'family does not claim case authorities'),
    );
  } else {
    const ok = metrics.caseAuthorities >= cfg.minCaseAuthorities;
    const bare = metrics.bareCaseNames.length;
    assertions.push(
      result('authority_density', LABELS.authority_density, ok ? 'pass' : 'fail',
        metrics.caseAuthorities, cfg.minCaseAuthorities,
        ok
          ? `${metrics.caseAuthorities} locatable authorities `
            + `(reporters=${metrics.reporterCitations.length}, named+located=${metrics.citedCaseNames.length})`
          : `${metrics.caseAuthorities} locatable authorities < ${cfg.minCaseAuthorities} on an `
            + `authority-seeking prompt`
            + (bare > 0 ? ` — ${bare} party pair(s) present but with no citation/year/court to locate them` : '')
            + `; envelope claimed authoritiesDelivered=${metrics.envelopeAuthoritiesDelivered ?? 'absent'}`),
    );
  }

  /* 3. Envelope honesty — the highest-value assertion in the harness. This is
   *    the exact defect that shipped: `citationsPresent: true` over a body with
   *    nothing citable in it. */
  assertions.push(assertEnvelopeHonesty(metrics));

  /* 4. Draft structure. */
  if (!cfg.requiredStructure?.length) {
    assertions.push(result('draft_structure', LABELS.draft_structure, 'na', null, null, 'not a drafting family'));
  } else {
    const need = cfg.minStructureScore ?? cfg.requiredStructure.length;
    const ok = metrics.structureScore >= need;
    const missing = Object.entries(metrics.structure).filter(([, v]) => !v).map(([k]) => k);
    assertions.push(
      result('draft_structure', LABELS.draft_structure, ok ? 'pass' : 'fail',
        metrics.structureScore, need,
        ok ? `${metrics.structureScore}/${cfg.requiredStructure.length} structural elements present`
          : `${metrics.structureScore}/${cfg.requiredStructure.length} < ${need} — missing: ${missing.join(', ')}`),
    );
  }

  /* 5. Statute currency — only for post-1-Jul-2024 criminal matters. */
  assertions.push(assertStatuteCurrency(metrics, cfg));

  /* 6. Anti-fabrication. */
  assertions.push(assertAntiFabrication(metrics, cfg, body.length));

  /* 7. Deterministic fidelity — statute-transition families are the control. */
  if (!cfg.mustContain?.length) {
    assertions.push(result('deterministic_fidelity', LABELS.deterministic_fidelity, 'na', null, null,
      'no deterministic expectations declared'));
  } else {
    const lower = body.toLowerCase();
    const missing = cfg.mustContain.filter((s) => !lower.includes(s.toLowerCase()));
    const hit = cfg.mustContain.length - missing.length;
    assertions.push(
      result('deterministic_fidelity', LABELS.deterministic_fidelity,
        missing.length === 0 ? 'pass' : 'fail', hit, cfg.mustContain.length,
        missing.length === 0
          ? `all ${cfg.mustContain.length} required tokens present`
          : `missing required token(s): ${missing.join(' | ')}`),
    );
  }

  /* 8. Good-law signal. */
  if (!cfg.expectTreatmentSignal) {
    assertions.push(result('good_law_signal', LABELS.good_law_signal, 'na', null, null,
      'family does not claim a treatment signal'));
  } else {
    const env = readEnvelope(answer.envelope);
    const inBody = /\b(good\s+law|still\s+good|overruled|distinguished|followed|affirmed|reversed|per\s+incuriam|doubted|treatment)\b/i
      .test(body);
    const ok = env.treatmentSignal.present || inBody;
    assertions.push(
      result('good_law_signal', LABELS.good_law_signal, ok ? 'pass' : 'fail', ok ? 1 : 0, 1,
        ok
          ? `treatment signal present (envelope=${env.treatmentSignal.value ?? 'n/a'}, body=${inBody})`
          : 'no good-law / treatment signal in the envelope or the body — '
            + 'an honest `unknown` counts as present; silence does not'),
    );
  }

  /* 9. Structured field extraction. */
  if (!cfg.requiredFields?.length) {
    assertions.push(result('structured_fields', LABELS.structured_fields, 'na', null, null,
      'no structured fields expected'));
  } else {
    const env = readEnvelope(answer.envelope);
    const lower = body.toLowerCase();
    const present = cfg.requiredFields.filter((f) => {
      const v = env.fields?.[f];
      if (typeof v === 'string' && v.trim()) return true;
      if (Array.isArray(v) && v.length > 0) return true;
      if (v && typeof v === 'object') return Object.keys(v).length > 0;
      if (typeof v === 'number' || typeof v === 'boolean') return true;
      // Fall back to the body: several analyze paths render fields as headings
      // instead of a `fields` object, and failing those would be a false failure.
      return lower.includes(f.toLowerCase())
        || lower.includes(f.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    });
    const ok = present.length === cfg.requiredFields.length;
    const missing = cfg.requiredFields.filter((f) => !present.includes(f));
    assertions.push(
      result('structured_fields', LABELS.structured_fields, ok ? 'pass' : 'fail',
        present.length, cfg.requiredFields.length,
        ok ? `all ${cfg.requiredFields.length} fields extracted`
          : `missing field(s): ${missing.join(', ')}`),
    );
  }

  return summarise(cfg, body, metrics, assertions, false);
}

const LABELS: Record<AssertionId, string> = {
  transport: 'answer was delivered at all',
  length_floor: 'body clears the family length floor',
  authority_density: 'authorities are actually in the answer body',
  envelope_honesty: 'trust envelope agrees with the body',
  draft_structure: 'pleading carries its structural elements',
  statute_currency: 'post-BNS offence cites the operative code',
  anti_fabrication: 'placeholders instead of invented facts/citations',
  deterministic_fidelity: 'deterministic answer contains its known content',
  good_law_signal: 'good-law / treatment signal is present',
  structured_fields: 'structured extraction returned its fields',
};

/**
 * `trust.citationsPresent` must not be `true` when nothing is citable in the body.
 *
 * Three sub-checks, each able to fail on its own:
 *   (a) `citationsPresent: true` with zero detectable citations of ANY kind —
 *       the shipped defect.
 *   (b) `citationsPresent` disagreeing with the platform's own
 *       `countDeliveredAuthorities(citations)` — the boolean and the object it is
 *       derived from having drifted apart.
 *   (c) `authoritiesDelivered` overstating the body by more than a tolerance.
 *
 * (c) is a tolerance and not equality on purpose: the envelope legitimately counts
 * statutory citations that this regex set will not always shape-match, and an
 * equality test would fire constantly on correct answers. It fires when the
 * envelope claims authorities and the body has NOTHING — which is the real defect
 * — rather than on every off-by-one.
 */
function assertEnvelopeHonesty(m: CounselGradeMetrics): AssertionResult {
  if (m.envelopeCitationsPresent === null && m.envelopeAuthoritiesDelivered === null) {
    return result('envelope_honesty', LABELS.envelope_honesty, 'na', null, null,
      'no trust envelope on this response (deterministic/knowledge route)');
  }

  const problems: string[] = [];

  if (m.envelopeCitationsPresent === true && m.anyCitations === 0) {
    problems.push(
      'trust.citationsPresent=true but the body carries 0 detectable citations '
      + '(0 reporter citations, 0 located case names, 0 statutory references)',
    );
  }
  if (
    m.envelopeCitationsPresent !== null
    && m.envelopeAuthoritiesRederived !== null
    && m.envelopeCitationsPresent !== (m.envelopeAuthoritiesRederived > 0)
  ) {
    problems.push(
      `trust.citationsPresent=${m.envelopeCitationsPresent} disagrees with the platform's own `
      + `countDeliveredAuthorities(citations)=${m.envelopeAuthoritiesRederived}`,
    );
  }
  if ((m.envelopeAuthoritiesDelivered ?? 0) > 0 && m.anyCitations === 0) {
    problems.push(
      `trust.authoritiesDelivered=${m.envelopeAuthoritiesDelivered} but nothing citable is in the body`,
    );
  }

  return result(
    'envelope_honesty', LABELS.envelope_honesty,
    problems.length === 0 ? 'pass' : 'fail',
    m.anyCitations, m.envelopeAuthoritiesDelivered,
    problems.length === 0
      ? `envelope citationsPresent=${m.envelopeCitationsPresent} `
        + `authoritiesDelivered=${m.envelopeAuthoritiesDelivered ?? 'absent'} `
        + `vs body citations=${m.anyCitations} — consistent`
      : problems.join('; '),
  );
}

/**
 * Statute currency, scoped so a legitimately transitional answer cannot fail.
 *
 * `na` unless the case declares `offenceEra: 'post-2024-07-01'`. For a pre-BNS
 * offence, citing IPC/CrPC is the CORRECT answer, and a naive keyword ban would
 * fail the right answer — which is worse than not checking, because it teaches
 * people to ignore red.
 */
function assertStatuteCurrency(
  m: CounselGradeMetrics,
  cfg: CounselGradeCaseConfig,
): AssertionResult {
  if (cfg.offenceEra !== 'post-2024-07-01') {
    return result('statute_currency', LABELS.statute_currency, 'na',
      m.legacyOperativeMentions, null,
      `offenceEra=${cfg.offenceEra ?? 'unset'} — repealed-code references are legitimate here`);
  }
  if (m.newCodeMentions === 0) {
    return result('statute_currency', LABELS.statute_currency, 'fail', 0, 1,
      'no BNS/BNSS/BSA reference at all in an answer about a post-1-Jul-2024 offence');
  }
  if (m.legacyOperativeMentions > 0) {
    return result('statute_currency', LABELS.statute_currency, 'fail',
      m.legacyOperativeMentions, 0,
      `${m.legacyOperativeMentions} repealed-code provision reference(s) with no transitional framing `
      + `(${m.legacyTransitionalMentions} correctly framed as transitional)`);
  }
  return result('statute_currency', LABELS.statute_currency, 'pass', 0, 0,
    `${m.newCodeMentions} new-code reference(s); `
    + `${m.legacyTransitionalMentions} legacy reference(s), all transitional`);
}

/**
 * Anti-fabrication:
 *   (a) a structurally impossible citation (future year, volume 0, SCC vol > 20);
 *   (b) a reporter citation absent from the supplied authority list, when that
 *       list is observable;
 *   (c) facts deliberately withheld from the prompt but no placeholder in the
 *       output — the answer invented them instead of marking the gap.
 */
function assertAntiFabrication(
  m: CounselGradeMetrics,
  cfg: CounselGradeCaseConfig,
  bodyChars: number,
): AssertionResult {
  const problems: string[] = [];
  if (m.impossibleCitations.length > 0) {
    problems.push(`structurally impossible citation(s): ${m.impossibleCitations.join(' | ')}`);
  }
  if (cfg.suppliedAuthorities && m.unsuppliedCitations.length > 0) {
    problems.push(
      `citation(s) not present in the supplied context: ${m.unsuppliedCitations.join(' | ')}`,
    );
  }

  /* The placeholder test needs a real attempt to judge. A truncated or refused
   * answer has no placeholders because it has no content — that defect is already
   * reported by `length_floor`, and reporting it twice would double-count one
   * fault and make the board look worse than the platform is. */
  const substantive = cfg.minChars === undefined || bodyChars >= cfg.minChars;
  const needPlaceholders = cfg.minPlaceholders ?? 3;
  if (cfg.factsWithheld && substantive && m.placeholders < needPlaceholders) {
    problems.push(
      `facts were withheld from the prompt but the answer carries only ${m.placeholders} `
      + `placeholder(s) (< ${needPlaceholders}) across ${bodyChars} chars — the particulars `
      + 'were invented rather than left to be slotted in',
    );
  }

  const claimsSomething = cfg.factsWithheld || !!cfg.suppliedAuthorities || m.reporterCitations.length > 0;
  if (!claimsSomething) {
    return result('anti_fabrication', LABELS.anti_fabrication, 'na', m.placeholders, null,
      'no citations to validate and no facts withheld');
  }

  return result('anti_fabrication', LABELS.anti_fabrication,
    problems.length === 0 ? 'pass' : 'fail',
    m.impossibleCitations.length + m.unsuppliedCitations.length, 0,
    problems.length === 0
      ? `${m.reporterCitations.length} citation(s) structurally valid; placeholders=${m.placeholders}`
      : problems.join('; '));
}

function summarise(
  cfg: CounselGradeCaseConfig,
  body: string,
  metrics: CounselGradeMetrics,
  assertions: AssertionResult[],
  blocked: boolean,
): CounselGradeAssessment {
  const failed = assertions.filter((a) => a.status === 'fail').length;
  const blockedCount = assertions.filter((a) => a.status === 'blocked').length;
  return {
    caseId: cfg.id,
    family: cfg.family,
    bodyChars: body.length,
    blocked,
    metrics,
    assertions,
    passed: assertions.filter((a) => a.status === 'pass').length,
    failed,
    blockedCount,
    ok: failed === 0 && blockedCount === 0,
  };
}

/* ─────────────────── run-to-run regression ─────────────────── */

export interface RegressionFinding {
  caseId: string;
  assertionId: AssertionId;
  from: AssertionStatus;
  to: AssertionStatus;
  detail: string;
}

export interface RegressionReport {
  comparable: boolean;
  regressions: RegressionFinding[];
  improvements: RegressionFinding[];
  /** Cases present before and gone now — a silently shrinking eval set. */
  droppedCases: string[];
  newCases: string[];
}

/**
 * Compare two runs at assertion granularity.
 *
 * `pass → blocked` is NOT a regression: the platform being unreachable says
 * nothing about quality. `blocked → fail` IS one, because the answer arrived and
 * was bad. Getting this direction wrong is how a quality board becomes noise
 * that everybody mutes.
 */
export function diffRuns(
  previous: { cases: CounselGradeAssessment[] } | null,
  current: { cases: CounselGradeAssessment[] },
): RegressionReport {
  if (!previous || !previous.cases?.length) {
    return { comparable: false, regressions: [], improvements: [], droppedCases: [], newCases: [] };
  }

  const prevById = new Map(previous.cases.map((c) => [c.caseId, c]));
  const currById = new Map(current.cases.map((c) => [c.caseId, c]));

  const regressions: RegressionFinding[] = [];
  const improvements: RegressionFinding[] = [];

  for (const [caseId, prev] of prevById) {
    const curr = currById.get(caseId);
    if (!curr) continue;
    const prevByAssertion = new Map(prev.assertions.map((a) => [a.id, a]));
    for (const a of curr.assertions) {
      const before = prevByAssertion.get(a.id);
      if (!before || before.status === a.status) continue;
      const finding: RegressionFinding = {
        caseId, assertionId: a.id, from: before.status, to: a.status, detail: a.detail,
      };
      if (a.status === 'fail' && before.status !== 'fail') regressions.push(finding);
      else if (before.status === 'fail' && a.status === 'pass') improvements.push(finding);
    }
  }

  return {
    comparable: true,
    regressions,
    improvements,
    droppedCases: [...prevById.keys()].filter((id) => !currById.has(id)),
    newCases: [...currById.keys()].filter((id) => !prevById.has(id)),
  };
}
