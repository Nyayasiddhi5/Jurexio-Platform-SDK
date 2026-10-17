/**
 * NV-FILING-CHECKLIST-REGISTRY-001 — data-only enclosure manifest per NSP FB-468
 * `nvTemplateKey`, seeded from the reconciled filing-book manifest (16 P0 keys).
 *
 * This is the still-absent registry the NYV joint plan called for
 * (`documents/working/NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md` §Filing
 * enclosure manifest / §E item 3). It is consumed by the `draftProfile`
 * assembler (`nv-draft-profile-assembler.ts`) and emitted on the orchestration
 * response contract as `draftProfile.filingChecklist[]`.
 *
 * Honesty (NV-EXECUTE-BEFORE-CLAIM-001 / joint-plan §Honesty): these are
 * **practice-pattern** enclosure hints, not certified court requirements. Rows
 * are MINIMAL P0 seeds; the full 96pp OCR manifest ingest (SME-gated, ≥0.75) is
 * P1. NSP renders + tracks attach state; NYV never invents a filed enclosure.
 */
import type { DraftDocumentType } from './jrx-draft-length-registry.js';
import {
  FILING_BOOK_MANIFEST_VERSION,
  NV_TEMPLATE_KEY_CROSSWALK,
  crosswalkNvTemplateKey,
  normalizeNvTemplateKey,
  type NvTemplateKey,
} from './jrx-filing-book-crosswalk.js';

export { FILING_BOOK_MANIFEST_VERSION } from './jrx-filing-book-crosswalk.js';

/** Whether the enclosure must accompany the filing, or is context-dependent. */
export type FilingChecklistStatus = 'required' | 'recommended' | 'na';

export interface FilingChecklistItem {
  /** Stable id for NSP tick state (kebab). */
  id: string;
  label: string;
  /** True when the enclosure is a hard filing requirement for this instrument. */
  mandatory: boolean;
  /** Requirement class — NSP tracks actual attach state, NYV only states the rule. */
  status: FilingChecklistStatus;
  /** Statutory / rule basis (CPC Order-Rule, section, or practice note). */
  basis: string;
}

function item(
  id: string,
  label: string,
  basis: string,
  mandatory = true,
): FilingChecklistItem {
  return { id, label, mandatory, status: mandatory ? 'required' : 'recommended', basis };
}

/** Enclosures common to nearly every court filing. */
const VAKALATNAMA = item(
  'vakalatnama',
  'Vakalatnama / memo of appearance for the advocate',
  'Civil Rules of Practice — advocate authority',
);
/** TN presentation practice (book §3) — stamp amounts vary by State; advisory only. */
const VAKALATNAMA_TN_STAMPS = item(
  'vakalatnama-stamps-tn',
  'Vakalatnama court-fee stamp + advocate welfare stamps (verify State schedule)',
  'Book Pt.I §3 — TN presentation (Rs.10 CF + welfare stamps cited in manual)',
  false,
);
const PROCESS_APPLICATION = item(
  'process-application',
  'Process application with requisite court-fee for summons',
  'Book Pt.I §3 — presentation of plaint',
);
const SUIT_SUMMONS_FORMS = item(
  'suit-summons-forms',
  'Suit summons (Appendix B Forms I–III CPC)',
  'CPC Appendix B — Form I / II / III',
  false,
);
const COURT_FEE = item(
  'court-fee',
  'Requisite court-fee (stamp) as per the Court Fees Act 1870 / State schedule',
  'Court Fees Act 1870',
);
const COPIES_FOR_PARTIES = item(
  'copies-for-opposite-parties',
  'Sufficient copies for service on each opposite party',
  'CPC Order VI — copies for service',
  false,
);

/** Enclosures common to statutory legal notices. */
const NOTICE_DISPATCH_PROOF = item(
  'dispatch-proof',
  'Proof of dispatch (RPAD receipt / courier POD) and office copy retained',
  'Notice service — RPAD / acknowledgement due',
);
const NOTICE_REGISTER = item(
  'notice-register-entry',
  'Notice-register entry with date and mode of service',
  'Legal-notice register (practice)',
  false,
);

interface FilingChecklistManifestEntry {
  documentType: DraftDocumentType;
  rows: readonly FilingChecklistItem[];
  /**
   * NV-FILING-BOOK-WAVEC-001 — provenance pointer into the source practitioner
   * manual (part / section of the "Book of Filing, Drafting & Legal Notices").
   * Grounding is re-derivable via `scripts/jrx-filing-book-extract.ts`.
   */
  bookSection?: string;
}

/**
 * Per-nvTemplateKey minimal enclosure manifest (16 P0 keys).
 * `documentType` mirrors {@link NV_TEMPLATE_KEY_CROSSWALK} — kept alongside the
 * rows so the assembler can echo both the fine-grained and coarse type.
 */
export const FILING_CHECKLIST_MANIFEST: Readonly<Record<NvTemplateKey, FilingChecklistManifestEntry>> = {
  ni_138_statutory_notice: {
    documentType: 'legal_notice',
    rows: [
      item('dishonour-memo', 'Bank return / cheque dishonour memo', 'NI Act s.138 — dishonour proof'),
      item('cheque-copy', 'Copy of the dishonoured cheque(s)', 'NI Act s.138'),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  breach_notice: {
    documentType: 'legal_notice',
    rows: [
      item('contract-copy', 'Copy of the contract / agreement breached', 'Contract breach — supporting document', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  termination_notice: {
    documentType: 'legal_notice',
    rows: [
      item('agreement-copy', 'Copy of the agreement being terminated', 'Termination — supporting document', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  consumer_pre_litigation_notice: {
    documentType: 'legal_notice',
    rows: [
      item('purchase-proof', 'Proof of purchase / service (invoice, receipt)', 'Consumer Protection Act 2019', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  verification_affidavit_plaint: {
    documentType: 'affidavit_case',
    rows: [
      item('affidavit-stamp', 'Affidavit on requisite non-judicial stamp / e-stamp', 'Stamp Act (State)'),
      item('notary-attestation', 'Attestation before Notary / Oath Commissioner', 'Notaries Act 1952'),
      item('plaint-reference', 'Filed as an enclosure of the plaint (u/s 26(2) & Order VI Rule 15(4) CPC)', 'CPC s.26(2) & Order VI Rule 15(4)'),
    ],
  },
  civil_injunction_vacate: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit in support of the application', 'CPC Order XXXIX Rule 4'),
      item('injunction-order-copy', 'Copy of the injunction order sought to be vacated', 'CPC Order XXXIX Rule 4', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_receiver_appointment: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit in support of the application', 'CPC Order XL Rule 1'),
      item('property-particulars', 'Particulars / schedule of property for receivership', 'CPC Order XL', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_restore_suit: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit explaining the cause for non-appearance / default', 'CPC Order IX Rule 9'),
      item('dismissal-order-copy', 'Copy of the order of dismissal for default', 'CPC Order IX Rule 9', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_setaside_exparte_decree: {
    documentType: 'petition_application',
    rows: [
      item('supporting-affidavit', 'Affidavit showing sufficient cause / non-service of summons', 'CPC Order IX Rule 13'),
      item('exparte-decree-copy', 'Certified copy of the ex parte decree', 'CPC Order IX Rule 13'),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_amend_pleading: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit in support of the amendment', 'CPC Order VI Rule 17'),
      item('proposed-amendment', 'Proposed amended pleading / schedule of amendments', 'CPC Order VI Rule 17'),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_revision_petition: {
    documentType: 'revision_petition',
    rows: [
      item('impugned-order-copy', 'Certified copy of the impugned order', 'CPC s.115'),
      item('supporting-affidavit', 'Affidavit in support of the revision petition', 'CPC s.115'),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_section_47_application: {
    documentType: 'execution_petition',
    rows: [
      item('decree-copy', 'Certified copy of the decree under execution', 'CPC s.47 / Order XXI'),
      item('supporting-affidavit', 'Affidavit setting out the execution objection', 'CPC s.47'),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_cross_objection: {
    documentType: 'cross_objection',
    rows: [
      item('appeal-memo-copy', 'Copy of the memorandum of appeal / notice of appeal', 'CPC Order XLI Rule 22'),
      item('decree-copy', 'Certified copy of the decree/judgment under appeal', 'CPC Order XLI Rule 22', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_review_petition: {
    documentType: 'review_petition',
    rows: [
      item('impugned-judgment-copy', 'Certified copy of the judgment/order under review', 'CPC Order XLVII Rule 1'),
      item('supporting-affidavit', 'Affidavit showing error apparent / new evidence', 'CPC Order XLVII Rule 1'),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_caveat: {
    documentType: 'caveat',
    rows: [
      item('notice-to-applicant', 'Proof of notice of caveat served on the expected applicant (RPAD)', 'CPC s.148-A(2)'),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  indigent_suit_petition: {
    documentType: 'civil_suit_plaint',
    rows: [
      item('indigency-schedule', 'Schedule of property and means (indigent-person particulars)', 'CPC Order XXXIII Rule 2'),
      item('supporting-affidavit', 'Affidavit of indigency', 'CPC Order XXXIII'),
      item('plaint-in-duplicate', 'Plaint in duplicate + list of documents', 'CPC Order VII Rule 14', false),
      COPIES_FOR_PARTIES,
      VAKALATNAMA,
    ],
  },

  /* Wave B (NV-FILING-BOOK-WAVEB-001) — book-grounded IAs + statutory notices. */
  civil_temporary_injunction: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit in support (prima facie case, balance of convenience, irreparable injury)', 'CPC Order XXXIX Rules 1 & 2'),
      item('suit-documents', 'Copy of the plaint and documents establishing the right sought to be protected', 'CPC Order XXXIX', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_attachment_before_judgment: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit showing the defendant is about to dispose of / remove property to obstruct the decree', 'CPC Order XXXVIII Rule 5'),
      item('property-particulars', 'Particulars of the property sought to be attached', 'CPC Order XXXVIII Rule 5', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  civil_implead_lrs: {
    documentType: 'interlocutory_application',
    rows: [
      item('death-certificate', 'Death certificate of the deceased party', 'CPC Order XXII Rules 3/4'),
      item('lr-particulars', 'Particulars / relationship of the legal representatives to be brought on record', 'CPC Order XXII', false),
      VAKALATNAMA,
    ],
  },
  civil_condonation_of_delay: {
    documentType: 'interlocutory_application',
    rows: [
      item('supporting-affidavit', 'Affidavit explaining the sufficient cause for the delay, day-by-day', 'Limitation Act 1963, Section 5'),
      item('main-proceeding-copy', 'Copy of the appeal / application whose delay is sought to be condoned', 'Limitation Act 1963, Section 5', false),
      VAKALATNAMA,
      COURT_FEE,
    ],
  },
  eviction_notice: {
    documentType: 'legal_notice',
    rows: [
      item('tenancy-proof', 'Copy of the lease / rent agreement and proof of tenancy', 'Transfer of Property Act 1882, Section 106', false),
      item('rent-default-proof', 'Statement of rent arrears / breach relied upon', 'Rent control / T.P. Act', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  money_recovery_notice: {
    documentType: 'legal_notice',
    rows: [
      item('debt-proof', 'Documents evidencing the debt / dues (invoice, account statement, acknowledgement)', 'Recovery of money — supporting document', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  section_80_cpc_notice: {
    documentType: 'legal_notice',
    rows: [
      item('cause-of-action-statement', 'Statement of cause of action, relief claimed, and particulars of the plaintiff (mandatory contents)', 'CPC Section 80(1)'),
      item('served-on-authority', 'Delivered/left at the office of the appropriate Government / public officer', 'CPC Section 80(1)'),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },

  /* ── Wave C (NV-FILING-BOOK-WAVEC-001) — full book-manifest ingest ──────────
   * All rows are grounded in the "Book of Filing, Drafting & Legal Notices"
   * (see scripts/jrx-filing-book-extract.ts). Enclosure hints only; NSP tracks
   * actual attach state, NYV never invents a filed enclosure. */

  // Civil legal-notice model forms (Book Pt.II §7 — Model Form of Notices).
  promissory_note_demand_notice: {
    documentType: 'legal_notice',
    bookSection: 'Book Pt.II §7 — Notice: amount due on a promissory note',
    rows: [
      item('pronote-copy', 'Copy of the promissory note relied upon (with stamp)', 'Negotiable Instruments Act 1881 / Indian Stamp Act', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  defective_pronote_demand_notice: {
    documentType: 'legal_notice',
    bookSection: 'Book Pt.II §7 — Notice on a defective promissory note / hand letter',
    rows: [
      item('instrument-copy', 'Copy of the hand letter / defective promissory note and loan particulars', 'Indian Contract Act 1872 — debt on original consideration', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  mortgage_debt_notice: {
    documentType: 'legal_notice',
    bookSection: 'Book Pt.II §7 — Notice: amount due on a mortgage deed',
    rows: [
      item('mortgage-deed-copy', 'Copy of the registered mortgage deed', 'Transfer of Property Act 1882 — mortgage', false),
      item('account-statement', 'Statement of principal and interest due', 'Mortgage debt — supporting document', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  partition_demand_notice: {
    documentType: 'legal_notice',
    bookSection: 'Book Pt.II §7 — Notice claiming partition of a property',
    rows: [
      item('property-schedule', 'Schedule of joint-family / co-owned property and the share claimed', 'Partition — supporting particulars', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  railway_compensation_notice: {
    documentType: 'legal_notice',
    bookSection: 'Book Pt.II §7 — Statutory notice to railway authorities claiming compensation',
    rows: [
      item('consignment-proof', 'Railway receipt / consignment note and proof of loss, non-delivery or damage', 'Railways Act 1989, Section 106 (old s.77)'),
      item('served-on-railway', 'Notice served on the Railway Administration within the statutory period', 'Railways Act 1989, Section 106'),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },
  rent_increase_notice: {
    documentType: 'legal_notice',
    bookSection: 'Book Pt.II §7 — Notice to pay increased rent',
    rows: [
      item('tenancy-proof', 'Copy of the tenancy agreement and basis of the increase', 'TN Regulation of Rights and Responsibilities of Landlords and Tenants Act', false),
      NOTICE_DISPATCH_PROOF,
      NOTICE_REGISTER,
    ],
  },

  // Model plaints / suits (Book Pt.I §5–§14).
  money_recovery_suit: {
    documentType: 'civil_suit_plaint',
    bookSection: 'Book Pt.I §5 — Model Form of Plaint (recovery of money)',
    rows: [
      item('plaint-in-duplicate', 'Plaint in duplicate + list of documents', 'CPC Order VII Rule 14'),
      item('verification-affidavit', 'Verification affidavit (u/s 26(2) & Order VI Rule 15(4) CPC)', 'CPC s.26(2) & Order VI Rule 15(4)'),
      item('debt-proof', 'Documents evidencing the debt (promissory note / invoice / account)', 'Recovery of money — supporting document', false),
      COURT_FEE,
      VAKALATNAMA,
      COPIES_FOR_PARTIES,
    ],
  },
  declaration_injunction_suit: {
    documentType: 'civil_suit_plaint',
    bookSection: 'Book Pt.I §7 — Suit for Declaration and Injunction',
    rows: [
      item('plaint-in-duplicate', 'Plaint in duplicate + list of documents', 'CPC Order VII Rule 14'),
      item('verification-affidavit', 'Verification affidavit (u/s 26(2) & Order VI Rule 15(4) CPC)', 'CPC s.26(2) & Order VI Rule 15(4)'),
      item('title-documents', 'Documents establishing the right / title sought to be declared and protected', 'Specific Relief Act 1963, Sections 34 & 38', false),
      item('ia-temporary-injunction', 'Interim injunction application with supporting affidavit (if urgent relief sought)', 'CPC Order XXXIX Rules 1 & 2', false),
      COURT_FEE,
      VAKALATNAMA,
      COPIES_FOR_PARTIES,
    ],
  },
  partition_suit: {
    documentType: 'civil_suit_plaint',
    bookSection: 'Book Pt.I §11 — Plaint for partition and mesne profits',
    rows: [
      item('plaint-in-duplicate', 'Plaint in duplicate + list of documents', 'CPC Order VII Rule 14'),
      item('verification-affidavit', 'Verification affidavit (u/s 26(2) & Order VI Rule 15(4) CPC)', 'CPC s.26(2) & Order VI Rule 15(4)'),
      item('property-schedule', 'Schedule of joint / co-owned property and the shares claimed', 'Partition suit — property particulars'),
      COURT_FEE,
      VAKALATNAMA,
      COPIES_FOR_PARTIES,
    ],
  },
  summary_suit: {
    documentType: 'civil_suit_plaint',
    bookSection: 'Book Pt.I §12–14 — Summary Suit (Order XXXVII)',
    rows: [
      item('plaint-summary-endorsement', 'Plaint with the Order XXXVII endorsement that the suit is filed under the summary procedure', 'CPC Order XXXVII Rule 2'),
      item('liquidated-claim-proof', 'Written contract / bill of exchange / promissory note / statutory demand founding the liquidated claim', 'CPC Order XXXVII Rule 1(2)'),
      item('verification-affidavit', 'Verification affidavit (u/s 26(2) & Order VI Rule 15(4) CPC)', 'CPC s.26(2) & Order VI Rule 15(4)'),
      COURT_FEE,
      VAKALATNAMA,
    ],
  },

  // IAs / pleadings.
  summary_suit_leave_to_defend: {
    documentType: 'interlocutory_application',
    bookSection: 'Book Pt.I §13 — Application for leave to defend a summary suit',
    rows: [
      item('supporting-affidavit', 'Affidavit disclosing the facts and the substantial defence relied upon', 'CPC Order XXXVII Rule 3(5)'),
      item('summons-copy', 'Copy of the summons for judgment served in the summary suit', 'CPC Order XXXVII Rule 3', false),
      VAKALATNAMA,
    ],
  },
  written_statement_defence: {
    documentType: 'written_statement',
    bookSection: 'Book Pt.I §15–16 — Written Statement',
    rows: [
      item('ws-copies', 'Copy of the written statement for each party', 'CPC Order VIII', false),
      item('documents-relied', 'List of documents relied upon in defence', 'CPC Order VIII Rule 1A', false),
      VAKALATNAMA,
    ],
  },
  counter_claim: {
    documentType: 'written_statement',
    bookSection: 'Book Pt.I — Counter Claim',
    rows: [
      item('counterclaim-court-fee', 'Court-fee on the counter-claim as if it were a plaint', 'CPC Order VIII Rule 6A / Court Fees Act'),
      item('counterclaim-documents', 'Documents founding the counter-claim', 'CPC Order VIII Rule 6A', false),
      VAKALATNAMA,
    ],
  },

  // Appeals (CPC s.96 / s.100).
  first_appeal_memo: {
    documentType: 'petition_application',
    bookSection: 'Book Pt.I — Model Form of First Appeal (L4719+)',
    rows: [
      item('impugned-judgment-decree', 'Certified copy of the judgment and decree appealed against', 'CPC Section 96 & Order XLI Rule 1'),
      item('memorandum-grounds', 'Memorandum of grounds of appeal (one copy per respondent)', 'CPC Order XLI Rule 1'),
      item('appeal-notice-form', 'Appeal notice (Form 2) with due attestation as true copy', 'Book first-appeal filing list'),
      PROCESS_APPLICATION,
      item('typed-copies', 'Typed/cyclostyled copies for service on respondents and court', 'Book first-appeal filing list', false),
      COURT_FEE,
      VAKALATNAMA,
      VAKALATNAMA_TN_STAMPS,
    ],
  },
  second_appeal_memo: {
    documentType: 'petition_application',
    bookSection: 'Book Pt.I — Grounds of Appeal (second appeal)',
    rows: [
      item('lower-judgments-copies', 'Certified copies of the judgments/decrees of both courts below', 'CPC Section 100 & Order XLII'),
      item('substantial-question', 'Statement of the substantial question(s) of law involved', 'CPC Section 100(3)'),
      COURT_FEE,
      VAKALATNAMA,
    ],
  },

  // Execution (CPC Order XXI).
  execution_arrest_detention: {
    documentType: 'execution_petition',
    bookSection: 'Book Pt.I — Execution: arrest & detention of judgment-debtor',
    rows: [
      item('decree-copy', 'Certified copy of the decree under execution', 'CPC Order XXI Rule 11'),
      item('arrest-grounds-affidavit', 'Affidavit showing grounds under s.51 proviso for arrest/detention', 'CPC Section 51 & Order XXI Rules 37–40'),
      COURT_FEE,
      VAKALATNAMA,
    ],
  },
  execution_attachment_sale: {
    documentType: 'execution_petition',
    bookSection: 'Book Pt.I — Execution: attachment & sale of property',
    rows: [
      item('decree-copy', 'Certified copy of the decree under execution', 'CPC Order XXI Rule 11'),
      item('property-particulars', 'Particulars / schedule of the property to be attached and sold', 'CPC Order XXI Rules 41–57'),
      COURT_FEE,
      VAKALATNAMA,
    ],
  },

  civil_miscellaneous_appeal: {
    documentType: 'petition_application',
    bookSection: 'Book Pt.I — CMA / appeal against appealable order (O.43 R.1–2)',
    rows: [
      item('impugned-order-copy', 'Certified copy of the appealable order', 'CPC Order XLIII Rule 1'),
      item('memorandum-grounds', 'Memorandum of appeal (first-appeal model form may be followed)', 'Book O.43 R.2 — CMA practice'),
      item('appealability-check', 'Confirm order is in the O.43 R.1 appealable list (advisory index on NYV)', 'CPC Order XLIII Rule 1'),
      COURT_FEE,
      VAKALATNAMA,
      VAKALATNAMA_TN_STAMPS,
    ],
  },
  appeal_stay_petition: {
    documentType: 'interlocutory_application',
    bookSection: 'Book Pt.I — Stay petition with affidavit (first appeal filing list)',
    rows: [
      item('stay-affidavit', 'Stay petition supported by affidavit', 'Book first-appeal filing list'),
      item('parent-appeal-copy', 'Copy of the memorandum of appeal / CMA in which stay is sought', 'Book first-appeal filing list', false),
      item('stay-court-fee', 'Court-fee on stay petition (State schedule — book cites Rs.20 TN example)', 'Book first-appeal filing list — verify registry'),
      VAKALATNAMA,
    ],
  },
  plaint_presentation_pack: {
    documentType: 'civil_suit_plaint',
    bookSection: 'Book Pt.I §3–§4 — Presentation of plaint (essential papers)',
    rows: [
      item('plaint-in-duplicate', 'Original plaint in duplicate', 'CPC Order VII Rule 1 / Section 26'),
      item('verification-affidavit', 'Verification affidavit u/s 26(2) and Order VI Rule 15(4)', 'CPC s.26(2) & Order VI Rule 15(4)'),
      item('plaint-copies-defendants', 'Copy of plaint and proof affidavit for each defendant', 'Book §3 presentation'),
      VAKALATNAMA,
      VAKALATNAMA_TN_STAMPS,
      item('valuation-slip', 'Valuation slip (when required by court)', 'Book §3 presentation', false),
      PROCESS_APPLICATION,
      SUIT_SUMMONS_FORMS,
      item('documents-o7-r14', 'Documents in original with one copy (Order VII Rule 14)', 'CPC Order VII Rule 14'),
      COURT_FEE,
    ],
  },
};

/** Coarse per-doctype fallback when no fine-grained `nvTemplateKey` was supplied. */
const DOCTYPE_DEFAULT_CHECKLIST: Partial<Record<DraftDocumentType, readonly FilingChecklistItem[]>> = {
  legal_notice: [NOTICE_DISPATCH_PROOF, NOTICE_REGISTER],
  reply_legal_notice: [NOTICE_DISPATCH_PROOF, NOTICE_REGISTER],
  civil_suit_plaint: [
    item('plaint-in-duplicate', 'Plaint in duplicate', 'CPC Order VII'),
    item('verification-affidavit', 'Verification affidavit (u/s 26(2) & Order VI Rule 15(4) CPC)', 'CPC s.26(2) & Order VI Rule 15(4)'),
    item('list-of-documents', 'List of documents relied upon', 'CPC Order VII Rule 14'),
    COURT_FEE,
    VAKALATNAMA,
    COPIES_FOR_PARTIES,
  ],
  written_statement: [
    item('ws-copies', 'Copy of the written statement for each party', 'CPC Order VIII', false),
    VAKALATNAMA,
  ],
  interlocutory_application: [
    item('supporting-affidavit', 'Affidavit in support of the application', 'CPC — affidavit in support'),
    VAKALATNAMA,
    COURT_FEE,
  ],
  petition_application: [
    item('supporting-affidavit', 'Affidavit in support of the petition', 'CPC — affidavit in support'),
    VAKALATNAMA,
    COURT_FEE,
  ],
  writ_petition: [
    item('supporting-affidavit', 'Affidavit in support of the petition', 'Constitutional writ practice'),
    item('annexures', 'Annexures (numbered) relied upon', 'Writ practice — annexures'),
    item('index-of-contents', 'Index of contents / list of dates (High Court rules)', 'Writ practice — registry checklist', false),
    COURT_FEE,
    VAKALATNAMA,
  ],
  bail_application: [
    item('bail-affidavit', 'Affidavit in support of bail (facts, antecedents, surety particulars)', 'BNSS / Cr.P.C. bail practice — no model form in FB-468 book'),
    item('fir-chargesheet-copies', 'Copy of FIR / chargesheet / remand orders relied upon', 'Criminal bail practice', false),
    VAKALATNAMA,
    item('vakalatnama-or-memo', 'Vakalatnama or memo of appearance', 'Criminal court practice'),
  ],
  criminal_petition: [
    item('supporting-affidavit', 'Affidavit in support of the criminal petition', 'Criminal original jurisdiction practice'),
    VAKALATNAMA,
  ],
  execution_petition: [
    item('decree-copy', 'Certified copy of the decree under execution', 'CPC Order XXI Rule 11'),
    COURT_FEE,
    VAKALATNAMA,
  ],
  review_petition: [
    item('impugned-judgment-copy', 'Certified copy of the judgment/order under review', 'CPC Order XLVII Rule 1'),
    COURT_FEE,
    VAKALATNAMA,
  ],
  revision_petition: [
    item('impugned-order-copy', 'Certified copy of the impugned order', 'CPC s.115'),
    COURT_FEE,
    VAKALATNAMA,
  ],
  cross_objection: [
    item('appeal-memo-copy', 'Copy of the memorandum of appeal', 'CPC Order XLI Rule 22'),
    COURT_FEE,
    VAKALATNAMA,
  ],
  caveat: [
    item('notice-to-applicant', 'Proof of notice of caveat served on the expected applicant (RPAD)', 'CPC s.148-A(2)'),
    VAKALATNAMA,
  ],
  affidavit_case: [
    item('affidavit-stamp', 'Affidavit on requisite stamp / e-stamp with notary attestation', 'Stamp Act (State) / Notaries Act 1952'),
  ],
};

export interface FilingChecklistResolution {
  /** The normalised nvTemplateKey when the caller supplied a recognised one. */
  nvTemplateKey?: NvTemplateKey;
  documentType: DraftDocumentType;
  rows: FilingChecklistItem[];
  /** True when rows came from a fine-grained manifest entry (vs coarse fallback). */
  fromManifest: boolean;
}

/**
 * Resolve the enclosure checklist for a draft.
 *
 * Preference order: fine-grained `nvTemplateKey` manifest → coarse per-doctype
 * fallback → empty (never invented). `documentType` is the already-resolved
 * coarse `DraftDocumentType`.
 */
export function resolveFilingChecklist(input: {
  nvTemplateKey?: unknown;
  documentType: DraftDocumentType;
}): FilingChecklistResolution {
  const key = normalizeNvTemplateKey(input.nvTemplateKey);
  if (key) {
    const entry = FILING_CHECKLIST_MANIFEST[key];
    return {
      nvTemplateKey: key,
      documentType: entry.documentType,
      rows: [...entry.rows],
      fromManifest: true,
    };
  }

  const fallback = DOCTYPE_DEFAULT_CHECKLIST[input.documentType];
  return {
    documentType: input.documentType,
    rows: fallback ? [...fallback] : [],
    fromManifest: false,
  };
}

/** Re-export for callers that only need the crosswalk. */
export { NV_TEMPLATE_KEY_CROSSWALK, crosswalkNvTemplateKey };
export type { NvTemplateKey };
