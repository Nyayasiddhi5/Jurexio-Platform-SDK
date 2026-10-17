/**
 * NV-LEGAL-DRAFT-BEST-001 + NV-SME-LEGAL-DRAFT-002
 * India-first drafting — High Court pleading patterns, humanized advocate voice,
 * context-aware forum (district/court), bail sureties only after grant.
 */

import {
  formatBnssApplicationsOverlay,
  matchBnssCourtApplications,
} from '../data/jrx-bnss-court-applications-pack.js';
import { firmClausesApplyTo, resolveFirmClauseOverlaySync } from './jrx-firm-clause-library.js';
import { DRAFT_COMPLETION_PROMPT_RULE } from './jrx-draft-completion.js';
import {
  CITATION_PROPOSITION_PROMPT_RULE,
  INDIAN_PLEADING_STRUCTURE_CHECKLIST,
} from './jrx-citation-proposition-gate.js';
import {
  formatIndianDraftStructureChecklist,
  isTransactionalDraftDocumentType,
  resolveTransactionalDraftDocumentType,
} from './jrx-indian-draft-structure-registry.js';
import {
  buildDraftDepthHint,
  resolveDraftDocumentType,
  resolveDraftLengthTier,
} from '../config/jrx-draft-length-registry.js';
import { resolveNi138StatutoryNoticeContext } from '../orchestration/jrx-draft-profile-assembler.js';
import {
  buildDocumentTypeDraftOverlays,
  SLP_PAPERBOOK_RULE,
} from './jrx-agent-draft-overlay.js';
import { formatTemplateDraftOverlay } from './jrx-template-draft-prompt-overlay.js';

export const CITE_FROM_SUPPLIED_AUTHORITIES_RULE = `CITATION FROM SUPPLIED AUTHORITIES (mandatory when RAG context present):
- When an "AUTHORITIES SUPPLIED" list appears in context, cite ONLY those authorities by number, case name, and citationRef exactly as given.
- Every legal proposition resting on caselaw must carry an inline citation from that list — never invent reporter cites.
- If no authority was supplied, use [CITATION REQUIRED] rather than fabricating a case name.`;

export type LegalDraftDocFamily =
  | 'petition'
  | 'plaint'
  | 'affidavit'
  | 'notice'
  /* NV-FIRM-CLAUSE-ORCH-001 — `'agreement'` was removed from this union.
   * `indiaStructureFor` gave it a skeleton byte-identical to `contract`,
   * `constraintRuleFor` gave both nothing, and `inferDraftDocFamily` never
   * returned it — so it was an unreachable synonym, and it had already produced
   * a real defect: `FIRM_CLAUSE_ELIGIBLE_FAMILIES` allow-listed `agreement`, a
   * branch that could not execute. Two names for one drafting shape is the
   * duplicate NV-NO-DUPLICATE-001 forbids; making it reachable would have split
   * "MSA" from "agreement to sell" into families that emit the same prompt.
   * Every agreement-shaped input now lands on `contract`, which IS eligible. */
  | 'contract'
  | 'memo'
  | 'opinion'
  | 'fir'
  | 'bail'
  | 'application'
  | 'letter'
  /* NV-DRAFT-BREADTH-P2-001 — eight instruments a litigation practice files
   * weekly. Each is its own family (not a sub-shape of `petition` / `affidavit` /
   * `application`) because the paper-book each Court expects differs materially:
   * an SLP needs a synopsis, list of dates and an AOR certificate; a review may
   * not re-argue merits; an execution petition pleads decree particulars, not
   * a cause of action. */
  | 'rejoinder'
  | 'counter_affidavit'
  | 'review_petition'
  | 'execution_petition'
  | 'caveat'
  | 'written_statement'
  | 'slp'
  | 'interim_application'
  | 'custom';

const INDIA_CORE = `JURISDICTION: India (Republic of India).
Currency: INR (₹). Forum hierarchy: Supreme Court → High Courts of Judicature → District / Sessions / Special Courts → Magistrates / Commercial Courts as applicable.

Criminal (post–1 Jul 2024): cite BNS 2023, BNSS 2023, BSA 2023 — do NOT cite IPC / CrPC / Indian Evidence Act for new offences unless the matter is pre-commencement or expressly transitional.
Civil / commercial: CPC 1908, Specific Relief Act 1963, Limitation Act 1963, Contract Act 1872, Companies Act 2013, Arbitration & Conciliation Act 1996, NI Act 1881, DPDP Act 2023, IT Act 2000 (as amended), GST / SEBI / RBI where relevant.

VOICE (mandatory — SME / High Court pattern):
- Write as a practising Indian advocate drafting for filing before the named Court — precise, measured, respectful, and context-specific.
- Prefer formal Indian pleading English: "Most Respectfully Showeth", "It is most respectfully submitted", "This Hon'ble Court", "Prayer", "Verification", "Advocate for the Applicant/Petitioner".
- Avoid chatbot tone, bullet-essay padding, marketing language, or phrases like "Certainly!", "Here's a draft", "As an AI", "In conclusion".
- Prefer short numbered paragraphs that map facts → legal ingredients → prejudice → relief. Be precise; do not pad.
- Never invent case citations, section numbers, party names, FIR numbers, or court names — use [SQUARE BRACKETS] when missing.

FORUM PRECISION (when supplied in parameters):
- Use exact High Court / District / Sessions / Magistrate name, seat, and State — do not stop at "India".
- Cause title must name the Court as counsel would on a High Court / Sessions paper-book (e.g. "IN THE HIGH COURT OF JUDICATURE AT [SEAT]" or "IN THE COURT OF THE SESSIONS JUDGE, [DISTRICT]").`;

const GLOBAL_CORE = (jur: string) =>
  `JURISDICTION: ${jur}. Use only that jurisdiction's current law and citation conventions. Write in professional counsel voice — human, precise, not chatbot-like. Never invent authorities. Mark missing facts as [TO BE CONFIRMED].`;

const BAIL_SURETY_RULE = `BAIL APPLICATION — SURETIES RULE (mandatory SME rule):
- Do NOT draft surety names, surety amounts, bond schedules, or "furnish X sureties of ₹Y" in the body or Prayer of a bail / anticipatory bail / default bail application.
- At the application stage, the applicant undertakes to abide by such conditions as this Hon'ble Court may impose upon grant.
- Sureties / bonds / personal bond are prepared and filed only AFTER bail is granted, as directed in the order — mention this solely in a short non-operative "Counsel notes" appendix if needed.
- Prayer should seek release on bail / anticipatory bail "on such terms and conditions as this Hon'ble Court may deem fit and proper" — not enumerate sureties.`;

/**
 * A review is NOT an appeal in disguise. The failure mode we are guarding against
 * is a model that happily re-argues the merits, which is the single ground on
 * which review petitions are dismissed at the threshold.
 */
const REVIEW_SCOPE_RULE = `REVIEW PETITION — SCOPE RULE (mandatory):
- A review lies only on a narrow ground: an error apparent on the face of the record, discovery of new and important matter or evidence which despite due diligence was not within the applicant's knowledge or could not be produced earlier, or any other sufficient reason of that same character (CPC Order XLVII Rule 1; Supreme Court: Article 137 read with the Supreme Court Rules 2013).
- A review is NOT a rehearing or an appeal in disguise. Do NOT re-argue the merits, do NOT re-marshal evidence already considered, and do NOT advance a ground that could only have been raised in appeal.
- An erroneous view of law or a possible alternative view is NOT an error apparent on the face of the record — plead the error as self-evident and requiring no elaborate reasoning to detect.
- Identify the error with paragraph-level precision: "in paragraph [PARA NO.] of the judgment dated [DATE], this Hon'ble Court proceeded on the basis that … whereas the record at [PAGE/ANNEXURE] shows …".
- Plead limitation expressly (review of a decree/order: thirty days from the date of the decree or order — Article 124, Limitation Act 1963); if filed beyond it, a condonation prayer is mandatory.
- The prayer is to review and recall/modify the specified judgment or order — not to allow the original petition afresh.`;

/**
 * Rejoinder / counter-affidavit / written statement all fail the same way: the
 * model drafts a fresh case instead of traversing the opposite party's pleading.
 */
const REPLY_PLEADING_SCOPE_RULE = `REPLY PLEADING — TRAVERSE RULE (mandatory):
- A reply pleading answers the opposite party's pleading para-wise. Reproduce or reference the paragraph number being answered ("In reply to paragraph 4 of the [written statement / counter-affidavit / plaint] …") so the Court can read the two documents side by side.
- Every averment must be met explicitly: admitted, denied, or "not admitted for want of knowledge". An averment not specifically denied risks being treated as admitted (CPC Order VIII Rules 3–5).
- Do NOT introduce a new case, a new cause of action, or relief not already claimed — a reply cannot be used to amend or improve the original pleading; that requires an amendment application.
- Denials must be specific, not a blanket "all averments not expressly admitted are denied" alone — that line may be retained as a closing catch-all, but only after para-wise traverse.
- Preliminary objections (maintainability, jurisdiction, limitation, laches, suppression, alternative remedy, non-joinder) go FIRST, before the para-wise reply, and are numbered separately.`;

/**
 * Per-family mandatory SME rules. Kept as a lookup rather than a chain of
 * `family === …` ternaries so the system and user prompt builders cannot drift
 * apart — the bail rule was already required in both.
 */
const FAMILY_CONSTRAINT_RULE: Partial<Record<LegalDraftDocFamily, string>> = {
  bail: BAIL_SURETY_RULE,
  review_petition: REVIEW_SCOPE_RULE,
  slp: SLP_PAPERBOOK_RULE,
  rejoinder: REPLY_PLEADING_SCOPE_RULE,
  counter_affidavit: REPLY_PLEADING_SCOPE_RULE,
  written_statement: REPLY_PLEADING_SCOPE_RULE,
};

/** The mandatory SME constraint block for a family, or '' when it carries none. */
export function constraintRuleFor(family: LegalDraftDocFamily): string {
  return FAMILY_CONSTRAINT_RULE[family] ?? '';
}

export function inferDraftDocFamily(template: string, documentType?: string, instruction?: string): LegalDraftDocFamily {
  const blob = `${template} ${documentType || ''} ${instruction || ''}`.toLowerCase();

  /* NV-DRAFT-BREADTH-P2-001 — ORDERING IS LOAD-BEARING. This is a first-match-wins
   * classifier, so a named instrument must be tested before any generic word it
   * contains. These seven are checked ahead of the FIR / bail / affidavit /
   * petition rules below for a concrete reason: a reply pleading, review, SLP or
   * execution petition in a criminal or writ matter almost always recites the FIR
   * number and the word "petition", and the same shadowing bug was already shipped
   * once in DOC_TYPE_HINTS (nv-court-document-fields.ts), where an incidental FIR
   * reference captured a cheque-dishonour complaint. Specific first, generic last. */

  // Before `counter_affidavit`: a rejoinder ALWAYS names the pleading it answers
  // ("rejoinder to the counter-affidavit"), so the reverse order lets the answered
  // pleading capture the answering one. Measured: this exact phrasing resolved to
  // `counter_affidavit` until this block was moved above it.
  // Also before `notice`: "reply to the written statement" would otherwise be read
  // as correspondence. "Replication" is the CPC-era name for the same instrument.
  if (/\brejoinder\b|\breplication\b|\breply[\s_-]+to[\s_-]+the[\s_-]+(written[\s_-]+statement|counter[\s_-]*affidavit|reply)\b/.test(blob)) {
    return 'rejoinder';
  }
  // Before `affidavit`: a counter-affidavit is the respondent's paper, with
  // preliminary objections and a para-wise traverse the bare affidavit shape lacks.
  if (/\bcounter[\s_-]*affidavit\b|\breply[\s_-]+affidavit\b|\baffidavit[\s_-]+in[\s_-]+(reply|opposition)\b/.test(blob)) {
    return 'counter_affidavit';
  }
  // Before `notice` / `memo`: bare "statement" is too generic to key on.
  // `[\s_-]` throughout this block, not `\s`: callers pass template SLUGS
  // ("written_statement", "special_leave_petition") and `\b` does not fire between
  // a word character and an underscore, so `\s` alone silently dropped every slug
  // form through to `custom`.
  if (/\bwritten[\s_-]+statements?\b|\bcounter[\s_-]?claim\b|\border[\s_-]+viii\b/.test(blob)) {
    return 'written_statement';
  }
  // Before `petition`: a review is not a fresh petition and may not re-argue merits.
  if (/\breview[\s_-]+(petition|application)\b|\bpetition[\s_-]+for[\s_-]+review\b|\breview[\s_-]+of[\s_-]+(the[\s_-]+)?(judgment|judgement|order|decree)\b|\border[\s_-]+xlvii\b|\barticle\s*137\b/.test(blob)) {
    return 'review_petition';
  }
  // Before `petition`: an execution petition pleads decree particulars, not a cause
  // of action. "Darkhast" is the western-India registry name for the same filing.
  if (/\bexecution[\s_-]+(petition|application|proceedings?|case)\b|\bpetition[\s_-]+for[\s_-]+execution\b|\bexecute[\s_-]+(the[\s_-]+)?(decree|award)\b|\bdarkhast\b|\border[\s_-]+xxi\b/.test(blob)) {
    return 'execution_petition';
  }
  if (/\bcaveat\b|\bcaveator\b|\b(section|s\.?)\s*148[\s_-]?a\b/.test(blob)) return 'caveat';
  // Before `petition`: "slp" was previously folded into the generic petition
  // skeleton, which does not produce the synopsis / list of dates / certificate
  // the Supreme Court registry requires.
  if (/\bslp\b|\bspecial[\s_-]+leave[\s_-]+(petition|to[\s_-]+appeal)\b|\barticle\s*136\b/.test(blob)) return 'slp';

  if (/\b(fir|first information)\b/.test(blob)) return 'fir';
  /* `[\s_-]` rather than `\s` / `\b`: callers pass template slugs, and `\b` does
   * not fire between a word character and an underscore, so `bail_application`
   * previously fell through to `custom` and never received the mandatory surety
   * rule. Measured before this change: `inferDraftDocFamily('bail_application')`
   * returned `custom`. */
  if (
    /\b(anticipatory|default|regular|cancellation\s+of)[\s_-]+bail\b|\bbail[\s_-]+application\b|(?:^|[\s_-])bail(?=$|[\s_-])/.test(
      blob,
    )
  ) {
    return 'bail';
  }
  if (
    /\b(discharge|adjournment|remand|compounding|withdrawal\s+from\s+prosecution|plea\s*bargain|proclamation|alteration\s+of\s+charge|material\s+witness|production\s+of\s+documents|suspension\s+of\s+sentence|superdari|revision\s+petition|transfer\s+of\s+case)\b/.test(
      blob,
    )
  ) {
    return 'application';
  }
  /* Deliberately AFTER bail and after the BNSS application list: those two are
   * narrower instruments that also happen to be interlocutory, and the bail path
   * carries the mandatory surety rule which must not be bypassed. Deliberately
   * BEFORE `petition`, because "interim application in the writ petition" is an IA. */
  if (
    /\binterim[\s_-]+application\b|\binterlocutory[\s_-]+application\b|\bi\.a\.\s|\bapplication[\s_-]+for[\s_-]+(ad[\s_-]?interim|interim|temporary)[\s_-]+(relief|injunction|order|stay|direction|custody|maintenance)\b|\bad[\s_-]?interim[\s_-]+(relief|injunction|stay)\b|\btemporary[\s_-]+injunction\b|\border[\s_-]+xxxix\b/.test(
      blob,
    )
  ) {
    return 'interim_application';
  }
  if (/\baffidavit\b/.test(blob)) return 'affidavit';
  if (/\bplaint\b/.test(blob)) return 'plaint';
  /* `[\s_-]`, same slug reason as the block above: `writ_petition` inferred
   * `custom` and therefore received the generic instrument skeleton instead of
   * the High Court paper-book. Measured before this change. */
  if (/(?:^|[\s_-])(writs?|petitions?|wp)(?=$|[\s_-])/.test(blob)) return 'petition';
  /* NV-FIRM-CLAUSE-ORCH-001 — these three ran on `\s` / `\b` and therefore only
   * matched prose, not the template SLUGS partners actually send. Measured before
   * this change: `legal_notice`, `engagement_letter`, `master_services_agreement`
   * and `services_agreement` all inferred `custom` — which is INELIGIBLE for firm
   * clause injection, so the firm's own wording silently no-op'd on exactly the
   * transactional instruments the library exists for.
   *
   * They stay LAST, after every court instrument above, precisely so widening
   * them cannot shadow a pleading: `written_statement`, `counter_affidavit`,
   * `review_petition`, `execution_petition`, `interim_application`, `caveat`,
   * `slp`, `fir`, `bail`, `affidavit`, `plaint` and `petition` have all already
   * returned by the time control reaches here. `tests/unit/jrx-firm-clause-orchestrate.test.ts`
   * asserts that non-shadowing explicitly rather than trusting the ordering. */
  if (/\b(legal|demand|termination|cure|dishonour|dishonor)[\s_-]*notices?\b|\bshow[\s_-]*cause\b|(?:^|[\s_-])notices?[\s_-]+(?:under|of)(?=$|[\s_-])/.test(blob)) {
    return 'notice';
  }
  if (
    /(?:^|[\s_-])(nda|mou|msa|sla|spa|agreements?|contracts?|deeds?|lease|leases|term[\s_-]?sheet|indenture)(?=$|[\s_-])/.test(
      blob,
    )
  ) {
    return 'contract';
  }
  if (/(?:^|[\s_-])(opinions?|advise|advice|memos?|memorand(?:um|a))(?=$|[\s_-])/.test(blob)) return 'memo';
  if (/(?:^|[\s_-])applications?(?=$|[\s_-])/.test(blob)) return 'application';
  if (/(?:^|[\s_-])letters?(?=$|[\s_-])/.test(blob)) return 'letter';
  if (template && template !== 'custom') return 'custom';
  return 'custom';
}

function bnssOverlayFromOpts(opts: {
  template?: string;
  documentType?: string;
  instruction?: string;
  parameters?: Record<string, unknown>;
}): string {
  const blob = [
    opts.template,
    opts.documentType,
    opts.instruction,
    JSON.stringify(opts.parameters || {}),
  ]
    .filter(Boolean)
    .join(' ');
  const matched = matchBnssCourtApplications(blob, 4);
  return formatBnssApplicationsOverlay(matched);
}

function pickParameter(parameters: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = parameters[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function parseStructuredParameterBlock(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* non-fatal */ }
  }
  return null;
}

/** NV-CNR-ORCHESTRATE-MERGE-001 — structured CNR / case facts from partner parameters. */
export function formatCnrCaseContext(parameters?: Record<string, unknown>): string {
  if (!parameters || typeof parameters !== 'object') return '';

  const cnrFacts = parseStructuredParameterBlock(parameters.cnrFacts)
    ?? parseStructuredParameterBlock(parameters.caseContext);
  if (!cnrFacts) return '';

  const lines: string[] = [];
  const map: Array<[string, string[]]> = [
    ['CNR', ['cnr', 'CNR', 'cnrNumber']],
    ['Diary', ['diaryNumber', 'diary']],
    ['Petitioner', ['petitioner', 'petitionerName']],
    ['Respondent', ['respondent', 'respondentName']],
    ['Court', ['courtName', 'court', 'forum']],
    ['High Court', ['highCourt', 'high_court']],
    ['District', ['district']],
    ['Case type', ['caseType', 'case_type', 'natureOfCase']],
    ['Case number', ['caseNumber', 'case_number', 'suitNumber']],
    ['Filing date', ['filingDate', 'filing_date', 'dateOfFiling']],
    ['Registration date', ['registrationDate', 'registration_date']],
    ['Next hearing', ['nextHearingDate', 'next_hearing_date']],
    ['FIR', ['firNumber', 'fir_number', 'firNo']],
    ['Sections / Acts', ['sections', 'sectionsInvoked', 'acts', 'statuteSections']],
    ['Stage', ['stage', 'caseStage']],
  ];
  for (const [label, keys] of map) {
    const val = pickParameter(cnrFacts, ...keys);
    if (val) lines.push(`${label}: ${val}`);
  }
  if (!lines.length) return '';
  return `CNR / MATTER FACTS (gateway-verified — use in cause title and facts; do not invent beyond this):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** NV-MATTER-RECALL-001 — prior matter summary from NSP / matter vault (Option B Phase 3). */
export function formatMatterRecallBlock(parameters?: Record<string, unknown>): string {
  if (!parameters || typeof parameters !== 'object') return '';

  const direct = parameters.matterRecall ?? parameters.matterSummary ?? parameters.matterContext;
  if (typeof direct === 'string' && direct.trim().length > 20) {
    return `MATTER RECALL (from client matter — treat as authoritative for parties, dates, and procedural history):\n${direct.trim()}`;
  }

  const block = parseStructuredParameterBlock(direct)
    ?? parseStructuredParameterBlock(parameters.matter);
  if (!block) return '';

  const summary = pickParameter(block, 'summary', 'matterSummary', 'narrative', 'overview');
  const stage = pickParameter(block, 'stage', 'caseStage', 'proceduralStage');
  const lastOrder = pickParameter(block, 'lastOrder', 'impugnedOrder', 'orderUnderReview');
  const keyDates = pickParameter(block, 'keyDates', 'timeline', 'listOfDates');
  const parties = pickParameter(block, 'parties', 'partySummary');
  const lines = [
    summary && `Summary: ${summary}`,
    stage && `Stage: ${stage}`,
    lastOrder && `Impugned / last order: ${lastOrder}`,
    keyDates && `Key dates: ${keyDates}`,
    parties && `Parties: ${parties}`,
  ].filter(Boolean) as string[];
  if (!lines.length) return '';
  return `MATTER RECALL (from client matter — use in facts and cause title; do not contradict):\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** Extract forum context from partner parameters for prompt injection. */
export function formatForumContext(parameters?: Record<string, unknown>): string {
  if (!parameters || typeof parameters !== 'object') return '';
  const highCourt = pickParameter(parameters, 'highCourt', 'high_court', 'hcName', 'courtOfJudicature');
  const court = pickParameter(parameters, 'courtName', 'court_name', 'court', 'forum', 'trialCourt');
  const district = pickParameter(parameters, 'district', 'districtName', 'district_name');
  const state = pickParameter(parameters, 'state', 'stateName', 'state_name');
  const seat = pickParameter(parameters, 'seat', 'bench', 'place', 'city');
  const policeStation = pickParameter(parameters, 'policeStation', 'police_station', 'ps');
  const lines = [
    highCourt && `High Court: ${highCourt}`,
    court && `Court / Forum: ${court}`,
    district && `District: ${district}`,
    state && `State / UT: ${state}`,
    seat && `Seat / Place: ${seat}`,
    policeStation && `Police Station: ${policeStation}`,
  ].filter(Boolean);

  const cnrBlock = formatCnrCaseContext(parameters);
  const forumBlock = lines.length
    ? `FORUM CONTEXT (use exactly in cause title — do not substitute "India" alone):\n${lines.map((l) => `- ${l}`).join('\n')}`
    : '';
  return [forumBlock, cnrBlock].filter(Boolean).join('\n\n');
}

const GENERIC_INSTRUMENT_STRUCTURE = `STRUCTURE: Complete filing-ready or execution-ready instrument with clear headings, numbered paragraphs, and signature/verification as required. Advocate voice — not chatbot.`;

const PLEADING_COUNSEL_QUALITY_BAR = `QUALITY BAR (ecosystem best-outcome / SME): High Court–pattern, humanized advocate drafting. COMPREHENSIVE paper-book: cause title, Showeth, grounds, Prayer, Verification — not an outline. Context-oriented to the facts and named forum. Never fabricate citations. Templates are practitioner / High Court practice-pattern aids — not sealed certified court forms.`;

function counselQualityBarForDraft(opts: {
  partnerBestOutcome?: boolean;
  family: LegalDraftDocFamily;
  documentType?: string;
  template?: string;
  instruction?: string;
  parameters?: Record<string, unknown>;
}): string {
  if (!opts.partnerBestOutcome) {
    return 'QUALITY BAR: Professional legal drafting in counsel voice. Never fabricate citations.';
  }
  const transactional = resolveTransactionalDraftDocumentType({
    documentType: opts.documentType,
    template: opts.template,
    instruction: opts.instruction,
    parameters: opts.parameters,
  });
  if (transactional || opts.family === 'notice' || opts.family === 'contract') {
    const shape = opts.family === 'contract' || transactional === 'simple_agreement' || transactional === 'complex_agreement'
      ? 'agreement or contract'
      : 'legal notice or statutory demand letter';
    return `QUALITY BAR (ecosystem best-outcome / SME): Complete counsel-grade ${shape} — letterhead, numbered facts, operative clauses or demand/cure timeline, consequences, signature. NOT a Court pleading: do not add Cause title, MOST RESPECTFULLY SHOWETH, Prayer, or Verification unless this instrument type requires them. Context-oriented to supplied facts. Never fabricate citations. Firm clause / boilerplate only where the instrument is commercial.`;
  }
  return PLEADING_COUNSEL_QUALITY_BAR;
}

/** Exported for the drafting-breadth tests: every family must own a real skeleton. */
export function indiaStructureFor(family: LegalDraftDocFamily): string {
  switch (family) {
    case 'petition':
    case 'plaint':
    case 'application':
    case 'bail':
      return `STRUCTURE — High Court / Sessions paper-book pattern (produce ALL that apply):
1. Cause title — exact Court name (High Court of Judicature at [SEAT] / Court of the Sessions Judge, [DISTRICT] / Magistrate), case type, year, parties with status
2. Synopsis / Index of dates & events (if the paper exceeds a short application)
3. MOST RESPECTFULLY SHOWETH — numbered paragraphs: maintainability → facts in chronological narrative → custody/status → grounds (law applied to facts) → no bar / twin conditions where relevant → prejudice if refused
4. Grounds (concise legal submissions — not a textbook essay)
5. Jurisdiction, limitation, and maintainability
6. PRAYER — itemised interim + final relief; for bail: grant on such conditions as the Court deems fit (NO surety schedule)
7. Place, date, advocate enrolment block
8. VERIFICATION by the applicant/deponent
9. Optional non-operative appendix: "Counsel notes (non-operative)" for filing tips only
Use numbered paragraphs. Formal Indian legal English throughout.`;
    case 'affidavit':
      return `STRUCTURE: Cause title → Deponent intro → Numbered averments in first person → Verification → Oath / affirmation block.`;
    case 'notice':
      return `STRUCTURE: Advocate letterhead → Date → Addressee → Subject → Facts → Legal basis → Demand / call to cure → Timeline → Consequences → Without prejudice → Signature.`;
    case 'fir':
      return `STRUCTURE: Police station / district → Complainant → Accused (if known) → Date/time/place → Narrative → BNS sections → Witnesses → Prayer for registration under BNSS.`;
    case 'contract':
      return `STRUCTURE: Title → Parties & Recitals → Definitions → Operative clauses → Schedules → Signature blocks.`;
    case 'memo':
    case 'opinion':
      return `STRUCTURE: Matter reference → Question(s) → Short answer → Facts assumed → Analysis → Options → Recommended next steps → Advocate-review disclaimer. Human counsel tone.`;
    case 'rejoinder':
      return `STRUCTURE — Rejoinder / Replication (produce ALL that apply):
1. Cause title — exact Court, case type and number, year, parties with status, and the pleading being answered ("REJOINDER ON BEHALF OF THE PETITIONER TO THE COUNTER-AFFIDAVIT / WRITTEN STATEMENT FILED BY RESPONDENT NO. [N] DATED [DATE]")
2. Preliminary submissions — that the reply filed by the opposite party does not meet the specific averments of the [plaint/petition]; that the averments therein are denied save as expressly admitted
3. PARA-WISE REJOINDER — paragraph-by-paragraph traverse in the order of the reply being answered: "In reply to paragraph [N] of the counter-affidavit / written statement, it is submitted that …". Each averment admitted, denied, or not admitted for want of knowledge
4. Reiteration — the averments of the [plaint/petition] are reiterated and not repeated for the sake of brevity, with paragraph cross-references
5. Answer to the preliminary objections raised (maintainability, limitation, laches, alternative remedy) — each taken separately and numbered
6. Documents filed with the rejoinder, if any — listed as Annexure R-1, R-2 … with a short description of each
7. PRAYER — that the reply be rejected and the relief prayed for in the [plaint/petition] be granted; no new relief may be introduced here
8. Place, date, advocate enrolment block
9. VERIFICATION by the deponent — which paragraphs are true to personal knowledge and which to information/records and legal advice
Numbered paragraphs throughout. Traverse; do not re-plead the case afresh.`;
    case 'counter_affidavit':
      return `STRUCTURE — Counter-affidavit / Reply affidavit of the respondent (produce ALL that apply):
1. Cause title — exact Court (High Court of Judicature at [SEAT] / Supreme Court of India), case type and number, year, parties with status, followed by "COUNTER-AFFIDAVIT ON BEHALF OF RESPONDENT NO. [N]"
2. Deponent block — name, age, parentage, designation and authority to depose, address; that the deponent is competent to swear this affidavit and is conversant with the facts from the official record
3. PRELIMINARY OBJECTIONS (numbered, before the para-wise reply) — maintainability, absence of a right/enforceable duty, availability of an efficacious alternative remedy, delay and laches, suppression of material facts, non-joinder / mis-joinder, bar of jurisdiction, res judicata
4. PARA-WISE REPLY — "In reply to paragraph [N] of the writ petition, it is submitted that …", answering every paragraph in sequence; each averment admitted, denied, or not admitted for want of knowledge, with the record relied upon
5. The respondent's own case on facts — the sequence of events from the official record, with dates, file references and the authority that acted
6. Legal submissions in support of the impugned action / order — statute, rule, notification, or circular relied upon, quoted only where the text is supplied
7. Annexures — official record relied upon, listed as Annexure R-1, R-2 … each with date and description
8. PRAYER — that the petition be dismissed with costs and any interim order be vacated
9. Place, date, deponent signature; advocate enrolment block
10. VERIFICATION — paragraph-wise split between personal knowledge and official record, followed by the oath / affirmation clause
Numbered paragraphs. Do not concede an averment by silence; do not argue merits before the preliminary objections.`;
    case 'review_petition':
      return `STRUCTURE — Review petition (CPC Order XLVII Rule 1 / Article 137 read with the Supreme Court Rules 2013):
1. Cause title — exact Court, "REVIEW PETITION (CIVIL/CRIMINAL) NO. [ ] OF [YEAR]", followed by "IN [CASE TYPE] NO. [ ] OF [YEAR]" identifying the judgment sought to be reviewed, parties with status
2. Particulars of the judgment / order under review — Court, coram if supplied, date, and the operative direction, reproduced or summarised
3. Limitation — date of the decree/order, date of application, days elapsed, and the applicable article (review of a decree or order: thirty days, Article 124, Limitation Act 1963); if delayed, a separate condonation prayer with reasons
4. Synopsis / brief facts strictly to the extent necessary to locate the error — not a fresh narration of the case
5. GROUNDS FOR REVIEW — confined to the permissible grounds and pleaded as such: (a) error apparent on the face of the record, identified by paragraph number of the judgment and by the record it contradicts; (b) new and important matter or evidence which, after the exercise of due diligence, was not within the applicant's knowledge or could not be produced; (c) any other sufficient reason of a like nature
6. An express averment that the petitioner does not seek a rehearing on the merits and is not re-agitating grounds available in appeal
7. Whether an appeal / SLP against the same judgment has been filed or is pending — state it; do not leave it unstated
8. PRAYER — review and recall / modification of the specified judgment or order, and consequential relief; interim prayer for stay of operation if pressed
9. Place, date, advocate enrolment block
10. VERIFICATION by the petitioner
Numbered paragraphs. The measure of a review petition is precision about the error, not volume.`;
    case 'execution_petition':
      return `STRUCTURE — Execution petition (CPC Order XXI; s.51 modes) (produce ALL that apply):
1. Cause title — Court to which the decree is presented for execution ("IN THE COURT OF THE [DESIGNATION], [DISTRICT]"), "EXECUTION PETITION NO. [ ] OF [YEAR]" arising in [SUIT/CASE] NO. [ ] OF [YEAR], Decree-Holder v. Judgment-Debtor
2. DECREE PARTICULARS (Order XXI Rule 11 — plead each head expressly): number and date of the decree; Court that passed it; names of parties; whether any appeal has been preferred and its result or pendency; whether any payment or adjustment has been made and to what extent; whether any previous execution application was filed and with what result
3. Amount / relief due — principal under the decree, interest as decreed with the rate and period, costs as taxed, less any amount realised; arithmetic shown as a table where amounts are supplied
4. Limitation — twelve years from the date the decree became enforceable (Article 136, Limitation Act 1963); state the reckoning date; for a mandatory injunction the shorter period applies — verify against the decree
5. MODE OF EXECUTION SOUGHT (select and plead only what is pressed, with particulars): delivery of possession of immovable/movable property; attachment and sale of property (identify the property with boundaries / survey or account particulars); attachment of salary or bank account; arrest and detention in civil prison, with the grounds required for it; appointment of a receiver; any manner in which the relief is granted by the decree
6. Particulars of the property or garnishee sought to be attached, in a separate schedule
7. Averment that the decree remains unsatisfied to the extent claimed and that the judgment-debtor has neglected to satisfy it despite [DEMAND/NOTICE DATE]
8. PRAYER — issue of process in the mode sought; interim prayer for attachment before or simultaneously with notice where pressed
9. Place, date, advocate enrolment block
10. VERIFICATION / affidavit in support of the execution application
Numbered paragraphs. A decree cannot be enlarged in execution — the relief claimed must be traced to the decretal text.`;
    case 'caveat':
      return `STRUCTURE — Caveat under CPC s.148A (a short instrument — do NOT pad it into a petition):
1. Cause title — exact Court, "CAVEAT PETITION NO. [ ] OF [YEAR]", and, where already numbered, the proceeding in which the caveat is lodged; caveator's status ("Caveator") and the expected applicant / opposite party
2. Caveator's particulars — full name, age, parentage, address for service, and the capacity in which the caveat is lodged
3. The right or interest of the caveator to appear — the caveator must be a person who would be affected by an order on the expected application, and this must be pleaded
4. The apprehended proceeding — the suit, appeal, application or petition expected to be instituted by [NAME], the subject matter, and the order apprehended (e.g. ex parte interim stay / injunction / appointment of a receiver)
5. Averment that the caveator seeks notice of any application made in the said proceeding before any order is passed
6. NOTICE UNDERTAKING — the caveator has served / undertakes to serve notice of this caveat by registered post with acknowledgement due on the expected applicant, with the date and postal particulars where available
7. Validity — the caveat is effective for ninety days from lodgement; state the date of lodgement
8. PRAYER — that the caveator be issued notice of any application filed by the said party in the apprehended proceeding, and be permitted to appear and be heard before any interim order is passed
9. Place, date, caveator's signature, advocate enrolment block
10. VERIFICATION
Keep it short and exact. Do not draft grounds on the merits of the apprehended proceeding.`;
    case 'written_statement':
      return `STRUCTURE — Written statement (CPC Order VIII) (produce ALL that apply):
1. Cause title — exact Court, suit number and year, Plaintiff v. Defendant, followed by "WRITTEN STATEMENT ON BEHALF OF DEFENDANT NO. [N]"
2. LIMITATION FOR FILING — state the date of service of summons and the date of filing: thirty days from service, extendable by the Court to ninety days on recorded reasons (Order VIII Rule 1); in a commercial suit the outer limit is one hundred and twenty days from service and the right to file stands forfeited thereafter (Order VIII Rule 1 proviso as applicable to commercial disputes). Where the period is exceeded, an application for condonation must accompany the written statement
3. PRELIMINARY OBJECTIONS (numbered, taken first) — maintainability, cause of action, jurisdiction (pecuniary, territorial, subject matter), limitation, non-joinder / mis-joinder of necessary parties, bar of any statute, valuation and court-fee, res judicata, arbitration clause / pre-institution mediation where applicable
4. PARA-WISE REPLY — "In reply to paragraph [N] of the plaint, it is submitted that …" for every paragraph in sequence. Each averment must be admitted, denied, or stated to be not admitted for want of knowledge; a specific denial is required — an evasive or general denial risks the averment being taken as admitted (Order VIII Rules 3–5)
5. ADDITIONAL PLEAS / the defendant's own version of facts — the affirmative case, with dates and documents
6. SET-OFF (Order VIII Rule 6), where claimed — ascertained sum, particulars, and the court-fee position, in a separate schedule
7. COUNTER-CLAIM (Order VIII Rules 6A–6G), where raised — pleaded as a distinct claim with its own cause of action, valuation, limitation, court-fee, and a separate prayer
8. Documents relied upon — list with dates, filed under Order VII Rule 14(3) / Order VIII Rule 1A
9. PRAYER — dismissal of the suit with costs; where a counter-claim is raised, the decree sought on the counter-claim, separately itemised
10. Place, date, advocate enrolment block
11. VERIFICATION by the defendant, and the affidavit / statement of truth in a commercial suit
Numbered paragraphs. Traverse the plaint paragraph by paragraph — do not answer it as a narrative.`;
    case 'slp':
      return `STRUCTURE — Special Leave Petition, Article 136 (Supreme Court paper-book order — produce ALL sections, in this order):
1. Cause title — "IN THE SUPREME COURT OF INDIA", "[CIVIL/CRIMINAL] APPELLATE JURISDICTION", "SPECIAL LEAVE PETITION ([CIVIL/CRIMINAL]) NO. [ ] OF [YEAR]", with the words "(Under Article 136 of the Constitution of India)", the impugned judgment identified by Court, case number and date, and the parties as Petitioner(s) v. Respondent(s)
2. SYNOPSIS — a continuous narrative: what the case is about, what the Court below held, and why the case is fit for the exercise of the discretionary jurisdiction under Article 136 (substantial question of law of general importance, or gross failure of justice). Not a summary of grounds
3. LIST OF DATES AND EVENTS — strictly chronological, one line per entry, date → event, cross-referenced to annexure pages as [PAGE NO.]
4. The petition proper — numbered paragraphs: paragraph 1 stating that the petitioner seeks special leave to appeal against the impugned judgment; the facts; the proceedings below; the findings challenged
5. QUESTIONS OF LAW — each framed as "Whether …", each arising from the impugned judgment, each capable of a yes/no answer, numbered
6. DECLARATION under the Supreme Court Rules — whether any other petition or appeal against the same impugned judgment has been filed by the petitioner, and the result
7. GROUNDS — lettered or numbered, each a self-contained legal proposition applied to the findings below; no repetition of the facts
8. LIMITATION — ninety days from the date of the impugned judgment, or sixty days from refusal of a certificate under Article 134A; state the computation and, if out of time, refer to the accompanying application for condonation of delay
9. PRAYER — grant of special leave to appeal against the impugned judgment; interim prayer (stay of the impugned judgment / of further proceedings) set out separately; "and pass such other order as this Hon'ble Court may deem fit and proper"
10. CERTIFICATE — that the petitioner has not filed any other petition against the impugned judgment; that the SLP is confined to the pleadings and documents that were before the Court below; and that no fresh facts, documents or grounds are urged
11. Place, date, "Advocate-on-Record for the Petitioner(s)" — do not invent an AOR name, code or enrolment number
12. AFFIDAVIT in support of the petition, with verification
13. Appendix / annexures — certified copy of the impugned judgment first, then the record relied upon, each with date and page reference
Formal Supreme Court register. Every section above is a filing requirement, not an option.`;
    case 'interim_application':
      return `STRUCTURE — Interim / interlocutory application in a pending matter (produce ALL that apply):
1. Cause title — exact Court, the pending proceeding ("IN [CASE TYPE] NO. [ ] OF [YEAR]"), "INTERLOCUTORY APPLICATION NO. [ ] OF [YEAR]", the applicant's status in the main matter, and the enabling provision (e.g. CPC Order XXXIX Rules 1 and 2 / Order XXVI / s.151, or the BNSS provision where criminal)
2. Short reference to the main matter — what it is about and its present stage, in two or three paragraphs; do not re-plead the whole case
3. URGENCY — the event or threat that has arisen, when the applicant learnt of it, and why the relief cannot await the final hearing; dates are essential
4. GROUNDS FOR INTERIM RELIEF, pleaded as the three limbs the Court will look for and each answered on the facts: (a) prima facie case; (b) balance of convenience; (c) irreparable injury not compensable in damages. Where a mandatory or ex parte order is sought, plead the additional justification for it
5. Conduct of the applicant — no suppression, no delay in moving, and an offer of an undertaking or security where relevant
6. Whether an earlier application for the same or similar relief was made, and its result — state it
7. Documents relied upon, listed as Annexure A-1, A-2 … with dates
8. PRAYER — the interim relief in precise, executable terms (what the respondent must do or refrain from doing, and until when), an ad-interim prayer pending notice where pressed, and "such other order as this Hon'ble Court may deem fit and proper"
9. Place, date, advocate enrolment block
10. AFFIDAVIT / VERIFICATION in support of the application
Numbered paragraphs. The prayer must be capable of being reproduced verbatim in the Court's order.`;
    case 'letter':
      return `STRUCTURE: Formal business/legal letter with clear ask, legal basis, and next steps.`;
    case 'custom':
      return GENERIC_INSTRUMENT_STRUCTURE;
    default: {
      /* typescript-exhaustive-switch: a newly added LegalDraftDocFamily must fail
       * compilation here until it is given a real skeleton above — the whole point
       * of P2 was that `custom` silently absorbed instruments that needed one. */
      const _exhaustive: never = family;
      void _exhaustive;
      return GENERIC_INSTRUMENT_STRUCTURE;
    }
  }
}

export function buildLegalDraftSystemPrompt(opts: {
  jurisdiction?: string;
  template?: string;
  documentType?: string;
  instruction?: string;
  parameters?: Record<string, unknown>;
  depthHint?: string;
  /** Partner `options.draftLength` / body depth for registry depth hints. */
  draftLength?: unknown;
  partnerBestOutcome?: boolean;
  /**
   * NV-TOKEN-BUDGET-001 — the universal legal overlay already emits the BNSS
   * applications pack and the forum block at its top level before calling this
   * builder, so emitting them again put the identical ~171 + ~40 tokens into
   * one prompt twice. Callers that have already injected them set this false.
   */
  includeBnssAndForum?: boolean;
  /**
   * NV-FIRM-CLAUSE-DRAFT-001 — pre-resolved firm house wording from
   * `resolveFirmClauseOverlay`. Passed in already-rendered rather than resolved
   * here because that source is tenant-scoped and async: this builder is sync and
   * has no request context, and giving it one would put a DB read behind a
   * function every prompt test calls. It is dropped for any family the clause
   * library does not apply to even when a caller supplies it, so a mis-wired
   * route cannot put commercial clauses into a bail application.
   *
   * NV-FIRM-CLAUSE-ORCH-001 — when a caller does NOT pass one, this builder now
   * falls back to `resolveFirmClauseOverlaySync`, which reads the request-scoped
   * context bound by `firmClauseRequestContext`. That fallback is what makes the
   * feature reachable from the orchestrate task types (`legal-draft-fast`,
   * `legal-draft`, `doc-draft-fast`, `document-drafting`): every one of those
   * branches reaches THIS function, directly or via
   * `buildUniversalLegalIntelligenceOverlay`'s `draft` task kind, so wiring here
   * covers all of them instead of one. Outside a request there is no context and
   * the fallback returns '' — so a prompt built by a test or a cron job is
   * unchanged.
   */
  firmClauseOverlay?: string;
  /** Pinned agent id (A-004, A-005, …) for counsel-grade overlays. */
  agentId?: string;
}): string {
  const jurRaw = String(opts.jurisdiction || 'IN').toUpperCase();
  const isIN = jurRaw === 'IN' || jurRaw === 'INDIA';
  const family = inferDraftDocFamily(opts.template || 'custom', opts.documentType, opts.instruction);
  const core = isIN ? INDIA_CORE : GLOBAL_CORE(opts.jurisdiction || jurRaw);
  const structure = isIN ? indiaStructureFor(family) : `Produce a professional ${family} instrument for ${jurRaw} with proper formal structure.`;
  const quality = counselQualityBarForDraft({
    partnerBestOutcome: opts.partnerBestOutcome,
    family,
    documentType: opts.documentType,
    template: opts.template,
    instruction: opts.instruction,
    parameters: opts.parameters,
  });
  const emitBnssAndForum = opts.includeBnssAndForum !== false;
  const bnss = isIN && emitBnssAndForum
    ? bnssOverlayFromOpts({
        template: opts.template,
        documentType: opts.documentType,
        instruction: opts.instruction,
        parameters: opts.parameters,
      })
    : '';
  const forum = isIN && emitBnssAndForum ? formatForumContext(opts.parameters) : '';
  const matterRecall = isIN && emitBnssAndForum ? formatMatterRecallBlock(opts.parameters) : '';
  const templateAnchor = isIN ? formatTemplateDraftOverlay(opts.parameters) : '';
  const constraintRule = isIN ? constraintRuleFor(family) : '';

  // NV-NSP-DRAFT-CONTRACT-001: honour nested NSP drafting requirements.
  const params = opts.parameters || {};
  const nspReqs = params._nspDraftRequirements ?? params.nspDraftRequirements ?? params.requirements;
  let nspBlock = '';
  if (nspReqs != null) {
    const text = typeof nspReqs === 'string' ? nspReqs : JSON.stringify(nspReqs, null, 2);
    nspBlock = `NSP DRAFT REQUIREMENTS (mandatory — honour every item; do not ignore):\n${String(text).slice(0, 6000)}`;
  }
  const tone = params._tone || params.tone;
  const language = params._language || params.language;
  const outFmt = params._outputFormat || params.outputFormat;
  const bnssKey = params._bnssApplicationKey || params.bnssApplicationKey;
  const bnssSections = params._bnssSections || params.bnssSections;
  const metaBits = [
    tone ? `Tone: ${tone}` : '',
    language ? `Language: ${language}` : '',
    outFmt ? `Output format: ${outFmt}` : '',
    bnssKey ? `BNSS application key: ${bnssKey}` : '',
    bnssSections ? `BNSS sections (prefer over CrPC aliases): ${Array.isArray(bnssSections) ? bnssSections.join(', ') : bnssSections}` : '',
  ].filter(Boolean);
  const nspMeta = metaBits.length ? `NSP DRAFT METADATA:\n${metaBits.map((b) => `- ${b}`).join('\n')}` : '';
  /* The family gate is applied to BOTH sources. An explicitly-passed overlay is
   * still dropped for an ineligible family, and the request-scoped fallback is
   * only consulted for an eligible one — so neither route can put negotiated
   * commercial wording into a bail application or an SLP paper-book. */
  const firmClauses = firmClausesApplyTo(family)
    ? String(
        opts.firmClauseOverlay
          || resolveFirmClauseOverlaySync({
            family,
            documentType: opts.documentType,
            template: opts.template,
            practiceArea: typeof params.practiceArea === 'string' ? params.practiceArea : undefined,
            jurisdiction: opts.jurisdiction || jurRaw,
          }),
      )
    : '';

  const resolvedDocType = resolveDraftDocumentType({
    documentType: opts.documentType,
    template: opts.template,
    instruction: opts.instruction,
    parameters: params,
  });
  const draftLengthTier = resolveDraftLengthTier({
    draftLength: opts.draftLength,
    parameters: params,
  });
  const registryDepthHint = buildDraftDepthHint(resolvedDocType, draftLengthTier);
  const transactionalInstrument = isIN && isTransactionalDraftDocumentType(resolvedDocType);
  const documentTypeChecklist = isIN
    ? formatIndianDraftStructureChecklist({
        documentType: resolvedDocType,
        template: opts.template,
        instruction: opts.instruction,
        parameters: params,
      })
    : '';
  const legacyPleadingChecklist = isIN
    && !documentTypeChecklist
    && !isTransactionalDraftDocumentType(resolvedDocType)
    && (family === 'petition' || family === 'bail' || family === 'application')
    ? INDIAN_PLEADING_STRUCTURE_CHECKLIST
    : '';

  const agentOverlay = buildDocumentTypeDraftOverlays({
    agentId: opts.agentId,
    documentType: resolvedDocType,
    parameters: params,
    instruction: opts.instruction,
    prompt: opts.instruction,
  });

  const roleIntro = transactionalInstrument
    ? `You are Jurexio Legal Drafting Intelligence — specialist Indian counsel for statutory notices, demand letters, and commercial agreements (letter/contract voice — NOT a Court paper-book or IRAC memo).`
    : `You are Jurexio Legal Drafting Intelligence — a specialist Indian legal draftsman for the Jurexio ecosystem. You draft as counsel would for the High Court / Sessions Court — not as a generic AI assistant.`;
  return [
    roleIntro,
    core,
    structure,
    quality,
    constraintRule,
    agentOverlay,
    forum,
    matterRecall,
    templateAnchor,
    bnss,
    nspBlock,
    nspMeta,
    /* AFTER the mandatory constraint rule, the structure and the core: block
     * order reinforces the precedence the block itself states. Firm wording is
     * the last substantive instruction before the output contract. */
    firmClauses,
    CITATION_PROPOSITION_PROMPT_RULE,
    CITE_FROM_SUPPLIED_AUTHORITIES_RULE,
    documentTypeChecklist || legacyPleadingChecklist,
    DRAFT_COMPLETION_PROMPT_RULE,
    (opts.depthHint || registryDepthHint) ? `DEPTH: ${opts.depthHint || registryDepthHint}` : '',
    `OUTPUT: ${String(outFmt || 'markdown').toLowerCase() === 'markdown' ? 'Markdown' : String(outFmt || 'Markdown')}. Operative pleading first. Do not wrap the whole draft in a code fence. Placeholders only as [[PLACEHOLDER: …]] for unknown facts — never invent party names, localities, sureties, or reporter citations. Do not preface with chatbot chatter.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildLegalDraftUserPrompt(opts: {
  template: string;
  jurisdiction: string;
  parameters: Record<string, unknown>;
  documentType?: string;
  instruction?: string;
}): string {
  const family = inferDraftDocFamily(opts.template, opts.documentType, opts.instruction);
  const params = JSON.stringify(opts.parameters ?? {}, null, 2);
  const isIN = String(opts.jurisdiction || 'IN').toUpperCase().startsWith('IN');
  const bnss = isIN ? bnssOverlayFromOpts(opts) : '';
  const forum = isIN ? formatForumContext(opts.parameters) : '';
  const matterRecall = isIN ? formatMatterRecallBlock(opts.parameters) : '';
  const templateAnchor = isIN ? formatTemplateDraftOverlay(opts.parameters) : '';
  const transactional = isIN
    && (family === 'notice' || family === 'contract' || resolveTransactionalDraftDocumentType({
      documentType: opts.documentType,
      template: opts.template,
      instruction: opts.instruction,
      parameters: opts.parameters,
    }));
  const voiceLine = transactional
    ? `Draft a complete ${opts.template} in professional Indian counsel letter/contract voice (not a Court paper-book).`
    : `Draft a complete ${opts.template} legal document in High Court / Sessions practice pattern and humanized advocate voice.`;
  let resolvedDocTypeForNi: ReturnType<typeof resolveDraftDocumentType> | undefined;
  try {
    resolvedDocTypeForNi = resolveDraftDocumentType({
      documentType: opts.documentType,
      template: opts.template,
      instruction: opts.instruction,
      parameters: opts.parameters,
    });
  } catch {
    resolvedDocTypeForNi = undefined;
  }
  const userChecklist = isIN
    ? formatIndianDraftStructureChecklist({
      documentType: resolvedDocTypeForNi ?? opts.documentType,
      template: opts.template,
      instruction: opts.instruction,
      parameters: opts.parameters,
    })
    : '';
  const ni138 = resolvedDocTypeForNi
    ? resolveNi138StatutoryNoticeContext({
      documentType: resolvedDocTypeForNi,
      nvTemplateKey: typeof opts.parameters?.nvTemplateKey === 'string'
        ? opts.parameters.nvTemplateKey
        : undefined,
      prompt: [
        opts.instruction,
        opts.template,
        typeof opts.parameters?.instruction === 'string' ? opts.parameters.instruction : '',
      ].filter(Boolean).join(' '),
    })
    : { active: false, promptInjection: '', blockText: '' };
  return [
    voiceLine,
    `Document family (inferred): ${family}`,
    `Jurisdiction code: ${opts.jurisdiction}`,
    forum,
    matterRecall,
    templateAnchor,
    opts.documentType ? `Document type hint: ${opts.documentType}` : '',
    `Parameters / facts (JSON):\n${params}`,
    opts.instruction ? `Additional instruction from counsel/user:\n${opts.instruction}` : '',
    bnss,
    isIN ? constraintRuleFor(family) : '',
    ni138.promptInjection,
    `Requirements:`,
    `- Complete instrument (not an outline)`,
    ...(transactional
      ? [
        `- Letterhead, addressee, subject, numbered facts, operative demand/clauses, timeline, consequences, advocate closing (notices) OR recitals, clauses, IN WITNESS WHEREOF execution block (agreements)`,
        `- Do NOT add Cause title, MOST RESPECTFULLY SHOWETH, PRAYER, or Court VERIFICATION unless the instrument type requires them`,
        `- Jurisdiction-correct statute references; NI Act §138 blocks when applicable`,
        `- If a fact is missing, insert [[PLACEHOLDER: descriptive label]] — never invent party names, amounts, or citations`,
      ]
      : [
        `- Exact forum in cause title when forum fields are present`,
        `- Jurisdiction-correct statute references (BNS/BNSS/BSA for post–1 Jul 2024 criminal matters)`,
        `- Clear headings, numbered paragraphs`,
        `- Signature / verification / prayer blocks where applicable`,
        `- If a fact is missing, insert [[PLACEHOLDER: descriptive label]] — never invent party names, amounts, sureties, or citations`,
        `- Anticipate opposing counsel: explain why this accused is named; rebut omnibus allegations with individual-conduct analysis`,
      ]),
    `- No chatbot preamble`,
    CITATION_PROPOSITION_PROMPT_RULE,
    DRAFT_COMPLETION_PROMPT_RULE,
    userChecklist ? `Structure checklist (mandatory sections):\n${userChecklist}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildLegalSummarizeSystemPrompt(jurisdiction?: string): string {
  const jur = String(jurisdiction || 'IN').toUpperCase();
  const isIN = jur === 'IN' || jur === 'INDIA';
  return [
    `You are Jurexio Legal Summarization Intelligence.`,
    isIN ? INDIA_CORE : GLOBAL_CORE(jurisdiction || jur),
    `Produce an accurate legal summary in counsel language: parties, forum, issues, holdings/obligations, dates, amounts, risk flags.`,
    `Prefer structured Markdown: Executive summary → Key facts → Legal issues → Operative terms / holdings → Open risks → Action items.`,
    `Do not invent facts absent from the source text. Avoid chatbot filler.`,
  ].join('\n\n');
}

export function buildLegalClassifySystemPrompt(jurisdiction?: string): string {
  const jur = String(jurisdiction || 'IN').toUpperCase();
  const isIN = jur === 'IN' || jur === 'INDIA';
  return [
    `You are Jurexio Legal Classification Intelligence.`,
    isIN ? INDIA_CORE : GLOBAL_CORE(jurisdiction || jur),
    `Classify clauses/documents with precise Indian/commercial taxonomy when jurisdiction is India (e.g. arbitration seat India, stamp duty risk, DPDP, Companies Act, NI Act).`,
    `Return only valid JSON as instructed. No markdown fences.`,
  ].join('\n\n');
}

/**
 * @param includeBnss NV-TOKEN-BUDGET-001 — the universal legal overlay already
 * emits the BNSS applications pack from the same query blob before calling this
 * builder. Measured: the identical ~171-token pack appeared twice in one system
 * prompt. Callers that already injected it pass false.
 */
export function buildLegalAdviceSystemPrompt(
  jurisdiction?: string,
  queryHint?: string,
  includeBnss = true,
): string {
  const jur = String(jurisdiction || 'IN').toUpperCase();
  const isIN = jur === 'IN' || jur === 'INDIA';
  const bnss = isIN && queryHint && includeBnss
    ? formatBnssApplicationsOverlay(matchBnssCourtApplications(queryHint, 4))
    : '';
  return [
    `You are Jurexio Legal Counsel Assist — advisory drafting for advocates and in-house counsel.`,
    isIN ? INDIA_CORE : GLOBAL_CORE(jurisdiction || jur),
    `STRUCTURE: Issue → Short answer → Analysis → Options & trade-offs → Recommended next steps → Risks / caveats.`,
    `Be practical for Indian practice (limitation, forum, stamp, vakalatnama, e-filing readiness) when jurisdiction is India. Human counsel tone.`,
    bnss,
    `Never present AI output as a filed pleading or sealed court form.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const LEGAL_DRAFT_ADVOCATE_DISCLAIMER =
  'Disclaimer: AI-assisted draft following High Court / Sessions practice patterns for use by a qualified advocate. Practitioner aid — not a sealed High Court certified form. Verify statutes, facts, stamp duty, limitation, local practice directions, and surety compliance (post-grant) before filing or execution.';
