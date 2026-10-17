/**
 * NV-DOCUMENT-TYPE-AGENT-PIN-001 — map draft registry documentType → specialist agent.
 *
 * Partner `-fast` draft paths previously tie-broke on capability + tier, so a
 * bail application could land on A-001 Contract Drafting before A-004 Pleading.
 * This table pins every `DraftDocumentType` to the drafting specialist counsel
 * expects for that instrument shape.
 */
import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';
import { resolveDraftDocumentType } from '../config/jrx-draft-length-registry.js';
import { isPartnerDraftTaskType } from '../config/jrx-draft-length-registry.js';

/** Registry agent id for each draft document type (all 20 registry keys). */
export const DOCUMENT_TYPE_AGENT_PIN: Readonly<Record<DraftDocumentType, string>> = {
  bail_application: 'A-004',
  criminal_petition: 'A-004',
  writ_petition: 'A-004',
  petition_application: 'A-004',
  interlocutory_application: 'A-004',
  civil_suit_plaint: 'A-004',
  written_statement: 'A-004',
  rejoinder: 'A-004',
  divorce_petition: 'A-004',
  written_arguments: 'A-004',
  final_arguments: 'A-004',
  legal_notice: 'A-005',
  reply_legal_notice: 'A-005',
  affidavit_simple: 'A-006',
  affidavit_case: 'A-006',
  counter_affidavit: 'A-006',
  simple_agreement: 'A-001',
  complex_agreement: 'A-001',
  legal_opinion: 'A-047',
  case_summary: 'A-048',
  review_petition: 'A-004',
  execution_petition: 'A-004',
  revision_petition: 'A-004',
  cross_objection: 'A-004',
  caveat: 'A-004',
  general_legal_document: 'A-004',
};

/** NDA alias resolves to simple_agreement in length registry; pin to contract family. */
const NDA_AGENT_PIN = 'A-001';

export interface DocumentTypePinInput {
  documentType?: unknown;
  draftType?: unknown;
  template?: unknown;
  taskType?: unknown;
  prompt?: unknown;
  parameters?: Record<string, unknown>;
}

/** Resolve canonical draft document type, then return pinned agent id if known. */
export function resolvePinnedAgentIdForDocumentType(input: DocumentTypePinInput): string | null {
  const docType = resolveDraftDocumentType(input);
  const pinned = DOCUMENT_TYPE_AGENT_PIN[docType];
  if (pinned) return pinned;

  const raw = String(input.documentType || input.parameters?.documentType || '').toLowerCase();
  if (raw === 'nda') return NDA_AGENT_PIN;
  return null;
}

/** True when taskType is a partner draft path that should honour documentType pin. */
export function shouldApplyDocumentTypeAgentPin(taskType?: string): boolean {
  return isPartnerDraftTaskType(taskType);
}

export function listDocumentTypeAgentPins(): Readonly<Record<DraftDocumentType, string>> {
  return DOCUMENT_TYPE_AGENT_PIN;
}
