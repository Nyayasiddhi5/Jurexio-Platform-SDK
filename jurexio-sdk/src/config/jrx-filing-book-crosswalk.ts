/**
 * NV-FILING-BOOK-CROSSWALK-001 — NSP FB-468 `nvTemplateKey` → coarse JRX `DraftDocumentType`.
 *
 * SSoT for the fine-grained → coarse mapping so NSP can send
 * `parameters.documentType = nvTemplateKey` (reconciled FB-468 flow, commit
 * `ccecd65d`) and JRX still resolves a first-class drafting document type.
 *
 * Reconciliation contract: `documents/working/NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md`
 * §"NSP FB-468 reconciliation" §C (per-key map) + §D (merged wire shape).
 *
 * This module carries NO runtime dependency on the registry (type-only import),
 * so `jrx-draft-length-registry.ts` can consume the crosswalk without a cycle.
 */
import type { DraftDocumentType } from './jrx-draft-length-registry.js';

/**
 * Version stamp of the FB-468 filing-book manifest the JRX side is seeded from.
 * Echoed on `draftProfile.filingBookVersion` when NSP omits its own.
 */
export const FILING_BOOK_MANIFEST_VERSION = 'FB-468.2026-09-22.waveD';

/**
 * FB-468 filing-book manifest keys JRX crosswalks today:
 *   - 16 P0 keys (original reconciliation), plus
 *   - 7 Wave B keys (NV-FILING-BOOK-WAVEB-001) — common IAs + statutory notices, plus
 *   - 17 Wave C keys (NV-FILING-BOOK-WAVEC-001) — full 96pp book-manifest ingest:
 *   - 3 Wave D keys (NV-BOOK-SME-WAVE-D-001) — CMA / stay / plaint presentation pack:
 *     civil-notice model forms (promissory note / mortgage / partition / railway /
 *     rent), model plaints (money recovery / declaration+injunction / partition /
 *     summary suit), leave-to-defend + written statement + counter-claim, first &
 *     second appeal memoranda, and Order-XXI execution petitions.
 *
 * Every Wave C key is *grounded* in the source text — see
 * `scripts/jrx-filing-book-extract.ts` (17/17 probes matched) — and folds onto an
 * existing coarse {@link DraftDocumentType}; no new coarse type was invented.
 */
export type NvTemplateKey =
  | 'ni_138_statutory_notice'
  | 'breach_notice'
  | 'termination_notice'
  | 'consumer_pre_litigation_notice'
  | 'verification_affidavit_plaint'
  | 'civil_injunction_vacate'
  | 'civil_receiver_appointment'
  | 'civil_restore_suit'
  | 'civil_setaside_exparte_decree'
  | 'civil_amend_pleading'
  | 'civil_revision_petition'
  | 'civil_section_47_application'
  | 'civil_cross_objection'
  | 'civil_review_petition'
  | 'civil_caveat'
  | 'indigent_suit_petition'
  // Wave B (NV-FILING-BOOK-WAVEB-001)
  | 'civil_temporary_injunction'
  | 'civil_attachment_before_judgment'
  | 'civil_implead_lrs'
  | 'civil_condonation_of_delay'
  | 'eviction_notice'
  | 'money_recovery_notice'
  | 'section_80_cpc_notice'
  // Wave C (NV-FILING-BOOK-WAVEC-001) — full book-manifest ingest.
  // Civil legal-notice model forms (Book Pt.II §7):
  | 'promissory_note_demand_notice'
  | 'defective_pronote_demand_notice'
  | 'mortgage_debt_notice'
  | 'partition_demand_notice'
  | 'railway_compensation_notice'
  | 'rent_increase_notice'
  // Model plaints / suits (Book Pt.I §5–§14):
  | 'money_recovery_suit'
  | 'declaration_injunction_suit'
  | 'partition_suit'
  | 'summary_suit'
  // IAs / pleadings:
  | 'summary_suit_leave_to_defend'
  | 'written_statement_defence'
  | 'counter_claim'
  // Appeals (CPC s.96 / s.100):
  | 'first_appeal_memo'
  | 'second_appeal_memo'
  // Execution (CPC Order XXI):
  | 'execution_arrest_detention'
  | 'execution_attachment_sale'
  // Wave D (NV-BOOK-SME-WAVE-D-001) — book filing packs without new coarse types.
  | 'civil_miscellaneous_appeal'
  | 'appeal_stay_petition'
  | 'plaint_presentation_pack';

/**
 * Per §C of the reconciliation: 13 keys fold onto existing coarse doctypes, 3
 * resolve to the P0 doctypes added in this pass (`revision_petition`,
 * `cross_objection`, `caveat`).
 */
export const NV_TEMPLATE_KEY_CROSSWALK: Readonly<Record<NvTemplateKey, DraftDocumentType>> = {
  ni_138_statutory_notice: 'legal_notice',
  breach_notice: 'legal_notice',
  termination_notice: 'legal_notice',
  consumer_pre_litigation_notice: 'legal_notice',
  verification_affidavit_plaint: 'affidavit_case',
  civil_injunction_vacate: 'interlocutory_application',
  civil_receiver_appointment: 'interlocutory_application',
  civil_restore_suit: 'interlocutory_application',
  civil_setaside_exparte_decree: 'petition_application',
  civil_amend_pleading: 'interlocutory_application',
  civil_revision_petition: 'revision_petition',
  civil_section_47_application: 'execution_petition',
  civil_cross_objection: 'cross_objection',
  civil_review_petition: 'review_petition',
  civil_caveat: 'caveat',
  indigent_suit_petition: 'civil_suit_plaint',
  // Wave B (NV-FILING-BOOK-WAVEB-001) — all fold onto existing coarse doctypes.
  civil_temporary_injunction: 'interlocutory_application',
  civil_attachment_before_judgment: 'interlocutory_application',
  civil_implead_lrs: 'interlocutory_application',
  civil_condonation_of_delay: 'interlocutory_application',
  eviction_notice: 'legal_notice',
  money_recovery_notice: 'legal_notice',
  section_80_cpc_notice: 'legal_notice',
  // Wave C (NV-FILING-BOOK-WAVEC-001) — all fold onto existing coarse doctypes.
  promissory_note_demand_notice: 'legal_notice',
  defective_pronote_demand_notice: 'legal_notice',
  mortgage_debt_notice: 'legal_notice',
  partition_demand_notice: 'legal_notice',
  railway_compensation_notice: 'legal_notice',
  rent_increase_notice: 'legal_notice',
  money_recovery_suit: 'civil_suit_plaint',
  declaration_injunction_suit: 'civil_suit_plaint',
  partition_suit: 'civil_suit_plaint',
  summary_suit: 'civil_suit_plaint',
  summary_suit_leave_to_defend: 'interlocutory_application',
  written_statement_defence: 'written_statement',
  counter_claim: 'written_statement',
  // Memoranda of appeal fold onto the petition coarse bucket (grounds + prayer
  // pleading shape); the dedicated appeal-family coarse types remain
  // revision/review/cross-objection.
  first_appeal_memo: 'petition_application',
  second_appeal_memo: 'petition_application',
  execution_arrest_detention: 'execution_petition',
  execution_attachment_sale: 'execution_petition',
  civil_miscellaneous_appeal: 'petition_application',
  appeal_stay_petition: 'interlocutory_application',
  plaint_presentation_pack: 'civil_suit_plaint',
};

function normalizeTemplateKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Resolve an NSP `nvTemplateKey` to a coarse JRX `DraftDocumentType`, or undefined. */
export function crosswalkNvTemplateKey(raw: unknown): DraftDocumentType | undefined {
  const key = normalizeTemplateKey(raw);
  if (!key) return undefined;
  return (NV_TEMPLATE_KEY_CROSSWALK as Record<string, DraftDocumentType>)[key];
}

/** True when `raw` is a recognised FB-468 `nvTemplateKey`. */
export function isNvTemplateKey(raw: unknown): boolean {
  return crosswalkNvTemplateKey(raw) !== undefined;
}

/** The canonical, normalised nvTemplateKey (or undefined) — used for echo/provenance. */
export function normalizeNvTemplateKey(raw: unknown): NvTemplateKey | undefined {
  const key = normalizeTemplateKey(raw);
  return key && key in NV_TEMPLATE_KEY_CROSSWALK ? (key as NvTemplateKey) : undefined;
}
