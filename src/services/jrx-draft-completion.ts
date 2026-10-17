/**
 * NV-DRAFT-COMPLETION-001 — detect and repair abrupt draft endings.
 *
 * Indian pleadings MUST end with complete PRAYER/RELief, signature block
 * placeholder, or formal closing — never mid-sentence or mid-numbered-paragraph.
 */

import {
  DRAFT_LENGTH_REGISTRY,
  validateDraftContentLength,
  type DraftDocumentType,
  type DraftLengthTier,
} from '../config/jrx-draft-length-registry.js';

export interface DraftCompletionAnalysis {
  complete: boolean;
  abruptEnding: boolean;
  missingSections: string[];
  truncatedPrayer: boolean;
  incompleteNumberedPara: boolean;
  hasPrayerOrRelief: boolean;
  hasVerification: boolean;
  hasSignatureBlock: boolean;
  hasDisclosureClause: boolean;
  unresolvedPlaceholders: number;
  reviewRecommended: boolean;
}

/** NV-COUNSEL-STRUCTURE-MARKERS-001 — partner-visible filing readiness probes. */
export interface DraftStructureMarkers {
  prayer: boolean;
  verification: boolean;
  causeTitle: boolean;
  numberedParas: boolean;
  limitationChecked: boolean;
}

/** NV-DRAFT-PLACEHOLDER-DETECT-001 — flag unfilled draft gaps for counsel review. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[\[PLACEHOLDER:[^\]]+\]\]/gi,
  /\[[●•]\]/g,
  /\[[\s_]{2,}\]/g,
  /_{3,}/g,
  /\bTBD\b/gi,
  /\bto be filled\b/gi,
  /\bverify citation before filing\b/gi,
  /\bby date alone\b/gi,
  /\[\[PLACEHOLDER:[^]]*verify[^]]*\]\]/gi,
];

const PRAYER_RE = /\b(PRAYER|PRAYERS|RELIEF(?:S)?(?:\s+SOUGHT)?|PRAYER\s+CLAUSE)\b/i;
const VERIFICATION_RE = /\b(VERIFICATION|VERIFIED\s+AT|I\s+.*(?:hereby\s+)?verify)\b/i;
const SIGNATURE_RE = /\b(Advocate\s+for|Counsel\s+for|Place:\s|Dated:\s|Date:\s|\bDeponent\b)/i;
const FORMAL_CLOSING_RE = /\b(Yours\s+faithfully|Without\s+prejudice|Respectfully\s+submitted|Sincerely)\b/i;

const INCOMPLETE_PARA_TAIL_RE = /(?:^|\n)\s*\d+\.\s+[^\n]{0,400}$/m;
const TRUNCATED_PRAYER_RE = /\b(PRAYER|PRAYERS|RELIEF)\b[^.\n]{0,200}$/im;
const DISCLOSURE_RE =
  /\b(no other petition|has not filed any other|disclose any co[-\s]?accused|substantially similar relief)\b/i;
const CAUSE_TITLE_RE =
  /\b(IN THE (?:HIGH COURT|SUPREME COURT|COURT OF|DISTRICT COURT|SESSIONS)|CAUSE TITLE|MOST RESPECTFULLY SHOWETH)\b/i;
const NUMBERED_PARAS_RE = /(?:^|\n)\s*\d+\.\s+[^\n]{20,}/m;
const LIMITATION_RE =
  /\b(limitation|Article\s+\d+|condonation|within\s+\d+\s+days|prescribed period|days?\s+from|Limitation Act)\b/i;

/** NV-COUNSEL-STRUCTURE-MARKERS-P1-001 — notice/agreement-specific probes. */
const DEMAND_RE =
  /\b(demand|hereby call(?:ed)? upon|required to pay|pay the sum|within \d+ (?:days|hours)|cure period|remit the amount)\b/i;
const NOTICE_TIMELINE_RE =
  /\b(within \d+ days|days from|deadline|on or before|failing which|within the statutory period)\b/i;
const WITNESS_WHEREOF_RE =
  /\b(IN WITNESS WHEREOF|executed this Agreement|execution block)\b/i;
const RECITALS_RE =
  /\b(WHEREAS|RECITALS|Background|between the parties)\b/i;
const AGREEMENT_EXECUTION_RE =
  /\b(Party A|Party B|Witness|Signature|IN WITNESS WHEREOF|________________)\b/i;
const AGREEMENT_CLAUSE_RE =
  /\b(Clause|Article|Section)\s+\d+/i;
const GOVERNING_LAW_RE =
  /\b(governing law|laws of India|Arbitration Act|jurisdiction of courts|dispute resolution)\b/i;

export function isNoticeDocumentType(documentType?: DraftDocumentType): boolean {
  return documentType === 'legal_notice' || documentType === 'reply_legal_notice';
}

export function isAgreementDocumentType(documentType?: DraftDocumentType): boolean {
  return documentType === 'simple_agreement' || documentType === 'complex_agreement';
}

/** Non-pleading drafts use formal closing / execution blocks instead of PRAYER/VERIFICATION. */
export function usesPleadingCompletionRules(documentType?: DraftDocumentType): boolean {
  return !isNoticeDocumentType(documentType) && !isAgreementDocumentType(documentType);
}

export function countUnresolvedDraftPlaceholders(content: string): number {
  const text = String(content || '');
  if (!text.trim()) return 0;
  let count = 0;
  for (const re of PLACEHOLDER_PATTERNS) {
    const clone = new RegExp(re.source, re.flags);
    count += text.match(clone)?.length ?? 0;
  }
  return count;
}

/** R-DRAFT-COMPLETION-DOCTYPE-001 — notices/agreements use structure exit, not pleading PRAYER/VERIFICATION. */
export function analyzeDraftCompletionForDocument(
  content: string,
  documentType?: DraftDocumentType,
): DraftCompletionAnalysis {
  const base = analyzeDraftCompletion(content);
  if (!documentType || usesPleadingCompletionRules(documentType)) {
    return base;
  }
  const markers = analyzeDraftStructureMarkers(content, documentType);
  const exitOk = structureMarkersComplete(markers, documentType);
  if (exitOk) {
    return {
      ...base,
      complete: true,
      abruptEnding: false,
      incompleteNumberedPara: false,
      truncatedPrayer: false,
      reviewRecommended: base.unresolvedPlaceholders > 0,
      missingSections: base.missingSections.filter((s) => s !== 'prayer_or_relief' && s !== 'signature_block'),
    };
  }
  return {
    ...base,
    complete: false,
    reviewRecommended: true,
  };
}

export function analyzeDraftCompletion(content: string): DraftCompletionAnalysis {
  const text = String(content || '').trim();
  const hasPrayerOrRelief = PRAYER_RE.test(text);
  const hasVerification = VERIFICATION_RE.test(text);
  const hasSignatureBlock = SIGNATURE_RE.test(text);
  const hasFormalClosing = FORMAL_CLOSING_RE.test(text);
  const hasDisclosureClause = DISCLOSURE_RE.test(text);
  const unresolvedPlaceholders = countUnresolvedDraftPlaceholders(text);

  const missingSections: string[] = [];
  if (!hasPrayerOrRelief && !hasFormalClosing) missingSections.push('prayer_or_relief');
  if (!hasVerification && /\baffidavit\b/i.test(text)) missingSections.push('verification');
  if (!hasSignatureBlock) missingSections.push('signature_block');
  if (/\b(criminal petition|writ petition|quash)\b/i.test(text) && !hasDisclosureClause) {
    missingSections.push('disclosure_clause');
  }

  const incompleteNumberedPara = INCOMPLETE_PARA_TAIL_RE.test(text)
    && !/[.!?]["')\]]?\s*$/.test(text);
  const truncatedPrayer = TRUNCATED_PRAYER_RE.test(text)
    && !hasVerification
    && !hasSignatureBlock;

  const endsCleanly = /[.!?]["')\]]?\s*$/.test(text)
    || hasVerification
    || hasSignatureBlock
    || hasFormalClosing;

  const abruptEnding = text.length > 80
    && (!endsCleanly || incompleteNumberedPara || truncatedPrayer);

  const complete = !abruptEnding
    && (hasPrayerOrRelief || hasFormalClosing)
    && (hasVerification || hasSignatureBlock || hasFormalClosing);

  const reviewRecommended = abruptEnding
    || missingSections.includes('prayer_or_relief')
    || incompleteNumberedPara
    || truncatedPrayer
    || unresolvedPlaceholders > 0
    || missingSections.includes('disclosure_clause');

  return {
    complete,
    abruptEnding,
    missingSections,
    truncatedPrayer,
    incompleteNumberedPara,
    hasPrayerOrRelief,
    hasVerification,
    hasSignatureBlock,
    hasDisclosureClause,
    unresolvedPlaceholders,
    reviewRecommended,
  };
}

export function hasDraftClosingSections(content: string): boolean {
  const a = analyzeDraftCompletion(content);
  return a.hasPrayerOrRelief && (a.hasVerification || a.hasSignatureBlock);
}

/** Doc-type-aware exit closure — notices/agreements use structure markers, not PRAYER/VERIFICATION. */
export function hasDraftExitClosure(
  content: string,
  documentType?: DraftDocumentType,
): boolean {
  if (!usesPleadingCompletionRules(documentType)) {
    return structureMarkersComplete(
      analyzeDraftStructureMarkers(content, documentType),
      documentType,
    );
  }
  return hasDraftClosingSections(content);
}

/** Scan draft text for Indian counsel filing structure markers (§H P0 / P1 doc-type-aware). */
export function analyzeDraftStructureMarkers(
  content: string,
  documentType?: DraftDocumentType,
): DraftStructureMarkers {
  const text = String(content || '');

  if (isNoticeDocumentType(documentType)) {
    return {
      prayer: DEMAND_RE.test(text),
      verification: SIGNATURE_RE.test(text) || FORMAL_CLOSING_RE.test(text),
      causeTitle: true,
      numberedParas: NUMBERED_PARAS_RE.test(text)
        || /\b(FACTS|Subject:|Ref:|Under Section)\b/i.test(text),
      limitationChecked: NOTICE_TIMELINE_RE.test(text) || LIMITATION_RE.test(text),
    };
  }

  if (isAgreementDocumentType(documentType)) {
    return {
      prayer: WITNESS_WHEREOF_RE.test(text) || AGREEMENT_EXECUTION_RE.test(text),
      verification: AGREEMENT_EXECUTION_RE.test(text),
      causeTitle: RECITALS_RE.test(text) || /\b(AGREEMENT|between)\b/i.test(text),
      numberedParas: NUMBERED_PARAS_RE.test(text) || AGREEMENT_CLAUSE_RE.test(text),
      limitationChecked: GOVERNING_LAW_RE.test(text),
    };
  }

  return {
    prayer: PRAYER_RE.test(text),
    verification: VERIFICATION_RE.test(text),
    causeTitle: CAUSE_TITLE_RE.test(text),
    numberedParas: NUMBERED_PARAS_RE.test(text),
    limitationChecked: LIMITATION_RE.test(text),
  };
}

export function structureMarkersComplete(
  markers: DraftStructureMarkers,
  documentType?: DraftDocumentType,
): boolean {
  if (isNoticeDocumentType(documentType)) {
    return markers.prayer
      && markers.verification
      && markers.numberedParas
      && markers.limitationChecked;
  }
  if (isAgreementDocumentType(documentType)) {
    return markers.prayer
      && markers.verification
      && markers.causeTitle
      && markers.numberedParas;
  }
  return markers.prayer
    && markers.verification
    && markers.causeTitle
    && markers.numberedParas;
}

function closureTemplate(documentType?: DraftDocumentType): string {
  if (documentType === 'legal_notice' || documentType === 'reply_legal_notice') {
    return [
      '',
      '**Without prejudice to our client\'s rights and remedies**',
      '',
      'Yours faithfully,',
      '',
      '[[PLACEHOLDER: Advocate name]]',
      '[[PLACEHOLDER: Enrolment number]]',
      'Counsel for [[PLACEHOLDER: Client name]]',
    ].join('\n');
  }
  if (documentType === 'simple_agreement' || documentType === 'complex_agreement') {
    return [
      '',
      '**IN WITNESS WHEREOF** the parties have executed this Agreement on the date first written above.',
      '',
      'Party A: _________________________',
      'Party B: _________________________',
      '',
      'Witness 1: _________________________',
      'Witness 2: _________________________',
    ].join('\n');
  }
  if (documentType === 'legal_opinion' || documentType === 'case_summary') {
    return [
      '',
      '**Recommended next steps**',
      '[[PLACEHOLDER: Next steps for counsel]]',
      '',
      'This opinion is furnished for the exclusive use of the instructing advocate and is not to be relied upon by third parties without express written consent.',
    ].join('\n');
  }
  return [
    '',
    '**PRAYER**',
    'It is, therefore, most respectfully prayed that this Hon\'ble Court may be pleased to:',
    'a) [[PLACEHOLDER: Primary relief mapped to the facts above]];',
    'b) Pass such other and further order(s) as this Hon\'ble Court may deem fit and proper in the facts and circumstances of the case.',
    '',
    'Place: [[PLACEHOLDER: Place]]',
    'Date: [[PLACEHOLDER: Date]]',
    '',
    '[[PLACEHOLDER: Advocate name]]',
    '[[PLACEHOLDER: Enrolment number]]',
    'Advocate for the Applicant / Petitioner',
    '',
    '**VERIFICATION**',
    'I, the deponent above-named, do hereby verify that the contents of the above application / petition are true and correct to the best of my knowledge and belief, and no part of it is false and nothing material has been concealed therefrom.',
    '',
    'Verified at [[PLACEHOLDER: Place]] on this [[PLACEHOLDER: Date]].',
    '',
    '                                                                    Deponent',
  ].join('\n');
}

export interface DraftCompletionPolishResult {
  content: string;
  analysis: DraftCompletionAnalysis;
  appendedClosure: boolean;
  reviewRecommended: boolean;
  trimmedRunaway?: boolean;
}

/**
 * IN-AGREE-001 — soft trim when counsel agreement drafts balloon past registry char max
 * (completion polish only; does not lower partner maxTokens).
 */
export function trimTransactionalDraftRunaway(
  content: string,
  documentType?: DraftDocumentType,
  tier: DraftLengthTier = 'comprehensive',
): { content: string; trimmed: boolean } {
  if (!documentType || !isAgreementDocumentType(documentType)) {
    return { content, trimmed: false };
  }
  const validation = validateDraftContentLength(content, documentType, tier);
  if (!validation.aboveMax) return { content, trimmed: false };

  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  const softMax = Math.ceil(spec.charRangeMax * 1.12);
  const text = String(content || '').trim();
  if (text.length <= softMax) return { content: text, trimmed: false };

  const witnessIdx = text.search(/\bIN WITNESS WHEREOF\b/i);
  const witnessTail = witnessIdx >= 0
    ? text.slice(witnessIdx).trim()
    : closureTemplate(documentType).trim();
  const body = witnessIdx >= 0 ? text.slice(0, witnessIdx).trimEnd() : text;
  const bodyBudget = Math.max(spec.charRangeMin, softMax - witnessTail.length - 4);
  let trimmedBody = body.slice(0, bodyBudget);
  const paraBreak = trimmedBody.lastIndexOf('\n\n', bodyBudget);
  if (paraBreak > spec.charRangeMin * 0.6) {
    trimmedBody = trimmedBody.slice(0, paraBreak).trimEnd();
  }
  return {
    content: `${trimmedBody}\n\n${witnessTail}`,
    trimmed: true,
  };
}

/**
 * Append a closure template when abrupt ending detected; always flag review when incomplete.
 */
export function applyDraftCompletionPolish(
  content: string,
  opts: {
    documentType?: DraftDocumentType;
    appendClosure?: boolean;
    tier?: DraftLengthTier;
    trimRunaway?: boolean;
  } = {},
): DraftCompletionPolishResult {
  let working = String(content || '');
  let trimmedRunaway = false;
  if (opts.trimRunaway !== false && opts.documentType) {
    const trimmed = trimTransactionalDraftRunaway(
      working,
      opts.documentType,
      opts.tier ?? 'comprehensive',
    );
    working = trimmed.content;
    trimmedRunaway = trimmed.trimmed;
  }

  const analysis = analyzeDraftCompletion(working);
  if (!analysis.abruptEnding && analysis.complete && !trimmedRunaway) {
    return { content: working, analysis, appendedClosure: false, reviewRecommended: false };
  }

  const shouldAppend = opts.appendClosure !== false
    && (analysis.abruptEnding || analysis.missingSections.includes('prayer_or_relief'));

  let out = working.trimEnd();
  let appendedClosure = false;
  if (shouldAppend && !hasDraftExitClosure(out, opts.documentType)) {
    out = `${out}\n${closureTemplate(opts.documentType)}`;
    appendedClosure = true;
  }

  const postAnalysis = analyzeDraftCompletion(out);
  return {
    content: out,
    analysis: postAnalysis,
    appendedClosure,
    trimmedRunaway,
    reviewRecommended: postAnalysis.reviewRecommended || analysis.reviewRecommended || trimmedRunaway,
  };
}

/** Prompt block injected into legal drafting system prompts. */
export const DRAFT_COMPLETION_PROMPT_RULE = `NV-DRAFT-COMPLETION-001 (mandatory):
- The draft MUST end with a complete PRAYER / RELIEF section (for court instruments), formal closing (for notices/letters), or signature / verification block — NEVER mid-sentence or mid-numbered paragraph.
- Numbered paragraphs must be grammatically complete; do not stop after "It is submitted that" or an unfinished list item.
- For affidavits / applications / petitions: include PRAYER (itemised relief), Place & Date, advocate block, and VERIFICATION / oath clause.
- For legal notices: include demand, timeline, consequences, and advocate letterhead closing.
- If facts are insufficient for a specific prayer, use [[PLACEHOLDER: …]] — but still produce the closing structure in full.`;
