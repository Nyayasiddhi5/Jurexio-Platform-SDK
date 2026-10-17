/**
 * NV-INDIAN-STRUCTURE-001 — per-documentType mandatory section checklists.
 *
 * Indian counsel / High Court paper-book practice. Consumed by
 * `buildLegalDraftSystemPrompt()` and partner orchestrate when
 * `parameters.documentType` is present.
 */

import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';
import { resolveDraftDocumentType } from '../config/jrx-draft-length-registry.js';

export const INDIAN_DRAFT_STRUCTURE_MARKER = 'NV-INDIAN-DRAFT-STRUCTURE-001';

/** Mandatory sections per partner registry documentType (all 20 keys). */
export const INDIAN_DRAFT_STRUCTURE_CHECKLIST: Readonly<Record<DraftDocumentType, readonly string[]>> = {
  bail_application: [
    'Cause title — exact Court (High Court / Sessions / Magistrate), case type, year, parties with status',
    'FIR synopsis — police station, FIR number, BNS sections (post–1 Jul 2024), date of arrest/custody if applicable',
    'MOST RESPECTFULLY SHOWETH — numbered facts: custody status, individual role, no surety schedule in prayer',
    'Grounds — twin conditions / statutory bail grounds applied to facts; rebut omnibus allegations',
    'PRAYER — release on bail on such terms as Court deems fit (NO surety names/amounts pre-grant)',
    'Place, date, advocate enrolment block',
    'VERIFICATION by applicant/deponent',
  ],
  criminal_petition: [
    'Cause title — exact Court, criminal petition number, year, Petitioner v. State/Respondents',
    'List of dates and events (when paper exceeds short application)',
    'Memo of parties with status',
    'MOST RESPECTFULLY SHOWETH — maintainability, chronological facts, impugned order/FIR particulars',
    'Grounds — numbered legal submissions; anticipate opposing counsel; individual-conduct analysis for co-accused',
    'Disclosure clause — no other petition for same/substantially similar relief (or disclose related proceedings in [[PLACEHOLDER: …]])',
    'PRAYER — itemised interim + final relief in executable terms',
    'VERIFICATION',
    'Vakalatnama / advocate block',
  ],
  writ_petition: [
    'Cause title — IN THE HIGH COURT OF JUDICATURE AT [SEAT] / SUPREME COURT as applicable; WP/SLP number',
    'Synopsis / index of dates (for full paper-book)',
    'Memo of parties — Petitioner(s) v. Respondent(s) with official designations',
    'MOST RESPECTFULLY SHOWETH — maintainability, Article 226/32 jurisdiction, facts in chronological narrative',
    'Grounds — lettered/numbered: (A) maintainability (B) violation of statutory/constitutional rights (C) prejudice',
    'Affidavit in support — reference by annexure number',
    'PRAYER — writ of mandamus/certiorari/prohibition or direction in precise terms',
    'VERIFICATION',
    'Vakalatnama block',
  ],
  petition_application: [
    'Cause title — Court, case type, year, parties',
    'Synopsis (if not a short application)',
    'MOST RESPECTFULLY SHOWETH — numbered paragraphs: facts → legal basis → prejudice',
    'Grounds — concise submissions mapped to facts',
    'Jurisdiction, limitation, maintainability',
    'PRAYER — itemised relief',
    'VERIFICATION',
    'Advocate block',
  ],
  interlocutory_application: [
    'Cause title — pending proceeding number + IA number',
    'Short reference to main matter and stage',
    'Urgency — event/threat, date learnt, why cannot await final hearing',
    'Grounds — prima facie case, balance of convenience, irreparable injury (each answered on facts)',
    'PRAYER — interim relief in terms reproducible verbatim in Court order',
    'Affidavit / verification in support',
  ],
  civil_suit_plaint: [
    'Cause title — Court, suit number, Plaintiff v. Defendant(s)',
    'Statement of jurisdiction and valuation / court-fee',
    'Cause of action — date and place',
    'Facts — numbered paragraphs in chronological order',
    'Legal grounds and relief claimed',
    'List of documents (Order VII Rule 14)',
    'PRAYER — decree sought, itemised',
    'Verification / affidavit where required',
    'Advocate block',
  ],
  written_statement: [
    'Cause title — suit number, WRITTEN STATEMENT on behalf of Defendant No. [N]',
    'Limitation for filing — date of service, date of filing (30/90/120 days per Order VIII)',
    'Preliminary objections — numbered first (jurisdiction, limitation, non-joinder, etc.)',
    'Para-wise reply — "In reply to paragraph [N] of the plaint …" — admit/deny/not admitted',
    'Defendant\'s own version of facts',
    'Set-off / counter-claim schedules if claimed',
    'PRAYER — dismissal of suit with costs',
    'VERIFICATION',
  ],
  rejoinder: [
    'Cause title — pleading being answered identified by date and party',
    'Preliminary submissions',
    'Para-wise rejoinder — traverse each paragraph of written statement/counter-affidavit',
    'Reiteration of plaint/petition averments with cross-references',
    'Answer to preliminary objections — numbered separately',
    'PRAYER — reject opposite party\'s reply; grant original relief',
    'VERIFICATION',
  ],
  divorce_petition: [
    'Cause title — family Court / District Court, matrimonial petition number',
    'Parties — marriage date, place, religion (if relevant for applicable Act)',
    'Facts — separation, grounds under Hindu Marriage Act / Special Marriage Act / etc.',
    'Children / maintenance / custody particulars in [[PLACEHOLDER: …]] if unknown',
    'Grounds — statutory ingredients mapped to facts',
    'PRAYER — decree of divorce, ancillary relief',
    'VERIFICATION',
    'Advocate block',
  ],
  written_arguments: [
    'Cause title — proceeding number, stage (final hearing / admission)',
    'Brief facts (non-repetitive)',
    'Issues framed / questions for determination',
    'Submissions — numbered, each with authority or [CITATION REQUIRED]',
    'Relief sought at this stage',
    'Advocate block',
  ],
  final_arguments: [
    'Cause title and coram if supplied',
    'Chronology / list of dates (condensed)',
    'Issues and findings challenged',
    'Submissions on merits — opening, facts, law, rebuttal points',
    'Oral argument summary / written note for record',
    'PRAYER — allow appeal / dismiss petition as applicable',
  ],
  legal_notice: [
    'Advocate letterhead / firm details',
    'Date and addressee with correct designation',
    'Subject line — statutory basis (e.g. NI Act s.138, contract breach)',
    'Parties — sender and recipient identities',
    'Facts — chronological narrative of default/breach',
    'Legal basis — enactment, section, ingredients',
    'Demand — specific sum/action and cure period (typically 15/30 days per statute)',
    'Consequence — statutory/civil action if non-compliance',
    'Timeline — clear deadline date',
    'Without prejudice reservation where appropriate',
    'Signature block — advocate for sender',
  ],
  reply_legal_notice: [
    'Advocate letterhead, date, reference to incoming notice dated [DATE]',
    'Denial/admission para-wise of notice allegations',
    'Client\'s version of facts',
    'Legal rebuttal — why demand is untenable',
    'Counter-demand or reservation of rights if applicable',
    'Closing — call upon sender to withdraw/threaten proceedings',
    'Signature block',
  ],
  affidavit_simple: [
    'Cause title or matter reference',
    'Deponent block — name, age, parentage, address, capacity',
    'Numbered averments in first person',
    'Verification — personal knowledge vs information/belief split',
    'Oath / affirmation clause',
  ],
  affidavit_case: [
    'Cause title — exact Court, case number, "AFFIDAVIT ON BEHALF OF [PARTY]"',
    'Deponent introduction and authority to depose',
    'Numbered averments — facts in first person with annexure references',
    'Annexure list — A-1, A-2 with dates and descriptions',
    'Verification paragraph-wise',
    'Oath / affirmation before Notary/Oath Commissioner',
  ],
  counter_affidavit: [
    'Cause title — COUNTER-AFFIDAVIT on behalf of Respondent No. [N]',
    'Deponent block and official-record authority',
    'Preliminary objections — numbered before para-wise reply',
    'Para-wise reply to writ petition/petition paragraphs',
    'Respondent\'s own case on facts from official record',
    'Legal submissions supporting impugned action/order',
    'Annexures R-1, R-2 — official record relied upon',
    'PRAYER — dismiss petition with costs',
    'VERIFICATION',
  ],
  simple_agreement: [
    'Title and date',
    'Parties — names, addresses, capacity (company/individual)',
    'Recitals — background and purpose',
    'Definitions — material terms',
    'Operative clauses — obligations, consideration, term, termination',
    'Boilerplate — governing law (India), dispute resolution, notices, assignment',
    'Schedules if any',
    'Execution blocks — signatures, witnesses, stamp duty note in [[PLACEHOLDER: …]]',
  ],
  complex_agreement: [
    'Title, date, and transaction summary recitals',
    'Parties and affiliates / guarantors',
    'Definitions and interpretation clause',
    'Operative commercial clauses — price, conditions precedent, warranties, indemnity, limitation of liability',
    'Regulatory compliance — GST, DPDP if personal data, stamp duty',
    'Dispute resolution — Arbitration Act 1996 seat India or exclusive jurisdiction',
    'Schedules — disclosure, IP, SLA, escrow as applicable',
    'Execution — board resolutions reference in [[PLACEHOLDER: …]], signatories',
  ],
  legal_opinion: [
    'Matter reference and addressee',
    'Question(s) presented',
    'Short answer upfront',
    'Facts assumed / documents reviewed',
    'Applicable law and analysis',
    'Options and trade-offs',
    'Risks and caveats',
    'Recommended next steps',
    'Advocate-review disclaimer — not a filed pleading',
  ],
  case_summary: [
    'Case citation / CNR / court metadata if supplied',
    'Parties and forum',
    'Procedural history — list of dates (condensed)',
    'Issues',
    'Findings / holdings',
    'Operative order / relief granted',
    'Implications and next steps',
  ],
  review_petition: [
    'Cause title — REVIEW PETITION identifying judgment under review',
    'Particulars of impugned judgment/order — date, coram, operative direction',
    'Limitation — Article 124 Limitation Act; condonation if delayed',
    'Grounds confined to Order XLVII / Article 137 — error apparent, not rehearing',
    'PRAYER — review and recall/modify specified order',
    'VERIFICATION',
  ],
  execution_petition: [
    'Cause title — EXECUTION PETITION in parent suit/decree',
    'Decree particulars — Order XXI Rule 11 heads',
    'Amount/relief due with arithmetic',
    'Mode of execution sought with property particulars',
    'PRAYER — issue execution process',
    'VERIFICATION / affidavit in support',
  ],
  revision_petition: [
    'Cause title — REVISION PETITION under s.115 CPC (civil) identifying the impugned order and subordinate Court',
    'Particulars of impugned order — date, Court, case number, operative direction sought to be revised',
    'Jurisdictional foundation — the subordinate Court exercised jurisdiction not vested / failed to exercise / acted illegally or with material irregularity (s.115 grounds, NOT a re-appreciation of evidence)',
    'Limitation — 90 days from the impugned order (Article 131 Limitation Act); condonation application referenced if delayed',
    'Grounds — numbered submissions confined to the s.115 revisional jurisdiction',
    'PRAYER — set aside / vary the impugned order; interim stay where sought',
    'VERIFICATION',
    'Advocate enrolment block',
  ],
  cross_objection: [
    'Cause title — CROSS-OBJECTION under Order XLI Rule 22 CPC in the pending appeal (appeal number, year, parties with appellate status)',
    'Reference to the appeal and the decree/judgment under appeal, and the respondent-cross-objector\'s status',
    'Limitation — one month from service of notice of the appeal / date fixed for hearing (Order XLI Rule 22); condonation if delayed',
    'Objections — numbered grounds against the part of the decree the respondent challenges (findings decided against the respondent below)',
    'Legal grounds mapped to the impugned findings',
    'PRAYER — modify/reverse the specified part of the decree in the respondent\'s favour',
    'VERIFICATION',
    'Advocate enrolment block',
  ],
  caveat: [
    'Cause title — CAVEAT PETITION under s.148-A CPC, exact Court, and (where numbered) the proceeding in which the caveat is lodged; caveator\'s status',
    'Caveator particulars — name, age, parentage, address for service, and capacity in which the caveat is lodged',
    'Right/interest to be heard — how the caveator would be affected by an order on the apprehended application',
    'Apprehended proceeding — the suit/appeal/application expected to be instituted, the party, subject matter, and the order apprehended (ex parte stay/injunction/receiver)',
    'Notice undertaking — caveator has served / undertakes to serve notice of the caveat by RPAD on the expected applicant',
    'Validity — 90 days from lodgement (state the date of lodgement)',
    'PRAYER — that the caveator be issued notice and heard before any interim order is passed',
    'Place, date, caveator signature, advocate enrolment block; VERIFICATION',
  ],
  general_legal_document: [
    'Document title and date — identify the instrument kind from prompt and attachments',
    'Parties — names, addresses, capacity (individual/company/government)',
    'Recitals or background — purpose and factual context in chronological order',
    'Legal basis — applicable enactments, sections, or contractual principles',
    'Substantive body — numbered clauses/paragraphs mapped to supplied facts',
    'Relief, obligations, or operative terms — precise and executable',
    'Boilerplate — governing law (India), notices, severability where applicable',
    'Execution / filing block — signatures, verification, or court heading as appropriate',
    'Use [[PLACEHOLDER: …]] for unknown facts — never invent parties, dates, or amounts',
  ],
};

export function getIndianDraftStructureChecklist(documentType: DraftDocumentType): readonly string[] {
  return INDIAN_DRAFT_STRUCTURE_CHECKLIST[documentType];
}

export function formatIndianDraftStructureChecklist(input: {
  documentType?: unknown;
  draftType?: unknown;
  template?: unknown;
  taskType?: unknown;
  prompt?: unknown;
  instruction?: unknown;
  parameters?: Record<string, unknown>;
}): string {
  const docType = resolveDraftDocumentType(input);
  const sections = INDIAN_DRAFT_STRUCTURE_CHECKLIST[docType];
  if (!sections?.length) return '';
  const lines = sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `${INDIAN_DRAFT_STRUCTURE_MARKER} (mandatory sections for \`${docType}\` — produce ALL; use [[PLACEHOLDER: …]] for unknown facts):
${lines}`;
}

/** R-DRAFT-NSP-QUALITY P0 — notices/agreements use letter/contract bars, not paper-book. */
const TRANSACTIONAL_DRAFT_DOCUMENT_TYPES: ReadonlySet<DraftDocumentType> = new Set([
  'legal_notice',
  'reply_legal_notice',
  'simple_agreement',
  'complex_agreement',
]);

export function isTransactionalDraftDocumentType(documentType: DraftDocumentType): boolean {
  return TRANSACTIONAL_DRAFT_DOCUMENT_TYPES.has(documentType);
}

export function resolveTransactionalDraftDocumentType(input: {
  documentType?: unknown;
  draftType?: unknown;
  template?: unknown;
  taskType?: unknown;
  prompt?: unknown;
  instruction?: unknown;
  parameters?: Record<string, unknown>;
}): DraftDocumentType | null {
  const docType = resolveDraftDocumentType(input);
  return isTransactionalDraftDocumentType(docType) ? docType : null;
}
